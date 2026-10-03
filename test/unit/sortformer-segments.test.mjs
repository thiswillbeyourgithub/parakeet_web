// Tier-1 tests for probsToSegments (app/src/sortformer.js): per-frame speaker
// probabilities -> speaker turns. Covers the reference p > threshold rule, the
// gap bridging / short-turn smoothing, renumbering in channel (arrival) order,
// and the maxSpeakers cap that folds a dropped speaker's speech into the most
// probable kept one instead of losing it.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { probsToSegments } from '../../app/src/sortformer.js';

const S = 8;
const FRAME = 0.01;

// runs: { [channel]: [[startSec, endSec, p?], ...] }, background p 0.05
function makeProbs(durationSec, runs) {
  const numFrames = Math.round(durationSec / FRAME);
  const probs = new Float32Array(numFrames * S).fill(0.05);
  for (const [ch, list] of Object.entries(runs)) {
    for (const [a, b, p = 0.9] of list) {
      for (let t = Math.round(a / FRAME); t < Math.round(b / FRAME); t++) probs[t * S + Number(ch)] = p;
    }
  }
  return { probs, numFrames, numSpeakers: S, frameSec: FRAME };
}

const round = (segs) => segs.map(({ start, end, speaker }) => ({ start: +start.toFixed(2), end: +end.toFixed(2), speaker }));

describe('probsToSegments', () => {
  test('thresholds per frame, renumbers channels 0.. in channel order', () => {
    const d = makeProbs(10, { 3: [[1, 3]], 5: [[4, 6]], 1: [[7, 9]] });
    assert.deepEqual(round(probsToSegments(d)), [
      { start: 1, end: 3, speaker: 1 },
      { start: 4, end: 6, speaker: 2 },
      { start: 7, end: 9, speaker: 0 },
    ]);
  });

  test('p exactly at the threshold is not speech', () => {
    const d = makeProbs(3, { 0: [[1, 2, 0.5]] });
    assert.deepEqual(probsToSegments(d), []);
    assert.equal(probsToSegments(d, { threshold: 0.4 }).length, 1);
  });

  test('bridges gaps shorter than minDurationOff, keeps longer ones', () => {
    const d = makeProbs(10, { 0: [[1, 2], [2.4, 3], [4, 5]] });
    assert.deepEqual(round(probsToSegments(d)), [
      { start: 1, end: 3, speaker: 0 },
      { start: 4, end: 5, speaker: 0 },
    ]);
    assert.equal(probsToSegments(d, { minDurationOff: 0 }).length, 3);
  });

  test('drops turns shorter than minDurationOn after bridging', () => {
    const d = makeProbs(10, { 0: [[1, 1.2], [1.3, 1.4], [5, 5.2]], 1: [[7, 8]] });
    // 1.0-1.2 + 1.3-1.4 bridge into 0.4 s (kept); 5.0-5.2 is 0.2 s alone (dropped)
    assert.deepEqual(round(probsToSegments(d)), [
      { start: 1, end: 1.4, speaker: 0 },
      { start: 7, end: 8, speaker: 1 },
    ]);
  });

  test('a speaker whose every turn is dropped leaves no hole in the labels', () => {
    // ch 2's only turn is too short: ch 4 must become speaker 1, not 2
    // (the first version numbered by active channel and produced [0, 2])
    const d = makeProbs(10, { 0: [[1, 3]], 2: [[4, 4.1]], 4: [[6, 8]] });
    assert.deepEqual(round(probsToSegments(d)).map((s) => s.speaker), [0, 1]);
  });

  test('overlap yields concurrent segments sorted by start then speaker', () => {
    const d = makeProbs(6, { 0: [[1, 4]], 1: [[1, 5]] });
    assert.deepEqual(round(probsToSegments(d)), [
      { start: 1, end: 4, speaker: 0 },
      { start: 1, end: 5, speaker: 1 },
    ]);
  });

  test('maxSpeakers folds the least active speaker into the most probable kept one', () => {
    const d = makeProbs(20, {
      0: [[0, 6, 0.9], [10, 11, 0.3]],
      1: [[6, 10, 0.9], [10, 11, 0.4]],
      2: [[10, 11, 0.8]], // least active: 1 s
      3: [[12, 18, 0.9]],
    });
    const capped = round(probsToSegments(d, { maxSpeakers: 3 }));
    // channel 2 is gone; at 10-11 s channel 1 (p 0.4) beats channel 0 (p 0.3),
    // so its speech extends channel 1's turn instead of vanishing
    assert.deepEqual(capped, [
      { start: 0, end: 6, speaker: 0 },
      { start: 6, end: 11, speaker: 1 },
      { start: 12, end: 18, speaker: 2 },
    ]);
    // no cap, or a cap at or above the count, leaves all four
    assert.equal(new Set(probsToSegments(d).map((s) => s.speaker)).size, 4);
    assert.deepEqual(probsToSegments(d, { maxSpeakers: 4 }), probsToSegments(d));
  });

  test('maxSpeakers ties on activity keep the earlier channel', () => {
    const d = makeProbs(10, { 0: [[0, 2]], 1: [[3, 5]], 2: [[6, 8]] });
    const segs = round(probsToSegments(d, { maxSpeakers: 2 }));
    assert.deepEqual([...new Set(segs.map((s) => s.speaker))], [0, 1]);
    // channel 2's turn went to whichever kept channel was likelier (equal, so the first)
    assert.deepEqual(segs.at(-1), { start: 6, end: 8, speaker: 0 });
  });

  test('silence in, nothing out', () => {
    assert.deepEqual(probsToSegments(makeProbs(5, {})), []);
  });
});
