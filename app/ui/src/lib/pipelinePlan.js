// Which off-thread pipeline halves a freshly loaded model gets, and which of
// them start right now.
//
// There are two levers and they do NOT compose freely:
//
//   - The ENCODE POOL is a WASM-only throughput lever. Each worker holds its own
//     copy of the encoder weights, which is fine at int8 (~850 MB) and not at
//     fp32 (~2.4 GB per copy), so an fp32 load is refused a pool outright.
//     Hardware gates it again (encodePoolPlan: logical cores, RAM, thread
//     budget).
//   - The DECODE WORKER is unconditional on WebGPU (it overlaps WASM decode with
//     GPU encode). On WASM it is useless alone, because the pool already
//     overlaps decode with encode, so it only ever runs COMPOSED with the pool:
//     pool-eligible model, pool-clearing hardware, and the operator opt-in.
//
// The reason to keep this pure and pinned by tests: EVERY failure in this area
// is a fallback to the in-thread path, which produces the same transcript. A
// gate that silently stops matching reality costs throughput and nothing else
// notices, so the gates themselves are the only thing that can be asserted.

import { encodePoolPlan } from './cpuThreads.js';

/**
 * Decide the worker pipeline for the model that just loaded.
 *
 * @param {object} a
 * @param {string} a.backend                    'wasm' | 'webgpu-hybrid'
 * @param {string} a.wasmEncoderRequest         the resolved WASM encoder request
 *   (see modelRequest.js); 'fp32' is the one value that forbids a pool
 * @param {boolean} a.wasmDecodePipelineEnabled operator opt-in
 *   (VITE_WASM_DECODE_PIPELINE), WASM composed mode only
 * @param {boolean} a.parallelEncode            the user's sidebar toggle
 * @param {number} a.cpuThreads                 the user's thread budget
 * @param {number} a.maxCores                   navigator.hardwareConcurrency
 * @param {number} [a.deviceMemory]             navigator.deviceMemory (Chrome only)
 * @returns {{
 *   poolEligible: boolean, composedEligible: boolean, decodeWorkerEligible: boolean,
 *   startPool: boolean, poolStopReason: (string|null),
 *   startDecodeWorker: boolean, decodeWorkerStopReason: (string|null),
 *   decodeNumThreads: number,
 * }} `*Eligible` says whether init params may be stashed at all (a stash is what
 *   lets the sidebar toggle start the half later without a model reload);
 *   `start*` says whether to start it now, and `*StopReason` is the teardown
 *   reason to log when not starting.
 */
export function planPipelineWorkers({
  backend,
  wasmEncoderRequest,
  wasmDecodePipelineEnabled,
  parallelEncode,
  cpuThreads,
  maxCores,
  deviceMemory,
}) {
  // Only 'wasm' and 'webgpu*' exist. Anything else is a corrupted setting: it
  // gets neither half, since a pool stashed for a backend the transcribe path
  // will never recognise could not engage anyway.
  const isWasm = backend === 'wasm';
  const isWebgpu = String(backend || '').startsWith('webgpu');

  const poolEligible = isWasm && wasmEncoderRequest !== 'fp32';
  // The same hardware gate the pool itself applies, asked in advance so the
  // decode worker is not created for a composed mode that can never form.
  const hardwareAllowsPool = encodePoolPlan({ cpuThreads, maxCores, deviceMemory }).workers > 0;
  const composedEligible = poolEligible && wasmDecodePipelineEnabled && hardwareAllowsPool;
  const decodeWorkerEligible = isWebgpu || composedEligible;

  const startPool = poolEligible && parallelEncode;
  // The WASM decode worker follows the parallelEncode toggle (it is useless
  // without the pool, and turning the feature off should give the memory back);
  // the WebGPU one is independent and always starts. A WASM worker started while
  // the toggle is off would be dead weight, but the STASH stays either way, so
  // flipping the toggle later composes without a model reload.
  const startDecodeWorker = decodeWorkerEligible && (!composedEligible || parallelEncode);

  return {
    poolEligible,
    composedEligible,
    decodeWorkerEligible,
    startPool,
    poolStopReason: startPool
      ? null
      : (poolEligible ? 'parallel encode disabled' : 'encode pool unsupported for this model'),
    startDecodeWorker,
    decodeWorkerStopReason: startDecodeWorker
      ? null
      : (decodeWorkerEligible ? 'parallel encode disabled' : 'decode pipeline unsupported for this model'),
    // The decode loop's joiner GEMMs are too small to scale with threads, and on
    // WASM the pool already budgets ~all the cores, so the worker takes 2 rather
    // than the user's whole budget.
    decodeNumThreads: isWasm ? 2 : cpuThreads,
  };
}
