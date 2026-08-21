// Encode worker (WASM only): App.jsx spawns a small POOL of these (see
// encodePoolPlan in lib/cpuThreads.js) and wires them into transcribeChunked's
// injected `encodeChunk` (app/src/parakeet.js): two workers encode different
// chunks concurrently while the main thread decodes, converting the encoder's
// saturated thread scaling into throughput on the WASM backend.
//
// Deliberately NOT used for WebGPU: running the GPU encoder session in a
// dedicated worker was tried (2026-08-11) as a fix for the rendering coupling
// (compositor frames gating JSEP yields) and measured ~3x WORSE than the
// animated main thread. WebGPU callback delivery is gated by the page's
// compositor activity process-wide, workers included; the actual fix is the
// html.gpu-run animation pause in App.css/App.jsx.
//
// This is a MODULE worker importing ParakeetModel directly from app/src (not
// via the 'parakeet.js' alias) so the worker bundle stays free of the hub.js
// IndexedDB/download machinery it never uses. It builds an ENCODE-ONLY
// ParakeetModel (encoder session + mel preprocessor, no joiner, no tokenizer)
// via ParakeetModel.encoderOnlyFromUrls and calls the SAME encode() the main
// thread uses, so no encode logic is duplicated.
//
// Integrity posture mirrors decode.worker.js: the MAIN thread fetches +
// verifies the encoder bytes and hands them in via `init` (encoderUrl may be a
// blob: URL minted from those verified bytes, or the bytes themselves). The
// worker never does a second unverified network fetch. ORT WASM assets are
// still integrity-checked by initOrt -> backend.js _verifiedOrtWasmPaths.
//
// Message contract:
//   -> {type:'init', encoderUrl, encoderDataUrl, filenames, numThreads,
//                    nMels, preprocessorBackend, preprocessorUrl, subsampling,
//                    windowStride, wasmPaths}
//   <- {type:'ready'} | {type:'error', message}
//   -> {type:'encode', id, chunkIndex, pcm:ArrayBuffer, sampleRate,
//                       enableProfiling}                          // pcm TRANSFERRED in
//   <- {type:'result', id, chunkIndex, transposed:ArrayBuffer, D, Tenc,
//                       encodeMs, preprocessMs}                   // transposed TRANSFERRED out
//    | {type:'error', id, chunkIndex, message}
//
// Built with Claude Code.

import { ParakeetModel } from '../../../src/parakeet.js';

let modelPromise = null;   // Promise<encode-only ParakeetModel>
// One encoder session per worker: encodes are CPU-bound and ORT already uses
// the worker's whole thread budget per run, so chain them FIFO (parallelism
// comes from the POOL, not from concurrent runs inside one worker).
let encodeChain = Promise.resolve();

function initModel(msg) {
  const {
    encoderUrl, encoderDataUrl, filenames, numThreads,
    nMels, preprocessorBackend, preprocessorUrl, subsampling, windowStride,
    wasmPaths,
  } = msg;
  // wasmPaths mirrors the MAIN thread's: pooled chunks must run the exact same
  // binaries as in-thread chunks, or one clip could mix numerics.
  return ParakeetModel.encoderOnlyFromUrls({
    encoderUrl, encoderDataUrl, filenames, cpuThreads: numThreads,
    nMels, preprocessorBackend, preprocessorUrl, subsampling, windowStride,
    wasmPaths,
  });
}

async function runEncode(msg) {
  const { id, chunkIndex, pcm, sampleRate, enableProfiling } = msg;
  try {
    const model = await modelPromise;
    const encoded = await model.encode(new Float32Array(pcm), sampleRate || 16000, { enableProfiling });
    // Hand the (large) encoder output back zero-copy; the pcm buffer arrived
    // transferred and simply dies with this handler.
    const buf = encoded.transposed.buffer;
    self.postMessage({
      type: 'result', id, chunkIndex,
      transposed: buf, D: encoded.D, Tenc: encoded.Tenc,
      encodeMs: encoded.encode_ms, preprocessMs: encoded.preprocess_ms,
    }, [buf]);
  } catch (e) {
    self.postMessage({ type: 'error', id, chunkIndex, message: String(e?.message ?? e) });
  }
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  switch (msg.type) {
    case 'init':
      modelPromise = initModel(msg);
      modelPromise.then(
        () => self.postMessage({ type: 'ready' }),
        (e) => self.postMessage({ type: 'error', message: String(e?.message ?? e) }),
      );
      break;

    case 'encode':
      encodeChain = encodeChain.then(() => runEncode(msg));
      break;

    default:
      break;
  }
};
