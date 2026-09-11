// What the app is ACTUALLY running, described for the sidebar.
//
// Every model control in the settings panel shows a REQUEST: the repo picker,
// the backend radios and the precision radios all display what the next load
// will ask for. What the app then loads is allowed to differ, in three ways
// that are all legitimate and none of which used to be reported anywhere:
//
//   - precision. hub.js resolves the request against what the source can serve
//     (the WASM int8 pin), and App.jsx falls a GPU visitor back to WASM when the
//     deployment ships no GPU-runnable encoder.
//   - source. A load aimed at HuggingFace can be switched to the instance's own
//     /models mirror, either up front (the quant upgrade, the reachability
//     preflight) or after a failed HF attempt.
//   - repo. The loaded model outlives a change to the picker until a reload.
//
// The failure this exists to end is silence, not any one of those behaviours:
// each is deliberate and each is right, but with nothing displaying the
// outcome, a station could sit on a "WebGPU / fp32" selection while an int8 CPU
// model did the work, and neither the UI nor the transcript would say so.
//
// Pure so it can be unit-tested: labels are injected rather than imported from
// i18n, and the comparison is done against the EFFECTIVE selected precision
// (what the radios show) rather than the raw stored one, or every fp16 pick on
// a GPU without shader-f16 would report a divergence the visitor cannot see.
//
// Built with Claude Code.

/**
 * @typedef {object} LoadedModel
 * @property {string} repoId Repo the live weights came from.
 * @property {string} backend Backend the live session was built on.
 * @property {string|null} encoderQuant Encoder precision actually mounted.
 * @property {string} servedFrom 'hf' | 'local'.
 */

/**
 * Whether what is loaded differs from what the controls currently request.
 *
 * The SOURCE is deliberately not part of this: weights arriving from the local
 * mirror rather than HuggingFace is a fact worth displaying, but it is not a
 * disagreement with anything the visitor selected, and flagging it would train
 * them to ignore the flag on every offline-capable deployment.
 *
 * @param {LoadedModel|null} loaded
 * @param {{repoId: string, backend: string, encoderQuant: string}} selected
 *   The current selection, with `encoderQuant` already resolved to the
 *   precision the radios display for this backend.
 * @returns {boolean}
 */
export function loadedModelDiverges(loaded, selected) {
  if (!loaded || !selected) return false;
  if (loaded.repoId !== selected.repoId) return true;
  if (loaded.backend !== selected.backend) return true;
  // A load that could not report its precision says nothing about it, rather
  // than claiming a mismatch it has no evidence for.
  if (!loaded.encoderQuant) return false;
  // Neither does a SELECTION with no runnable precision on its backend, which
  // is what effectiveEncoderQuant answers when a GPU can neither run nor be
  // served fp16 and the app is on its way to WASM int8. Comparing against a
  // value that is about to change would report a mismatch for the duration of
  // a fallback that is working correctly.
  if (!selected.encoderQuant) return false;
  return loaded.encoderQuant !== selected.encoderQuant;
}

/**
 * Build the one-line summary shown next to "Currently loaded".
 *
 * @param {LoadedModel|null} loaded
 * @param {{repoId: string, backend: string, encoderQuant: string}} selected
 * @param {{wasm: string, webgpu: string, fromHub: string, fromLocal: string}} labels
 *   Translated pieces, injected so this module stays pure.
 * @returns {{text: string, mismatch: boolean}|null} null when nothing is loaded.
 */
export function describeLoadedModel(loaded, selected, labels) {
  if (!loaded) return null;
  const parts = [loaded.backend?.startsWith('webgpu') ? labels.webgpu : labels.wasm];
  if (loaded.encoderQuant) parts.push(loaded.encoderQuant);
  parts.push(loaded.servedFrom === 'local' ? labels.fromLocal : labels.fromHub);
  // The repo only when it is NOT the selected one. Naming it on every load
  // would bury the one case that actually needs attention under a line that is
  // the same on every visit.
  if (selected && loaded.repoId !== selected.repoId) parts.push(loaded.repoId);
  return {
    text: parts.join(' · '),
    mismatch: loadedModelDiverges(loaded, selected),
  };
}

/**
 * Bring the sidebar's stored selection into line with what a load really
 * produced, so a fallback is not console-only.
 *
 * The backend half of this already happens elsewhere and earlier: the
 * GPU->WASM quant fallback flips the backend through `applyBackend` BEFORE it
 * retries, because the retry has to read the new value. What was left behind
 * was the precision, which stayed on the request forever: the radios kept
 * displaying an "effective" value computed for display only, while the stored
 * setting said something else and nothing ever wrote the outcome back.
 *
 * Two limits keep this from fighting the visitor:
 *
 *   - It only touches the precision of the backend that was ACTUALLY loaded,
 *     and only while that is still the selected one. If they have since moved
 *     the backend radio (a change that arms its own reload), the finishing load
 *     describes a configuration they have already left, and writing to it would
 *     undo a choice made a moment ago.
 *   - It never touches the repo. A picker change outlives the loaded model on
 *     purpose, and reconciling it would silently cancel the switch the visitor
 *     just asked for. That divergence is reported by the row instead.
 *
 * What it does overwrite is a precision the machine or the source could not
 * honour (fp16 picked on a GPU with no `shader-f16`, say). That costs nothing
 * visible, because the radios were already SHOWING the resolved value: the
 * write only stops the stored setting from disagreeing with the screen.
 *
 * @param {LoadedModel|null} loaded
 * @param {{repoId: string, backend: string, wasmEncoderQuant: string, webgpuEncoderQuant: string}} stored
 *   The raw persisted selection (not the effective/display value).
 * @returns {{wasmEncoderQuant?: string, webgpuEncoderQuant?: string}} The
 *   settings to write, empty when the selection already matches.
 */
export function reconcileSelection(loaded, stored) {
  if (!loaded || !stored) return {};
  if (!loaded.encoderQuant) return {};
  // Only reconcile the configuration still on screen.
  if (loaded.backend !== stored.backend) return {};
  const key = loaded.backend.startsWith('webgpu') ? 'webgpuEncoderQuant' : 'wasmEncoderQuant';
  if (stored[key] === loaded.encoderQuant) return {};
  return { [key]: loaded.encoderQuant };
}
