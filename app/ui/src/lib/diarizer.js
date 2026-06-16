// Offline speaker diarization via the vendored sherpa-onnx WebAssembly engine.
//
// sherpa-onnx ships a self-contained WASM build that bundles its OWN ONNX
// Runtime (compiled C++), separate from the app's onnxruntime-web. We load it
// LAZILY here: the ~11 MB engine and the ~34 MB of models are fetched only when
// the user actually diarizes, so they never touch the transcription path.
//
// Loading is integrity-preserving, the same posture as the ORT wasm and the PCM
// worklet: every byte the browser evaluates (emscripten glue, JS API wrapper,
// wasm binary) is sha384-verified against the build-time pin in
// /.well-known/asset-integrity.json before it runs (see asset-integrity.js +
// postbuild.mjs). The verified glue/wrapper are injected as classic <script>s
// from blob: URLs (CSP allows script-src/worker-src blob:), and the wasm bytes
// are handed to emscripten via Module.wasmBinary so there is no second,
// unverified fetch. pthread workers spawn from the glue's blob: URL, exactly
// how the app already runs ORT's threaded wasm from a verified blob.
//
// The models are NOT vendored: the caller passes the segmentation + embedding
// ONNX bytes (downloaded through the hub, see App.jsx wiring) and we write them
// into the WASM in-memory FS with Module.FS_createDataFile, then point the
// diarizer config at those FS paths. The upstream build's 44 MB baked-in models
// (.data) were stripped from the glue for exactly this reason (see the vendor
// SOURCE.md).

import { fetchVerifiedAsset } from './asset-integrity.js';

const BASE = '/sherpa-onnx/';
const GLUE = 'sherpa-onnx-wasm-main-speaker-diarization.js';
const WRAPPER = 'sherpa-onnx-speaker-diarization.js';
const WASM = 'sherpa-onnx-wasm-main-speaker-diarization.wasm';

// FS paths we inject the models to. Arbitrary; the diarizer reads whatever
// path the config names.
const SEG_PATH = '/segmentation.onnx';
const EMB_PATH = '/embedding.onnx';

// Singleton: the engine (Module + the wrapper's factory) is loaded at most once
// per page. Concurrent callers share the same in-flight promise.
let _enginePromise = null;

// Reused diarizer handle + the identity of the models it was built from, so a
// second run on the same models skips the (re-)parse and only re-applies the
// clustering knobs via setConfig.
let _sd = null;
let _sdModelKey = null;

function injectClassicScript(blobUrl) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = blobUrl;
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`failed to load injected script ${blobUrl}`));
    document.head.appendChild(el);
  });
}

// fnv-1a over the first/last KB + length: a cheap, collision-safe-enough identity
// for "are these the same model bytes as last time" (avoids a full re-hash of
// ~28 MB on every run). Not security-sensitive; integrity is already enforced
// upstream by the hub cache.
function bytesIdentity(bytes) {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length}:${h.toString(16)}`;
}

/**
 * Load (once) the sherpa-onnx diarization WASM engine. Returns the initialised
 * emscripten Module plus the wrapper's `createOfflineSpeakerDiarization`
 * factory. Idempotent.
 */
export function loadDiarizationEngine() {
  if (_enginePromise) return _enginePromise;
  _enginePromise = (async () => {
    // Verify all three assets up front so we bail before evaluating anything if
    // a byte is off.
    const [glue, wrapper, wasm] = await Promise.all([
      fetchVerifiedAsset(BASE + GLUE, `sherpa-onnx/${GLUE}`),
      fetchVerifiedAsset(BASE + WRAPPER, `sherpa-onnx/${WRAPPER}`),
      fetchVerifiedAsset(BASE + WASM, `sherpa-onnx/${WASM}`),
    ]);

    const glueUrl = URL.createObjectURL(glue.blob); // kept alive: pthread workers spawn from it

    const ready = new Promise((resolve, reject) => {
      const Module = {
        // Hand emscripten the already-verified wasm bytes so it never issues a
        // second, unverified fetch.
        wasmBinary: wasm.bytes.buffer,
        // Fallback locator (should be unused given wasmBinary), kept same-origin.
        locateFile: (p) => (p.endsWith('.wasm') ? BASE + WASM : BASE + p),
        onRuntimeInitialized: () => resolve(Module),
        onAbort: (reason) => reject(new Error(`sherpa-onnx wasm aborted: ${reason}`)),
        print: (m) => console.log('[Diarize/wasm]', m),
        printErr: (m) => console.warn('[Diarize/wasm]', m),
      };
      // The classic-script glue reads the global `Module`.
      globalThis.Module = Module;
      injectClassicScript(glueUrl).catch(reject);
    });

    const Module = await ready;

    // The wrapper is a classic script: its top-level `function
    // createOfflineSpeakerDiarization` becomes a global. Inject it after the
    // runtime is up so it can reference Module immediately.
    const wrapperUrl = URL.createObjectURL(wrapper.blob);
    try {
      await injectClassicScript(wrapperUrl);
    } finally {
      URL.revokeObjectURL(wrapperUrl);
    }
    const createOfflineSpeakerDiarization = globalThis.createOfflineSpeakerDiarization;
    if (typeof createOfflineSpeakerDiarization !== 'function') {
      throw new Error('sherpa-onnx wrapper did not expose createOfflineSpeakerDiarization');
    }

    return { Module, createOfflineSpeakerDiarization, _glueUrl: glueUrl };
  })().catch((err) => {
    // Let a failed load be retried (transient network / integrity blip).
    _enginePromise = null;
    throw err;
  });
  return _enginePromise;
}

