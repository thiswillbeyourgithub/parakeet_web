// Per-speaker CAM++ voice embeddings, computed in-browser for cross-recording
// speaker matching (session-only feature). The vendored sherpa-onnx diarization
// WASM returns only {start,end,speaker} segments and exposes no embedding API,
// so we run the SAME CAM++ embedding model the diarizer uses (already downloaded
// by diarizationModels.js) ourselves through the app's ONE ORT instance
// (backend.js loadOrtModule, never a direct onnxruntime-web import, or this
// path silently loses voice matching whenever the runtime variant moves): gather
// each speaker's segment audio, compute the shared 80-dim kaldi fbank
// (app/src/fbank.js), and run the model (x=[1,T,80] -> embedding=[1,192]).
//
// Pure feature maths live in fbank.js (unit-tested) and the matching in
// speakerMatch.js (unit-tested); embedding quality is validated end to end by
// scripts/speaker-embedding-check.mjs. Embeddings are kept in memory only and
// never persisted (voiceprints are biometric).

import { computeFbank, FBANK_NUM_BINS, FBANK_SAMPLE_RATE } from '../../../src/fbank.js';
import { loadOrtModule } from '../../../src/backend.js';

let _sessionPromise = null;   // Promise<InferenceSession>, not the session itself
let _sessionKey = null;

/**
 * The one ORT session for the CAM++ embedding model, built lazily and reused.
 *
 * Memoising the PROMISE rather than the resolved session matters: `getSession`
 * is async, and App.jsx can have two embedding passes in flight (a diarization
 * finishing while the user re-segments). Keyed on the resolved value, both saw
 * a null cache, both built a ~28 MB session, and one of them was overwritten
 * and leaked. A key change now also releases the session it replaces, and a
 * failed build clears the memo so the next caller retries instead of inheriting
 * the rejection.
 *
 * @param {Uint8Array} embeddingBytes CAM++ ONNX bytes.
 * @param {() => Promise<object>} [loadOrt] ORT module loader; injectable for
 *   the unit test, which has no runtime to build a real session with.
 * @returns {Promise<object>} the InferenceSession.
 */
function getSession(embeddingBytes, loadOrt = loadOrtModule) {
  // The embedding model is fixed for a session; key on byte length (cheap) so we
  // build the session once. Diarization always runs on the CPU/WASM EP here; the
  // model is small (~28 MB) and this stays off the GPU path.
  const key = `${embeddingBytes.byteLength}`;
  if (_sessionPromise && _sessionKey === key) return _sessionPromise;
  const stale = _sessionKey === key ? null : _sessionPromise;
  const inflight = (async () => {
    const ort = await loadOrt();
    return ort.InferenceSession.create(embeddingBytes, { executionProviders: ['wasm'] });
  })().catch((err) => {
    if (_sessionPromise === inflight) { _sessionPromise = null; _sessionKey = null; }
    throw err;
  });
  _sessionPromise = inflight;
  _sessionKey = key;
  // Free the model it replaces rather than leaving its weights resident for the
  // life of the tab. Best effort: a failed release must not fail the new build.
  if (stale) stale.then((s) => s?.release?.()).catch(() => {});
  return inflight;
}

// Exported for the unit test only: the property that matters is how the cache
// behaves under concurrency and across a key change, which needs no real ORT.
export const _getEmbeddingSession = getSession;

/** Test-only: drop the memoised session so cases start from a cold cache. */
export function _resetEmbeddingSession() {
  _sessionPromise = null;
  _sessionKey = null;
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

  const ort = await loadOrtModule();
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
