// Pure policy for the first-load performance probe: a ~1.5 MB pair of ONNX
// graphs (scripts/make-probe-model.py) is timed through BOTH execution
// providers on the visitor's own machine, and the result decides which backend
// this machine should use.
//
// Why measure instead of detect: "does this browser expose WebGPU" is not the
// question, because every WebGPU adapter answers yes and the answer says
// nothing about speed. This project shipped an app-wide WebGPU disable in July
// 2026 precisely because a real RTX 3090 Ti measured ~15x SLOWER than plain
// WASM int8; that verdict was later traced to the page's spinner animation
// gating JSEP's event-loop yields (fixed 2026-08-12, html.gpu-run in App.css)
// and the same box now measures WebGPU fp32 ~5x FASTER than WASM int8 on a
// 390 s clip. A blanket default cannot be right for both of those worlds, and
// neither can a capability flag. Only running the work answers it, per machine.
//
// What is measured, and why the two arms use different precisions: the CPU arm
// runs the INT8 graph and the GPU arm runs the FP32 graph, because that is
// what each backend actually loads (WASM ships the int8 encoder, WebGPU ships
// fp32). Timing both arms in fp32 would hand the GPU the 2-3x that int8
// buys the CPU and would recreate exactly the mistake that cost this project a
// month: choosing the GPU when the CPU was faster. Every remaining asymmetry
// is deliberately pointed the same way (the probe's GEMMs are smaller than the
// encoder's, which UNDER-reports the GPU), so a probe that says "GPU wins" is
// trustworthy and a
// probe that says "CPU wins" may be leaving a little on the table.
//
// Written with the help of Claude Code.

// Where the artifacts live (public/, served same-origin, prefetched in the
// background of a normal page load so the probe itself never waits on network).
export const PROBE_MODEL_PATHS = {
  wasm: '/probe/probe-encoder.int8.onnx',
  webgpu: '/probe/probe-encoder.fp32.onnx',
};

// Graph shape, mirrored from make-probe-model.py (which documents why these
// specific numbers). The worker builds the input tensor from these, so a
// regenerated artifact with different dims must update both sides.
export const PROBE_SEQ = 768;
export const PROBE_DIM = 1024;
export const PROBE_INPUT_NAME = 'input';

// Timing plan. Warmups are not timed: they pay ORT's lazy kernel setup and, on
// WebGPU, the WGSL shader compile, a fixed one-off cost that would otherwise
// swamp a short probe and make every GPU look terrible.
export const PROBE_WARMUP_RUNS = 3;
export const PROBE_TIMED_RUNS = 5;
export const PROBE_MIN_TIMED_RUNS = 3;
// Above this per-run cost, drop to PROBE_MIN_TIMED_RUNS: a slow machine gives
// the same median from fewer samples and should not be made to wait longer
// than a fast one just to be measured.
export const PROBE_SLOW_RUN_MS = 200;

// Watchdogs. The probe sits IN FRONT of the Load model button, so an arm that
// never settles would wedge the load itself rather than merely lose a
// measurement (the failure mode commit d8acf6e fixed for the decode/encode
// workers). Both bounds are far above any legitimate cost for a ~5 MB graph
// and only ever fire on a genuinely stuck runtime, in which case the arm is
// abandoned and the visitor stays on WASM. Init is the looser of the two
// because it may also pay a cold fetch of ORT's own WASM assets.
export const PROBE_INIT_TIMEOUT_MS = 30000;
export const PROBE_RUN_TIMEOUT_MS = 30000;

// How much faster the GPU arm must be before the app switches a visitor onto
// the WebGPU path. This is NOT a noise margin (the medians are far apart when
// a real GPU is present); it prices the download. Choosing WebGPU commits the
// user to a 2.4 GB fp32 encoder instead of ~600 MB int8, so a marginal win is
// not worth 4x the bytes on a metered connection. It also
// buys headroom against the probe's own conservative bias (see the header):
// the one machine with ground truth measured 5.4x end-to-end, comfortably
// clear of this bar, while a GPU that only edges ahead stays on WASM.
export const PROBE_MARGIN = 2.0;

// Re-probe when the app updates (new ORT, new kernels, new defaults) or when
// the machine reports a different GPU, and otherwise trust the stored verdict:
// hardware does not change under a user's feet. The age cap is a backstop for
// driver updates that change WebGPU performance without changing the adapter
// string.
export const PROBE_VERDICT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

/**
 * How many timed runs to take, given what a warmup run just cost. Keeps the
 * whole probe near a second of work on any machine: fast hardware gets the
 * full sample count, slow hardware gets the minimum rather than a long wait.
 *
 * @param {number} warmupMs Cost of the last (untimed) warmup run.
 * @returns {number}
 */
export function planTimedRuns(warmupMs) {
  if (!Number.isFinite(warmupMs) || warmupMs <= 0) return PROBE_TIMED_RUNS;
  return warmupMs > PROBE_SLOW_RUN_MS ? PROBE_MIN_TIMED_RUNS : PROBE_TIMED_RUNS;
}

