// The two off-main-thread pipeline workers, lifted out of App() whole: the
// DECODE worker and the chunk-parallel ENCODE pool.
//
// They are one subject because they are two halves of the same lever and share
// one gate. On WebGPU the decode worker is independent and always runs, hiding
// the WASM decode behind the GPU encode. On WASM it only ever runs COMPOSED
// with the encode pool, so the `parallelEncode` toggle owns both, and both can
// be started or stopped WITHOUT a model reload because each stashes its init
// params from the last successful load.
//
// Every failure here is a fallback, never an error: a worker that cannot be
// created, an init that fails, a crash mid-run and a toggle-off all reject
// whatever is pending so the driver in parakeet.js re-runs the clip on the
// in-thread path, which stays the ground truth. That is also what makes this
// worth isolating: a break in here is masked by a healthy transcript.
//
// What stays in App.jsx: loadModel, which stashes the init params and calls
// start/stop after a load, and runTranscription, which hands the bridges
// (`decodeChunkViaWorker`, `encodeChunkViaPool`) to transcribeChunked.

import { useRef, useEffect, useCallback } from 'react';
import { workerReady } from '../lib/workerInit.js';
import { encodePoolPlan } from '../lib/cpuThreads.js';
import { CONFIG } from '../config.js';

/**
 * Own the decode worker and the encode pool: their refs, their bridges, and the
 * start/stop plumbing the toggle and the model load share.
 *
 * @param {object} deps
 * @param {number} deps.cpuThreads      the user's thread budget, halved across the pool
 * @param {number} deps.maxCores        `navigator.hardwareConcurrency` (or a floor)
 * @param {boolean} deps.parallelEncode the persisted pool toggle
 * @param {boolean} deps.settingsLoaded so the toggle effect does not fire on the default
 * @param {{current: any}} deps.boostEncodedRef cloneable boost token ids, the only
 *   form of the trie that can cross a postMessage
 */
