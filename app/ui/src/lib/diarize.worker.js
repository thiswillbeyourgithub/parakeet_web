// Diarization worker (WASM backend): runs the Streaming Sortformer
// (app/src/sortformer.js) off the main thread so a multi-minute clip never
// freezes the UI. The WebGPU backend runs on the main thread instead
// (diarizer.js): a worker's WebGPU awaits stall even harder than the page's
// (see encode.worker.js and CLAUDE.md).
//
// Module worker on the shared modelWorker.js protocol. The main thread
// downloads + caches the model bytes through the hub and hands them in at
// init (copied, not transferred, since the hub memoises them for the next
// run), so the worker never fetches anything but the ORT runtime, which
// initOrt verifies against the build-time pins.
//
// Message contract:
//   -> {type:'init', embedBytes, stepBytes, config, silenceEmbeds,
//                    numThreads, ortVariant, wasmPaths}
//   <- {type:'ready'} | {type:'error', message}
//   -> {type:'diarize', id, pcm:ArrayBuffer}                     // pcm TRANSFERRED in
//   <- {type:'progress', id, done, total}                         // one per chunk
//   <- {type:'result', id, probs:ArrayBuffer, numFrames, numSpeakers, frameSec}
//    | {type:'error', id, message}
//
// Built with Claude Code.

import { initOrt } from '../../../src/backend.js';
import { diarizeProbs } from '../../../src/sortformer.js';
import { createModelWorker } from './modelWorker.js';
import { openSortformer } from './sortformerSession.js';

async function initModel({ embedBytes, stepBytes, config, silenceEmbeds, numThreads, ortVariant, wasmPaths }) {
  // ortVariant mirrors the main thread's: ORT pins one runtime per JS context,
  // and this one must be the runtime the app verified and benchmarked.
  const ort = await initOrt({ backend: 'wasm', wasmPaths, numThreads, ortVariant });
  const runner = await openSortformer(ort, { backend: 'wasm', embedBytes, stepBytes, config });
  return { runner, config, silenceEmbeds };
}

async function runDiarize({ id, pcm }, { runner, config, silenceEmbeds }) {
  const out = await diarizeProbs(new Float32Array(pcm), {
    config, silenceEmbeds, ...runner,
    onProgress: ({ done, total }) => self.postMessage({ type: 'progress', id, done, total }),
  });
  return {
    payload: { probs: out.probs.buffer, numFrames: out.numFrames, numSpeakers: out.numSpeakers, frameSec: out.frameSec },
    transfer: [out.probs.buffer],
  };
}

createModelWorker({ initModel, runType: 'diarize', run: runDiarize });
