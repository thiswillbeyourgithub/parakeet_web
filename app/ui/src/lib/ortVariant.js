// Pure selection policy for which ORT-WASM runtime variant a page load uses:
// the stock SIMD build under /ort/ or the opt-in Relaxed-SIMD build under
// /ort-relaxed/ (same filenames, compiled with --enable_wasm_relaxed_simd;
// produced by scripts/build-ort-relaxed.sh and absent from deployments that
// have not run it). Kept free of browser APIs so the gate is unit-testable;
// App.jsx supplies the three environment facts and resolves ONCE per page:
// ORT's WASM runtime initialises a single time, so a mid-session change of
// binaries or SIMD mode can only apply after a reload.
// Written with the help of Claude Code.

export const ORT_STOCK_BASE = '/ort/';
export const ORT_RELAXED_BASE = '/ort-relaxed/';

/**
 * @param {Object} facts
 * @param {boolean} facts.relaxedSetting The user's persisted opt-in toggle.
 * @param {boolean} facts.probeSupported WebAssembly.validate relaxed-SIMD
 *   probe (wasmRelaxedSimdSupported in lib/supportReport.js). Hard gate: ORT
 *   throws at init on engines without the feature.
 * @param {boolean} facts.artifactsPresent Whether this deployment serves
 *   /ort-relaxed/manifest.json. Hard gate: pointing wasmPaths at a missing
 *   directory would fail the integrity check and the whole model load.
 * @param {string} facts.backend Selected inference backend. Relaxed kernels
 *   are CPU (MLAS) code, so only the pure-WASM backend opts in for now; on
 *   WebGPU the encoder runs on GPU and the decoder's WASM share is small, so
 *   it stays on the stock build until measured separately.
 * @returns {{wasmPaths: string, wasmSimd: ('relaxed'|undefined), engaged: boolean, reason: (string|null)}}
 *   reason (when not engaged): 'off' | 'unsupported' | 'unavailable' | 'backend'.
 */
export function resolveOrtVariant({ relaxedSetting, probeSupported, artifactsPresent, backend } = {}) {
  const stock = { wasmPaths: ORT_STOCK_BASE, wasmSimd: undefined, engaged: false };
  if (!relaxedSetting) return { ...stock, reason: 'off' };
  if (backend !== 'wasm') return { ...stock, reason: 'backend' };
  if (!probeSupported) return { ...stock, reason: 'unsupported' };
  if (!artifactsPresent) return { ...stock, reason: 'unavailable' };
  return { wasmPaths: ORT_RELAXED_BASE, wasmSimd: 'relaxed', engaged: true, reason: null };
}
