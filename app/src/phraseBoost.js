// Phrase boosting (context biasing) for TDT decoding.
//
// Ports the *concept* of NeMo's GPU-Accelerated Phrase-Boosting (PR #14277) to
// this app's browser decoder: a token-level boosting trie that injects an
// additive, logit-space reward (shallow fusion) for tokens that continue or
// start a user-supplied phrase, biasing decoding toward (positive weight) or
// away from (negative weight) those phrases. The same trie drives both decode
// paths in parakeet.js: the greedy (beam width 1) path, where the bonus nudges
// the per-step argmax, and the MAES beam path, where each hypothesis carries its
// own active-node set (parakeet.js borrows it via `phraseBoost.active = hyp.active`)
// and the bonus also feeds the beam's pruning score so a phrase hypothesis can
// survive the beam cut. Under greedy, boosting is best-effort and cannot recover
// a phrase already pruned; MAES weakens that limit by keeping rival hypotheses
// alive. Note beam search is full-file only: streaming / decoder-state continuity
// forces greedy (parakeet.js), so the live transcriber always takes the greedy path.
//
// Reward model (PLAN.md section 3): each trie node at depth d carries
//   nodeBonus = phraseWeight * (1 + DEPTH_SCALING * (d - 1))
// and the applied bonus is `globalStrength * nodeBonus`. Depth scaling rewards
// deeper (more committed) matches more, encouraging phrase completion; it is
// linear and bounded so long phrases cannot blow up the logits. A negative
// per-phrase weight flips the sign so the phrase is penalised instead of
// boosted; a negative global strength inverts every phrase at once.
//
// Top-k gating (applyBoost): a candidate token only receives its bonus when its
// raw logit is already among the model's top-k tokens (per-phrase, default
// DEFAULT_BOOST_TOPK). This keeps boosting a ranking nudge rather than a hammer
// that forces a token the model itself ranked far down (which would hallucinate
// the phrase). The gate is on the model's own raw logits, so the strength
// multiplier and weight sign do not affect which tokens are eligible.

/** Internal: default linear depth-scaling factor (PLAN.md section 3). */
const DEFAULT_DEPTH_SCALING = 0.5;

/**
 * Per-phrase weight bounds (UI input is validated to this range). The accepted
 * range is the closed interval `[-MAX_PHRASE_WEIGHT, MAX_PHRASE_WEIGHT]` minus
 * zero: a positive weight boosts the phrase, a negative weight penalises it, and
 * zero (no effect) is rejected back to the default of 1.
 */
export const MAX_PHRASE_WEIGHT = 10;

/**
 * Default top-k gate for a phrase (see {@link BoostingTrie#applyBoost}). A
 * phrase token only receives its boost when its raw logit is already among the
 * model's top-`topk` tokens, so boosting nudges the ranking without forcing a
 * token the model ranked far down. Overridable per-phrase via the `:weight:topk`
 * suffix.
 */
export const DEFAULT_BOOST_TOPK = 25;

/**
 * If `text` ends in `:<number>` with a non-empty head before that colon, return
 * `{ head, value }` (head trimmed); otherwise null. Used to peel the optional
 * trailing `:weight` and `:weight:topk` fields off a phrase line.
 * @param {string} text
 * @returns {{head: string, value: number}|null}
 */
export function peelTrailingNumber(text) {
  const colon = text.lastIndexOf(':');
  if (colon <= 0 || colon >= text.length - 1) return null;
  const tail = text.slice(colon + 1).trim();
  if (tail === '') return null;
  const value = Number(tail);
  if (!Number.isFinite(value)) return null;
  const head = text.slice(0, colon).trim();
  if (!head) return null;
  return { head, value };
}

