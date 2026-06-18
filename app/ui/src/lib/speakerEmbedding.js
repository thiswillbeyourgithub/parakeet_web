// Per-speaker CAM++ voice embeddings, computed in-browser for cross-recording
// speaker matching (session-only feature). The vendored sherpa-onnx diarization
// WASM returns only {start,end,speaker} segments and exposes no embedding API,
// so we run the SAME CAM++ embedding model the diarizer uses (already downloaded
// by diarizationModels.js) ourselves through the app's onnxruntime-web: gather
// each speaker's segment audio, compute the shared 80-dim kaldi fbank
// (app/src/fbank.js), and run the model (x=[1,T,80] -> embedding=[1,192]).
//
// Pure feature maths live in fbank.js (unit-tested) and the matching in
// speakerMatch.js (unit-tested); embedding quality is validated end to end by
// scripts/speaker-embedding-check.mjs. Embeddings are kept in memory only and
// never persisted (voiceprints are biometric).

import { computeFbank, FBANK_NUM_BINS, FBANK_SAMPLE_RATE } from '../../../src/fbank.js';

let _ort = null;
let _session = null;
let _sessionKey = null;

async function getOrt() {
  if (_ort) return _ort;
  const m = await import('onnxruntime-web');
  let ort = m.default || m;
  if (!ort.env && m.ort) ort = m.ort;
  if (!ort || !ort.env) throw new Error('onnxruntime-web unavailable for speaker embedding');
  _ort = ort;
  return ort;
}

async function getSession(embeddingBytes) {
  // The embedding model is fixed for a session; key on byte length (cheap) so we
  // build the session once. Diarization always runs on the CPU/WASM EP here; the
  // model is small (~28 MB) and this stays off the GPU path.
  const key = `${embeddingBytes.byteLength}`;
  if (_session && _sessionKey === key) return _session;
  const ort = await getOrt();
  _session = await ort.InferenceSession.create(embeddingBytes, { executionProviders: ['wasm'] });
  _sessionKey = key;
  return _session;
}

// Concatenate up to `cap` samples of a speaker's segment audio into one buffer.
function gatherSpeakerAudio(pcm16k, ranges, cap) {
  let total = 0;
  const parts = [];
  for (const [s, e] of ranges) {
    if (total >= cap) break;
    const take = Math.min(e - s, cap - total);
    if (take <= 0) continue;
    parts.push(pcm16k.subarray(s, s + take));
    total += take;
  }
  if (total === 0) return new Float32Array(0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/**
 * Compute one CAM++ embedding per speaker from a recording's PCM + diarization
 * segments.
 *
 * @param {Float32Array} pcm16k mono 16 kHz samples
 * @param {Array<{start:number,end:number,speaker:number}>} segments
 * @param {Uint8Array} embeddingBytes the CAM++ ONNX model bytes
 * @param {object} [opts]
 * @param {number} [opts.maxSecondsPerSpeaker=20] cap on audio embedded per speaker
 * @param {number} [opts.minSeconds=1.0] skip speakers with less audio than this
 * @returns {Promise<Object<number,Float32Array>>} speakerIndex -> 192-dim embedding
 */
export async function embedSpeakers(pcm16k, segments, embeddingBytes, {
  maxSecondsPerSpeaker = 20,
  minSeconds = 1.0,
} = {}) {
  if (!(pcm16k instanceof Float32Array) || !pcm16k.length) return {};
  if (!Array.isArray(segments) || segments.length === 0) return {};
  if (!embeddingBytes || !embeddingBytes.byteLength) return {};

  const SR = FBANK_SAMPLE_RATE;
  const cap = Math.floor(maxSecondsPerSpeaker * SR);
  const minSamples = Math.floor(minSeconds * SR);

  // Group each speaker's [startSample, endSample) ranges (in time order).
  const bySpeaker = new Map();
  for (const seg of segments) {
    const s = Math.max(0, Math.floor(seg.start * SR));
    const e = Math.min(pcm16k.length, Math.floor(seg.end * SR));
    if (e <= s) continue;
    if (!bySpeaker.has(seg.speaker)) bySpeaker.set(seg.speaker, []);
    bySpeaker.get(seg.speaker).push([s, e]);
  }

  const ort = await getOrt();
  const session = await getSession(embeddingBytes);
  const inName = session.inputNames[0];
  const outName = session.outputNames[0];

  const result = {};
  for (const [speaker, ranges] of bySpeaker) {
    const audio = gatherSpeakerAudio(pcm16k, ranges, cap);
    if (audio.length < minSamples) continue;
    const { feats, T } = computeFbank(audio);
    if (T === 0) continue;
    const x = new ort.Tensor('float32', feats, [1, T, FBANK_NUM_BINS]);
    const out = await session.run({ [inName]: x });
    result[speaker] = Float32Array.from(out[outName].data);
  }
  return result;
}
