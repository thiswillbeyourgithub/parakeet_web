// Tier-1 unit test for the paired early stopping helpers of
// scripts/grid_search_benchmark.mjs (--shuffle-seed / --paired-ref). Written with
// Claude Code.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { seededShuffle, pairedDelta, loadPairedRef, applyDifferenceEstimate } from '../../scripts/grid_search_benchmark.mjs';

describe('seededShuffle', () => {
  test('is a reproducible permutation that leaves the input untouched', () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    const s1 = seededShuffle(a, 7), s2 = seededShuffle(a, 7), s3 = seededShuffle(a, 8);
    assert.deepEqual(s1, s2);
    assert.notDeepEqual(s1, a);
    assert.notDeepEqual(s1, s3);
    assert.deepEqual([...s1].sort((x, y) => x - y), a);
    assert.equal(a[0], 0);
  });
});

describe('pairedDelta', () => {
  test('identical configs give delta 0 and half-width 0', () => {
    const st = pairedDelta(Array.from({ length: 10 }, () => ({ d: 0, w: 20 })), 100);
    assert.equal(st.delta, 0);
    assert.equal(st.halfwidth, 0);
  });
  test('a constant one extra edit per 20-word clip is +5 pp exactly', () => {
    const st = pairedDelta(Array.from({ length: 10 }, () => ({ d: 1, w: 20 })), 0);
    assert.equal(st.delta, 5);
    assert.equal(st.halfwidth, 0);
  });
  test('half-width shrinks with n and hits 0 on the whole population', () => {
    const mk = (n) => Array.from({ length: n }, (_, i) => ({ d: i % 2 ? 1 : -1, w: 10 }));
    const small = pairedDelta(mk(20), 1000).halfwidth, big = pairedDelta(mk(400), 1000).halfwidth;
    assert.ok(big < small / 3, `${big} vs ${small}`);
    assert.equal(pairedDelta(mk(400), 400).halfwidth, 0);
  });
  test('fewer than two samples never stops', () => {
    assert.equal(pairedDelta([{ d: 0, w: 5 }], 10).halfwidth, Infinity);
  });
});

describe('loadPairedRef', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'paired-'));
  const u = (run, audio, we) => JSON.stringify({ type: 'utterance', run, dataset: 'ds', audio, wordEdits: we, refWords: 10, charEdits: we * 3, refChars: 50 });
  test('reads the single run, keyed dataset|audio, skipping other records', () => {
    const f = join(dir, 'one.jsonl');
    writeFileSync(f, [u('beam=5 none', 'a.flac', 2), JSON.stringify({ type: 'summary', run: 'beam=5 none' }), ''].join('\n'));
    assert.deepEqual(loadPairedRef(f).get('ds|a.flac'), { wordEdits: 2, refWords: 10, charEdits: 6, refChars: 50 });
  });
  test('several runs need an explicit run tag', () => {
    const f = join(dir, 'two.jsonl');
    writeFileSync(f, [u('r1', 'a.flac', 1), u('r2', 'a.flac', 4)].join('\n'));
    assert.throws(() => loadPairedRef(f), /--paired-ref-run/);
    assert.equal(loadPairedRef(f, 'r2').get('ds|a.flac').wordEdits, 4);
    assert.throws(() => loadPairedRef(f, 'r3'), /no run "r3"/);
  });
});

describe('applyDifferenceEstimate', () => {
  test('full-set reference edits plus scaled sampled differences', () => {
    const acc = { wordEdits: 3, refWords: 40, charEdits: 9, refChars: 200, decodeMs: 7 };
    // reference: 100 edits over 1000 words on N = 50 clips; 10 sampled clips made 2 more word edits, 5 fewer char edits
    applyDifferenceEstimate(acc, { wordEdits: 100, refWords: 1000, charEdits: 300, refChars: 5000 }, { wordEdits: 2, charEdits: -5 }, 10, 50);
    assert.deepEqual(acc, { wordEdits: 110, refWords: 1000, charEdits: 275, refChars: 5000, decodeMs: 7 });
  });
});
