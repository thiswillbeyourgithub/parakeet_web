// Regression test for the silent phrase-boost no-op bug.
//
// A `--phrase-boost` spec can be inline phrase text, a .txt list, or a .pwc
// artifact. Before the fix, expandBoostSpec treated ANY non-existent path as
// inline phrase text, so a mistyped file path (e.g. medical.txt instead of the
// real french_medical.txt) silently produced an empty trie and a no-op boost
// that looked like the feature simply had no effect. The guard makes a spec that
// names a file (ends in .txt/.pwc) fail loudly when it does not resolve.
//
// Built with Claude Code.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandBoostSpec, parseCliBoosts, buildPhraseBoost } from '../../scripts/transcribe.mjs';
import { loadCachedFixture } from '../support/bpe-fixture.mjs';

describe('expandBoostSpec file-vs-inline guard', () => {
  test('missing .txt path throws (the bug: was silently treated as inline)', () => {
    assert.throws(() => expandBoostSpec('definitely-missing-french_medical.txt'), /not found/i);
  });

  test('missing .pwc path throws', () => {
    assert.throws(() => expandBoostSpec('nope.pwc'), /not found/i);
  });

  test('case-insensitive extension still guarded (.TXT)', () => {
    assert.throws(() => expandBoostSpec('Missing.TXT'), /not found/i);
  });

  test('leading/trailing whitespace does not smuggle a missing file past the guard', () => {
    assert.throws(() => expandBoostSpec('  missing.txt  '), /not found/i);
  });

  test('inline phrase (no file extension) passes through unchanged', () => {
    assert.equal(expandBoostSpec('venlafaxine:5'), 'venlafaxine:5');
  });

  test('inline multi-phrase text passes through unchanged', () => {
    assert.equal(expandBoostSpec('amlodipine\nibuprofen:2'), 'amlodipine\nibuprofen:2');
  });

  test('existing .txt file is read and its contents returned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'boost-spec-'));
    const file = join(dir, 'real.txt');
    writeFileSync(file, 'amlodipine\nvenlafaxine\n');
    assert.equal(expandBoostSpec(file), 'amlodipine\nvenlafaxine\n');
  });
});

// The CLI shares the web app's list-level syntax: a `#!prefixes` directive and a
// `*:WEIGHT:MINP:AUG` defaults line are config, not phrases, so they must not leak
// into the trie as junk terms (the per-phrase `:AUG` field is still parsed
// normally). The removed `#!strength` / `#!augment` directives are likewise never
// phrases (they are now expressed by a `*` defaults line).
describe('parseCliBoosts: directive + * defaults lines are not phrases', () => {
  test('#! directive lines (incl. the removed ones) are not turned into phrases', () => {
    const entries = parseCliBoosts(['#!prefixes al-\n#!augment faph\n#!strength 3\nvenlafaxine:5\namlodipine']);
    assert.deepEqual(entries.map((e) => e.phrase), ['venlafaxine', 'amlodipine']);
  });
  test('a per-phrase :AUG flag still parses alongside directives', () => {
    const entries = parseCliBoosts(['#!prefixes al-\nalpha-methyl:5::h']);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].phrase, 'alpha-methyl');
    assert.equal(entries[0].augment, 'h');
  });
  test('a * defaults line sets weight/augment for the following phrases (not a phrase itself)', () => {
    const entries = parseCliBoosts(['*:2::fa\nvenlafaxine\namlodipine:7']);
    assert.deepEqual(entries.map((e) => e.phrase), ['venlafaxine', 'amlodipine']);
    assert.deepEqual([entries[0].weight, entries[0].augment], [2, 'fa']);
    // explicit per-phrase weight overrides the * default; augment still inherited.
    assert.deepEqual([entries[1].weight, entries[1].augment], [7, 'fa']);
  });
});

// The CLI's --depth-scaling / --boost-minp flags flow into buildPhraseBoost,
// which must set them on the trie it returns. depthScaling is baked into the
// node bonuses (a build-time constructor option); minpOverride is a decode-time
// property layered on after build. (The trie-level *effect* of both knobs is
// covered in phrase-boost.test.mjs; this pins the buildPhraseBoost wiring.)
describe('buildPhraseBoost wires depthScaling + minpOverride onto the trie', () => {
  // loadBpeEncoder only needs id2token; the committed BPE fixture supplies it.
  const tokenizer = { id2token: loadCachedFixture().id2token };
  const boosts = ['acetaminophen:5:0.5']; // per-phrase min-p 0.5

  test('depthScaling defaults to the trie built-in when not passed', async () => {
    const t = await buildPhraseBoost({ boosts, strength: 1, tokenizer, quiet: true });
    assert.equal(t.depthScaling, 0.5);
    assert.equal(t.minpOverride, null);
  });

  test('depthScaling 0 (flat) is honoured, not coerced to the default', async () => {
    const t = await buildPhraseBoost({ boosts, strength: 1, depthScaling: 0, tokenizer, quiet: true });
    assert.equal(t.depthScaling, 0);
  });

  test('minpOverride is set on the trie, superseding the per-phrase baked min-p', async () => {
    const t = await buildPhraseBoost({ boosts, strength: 1, depthScaling: 1, minpOverride: 0.01, tokenizer, quiet: true });
    assert.equal(t.depthScaling, 1);
    assert.equal(t.minpOverride, 0.01);
  });

  test('a null minpOverride leaves each phrase on its own baked min-p', async () => {
    const t = await buildPhraseBoost({ boosts, strength: 1, minpOverride: null, tokenizer, quiet: true });
    assert.equal(t.minpOverride, null);
  });
});
