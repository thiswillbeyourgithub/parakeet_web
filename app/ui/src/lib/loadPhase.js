// The phases of a model (re)load, and how to report what each one cost.
//
// A load is three sequential phases, not one: look in the IndexedDB cache,
// pull whatever is missing over the network, then build the ORT sessions. The
// status line used to call all of it "Loading model", which is wrong in the
// only case where the distinction matters to the person watching it: a cold
// fp32 load spends minutes moving 2.3 GB and says nothing about it, so a slow
// connection is indistinguishable from a slow machine.
//
// Kept out of App.jsx so both halves are testable: App.jsx is a Preact
// component and not importable under node.

/**
 * Every status that means "a model load is in flight", in phase order.
 *
 * Almost every caller wants the set rather than one member ("is a load
 * running?"), which is why the pair these used to be was spelled out at six
 * call sites in App.jsx and would have needed a third member edited into each.
 */
export const MODEL_LOAD_STATUSES = ['loadingModel', 'downloadingModel', 'creatingSessions'];

/** True while any phase of a model load is in flight. */
export function isModelLoading(status) {
  return MODEL_LOAD_STATUSES.includes(status);
}

function secs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?';
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
}

/**
 * One console line accounting for a finished load, phase by phase.
 *
 * The point is to make "load was slow" answerable without a rerun: the two
 * phases have completely different causes (a connection against a CPU or a GPU
 * shader compile) and only their sum was ever recorded, in the benchmark's
 * loadMs. `bytes` distinguishes a warm load from a cold one, since a cache hit
 * spends no network time at all and is the only reading under which a fast
 * download phase means anything.
 *
 * Example: '[Load] ready in 9m12s: fetch 9m04s (2331 MB), sessions 8.1s'
 */
export function formatLoadTiming({ totalMs, fetchMs, sessionMs, bytes = null } = {}) {
  // null means the caller could not tell (no progress events wired), which
  // must not read as the confident "cached".
  const transfer = bytes == null ? 'transfer unknown'
    : bytes === 0 ? 'cached'
    : `${Math.round(bytes / 1e6)} MB`;
  return `[Load] ready in ${secs(totalMs)}: fetch ${secs(fetchMs)} (${transfer}), sessions ${secs(sessionMs)}`;
}
