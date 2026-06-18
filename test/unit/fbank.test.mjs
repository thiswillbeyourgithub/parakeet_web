// Unit coverage for the kaldi-compatible 80-dim fbank front-end
// (app/src/fbank.js) that feeds the CAM++ speaker-embedding model used by the
// cross-recording speaker-matching feature. The full embedding quality is
// proven by scripts/speaker-embedding-check.mjs (same-speaker cosine >> cross),
// which needs the model + a fixture; these tests pin the pure feature maths:
// frame geometry, the global-mean normalization, determinism, and that the mel
// mapping puts a tone's energy in the right (monotonically increasing) bin.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFbank, FBANK_NUM_BINS, FBANK_SAMPLE_RATE } from '../../app/src/fbank.js';

const FRAME_LEN = 400;   // 25 ms @ 16 kHz (matches fbank.js)
const FRAME_SHIFT = 160; // 10 ms

function tone(freqHz, durSec) {
  const n = Math.floor(durSec * FBANK_SAMPLE_RATE);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * freqHz * i) / FBANK_SAMPLE_RATE);
  return x;
}

// Average each of the 80 bins over all frames, then return the argmax bin.
function peakBin(feats, T) {
  const avg = new Float64Array(FBANK_NUM_BINS);
  for (let t = 0; t < T; t++) {
    for (let b = 0; b < FBANK_NUM_BINS; b++) avg[b] += feats[t * FBANK_NUM_BINS + b];
  }
  let best = 0;
  for (let b = 1; b < FBANK_NUM_BINS; b++) if (avg[b] > avg[best]) best = b;
  return best;
}

describe('computeFbank', () => {
  test('frame geometry: T = 1 + floor((len - 400) / 160), feats is [T, 80]', () => {
    const len = FRAME_LEN + 5 * FRAME_SHIFT + 37; // not a clean multiple
    const { feats, T } = computeFbank(new Float32Array(len), { normalize: false });
    assert.equal(T, 1 + Math.floor((len - FRAME_LEN) / FRAME_SHIFT));
    assert.equal(feats.length, T * FBANK_NUM_BINS);
  });

  test('input shorter than one frame yields no frames', () => {
    const { feats, T } = computeFbank(new Float32Array(FRAME_LEN - 1));
    assert.equal(T, 0);
    assert.equal(feats.length, 0);
  });

  test('accepts a plain array, not just Float32Array', () => {
    const { T } = computeFbank(Array.from(tone(440, 0.05)), { normalize: false });
    assert.ok(T > 0);
  });

  test('is deterministic for the same input', () => {
    const x = tone(440, 0.2);
    const a = computeFbank(x);
    const b = computeFbank(x);
    assert.deepEqual(a.feats, b.feats);
  });

  test('produces only finite values', () => {
    const { feats } = computeFbank(tone(1000, 0.2), { normalize: false });
    for (const v of feats) assert.ok(Number.isFinite(v));
  });

  test('global-mean normalization zeroes each dimension mean over time', () => {
    const { feats, T } = computeFbank(tone(1000, 0.3)); // normalize defaults to true
    for (let b = 0; b < FBANK_NUM_BINS; b++) {
      let m = 0;
      for (let t = 0; t < T; t++) m += feats[t * FBANK_NUM_BINS + b];
      m /= T;
      assert.ok(Math.abs(m) < 1e-4, `dim ${b} mean ${m} not ~0`);
    }
  });

  test('normalize:false leaves a non-zero per-dimension mean', () => {
    const { feats, T } = computeFbank(tone(1000, 0.3), { normalize: false });
    let maxAbsMean = 0;
    for (let b = 0; b < FBANK_NUM_BINS; b++) {
      let m = 0;
      for (let t = 0; t < T; t++) m += feats[t * FBANK_NUM_BINS + b];
      maxAbsMean = Math.max(maxAbsMean, Math.abs(m / T));
    }
    assert.ok(maxAbsMean > 0.1, 'raw fbank should not be mean-centered');
  });

  test('a tone concentrates energy near its mel bin (~1 kHz -> bin ~27)', () => {
    const { feats, T } = computeFbank(tone(1000, 0.3), { normalize: false });
    const bin = peakBin(feats, T);
    assert.ok(bin >= 23 && bin <= 31, `1 kHz peak landed in bin ${bin}, expected ~27`);
  });

  test('a higher tone peaks in a higher mel bin (mel mapping is monotone)', () => {
    const low = computeFbank(tone(500, 0.3), { normalize: false });
    const high = computeFbank(tone(2500, 0.3), { normalize: false });
    const lowBin = peakBin(low.feats, low.T);
    const highBin = peakBin(high.feats, high.T);
    assert.ok(highBin > lowBin, `expected 2500 Hz bin (${highBin}) > 500 Hz bin (${lowBin})`);
  });
});