function writeModel(Module, path, bytes) {
  const name = path.replace(/^\//, '');
  try { Module.FS_unlink(path); } catch (_) { /* not present yet */ }
  Module.FS_createDataFile('/', name, bytes, true, false, false);
}

/**
 * Run offline speaker diarization on 16 kHz mono Float32 PCM.
 *
 * @param {Float32Array} pcm16k mono samples at 16 kHz
 * @param {object} opts
 * @param {Uint8Array} opts.segmentationBytes pyannote segmentation-3.0 onnx
 * @param {Uint8Array} opts.embeddingBytes speaker-embedding (CAM++) onnx
 * @param {number} [opts.numSpeakers=-1] exact speaker count, or -1 to auto-detect
 * @param {number} [opts.threshold=0.5] clustering distance threshold (auto mode only)
 * @param {number} [opts.minDurationOn=0.3] drop speech turns shorter than this (s)
 * @param {number} [opts.minDurationOff=0.5] bridge silences shorter than this (s)
 * @param {number} [opts.numThreads] worker threads (default: ~half the cores)
 * @returns {Promise<Array<{start:number,end:number,speaker:number}>>} segments
 *   sorted by start time; `speaker` is a 0-based integer label.
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

  const { Module, createOfflineSpeakerDiarization } = await loadDiarizationEngine();

  const threads = numThreads ?? Math.max(1, Math.min((navigator.hardwareConcurrency || 2) - 1, 4));
  const clustering = numSpeakers && numSpeakers > 0
    ? { numClusters: numSpeakers, threshold: 0.5 }
    : { numClusters: -1, threshold };

  const modelKey = `${bytesIdentity(segmentationBytes)}|${bytesIdentity(embeddingBytes)}|${threads}|${minDurationOn}|${minDurationOff}`;

  if (_sd && _sdModelKey === modelKey) {
    // Same models/front-end params: just re-apply clustering knobs.
    _sd.setConfig({ clustering });
  } else {
    if (_sd) { try { _sd.free(); } catch (_) { /* ignore */ } _sd = null; }
    writeModel(Module, SEG_PATH, segmentationBytes);
    writeModel(Module, EMB_PATH, embeddingBytes);
    _sd = createOfflineSpeakerDiarization(Module, {
      segmentation: { pyannote: { model: SEG_PATH }, numThreads: threads, debug: 0, provider: 'cpu' },
      embedding: { model: EMB_PATH, numThreads: threads, debug: 0, provider: 'cpu' },
      clustering,
      minDurationOn,
      minDurationOff,
    });
    _sdModelKey = modelKey;
  }

  const segments = _sd.process(pcm16k);
  // Normalise to plain numbers (the wrapper already returns {start,end,speaker}).
  return (segments || []).map((s) => ({ start: s.start, end: s.end, speaker: s.speaker }));
}

/** The sample rate the engine expects (16 kHz). For callers that resample. */
export const DIARIZATION_SAMPLE_RATE = 16000;
