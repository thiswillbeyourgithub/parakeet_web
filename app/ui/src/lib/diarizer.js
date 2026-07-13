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
//
// CLIENTS. A page usually needs one worker, but parallel piecewise diarization
// (diarizePiecewise.js) runs a small POOL of workers concurrently. So the state is
// factored into createDiarizerClient() (one worker's worth), and the exported
// runDiarization/cancelDiarization delegate to a lazily-built default client. The
// ~11 MB engine bytes are verified ONCE per page and shared by every client
// (verify once, spawn many). cancelDiarization() aborts EVERY live client.

import { fetchVerifiedAsset } from './asset-integrity.js';

const BASE = '/sherpa-onnx/';
const GLUE = 'sherpa-onnx-wasm-main-speaker-diarization.js';
const WRAPPER = 'sherpa-onnx-speaker-diarization.js';
const WASM = 'sherpa-onnx-wasm-main-speaker-diarization.wasm';

/** The sample rate the engine expects (16 kHz). For callers that resample. */
export const DIARIZATION_SAMPLE_RATE = 16000;

// The ~11 MB engine bytes are fetched + sha384-verified ONCE per page and shared
// by every client. On failure the promise is cleared so a later run can retry.
let _engineBytesPromise = null;
function engineBytes() {
  if (_engineBytesPromise) return _engineBytesPromise;
  _engineBytesPromise = Promise.all([
    fetchVerifiedAsset(BASE + GLUE, `sherpa-onnx/${GLUE}`),
    fetchVerifiedAsset(BASE + WRAPPER, `sherpa-onnx/${WRAPPER}`),
    fetchVerifiedAsset(BASE + WASM, `sherpa-onnx/${WASM}`),
  ]).then(([glue, wrapper, wasm]) => ({ glue: glue.bytes, wrapper: wrapper.bytes, wasm: wasm.bytes }))
    .catch((err) => { _engineBytesPromise = null; throw err; });
  return _engineBytesPromise;
}

// Every live client, so cancelDiarization() can abort the default AND any
// piecewise-pool clients in one call.
const _clients = new Set();

/**
 * Create one diarizer client: a single lazily-spawned worker with its own model
 * cache and single in-flight run. Reusable across runs (a cancel resets it and the
 * next run rebuilds). Registered for global cancel until dispose()d.
 *
 * @returns {{run:(pcm16k:Float32Array, opts:object)=>Promise<Array>, cancel:()=>void, dispose:()=>void}}
 */
export function createDiarizerClient() {
  let worker = null;
  let workerReady = null;       // Promise<Worker>, resolves when initialised
  let lastModelIdentity = null; // identity of the models the live worker holds
  let runId = 0;
  let pending = null;           // { id, resolve, reject } for the single in-flight run

  function reset() {
    if (worker) { try { worker.terminate(); } catch (_) { /* ignore */ } }
    worker = null;
    workerReady = null;
    lastModelIdentity = null;
  }

  // Spawn + initialise the worker from the shared verified engine bytes.
  // Idempotent: concurrent callers share the same in-flight promise.
  function ensureWorker() {
    if (workerReady) return workerReady;
    workerReady = (async () => {
      const { glue, wrapper, wasm } = await engineBytes();
      const w = new Worker(new URL('./diarizer.worker.js', import.meta.url), { type: 'classic' });
      worker = w;
      // One persistent handler: 'ready'/init-error settle this promise; run
      // results settle the matching in-flight run by id.
      await new Promise((resolve, reject) => {
        w.onmessage = (ev) => {
          const m = ev.data || {};
          if (m.type === 'ready') { resolve(); return; }
          if (m.type === 'error' && m.id === undefined) { reject(new Error(m.message)); return; }
          if ((m.type === 'result' || m.type === 'error') && pending && m.id === pending.id) {
            const p = pending; pending = null;
            if (m.type === 'result') p.resolve(m.segments);
            else p.reject(new Error(m.message));
          }
        };
        w.onerror = (e) => reject(new Error((e && e.message) || 'diarizer worker error'));
        // Send the verified bytes; the worker copies them (no transfer) so a later
        // rebuild can re-init cleanly.
        w.postMessage({ type: 'init', glueBytes: glue, wrapperBytes: wrapper, wasmBytes: wasm });
      });
      return w;
    })().catch((err) => {
      // Failed init: tear down so a retry rebuilds from scratch.
      reset();
      throw err;
    });
    return workerReady;
  }

  async function run(pcm16k, {
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

    const w = await ensureWorker();

    // Send the (large) model bytes only when they differ from what the worker
    // already holds; a count-change re-run then ships just the pcm + new knobs.
    const identity = `${segmentationBytes.byteLength}:${embeddingBytes.byteLength}`;
    const sendModels = identity !== lastModelIdentity;

    const id = ++runId;
    const opts = { numSpeakers, threshold, minDurationOn, minDurationOff, numThreads };
    const settled = new Promise((resolve, reject) => { pending = { id, resolve, reject }; });

    // Copy the pcm so the caller keeps its buffer (App.jsx reuses trans.pcm across
    // re-segmentations, and the piecewise pool passes SUBARRAY VIEWS of one shared
    // buffer); transfer the throwaway copy to skip the structured clone. Never
    // transfer the caller's buffer: it would detach every other piece's view.
    const pcmCopy = pcm16k.slice();
    const payload = { type: 'run', id, pcm: pcmCopy, opts };
    if (sendModels) {
      payload.segBytes = segmentationBytes;
      payload.embBytes = embeddingBytes;
    }
    w.postMessage(payload, [pcmCopy.buffer]);

    const segments = await settled;
    // Mark models as held only AFTER success: a cancel/terminate before completion
    // discards the worker, so the next run must re-send them.
    lastModelIdentity = identity;
    return segments;
  }

  // Abort an in-flight run (hard-terminate the worker, reject pending as
  // cancelled). The client stays reusable: the next run() rebuilds the worker.
  function cancel() {
    const p = pending;
    pending = null;
    reset();
    if (p) {
      const err = new Error('diarization cancelled');
      err.cancelled = true;
      p.reject(err);
    }
  }

  // cancel() + drop from the global registry. Used by the piecewise pool to retire
  // its extra clients when a run finishes.
  function dispose() {
    cancel();
    _clients.delete(client);
  }

  const client = { run, cancel, dispose };
  _clients.add(client);
  return client;
}

// Lazily-built default client backing the single-run convenience API.
let _defaultClient = null;
function defaultClient() {
  if (!_defaultClient) _defaultClient = createDiarizerClient();
  return _defaultClient;
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
export function runDiarization(pcm16k, opts = {}) {
  return defaultClient().run(pcm16k, opts);
}

/**
 * Abort every in-flight diarization. A synchronous `process()` cannot observe a
 * message mid-run, so each client hard-terminates its worker (killing the WASM
 * compute) and rejects its pending run with an error flagged `cancelled`. The next
 * {@link runDiarization} (and any new pool) lazily rebuilds.
 */
export function cancelDiarization() {
  for (const c of Array.from(_clients)) c.cancel();
}