export function median(xs) {
  const s = [...xs].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * Decide the backend from the two arms' timings.
 *
 * Every degenerate case resolves to 'wasm': a failed or skipped GPU arm, a
 * nonsensical timing, a missing measurement. WASM runs everywhere, downloads
 * the least, and is the path this app has always defaulted to, so it is the
 * correct answer whenever the evidence for the alternative is not clean.
 *
 * @param {object} args
 * @param {number} args.wasmMs Median ms per run of the int8 graph on WASM.
 * @param {number} args.gpuMs Median ms per run of the fp32 graph on WebGPU.
 * @param {string|null} [args.gpuReason] Why the GPU arm produced no timing
 *   (e.g. 'no-adapter', 'session-failed', 'disabled'); passed straight through.
 * @param {number} [args.margin] Override for PROBE_MARGIN (tests, tuning).
 * @returns {{backend: ('wasm'|'webgpu-hybrid'), speedup: (number|null), reason: (string|null)}}
 *   speedup is wasmMs/gpuMs when both arms produced a timing, else null.
 *   reason is null only when WebGPU was chosen.
 */
export function pickBackendFromProbe({ wasmMs, gpuMs, gpuReason = null, margin = PROBE_MARGIN } = {}) {
  if (gpuReason) return { backend: 'wasm', speedup: null, reason: gpuReason };
  const ok = (x) => Number.isFinite(x) && x > 0;
  if (!ok(wasmMs) || !ok(gpuMs)) return { backend: 'wasm', speedup: null, reason: 'bad-timings' };
  const speedup = wasmMs / gpuMs;
  if (speedup >= margin) return { backend: 'webgpu-hybrid', speedup, reason: null };
  return { backend: 'wasm', speedup, reason: 'below-margin' };
}

/**
 * Is a stored verdict still worth trusting, or must the probe run again?
 *
 * @param {object|null} verdict Stored verdict (see buildVerdict).
 * @param {object} now Current environment facts.
 * @param {string} now.appVersion Running app version.
 * @param {string|null} now.adapter Current GPU adapter signature (null when none).
 * @param {number} now.at Current epoch ms.
 * @param {number} [now.maxAgeMs]
 * @returns {boolean}
 */
export function verdictStillValid(verdict, { appVersion, adapter, at, maxAgeMs = PROBE_VERDICT_MAX_AGE_MS } = {}) {
  if (!verdict || typeof verdict !== 'object') return false;
  if (verdict.backend !== 'wasm' && verdict.backend !== 'webgpu-hybrid') return false;
  if (!Number.isFinite(verdict.at)) return false;
  // A new app version can carry a new ORT, new kernels or new defaults, any of
  // which can move the two arms relative to each other.
  if (verdict.appVersion !== appVersion) return false;
  // A different GPU (docked eGPU, driver rename, switched integrated/discrete)
  // invalidates a GPU-vs-CPU comparison outright.
  if ((verdict.adapter ?? null) !== (adapter ?? null)) return false;
  if (Number.isFinite(maxAgeMs) && at - verdict.at > maxAgeMs) return false;
  return true;
}

/**
 * Should the probe run by itself when the user clicks "Load model"?
 *
 * The probe is only ever worth a visitor's seconds when its verdict could
 * actually change what happens next, so this deliberately refuses in four
 * cases: the user has picked a backend by hand (their choice wins, always),
 * WebGPU cannot be selected in this build at all (nothing to decide), a valid
 * verdict is already stored (probe once per machine, not once per click), or a
 * probe is already in flight.
 *
 * The explicit "Autoconfigure optimal performance" button ignores all of this
 * and always measures, because the user asked for a fresh answer.
 *
 * @param {object} facts
 * @param {boolean} facts.settingsLoaded Settings restore has completed.
 * @param {boolean} facts.userPickedBackend User has touched the backend radios.
 * @param {boolean} facts.webgpuSelectable navigator.gpu exists AND WebGPU is
 *   not disabled app-wide in this build.
 * @param {boolean} facts.hasValidVerdict verdictStillValid() on the stored one.
 * @param {boolean} facts.running A probe is already running.
 * @returns {boolean}
 */
export function shouldAutoProbe({ settingsLoaded, userPickedBackend, webgpuSelectable, hasValidVerdict, running } = {}) {
  if (!settingsLoaded) return false;
  if (running) return false;
  if (userPickedBackend) return false;
  if (!webgpuSelectable) return false;
  if (hasValidVerdict) return false;
  return true;
}

/**
 * Assemble the record that gets persisted (and shown in the sidebar).
 * Kept pure so the unit tests can pin the shape the settings store holds.
 */
export function buildVerdict({ pick, wasmMs, gpuMs, appVersion, adapter, at, trigger }) {
  return {
    backend: pick.backend,
    speedup: pick.speedup,
    reason: pick.reason,
    wasmMs: Number.isFinite(wasmMs) ? wasmMs : null,
    gpuMs: Number.isFinite(gpuMs) ? gpuMs : null,
    appVersion,
    adapter: adapter ?? null,
    at,
    trigger: trigger ?? null,
  };
}