/**
 * Parse a multi-line boost-phrase blob. Each non-empty line is a phrase with two
 * optional trailing numeric fields: `phrase:WEIGHT` or `phrase:WEIGHT:TOPK`
 * (e.g. `acetaminophen:2.5`, `um:-3`, `venlafaxine:5:50`). Fields are peeled
 * right-to-left, so a single trailing number is the weight and the inner of two
 * is the weight while the outer (last) is the top-k gate. Because only a numeric
 * tail after the LAST colon is treated as a field, phrases containing colons
 * (e.g. `ratio 3:1`) keep working unless they end in `:num`. A negative weight
 * is written with the minus sign after the colon (`phrase:-3`).
 * @param {string} raw
 * @returns {Array<{phrase: string, weight: number, topk: number, warning?: string}>}
 */
export function parseBoostPhrases(raw) {
  if (!raw) return [];
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let phrase = trimmed;
    let weight = 1;
    let topk = DEFAULT_BOOST_TOPK;
    const warnings = [];

    const last = peelTrailingNumber(phrase);
    if (last) {
      const prev = peelTrailingNumber(last.head);
      if (prev) {
        // phrase:WEIGHT:TOPK  (prev = weight, last = topk)
        phrase = prev.head;
        weight = prev.value;
        topk = last.value;
      } else {
        // phrase:WEIGHT
        phrase = last.head;
        weight = last.value;
      }
    }

    if (weight === 0 || weight < -MAX_PHRASE_WEIGHT || weight > MAX_PHRASE_WEIGHT) {
      warnings.push(`weight ${weight} out of range [-${MAX_PHRASE_WEIGHT}, ${MAX_PHRASE_WEIGHT}] (nonzero); using 1`);
      weight = 1;
    }
    if (!Number.isInteger(topk) || topk < 1) {
      warnings.push(`top-k ${topk} invalid (integer >= 1); using ${DEFAULT_BOOST_TOPK}`);
      topk = DEFAULT_BOOST_TOPK;
    }

    const entry = { phrase, weight, topk };
    if (warnings.length) entry.warning = warnings.join('; ');
    out.push(entry);
  }
  return out;
}

/**
 * Casing variants of a phrase that the model might emit: as-typed, all
 * lowercase, ALL UPPERCASE, Sentence case (first letter capitalised) and Title
 * Case (each space-separated word capitalised). Surrogate-safe; deduplicated
 * with the as-typed form first. Drug names / jargon are usually ASCII, but
 * `toLowerCase`/`toUpperCase` also give sensible variants for accented Latin.
 * @param {string} phrase
 * @returns {string[]}
 */
