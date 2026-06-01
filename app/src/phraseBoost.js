// Phrase boosting (context biasing) for greedy TDT decoding.
//
// Ports the *concept* of NeMo's GPU-Accelerated Phrase-Boosting (PR #14277) to
// this app's browser greedy decoder: a token-level boosting trie that injects an
// additive, logit-space reward (shallow fusion) for tokens that continue or
// start a user-supplied boost phrase, biasing the per-step argmax toward those
// phrases. Because decoding is greedy (no beam search), boosting is best-effort:
// it nudges each step, but cannot recover a phrase greedy already pruned. The
// scoring is exposed as a pure "boost these candidate logits" call so a future
// beam decoder can reuse the same trie (see PLAN.md Q1).
//
// Reward model (PLAN.md section 3): each trie node at depth d carries
//   nodeBonus = maxPhraseWeight * (1 + DEPTH_SCALING * (d - 1))
// and the applied bonus is `globalStrength * nodeBonus`. Depth scaling rewards
// deeper (more committed) matches more, encouraging phrase completion; it is
// linear and bounded so long phrases cannot blow up the logits.

/** Internal: default linear depth-scaling factor (PLAN.md section 3). */
const DEFAULT_DEPTH_SCALING = 0.5;

/** Maximum accepted per-phrase weight (UI input is clamped/validated to this). */
export const MAX_PHRASE_WEIGHT = 10;

/**
 * Parse a multi-line boost-phrase blob. Each non-empty line is a phrase, with an
 * optional trailing `:WEIGHT` (e.g. `acetaminophen:2.5`). A weight is only
 * recognised when the text after the LAST colon parses as a number, so phrases
 * containing colons (e.g. `ratio 3:1`) keep working unless they end in `:num`.
 * @param {string} raw
 * @returns {Array<{phrase: string, weight: number, warning?: string}>}
 */
export function parseBoostPhrases(raw) {
  if (!raw) return [];
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let phrase = trimmed;
    let weight = 1;
    let warning;
    const colon = trimmed.lastIndexOf(':');
    if (colon > 0 && colon < trimmed.length - 1) {
      const tail = trimmed.slice(colon + 1).trim();
      const parsed = Number(tail);
      if (tail !== '' && Number.isFinite(parsed)) {
        const candidate = trimmed.slice(0, colon).trim();
        if (candidate) {
          phrase = candidate;
          if (parsed <= 0 || parsed > MAX_PHRASE_WEIGHT) {
            warning = `weight ${parsed} out of range (0, ${MAX_PHRASE_WEIGHT}]; using 1`;
            weight = 1;
          } else {
            weight = parsed;
          }
        }
      }
    }
    out.push(warning ? { phrase, weight, warning } : { phrase, weight });
  }
  return out;
}

/** @returns {{children: Map<number, object>, depth: number, bonus: number}} */
function makeNode(depth) {
  return { children: new Map(), depth, bonus: 0 };
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
   * @param {Array<{phrase: string, weight: number}>} entries
   * @param {{encode: (text: string) => number[], unkId?: number}} encoder A BpeEncoder.
   * @param {Object} [opts] Forwarded to the constructor.
   * @returns {BoostingTrie}
   */
  static buildFromPhrases(entries, encoder, opts = {}) {
    const trie = new BoostingTrie(opts);
    const unkId = encoder.unkId;
    for (const { phrase, weight } of entries) {
      const ids = encoder.encode(phrase);
      if (!ids.length) continue;
      if (unkId !== undefined && ids.includes(unkId)) {
        trie.skipped.push(phrase);
        continue;
      }
      trie.insert(ids, weight ?? 1);
    }
    return trie;
  }

  /**
   * Insert one token-id sequence with a per-phrase weight. Each node keeps the
   * max weight of phrases passing through it, so shared prefixes get the
   * strongest applicable bonus.
   * @param {number[]} tokenIds
   * @param {number} [weight=1]
   */
  insert(tokenIds, weight = 1) {
    let node = this.root;
    for (const id of tokenIds) {
      let child = node.children.get(id);
      if (!child) {
        child = makeNode(node.depth + 1);
        node.children.set(id, child);
      }
      const bonus = weight * (1 + this.depthScaling * (child.depth - 1));
      if (bonus > child.bonus) child.bonus = bonus;
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
   * Token-id -> bonus map for the current active set (per-phrase weight x depth
   * scaling, before the global strength multiplier). If two active nodes propose
   * the same token, the larger bonus wins.
   * @returns {Map<number, number>}
   */
  activeChildBoosts() {
    const boosts = new Map();
    for (const node of this.active) {
      for (const [id, child] of node.children) {
        const prev = boosts.get(id);
        if (prev === undefined || child.bonus > prev) boosts.set(id, child.bonus);
      }
    }
    return boosts;
  }

  /**
   * Add the boost rewards into a logit array in place, returning the saved
   * originals so the caller can restore them (keeps confidence/softmax computed
   * on the model's true logits). Returns null when there is nothing to boost.
   * @param {Float32Array|number[]} logits
   * @returns {number[]|null} Flat [index, originalValue, ...] pairs, or null.
   */
  applyBoost(logits) {
    if (this.strength === 0 || this.isEmpty) return null;
    const boosts = this.activeChildBoosts();
    if (boosts.size === 0) return null;
    const saved = [];
    for (const [id, bonus] of boosts) {
      if (id < 0 || id >= logits.length) continue;
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
