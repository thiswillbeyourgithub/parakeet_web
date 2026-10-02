// Tier-1 unit test for the confidence-gated selective beam experiment:
// scripts/selective-beam-analyze.mjs (pairing, gate scoring, threshold sweep)
// and the grid bench's --record-confidences flag that feeds it.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, pairRecords, scoreGate, sweep } from '../../scripts/selective-beam-analyze.mjs';
import { parseArgs } from '../../scripts/grid_search_benchmark.mjs';

const utt = (beam, audio, wordEdits, decodeMs, extra = {}) => ({
  type: 'utterance', beam, dataset: 'ds', audio,
  wordEdits, refWords: 10, charEdits: wordEdits, refChars: 50,
  metrics: { decode_ms: decodeMs }, ...extra,
});

// Three utterances: beam fixes the unsure one (a), ties on the sure one (b),
// and slightly hurts the middling one (c). Beam costs 3x greedy everywhere.
const records = [
  utt(1, 'a', 4, 10, { tokenConfs: [0.3, 0.9, 1] }),
  utt(1, 'b', 0, 10, { tokenConfs: [1, 1, 1] }),
  utt(1, 'c', 1, 10, { tokenConfs: [0.8, 1, 1] }),
  utt(8, 'a', 1, 30),
  utt(8, 'b', 0, 30),
  utt(8, 'c', 2, 30),
];

describe('pairRecords', () => {
  test('pairs each beam record with its greedy twin, in beam order', () => {
    const pairs = pairRecords(records, 8);
    assert.deepEqual(pairs.map((p) => p.greedy.audio), ['a', 'b', 'c']);
    assert.ok(pairs.every((p) => p.beam.beam === 8 && p.greedy.beam === 1));
  });

  test('greedy records without tokenConfs are not paired (flag was off)', () => {
    const noConf = records.map((r) => ({ ...r, tokenConfs: undefined }));
    assert.equal(pairRecords(noConf, 8).length, 0);
  });

  test('the same audio in two datasets stays two utterances', () => {
    const twoDs = [...records, ...records.map((r) => ({ ...r, dataset: 'other' }))];
    assert.equal(pairRecords(twoDs, 8).length, 6);
  });
});

describe('scoreGate', () => {
  const pairs = pairRecords(records, 8);

  test('all-greedy and all-beam bracket the cost: greedy-only is 1/3, always-beam is 4/3', () => {
    const g = scoreGate(pairs, [false, false, false]);
    const b = scoreGate(pairs, [true, true, true]);
    assert.equal(g.wer, (100 * 5) / 30);
    assert.equal(b.wer, (100 * 3) / 30);
    assert.equal(g.cost, 30 / 90);
    assert.equal(b.cost, 120 / 90);
    assert.equal(g.beamed, 0);
    assert.equal(b.beamed, 1);
  });

  test('a mixed gate scores each utterance from the record it picked', () => {
    const s = scoreGate(pairs, [true, false, false]);
    assert.equal(s.wer, (100 * (1 + 0 + 1)) / 30);
    assert.equal(s.beamed, 1 / 3);
    assert.equal(s.cost, (30 + 30) / 90);
  });
});

describe('sweep', () => {
  const pairs = pairRecords(records, 8);

  test('beams the least confident first, so a good feature beats beam outright', () => {
    const [none, one, all] = sweep(pairs, 'min', [0, 1 / 3, 1]);
    assert.equal(none.recovered, 0);
    assert.equal(none.threshold, null);
    // Beaming only 'a' (min 0.3) keeps a's fix and avoids c's regression.
    assert.equal(one.threshold, 0.3);
    assert.ok(Math.abs(one.recovered - 3 / 2) < 1e-12);
    assert.equal(all.recovered, 1);
  });

  test('recovered is null when beam does not beat greedy', () => {
    const flat = pairRecords(records.map((r) => ({ ...r, wordEdits: 1 })), 8);
    assert.ok(sweep(flat, 'min', [0.5]).every((r) => r.recovered === null));
  });
});

describe('FEATURES', () => {
  test('lower always means less confident', () => {
    const sure = [1, 1, 1, 0.99], unsure = [1, 0.4, 0.95, 0.6];
    for (const [name, f] of Object.entries(FEATURES)) assert.ok(f(unsure) < f(sure), name);
  });

  test('an empty token list (silence) reads as fully confident, never beamed first', () => {
    for (const [name, f] of Object.entries(FEATURES)) assert.ok(f([]) >= f([0.99]), name);
  });
});

describe('grid bench --record-confidences', () => {
  const parse = (...extra) => parseArgs(['--manifest', '/tmp/does-not-matter.jsonl', '--ort', 'node', ...extra]);

  test('off by default, on when passed', () => {
    assert.equal(parse().recordConfidences, false);
    assert.equal(parse('--record-confidences').recordConfidences, true);
  });
});
