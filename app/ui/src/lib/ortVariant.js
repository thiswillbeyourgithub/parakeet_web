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
 * @param {('auto'|'on'|'off'|boolean)} facts.relaxedSetting The user's
 *   persisted setting. Tri-state: 'auto' (the default; the first-load
 *   micro-bench decides), 'on', 'off'. Legacy boolean seeds/tests keep their
 *   exact meaning (true -> 'on', false -> 'off'); App.jsx separately migrates
 *   PERSISTED false to 'auto', because the toggle never shipped publicly so a
 *   stored false is the old default, not a user's choice.
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
 * @param {boolean} [facts.operatorEnabled] VITE_ORT_RELAXED_ENABLE kill-switch;
 *   only an explicit false disengages (undefined stays enabled).
 * @param {('relaxed'|'stock'|null)} [facts.autoPick] The micro-bench verdict
 *   (benchRelaxedAutoPick in lib/relaxedAutoPick.js), consulted only in
 *   'auto' mode. Anything but a clear 'relaxed' resolves to stock: the bench
 *   already biases toward the auditable vendored runtime, and so does this
 *   gate (a missing/failed bench must never engage the self-compiled binary).
 * @returns {{wasmPaths: string, wasmSimd: ('relaxed'|undefined), engaged: boolean, reason: (string|null)}}
 *   reason (when not engaged): 'off' | 'operator' | 'backend' | 'unsupported'
 *   | 'unavailable' | 'auto-stock'.
 */
export function resolveOrtVariant({ relaxedSetting, probeSupported, artifactsPresent, backend, operatorEnabled, autoPick } = {}) {
  const stock = { wasmPaths: ORT_STOCK_BASE, wasmSimd: undefined, engaged: false };
  const mode = relaxedSetting === 'auto' ? 'auto'
    : (relaxedSetting === true || relaxedSetting === 'on') ? 'on' : 'off';
  if (mode === 'off') return { ...stock, reason: 'off' };
  // Operator kill-switch (VITE_ORT_RELAXED_ENABLE='false'): forces the
  // vendored stock runtime for every visitor regardless of their setting, so
  // a deployment can back out the self-compiled binary without a rebuild.
  if (operatorEnabled === false) return { ...stock, reason: 'operator' };
  if (backend !== 'wasm') return { ...stock, reason: 'backend' };
  if (!probeSupported) return { ...stock, reason: 'unsupported' };
  if (!artifactsPresent) return { ...stock, reason: 'unavailable' };
  if (mode === 'auto' && autoPick !== 'relaxed') return { ...stock, reason: 'auto-stock' };
  return { wasmPaths: ORT_RELAXED_BASE, wasmSimd: 'relaxed', engaged: true, reason: null };
}
