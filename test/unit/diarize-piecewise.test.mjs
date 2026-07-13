// Tier-1 unit test for the pure reconciliation logic of parallel piecewise
// diarization (app/ui/src/lib/diarizePiecewise.js). Synthetic 3-dim voiceprints
// stand in for CAM++ embeddings, exactly like test/unit/speaker-match.test.mjs.
// The worker pool / embedding front-end are not exercised here (they need a
// browser); reconcilePieces + shouldPiecewise are the testable core.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcilePieces,
  shouldPiecewise,
  PIECEWISE_MIN_SEC,
  SEAM_MERGE_GAP_SEC,
} from '../../app/ui/src/lib/diarizePiecewise.js';

// Orthonormal-ish voiceprints so cosine is ~1 within a speaker, ~0 across.
const A = new Float32Array([1, 0, 0]);
const A2 = new Float32Array([0.98, 0.02, 0]); // same speaker, slightly moved
const B = new Float32Array([0, 1, 0]);
const C = new Float32Array([0, 0, 1]);
const seg = (start, end, speaker) => ({ start, end, speaker });

describe('shouldPiecewise', () => {
  test('engages only above the duration floor AND in auto-detect mode', () => {
    assert.equal(shouldPiecewise(PIECEWISE_MIN_SEC + 1, -1), true);
    assert.equal(shouldPiecewise(PIECEWISE_MIN_SEC - 1, -1), false); // too short
    assert.equal(shouldPiecewise(PIECEWISE_MIN_SEC + 1, 2), false);  // forced count
    assert.equal(shouldPiecewise(PIECEWISE_MIN_SEC + 1, 0), false);  // 0 is not -1
  });
});

describe('reconcilePieces label reconciliation', () => {
  test('same voice in two pieces converges to ONE global label', () => {
    const pieces = [
      { startSec: 0, segments: [seg(0, 5, 0)], embeddings: { 0: A } },
      { startSec: 600, segments: [seg(0, 5, 0)], embeddings: { 0: A2 } },
    ];
    const out = reconcilePieces(pieces);
    assert.equal(out.length, 2);
    assert.equal(out[0].speaker, out[1].speaker); // matched across pieces
    // Times are offset onto the whole-clip timeline.
    assert.equal(out[1].start, 600);
    assert.equal(out[1].end, 605);
  });

  test('a different voice below threshold mints a NEW global label', () => {
    const pieces = [
      { startSec: 0, segments: [seg(0, 5, 0)], embeddings: { 0: A } },
      { startSec: 600, segments: [seg(0, 5, 0)], embeddings: { 0: B } },
    ];
    const out = reconcilePieces(pieces);
    assert.notEqual(out[0].speaker, out[1].speaker);
  });

  test('a local speaker WITHOUT an embedding mints a new label (never a false merge)', () => {
    const pieces = [
      { startSec: 0, segments: [seg(0, 5, 0)], embeddings: { 0: A } },
      // piece 2 has a speaker with too little audio to embed: no entry for label 0.
      { startSec: 600, segments: [seg(0, 0.4, 0)], embeddings: {} },
    ];
    const out = reconcilePieces(pieces);
    assert.equal(out.length, 2);
    assert.notEqual(out[0].speaker, out[1].speaker); // unknown -> its own speaker
  });

  test('non-contiguous local labels {0, 2} reconcile correctly', () => {
    // sherpa can drop a cluster index, and embeddings may miss a present label.
    const pieces = [
      { startSec: 0, segments: [seg(0, 5, 0), seg(5, 10, 1)], embeddings: { 0: A, 1: B } },
      {
        startSec: 600,
        segments: [seg(0, 5, 2), seg(5, 10, 0)], // labels {2, 0}, non-contiguous
        embeddings: { 2: B, 0: A }, // 2 -> B(existing), 0 -> A(existing)
      },
    ];
    const out = reconcilePieces(pieces);
    // Global labels: piece1 speaker0=A, speaker1=B. piece2 local 2==B, local 0==A.
    const gA = out[0].speaker; // A
    const gB = out[1].speaker; // B
    assert.notEqual(gA, gB);
    // piece2 seg(0,5,local2==B) -> gB ; seg(5,10,local0==A) -> gA
    const p2first = out.find((s) => s.start === 600);
    const p2second = out.find((s) => s.start === 605);
    assert.equal(p2first.speaker, gB);
    assert.equal(p2second.speaker, gA);
  });

  test('centroid drifts: a third piece matches the moved running centroid', () => {
    // piece2 folds A2 into A's centroid; piece3's A3 is closer to the mean than to A.
    const A3 = new Float32Array([0.9, 0.1, 0.02]);
    const pieces = [
      { startSec: 0, segments: [seg(0, 5, 0)], embeddings: { 0: A } },
      { startSec: 600, segments: [seg(0, 5, 0)], embeddings: { 0: A2 } },
      { startSec: 1200, segments: [seg(0, 5, 0)], embeddings: { 0: A3 } },
    ];
    const out = reconcilePieces(pieces);
    assert.equal(out[0].speaker, out[1].speaker);
    assert.equal(out[1].speaker, out[2].speaker); // all one speaker
  });
});

describe('reconcilePieces stitching', () => {
  test('segments are offset, relabelled, and sorted by start', () => {
    const pieces = [
      { startSec: 0, segments: [seg(2, 4, 0), seg(0, 1, 1)], embeddings: { 0: A, 1: B } },
      { startSec: 600, segments: [seg(0, 2, 0)], embeddings: { 0: A } },
    ];
    const out = reconcilePieces(pieces);
    // Sorted by absolute start: 0 (label1/B), 2 (label0/A), 600 (A).
    assert.deepEqual(out.map((s) => s.start), [0, 2, 600]);
  });

  test('same-speaker segments across a seam merge only when the gap is under the bridge', () => {
    // piece1 ends at 600 (speaker A), piece2 starts at 600 (speaker A): gap 0 -> merge.
    const pieces = [
      { startSec: 0, segments: [seg(595, 600, 0)], embeddings: { 0: A } },
      { startSec: 600, segments: [seg(0, 5, 0)], embeddings: { 0: A2 } },
    ];
    const merged = reconcilePieces(pieces);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].start, 595);
    assert.equal(merged[0].end, 605);
  });

  test('a big same-speaker gap does NOT merge', () => {
    const pieces = [
      { startSec: 0, segments: [seg(0, 5, 0)], embeddings: { 0: A } },
      { startSec: 600, segments: [seg(0, 5, 0)], embeddings: { 0: A2 } },
    ];
    const out = reconcilePieces(pieces);
    assert.equal(out.length, 2); // 595 s gap >> SEAM_MERGE_GAP_SEC
  });

  test('a small gap between DIFFERENT speakers does not merge', () => {
    const pieces = [
      { startSec: 0, segments: [seg(0, 5, 0), seg(5.1, 8, 1)], embeddings: { 0: A, 1: B } },
    ];
    const out = reconcilePieces(pieces);
    assert.equal(out.length, 2);
  });
});

test('SEAM_MERGE_GAP_SEC mirrors sherpa minDurationOff (0.5 s)', () =>
  assert.equal(SEAM_MERGE_GAP_SEC, 0.5));
