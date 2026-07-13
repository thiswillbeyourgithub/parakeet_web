// Classic Web Worker that runs sherpa-onnx speaker diarization OFF the main
// thread. The engine's `process()` is a synchronous, whole-recording WASM call:
// run on the main thread it freezes the UI for its entire duration (seconds, and
// it scales with audio length). Here it blocks only this worker, so the page
// stays responsive (the spinner animates) and the run is cancellable by the
// client via a hard `worker.terminate()` (a synchronous `process()` cannot
// observe a "cancel" message mid-run, so termination is the only way to stop it).
//
// Integrity posture is unchanged: the MAIN thread (diarizer.js) fetches and
// sha384-verifies the engine bytes (glue, wrapper, wasm) and the model bytes,
// then hands them here ALREADY VERIFIED. This worker only ever evaluates verified
// bytes -- it `importScripts` the glue/wrapper from blob: URLs built from those
// bytes and feeds the wasm via `Module.wasmBinary` (no second, unverified fetch).
// pthread sub-workers spawn from the same verified glue blob (mainScriptUrlOrBlob).
//
// Protocol (client <-> worker):
//   <- {type:'init', glueBytes, wrapperBytes, wasmBytes}
//   -> {type:'ready'} | {type:'error', message}            // init outcome (no id)
//   <- {type:'run', id, pcm, segBytes?, embBytes?, opts}   // bytes only when changed
//   -> {type:'result', id, segments} | {type:'error', id, message}
//
// This is the same engine-setup + run logic that used to live (main-thread) in
// diarizer.js, moved verbatim into the worker; diarizer.js is now the thin client.
//
// Built with Claude Code.

let _ready = null;     // Promise<Module>, resolved once the engine is initialised
let _createSD = null;  // the wrapper's createOfflineSpeakerDiarization factory
let _Module = null;
let _sd = null;        // reused diarizer handle
let _sdModelKey = null; // identity of the models/front-end params _sd was built from

// FS paths we inject the models to. Arbitrary; the diarizer reads whatever path
// the config names.
const SEG_PATH = '/segmentation.onnx';
const EMB_PATH = '/embedding.onnx';

