// Drug-name fix rules: regexes learned from the drug-name errors of the
// UltiMed and parakeet-ultra models ("l'ananas de l'umab" -> "lanadelumab").
//
// Two stages, so the browser does as little as possible:
//  - BUILD (compileDrugRuleSource, run by scripts/compile-drug-rules.mjs):
//    the model repo's drug_fix_rules.jsonl becomes the committed
//    public/drug-rules/drug_rules.json, keeping only [pattern, replacement]
//    per rule plus a prebuilt anchor index and the SHA-256 of its source
//    (which deploy.sh checks against the model repo).
//  - RUNTIME (loadDrugRules + applyDrugRules): parse that JSON and build each
//    RegExp only the first time a text contains its anchor, since most rules
//    never fire for a given speaker.
//
// The reference semantics are "every rule, in file order, on the whole text"
// (applyDrugRulesNaive, ~20 ms per text). applyDrugRules runs the same rules
// through the anchor index: a rule only runs when its anchor (the longest
// accent-folded word of a variant it fixes) is one of the text's words.
// Same output, ~140x faster. Port of compile_rules() from the rule builder
// (UltiMed-ASR-FR-v1-scripts, 08_drug_asr_rules/02_build_fix_rules.py).
//
// Kept free of DOM/React so all of it is unit-testable
// (test/unit/drug-rules.test.mjs).
//
// Built with Claude Code.

