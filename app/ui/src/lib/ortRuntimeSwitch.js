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
// The sidebar's CPU runtime choice (custom or stock) is the other reason: it
// changes the ORT variant every WASM context asks for, workers included, and a
// worker built on one runtime keeps it. So a page that already loaded a model
// on one choice reloads to honour the other (pageRuntimeServes).
//
// Built with Claude Code.

export const ORT_RELOAD_KEY = 'parakeetOrtRuntimeReload';

/** The sidebar choice: the self-compiled custom CPU runtime, or stock ORT. */
export const CPU_RUNTIMES = ['custom', 'stock'];
export const DEFAULT_CPU_RUNTIME = 'custom';

/** Anything but a known choice (a missing or corrupt setting) reads as the default. */
export function normalizeCpuRuntime(v) {
  return CPU_RUNTIMES.includes(v) ? v : DEFAULT_CPU_RUNTIME;
}

/**
 * The ortVariant to hand backend.js. An explicit `?ortep=` wins (support and
 * the harnesses rely on it); otherwise 'stock' opts out of the custom runtime
 * and 'custom' leaves backend.js its default (custom where it applies).
 * @param {string|undefined} urlVariant `?ortep=` value, if any.
 * @param {string} cpuRuntime normalizeCpuRuntime() value.
 * @returns {string|undefined}
 */
export function effectiveOrtVariant(urlVariant, cpuRuntime) {
  if (urlVariant) return urlVariant;
  return cpuRuntime === 'stock' ? 'stock' : undefined;
}

/**
 * Whether this page can load without reloading: the main thread's live runtime
 * serves the backend AND the page's earlier loads (if any) asked for the same
 * variant, since their workers are pinned to it.
 * @param {boolean} liveServes backend.js liveOrtServes(backend, variant).
 * @param {?{variant: (string|undefined)}} pinned The variant the page's first
 *   model load used, or null before any load.
 * @param {string|undefined} variant effectiveOrtVariant() for this load.
 */
export function pageRuntimeServes(liveServes, pinned, variant) {
  return liveServes && (pinned == null || pinned.variant === variant);
}

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
