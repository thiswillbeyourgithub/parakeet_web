// Tier-1 unit test for the cell-level beam-stats rollup in
// scripts/grid_search_benchmark.mjs (summarizeCellBeam) and its rendering.
//
// Regression guard for a real reporting bug: the benchmark records TWO per-frame
// series per utterance (parakeet.js summarizeBeamStats) that are easy to swap:
//   - `kept`      = surviving beam occupancy after merge+prune (<= beam width)
//   - `expansion` = joiner batch size B (hypotheses DUE on the same frame), which
//                   is much smaller because TDT durations scatter the beam across
//                   frames.
// An earlier version surfaced ONLY `expansion` and labelled it "hyp_med", which
// read as beam width and made a full beam (kept ~5) look like a beam pinned at ~2.
// These tests pin that beam_* MUST come from `kept` and batch_* from `expansion`,
// with crafted samples where the two series differ so a swap fails loudly.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  summarizeCellBeam, ACC_HEAD, accuracyBody,
} from '../../scripts/grid_search_benchmark.mjs';

// One per-utterance beamStats sample as summarizeBeamStats would emit it. Only
// the aggregate sub-objects and `steps` are read by summarizeCellBeam.
const sample = (keptMed, keptMax, batchMed, batchMax, steps) => ({
  kept: { median: keptMed, max: keptMax },
  expansion: { median: batchMed, max: batchMax },
  steps,
});

describe('summarizeCellBeam: kept -> beam_*, expansion -> batch_* (never swapped)', () => {
  // Beam runs near-full (kept med 5) while the joiner batch stays small (exp med
  // 1-2): the exact clean-vs-noisy shape seen in the real runs.
  const samples = [
    sample(5, 5, 2, 5, 300),
    sample(5, 5, 2, 4, 400),
    sample(4, 5, 1, 3, 350),
  ];
  const cell = summarizeCellBeam(samples);

  test('beam_med is the median across utterances of kept.median', () => {
    // median of [5, 5, 4] = 5  (NOT 2, which is what expansion.median would give)
    assert.equal(cell.beam_med, 5);
  });
  test('beam_max is the max across utterances of kept.max', () => {
    assert.equal(cell.beam_max, 5);
  });
  test('batch_med is the median across utterances of expansion.median', () => {
    // median of [2, 2, 1] = 2  (NOT 5, which is what kept.median would give)
    assert.equal(cell.batch_med, 2);
  });
  test('batch_max is the max across utterances of expansion.max', () => {
    assert.equal(cell.batch_max, 5);
  });
  test('the two medians are genuinely distinct here (a swap would be caught)', () => {
    assert.notEqual(cell.beam_med, cell.batch_med);
  });
  test('steps is the mean across utterances of each utterance step count', () => {
    assert.equal(cell.steps, 350); // mean of [300, 400, 350]
  });
  test('empty sample set -> null (auto-hides the columns)', () => {
    assert.equal(summarizeCellBeam([]), null);
  });
});

describe('accuracyBody: rendered columns line up with ACC_HEAD (beam vs batch)', () => {
  const cell = summarizeCellBeam([sample(5, 5, 2, 5, 300)]);
  const row = {
    beamWidth: 5, quant: 'int8', decoderQuant: 'int8', boostLabel: 'none',
    strength: null, minp: null, depthScaling: null,
    datasets: [{ name: 'd', wordEdits: 0, refWords: 1, charEdits: 0, refChars: 1, audioSec: 1, decodeMs: 0 }],
    beamCell: cell, load5: 1.0, timings: null,
  };
  const body = accuracyBody([row]); // default EMPTY_SHOW -> no MAES cols, so ACC_HEAD indexes align
  const at = (name) => body[0][ACC_HEAD.indexOf(name)];

  test('row width matches the header', () => {
    assert.equal(body[0].length, ACC_HEAD.length);
  });
  test('beam_med column carries the kept occupancy (5), not the batch (2)', () => {
    assert.equal(at('beam_med'), '5');
    assert.equal(at('beam_max'), '5');
  });
  test('batch_med column carries the joiner batch size (2), not the occupancy (5)', () => {
    assert.equal(at('batch_med'), '2');
    assert.equal(at('batch_max'), '5');
  });
});
