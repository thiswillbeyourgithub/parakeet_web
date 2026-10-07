// Tier-1 unit test for the drug-name fix rules (app/ui/src/lib/drugRules.js).
//
// The indexed applyDrugRules only earns its place if it is INDISTINGUISHABLE
// from the reference "every rule, in file order" pass, so most of this file
// pins the two together: on small hand-built rule sets that exercise the
// index's edge cases (a fix creating a word a LATER rule anchors on, one that
// an EARLIER rule anchors on, unanchorable variants), and on a sample of the
// real vendored rule file.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  compileDrugRuleSource,
  loadDrugRules,
  applyDrugRules,
  applyDrugRulesNaive,
  anchorRuleIds,
  traceDrugRules,
  DRUG_RULES_FORMAT,
} from '../../app/ui/src/lib/drugRules.js';

// Build stage then runtime stage, through a real JSON round trip, exactly the
// path the rules take from the model repo to the browser.
const compileDrugRules = (jsonl) => loadDrugRules(JSON.parse(JSON.stringify(compileDrugRuleSource(jsonl))));

const WB = '(?<![0-9A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\'-])';
const WE = '(?![0-9A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F-])';
const rule = (variant, replacement, pattern = variant.replace(/ /g, '[\\s-]+')) =>
  JSON.stringify({ pattern: WB + pattern + WE, replacement, variant });
const both = (text, c) => {
  const fast = applyDrugRules(text, c);
  assert.equal(fast, applyDrugRulesNaive(text, c), `indexed != naive on ${JSON.stringify(text)}`);
  return fast;
};

describe('applyDrugRules', () => {
  test('replaces a misheard drug name, case-insensitively', () => {
    const c = compileDrugRules(rule('myrtazapine', 'mirtazapine'));
    assert.equal(both('sous myrtazapine le soir', c), 'sous mirtazapine le soir');
    assert.equal(both('sous MYRTAZAPINE le soir', c), 'sous Mirtazapine le soir');
  });

  test('a capitalised match keeps its capital', () => {
    const c = compileDrugRules(rule('myrtazapine', 'mirtazapine'));
    assert.equal(both('Myrtazapine le soir.', c), 'Mirtazapine le soir.');
  });

  test('does not touch a match inside a longer word', () => {
    const c = compileDrugRules(rule('tim', 'Timolol'));
    assert.equal(both('optimum et tim.', c), 'optimum et Timolol.');
  });

  test('a fix that creates a word a LATER rule anchors on chains', () => {
    const c = compileDrugRules([rule('foo bar', 'baz qux'), rule('qux', 'quux')].join('\n'));
    assert.equal(both('un foo bar ici', c), 'un baz quux ici');
  });

  test('a fix that creates a word an EARLIER rule anchors on does NOT re-run it', () => {
    // The in-order pass has already gone past rule 0 when rule 1 fires.
    const c = compileDrugRules([rule('qux', 'quux'), rule('foo bar', 'baz qux')].join('\n'));
    assert.equal(both('un foo bar ici', c), 'un baz qux ici');
  });

  test('an unanchorable variant still runs on every text', () => {
    const c = compileDrugRules(rule('a.b', 'Abc', 'a\\.b'));
    assert.deepEqual(c.always, [0]);
    assert.deepEqual(Object.keys(c.anchors), []);
    assert.equal(both('prendre a.b demain', c), 'prendre Abc demain');
  });

  test('accents in the text still hit the accent-folded anchor', () => {
    const c = compileDrugRules(rule('grace tim', 'Gracetim', 'gr[aàâä][cç][eéèêë][\\s-]+t[iîï]m'));
    assert.equal(both('une grâce tim', c), 'une Gracetim');
  });

  test('empty text and an empty rule set are no-ops', () => {
    const c = compileDrugRules(rule('foo', 'bar'));
    assert.equal(applyDrugRules('', c), '');
    assert.equal(applyDrugRules('foo', compileDrugRules('')), 'foo');
    assert.equal(applyDrugRules('foo', null), 'foo');
  });
});

