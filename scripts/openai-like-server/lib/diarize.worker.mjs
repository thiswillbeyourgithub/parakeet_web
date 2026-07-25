// worker_thread that runs the vendored sherpa-onnx speaker-diarization WASM.
//
// WHY A WORKER: sherpa's `process()` is one synchronous WASM call over the whole
// recording (seconds to minutes). On the main thread it would block the event
// loop for that entire time -- /health would hang, uploads in flight would
// stall, and the HTTP server would look dead. This mirrors the browser design
// (app/ui/src/lib/diarizer.worker.js keeps the same call off the UI thread) for
// the same reason.
//
// Unlike the browser worker, this one reads the ONNX models straight off disk
// (it has fs access), so no 34 MB of model bytes are ever cloned between
// threads; only the PCM crosses.
//
// THE .cjs DETAIL: the emscripten glue is vendored at
// app/ui/public/sherpa-onnx/*.js, which sits under app/ui/package.json's
// "type": "module". The glue is a CLASSIC script, and its pthread bootstrap
// spawns sub-workers by loading that same file by path -- Node then parses it as
// ESM and it dies on its own `require("fs")`. The parent therefore hands us a
// runtime copy with a .cjs extension (see diarize.mjs), which is the CJS-loadable
// path the pthread bootstrap needs. Verified: without it, engine init fails with
// "require is not defined in ES module scope".
//
// Protocol (parent <-> worker):
//   -> {type:'ready'}                                    engine built
//   -> {type:'error', message}                           init failed (fatal for this worker)
//   <- {type:'run', id, pcm, opts:{numSpeakers, threshold, minDurationOn, minDurationOff}}
//   -> {type:'result', id, segments} | {type:'error', id, message}
//
// Built with Claude Code.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';

const { gluePathCjs, wrapperPath, wasmPath, segPath, embPath, threads } = workerData;

// Paths inside the WASM in-memory filesystem the engine reads its models from.
const FS_SEG = '/segmentation.onnx';
const FS_EMB = '/embedding.onnx';

let Module = null;
let createSD = null;
let sd = null;
let sdKey = null;      // identity of the front-end params `sd` was built with

/** Load the emscripten module + the JS API wrapper. Resolves once initialised. */
async function initEngine() {
  const wasmBytes = readFileSync(wasmPath);
  const mod = {
    // Hand emscripten the bytes so it never fetches/reads the .wasm itself.
    wasmBinary: wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength),
    // Where pthread sub-workers are bootstrapped from (see THE .cjs DETAIL above).
    mainScriptUrlOrBlob: gluePathCjs,
    locateFile: (p) => gluePathCjs.replace(/[^/]+$/, p),
    print: () => { /* engine chatter; surfaced only via printErr */ },
    printErr: (m) => console.error('[diarize/wasm]', m),
  };
  const ready = new Promise((resolve, reject) => {
    mod.onRuntimeInitialized = () => resolve();
    mod.onAbort = (reason) => reject(new Error(`sherpa-onnx wasm aborted: ${reason}`));
  });

  // The glue is a classic script: it reads a global `Module` and, at the end of
  // the file, kicks off instantiation itself. It also takes emscripten's Node
  // branch, which needs bare require/__filename in scope.
  globalThis.Module = mod;
  globalThis.require = createRequire(import.meta.url);
  globalThis.__filename = gluePathCjs;
  globalThis.__dirname = gluePathCjs.replace(/\/[^/]+$/, '');
  vm.runInThisContext(readFileSync(gluePathCjs, 'utf8'), { filename: gluePathCjs });
  await ready;

  // The wrapper is a dual CJS/browser script: it both declares globals and, at
  // the end, assigns module.exports. Give it a module object so that line runs.
  globalThis.module = { exports: {} };
  globalThis.exports = globalThis.module.exports;
  vm.runInThisContext(readFileSync(wrapperPath, 'utf8'), { filename: wrapperPath });
  const factory = globalThis.createOfflineSpeakerDiarization
    || globalThis.module.exports.createOfflineSpeakerDiarization;
  if (typeof factory !== 'function') {
    throw new Error('sherpa-onnx wrapper did not expose createOfflineSpeakerDiarization');
  }

  writeModel(mod, FS_SEG, readFileSync(segPath));
  writeModel(mod, FS_EMB, readFileSync(embPath));
  Module = mod;
  createSD = factory;
}

function writeModel(mod, path, bytes) {
  const name = path.replace(/^\//, '');
  try { mod.FS_unlink(path); } catch { /* not present yet */ }
  mod.FS_createDataFile('/', name, bytes, true, false, false);
}

/**
 * Build (or reuse) the diarizer and run it.
 *
 * The clustering knobs (speaker count / threshold) are re-appliable on a live
 * engine via setConfig, but the front-end ones (thread count, min durations) are
 * baked in at construction, so changing those rebuilds -- the models already sit
 * in the WASM filesystem, so a rebuild costs only the engine construction.
 */
function runOne(pcm, { numSpeakers = -1, threshold = 0.5, minDurationOn = 0.3, minDurationOff = 0.5 }) {
  const clustering = numSpeakers > 0
    ? { numClusters: numSpeakers, threshold: 0.5 }
    : { numClusters: -1, threshold };
  const key = `${threads}|${minDurationOn}|${minDurationOff}`;
  if (sd && sdKey === key) {
    sd.setConfig({ clustering });
  } else {
    if (sd) { try { sd.free(); } catch { /* replaced anyway */ } sd = null; }
    sd = createSD(Module, {
      segmentation: { pyannote: { model: FS_SEG }, numThreads: threads, debug: 0, provider: 'cpu' },
      embedding: { model: FS_EMB, numThreads: threads, debug: 0, provider: 'cpu' },
      clustering,
      minDurationOn,
      minDurationOff,
    });
    sdKey = key;
  }
  const segments = sd.process(pcm) || [];
  return segments.map((s) => ({ start: s.start, end: s.end, speaker: s.speaker }));
}

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'run') return;
  try {
    parentPort.postMessage({ type: 'result', id: msg.id, segments: runOne(msg.pcm, msg.opts || {}) });
  } catch (err) {
    parentPort.postMessage({ type: 'error', id: msg.id, message: err?.message || String(err) });
  }
});

try {
  await initEngine();
  parentPort.postMessage({ type: 'ready' });
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err?.message || String(err) });
  process.exit(1);
}