export function casingVariants(phrase) {
  const capFirst = (s) => {
    const chars = Array.from(s); // codepoints (surrogate-safe)
    if (!chars.length) return s;
    chars[0] = chars[0].toUpperCase();
    return chars.join('');
  };
  const lower = phrase.toLowerCase();
  const candidates = [
    phrase,                                   // as typed (preserves e.g. mRNA)
    lower,                                     // mid-sentence common noun
    phrase.toUpperCase(),                      // acronym / emphasis
    capFirst(lower),                           // Sentence case (sentence start)
    lower.split(' ').map(capFirst).join(' '),  // Title Case (proper noun)
  ];
  const seen = new Set();
  const out = [];
  for (const v of candidates) {
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
}

/**
 * Expand parsed boost entries so each typed phrase covers every casing the
 * model can emit (see {@link casingVariants}). The BPE encoder is
 * case-sensitive, so `venlafaxine`, `Venlafaxine` and `VENLAFAXINE` encode to
 * different token sequences and must each be their own trie branch; this turns
 * one typed phrase into one entry per casing variant. Deduplicated across the
 * whole list by phrase string; on a collision the larger-magnitude weight wins
 * (matching the trie's strongest-magnitude rule) and carries its own top-k.
 * @param {Array<{phrase: string, weight: number, topk?: number}>} entries
 * @returns {Array<{phrase: string, weight: number, topk?: number}>}
 */
export function expandCasingVariants(entries) {
  const byPhrase = new Map();
  for (const entry of entries) {
    for (const phrase of casingVariants(entry.phrase)) {
      const prev = byPhrase.get(phrase);
      if (!prev || Math.abs(entry.weight) > Math.abs(prev.weight)) {
        byPhrase.set(phrase, { ...entry, phrase });
      }
    }
  }
  return [...byPhrase.values()];
}

/**
 * Encode parsed phrase entries to token-id sequences, dropping phrases whose
 * encoding contains the encoder's `<unk>` id (a character with no vocab token,
 * e.g. CJK) since the decoder never emits `<unk>` so such a phrase could never
 * match. Shared by {@link BoostingTrie.buildFromPhrases} (main thread) and the
 * phrase-boost worker, so the encode + unk-filter rule lives in exactly one
 * place. This is the CPU-heavy step for large lists (the BPE merge loop runs per
 * phrase), which is why the worker calls it off the main thread.
 * @param {Array<{phrase: string, weight: number, topk?: number}>} entries
 * @param {{encode: (text: string) => number[], unkId?: number}} encoder A BpeEncoder.
 * @returns {{encoded: Array<{ids: number[], weight: number, topk?: number}>, skipped: string[]}}
 */
export function encodePhrases(entries, encoder) {
  const unkId = encoder.unkId;
  const encoded = [];
  const skipped = [];
  for (const { phrase, weight, topk } of entries) {
    const ids = encoder.encode(phrase);
    if (!ids.length) continue;
    if (unkId !== undefined && ids.includes(unkId)) {
      skipped.push(phrase);
      continue;
    }
    encoded.push({ ids, weight, topk });
  }
  return { encoded, skipped };
}

/**
 * Indices of the `k` largest elements of `logits`, returned in descending value
 * order so the array index doubles as the 0-based top-k rank (rank 0 = largest).
 * Used by {@link BoostingTrie#applyBoost} to gate boosts: a token is "in top-k"
 * iff its rank `< k`. O(V*k) to find the k largest (early-out on the running
 * minimum) plus an O(k log k) sort, cheap for the small k used by boost gating.
 * When `k >= logits.length` every index is returned (the gate is effectively
 * off). Ties are broken by scan order, matching no particular phrase.
 * @param {Float32Array|number[]} logits
 * @param {number} k
 * @returns {number[]}
 */
function rankedTopKIds(logits, k) {
  const n = logits.length;
  const kk = Math.min(k, n);
  const ids = [];
  const vals = [];
  for (let i = 0; i < n; i++) {
    const v = logits[i];
    if (ids.length < kk) {
      ids.push(i); vals.push(v);
    } else {
      let mi = 0; // index (within the kept set) of the current smallest
      for (let j = 1; j < kk; j++) if (vals[j] < vals[mi]) mi = j;
      if (v > vals[mi]) { vals[mi] = v; ids[mi] = i; }
    }
  }
  return ids
    .map((id, idx) => idx)
    .sort((a, b) => vals[b] - vals[a])
    .map(idx => ids[idx]);
}

/**
 * Trie node. `children` is created lazily (null until the first child is
 * inserted) so the many leaf nodes of a large list do not each carry an empty
 * Map; readers must treat a null `children` as "no children".
 * @returns {{children: Map<number, object>|null, depth: number, bonus: number, topk: number}}
 */
function makeNode(depth) {
  return { children: null, depth, bonus: 0, topk: DEFAULT_BOOST_TOPK };
}

/**
 * Token-level boosting trie consumed by the greedy decoder in parakeet.js.
 */
export class BoostingTrie {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.strength=1] Global boost strength multiplier (UI slider).
   * @param {number} [opts.depthScaling=0.5] Linear per-depth reward growth.
   */
  constructor(opts = {}) {
    this.root = makeNode(0);
    this.strength = opts.strength ?? 1;
    this.depthScaling = opts.depthScaling ?? DEFAULT_DEPTH_SCALING;
    this.size = 0; // number of distinct phrases inserted (for UI/diagnostics)
    /**
     * Largest per-phrase top-k gate inserted so far. {@link applyBoost} only
     * ever boosts a token inside the model's top-`maxTopk`, so this is the depth
     * to which the per-step top-k scan must reach; each candidate is then gated
     * by its own (possibly smaller) `topk`. Tracking the max globally avoids
     * re-scanning the (potentially vocab-sized) active children every step.
     */
    this.maxTopk = 0;
    /**
     * Phrases that {@link BoostingTrie.buildFromPhrases} dropped because they
     * encode to an out-of-vocabulary `<unk>` token (e.g. CJK / scripts absent
     * from the model vocab), so they cannot be matched during decoding. Surfaced
     * to the UI as a warning; empty when every phrase encoded cleanly.
     * @type {string[]}
     */
    this.skipped = [];
    /** Active trie nodes for the current decode position; root is always active. */
    this.active = [this.root];
  }

  /**
   * Build a trie from parsed phrase entries using a text->id encoder. A phrase
   * whose encoding contains the encoder's `<unk>` id (a character with no vocab
   * token, e.g. CJK) is dropped rather than inserted, since the decoder never
   * emits `<unk>` so the phrase could never match; such phrases are collected on
   * the returned trie's `skipped` array for the UI to warn about.
   * @param {Array<{phrase: string, weight: number, topk?: number}>} entries
   * @param {{encode: (text: string) => number[], unkId?: number}} encoder A BpeEncoder.
   * @param {Object} [opts] Forwarded to the constructor.
   * @returns {BoostingTrie}
   */
  static buildFromPhrases(entries, encoder, opts = {}) {
    const { encoded, skipped } = encodePhrases(entries, encoder);
    const trie = BoostingTrie.buildFromEncoded(encoded, opts);
    trie.skipped = skipped;
    return trie;
  }

  /**
   * Build a trie from already-encoded entries (token-id sequences). This is the
   * cheap half of {@link buildFromPhrases}: it only inserts, with no BPE work,
   * so the expensive encode can run elsewhere (e.g. a worker) via
   * {@link encodePhrases} and the result handed here. The caller owns `skipped`
   * (set it on the returned trie if needed).
   * @param {Array<{ids: number[], weight?: number, topk?: number}>} encoded
   * @param {Object} [opts] Forwarded to the constructor.
   * @returns {BoostingTrie}
   */
  static buildFromEncoded(encoded, opts = {}) {
    const trie = new BoostingTrie(opts);
    for (const { ids, weight, topk } of encoded) {
      if (!ids || !ids.length) continue;
      trie.insert(ids, weight ?? 1, topk ?? DEFAULT_BOOST_TOPK);
    }
    return trie;
  }

  /**
   * Insert one token-id sequence with a per-phrase weight (negative to
   * penalise). Each node keeps the strongest-magnitude bonus of the phrases
   * passing through it, so shared prefixes get the most committed applicable
   * bonus regardless of sign.
   * @param {number[]} tokenIds
   * @param {number} [weight=1]
   * @param {number} [topk=DEFAULT_BOOST_TOPK] Top-k gate carried with the bonus.
   */
  insert(tokenIds, weight = 1, topk = DEFAULT_BOOST_TOPK) {
    if (topk > this.maxTopk) this.maxTopk = topk;
    let node = this.root;
    for (const id of tokenIds) {
      let child = node.children?.get(id);
      if (!child) {
        child = makeNode(node.depth + 1);
        (node.children ??= new Map()).set(id, child);
      }
      const bonus = weight * (1 + this.depthScaling * (child.depth - 1));
      // The winning (strongest-magnitude) phrase also owns the node's top-k gate,
      // so the bonus and the threshold that gates it come from the same phrase.
      if (Math.abs(bonus) > Math.abs(child.bonus)) {
        child.bonus = bonus;
        child.topk = topk;
      }
      node = child;
    }
    this.size += 1;
  }

  /** Reset active state to the root (call at the start of each decode window). */
  reset() {
    this.active = [this.root];
  }

  /** @returns {boolean} True if any phrase is loaded. */
  get isEmpty() {
    return !this.root.children || this.root.children.size === 0;
  }

  /**
   * Strongest-magnitude boost proposed for token `id` by the current active set,
   * or null if no active node has `id` as a child. If two active nodes propose
   * the same token, the larger-magnitude bonus wins (so a penalty is not masked
   * by a weaker boost on a shared token, or vice versa) and brings its own
   * top-k along. O(|active|) per lookup; the active set is small (root plus the
   * few in-progress phrase nodes), so this stays cheap regardless of list size.
   * @param {number} id
   * @returns {{bonus: number, topk: number}|null}
   */
  childBoostFor(id) {
    let best = null;
    for (const node of this.active) {
      const child = node.children?.get(id);
      if (!child) continue;
      if (best === null || Math.abs(child.bonus) > Math.abs(best.bonus)) {
        best = child;
      }
    }
    return best === null ? null : { bonus: best.bonus, topk: best.topk };
  }

  /**
   * Add the boost rewards into a logit array in place, returning the saved
   * originals so the caller can restore them (keeps confidence/softmax computed
   * on the model's true logits). Returns null when there is nothing to boost.
   *
   * Top-k gating: a candidate token only receives its bonus when its raw logit
   * is already among the model's top-`topk` tokens (the per-phrase gate, default
   * {@link DEFAULT_BOOST_TOPK}). This keeps boosting a ranking nudge rather than
   * a hammer that can force (or, with a penalty, suppress) a token the model
   * itself ranked far away.
   *
   * Rather than enumerate every boostable child (up to vocab-sized for a large
   * list) and discard those outside top-k, we scan the model's top-`maxTopk`
   * tokens once and look each up in the (small) active set: only a top-k token
   * can ever clear the gate, so this is equivalent but costs O(maxTopk *
   * |active|) instead of O(active children), independent of the phrase count.
   * Each candidate is then gated by its own (possibly smaller) `topk` via its
   * rank in the ranked top-k list.
   * @param {Float32Array|number[]} logits
   * @returns {number[]|null} Flat [index, originalValue, ...] pairs, or null.
   */
  applyBoost(logits) {
    if (this.strength === 0 || this.isEmpty) return null;
    const ranked = rankedTopKIds(logits, this.maxTopk); // descending; index = rank
    const saved = [];
    for (let rank = 0; rank < ranked.length; rank++) {
      const id = ranked[rank];
      if (id < 0 || id >= logits.length) continue;
      const boost = this.childBoostFor(id);
      if (boost === null) continue;
      if (rank >= boost.topk) continue; // outside this candidate's own top-k gate
      saved.push(id, logits[id]);
      logits[id] += this.strength * boost.bonus;
    }
    return saved.length ? saved : null;
  }

  /**
   * Restore logits saved by {@link applyBoost}.
   * @param {Float32Array|number[]} logits
   * @param {number[]} saved Flat [index, originalValue, ...] pairs.
   */
  restore(logits, saved) {
    for (let i = 0; i < saved.length; i += 2) logits[saved[i]] = saved[i + 1];
  }

  /**
   * Advance the active set after a non-blank token is emitted. Every active node
   * with `tokenId` as a child moves to that child; non-matching nodes drop out
   * (greedy keeps no alternatives). The root stays active so a new phrase can
   * start on the next token.
   * @param {number} tokenId
   */
  advance(tokenId) {
    const next = [this.root];
    const seen = new Set([this.root]);
    for (const node of this.active) {
      const child = node.children?.get(tokenId);
      if (child && !seen.has(child)) {
        seen.add(child);
        next.push(child);
      }
    }
    this.active = next;
  }
}
