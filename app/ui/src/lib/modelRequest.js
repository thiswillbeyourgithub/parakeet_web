// What precision, and from which source, a model load ASKS FOR.
//
// hub.js decides what a repo can actually serve; this decides what to request
// of it. That is a separate question, and the one with the sharper rules:
//
//   - The app performs NO local rewriting of a GPU precision. fp16 used to be
//     degraded to fp32 whenever the adapter had no `shader-f16`, a 2.35 GB
//     download nobody asked for. Since 2026-09-11 the only substitution the app
//     makes on its own is the whole-backend flip to WASM int8 (see
//     loadFailure.js), so an fp16 request this machine or this source cannot
//     honour is SENT as fp16, refused by hub.js, and caught there.
//   - `int8lite` and `w4a8` are passed straight through rather than collapsed
//     to `int8`, so hub.js can tell "the user hand-picked that build and this
//     repo ships none" (which raises the quantUnavailable banner) apart from
//     "the user is on the default". That distinction IS the no-silent-downgrade
//     rule; collapsing here would take the banner away again.
//   - A first (HuggingFace) attempt still names the local mirror, but as an
//     UPGRADE base rather than a fallback one: hub.js may switch to it BEFORE
//     downloading when HF cannot deliver the requested quant and /models can,
//     which avoids fetching downgraded weights only to throw them away. The two
//     base-url keys are mutually exclusive and must stay that way.
//
// Kept pure and out of loadModel because every one of those rules is a decision
// about gigabytes the visitor will wait for, and inline none of them could be
// asserted without downloading a real model.

/** WASM encoder builds requested verbatim; anything else falls back to int8. */
const WASM_PASSTHROUGH_QUANTS = new Set(['int8lite', 'w4a8']);

/**
 * Resolve the options object handed to `getParakeetModel`, minus the two things
 * that are not decisions (the progress callback and the protected cache keys,
 * which the caller attaches).
 *
 * @param {object} a
 * @param {string} a.backend             e.g. 'wasm', 'webgpu-hybrid'
 * @param {string} a.wasmEncoderQuant    the WASM precision radio
 * @param {string} a.webgpuEncoderQuant  the WebGPU precision radio
 * @param {boolean} [a.webgpuShaderF16]  whether the adapter advertises shader-f16
 * @param {string} [a.preprocessor]      preprocessor variant, passed through
 * @param {boolean} [a.useLocalFallback] this attempt serves weights from /models
 * @param {string} [a.revision]          operator override of the model revision pin
 * @param {boolean} [a.allowFlatLocalFallback] may an unattributed flat /models
 *   tree stand in for a repo the mount has no subfolder for
 * @returns {{opts: object, wantWebgpu: boolean, wasmEncoderRequest: string}}
 *   `opts` for hub.js, plus the two derived facts the caller needs again later
 *   (the encode pool is eligible only on a non-fp32 WASM load).
 */
export function buildDownloadOpts({
  backend,
  wasmEncoderQuant,
  webgpuEncoderQuant,
  webgpuShaderF16 = false,
  preprocessor = undefined,
  useLocalFallback = false,
  revision = undefined,
  allowFlatLocalFallback = false,
}) {
  const wantWebgpu = String(backend || '').startsWith('webgpu');
  // On WASM the user may opt into the sharded fp32 encoder (full quality); the
  // allowWasmFp32 gate is what lets hub.js honour it, and only when the repo
  // ships the shards, else it falls back to the int8 pin.
  const wasmWantsFp32 = !wantWebgpu && wasmEncoderQuant === 'fp32';
  const wasmEncoderRequest = wasmWantsFp32
    ? 'fp32'
    : (WASM_PASSTHROUGH_QUANTS.has(wasmEncoderQuant) ? wasmEncoderQuant : 'int8');

  const opts = {
    encoderQuant: wantWebgpu ? webgpuEncoderQuant : wasmEncoderRequest,
    // The fused decoder_joint always runs int8 on both backends: on this model
    // the int8 joiner is as accurate as fp32 (measured) while being smaller and
    // faster, and the GPU EP runs it fine.
    decoderQuant: 'int8',
    allowWasmFp32: wasmWantsFp32,
    // hub.js re-checks fp16 against this rather than trusting the caller: it is
    // the one quant that can load and then silently produce nothing.
    shaderF16: webgpuShaderF16 === true,
    preprocessor,
    backend,
    // Never let an unattributed flat /models tree stand in for a repo the mount
    // has no subfolder for. Applies to both local paths below, the explicit
    // fallback and the pre-download quant upgrade.
    allowFlatLocalFallback,
  };
  // Operator-level override of the model revision pin. When unset, hub.js falls
  // back to the per-model revision baked into models.js, so an absent value must
  // not travel as an explicit `undefined`.
  if (revision) opts.revision = revision;
  if (useLocalFallback) {
    // Serve the weights from this instance under /models/ (hub.js auto-detects a
    // flat layout or a nested /models/<repoId>/ tree via resolveLocalModelBase).
    opts.localFallbackBaseUrl = '/models';
  } else {
    opts.localUpgradeBaseUrl = '/models';
  }
  return { opts, wantWebgpu, wasmEncoderRequest };
}
