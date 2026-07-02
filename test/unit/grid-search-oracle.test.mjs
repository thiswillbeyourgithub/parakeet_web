// Tier-1 unit tests for the murmure #338 beam-vs-greedy diagnostics added to
// scripts/grid_search_benchmark.mjs:
//   - levenshteinCounts: the NIST substitution/deletion/insertion split, whose
//     `total` MUST equal the plain edit distance (so WER is unchanged) while the
//     split answers "does a wider beam delete more?".
//   - score(): now carries that word-level S/D/I split.
//   - newAcc/addScore/buildDatasets: carry the S/D/I split and the oracle
//     (best-achievable over the beam n-best) edits, with oracle falling back to
//     the 1-best when a run emits no oracle (greedy / no n-best).
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  levenshteinCounts, score, newAcc, addScore, buildDatasets, OVERALL,
} from '../../scripts/grid_search_benchmark.mjs';

const W = (s) => s.split(' ');

describe('levenshteinCounts: S/D/I decomposition', () => {
  test('identical sequences cost nothing', () => {
    assert.deepEqual(levenshteinCounts(W('a b c'), W('a b c')), { sub: 0, del: 0, ins: 0, total: 0 });
  });

  test('pure substitution', () => {
    // a [b->X] c
    assert.deepEqual(levenshteinCounts(W('a b c'), W('a X c')), { sub: 1, del: 0, ins: 0, total: 1 });
  });

  test('pure deletion (ref token missing from hyp)', () => {
    assert.deepEqual(levenshteinCounts(W('a b c'), W('a c')), { sub: 0, del: 1, ins: 0, total: 1 });
  });

  test('pure insertion (extra hyp token)', () => {
    assert.deepEqual(levenshteinCounts(W('a c'), W('a b c')), { sub: 0, del: 0, ins: 1, total: 1 });
  });

  test('empty ref => everything in hyp is an insertion', () => {
    assert.deepEqual(levenshteinCounts([], W('a b')), { sub: 0, del: 0, ins: 2, total: 2 });
  });

  test('empty hyp => everything in ref is a deletion', () => {
    assert.deepEqual(levenshteinCounts(W('a b'), []), { sub: 0, del: 2, ins: 0, total: 2 });
  });

  test('mixed: one substitution and one insertion', () => {
    // "the cat sat" -> "the dog sat here": cat->dog (sub), +here (ins)
    assert.deepEqual(levenshteinCounts(W('the cat sat'), W('the dog sat here')),
      { sub: 1, del: 0, ins: 1, total: 2 });
  });

  test('total always equals the edit distance (sub+del+ins)', () => {
    for (const [r, h, expected] of [
      ['a b c d', 'a b c d', 0],
      ['a b c d', 'a x c', 2],       // b->x sub, d deleted
      ['', 'a b c', 3],
      ['a b c', '', 3],
      ['one two three', 'one three four five', 3], // two deleted, +four +five
    ]) {
      const c = levenshteinCounts(W(r), W(h));
      assert.equal(c.total, expected, `${r} -> ${h}`);
      assert.equal(c.total, c.sub + c.del + c.ins, 'total is the sum of the split');
    }
  });
});

describe('score(): word-level S/D/I split', () => {
  test('carries the split and keeps wordEdits == edit distance', () => {
    const sc = score('the cat sat', 'the dog sat here');
    assert.equal(sc.wordSub, 1);
    assert.equal(sc.wordDel, 0);
    assert.equal(sc.wordIns, 1);
    assert.equal(sc.wordEdits, 2, 'wordEdits unchanged (== S+D+I)');
    assert.equal(sc.wordEdits, sc.wordSub + sc.wordDel + sc.wordIns);
    assert.equal(sc.refWords, 3);
  });
});

describe('addScore / buildDatasets: oracle + decomposition', () => {
  test('oracle below the 1-best is tracked separately from the 1-best', () => {
    const acc = newAcc();
    // A cell where the 1-best made 3 word errors but the beam n-best contained a
    // path with only 1 (oracle).
    addScore(acc, { refWords: 10, hypWords: 10, wordEdits: 3, refChars: 50, charEdits: 6,
      wordSub: 2, wordDel: 1, wordIns: 0, oracleWordEdits: 1, oracleCharEdits: 2 });
    assert.equal(acc.wordEdits, 3, '1-best edits');
    assert.equal(acc.oracleWordEdits, 1, 'oracle edits are strictly better');
    assert.equal(acc.oracleCharEdits, 2);
    assert.equal(acc.wordSub, 2);
    assert.equal(acc.wordDel, 1);
    assert.equal(acc.wordIns, 0);
  });

  test('a bare score (no oracle) makes oracle fall back to the 1-best', () => {
    const acc = newAcc();
    addScore(acc, { refWords: 5, hypWords: 5, wordEdits: 2, refChars: 20, charEdits: 4 });
    assert.equal(acc.oracleWordEdits, acc.wordEdits, 'oracle == 1-best when absent');
    assert.equal(acc.oracleCharEdits, acc.charEdits);
    assert.equal(acc.wordSub, 0, 'missing split defaults to 0');
  });

  test('buildDatasets pools oracle + decomposition into the overall row', () => {
    const a = newAcc(); addScore(a, { refWords: 4, hypWords: 4, wordEdits: 2, refChars: 20, charEdits: 3,
      wordSub: 1, wordDel: 1, wordIns: 0, oracleWordEdits: 1, oracleCharEdits: 2 });
    const b = newAcc(); addScore(b, { refWords: 6, hypWords: 6, wordEdits: 4, refChars: 30, charEdits: 5,
      wordSub: 2, wordDel: 0, wordIns: 2, oracleWordEdits: 3, oracleCharEdits: 4 });
    const perDs = new Map([['fr', a], ['med', b]]);
    const datasets = buildDatasets(perDs, ['fr', 'med']);
    const overall = datasets.find((d) => d.name === OVERALL);
    assert.ok(overall, 'overall row present with 2 datasets');
    assert.equal(overall.wordEdits, 6, 'summed 1-best edits');
    assert.equal(overall.oracleWordEdits, 4, 'summed oracle edits (1+3)');
    assert.equal(overall.oracleCharEdits, 6, 'summed oracle char edits (2+4)');
    assert.equal(overall.wordSub, 3);
    assert.equal(overall.wordDel, 1);
    assert.equal(overall.wordIns, 2);
  });
});
