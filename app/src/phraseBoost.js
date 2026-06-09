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
// Min-p gating (applyBoost): a candidate token only receives its bonus when the
// model already finds it plausible, measured relatively to the top token by the
// min-p rule borrowed from LLM sampling. A token is eligible iff its probability
// is at least `minp` times the top token's, i.e. (in logit space, with no softmax
// needed) iff `logit >= maxLogit + log(minp)` (per-phrase, default
// DEFAULT_BOOST_MIN_P). Unlike a fixed top-k count this adapts to the per-frame
// entropy: it narrows to the few near-the-max tokens on a confident frame (so a
// strong weight cannot dredge up a token the model itself ranked far down and
// hallucinate the phrase) and widens on a flat/uncertain frame (so a genuinely
// plausible rare term is still boosted, which a fixed rank-25 cut would miss).
// The gate is on the model's own raw logits, so the strength multiplier and
// weight sign do not affect which tokens are eligible.

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
 * Default min-p gate for a phrase (see {@link BoostingTrie#applyBoost}). A phrase
 * token only receives its boost when its probability is at least this fraction of
 * the model's top token for that step, so boosting nudges the ranking without
 * forcing a token the model ranked far down. 0.2 = "at least 20% as likely as the
 * top candidate". Overridable per-phrase via the `:weight:minp` suffix.
 *
 * Tuned to 0.2 from a grid search (NeMo perso benchmark, beam 5, strength 1):
 * versus the looser 0.05, min-p 0.2 best protects off-domain (general French)
 * WER from boost-driven insertions while keeping the in-domain gain, at a
 * negligible CER cost. See the in-repo grid-search benchmark notes.
 */
export const DEFAULT_BOOST_MIN_P = 0.2;

/**
 * The full augmentation set, applied to a phrase that has no explicit `:AUG`
 * field when the global "Augment" toggle is on. `f` = Title Case, `a` = ALL
 * CAPS, `p` = proclitic prefixes (see {@link DEFAULT_PREFIXES}), `h` = strip
 * symbols/separators (see {@link stripSymbols}). The legacy `:i` flag is an
 * alias for this set.
 */
export const FULL_AUGMENT = 'faph';

/**
 * Default proclitic prefixes for the `p` augmentation. A phrase is also boosted
 * with each prefix glued to its front, so a vowel-initial term like
 * `amoxicilline` also matches `l'amoxicilline` / `d'amoxicilline`. This default
 * is the French elision set; a list overrides it with a `#!prefixes ...`
 * directive (e.g. Arabic `al-`, Italian `dell'`). A prefix ending in an
 * apostrophe is an elision and only attaches before a vowel (or `h`); a prefix
 * without one (e.g. `al-`) attaches unconditionally. See {@link augmentVariants}.
 */
export const DEFAULT_PREFIXES = ["l'", "d'", "L'", "D'"];

/** Phrase-initial characters that license an elision prefix (vowels + French silent h, accents included). */
const ELISION_VOWEL_RE = /^[aeiouhàâäéèêëíìîïóòôöúùûüœæ]/i;

/** A run of one or more "symbol" characters (anything that is not a letter, digit, or whitespace). */
const SYMBOL_RE = /[^\p{L}\p{N}\s]+/gu;

/**
 * Strip symbols/separators from a surface form for the `h` augmentation:
 * every run of non-letter, non-digit, non-space characters becomes a single
 * space, then whitespace is collapsed and trimmed. So `alpha-methyl` ->
 * `alpha methyl` and `co-trimoxazole/IV` -> `co trimoxazole IV`. The model
 * transcribes such compounds as separate spoken words, so the space form is the
 * one it actually emits. Returns the input unchanged when it has no symbols (the
 * caller dedupes, so a no-op variant is harmless).
 * @param {string} s
 * @returns {string}
 */
function stripSymbols(s) {
  return s.replace(SYMBOL_RE, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a trailing augmentation field (the `:AUG` suffix) to a canonical
 * flag string, or `undefined` when the field is not an augmentation token (so
 * the caller leaves it as part of the phrase). Accepts any combination of:
 *   - `f` Title Case, `a` ALL CAPS, `p` proclitic prefixes, `h` strip symbols,
 *   - `s` (legacy) = force none / opt out -> `''`,
 *   - `i` (legacy) = all of them -> {@link FULL_AUGMENT}.
 * `s` anywhere wins as the explicit opt-out; `i` expands to the full set. The
 * result is always a subset of `'faph'` in canonical `f`,`a`,`p`,`h` order (or `''`).
 * @param {string} tag The raw field text (already split off after the last `:`).
 * @returns {string|undefined}
 */
function normalizeAugment(tag) {
  const t = tag.trim().toLowerCase();
  if (!t || !/^[sifaph]+$/.test(t)) return undefined;
  if (t.includes('s')) return ''; // explicit opt-out wins
  const full = t.includes('i');
  let flags = '';
  if (full || t.includes('f')) flags += 'f';
  if (full || t.includes('a')) flags += 'a';
  if (full || t.includes('p')) flags += 'p';
  if (full || t.includes('h')) flags += 'h';
  return flags;
}

/**
 * Peel the last `:`-delimited field off `text` for the weight/top-k parser.
 * Returns `{ head, value }` for a numeric field, `{ head, empty: true }` for an
 * empty field (e.g. the `::` in `word::25`, meaning "use the default"), or null
 * when there is no field to peel: no colon, an empty head (so `:0.5` stays a
 * phrase), or a non-numeric non-empty tail (so `ratio 3:1` peels but `bad:abc`
 * does not). `head` is trimmed.
 * @param {string} text
 * @returns {{head: string, value?: number, empty?: boolean}|null}
 */
function peelValueField(text) {
  const colon = text.lastIndexOf(':');
  if (colon <= 0) return null; // no colon, or empty head (keep ":x" as a phrase)
  const head = text.slice(0, colon).trim();
  const tail = text.slice(colon + 1).trim();
  if (tail === '') return { head, empty: true };
  const value = Number(tail);
  if (!Number.isFinite(value)) return null; // non-numeric tail belongs to the phrase
  return { head, value };
}

/**
 * Split one phrase line into its fields: `phrase[:WEIGHT[:MINP[:AUG]]]`. Fields
 * are peeled right-to-left and the phrase keeps any colons it contains (only a
 * trailing field of the right shape is consumed), so e.g. `ratio 3:1` and
 * `bad:abc` still work. Details:
 *   - An absent or empty numeric field is returned as `undefined` so the caller
 *     can fall back to its running default (the list's `*` defaults line, then
 *     the built-in 1 / {@link DEFAULT_BOOST_MIN_P}): `word::0.1` -> weight
 *     undefined + min-p 0.1; `word:5` -> weight 5 + min-p undefined.
 *   - The optional trailing `:AUG` augmentation field sets per-phrase surface-form
 *     expansion: any mix of `f` (Title Case), `a` (ALL CAPS), `p` (proclitic
 *     prefixes), `h` (strip symbols), plus the legacy aliases `s` (force none)
 *     and `i` (all of them). It must be the last field; absent leaves `augment`
 *     undefined so the caller's running default / global toggle applies. See
 *     {@link normalizeAugment}.
 * Returns RAW, unvalidated weight/minp (callers clamp/warn as they like), each
 * `undefined` when its field was absent or empty.
 * @param {string} text A single phrase line (leading/trailing space tolerated).
 * @returns {{phrase: string, weight: (number|undefined), minp: (number|undefined), augment: (string|undefined)}}
 */
export function parseBoostFields(text) {
  let phrase = text.trim();
  let weight;
  let minp;
  let augment;

  // 1. Optional trailing augmentation field (:f/:a/:p/:h/:s/:i), last field only.
  const flagColon = phrase.lastIndexOf(':');
  if (flagColon > 0) {
    const norm = normalizeAugment(phrase.slice(flagColon + 1));
    if (norm !== undefined) {
      augment = norm;
      phrase = phrase.slice(0, flagColon).trim();
    }
  }

  // 2. Optional :WEIGHT then :WEIGHT:MINP, peeled right-to-left. An empty field
  //    stays undefined (the caller fills the running default).
  const last = peelValueField(phrase);
  if (last) {
    const prev = peelValueField(last.head);
    if (prev) {
      // phrase:WEIGHT:MINP  (prev = weight, last = minp)
      phrase = prev.head;
      if (!prev.empty) weight = prev.value;
      if (!last.empty) minp = last.value;
    } else {
      // phrase:WEIGHT
      phrase = last.head;
      if (!last.empty) weight = last.value;
    }
  }
  return { phrase, weight, minp, augment };
}

/**
 * Marker that turns a line into a list-level directive instead of a phrase. A
 * line whose trimmed text starts with this prefix is consumed by
 * {@link parseBoostDirectives} and skipped by {@link parseBoostPhrases}, so it
 * never becomes a boost phrase. The prefix is reserved: an unrecognised
 * directive key is silently ignored, which also lets `#! free text` double as a
 * list-level comment.
 */
const DIRECTIVE_PREFIX = '#!';

/**
 * Whether an already-trimmed line is a `#!` directive rather than a phrase.
 * Single source of truth so {@link parseBoostPhrases} (skip), the CLI's
 * `parseCliBoosts` (skip) and {@link parseBoostDirectives} (collect) agree on
 * what counts as a directive.
 * @param {string} trimmed A line already passed through `.trim()`.
 * @returns {boolean}
 */
export function isDirectiveLine(trimmed) {
  return trimmed.startsWith(DIRECTIVE_PREFIX);
}

/**
 * Parse list-level `#!key value` directive lines out of a boost blob. Directives
 * configure the list as a whole rather than a single phrase, and live in the
 * same .txt so a curated list ships self-contained. Recognised keys:
 *   - `prefixes a' b' ...` : the proclitic prefixes used by the `p` augmentation
 *     (whitespace-separated), overriding {@link DEFAULT_PREFIXES} for this list.
 *     This is the one list-level setting that has no per-phrase field, so it
 *     stays a directive (default weight / top-k / augmentation are instead set
 *     by a `*` defaults line, see {@link resolveBoostLines}).
 * The key is matched case-insensitively and separated from its value by
 * whitespace, `=` or `:` (so `#!prefixes a b`, `#!prefixes=a b` all work).
 * Unknown keys are ignored, so `#! a note` is a harmless no-op. When a key
 * appears more than once the last occurrence wins.
 * @param {string} raw
 * @returns {{prefixes?: string[]}}
 */
export function parseBoostDirectives(raw) {
  const out = {};
  if (!raw) return out;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!isDirectiveLine(trimmed)) continue;
    const body = trimmed.slice(DIRECTIVE_PREFIX.length).trim();
    const m = body.match(/^(\S+?)[\s=:]+(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'prefixes') {
      const list = value.split(/\s+/).filter(Boolean);
      if (list.length) out.prefixes = list;
    }
  }
  return out;
}

/**
 * The sentinel "phrase" that marks a defaults line. A line whose trimmed text is
 * exactly `*` or starts with `*:` is a {@link parseDefaultsLine} directive, not a
 * boost phrase (so a literal `*` cannot itself be boosted, an accepted trade).
 * @param {string} trimmed A line already passed through `.trim()`.
 * @returns {boolean}
 */
export function isDefaultsLine(trimmed) {
  return trimmed === '*' || trimmed.startsWith('*:');
}

/** A weight is a usable per-phrase weight: finite, nonzero, within bounds. */
function isValidWeight(w) {
  return Number.isFinite(w) && w !== 0 && w >= -MAX_PHRASE_WEIGHT && w <= MAX_PHRASE_WEIGHT;
}
/** A min-p gate is usable: a number in the half-open range (0, 1]. */
function isValidMinP(p) {
  return Number.isFinite(p) && p > 0 && p <= 1;
}

/**
 * Parse a `*` defaults line into the field values it sets. Unlike a phrase, the
 * `*` line is purely positional (`*:WEIGHT:MINP:AUG`) with no embedded phrase, so
 * it is split left-to-right and trailing empty fields are unambiguous: each empty
 * field simply leaves that default unchanged. Returns only the fields the line
 * actually sets (a malformed value is dropped). See {@link resolveBoostLines}.
 * @param {string} trimmed A line for which {@link isDefaultsLine} is true.
 * @returns {{weight?: number, minp?: number, augment?: string}}
 */
function parseDefaultsLine(trimmed) {
  const out = {};
  const rest = trimmed.slice(1); // drop the leading '*'
  if (rest === '' || rest[0] !== ':') return out; // '*' alone: no changes
  const segs = rest.slice(1).split(':'); // [WEIGHT, MINP, AUG, ...]
  const wRaw = (segs[0] ?? '').trim();
  const pRaw = (segs[1] ?? '').trim();
  const aRaw = (segs[2] ?? '').trim();
  if (wRaw !== '') { const w = Number(wRaw); if (Number.isFinite(w)) out.weight = w; }
  if (pRaw !== '') { const p = Number(pRaw); if (Number.isFinite(p)) out.minp = p; }
  if (aRaw !== '') { const a = normalizeAugment(aRaw); if (a !== undefined) out.augment = a; }
  return out;
}

/**
 * Resolve an ordered list of phrase-field objects against the list's `*` defaults
 * lines, the shared core behind both {@link parseBoostPhrases} (web) and the
 * CLI's `parseCliBoosts`. A `*` line (`*:WEIGHT:MINP:AUG`) sets the running
 * default weight / min-p / augmentation for every phrase that follows it, until
 * the next `*` line changes it; each empty field leaves that default unchanged.
 * A phrase's own field still wins over the running default. This is what lets a
 * list set its strength as a default weight (`*:2` at the top) and its
 * augmentation (`*:::fhp`) without any `#!` directive. A `*` field with an
 * out-of-range value is ignored (the prior default stands) so a bad defaults
 * line cannot poison every following phrase with warnings.
 *
 * Augmentation/weight/min-p that are still undefined after this (no phrase field
 * and no active `*` default) are left undefined for the caller to fill with the
 * built-in base (weight 1, min-p {@link DEFAULT_BOOST_MIN_P}) or, for augment, the
 * global toggle. `*`-sourced defaults are pre-validated (a `*` field out of range
 * is ignored, the prior default stands); a phrase's own RAW field is passed
 * through unvalidated so the caller can clamp + warn on it.
 *
 * Takes RAW lines (not pre-parsed) because a `*` line must be read from the raw
 * text: {@link parseBoostFields} cannot parse a `*` line with trailing empty
 * fields (e.g. `*:2::` peels to the phrase `*:2`). Empty / `#!` lines are skipped
 * defensively.
 * @param {string[]} lines One raw line per element, in order.
 * @returns {Array<{phrase: string, weight: (number|undefined), minp: (number|undefined), augment?: string}>}
 *   One entry per phrase line (the `*` lines are consumed), in order.
 */
export function resolveBoostLines(lines) {
  const out = [];
  let defWeight, defMinP, defAugment; // undefined => fall through to base/global
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || isDirectiveLine(trimmed)) continue;
    if (isDefaultsLine(trimmed)) {
      const d = parseDefaultsLine(trimmed);
      if (d.weight !== undefined && isValidWeight(d.weight)) defWeight = d.weight;
      if (d.minp !== undefined && isValidMinP(d.minp)) defMinP = d.minp;
      if (d.augment !== undefined) defAugment = d.augment;
      continue;
    }
    const f = parseBoostFields(trimmed);
    const entry = { phrase: f.phrase, weight: f.weight ?? defWeight, minp: f.minp ?? defMinP };
    const augment = f.augment ?? defAugment;
    if (augment !== undefined) entry.augment = augment;
    out.push(entry);
  }
  return out;
}

/**
 * Parse a multi-line boost-phrase blob. Each non-empty line is a phrase with up
 * to three optional trailing fields, `phrase:WEIGHT:MINP:AUG`, all peeled
 * right-to-left by {@link parseBoostFields} (e.g. `acetaminophen:2.5`, `um:-3`,
 * `venlafaxine:5:0.1`, `venlafaxine:5:0.1:fap`, `epi::0.02:s`). An empty numeric
 * field falls back to the running default; the trailing `:AUG` field overrides
 * the per-phrase augmentation (see {@link normalizeAugment}). A negative weight
 * is written with the minus sign after the colon (`phrase:-3`).
 *
 * A `*:WEIGHT:MINP:AUG` line is a defaults line (see {@link resolveBoostLines}):
 * it sets the default weight / min-p / augmentation for every following phrase
 * (so `*:2` makes the rest of the list weight 2, `*:::fhp` augments the rest),
 * and is consumed here rather than emitted. Lines starting with `#!` are
 * list-level directives (see {@link parseBoostDirectives}) and are likewise
 * skipped. After defaults are resolved, any phrase still lacking a weight/min-p
 * gets the built-in base (1 / {@link DEFAULT_BOOST_MIN_P}); this then
 * validates/clamps and records a per-entry `warning` for anything it coerced.
 * @param {string} raw
 * @returns {Array<{phrase: string, weight: number, minp: number, augment?: string, warning?: string}>}
 */
export function parseBoostPhrases(raw) {
  if (!raw) return [];
  const out = [];
  for (const { phrase, weight, minp, augment } of resolveBoostLines(raw.split(/\r?\n/))) {
    const warnings = [];
    let w = weight ?? 1;
    let p = minp ?? DEFAULT_BOOST_MIN_P;

    if (w === 0 || w < -MAX_PHRASE_WEIGHT || w > MAX_PHRASE_WEIGHT) {
      warnings.push(`weight ${w} out of range [-${MAX_PHRASE_WEIGHT}, ${MAX_PHRASE_WEIGHT}] (nonzero); using 1`);
      w = 1;
    }
    if (!isValidMinP(p)) {
      warnings.push(`min-p ${p} invalid (number in (0, 1]); using ${DEFAULT_BOOST_MIN_P}`);
      p = DEFAULT_BOOST_MIN_P;
    }

    const entry = { phrase, weight: w, minp: p };
    if (augment !== undefined) entry.augment = augment;
    if (warnings.length) entry.warning = warnings.join('; ');
    out.push(entry);
  }
  return out;
}

/**
 * Find phrases that appear more than once with *actively incompatible* boost
 * settings: the same phrase text mapped to two different effective boosts (a
 * different weight or a different min-p gate). This is deliberately NOT a plain
 * duplicate check: repeating a line verbatim (same phrase, same weight AND
 * min-p, even with a different `:AUG` flag, since augmentation only widens the
 * surface forms and never contradicts the boost) is harmless and ignored. Only
 * a genuine contradiction (e.g. `venlafaxine:5` and `venlafaxine:-5`, where one
 * boosts and the other penalises the same term) is reported.
 *
 * Single source of truth for both surfaces: the web UI shows these as a
 * non-fatal warning (a hand-editing user is nudged to fix the list), while the
 * compile step ({@link compileBoostText}) hard-fails on a non-empty result so an
 * admin cannot ship an inconsistent curated list.
 * @param {Array<{phrase: string, weight: number, minp: number}>} entries
 *   Parsed entries with concrete weight/min-p (e.g. {@link parseBoostPhrases} output).
 * @returns {Array<{phrase: string, settings: Array<{weight: number, minp: number}>}>}
 *   One entry per conflicting phrase, with the distinct (weight, min-p) settings
 *   it was given (in first-seen order); empty when the list is consistent.
 */
export function findBoostConflicts(entries) {
  const byPhrase = new Map();
  for (const { phrase, weight, minp } of entries) {
    if (!phrase) continue;
    let settings = byPhrase.get(phrase);
    if (!settings) { settings = new Map(); byPhrase.set(phrase, settings); }
    const key = `${weight} ${minp}`;
    if (!settings.has(key)) settings.set(key, { weight, minp });
  }
  const conflicts = [];
  for (const [phrase, settings] of byPhrase) {
    if (settings.size > 1) conflicts.push({ phrase, settings: [...settings.values()] });
  }
  return conflicts;
}

/**
 * Render one {@link findBoostConflicts} entry as a human-readable line. Reports
 * the conflicting weights when those differ (the common case, e.g. a sign flip),
 * otherwise the conflicting min-p gates. Shared by the UI warning and the
 * compile-step error so the wording stays identical.
 * @param {{phrase: string, settings: Array<{weight: number, minp: number}>}} conflict
 * @returns {string}
 */
export function formatBoostConflict(conflict) {
  const { phrase, settings } = conflict;
  const weights = [...new Set(settings.map((s) => s.weight))];
  if (weights.length > 1) {
    return `"${phrase}" given conflicting weights (${weights.join(', ')})`;
  }
  const minps = [...new Set(settings.map((s) => s.minp))];
  return `"${phrase}" given conflicting min-p gates (${minps.join(', ')})`;
}

/**
 * Whether a proclitic `prefix` may attach to `form`. A prefix ending in an
 * apostrophe (straight `'` or curly `’`) is an elision and only attaches before
 * a vowel or French silent `h` (so `l'amoxicilline` but never `l'beta`); any
 * other prefix (e.g. Arabic `al-`) attaches unconditionally.
 * @param {string} prefix
 * @param {string} form
 * @returns {boolean}
 */
function prefixApplies(prefix, form) {
  const last = prefix[prefix.length - 1];
  if (last !== "'" && last !== '’') return true;
  return ELISION_VOWEL_RE.test(form);
}

/**
 * Surface-form variants of a phrase under an augmentation flag set. The as-typed
 * form is always included; then `f` adds Title Case (each space-separated word's
 * first letter capitalised), `a` adds ALL CAPS, `h` adds a symbol-stripped form
 * of every variant so far (see {@link stripSymbols}, so `alpha-methyl` also
 * yields `alpha methyl`), and `p` glues each applicable proclitic prefix (see
 * {@link prefixApplies}) to the front of every form so far. `h` runs before `p`
 * so prefixes also attach to the symbol-stripped forms. Surrogate-safe;
 * deduplicated with the as-typed form first. The BPE encoder is case-sensitive,
 * so each distinct surface form must be its own trie branch.
 * @param {string} phrase
 * @param {string} [flags=''] Any subset of `'faph'` (see {@link normalizeAugment}).
 * @param {string[]} [prefixes=DEFAULT_PREFIXES] Proclitic prefixes for the `p` flag.
 * @returns {string[]}
 */
export function augmentVariants(phrase, flags = '', prefixes = DEFAULT_PREFIXES) {
  if (!phrase) return [];
  const capFirst = (s) => {
    const chars = Array.from(s); // codepoints (surrogate-safe)
    if (!chars.length) return s;
    chars[0] = chars[0].toUpperCase();
    return chars.join('');
  };
  const set = new Set(flags);
  const seen = new Set();
  const out = [];
  const push = (v) => { if (v && !seen.has(v)) { seen.add(v); out.push(v); } };
  push(phrase);                                          // as typed
  if (set.has('f')) push(phrase.split(' ').map(capFirst).join(' ')); // Title Case
  if (set.has('a')) push(phrase.toUpperCase());          // ALL CAPS
  if (set.has('h')) {
    for (const form of out.slice()) push(stripSymbols(form)); // symbol-stripped of every casing form
  }
  if (set.has('p') && prefixes && prefixes.length) {
    for (const form of out.slice()) {                    // every form so far (incl. symbol-stripped)
      for (const pre of prefixes) {
        if (prefixApplies(pre, form)) push(pre + form);
      }
    }
  }
  return out;
}

/**
 * Expand parsed boost entries so each typed phrase covers every surface form the
 * model might emit (see {@link augmentVariants}). The BPE encoder is
 * case-sensitive, so `venlafaxine`, `Venlafaxine` and `VENLAFAXINE` encode to
 * different token sequences and must each be their own trie branch; this turns
 * one typed phrase into one entry per augmentation variant.
 *
 * Which flags apply is decided per phrase: its own `augment` field (the `:AUG`
 * suffix) wins, falling back to `defaultAugment` (the UI's global "Augment"
 * toggle) when the entry has none. An entry whose effective flags are empty
 * (`''`) passes through unchanged. Deduplicated across the whole list by phrase
 * string; on a collision the larger-magnitude weight wins (matching the trie's
 * strongest-magnitude rule) and carries its own min-p.
 * @param {Array<{phrase: string, weight: number, minp?: number, augment?: string}>} entries
 * @param {string} [defaultAugment=''] Flags applied to entries with no `:AUG` field.
 * @param {string[]} [prefixes=DEFAULT_PREFIXES] Proclitic prefixes for the `p` flag.
 * @returns {Array<{phrase: string, weight: number, minp?: number}>}
 */
export function expandAugmentations(entries, defaultAugment = '', prefixes = DEFAULT_PREFIXES) {
  const byPhrase = new Map();
  const add = (entry, phrase) => {
    const prev = byPhrase.get(phrase);
    if (!prev || Math.abs(entry.weight) > Math.abs(prev.weight)) {
      byPhrase.set(phrase, { ...entry, phrase });
    }
  };
  for (const entry of entries) {
    const flags = entry.augment ?? defaultAugment;
    if (flags) {
      for (const phrase of augmentVariants(entry.phrase, flags, prefixes)) add(entry, phrase);
    } else {
      add(entry, entry.phrase);
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
 *
 * Optional `opts.cache` memoizes the encode by surface form (the variant
 * string), so a rebuild after a hand-edit only BPE-encodes the variants that
 * actually changed. The cache key is the full variant string, which already
 * bakes in every casing/prefix/strip augmentation and the list's `*` defaults,
 * so a directive edit that alters a phrase's variants simply produces new keys
 * (a miss) for the changed forms and reuses the rest, no diffing required.
 * Removed phrases just stop being looked up. The cached `ids` are returned by
 * reference (read-only by callers; {@link BoostingTrie.insert} only reads them),
 * and index the encoder's vocab, so the owner (the worker) MUST drop the cache
 * when the encoder/vocab changes. Pass none and the function is unchanged.
 * @param {Array<{phrase: string, weight: number, minp?: number}>} entries
 * @param {{encode: (text: string) => number[], unkId?: number}} encoder A BpeEncoder.
 * @param {Object} [opts]
 * @param {Map<string, number[]>} [opts.cache] Surface-form -> ids memo, persisted by the caller across rebuilds.
 * @returns {{encoded: Array<{ids: number[], weight: number, minp?: number}>, skipped: string[]}}
 */
export function encodePhrases(entries, encoder, opts = {}) {
  const unkId = encoder.unkId;
  const cache = opts.cache;
  const encoded = [];
  const skipped = [];
  for (const { phrase, weight, minp } of entries) {
    let ids = cache?.get(phrase);
    if (ids === undefined) {
      ids = encoder.encode(phrase);
      cache?.set(phrase, ids);
    }
    if (!ids.length) continue;
    if (unkId !== undefined && ids.includes(unkId)) {
      skipped.push(phrase);
      continue;
    }
    encoded.push({ ids, weight, minp });
  }
  return { encoded, skipped };
}

/**
 * Decide whether a server-prebuilt boost encoding can be reused as-is instead of
 * BPE-encoding the phrase list in the browser. This is the gate that lets the
 * reload/restore path skip both the encode (the slow BPE merge loop) *and* the
 * main-thread casing expansion: the prebuilt already bakes both in, so when this
 * returns `usePrebuilt: true` the caller must not re-parse/re-expand the list
 * (doing so blocks the UI for seconds on a large case-insensitive list).
 *
 * Reuse is valid only when all three agree:
 *  - the list text is unedited (matches what the prebuilt was built from),
 *  - the vocab signature the prebuilt was built for matches the loaded model,
 *  - the global augmentation default matches the prebuilt's baked-in
 *    `augmentDefault` (legacy artifacts omit it, so a missing value is treated
 *    as `''`, i.e. un-augmented).
 *
 * @param {{text: string, vocabSig: string, augmentDefault?: string, encoded: Array}|null} prebuilt
 *   The loaded prebuilt encoding, or null/undefined when none is available.
 * @param {{text: string, vocabSig: string|null, augmentDefault: string}} current
 *   The current UI state to validate the prebuilt against.
 * @returns {{usePrebuilt: boolean, reasons: string[]}} `reasons` is empty when
 *   the prebuilt is used (or absent); otherwise it lists each mismatch in
 *   developer-facing wording (for the verbose log), since that is the line
 *   between a fast prebuilt rebuild and a slow from-scratch re-encode.
 */
export function selectPrebuilt(prebuilt, current) {
  if (!prebuilt) return { usePrebuilt: false, reasons: [] };
  const { text, vocabSig, augmentDefault } = current;
  const reasons = [];
  if (prebuilt.text !== text) {
    reasons.push('list text was edited (no longer matches the prebuilt)');
  }
  if (prebuilt.vocabSig !== vocabSig) {
    reasons.push(`vocab mismatch (prebuilt for ${prebuilt.vocabSig}, model is ${vocabSig})`);
  }
  if ((prebuilt.augmentDefault ?? '') !== augmentDefault) {
    reasons.push(`augment default differs (prebuilt at augmentDefault="${prebuilt.augmentDefault ?? ''}", UI is "${augmentDefault}")`);
  }
  return { usePrebuilt: reasons.length === 0, reasons };
}

/**
 * Trie node. `children` is created lazily (null until the first child is
 * inserted) so the many leaf nodes of a large list do not each carry an empty
 * Map; readers must treat a null `children` as "no children".
 * @returns {{children: Map<number, object>|null, depth: number, bonus: number, minp: number}}
 */
function makeNode(depth) {
  return { children: null, depth, bonus: 0, minp: DEFAULT_BOOST_MIN_P };
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
     * Smallest (most permissive) per-phrase min-p gate inserted so far. No token
     * below `maxLogit + log(minMinp)` can clear ANY per-phrase gate, so
     * {@link applyBoost} uses this as a single cheap floor to skip the active-set
     * lookup for every token the most lenient phrase would still reject; each
     * surviving candidate is then re-checked against its own (possibly larger)
     * `minp`. Starts at 1 (the strictest) and only ever drops as phrases insert.
     */
    this.minMinp = 1;
    /**
     * Optional global min-p override (a number in (0, 1], or null to disable).
     * When set, {@link applyBoost} uses it as the gate for EVERY candidate,
     * superseding each phrase's own baked `minp` and the `minMinp` floor. This is
     * a decode-time knob for sweeping the gate (e.g. the grid-search benchmark
     * probing several min-p values against one prebuilt trie) without rebuilding
     * the trie per value; the web app leaves it null and relies on per-phrase
     * min-p. Set directly on the trie instance before decoding.
     * @type {number|null}
     */
    this.minpOverride = opts.minpOverride ?? null;
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
   * @param {Array<{phrase: string, weight: number, minp?: number}>} entries
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
   * @param {Array<{ids: number[], weight?: number, minp?: number}>} encoded
   * @param {Object} [opts] Forwarded to the constructor.
   * @returns {BoostingTrie}
   */
  static buildFromEncoded(encoded, opts = {}) {
    const trie = new BoostingTrie(opts);
    for (const { ids, weight, minp } of encoded) {
      if (!ids || !ids.length) continue;
      trie.insert(ids, weight ?? 1, minp ?? DEFAULT_BOOST_MIN_P);
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
   * @param {number} [minp=DEFAULT_BOOST_MIN_P] Min-p gate carried with the bonus.
   */
  insert(tokenIds, weight = 1, minp = DEFAULT_BOOST_MIN_P) {
    if (minp < this.minMinp) this.minMinp = minp;
    let node = this.root;
    for (const id of tokenIds) {
      let child = node.children?.get(id);
      if (!child) {
        child = makeNode(node.depth + 1);
        (node.children ??= new Map()).set(id, child);
      }
      const bonus = weight * (1 + this.depthScaling * (child.depth - 1));
      // The winning (strongest-magnitude) phrase also owns the node's min-p gate,
      // so the bonus and the threshold that gates it come from the same phrase.
      if (Math.abs(bonus) > Math.abs(child.bonus)) {
        child.bonus = bonus;
        child.minp = minp;
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
   * min-p along. O(|active|) per lookup; the active set is small (root plus the
   * few in-progress phrase nodes), so this stays cheap regardless of list size.
   * @param {number} id
   * @returns {{bonus: number, minp: number}|null}
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
    return best === null ? null : { bonus: best.bonus, minp: best.minp };
  }

  /**
   * Add the boost rewards into a logit array in place, returning the saved
   * originals so the caller can restore them (keeps confidence/softmax computed
   * on the model's true logits). Returns null when there is nothing to boost.
   *
   * Min-p gating: a candidate token only receives its bonus when its probability
   * is at least `minp` times the model's top token for that step (the per-phrase
   * gate, default {@link DEFAULT_BOOST_MIN_P}). In logit space that is just
   * `logit >= maxLogit + log(minp)`, so no softmax is needed: the additive log of
   * the ratio is the gap below the max. This keeps boosting a ranking nudge rather
   * than a hammer that can force (or, with a penalty, suppress) a token the model
   * itself ranked far away, and unlike a fixed top-k it adapts to the per-frame
   * entropy (tight near a confident max, wide on a flat/uncertain frame).
   *
   * Cost: one O(V) pass for `maxLogit`, then one O(V) pass that skips, with a
   * single comparison against the most permissive floor (`maxLogit +
   * log(minMinp)`), every token no phrase could ever gate in; only the survivors
   * (few on a realistic frame) pay the O(|active|) active-set lookup and are
   * re-checked against their own (possibly stricter) `minp`. This is independent
   * of the phrase count.
   * @param {Float32Array|number[]} logits
   * @returns {number[]|null} Flat [index, originalValue, ...] pairs, or null.
   */
  applyBoost(logits) {
    if (this.strength === 0 || this.isEmpty) return null;
    const n = logits.length;
    let maxLogit = -Infinity;
    for (let i = 0; i < n; i++) if (logits[i] > maxLogit) maxLogit = logits[i];
    // A global override (a benchmark/sweep knob) supersedes every per-phrase
    // min-p, including the floor; otherwise each candidate uses its own min-p
    // and the floor is the most permissive one inserted. No token below the
    // floor can clear any gate, so it skips the active-set lookup cheaply.
    const override = this.minpOverride;
    const floor = maxLogit + Math.log(override ?? this.minMinp);
    const saved = [];
    for (let id = 0; id < n; id++) {
      if (logits[id] < floor) continue; // below every gate; skip the lookup
      const boost = this.childBoostFor(id);
      if (boost === null) continue;
      if (logits[id] < maxLogit + Math.log(override ?? boost.minp)) continue; // below the effective min-p
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
