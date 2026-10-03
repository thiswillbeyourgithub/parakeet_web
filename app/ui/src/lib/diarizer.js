// Main-thread client for offline speaker diarization with the Streaming
// Sortformer (app/src/sortformer.js). It returns per-frame speaker
// probabilities, not segments: the caller turns those into turns with
// probsToSegments and keeps them, so changing the speaker count re-segments
// instantly instead of re-running the network.
//
// Where it runs follows the app backend (owner decision):
//   WASM    a dedicated module worker (diarize.worker.js) so a long clip never
//           freezes the UI. The worker is kept between runs and rebuilt only
//           when the model bytes change (another precision) or after a cancel.
//   WebGPU  the main thread, under the html.gpu-run animation pause (gpuRun.js).
//           A worker's WebGPU awaits stall even harder than the page's (measured
//           ~3x worse for the ASR encoder, see CLAUDE.md), so there is no worker
//           to gain. A GPU failure surfaces as an error; it is not silently
//           retried on the CPU.
//
// Cancel: the WASM worker is terminated (an ORT run cannot be interrupted any
// other way); the WebGPU loop stops at the next chunk boundary. Either way the
// pending run rejects with an error carrying `cancelled === true`.
//
// Built with Claude Code.

import { workerReady } from './workerInit.js';
import { acquireGpuRun } from './gpuRun.js';
import { openSortformer } from './sortformerSession.js';
import { loadOrtModule } from '../../../src/backend.js';
import { diarizeProbs } from '../../../src/sortformer.js';

function cancelledError() {
  const err = new Error('diarization cancelled');
  err.cancelled = true;
  return err;
}

// ---- WASM: one worker, one run at a time --------------------------------

let worker = null;
let workerReadyPromise = null; // Promise<Worker>
let workerModels = null;       // the models object the live worker was built from
let pending = null;            // { id, resolve, reject, onProgress }
let runId = 0;
let cancelGen = 0;             // bumped by cancelDiarization, so a cancel during
                               // worker init still stops the run it belongs to

function resetWorker() {
  if (worker) { try { worker.terminate(); } catch (_) { /* ignore */ } }
  worker = null;
  workerReadyPromise = null;
  workerModels = null;
}

function failPending(err) {
  const p = pending;
  pending = null;
  resetWorker();
  if (p) p.reject(err);
}

function ensureWorker(models, { numThreads, ortVariant }) {
  // getDiarizationModels memoises one object per precision, so identity says
  // whether the live worker holds these exact bytes.
  if (workerReadyPromise && workerModels === models) return workerReadyPromise;
  resetWorker();
  workerModels = models;
  workerReadyPromise = (async () => {
    const w = new Worker(new URL('./diarize.worker.js', import.meta.url), { type: 'module' });
    worker = w;
    w.onmessage = (ev) => {
      const m = ev.data || {};
      if (!pending || m.id !== pending.id) return; // init traffic belongs to workerReady
      if (m.type === 'progress') {
        pending.onProgress?.({ done: m.done, total: m.total });
      } else if (m.type === 'result') {
        const p = pending; pending = null;
        p.resolve({ probs: new Float32Array(m.probs), numFrames: m.numFrames, numSpeakers: m.numSpeakers, frameSec: m.frameSec });
      } else if (m.type === 'error') {
        const p = pending; pending = null;
        p.reject(new Error(m.message));
      }
    };
    // Persistent: a worker that dies after init (WASM OOM, uncaught throw)
    // posts no message, so without this the run would hang forever.
    w.onerror = (e) => failPending(new Error((e && e.message) || 'diarization worker error'));
    const ok = await workerReady(w, {
      type: 'init',
      embedBytes: models.embedBytes, stepBytes: models.stepBytes,
      config: models.config, silenceEmbeds: models.silenceEmbeds,
      numThreads, ortVariant,
    }, { label: 'Diarize' });
    if (!ok) throw new Error('diarization worker init failed');
    return w;
  })().catch((err) => { resetWorker(); throw err; });
  return workerReadyPromise;
}

async function runInWorker(pcm16k, models, { numThreads, ortVariant, onProgress }) {
  const gen = cancelGen;
  const w = await ensureWorker(models, { numThreads, ortVariant });
  if (gen !== cancelGen) throw cancelledError();
  const id = ++runId;
  const settled = new Promise((resolve, reject) => { pending = { id, resolve, reject, onProgress }; });
  // Copy so the caller keeps its pcm (the entry reuses it), then transfer the copy.
  const pcm = pcm16k.slice();
  w.postMessage({ type: 'diarize', id, pcm: pcm.buffer }, [pcm.buffer]);
  return settled;
}

// ---- WebGPU: main thread ------------------------------------------------

let gpu = null; // { models, backend, sessionPromise }
let gpuCancelled = false;

function gpuSessions(models, backend) {
  if (gpu && gpu.models === models && gpu.backend === backend) return gpu.sessionPromise;
  const previous = gpu;
  gpu = {
    models, backend,
    sessionPromise: (async () => {
      if (previous) await previous.sessionPromise.then((s) => s.release(), () => {});
      const ort = await loadOrtModule();
      return openSortformer(ort, { backend, embedBytes: models.embedBytes, stepBytes: models.stepBytes, config: models.config });
    })(),
  };
  const mine = gpu;
  mine.sessionPromise.catch(() => { if (gpu === mine) gpu = null; });
  return mine.sessionPromise;
}

async function runOnGpu(pcm16k, models, backend, onProgress) {
  gpuCancelled = false;
  const release = acquireGpuRun();
  try {
    const runner = await gpuSessions(models, backend);
    return await diarizeProbs(pcm16k, {
      config: models.config, silenceEmbeds: models.silenceEmbeds, ...runner,
      onProgress: (p) => {
        // throwing here stops chunkProbs between two chunks
        if (gpuCancelled) throw cancelledError();
        onProgress?.(p);
      },
    });
  } finally {
    release();
  }
}

// ---- API ----------------------------------------------------------------

let busy = false;

/**
 * Speaker-activity probabilities for a whole clip.
 *
 * @param {Float32Array} pcm16k  mono 16 kHz
 * @param {object} opts
 * @param {object} opts.models  getDiarizationModels() result
 * @param {string} opts.backend  the app backend; 'webgpu*' runs on the main thread
 * @param {number} [opts.numThreads]  WASM worker threads
 * @param {string} [opts.ortVariant]  the main thread's ORT runtime variant
 * @param {(p:{done:number,total:number})=>void} [opts.onProgress]  per chunk
 * @returns {Promise<{probs:Float32Array, numFrames:number, numSpeakers:number, frameSec:number}>}
 */
export async function runDiarization(pcm16k, { models, backend, numThreads, ortVariant, onProgress }) {
  if (!(pcm16k instanceof Float32Array) || pcm16k.length === 0) {
    throw new Error('runDiarization: pcm16k must be a non-empty Float32Array');
  }
  // One pending slot per path: a second concurrent run would orphan the
  // first caller's promise. Set before any await or two callers race past it.
  if (busy) throw new Error('diarization already running: one run at a time');
  busy = true;
  try {
    return String(backend).startsWith('webgpu')
      ? await runOnGpu(pcm16k, models, backend, onProgress)
      : await runInWorker(pcm16k, models, { numThreads, ortVariant, onProgress });
  } finally {
    busy = false;
  }
}

/** Abort the in-flight diarization, if any (see the header for how). */
export function cancelDiarization() {
  cancelGen++;
  gpuCancelled = true;
  if (pending) failPending(cancelledError());
}
