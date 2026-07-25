// Parent-side client for the diarization worker: locates the two ONNX models,
// prepares the engine's CJS bootstrap copy, and brokers one run at a time.
//
// The engine bytes are the ones the browser app already vendors
// (app/ui/public/sherpa-onnx/): a self-contained sherpa-onnx WASM build with its
// own ONNX Runtime inside. Nothing is duplicated here -- the .cjs copy this
// module writes is a runtime copy of those exact vendored bytes, needed only
// because emscripten's pthread bootstrap must be loadable as CommonJS (see the
// long note in diarize.worker.mjs).
//
// The worker is started LAZILY on the first diarizing request, so an instance
// that never diarizes never pays the ~11 MB engine + ~34 MB model load.
//
// Built with Claude Code.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { unavailable } from './errors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// app/ui/public/sherpa-onnx/, relative to scripts/openai-like-server/lib/
const ENGINE_DIR = join(HERE, '..', '..', '..', 'app', 'ui', 'public', 'sherpa-onnx');
const GLUE = 'sherpa-onnx-wasm-main-speaker-diarization.js';
const WRAPPER = 'sherpa-onnx-speaker-diarization.js';
const WASM = 'sherpa-onnx-wasm-main-speaker-diarization.wasm';

/** Sherpa's default pyannote segmentation filename in the model repos. */
const SEG_DEFAULT = 'model.onnx';
/** CAM++ embedding models are published with this shape of name. */
const EMB_PATTERN = /campplus.*\.onnx$/i;

/**
 * Resolve the diarization model paths, preferring explicit options and falling
 * back to well-known names inside the main model directory.
 *
 * @returns {{segPath:string, embPath:string}}
 * @throws {Error} naming exactly what is missing and how to fetch it
 */
export function resolveDiarizationModels({ modelDir, segModel, embModel }) {
  const segPath = segModel || join(modelDir, SEG_DEFAULT);
  let embPath = embModel;
  if (!embPath) {
    const hit = safeReaddir(modelDir).find((f) => EMB_PATTERN.test(f));
    embPath = hit ? join(modelDir, hit) : '';
  }
  const missing = [];
  if (!segPath || !existsSync(segPath)) {
    missing.push(`pyannote segmentation model (looked for ${segPath || `${modelDir}/${SEG_DEFAULT}`}; `
      + 'set --diarize-seg-model, or fetch csukuangfj/sherpa-onnx-pyannote-segmentation-3-0)');
  }
  if (!embPath || !existsSync(embPath)) {
    missing.push(`CAM++ speaker-embedding model (looked for ${modelDir}/*campplus*.onnx; `
      + 'set --diarize-emb-model, or fetch it from csukuangfj/speaker-embedding-models)');
  }
  if (missing.length) throw new Error(`diarization is enabled but ${missing.join(' and ')}`);
  return { segPath, embPath };
}

function safeReaddir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

/** Check the vendored engine files are present (they are git-tracked, so this only fails on a broken checkout). */
export function assertEnginePresent() {
  for (const f of [GLUE, WRAPPER, WASM]) {
    const p = join(ENGINE_DIR, f);
    if (!existsSync(p)) throw new Error(`missing vendored diarization engine file ${p}`);
  }
}

/**
 * Create the diarizer client.
 *
 * @param {object} opts
 * @param {string} opts.segPath pyannote segmentation ONNX
 * @param {string} opts.embPath CAM++ embedding ONNX
 * @param {number} opts.threads engine thread count
 * @param {boolean} [opts.verbose]
 */
export function createDiarizer({ segPath, embPath, threads = 1, verbose = false }) {
  let worker = null;
  let ready = null;
  let bootstrapDir = null;
  let nextId = 1;
  const pending = new Map();

  // One .cjs copy of the vendored glue per process (see module header).
  function bootstrapGlue() {
    if (bootstrapDir) return join(bootstrapDir, 'sherpa-glue.cjs');
    bootstrapDir = mkdtempSync(join(tmpdir(), 'parakeet-diarize-'));
    const dest = join(bootstrapDir, 'sherpa-glue.cjs');
    // Read + write rather than copyFile so it is obvious this is a byte copy of
    // the vendored, git-tracked engine and not a second source of truth.
    writeFileSync(dest, readFileSync(join(ENGINE_DIR, GLUE)));
    return dest;
  }

  function start() {
    if (ready) return ready;
    assertEnginePresent();
    ready = new Promise((resolve, reject) => {
      const w = new Worker(new URL('./diarize.worker.mjs', import.meta.url), {
        workerData: {
          gluePathCjs: bootstrapGlue(),
          wrapperPath: join(ENGINE_DIR, WRAPPER),
          wasmPath: join(ENGINE_DIR, WASM),
          segPath,
          embPath,
          threads,
        },
      });
      let initialised = false;
      w.on('message', (msg) => {
        if (msg.type === 'ready') {
          initialised = true;
          if (verbose) console.error('[diarize] engine ready');
          resolve(w);
          return;
        }
        if (msg.type === 'result' || msg.type === 'error') {
          if (msg.id === undefined) {                    // init-time failure
            reject(new Error(msg.message));
            return;
          }
          const entry = pending.get(msg.id);
          if (!entry) return;
          pending.delete(msg.id);
          if (msg.type === 'result') entry.resolve(msg.segments);
          else entry.reject(new Error(msg.message));
        }
      });
      w.on('error', (err) => {
        if (!initialised) reject(err);
        failAll(err);
      });
      w.on('exit', (code) => {
        const err = new Error(`diarization worker exited (code ${code})`);
        if (!initialised) reject(err);
        failAll(err);
        // Drop the handle so the NEXT request rebuilds the engine from scratch
        // instead of posting into a dead worker forever.
        worker = null;
        ready = null;
      });
      worker = w;
    });
    return ready;
  }

  function failAll(err) {
    for (const [, entry] of pending) entry.reject(err);
    pending.clear();
  }

  /**
   * Diarize 16 kHz mono PCM.
   *
   * The PCM is CLONED into the worker rather than transferred: the caller's
   * Float32Array stays valid, so the order of the transcribe/diarize steps in
   * engine.mjs is free to change without a detached-buffer bug appearing at a
   * distance. At 16 kHz the copy is ~3.8 MB per audio minute, far below the cost
   * of the diarization itself.
   *
   * @returns {Promise<Array<{start:number,end:number,speaker:number}>>}
   */
  async function run(pcm, opts = {}) {
    let w;
    try {
      w = await start();
    } catch (err) {
      throw unavailable(`diarization engine failed to start: ${err.message}`);
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ type: 'run', id, pcm, opts });
    });
  }

  async function dispose() {
    if (worker) {
      await worker.terminate().catch(() => { /* going away regardless */ });
      worker = null;
      ready = null;
    }
    if (bootstrapDir) {
      try { rmSync(bootstrapDir, { recursive: true, force: true }); } catch { /* tmpfs */ }
      bootstrapDir = null;
    }
  }

  return { run, dispose, get started() { return ready !== null; } };
}
