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
  compileDrugRules,
  applyDrugRules,
  applyDrugRulesNaive,
} from '../../app/ui/src/lib/drugRules.js';

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

describe('compileDrugRules', () => {
  test('skips unusable lines instead of failing the whole set', () => {
    const c = compileDrugRules([
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

  test('an HTML page (SPA fallback for a missing file) yields zero rules', () => {
    const c = compileDrugRules('<!doctype html>\n<html><body>app</body></html>\n');
    assert.equal(c.rules.length, 0);
  });
});

describe('vendored drug_fix_rules.jsonl', () => {
  const path = fileURLToPath(new URL('../../app/ui/public/drug-rules/drug_fix_rules.jsonl', import.meta.url));
  const c = compileDrugRules(readFileSync(path, 'utf8'));

  test('every rule compiles', () => {
    assert.equal(c.skipped, 0);
    assert.ok(c.rules.length > 9000, `only ${c.rules.length} rules`);
  });

  test('fixes known mishearings', () => {
    assert.equal(
      applyDrugRules("Traitement par l'ananas de l'umab et jy c'est le cas.", c),
      'Traitement par lanadelumab et Jyseleca.',
    );
  });

  test('indexed output equals the in-order pass on a sample of the real rules', () => {
    // Every 40th rule's own variant, embedded in a sentence (the naive pass
    // costs ~20 ms per text, so the whole file would take minutes).
    for (let i = 0; i < c.rules.length; i += 40) {
      both(`Le patient prend du ${c.rules[i].variant} depuis hier.`, c);
    }
    both('Rien à signaler, bonne tolérance.', c);
  });
});