describe('traceDrugRules (what the debug view shows)', () => {
  test('points at the original words a rule rewrote, and returns the same text', () => {
    const c = compileDrugRules([rule('foo', 'x'), rule('myrtazapine', 'mirtazapine')].join('\n'));
    const text = 'Sous Myrtazapine et myrtazapine.';
    const { text: out, rewrites } = traceDrugRules(text, c);
    assert.equal(out, applyDrugRules(text, c));
    assert.deepEqual(rewrites, [
      { start: 5, end: 16, from: 'Myrtazapine', to: 'Mirtazapine', rules: [1] },
      { start: 20, end: 31, from: 'myrtazapine', to: 'mirtazapine', rules: [1] },
    ]);
  });

  test('a chained rewrite is ONE span, from the original words to the final ones', () => {
    // rule 0 makes "baz qux", rule 1 then fixes its "qux".
    const c = compileDrugRules([rule('foo bar', 'baz qux'), rule('qux', 'quux')].join('\n'));
    const { text, rewrites } = traceDrugRules('un foo bar ici', c);
    assert.equal(text, 'un baz quux ici');
    assert.deepEqual(rewrites, [{ start: 3, end: 10, from: 'foo bar', to: 'baz quux', rules: [0, 1] }]);
  });

  test('a rule that changes the length shifts the later spans correctly', () => {
    const c = compileDrugRules([rule('a b c', 'Z'), rule('tim', 'Timolol')].join('\n'));
    const { text, rewrites } = traceDrugRules('a b c puis tim', c);
    assert.equal(text, 'Z puis Timolol');
    assert.deepEqual(rewrites.map((r) => [r.from, r.to, r.start]), [['a b c', 'Z', 0], ['tim', 'Timolol', 11]]);
  });

  test('nothing to rewrite, no rules, or no text: no rewrites', () => {
    const c = compileDrugRules(rule('foo', 'bar'));
    assert.deepEqual(traceDrugRules('rien ici', c), { text: 'rien ici', rewrites: [] });
    assert.deepEqual(traceDrugRules('', c), { text: '', rewrites: [] });
    assert.deepEqual(traceDrugRules('foo', null), { text: 'foo', rewrites: [] });
  });
});

describe('compileDrugRuleSource (build stage)', () => {
  test('skips unusable lines instead of failing the whole set', () => {
    const c = compileDrugRuleSource([
      rule('foo', 'bar'),
      '{not json',
      JSON.stringify({ pattern: '(', replacement: 'x', variant: 'x' }),
      JSON.stringify({ pattern: 'a', variant: 'a' }),
      JSON.stringify({ pattern: 'b', replacement: 'evil\x1b]52;c;\x07', variant: 'b' }),
      JSON.stringify({ pattern: 'c', replacement: 'rtl‮', variant: 'c' }),
    ].join('\n'));
    assert.equal(c.rules.length, 1);
    assert.equal(c.skipped, 5);
  });

  test('keeps only [pattern, replacement] and records the metadata it is given', () => {
    const c = compileDrugRuleSource(rule('foo', 'bar'), { sources: [{ sha256: 'abc' }] });
    assert.equal(c.format, DRUG_RULES_FORMAT);
    assert.deepEqual(c.sources, [{ sha256: 'abc' }]);
    assert.equal(c.rules[0].length, 2);
    assert.deepEqual(c.anchors, { foo: [0] });
  });

  // 03_merge_rules.py folds the rules sharing a replacement into one rule with
  // `variants` (and `variant: null`). Indexing only `variant` sent every merged
  // rule to `always`: right output, but every rule on every text.
  test('a merged rule is indexed under the anchor of each of its variants', () => {
    const merged = JSON.stringify({
      pattern: `${WB}(?:mire[\\s-]+taz[\\s-]+apine|myrtazapine)${WE}`,
      replacement: 'mirtazapine',
      variant: null,
      variants: ['mire taz apine', 'myrtazapine'],
    });
    const c = compileDrugRuleSource(merged);
    assert.deepEqual(c.anchors, { apine: [0], myrtazapine: [0] });
    assert.deepEqual(c.always, []);
    const loaded = compileDrugRules(merged);
    assert.equal(both('Myrtazapine le soir', loaded), 'Mirtazapine le soir');
    assert.equal(both('mire taz apine le soir', loaded), 'mirtazapine le soir');
  });

  test('a merged rule with one unanchorable variant runs on every text', () => {
    const c = compileDrugRuleSource(JSON.stringify({
      pattern: `${WB}(?:foo|b\\.r)${WE}`, replacement: 'x', variant: null, variants: ['foo', 'b.r'],
    }));
    assert.deepEqual(c.anchors, {});
    assert.deepEqual(c.always, [0]);
  });

  test('a variant word that collides with an Object.prototype key still anchors', () => {
    const c = compileDrugRules(rule('constructor', 'Kontructor'));
    assert.equal(applyDrugRules('le constructor', c), 'le Kontructor');
  });
});