export function usePipelineWorkers({ cpuThreads, maxCores, parallelEncode, settingsLoaded, boostEncodedRef }) {

  // Decode worker: overlaps decode with encode. On WebGPU it hides WASM decode
  // behind GPU encode; on WASM it runs only COMPOSED with the encode pool.
  // undefined = not created, null = unavailable/failed (fall back to in-thread
  // decode).
  const decodeWorkerRef = useRef(undefined);
  const decodeWorkerReadyRef = useRef(null);   // Promise<boolean> resolved on init
  const decodeReqIdRef = useRef(0);
  const decodePendingRef = useRef(new Map());  // decode id -> { resolve, reject }
  // Init params stashed at model load so the parallelEncode toggle can start or
  // stop the WASM composed worker without a model reload (same trick as the
  // encode pool's). null = this model cannot run a decode worker.
  const decodeWorkerInitParamsRef = useRef(null);
  // True when THIS model's decode worker is the pool's WASM companion (so the
  // toggle owns it); false for the independent WebGPU worker.
  const composedDecodeEligibleRef = useRef(false);
  // Encode-worker POOL (WASM-only): chunk-parallel encoding, the mirror of the
  // decode worker above. [] = no pool (feature off/gated/failed -> serial
  // in-thread encode). One shared pending map + id counter across the pool;
  // requests are dealt round-robin.
  const encodePoolRef = useRef([]);
  const encodePoolReadyRef = useRef(null);     // Promise<boolean> resolved on init
  const encodeReqIdRef = useRef(0);
  const encodePendingRef = useRef(new Map());  // encode id -> { resolve, reject }
  const encodePoolRoundRobinRef = useRef(0);

  // --- Decode worker (WebGPU: overlap WASM decode with GPU encode; WASM:
  // --- overlap worker decode with the encode pool, i.e. composed mode) ------
  // Lazily (re)create the decode worker and init it with the just-loaded model's
  // decoder + tokenizer bytes/URLs. Resolves true once the worker is ready to
  // decode, false if it is unavailable or init failed (the run then falls back
  // to in-thread decode). Called after a successful model load; a model swap
  // terminates the previous worker first.
  const initDecodeWorker = useCallback((initParams) => {
    if (decodeWorkerRef.current) { try { decodeWorkerRef.current.terminate(); } catch { /* ignore */ } }
    decodePendingRef.current.forEach(({ reject }) => reject(new Error('decode worker reset')));
    decodePendingRef.current.clear();
    let worker;
    try {
      worker = new Worker(new URL('../lib/decode.worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      console.warn('[Decode] worker unavailable, decoding on main thread:', e);
      decodeWorkerRef.current = null;
      decodeWorkerReadyRef.current = Promise.resolve(false);
      return decodeWorkerReadyRef.current;
    }
    decodeWorkerRef.current = worker;
    // Route decode replies (carry an id) to their pending promise.
    worker.addEventListener('message', (ev) => {
      const msg = ev.data || {};
      if ((msg.type === 'result' || msg.type === 'error') && msg.id != null) {
        const pending = decodePendingRef.current.get(msg.id);
        if (!pending) return;
        decodePendingRef.current.delete(msg.id);
        if (msg.type === 'result') pending.resolve(msg.result);
        else pending.reject(new Error(msg.message || 'decode failed'));
      }
    });
    // A crashed worker (error event) can never answer again: tear it down and
    // reject in-flight decodes so the pipelined driver's failure path reruns
    // the clip in-thread, instead of the pending promises hanging forever.
    worker.addEventListener('error', (e) => {
      if (decodeWorkerRef.current !== worker) return;
      console.warn('[Decode] worker error, falling back to in-thread decode:', e?.message || e);
      decodeWorkerRef.current = null;
      decodeWorkerReadyRef.current = Promise.resolve(false);
      try { worker.terminate(); } catch { /* ignore */ }
      decodePendingRef.current.forEach(({ reject }) => reject(new Error('decode worker crashed')));
      decodePendingRef.current.clear();
    });
    // workerReady also settles false when the worker SCRIPT fails to load
    // (only an error event fires, no message) or the init hangs; before it,
    // that left this promise pending forever and every WebGPU transcription
    // gated on it hung before chunk 1.
    decodeWorkerReadyRef.current = workerReady(worker, initParams, { label: 'Decode' });
    return decodeWorkerReadyRef.current;
  }, []);

  // Push the current boost (cloneable ids + params) to the decode worker and
  // await its rebuild, so the worker's trie matches the main thread before a run.
  const syncDecodeWorkerBoost = useCallback((worker) => new Promise((resolve) => {
    const b = boostEncodedRef.current;
    const onMsg = (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'boostReady' || (msg.type === 'error' && msg.id == null)) {
        worker.removeEventListener('message', onMsg);
        resolve();
      }
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage(b
      ? { type: 'boost', encoded: b.encoded, strength: b.strength, depthScaling: b.depthScaling, minpOverride: b.minpOverride }
      : { type: 'boost', encoded: null });
  }), []);

  // Bridge handed to transcribeChunked as opts.decodeChunk: post the encoder
  // output to the worker (transposed buffer TRANSFERRED, zero-copy) and resolve
  // the decoded chunk. phraseBoost is dropped (not cloneable); the worker uses
  // its own synced trie.
  const decodeChunkViaWorker = useCallback((encoded, meta, decodeOpts) => {
    const worker = decodeWorkerRef.current;
    const { phraseBoost, ...cloneableOpts } = decodeOpts || {};
    const buf = encoded.transposed.buffer;
    return new Promise((resolve, reject) => {
      const id = ++decodeReqIdRef.current;
      decodePendingRef.current.set(id, { resolve, reject });
      worker.postMessage({
        type: 'decode', id, chunkIndex: meta.chunkIndex,
        transposed: buf, D: encoded.D, Tenc: encoded.Tenc,
        audioLen: meta.audioLen,
        encodeMs: encoded.encode_ms, preprocessMs: encoded.preprocess_ms,
        opts: cloneableOpts,
      }, [buf]);
    });
  }, []);

  // ---- Chunk-parallel encode pool (WASM only; mirror of the decode worker) ----

  // Terminate every pool worker and reject anything still pending, so an
  // in-flight pooled run rejects (and falls back to the serial path) instead of
  // hanging. Used on model swap, toggle-off, worker crash and unmount.
  const teardownEncodePool = useCallback((reason) => {
    for (const w of encodePoolRef.current) { try { w.terminate(); } catch { /* ignore */ } }
    encodePoolRef.current = [];
    encodePoolReadyRef.current = null;
    encodePendingRef.current.forEach(({ reject }) => reject(new Error(reason || 'encode pool reset')));
    encodePendingRef.current.clear();
  }, []);

  // (Re)create the encode pool and init each worker with the just-loaded
  // model's encoder URL/bytes (pre-verified by the main thread; the workers
  // never fetch anything unverified). Resolves true once EVERY worker is ready
  // to encode, false if any is unavailable or failed init (the run then
  // encodes in-thread as before).
  const initEncodePool = useCallback((initParams, workers) => {
    teardownEncodePool('encode pool reset');
    const pool = [];
    try {
      for (let i = 0; i < workers; i += 1) {
        pool.push(new Worker(new URL('../lib/encode.worker.js', import.meta.url), { type: 'module' }));
      }
    } catch (e) {
      console.warn('[Encode] pool unavailable, encoding on main thread:', e);
      for (const w of pool) { try { w.terminate(); } catch { /* ignore */ } }
      encodePoolReadyRef.current = Promise.resolve(false);
      return encodePoolReadyRef.current;
    }
    encodePoolRef.current = pool;
    const readies = pool.map((worker) => {
      // Route encode replies (they carry an id) to their pending promise.
      worker.addEventListener('message', (ev) => {
        const msg = ev.data || {};
        if ((msg.type === 'result' || msg.type === 'error') && msg.id != null) {
          const pending = encodePendingRef.current.get(msg.id);
          if (!pending) return;
          encodePendingRef.current.delete(msg.id);
          if (msg.type === 'result') {
            // Rebuild the object encode() returns; transposed arrives transferred.
            pending.resolve({
              transposed: new Float32Array(msg.transposed),
              D: msg.D, Tenc: msg.Tenc,
              encode_ms: msg.encodeMs || 0, preprocess_ms: msg.preprocessMs || 0,
            });
          } else {
            pending.reject(new Error(msg.message || 'encode failed'));
          }
        }
      });
      // A crashed worker (OOM is the realistic case: each holds its own copy
      // of the encoder weights) never replies; tear the pool down so pending
      // encodes reject now rather than hanging the run forever.
      worker.addEventListener('error', (ev) => {
        console.warn('[Encode] pool worker crashed:', ev?.message || ev);
        teardownEncodePool('encode pool worker crashed');
      });
      // workerReady folds in the init error message, the error EVENT (script
      // failed to load / init crash; the run-time listener above already tore
      // the pool down) and a watchdog for a HUNG init, so this always settles.
      return workerReady(worker, initParams, { label: 'Encode' });
    });
    encodePoolReadyRef.current = Promise.all(readies)
      .then((oks) => {
        const ok = oks.every(Boolean) && encodePoolRef.current === pool;
        // A pool that failed init can never serve: reclaim its workers now so
        // a dead pool does not sit around until the next model load.
        if (!ok && encodePoolRef.current === pool) teardownEncodePool('encode pool init failed');
        return ok;
      });
    return encodePoolReadyRef.current;
  }, [teardownEncodePool]);

  // Bridge handed to transcribeChunked as opts.encodeChunk: copy the chunk PCM
  // (the driver hands a zero-copy view into the whole clip, and transferring a
  // view's buffer would detach the clip) and post it TRANSFERRED to the next
  // worker round-robin. Resolves with the same object encode() returns.
  const encodeChunkViaPool = useCallback((pcm, meta, encOpts) => {
    const pool = encodePoolRef.current;
    if (!pool.length) return Promise.reject(new Error('encode pool unavailable'));
    const worker = pool[encodePoolRoundRobinRef.current % pool.length];
    encodePoolRoundRobinRef.current = (encodePoolRoundRobinRef.current + 1) % pool.length;
    const copy = pcm.slice();
    return new Promise((resolve, reject) => {
      const id = ++encodeReqIdRef.current;
      encodePendingRef.current.set(id, { resolve, reject });
      worker.postMessage({
        type: 'encode', id, chunkIndex: meta.chunkIndex,
        pcm: copy.buffer, sampleRate: 16000,
        enableProfiling: !!(encOpts && encOpts.enableProfiling),
      }, [copy.buffer]);
    });
  }, []);

  // Init params of the last successful WASM model load (minus the per-plan
  // thread count), so the toggle below can start the pool without a full model
  // reload. Cleared on WebGPU loads (the pool is a WASM-only feature).
  const encodePoolInitParamsRef = useRef(null);
  // Operator OPT-IN: VITE_WASM_DECODE_PIPELINE='true' lets the decode worker
  // also run on WASM (composed with the encode pool). Default OFF on measured
  // evidence: an in-browser A/B on the 3-min clip (2026-08-12, medians over 4
  // interleaved verified reps) put composed at +1.6% wall at beam 1 and +0.3%
  // at beam 5 versus pool-only, i.e. a wash to slight loss, because the pool
  // ALREADY overlaps decode with encode (the main thread decodes chunk i while
  // workers encode i+1..), so off-loading decode only adds transfer overhead
  // and a second decoder session (~100 MB). It stays available because it buys
  // main-thread responsiveness during long WASM runs, which wall clock does
  // not measure. On WebGPU the worker is unconditional and unaffected.
  const wasmDecodePipelineEnabled = CONFIG.VITE_WASM_DECODE_PIPELINE === 'true';

  // Compute the hardware plan and start (or skip) the pool for the stashed
  // model. Shared by loadModel and the toggle effect so the gate and logging
  // cannot drift between them.
  const startEncodePool = () => {
    const params = encodePoolInitParamsRef.current;
    if (!params) return;
    const plan = encodePoolPlan({
      cpuThreads, maxCores,
      deviceMemory: typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined,
    });
    if (plan.workers > 0) {
      try {
        initEncodePool({ ...params, numThreads: plan.threadsPerWorker }, plan.workers);
        console.log(`[Encode] pool starting: ${plan.workers} workers x ${plan.threadsPerWorker} threads`);
      } catch (e) {
        console.warn('[Encode] failed to start encode pool:', e);
        teardownEncodePool('encode pool init failed');
      }
    } else {
      console.log(`[Encode] pool disabled by hardware gate (${plan.reason})`);
    }
  };

  // Start (or skip) the decode worker for the stashed model. On WASM it only
  // ever runs COMPOSED with the encode pool, so the same toggle that owns the
  // pool owns it; on WebGPU it is independent of the pool and always starts.
  // restart=true always re-inits (a freshly loaded model needs a worker built
  // from ITS params, so a leftover worker from the previous model or backend
  // must not be kept); the toggle path reuses a healthy worker instead.
  const startDecodeWorker = ({ restart = false } = {}) => {
    const params = decodeWorkerInitParamsRef.current;
    if (!params || (decodeWorkerRef.current && !restart)) return;
    try {
      initDecodeWorker(params);
    } catch (e) {
      console.warn('[Decode] failed to start decode worker:', e);
      decodeWorkerRef.current = null;
      decodeWorkerReadyRef.current = Promise.resolve(false);
    }
  };
  const stopDecodeWorker = (reason) => {
    if (!decodeWorkerRef.current) return;
    try { decodeWorkerRef.current.terminate(); } catch { /* ignore */ }
    decodeWorkerRef.current = null;
    decodeWorkerReadyRef.current = Promise.resolve(false);
    decodePendingRef.current.forEach(({ reject }) => reject(new Error(`decode worker stopped: ${reason}`)));
    decodePendingRef.current.clear();
    console.log(`[Decode] worker stopped: ${reason}`);
  };

  // React to the toggle without reloading the model: the pool (and, on WASM,
  // the decode worker that composes with it) is independent of the main-thread
  // sessions, so tear it down / bring it up directly. A pooled run in flight
  // when the user toggles off simply rejects and falls back to the serial path.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (parallelEncode) {
      if (!encodePoolRef.current.length) startEncodePool();
      if (composedDecodeEligibleRef.current) startDecodeWorker();
    } else {
      if (encodePoolRef.current.length) teardownEncodePool('parallel encode toggled off');
      // Only the WASM composed worker follows the toggle; a WebGPU worker is
      // not the pool's companion and must survive it.
      if (composedDecodeEligibleRef.current) stopDecodeWorker('parallel encode toggled off');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parallelEncode, settingsLoaded]);

  // Terminate the decode worker + encode pool on unmount.
  useEffect(() => () => {
    if (decodeWorkerRef.current) { try { decodeWorkerRef.current.terminate(); } catch { /* ignore */ } }
    teardownEncodePool('unmount');
  }, [teardownEncodePool]);

  return {
    // --- Decode worker -------------------------------------------------
    decodeWorkerRef,
    decodeWorkerReadyRef,
    // Stashed by loadModel so the toggle can (re)start the worker without a
    // reload; null when this model cannot run one.
    decodeWorkerInitParamsRef,
    // True when THIS model's decode worker is the pool's WASM companion, so the
    // toggle owns it; false for the independent WebGPU worker.
    composedDecodeEligibleRef,
    startDecodeWorker,
    stopDecodeWorker,
    syncDecodeWorkerBoost,
    decodeChunkViaWorker,
    // --- Encode pool ---------------------------------------------------
    encodePoolRef,
    encodePoolReadyRef,
    encodePoolInitParamsRef,
    startEncodePool,
    teardownEncodePool,
    encodeChunkViaPool,
    // --- Operator opt-in -------------------------------------------------
    wasmDecodePipelineEnabled,
  };
}
