// Main-thread client for offline speaker diarization. The heavy, synchronous
// sherpa-onnx WASM `process()` runs in a dedicated Web Worker (diarizer.worker.js)
// so it never freezes the UI; this module fetches + integrity-verifies the engine
// and model bytes, spins up that worker, and brokers the request/response.
//
// sherpa-onnx ships a self-contained WASM build that bundles its OWN ONNX Runtime
// (compiled C++), separate from the app's onnxruntime-web. We load it LAZILY: the
// ~11 MB engine and the ~34 MB of models are fetched only when the user actually
// diarizes, so they never touch the transcription path.
//
// Loading is integrity-preserving, the same posture as the ORT wasm and the PCM
// worklet: every byte the browser evaluates (emscripten glue, JS API wrapper,
// wasm binary) is sha384-verified against the build-time pin in
// /.well-known/asset-integrity.json before it runs (see asset-integrity.js +
// postbuild.mjs). We verify HERE, on the main thread, then hand the verified
// bytes to the worker, which evaluates only those bytes (importScripts of the
// glue/wrapper from blob: URLs, wasm via Module.wasmBinary) -- never a second,
// unverified fetch. pthread workers spawn from the verified glue blob.
//
// The models are NOT vendored: the caller passes the segmentation + embedding
// ONNX bytes (downloaded through the hub, see App.jsx wiring) and the worker
// writes them into the WASM in-memory FS. To avoid re-cloning ~34 MB every run we
// send the model bytes only when they CHANGE; a count-change re-run reuses the
// worker's cached diarizer and only re-applies the clustering knobs.

import { fetchVerifiedAsset } from './asset-integrity.js';

const BASE = '/sherpa-onnx/';
const GLUE = 'sherpa-onnx-wasm-main-speaker-diarization.js';
const WRAPPER = 'sherpa-onnx-speaker-diarization.js';
const WASM = 'sherpa-onnx-wasm-main-speaker-diarization.wasm';

/** The sample rate the engine expects (16 kHz). For callers that resample. */
export const DIARIZATION_SAMPLE_RATE = 16000;

// One worker per page, created lazily and kept warm between runs. A cancel
// terminates it (the only way to stop a synchronous in-flight process); the next
// run lazily rebuilds it.
let _worker = null;
let _workerReady = null;      // Promise<Worker>, resolves when the worker is initialised
let _lastModelIdentity = null; // identity of the models the live worker currently holds
let _runId = 0;
let _pending = null;          // { id, resolve, reject } for the single in-flight run

function resetWorker() {
  if (_worker) { try { _worker.terminate(); } catch (_) { /* ignore */ } }
  _worker = null;
  _workerReady = null;
  _lastModelIdentity = null;
}

// Fetch + verify the engine bytes (main thread), then spawn and initialise the
// worker. Idempotent: concurrent callers share the same in-flight promise.
function ensureWorker() {
  if (_workerReady) return _workerReady;
  _workerReady = (async () => {
    // Verify all three assets up front so we bail before evaluating anything if a
    // byte is off.
    const [glue, wrapper, wasm] = await Promise.all([
      fetchVerifiedAsset(BASE + GLUE, `sherpa-onnx/${GLUE}`),
      fetchVerifiedAsset(BASE + WRAPPER, `sherpa-onnx/${WRAPPER}`),
      fetchVerifiedAsset(BASE + WASM, `sherpa-onnx/${WASM}`),
    ]);

    const worker = new Worker(new URL('./diarizer.worker.js', import.meta.url), { type: 'classic' });
    _worker = worker;

    // Route every message: 'ready'/init-error settle this promise; run results
    // settle the matching _pending run.
    await new Promise((resolve, reject) => {
      worker.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === 'ready') { resolve(); return; }
        if (m.type === 'error' && m.id === undefined) { reject(new Error(m.message)); return; }
        if ((m.type === 'result' || m.type === 'error') && _pending && m.id === _pending.id) {
          const p = _pending; _pending = null;
          if (m.type === 'result') p.resolve(m.segments);
          else p.reject(new Error(m.message));
        }
      };
      worker.onerror = (e) => reject(new Error((e && e.message) || 'diarizer worker error'));
      // Send the verified bytes; the worker copies them (no transfer) so a later
      // rebuild can re-fetch cleanly.
      worker.postMessage({
        type: 'init',
        glueBytes: glue.bytes,
        wrapperBytes: wrapper.bytes,
        wasmBytes: wasm.bytes,
      });
    });
    return worker;
  })().catch((err) => {
    // Failed init: tear down so a retry rebuilds from scratch.
    resetWorker();
    throw err;
  });
  return _workerReady;
}

