// Pure policy for restoring the persisted WASM inference thread count.
//
// History: the app used to default cpuThreads to `hardwareConcurrency - 2`.
// hardwareConcurrency counts HYPERTHREADS and ORT's WASM thread pool
// spin-waits, so that default oversubscribed the physical cores on typical
// laptops (e.g. 6 threads on a 4-core/8-thread machine) and could be
// dramatically slower than fewer threads (measured on a 6C/12T box: 12
// threads encode slower than 1). The default is now defaultWasmThreads()
// (ORT's own heuristic, min(4, ceil(hc / 2))).
//
// Because usePersistedSetting writes every setting's value back on first
// boot, existing installs have the OLD default persisted even though the
// user never touched the slider. restoreCpuThreads therefore performs a
// ONE-TIME migration: a stored value that exactly equals the legacy default
// for this machine is treated as "never chosen" and replaced with the new
// default. The `migrated` flag (persisted by the caller) makes this run only
// once, so a user who later deliberately re-picks that same number keeps it.
// Written with the help of Claude Code.
import { defaultWasmThreads } from '../../../src/backend.js';

/**
 * @param {object} args
 * @param {*} args.stored Persisted cpuThreads value (any type; null = unset).
 * @param {boolean} args.migrated Whether the one-time legacy-default migration already ran.
 * @param {number} args.maxCores navigator.hardwareConcurrency (slider max).
 * @returns {{ threads: number, migrationApplied: boolean }} threads is clamped to [1, maxCores].
 */
export function restoreCpuThreads({ stored, migrated, maxCores }) {
  const cores = Number.isFinite(maxCores) && maxCores > 0 ? Math.floor(maxCores) : 8;
  const fresh = defaultWasmThreads(cores);
  if (!Number.isFinite(stored) || stored < 1) {
    return { threads: fresh, migrationApplied: false };
  }
  const threads = Math.min(Math.max(1, Math.round(stored)), cores);
  const legacyDefault = Math.max(1, cores - 2);
  if (!migrated && threads === legacyDefault && legacyDefault > fresh) {
    return { threads: fresh, migrationApplied: true };
  }
  return { threads, migrationApplied: false };
}

/**
 * Pure policy for the chunk-parallel encode-worker pool (WASM only). The
 * encoder's thread scaling saturates near the physical core count, but chunks
 * are independent, so two extra ORT instances in workers, each with about half
 * the user's thread budget, encode different chunks concurrently while the
 * main thread decodes. Measured end-to-end on the 6C/12T reference box
 * (2026-08: interleaved in-browser A/B, default 4-thread budget): ~4% faster
 * wall on a QUIET machine, ~15% SLOWER when the machine is already loaded,
 * plus ~1.7 GB extra RAM for the two extra int8 encoder copies. The pool only
 * converts genuinely idle cores, so it needs plenty of them to be a safe bet.
 *
 * Gates (any failure returns workers: 0 with the reason):
 * - 'cores': under 8 logical cores there is no reliable headroom to convert
 *   (on smaller machines the split thread budget loses to the plain path as
 *   soon as anything else runs; unknown hardwareConcurrency falls back to 8
 *   and passes, matching the deviceMemory-undefined policy below).
 * - 'memory': each worker holds its own copy of the encoder weights
 *   (~850 MB for int8), so low-RAM devices must not pay 2 extra copies.
 *   navigator.deviceMemory is Chrome-only and caps its report at 8; undefined
 *   (Firefox, Node) passes, the user toggle + serial fallback still protect.
 * - 'threads': a 1-thread budget cannot be split; the pool needs >= 2.
 *
 * threadsPerWorker halves the USER's cpuThreads budget (not the raw core
 * count): the slider stays the one knob for how much CPU inference may use,
 * and the pool redistributes that budget instead of multiplying it.
 *
 * @param {object} args
 * @param {number} args.cpuThreads The user's WASM thread setting.
 * @param {number} args.maxCores navigator.hardwareConcurrency.
 * @param {number|undefined} args.deviceMemory navigator.deviceMemory (GB), if exposed.
 * @returns {{ workers: number, threadsPerWorker: number, reason: (string|null) }}
 */
export function encodePoolPlan({ cpuThreads, maxCores, deviceMemory }) {
  const cores = Number.isFinite(maxCores) && maxCores > 0 ? Math.floor(maxCores) : 8;
  const threads = Number.isFinite(cpuThreads) && cpuThreads >= 1
    ? Math.floor(cpuThreads) : defaultWasmThreads(cores);
  if (cores < 8) return { workers: 0, threadsPerWorker: 0, reason: 'cores' };
  if (Number.isFinite(deviceMemory) && deviceMemory < 8) {
    return { workers: 0, threadsPerWorker: 0, reason: 'memory' };
  }
  if (threads < 2) return { workers: 0, threadsPerWorker: 0, reason: 'threads' };
  return { workers: 2, threadsPerWorker: Math.max(1, Math.floor(threads / 2)), reason: null };
}
