// What to do when a model load throws.
//
// The catch in App.jsx's loadModel is a ladder of five outcomes (retry against
// HuggingFace, retry against the local mirror, flip a GPU backend to WASM and
// retry, name the unservable precision in a banner, or give up loudly), and
// which one applies depends on the error kind, the source the attempt used, the
// backend and precision in play, and which retries have already been spent.
//
// It lived inline, so the only way to reach a branch was to build a deployment
// that produces it: a mirror that 404s the GPU shards, a repo with no fp32
// shards, a HuggingFace that looks unreachable but is not. Each is a tier-3
// spec that loads real weights, and several combinations have no spec at all.
// The decision is pure, so it is separated from the doing here and the doing is
// all that stays in App.jsx.
//
// The one non-obvious property, pinned by a test below: the "name the
// precision" banner and the fatal popup are mutually exclusive by construction.
// The banner is for a precision the visitor picked BY HAND and can go back and
// change; the popup is for the one configuration the app picks for itself
// (WASM at the default encoder quant), where no other precision, backend or
// source is left to try.

import { shouldRetryLocally } from '../../../src/hub.js';

/**
 * Whether the caller should HEAD the local mirror before deciding. Skipped when
 * the operator already enabled local fallback (the retry happens regardless, so
 * the request would be pointless) and, of course, for anything that is not a
 * hub download failure on a hub attempt.
 *
 * @param {object} a
 * @param {boolean} a.isHubError          the error was a HubDownloadError
 * @param {boolean} a.useLocalFallback    this attempt already used /models
 * @param {boolean} a.localFallbackEnabled operator set VITE_MODEL_SOURCE=local|both
 * @returns {boolean}
 */
export function shouldProbeLocalMirror({ isHubError, useLocalFallback, localFallbackEnabled }) {
  return Boolean(isHubError && !useLocalFallback && !localFallbackEnabled);
}

/**
 * Decide what a failed load does next.
 *
 * @param {object} a
 * @param {boolean} a.isHubError            HubDownloadError
 * @param {boolean} a.isQuantUnavailable    QuantUnavailableError
 * @param {boolean} a.useLocalFallback      this attempt used /models
 * @param {boolean} a.forceLocalFallback    the user pinned local weights
 * @param {boolean} a.localFirst            the reachability preflight sent us local-first
 * @param {boolean} a.hubRetryTried         the local-first rescue is already spent
 * @param {boolean} a.localFallbackEnabled  operator set VITE_MODEL_SOURCE=local|both
 * @param {boolean} a.localReachable        the mirror probe found the files (false when not probed)
 * @param {boolean} a.isWebgpu              backend.startsWith('webgpu')
 * @param {boolean} a.wasmQuantIsDefault    wasmEncoderQuant === DEFAULT_WASM_ENCODER_QUANT
 * @param {boolean} a.allowQuantSubstitution the benchmark forbids it; the app allows it
 * @param {boolean} a.gpuQuantFallbackTried the GPU-to-WASM flip is already spent
 * @returns {{retry: null|{useLocalFallback: boolean, hubRetryTried?: boolean, gpuQuantFallbackTried?: boolean},
 *            reason: null|'hub-after-local-first'|'local-mirror'|'gpu-quant-to-wasm',
 *            switchBackendToWasm: boolean, markGpuQuantUnservable: boolean,
 *            gpuFallbackBanner: boolean, loadErrorBanner: null|'quantUnavailable',
 *            fatal: boolean}}
 */
export function planLoadFailure({
  isHubError = false,
  isQuantUnavailable = false,
  useLocalFallback = false,
  forceLocalFallback = false,
  localFirst = false,
  hubRetryTried = false,
  localFallbackEnabled = false,
  localReachable = false,
  isWebgpu = false,
  wasmQuantIsDefault = false,
  allowQuantSubstitution = true,
  gpuQuantFallbackTried = false,
} = {}) {
  const plan = {
    retry: null,
    // Short code for the retry the plan chose, so the caller can log WHY
    // without restating the ladder. null when nothing is retried.
    reason: null,
    switchBackendToWasm: false,
    markGpuQuantUnservable: false,
    gpuFallbackBanner: false,
    loadErrorBanner: null,
    fatal: false,
  };

  // The MIRROR of the local retry below, and what makes the reachability
  // preflight safe to act on without first verifying the mirror: this load went
  // local-first only because HuggingFace LOOKED unreachable, and the mirror
  // turned out not to serve the model. A false negative (an extension or a
  // proxy blocking the probe on a machine where HuggingFace works) must
  // therefore cost one fast same-origin miss, not a failed load.
  if (isHubError && useLocalFallback && !forceLocalFallback && localFirst && !hubRetryTried) {
    plan.retry = { useLocalFallback: false, hubRetryTried: true };
    plan.reason = 'hub-after-local-first';
    return plan;
  }

  // HuggingFace failed (blocked, unreachable, or simply not hosting this model)
  // and the mirror can answer: retry there rather than surfacing the failure.
  // hub.js owns that gate (operator-configured fallback, or a probe that found
  // the files); this must not restate it, or the two would drift.
  if (shouldRetryLocally({
    isHubError,
    alreadyLocal: useLocalFallback,
    localConfigured: localFallbackEnabled,
    localReachable,
  })) {
    plan.retry = { useLocalFallback: true };
    plan.reason = 'local-mirror';
    return plan;
  }

  if (isQuantUnavailable) {
    // On a GPU backend this means the machine cannot RUN the precision (fp16
    // without shader-f16) or the source does not HOST it. Either way the answer
    // is WASM int8, never another GPU precision: substituting fp32 would hand
    // someone who asked for 1.2 GB a 2.35 GB download, and substituting w4a8
    // would quietly swap in the weakest encoder on long audio. Both are
    // reachable by hand and only by hand.
    //
    // Retrying on WASM rather than stranding the visitor matters because they
    // may never have chosen WebGPU: the performance probe can select it for
    // them, so a deployment pointed at a repo without GPU weights would
    // otherwise break for every visitor whose machine wins that probe.
    //
    // Deliberately NOT a general "GPU failed, use the CPU" net: this fires only
    // for a quant that cannot be SERVED, a property of the deployment known
    // before a single weight byte is fetched. A GPU that fails later (OOM,
    // device lost) is a different problem and must stay visible.
    if (isWebgpu && allowQuantSubstitution && !gpuQuantFallbackTried) {
      plan.retry = { useLocalFallback, gpuQuantFallbackTried: true };
      plan.reason = 'gpu-quant-to-wasm';
      plan.switchBackendToWasm = true;
      plan.markGpuQuantUnservable = true;
      plan.gpuFallbackBanner = true;
      return plan;
    }
    // Any other precision reaching here was picked by hand and CAN be changed,
    // so it gets the banner naming it. The default-WASM case falls through to
    // the popup instead.
    if (isWebgpu || !wasmQuantIsDefault) plan.loadErrorBanner = 'quantUnavailable';
  }

  // Nowhere left to go, on the one configuration the app picks for itself.
  // Every retry above has either not applied or been spent, and the visitor is
  // on WASM asking for the default encoder quant: the backend every fallback
  // ends on, at the precision nothing is allowed to substitute for. That is
  // what separates this from every other load failure, and why it gets a
  // blocking popup rather than a `Failed` status under a page that still looks
  // usable. Note this applies to ANY error, not only an unservable quant.
  if (!isWebgpu && wasmQuantIsDefault) plan.fatal = true;
  return plan;
}
