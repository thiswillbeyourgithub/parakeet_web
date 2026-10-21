// When a model load has to reload the page first, to change the ORT runtime.
//
// ORT pins one WASM runtime per JS context, and the main thread runs different
// ones per backend (backend.js resolveOrtVariant): the self-compiled custom CPU
// runtime on the WASM backend (it has no WebGPU EP), the stock jspi/jsep
// runtime on a WebGPU backend. So switching backend after the main thread has
// built a session needs a fresh context, i.e. a reload. The backend setting is
// persisted first, and a sessionStorage marker makes the reloaded page resume
// the load on its own.
//
// The marker doubles as the loop guard: a page that reloaded for a backend and
// STILL finds the wrong runtime live (something loaded ORT on the main thread
// before the model did) loads on what it has, rather than reloading forever.
// The stock runtime serves both backends, the custom one only WASM, so the
// guarded case is at worst a slower WASM load.
//
// Built with Claude Code.

export const ORT_RELOAD_KEY = 'parakeetOrtRuntimeReload';

/**
 * @param {Object} p
 * @param {boolean} p.serves backend.js liveOrtServes(backend, ...).
 * @param {string} p.backend The backend about to be loaded.
 * @param {?{backend: string}} p.pending readPendingOrtReload() result.
 * @returns {{action: 'load'|'reload', loopGuard?: boolean}}
 */
export function planOrtRuntimeSwitch({ serves, backend, pending }) {
  if (serves) return { action: 'load' };
  if (pending?.backend === backend) return { action: 'load', loopGuard: true };
  return { action: 'reload' };
}

/** @returns {?{backend: string}} The marker a runtime-switch reload left, if any. */
export function readPendingOrtReload(storage) {
  try {
    const v = JSON.parse(storage?.getItem(ORT_RELOAD_KEY) ?? 'null');
    return v && typeof v.backend === 'string' ? v : null;
  } catch (_) {
    return null;
  }
}

export function writePendingOrtReload(storage, backend) {
  try { storage?.setItem(ORT_RELOAD_KEY, JSON.stringify({ backend })); } catch (_) { /* best effort */ }
}

export function clearPendingOrtReload(storage) {
  try { storage?.removeItem(ORT_RELOAD_KEY); } catch (_) { /* best effort */ }
}
