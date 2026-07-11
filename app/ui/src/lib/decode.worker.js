// Decode worker: runs the Parakeet TDT decoder/joiner (WASM) off the main
// thread so its CPU decode overlaps the main thread's GPU encode. Used only on
// the WebGPU backend, where the encoder runs on the GPU and the decoder is
// pinned to WASM anyway (per-step GPU dispatch stalls). transcribeChunked's
// pipelined driver (app/src/parakeet.js) encodes each chunk on the main thread
// and hands the encoder output here via `decode` messages; this worker decodes
// them one at a time and posts the transcript back. On WASM the whole feature is
// off (no worker), so nothing here runs there.
//
// This is a MODULE worker (import ParakeetModel + BoostingTrie). It builds a
// DECODE-ONLY ParakeetModel (joiner + tokenizer, no encoder, no preprocessor)
// via ParakeetModel.decoderOnlyFromUrls and calls the SAME transcribe() the main
// thread uses, fed `opts.encoded`, so no decode logic is duplicated.
//
// Integrity posture mirrors diarizer.worker.js: the MAIN thread is expected to
// fetch + verify the decoder/tokenizer bytes and hand pre-verified bytes in via
// `init` (decoderUrl/decoderDataUrl may be Uint8Array). The worker never does a
// second unverified model fetch. ORT WASM assets are still integrity-checked by
// initOrt -> backend.js _verifiedOrtWasmPaths on first use.
//
// Message contract:
//   -> {type:'init', decoderUrl, decoderDataUrl, tokenizerUrl, filenames,
//                    wasmPaths, numThreads, subsampling, windowStride}
//   <- {type:'ready'} | {type:'error', message}
//   -> {type:'boost', encoded, strength, depthScaling, minpOverride}  // encoded:null clears
//   <- {type:'boostReady'} | {type:'error', message}
//   -> {type:'decode', id, chunkIndex, transposed:ArrayBuffer, D, Tenc,
//                       audioLen, encodeMs, preprocessMs, opts}         // transposed TRANSFERRED
//   <- {type:'result', id, chunkIndex, result} | {type:'error', id, chunkIndex, message}
//
// Built with Claude Code.

// Import ParakeetModel + BoostingTrie directly from app/src (not via the
// 'parakeet.js' alias / index.js), so the worker bundle stays free of the hub.js
// IndexedDB/download machinery it never uses.
import { ParakeetModel } from '../../../src/parakeet.js';
import { BoostingTrie } from '../../../src/phraseBoost.js';

let modelPromise = null;   // Promise<decode-only ParakeetModel>
let boostTrie = null;      // rebuilt from the main thread's boost payload
// One joiner session with mutable decode state: decodes MUST run one at a time,
// so chain them FIFO on this promise (the decode loop yields internally, so
// concurrent decodes would interleave and corrupt state).
let decodeChain = Promise.resolve();

function initModel(msg) {
  const {
    decoderUrl, decoderDataUrl, tokenizerUrl, filenames,
    wasmPaths, numThreads, subsampling, windowStride,
  } = msg;
  return ParakeetModel.decoderOnlyFromUrls({
    decoderUrl, decoderDataUrl, tokenizerUrl, filenames,
    wasmPaths, cpuThreads: numThreads, subsampling, windowStride,
  });
}

async function runDecode(msg) {
  const { id, chunkIndex, transposed, D, Tenc, audioLen, encodeMs, preprocessMs, opts } = msg;
  try {
    const model = await modelPromise;
    // Rebuild the encoder-output object transcribe() expects. Fold the main
    // thread's encode/preprocess timings back in so the transcript's metrics
    // report them (transcribe reads encoded.encode_ms / .preprocess_ms).
    const encoded = {
      transposed: new Float32Array(transposed),
      D, Tenc,
      encode_ms: encodeMs || 0,
      preprocess_ms: preprocessMs || 0,
    };
    // `audio` is used only for its `.length` when `encoded` is supplied.
    const result = await model.transcribe({ length: audioLen }, 16000, {
      ...opts,
      encoded,
      phraseBoost: boostTrie,
    });
    self.postMessage({ type: 'result', id, chunkIndex, result });
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

    case 'boost':
      try {
        boostTrie = msg.encoded
          ? BoostingTrie.buildFromEncoded(msg.encoded, {
              strength: msg.strength,
              depthScaling: msg.depthScaling,
              minpOverride: msg.minpOverride,
            })
          : null;
        if (boostTrie && boostTrie.isEmpty) boostTrie = null;
        self.postMessage({ type: 'boostReady' });
      } catch (e) {
        self.postMessage({ type: 'error', message: String(e?.message ?? e) });
      }
      break;

    case 'decode':
      // FIFO: never run two decodes concurrently on the one joiner session.
      decodeChain = decodeChain.then(() => runDecode(msg));
      break;

    default:
      break;
  }
};