// fnv-1a over a sample of the bytes + length: a cheap "are these the same model
// bytes as last time" identity (avoids a full re-hash of ~28 MB each run). Not
// security-sensitive; integrity is already enforced by the main-thread verify.
function bytesIdentity(bytes) {
  let h = 0x811c9dc5;
  const step = Math.max(1, Math.floor(bytes.length / 4096));
  for (let i = 0; i < bytes.length; i += step) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length}:${h.toString(16)}`;
}

function writeModel(Module, path, bytes) {
  const name = path.replace(/^\//, '');
  try { Module.FS_unlink(path); } catch (_) { /* not present yet */ }
  Module.FS_createDataFile('/', name, bytes, true, false, false);
}

// Load (once) the sherpa-onnx engine from the verified bytes. Resolves to the
// initialised emscripten Module; also stashes the wrapper factory.
function initEngine({ glueBytes, wrapperBytes, wasmBytes }) {
  if (_ready) return _ready;
  _ready = new Promise((resolve, reject) => {
    const glueUrl = URL.createObjectURL(new Blob([glueBytes], { type: 'text/javascript' }));
    const Module = {
      // Hand emscripten the already-verified wasm bytes so it never issues a
      // second, unverified fetch.
      wasmBinary: wasmBytes.buffer,
      // No `document` in a worker, so emscripten cannot read currentScript.src to
      // locate its pthread bootstrap: point it at the verified glue blob so the
      // pthread sub-workers spawn from THAT (and nothing else).
      mainScriptUrlOrBlob: glueUrl,
      locateFile: (p) => p, // wasmBinary is provided; locateFile should be unused
      onRuntimeInitialized: () => resolve(Module),
      onAbort: (reason) => reject(new Error(`sherpa-onnx wasm aborted: ${reason}`)),
      print: (m) => console.log('[Diarize/wasm]', m),
      printErr: (m) => console.warn('[Diarize/wasm]', m),
    };
    // The classic-script glue reads the global `Module`.
    self.Module = Module;
    try {
      importScripts(glueUrl); // synchronous exec; wasm init resolves async above
    } catch (e) {
      reject(e);
    }
  }).then((Module) => {
    _Module = Module;
    // The wrapper is a classic script: its top-level
    // `function createOfflineSpeakerDiarization` becomes a global. Load it after
    // the runtime is up so it can reference Module immediately.
    const wrapperUrl = URL.createObjectURL(new Blob([wrapperBytes], { type: 'text/javascript' }));
    try { importScripts(wrapperUrl); } finally { URL.revokeObjectURL(wrapperUrl); }
    if (typeof self.createOfflineSpeakerDiarization !== 'function') {
      throw new Error('sherpa-onnx wrapper did not expose createOfflineSpeakerDiarization');
    }
    _createSD = self.createOfflineSpeakerDiarization;
    return Module;
  });
  return _ready;
}

// Run one diarization. `segBytes`/`embBytes` are present only when the models
// changed (the client tracks this); otherwise the cached `_sd` is reused and we
// only re-apply the clustering knobs (the count-change fast path -- no re-parse).
function runOne(pcm, { segBytes, embBytes, opts }) {
  const Module = _Module;
  const {
    numSpeakers = -1, threshold = 0.5,
    minDurationOn = 0.3, minDurationOff = 0.5, numThreads,
  } = opts || {};
  // Default to (cores - 1): sherpa's segmentation + embedding are the dominant
  // cost on long audio, and the old min(.., 4) cap left most cores idle on a
  // beefy box. The `numThreads` override still wins (the piecewise pool passes an
  // explicit divided count so K workers never oversubscribe the machine).
  const threads = numThreads ?? Math.max(1, (self.navigator?.hardwareConcurrency || 2) - 1);
  const clustering = numSpeakers && numSpeakers > 0
    ? { numClusters: numSpeakers, threshold: 0.5 }
    : { numClusters: -1, threshold };

  if (segBytes && embBytes) {
    const modelKey = `${bytesIdentity(segBytes)}|${bytesIdentity(embBytes)}|${threads}|${minDurationOn}|${minDurationOff}`;
    if (_sd && _sdModelKey === modelKey) {
      // Same models/front-end params: just re-apply clustering knobs.
      _sd.setConfig({ clustering });
    } else {
      if (_sd) { try { _sd.free(); } catch (_) { /* ignore */ } _sd = null; }
      writeModel(Module, SEG_PATH, segBytes);
      writeModel(Module, EMB_PATH, embBytes);
      _sd = _createSD(Module, {
        segmentation: { pyannote: { model: SEG_PATH }, numThreads: threads, debug: 0, provider: 'cpu' },
        embedding: { model: EMB_PATH, numThreads: threads, debug: 0, provider: 'cpu' },
        clustering,
        minDurationOn,
        minDurationOff,
      });
      _sdModelKey = modelKey;
    }
  } else {
    // No bytes sent: the worker must already hold a built diarizer (count-change).
    if (!_sd) throw new Error('diarizer not initialised with models');
    _sd.setConfig({ clustering });
  }

  const segments = _sd.process(pcm);
  return (segments || []).map((s) => ({ start: s.start, end: s.end, speaker: s.speaker }));
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'init') {
    try {
      await initEngine(msg);
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'error', message: String((e && e.message) || e) });
    }
    return;
  }
  if (msg.type === 'run') {
    try {
      await _ready; // engine must be ready (client awaits 'ready' before running)
      const segments = runOne(msg.pcm, msg);
      self.postMessage({ type: 'result', id: msg.id, segments });
    } catch (e) {
      self.postMessage({ type: 'error', id: msg.id, message: String((e && e.message) || e) });
    }
  }
};
