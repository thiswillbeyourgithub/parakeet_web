// Performance-probe worker: holds ONE arm (WASM int8 or WebGPU fp32) of the
// first-load backend probe and runs it on demand. App.jsx spawns one worker
// per arm, INTERLEAVES their timed runs, and terminates both when done.
//
// Why a worker at all, and why one PER ARM: ORT-web initialises its WASM
// runtime exactly once per JS context and picks a single binary while doing it
// (the plain build for the wasm EP, the JSEP build for WebGPU). Probing on the
// main thread would therefore pin that choice before the real model load and
// silently cost the visitor the Relaxed-SIMD runtime the auto-pick may have
// earned them (-18.6% wall on this project's reference box), and probing both
// arms in ONE worker would force the second arm to reuse the first arm's
// binary. A throwaway worker per arm keeps the main thread's ORT state
// untouched and gives each measurement its own cold, uncontaminated runtime.
//
// Why the caller interleaves instead of running arm A then arm B: ambient load
// drifts, and it does not drift politely. The same 256x512 probe read 1.52x on
// a box at load 28 and 2.83x on the same box at load 17 (2026-08-20). Running
// A,B,A,B and taking medians spreads any drift across both arms, the same
// discipline the project's A/B harnesses use. Runs are still strictly
// sequential (the caller awaits each one), because two ORT runtimes executing
// at once would measure contention rather than hardware.
//
// Integrity posture matches the other module workers: the MAIN thread fetches
// the probe bytes from the app's own origin and hands them in, so the worker
// performs no network fetch of its own. ORT's WASM assets are still verified
// by initOrt -> backend.js _verifiedOrtWasmPaths.
//
// Message contract:
//   -> {type:'init', arm:'wasm'|'webgpu', modelBytes:ArrayBuffer, numThreads,
//                    wasmPaths, wasmSimd, seq, dim, inputName}
//   <- {type:'ready', arm, buildMs} | {type:'error', arm, message}
//   -> {type:'run', id, count}            // count runs, timed individually
//   <- {type:'ran', id, times:[…]} | {type:'error', id, arm, message}
//
// Written with the help of Claude Code.

import { initOrt } from '../../../src/backend.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

let session = null;
let feeds = null;
let arm = null;

async function init(msg) {
  const { modelBytes, numThreads, wasmPaths, wasmSimd, seq, dim, inputName } = msg;
  arm = msg.arm;

  // The WASM arm must mirror the main thread's runtime choice (binaries and
  // SIMD mode) or it would time a runtime the app is not going to use. The GPU
  // arm ignores wasmSimd: relaxed kernels are CPU code and resolveOrtVariant
  // already keeps non-wasm backends on the stock build.
  const ort = await initOrt({
    backend: arm === 'webgpu' ? 'webgpu' : 'wasm',
    wasmPaths,
    numThreads,
    simd: arm === 'webgpu' ? undefined : wasmSimd,
  });

  // STRICT webgpu on purpose (no 'wasm' fallback in the list, unlike the app's
  // 'webgpu-hybrid'): with a fallback, an adapter that cannot actually run the
  // graph would quietly execute it on the CPU and report a "GPU" time that is
  // really a WASM fp32 time, which is the one lie that would make the probe
  // recommend a 2.4 GB download for nothing. Failing loudly here just means
  // the caller records a reason and keeps the visitor on WASM.
  const executionProviders = arm === 'webgpu'
    ? [{ name: 'webgpu', deviceType: 'gpu', powerPreference: 'high-performance' }]
    : ['wasm'];

  const t0 = now();
  session = await ort.InferenceSession.create(new Uint8Array(modelBytes), {
    executionProviders,
    graphOptimizationLevel: 'all',
  });
  const buildMs = now() - t0;

  // Deterministic input: the probe measures throughput, and identical bytes
  // across arms and machines keep run-to-run and box-to-box comparisons
  // honest (a random input could also drift an int8 arm's dynamic range).
  const data = new Float32Array(seq * dim);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.sin(i * 0.017) * 0.5;
  }
  feeds = { [inputName]: new ort.Tensor('float32', data, [1, seq, dim]) };
  return buildMs;
}

async function run(count) {
  const times = [];
  for (let i = 0; i < count; i++) {
    const t = now();
    await session.run(feeds);
    times.push(now() - t);
  }
  return times;
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'init') {
      const buildMs = await init(msg);
      self.postMessage({ type: 'ready', arm, buildMs });
    } else if (msg.type === 'run') {
      if (!session) throw new Error('probe worker asked to run before init');
      const times = await run(msg.count);
      self.postMessage({ type: 'ran', id: msg.id, times });
    } else if (msg.type === 'dispose') {
      // The GPU arm holds device memory; release before the caller terminates.
      try { await session?.release?.(); } catch { /* best effort */ }
      session = null;
      feeds = null;
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: msg.id, arm, message: String(e?.message ?? e) });
  }
};
