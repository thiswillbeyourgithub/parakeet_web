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
