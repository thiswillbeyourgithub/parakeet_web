// Kaldi-compatible 80-dim log-mel filterbank (fbank) front-end, matching the
// kaldi-native-fbank defaults that sherpa-onnx / 3d-speaker use to feed the
// CAM++ speaker-embedding model: 25 ms / 10 ms frames, povey window,
// pre-emphasis 0.97, DC removal, power spectrum, 80 triangular mel bins
// (low 20 Hz, high 8 kHz), log mel energies, snip_edges. The CAM++ ONNX takes
// x = [N, T, 80] with feature_normalize_type = global-mean, so computeFbank also
// subtracts the per-dimension mean over time (the "global mean") by default.
//
// Pure and dependency-free so the exact same front-end backs both the browser
// speaker-embedding path (app/ui/src/lib/speakerEmbedding.js, onnxruntime-web)
// and the Node validation script (scripts/speaker-embedding-check.mjs,
// onnxruntime-node). Unit-tested in test/unit/fbank.test.mjs.

export const FBANK_SAMPLE_RATE = 16000;
export const FBANK_NUM_BINS = 80;

const FRAME_LEN = 400;   // 25 ms @ 16 kHz
const FRAME_SHIFT = 160; // 10 ms @ 16 kHz
const NFFT = 512;        // next power of two >= FRAME_LEN
const LOW_FREQ = 20;
const HIGH_FREQ = 8000;
const PREEMPH = 0.97;
// float32 epsilon: kaldi floors mel energies here before the log.
const LOG_FLOOR = 1.1920928955078125e-7;

// Povey window: (0.5 - 0.5 cos(2*pi*i/(N-1)))^0.85, kaldi's default for fbank.
const poveyWindow = (() => {
  const w = new Float32Array(FRAME_LEN);
  for (let i = 0; i < FRAME_LEN; i++) {
    w[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_LEN - 1)), 0.85);
  }
  return w;
})();

const hzToMel = (f) => 1127 * Math.log(1 + f / 700);

// Triangular mel filters over the FFT bins [0, NFFT/2). kaldi excludes the
// nyquist bin and maps fft bin i to frequency i * (sampleRate / NFFT).
const melFilters = (() => {
  const numFftBins = NFFT / 2; // 256
  const fftBinWidth = FBANK_SAMPLE_RATE / NFFT; // 31.25 Hz
  const melLow = hzToMel(LOW_FREQ);
  const melHigh = hzToMel(HIGH_FREQ);
  const melDelta = (melHigh - melLow) / (FBANK_NUM_BINS + 1);
  const filters = [];
  for (let b = 0; b < FBANK_NUM_BINS; b++) {
    const leftMel = melLow + b * melDelta;
    const centerMel = melLow + (b + 1) * melDelta;
    const rightMel = melLow + (b + 2) * melDelta;
    const weights = new Float32Array(numFftBins);
    for (let i = 0; i < numFftBins; i++) {
      const mel = hzToMel(fftBinWidth * i);
      let w = 0;
      if (mel > leftMel && mel <= centerMel) w = (mel - leftMel) / (centerMel - leftMel);
      else if (mel > centerMel && mel < rightMel) w = (rightMel - mel) / (rightMel - centerMel);
      weights[i] = w;
    }
    filters.push(weights);
  }
  return filters;
})();

// In-place iterative radix-2 FFT over split real/imaginary arrays of length NFFT.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const oRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const oIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        const eRe = re[i + k];
        const eIm = im[i + k];
        re[i + k] = eRe + oRe;
        im[i + k] = eIm + oIm;
        re[i + k + half] = eRe - oRe;
        im[i + k + half] = eIm - oIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

/**
 * Compute kaldi-compatible 80-dim log-mel fbank features for mono 16 kHz PCM.
 *
 * @param {Float32Array} pcm mono samples at 16 kHz, in [-1, 1]
 * @param {object} [opts]
 * @param {boolean} [opts.normalize=true] subtract the per-dimension mean over
 *   time (the CAM++ "global-mean" normalization). Pass false for raw log fbank.
 * @returns {{feats: Float32Array, T: number}} row-major [T, 80] features and the
 *   frame count T (0 when the input is shorter than one frame).
 */
export function computeFbank(pcm, { normalize = true } = {}) {
  if (!(pcm instanceof Float32Array)) pcm = Float32Array.from(pcm || []);
  if (pcm.length < FRAME_LEN) return { feats: new Float32Array(0), T: 0 };

  const T = 1 + Math.floor((pcm.length - FRAME_LEN) / FRAME_SHIFT);
  const feats = new Float32Array(T * FBANK_NUM_BINS);
  const re = new Float32Array(NFFT);
  const im = new Float32Array(NFFT);
  const frame = new Float32Array(FRAME_LEN);
  const numFftBins = NFFT / 2;

  for (let t = 0; t < T; t++) {
    const base = t * FRAME_SHIFT;
    for (let i = 0; i < FRAME_LEN; i++) frame[i] = pcm[base + i];
    // remove DC offset
    let mean = 0;
    for (let i = 0; i < FRAME_LEN; i++) mean += frame[i];
    mean /= FRAME_LEN;
    for (let i = 0; i < FRAME_LEN; i++) frame[i] -= mean;
    // pre-emphasis (high index first; index 0 uses itself), then povey window
    for (let i = FRAME_LEN - 1; i > 0; i--) frame[i] -= PREEMPH * frame[i - 1];
    frame[0] -= PREEMPH * frame[0];
    im.fill(0);
    for (let i = 0; i < FRAME_LEN; i++) re[i] = frame[i] * poveyWindow[i];
    for (let i = FRAME_LEN; i < NFFT; i++) re[i] = 0;
    fft(re, im);
    // power spectrum -> mel -> log
    for (let b = 0; b < FBANK_NUM_BINS; b++) {
      const wts = melFilters[b];
      let e = 0;
      for (let i = 0; i < numFftBins; i++) {
        const w = wts[i];
        if (w !== 0) e += w * (re[i] * re[i] + im[i] * im[i]);
      }
      feats[t * FBANK_NUM_BINS + b] = Math.log(Math.max(e, LOG_FLOOR));
    }
  }

  if (normalize) {
    for (let b = 0; b < FBANK_NUM_BINS; b++) {
      let m = 0;
      for (let t = 0; t < T; t++) m += feats[t * FBANK_NUM_BINS + b];
      m /= T;
      for (let t = 0; t < T; t++) feats[t * FBANK_NUM_BINS + b] -= m;
    }
  }

  return { feats, T };
}