/**
 * Run offline speaker diarization on 16 kHz mono Float32 PCM, in the worker.
 *
 * @param {Float32Array} pcm16k mono samples at 16 kHz
 * @param {object} opts
 * @param {Uint8Array} opts.segmentationBytes pyannote segmentation-3.0 onnx
 * @param {Uint8Array} opts.embeddingBytes speaker-embedding (CAM++) onnx
 * @param {number} [opts.numSpeakers=-1] exact speaker count, or -1 to auto-detect
 * @param {number} [opts.threshold=0.5] clustering distance threshold (auto mode only)
 * @param {number} [opts.minDurationOn=0.3] drop speech turns shorter than this (s)
 * @param {number} [opts.minDurationOff=0.5] bridge silences shorter than this (s)
 * @param {number} [opts.numThreads] worker threads (default: cores - 1)
 * @returns {Promise<Array<{start:number,end:number,speaker:number}>>} segments
 *   sorted by start time; `speaker` is a 0-based integer label. Rejects with an
 *   error carrying `cancelled === true` when {@link cancelDiarization} aborts it.
 */
export async function runDiarization(pcm16k, {
  segmentationBytes,
  embeddingBytes,
  numSpeakers = -1,
  threshold = 0.5,
  minDurationOn = 0.3,
  minDurationOff = 0.5,
  numThreads,
} = {}) {
  if (!(pcm16k instanceof Float32Array) || pcm16k.length === 0) {
    throw new Error('runDiarization: pcm16k must be a non-empty Float32Array');
  }
  if (!segmentationBytes || !embeddingBytes) {
    throw new Error('runDiarization: segmentationBytes and embeddingBytes are required');
  }

  const worker = await ensureWorker();

  // Send the (large) model bytes only when they differ from what the worker
  // already holds; a count-change re-run then ships just the pcm + new knobs.
  const identity = `${segmentationBytes.byteLength}:${embeddingBytes.byteLength}`;
  const sendModels = identity !== _lastModelIdentity;

  const id = ++_runId;
  const opts = { numSpeakers, threshold, minDurationOn, minDurationOff, numThreads };
  const settled = new Promise((resolve, reject) => { _pending = { id, resolve, reject }; });

  // Copy the pcm so the caller keeps its buffer (App.jsx reuses trans.pcm across
  // re-segmentations); transfer the throwaway copy to skip the structured clone.
  const pcmCopy = pcm16k.slice();
  const payload = { type: 'run', id, pcm: pcmCopy, opts };
  if (sendModels) {
    payload.segBytes = segmentationBytes;
    payload.embBytes = embeddingBytes;
  }
  worker.postMessage(payload, [pcmCopy.buffer]);

  const segments = await settled;
  // Mark models as held only AFTER success: a cancel/terminate before completion
  // discards the worker, so the next run must re-send them.
  _lastModelIdentity = identity;
  return segments;
}

/**
 * Abort an in-flight diarization. A synchronous `process()` cannot observe a
 * message mid-run, so this hard-terminates the worker (killing the WASM compute)
 * and rejects the pending run with an error flagged `cancelled`. The next
 * {@link runDiarization} lazily rebuilds the worker.
 */
export function cancelDiarization() {
  const pending = _pending;
  _pending = null;
  resetWorker();
  if (pending) {
    const err = new Error('diarization cancelled');
    err.cancelled = true;
    pending.reject(err);
  }
}