describe('loadDrugRules (runtime stage)', () => {
  test('refuses anything that is not a compiled rule file of this format', () => {
    assert.equal(loadDrugRules(null), null);
    assert.equal(loadDrugRules({ rules: [], anchors: {}, always: [] }), null);
    assert.equal(loadDrugRules({ format: DRUG_RULES_FORMAT + 1, rules: [], anchors: {}, always: [] }), null);
    assert.equal(loadDrugRules({ format: DRUG_RULES_FORMAT, rules: 'x', anchors: {}, always: [] }), null);
  });

  test('re-checks the SERVED file: a tampered unsafe replacement or bad index is dropped', () => {
    const c = loadDrugRules({
      format: DRUG_RULES_FORMAT,
      rules: [['foo', 'evil\x1b]52;c;\x07'], ['bar', 'ok'], 'junk'],
      anchors: { foo: [0], bar: [1, 7, -1, 2] },
      always: [0, 1.5],
    });
    assert.deepEqual(anchorRuleIds(c, 'foo'), []);
    assert.deepEqual(anchorRuleIds(c, 'bar'), [1]);
    assert.deepEqual(anchorRuleIds(c, 'constructor'), []);
    assert.deepEqual(c.always, []);
    assert.equal(applyDrugRules('foo bar', c), 'foo ok');
  });

  test('builds a RegExp only when its anchor shows up, and skips a pattern that will not compile', () => {
    const c = loadDrugRules({
      format: DRUG_RULES_FORMAT,
      rules: [['foo', 'X'], ['bar', 'Y'], ['(', 'Z']],
      anchors: { foo: [0], bar: [1], baz: [2] },
      always: [],
    });
    assert.equal(applyDrugRules('foo', c), 'X');
    assert.ok(c.res[0] instanceof RegExp);
    assert.equal(c.res[1], undefined);
    assert.equal(applyDrugRules('baz', c), 'baz');
    assert.equal(c.res[2], null);
  });
});

describe('committed drug_rules.json', () => {
  const path = fileURLToPath(new URL('../../app/ui/public/drug-rules/drug_rules.json', import.meta.url));
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const c = loadDrugRules(data);

  test('loads whole, with its provenance', () => {
    assert.ok(c, 'loadDrugRules refused the committed file');
    // A truncated or half-written compile, not a count to track: since
    // 03_merge_rules.py folds same-replacement rules, ~13.8k variants ship as
    // ~3.4k rules.
    assert.ok(c.rules.length > 3000, `only ${c.rules.length} rules`);
    // The drug rules, then the medical-term rules, each with its own hash.
    assert.equal(data.sources.length, 2);
    for (const s of data.sources) assert.match(s.sha256, /^[0-9a-f]{64}$/);
    const indexed = new Set([...c.always, ...Object.keys(data.anchors).flatMap((t) => anchorRuleIds(c, t))]);
    assert.equal(indexed.size, c.rules.length, 'every rule must be reachable through the index');
  });

  test('every pattern compiles', () => {
    applyDrugRulesNaive('x', c); // runs, and so builds, every rule
    assert.equal(c.res.filter((re) => re === null).length, 0);
  });

  test('fixes known mishearings', () => {
    assert.equal(
      applyDrugRules("Traitement par l'ananas de l'umab et jy c'est le cas.", c),
      'Traitement par lanadelumab et Jyseleca.',
    );
    // A medical-term rule, which runs after the drug rules.
    assert.equal(applyDrugRules('Une ostéophite au niveau L4.', c), 'Une ostéophyte au niveau L4.');
    // And the trace names the misheard words, not just the fixed text.
    const { rewrites } = traceDrugRules("Traitement par l'ananas de l'umab.", c);
    assert.deepEqual(rewrites.map((r) => [r.from, r.to]), [["l'ananas de l'umab", 'lanadelumab']]);
  });

  test('indexed output equals the in-order pass on a sample of the real rules', () => {
    // The compiled file keeps no variants, so sample its anchor words instead:
    // each one is what makes the index queue its rules, and pairing two of
    // them lets a fix feed a later rule. Sampled because the naive pass runs
    // every rule on every text.
    const words = Object.keys(data.anchors);
    const step = Math.ceil(words.length / 60);
    let changed = 0;
    for (let i = 0; i + 1 < words.length; i += step) {
      const text = `Le patient prend du ${words[i]} et ${words[i + 1]} depuis hier.`;
      if (both(text, c) !== text) changed++;
    }
    // Guard against a sample that never fires a rule, which would make the
    // equality above vacuous (the first version embedded `undefined`).
    assert.ok(changed > 10, `only ${changed} sampled texts were rewritten`);
    both('Rien à signaler, bonne tolérance.', c);
  });
});
