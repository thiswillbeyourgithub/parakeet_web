// Tier-1 unit test for the mel front-end DSP primitives (app/src/mel.js).
// The radix-2 FFT is validated against a naive O(N^2) DFT (the ground-truth
// reference) within a tight numeric tolerance, and the mel<->hz scale is
// checked for invertibility plus the known librosa "slaney" breakpoint.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  hzToMel, melToHz, precomputeTwiddles, fft, createPaddedHannWindow, MEL_CONSTANTS,
} from '../../app/src/mel.js';

// Reference DFT: X[k] = sum_n x[n] * e^{-2pi i k n / N}.
function naiveDFT(re, im, N) {
  const outRe = new Float64Array(N), outIm = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    let sr = 0, si = 0;
    for (let n = 0; n < N; n++) {
      const ang = (-2 * Math.PI * k * n) / N;
      const c = Math.cos(ang), s = Math.sin(ang);
      sr += re[n] * c - im[n] * s;
      si += re[n] * s + im[n] * c;
    }
    outRe[k] = sr; outIm[k] = si;
  }
  return { outRe, outIm };
}

describe('fft matches a naive DFT (ground truth)', () => {
  for (const N of [8, 16, 64, 256]) {
    test(`N=${N} random signal`, () => {
      const re = new Float64Array(N), im = new Float64Array(N);
      // Deterministic pseudo-random input so failures are reproducible.
      let seed = 1234567 + N;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
      const refRe = new Float64Array(N), refIm = new Float64Array(N);
      for (let i = 0; i < N; i++) { re[i] = refRe[i] = rnd(); im[i] = refIm[i] = rnd(); }

      const tw = precomputeTwiddles(N);
      fft(re, im, N, tw); // in place

      const { outRe, outIm } = naiveDFT(refRe, refIm, N);
      const scale = N; // tolerance scales with the magnitude of the transform
      for (let k = 0; k < N; k++) {
        assert.ok(Math.abs(re[k] - outRe[k]) < 1e-9 * scale, `re[${k}]`);
        assert.ok(Math.abs(im[k] - outIm[k]) < 1e-9 * scale, `im[${k}]`);
      }
    });
  }

  test('rejects a non power-of-two size', () => {
    assert.throws(() => precomputeTwiddles(48), /power-of-two/);
  });

  test('a pure DC signal transforms to a single non-zero bin', () => {
    const N = 16;
    const re = new Float64Array(N).fill(1), im = new Float64Array(N);
    fft(re, im, N, precomputeTwiddles(N));
    assert.ok(Math.abs(re[0] - N) < 1e-9, 'DC bin equals N');
    for (let k = 1; k < N; k++) assert.ok(Math.abs(re[k]) < 1e-9 && Math.abs(im[k]) < 1e-9);
  });
});

describe('mel <-> hz scale', () => {
  test('round-trips within tolerance across the audible range', () => {
    for (const hz of [0, 100, 700, 1000, 4000, 8000]) {
      assert.ok(Math.abs(melToHz(hzToMel(hz)) - hz) < 1e-6, `hz=${hz}`);
    }
  });
  test('is monotonically increasing', () => {
    let prev = -Infinity;
    for (let hz = 0; hz <= 8000; hz += 250) {
      const m = hzToMel(hz);
      assert.ok(m > prev, `non-monotonic at ${hz}`);
      prev = m;
    }
  });
  test('linear below the 1 kHz slaney breakpoint, log above', () => {
    // Below 1000 Hz the scale is linear (hz / 200/3), so doubling hz doubles mel.
    assert.ok(Math.abs(hzToMel(600) - 2 * hzToMel(300)) < 1e-9);
    // Above the breakpoint the spacing compresses: an octave is < 2x in mels.
    assert.ok(hzToMel(8000) < 2 * hzToMel(4000));
  });
});

describe('createPaddedHannWindow', () => {
  test('produces N_FFT samples: zero-padded Hann centred in the buffer', () => {
    const { N_FFT, WIN_LENGTH } = MEL_CONSTANTS;
    const win = createPaddedHannWindow();
    assert.equal(win.length, N_FFT);
    const padLeft = (N_FFT - WIN_LENGTH) >> 1; // 56
    // The pad region and the Hann endpoints are ~0; the centre of the buffer
    // (centre of the Hann) peaks at ~1.
    assert.ok(win[0] < 1e-9, 'left pad is zero');
    assert.ok(win[padLeft] < 1e-6, 'Hann start ~0');
    assert.ok(win[N_FFT - 1] < 1e-9, 'right pad is zero');
    assert.ok(win[N_FFT >> 1] > 0.99, 'centre peaks near 1');
  });
});
