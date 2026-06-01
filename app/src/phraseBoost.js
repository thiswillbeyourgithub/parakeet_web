// Phrase boosting (context biasing) for greedy TDT decoding.
//
// Ports the *concept* of NeMo's GPU-Accelerated Phrase-Boosting (PR #14277) to
// this app's browser greedy decoder: a token-level boosting trie that injects an
// additive, logit-space reward (shallow fusion) for tokens that continue or
// start a user-supplied phrase, biasing the per-step argmax toward (positive
// weight) or away from (negative weight) those phrases. Because decoding is
// greedy (no beam search), boosting is best-effort: it nudges each step, but
// cannot recover a phrase greedy already pruned. The scoring is exposed as a
// pure "boost these candidate logits" call so a future beam decoder can reuse
// the same trie (see PLAN.md Q1).
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
function peelTrailingNumber(text) {
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
 * Value of the `k`-th largest element of `logits` (1-indexed): the inclusion
 * threshold for "top-k", so an element is in the top-k iff its value is >= this.
 * Returns -Infinity when `k >= logits.length` (everything qualifies, i.e. the
 * gate is effectively off). O(V*k) worst case with an early-out, cheap for the
 * small k used by boost gating.
 * @param {Float32Array|number[]} logits
 * @param {number} k
 * @returns {number}
 */
function kthLargestValue(logits, k) {
  const n = logits.length;
  if (k >= n) return -Infinity;
  const top = new Float64Array(k).fill(-Infinity); // ascending; top[0] = threshold
  for (let i = 0; i < n; i++) {
    const v = logits[i];
    if (v <= top[0]) continue;
    let j = 1;
    while (j < k && top[j] < v) { top[j - 1] = top[j]; j++; }
    top[j - 1] = v;
  }
  return top[0];
}

/** @returns {{children: Map<number, object>, depth: number, bonus: number, topk: number}} */
function makeNode(depth) {
  return { children: new Map(), depth, bonus: 0, topk: DEFAULT_BOOST_TOPK };
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
    const trie = new BoostingTrie(opts);
    const unkId = encoder.unkId;
    for (const { phrase, weight, topk } of entries) {
      const ids = encoder.encode(phrase);
      if (!ids.length) continue;
      if (unkId !== undefined && ids.includes(unkId)) {
        trie.skipped.push(phrase);
        continue;
      }
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
    let node = this.root;
    for (const id of tokenIds) {
      let child = node.children.get(id);
      if (!child) {
        child = makeNode(node.depth + 1);
        node.children.set(id, child);
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
    return this.root.children.size === 0;
  }

  /**
   * Token-id -> `{bonus, topk}` map for the current active set (per-phrase weight
   * x depth scaling, before the global strength multiplier; plus the top-k gate
   * carried with that bonus). If two active nodes propose the same token, the
   * larger-magnitude bonus wins (so a penalty is not masked by a weaker boost on
   * a shared token, or vice versa) and brings its own top-k along.
   * @returns {Map<number, {bonus: number, topk: number}>}
   */
  activeChildBoosts() {
    const boosts = new Map();
    for (const node of this.active) {
      for (const [id, child] of node.children) {
        const prev = boosts.get(id);
        if (prev === undefined || Math.abs(child.bonus) > Math.abs(prev.bonus)) {
          boosts.set(id, { bonus: child.bonus, topk: child.topk });
        }
      }
    }
    return boosts;
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
   * itself ranked far away. The threshold is the topk-th largest raw logit,
   * computed once per distinct topk value across the active candidates.
   * @param {Float32Array|number[]} logits
   * @returns {number[]|null} Flat [index, originalValue, ...] pairs, or null.
   */
  applyBoost(logits) {
    if (this.strength === 0 || this.isEmpty) return null;
    const boosts = this.activeChildBoosts();
    if (boosts.size === 0) return null;
    const thresholds = new Map();
    for (const { topk } of boosts.values()) {
      if (!thresholds.has(topk)) thresholds.set(topk, kthLargestValue(logits, topk));
    }
    const saved = [];
    for (const [id, { bonus, topk }] of boosts) {
      if (id < 0 || id >= logits.length) continue;
      if (logits[id] < thresholds.get(topk)) continue; // outside top-k: gated out
      saved.push(id, logits[id]);
      logits[id] += this.strength * bonus;
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
      const child = node.children.get(tokenId);
      if (child && !seen.has(child)) {
        seen.add(child);
        next.push(child);
      }
    }
    this.active = next;
  }
}
