// Drug-name fix rules: regexes learned from the drug-name errors of the
// UltiMed and parakeet-ultra models ("l'ananas de l'umab" -> "lanadelumab"),
// vendored in public/drug-rules/drug_fix_rules.jsonl (see its SOURCE.md).
//
// The reference semantics are "every rule, in file order, on the whole text"
// (applyDrugRulesNaive). With ~10k rules that costs ~17 ms per text, and the
// transcript view applies it per entry and per speaker turn, so
// applyDrugRules runs the same rules through an anchor index instead: a
// rule only runs when its anchor (the longest accent-folded word of the
// variant it fixes) is one of the text's words. Same output, ~150x faster.
// This is a port of compile_rules() from the rule builder
// (UltiMed-ASR-FR-v1-scripts, 08_drug_asr_rules/02_build_fix_rules.py).
//
// Kept free of DOM/React so the equivalence with the naive order is
// unit-testable (test/unit/drug-rules.test.mjs).
//
// Built with Claude Code.

// Word characters as the rules' own lookarounds spell them (the patterns
// avoid \w, which is ASCII-only in JavaScript).
const TOKEN_SPLIT = /[^0-9A-Za-z_À-ÖØ-öø-ɏ]+/u;
// Same controls/bidi overrides the dictation layer refuses: the output can
// land in the system clipboard (auto-copy), so a tampered rule file must not
// be able to smuggle terminal escape sequences into a paste.
const UNSAFE_REPLACEMENT = /[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/;

const fold = (t) => t.toLowerCase().normalize('NFKD').replace(/\p{Mn}/gu, '');
const tokens = (t) => new Set(fold(t).split(TOKEN_SPLIT).filter(Boolean));

/**
 * Parse and compile a drug_fix_rules.jsonl text.
 *
 * Unusable lines (bad JSON, missing fields, a pattern this engine rejects, an
 * unsafe replacement) are skipped and counted rather than failing the whole
 * set, so one bad rule never takes the other 9,806 down with it. An HTML page
 * (a server's SPA fallback for a missing file) therefore yields zero rules.
 *
 * @param {string} jsonl
 * @returns {{rules: Array<object>, byAnchor: Map<string, number[]>, always: number[], skipped: number}}
 */
export function compileDrugRules(jsonl) {
  const rules = [];
  let skipped = 0;
  for (const line of (jsonl || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r.pattern !== 'string' || typeof r.replacement !== 'string'
        || !r.replacement || UNSAFE_REPLACEMENT.test(r.replacement)) {
        skipped++;
        continue;
      }
      rules.push({ ...r, re: new RegExp(r.pattern, 'giu') });
    } catch (_) {
      skipped++;
    }
  }
  const byAnchor = new Map();
  const always = [];
  rules.forEach((r, i) => {
    const words = fold(r.variant || '').trim().split(/[\s'’-]+/u);
    // A variant with an empty word or a non-word character inside a word
    // cannot be anchored on the tokenizer's words, so that rule runs on every
    // text.
    if (words.every((w) => w && !TOKEN_SPLIT.test(w))) {
      const anchor = words.reduce((x, y) => (y.length > x.length ? y : x));
      if (!byAnchor.has(anchor)) byAnchor.set(anchor, []);
      byAnchor.get(anchor).push(i);
    } else {
      always.push(i);
    }
  });
  return { rules, byAnchor, always, skipped };
}

// Replace every match; a match that starts with a capital keeps a capital
// ("Myrtazapine" -> "Mirtazapine", not "mirtazapine").
function applyRule(text, r) {
  const rep = r.replacement;
  return text.replace(r.re, (m) => (m[0] !== m[0].toLowerCase() && rep[0] !== rep[0].toUpperCase()
    ? rep[0].toUpperCase() + rep.slice(1)
    : rep));
}

/**
 * Reference implementation: every rule, in file order. Only used by the tests
 * to pin applyDrugRules to it.
 *
 * @param {string} text
 * @param {ReturnType<typeof compileDrugRules>} compiled
 * @returns {string}
 */
export function applyDrugRulesNaive(text, compiled) {
  return compiled.rules.reduce(applyRule, text);
}

/**
 * Apply the rules to `text`, through the anchor index. When a rule changes
 * the text, the new words are looked up again, but only rules AFTER it are
 * queued, which is exactly what the in-order pass would still run.
 *
 * @param {string} text
 * @param {ReturnType<typeof compileDrugRules>} compiled
 * @returns {string}
 */
export function applyDrugRules(text, compiled) {
  if (!text || !compiled?.rules.length) return text;
  const candidates = (toks, after) => {
    const out = [];
    for (const t of toks) for (const j of compiled.byAnchor.get(t) ?? []) if (j > after) out.push(j);
    return out;
  };
  const todo = new Set([...candidates(tokens(text), -1), ...compiled.always]);
  while (todo.size) {
    const i = Math.min(...todo);
    todo.delete(i);
    const next = applyRule(text, compiled.rules[i]);
    if (next !== text) {
      text = next;
      for (const j of candidates(tokens(text), i)) todo.add(j);
    }
  }
  return text;
}