// Word characters as the rules' own lookarounds spell them (the patterns
// avoid \w, which is ASCII-only in JavaScript).
const TOKEN_SPLIT = /[^0-9A-Za-z_À-ÖØ-öø-ɏ]+/u;
// Same controls/bidi overrides the dictation layer refuses: the output can
// land in the system clipboard (auto-copy), so a tampered rule file must not
// be able to smuggle terminal escape sequences into a paste.
const UNSAFE_REPLACEMENT = /[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/;

/** Where the app serves the compiled rules (app/ui/public/drug-rules/). */
export const DRUG_RULES_URL = '/drug-rules/drug_rules.json';
/** Fetch cap: the compiled file is ~2.5 MB, so leave room for the rule set to grow. */
export const DRUG_RULES_MAX_BYTES = 16 * 1024 * 1024;
/** Bumped whenever the compiled layout changes; loadDrugRules refuses others. */
export const DRUG_RULES_FORMAT = 1;

const fold = (t) => t.toLowerCase().normalize('NFKD').replace(/\p{Mn}/gu, '');
const tokens = (t) => new Set(fold(t).split(TOKEN_SPLIT).filter(Boolean));
const usableRule = (pattern, replacement) => typeof pattern === 'string'
  && typeof replacement === 'string' && replacement !== '' && !UNSAFE_REPLACEMENT.test(replacement);

/**
 * BUILD stage: turn a drug_fix_rules.jsonl text into the serialisable
 * compiled form. Unusable lines (bad JSON, missing fields, a pattern this
 * engine rejects, an unsafe replacement) are dropped and counted, so one bad
 * rule never takes the others down with it.
 *
 * @param {string} jsonl
 * @param {object} [meta] Extra fields to record (source_sha256, source...).
 * @returns {{format: number, rules: Array<[string, string]>, anchors: Record<string, number[]>, always: number[], skipped: number}}
 */
export function compileDrugRuleSource(jsonl, meta = {}) {
  const kept = [];
  let skipped = 0;
  for (const line of (jsonl || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (!usableRule(r.pattern, r.replacement)) { skipped++; continue; }
      new RegExp(r.pattern, 'giu'); // eslint-disable-line no-new -- validation only
      kept.push(r);
    } catch (_) {
      skipped++;
    }
  }
  const anchors = {};
  const always = [];
  kept.forEach((r, i) => {
    // A merged rule (03_merge_rules.py) lists several variants and is indexed
    // under each one's anchor.
    const ruleAnchors = new Set();
    for (const v of (Array.isArray(r.variants) && r.variants.length ? r.variants : [r.variant || ''])) {
      const words = fold(String(v)).trim().split(/[\s'’-]+/u);
      // A variant with an empty word or a non-word character inside a word
      // cannot be anchored on the tokenizer's words, so that rule runs on
      // every text.
      if (!words.every((w) => w && !TOKEN_SPLIT.test(w))) {
        always.push(i);
        return;
      }
      ruleAnchors.add(words.reduce((x, y) => (y.length > x.length ? y : x)));
    }
    for (const a of ruleAnchors) (Object.hasOwn(anchors, a) ? anchors[a] : (anchors[a] = [])).push(i);
  });
  return {
    format: DRUG_RULES_FORMAT,
    ...meta,
    skipped,
    rules: kept.map((r) => [r.pattern, r.replacement]),
    anchors,
    always,
  };
}

/**
 * RUNTIME stage: turn the parsed drug_rules.json into what applyDrugRules
 * takes. No RegExp is built here (see ruleRe). Returns null for anything that
 * is not a compiled rule file of this format (an SPA-fallback HTML page never
 * gets this far: JSON.parse throws first). Unsafe replacements are re-checked
 * because the served file, unlike the build input, is not under our control.
 *
 * @param {unknown} data
 * @returns {null | {rules: Array<[string, string]>, res: Array<RegExp|null|undefined>, byAnchor: Map<string, number[]>, always: number[]}}
 */
export function loadDrugRules(data) {
  if (!data || data.format !== DRUG_RULES_FORMAT || !Array.isArray(data.rules)
    || !data.anchors || typeof data.anchors !== 'object' || !Array.isArray(data.always)) return null;
  const n = data.rules.length;
  // Validated once per rule: a merged rule sits under many anchors.
  const usable = new Uint8Array(n);
  data.rules.forEach((r, i) => { usable[i] = Array.isArray(r) && usableRule(r[0], r[1]) ? 1 : 0; });
  const ok = (i) => Number.isInteger(i) && i >= 0 && i < n && usable[i] === 1;
  return {
    rules: data.rules,
    res: new Array(n),
    // Raw served index; each anchor's ids are checked on first lookup
    // (anchorRuleIds), because validating ~84k anchors up front blocked the
    // page for ~0.5 s with the term rules merged in.
    anchors: data.anchors,
    byAnchor: new Map(),
    ok,
    always: data.always.filter(ok),
  };
}

/**
 * The usable rule ids indexed under one anchor word, validated against the
 * served file on first lookup and cached.
 *
 * @param {ReturnType<typeof loadDrugRules>} compiled
 * @param {string} token An accent-folded word.
 * @returns {number[]}
 */
export function anchorRuleIds(compiled, token) {
  let ids = compiled.byAnchor.get(token);
  if (ids === undefined) {
    const raw = Object.hasOwn(compiled.anchors, token) ? compiled.anchors[token] : null;
    ids = Array.isArray(raw) ? raw.filter(compiled.ok) : [];
    compiled.byAnchor.set(token, ids);
  }
  return ids;
}

// The rule's RegExp, built on first use and kept (null when this engine
// rejects the pattern, so a bad rule is skipped instead of throwing).
function ruleRe(compiled, i) {
  let re = compiled.res[i];
  if (re === undefined) {
    try { re = new RegExp(compiled.rules[i][0], 'giu'); } catch (_) { re = null; }
    compiled.res[i] = re;
  }
  return re;
}

// Replace every match; a match that starts with a capital keeps a capital
// ("Myrtazapine" -> "Mirtazapine", not "mirtazapine").
function applyRule(text, compiled, i) {
  const re = ruleRe(compiled, i);
  if (!re) return text;
  const rep = compiled.rules[i][1];
  return text.replace(re, (m) => (m[0] !== m[0].toLowerCase() && rep[0] !== rep[0].toUpperCase()
    ? rep[0].toUpperCase() + rep.slice(1)
    : rep));
}

/**
 * Reference implementation: every rule, in file order. Only used by the tests
 * to pin applyDrugRules to it.
 *
 * @param {string} text
 * @param {ReturnType<typeof loadDrugRules>} compiled
 * @returns {string}
 */
export function applyDrugRulesNaive(text, compiled) {
  for (let i = 0; i < compiled.rules.length; i++) text = applyRule(text, compiled, i);
  return text;
}

/**
 * Apply the rules to `text`, through the anchor index. When a rule changes
 * the text, the new words are looked up again, but only rules AFTER it are
 * queued, which is exactly what the in-order pass would still run.
 *
 * @param {string} text
 * @param {ReturnType<typeof loadDrugRules>} compiled
 * @returns {string}
 */
export function applyDrugRules(text, compiled) {
  if (!text || !compiled?.rules.length) return text;
  const candidates = (toks, after) => {
    const out = [];
    for (const t of toks) for (const j of anchorRuleIds(compiled, t)) if (j > after) out.push(j);
    return out;
  };
  const todo = new Set([...candidates(tokens(text), -1), ...compiled.always]);
  while (todo.size) {
    const i = Math.min(...todo);
    todo.delete(i);
    const next = applyRule(text, compiled, i);
    if (next !== text) {
      text = next;
      for (const j of candidates(tokens(text), i)) todo.add(j);
    }
  }
  return text;
}
