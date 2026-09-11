// Which encoder precisions exist, what each one costs to download, and which of
// them a given MODEL SOURCE can actually serve.
//
// Three separate questions get confused constantly, and each has a different
// owner, so they are named apart here:
//
//   1. Does this BACKEND have a kernel for the precision? int8 has no WebGPU
//      encoder kernel; fp16 has no usable WASM one. A property of ORT, fixed
//      for all time, encoded in the two lists below.
//   2. Can this MACHINE run it? fp16 additionally needs the adapter's
//      `shader-f16` feature: without it ORT builds the session and then returns
//      an EMPTY transcript, so it has to be refused up front rather than
//      discovered at transcription time.
//   3. Does this SOURCE host the file? fp32 needs its shard set, w4a8 and fp16
//      need their own encoder builds. A property of the deployment, and the one
//      that used to be invisible until a load failed: a mirror serving int8 +
//      fp32 + w4a8 would happily offer an fp16 radio, take the click, and only
//      then report that this source does not host it.
//
// (3) is answerable in advance because a source always ends up describing
// itself: a local mirror publishes `model-manifest.json` (docker/entrypoint.sh
// writes one per repo at every boot) and HuggingFace has a listing API. hub.js
// already reads exactly that listing during a load, and `quantSatisfiable` is
// already the predicate it uses, so this module only has to ask the same
// question earlier and for every precision instead of one.
//
// Built with Claude Code.

// Imported by relative path rather than through the `parakeet.js` Vite alias so
// this module stays loadable in bare Node, which is what lets the whole policy
// be unit-tested against real repo listings instead of only through the app.
import { quantSatisfiable } from '../../../src/hub.js';

// Encoder precisions offered per backend, in PREFERENCE order: the radios have
// their own display order (ENCODER_QUANT_ROWS in App.jsx, ascending download
// size), and this order is the one a fallback walks when the chosen precision
// turns out not to be runnable here.
//
// WASM: int8 is the default; int8lite trades ~88 MB and ~164 MiB RSS for
// slightly higher WER; w4a8 is the smallest by a wide margin; fp32 is opt-in and
// only loadable when the source ships the shard set (a single 2.4 GB sidecar
// overflows both the 32-bit WASM heap and Chromium's blob wall).
export const WASM_ENCODER_QUANTS = ['int8lite', 'int8', 'w4a8', 'fp32'];
// WebGPU: fp16 is the default (~1.2 GB, near-lossless, and a single file that
// stays under every wall), with fp32 immediately behind it because that is what
// a machine without `shader-f16` degrades to; fp32 needs shards, like WASM, for
// Chromium's ~2 GB IndexedDB readback wall rather than the 32-bit one. w4a8's
// MatMulNBits dequantizes to fp16 in the shader, so its win is download and
// VRAM, not arithmetic. int8 is absent on purpose: there is no GPU int8 encoder
// kernel.
export const WEBGPU_ENCODER_QUANTS = ['fp16', 'fp32', 'w4a8'];

// What a visitor gets before they have ever picked anything, and what a
// nonsense saved value is coerced back to.
//
// These are the two halves of one rule and belong side by side: WebGPU wants
// fp16 (half the bytes of fp32 at the same accuracy, and the reason the model
// repos publish an fp16 encoder at all), WASM wants int8 (fp16 has no usable
// WASM kernel and ORT upcasts it to fp32 at session build, doubling the
// memory). A machine whose adapter reports no `shader-f16`, or a source that
// hosts no fp16 file, degrades to fp32 through the preference order above
// rather than by naming a different default here.
export const DEFAULT_WASM_ENCODER_QUANT = 'int8';
export const DEFAULT_WEBGPU_ENCODER_QUANT = 'fp16';

// Approximate download per encoder precision, in MB. Used to warn about
// bandwidth before a benchmark run, and to ORDER the automatic GPU substitution
// below, so a fallback nobody asked for reaches for the cheapest file that
// works rather than the largest. The real sizes come from the repo being
// served; these are measured on the shipped
// Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx weights, with the decoder
// (~18 MB) and preprocessor (~1 MB) folded in.
export const QUANT_DOWNLOAD_MB = {
  int8lite: 810,
  int8: 900,
  w4a8: 610,
  fp16: 1220,
  fp32: 2350,
};

/**
 * Every encoder precision a backend offers at all, before any source or machine
 * is consulted. Question (1) above.
 *
 * @param {string} backend 'wasm' | 'webgpu-hybrid' | ...
 * @returns {string[]}
 */
export function encoderQuantsFor(backend) {
  return String(backend || '').startsWith('webgpu') ? WEBGPU_ENCODER_QUANTS : WASM_ENCODER_QUANTS;
}

/**
 * Which precisions a source can really deliver, per backend.
 *
 * Answers with `null` (rather than an empty set) when there is no listing to
 * reason from, which is the important case: a mirror with no manifest, a
 * listing request that failed, a probe that has not finished. `null` means "no
 * opinion", and every caller has to treat it as "offer everything", because
 * greying a control out on the strength of an unanswered question is how a
 * perfectly loadable precision becomes unreachable.
 *
 * @param {object} args
 * @param {string[]|null} args.repoFiles Listing as hub.js reads it, or null.
 * @param {boolean} args.shaderF16 Whether the adapter exposes shader-f16.
 * @returns {{wasm: string[], webgpu: string[]}|null}
 */
export function servableEncoderQuants({ repoFiles, shaderF16 = false } = {}) {
  if (!Array.isArray(repoFiles) || !repoFiles.length) return null;
  const test = (backend, encoderQuant) => quantSatisfiable({
    backend,
    encoderQuant,
    decoderQuant: 'int8',
    repoFiles,
    shaderF16,
    // The app always pairs an fp32 WASM request with allowWasmFp32, so the
    // probe has to ask the same question the load will ask. Without it every
    // fp32 WASM radio would be greyed out on a mirror that serves the shards.
    allowWasmFp32: true,
  });
  return {
    wasm: WASM_ENCODER_QUANTS.filter((q) => test('wasm', q)),
    webgpu: WEBGPU_ENCODER_QUANTS.filter((q) => test('webgpu-hybrid', q)),
  };
}

/**
 * The precision radios to render for a backend: which ones appear at all, and
 * which of those appear greyed out with a reason.
 *
 * The three questions at the top of this file get three different answers here,
 * and the split is the whole point:
 *
 *   (1) BACKEND has no kernel -> the row is not rendered. There is nothing for a
 *       visitor to do about it and nothing to learn from it: int8 on WebGPU is
 *       not a precision that is unavailable today, it is one that does not exist
 *       on that backend, and a greyed row claiming otherwise reads as breakage.
 *       This is also what stopped fp16 from showing up greyed under WASM, which
 *       is exactly how it got misread as "the fp16 file is missing".
 *   (2) SOURCE does not host the file -> the row is not rendered either. Same
 *       reasoning, one level out: a deployment serving int8 + fp32 + w4a8 has a
 *       three-precision model, and listing two more that it cannot serve
 *       describes a different deployment. Hiding them is what lets the list
 *       track any ONNX repo instead of this project's own file set.
 *   (3) MACHINE cannot run it -> the row IS rendered, greyed, with the reason.
 *       This one is worth a row precisely because it is the only one the
 *       visitor's own hardware decides: fp16 exists, this source serves it, and
 *       the answer to "why can't I pick it" lives in their adapter. Hiding it
 *       would make two machines against the same deployment show different
 *       lists with nothing to explain the difference.
 *
 * A `null` listing keeps meaning "no opinion", so (2) drops out entirely and
 * everything the backend offers is shown; see servableEncoderQuants.
 *
 * @param {object} args
 * @param {string} args.backend 'wasm' | 'webgpu-hybrid' | ...
 * @param {string[]|null} [args.repoFiles] Listing as hub.js reads it, or null.
 * @param {boolean} [args.shaderF16] Whether the adapter exposes shader-f16.
 * @param {string[]} [args.order] Display order (ascending download size).
 * @returns {Array<{value: string, available: boolean, reason: (string|null)}>}
 *   `reason` is null when available, else 'no-shader-f16' or 'source'.
 */
export function encoderQuantRows({ backend, repoFiles = null, shaderF16 = false, order = null } = {}) {
  const isWebgpu = String(backend || '').startsWith('webgpu');
  const offered = encoderQuantsFor(backend);
  const sorted = order ? order.filter((q) => offered.includes(q)) : offered;
  // Ask the FILE question as though the machine could run anything. Passing the
  // real shaderF16 here would fold the machine's answer into the source's, and
  // an adapter without shader-f16 would make the fp16 file look absent from a
  // mirror that serves it, hiding the one row that has something to say.
  const hosted = servableEncoderQuants({ repoFiles, shaderF16: true });
  const hostedHere = hosted ? (isWebgpu ? hosted.webgpu : hosted.wasm) : null;
  const rows = sorted
    .filter((q) => !hostedHere || hostedHere.includes(q))
    .map((q) => (isWebgpu && q === 'fp16' && !shaderF16
      ? { value: q, available: false, reason: 'no-shader-f16' }
      : { value: q, available: true, reason: null }));
  // A source that hosts nothing this backend can run would otherwise render an
  // empty control: no radios, no explanation, no way to tell a broken listing
  // from a deliberate one. Fall back to the backend's own list, greyed, so the
  // reason is at least on screen. The load would fail with the same diagnosis.
  if (!rows.length) return sorted.map((q) => ({ value: q, available: false, reason: 'source' }));
  return rows;
}

/**
 * Which encoder precision a load would REALLY use, given what the visitor has
 * selected, what their machine can run and what this source hosts.
 *
 * Three gates, deliberately asymmetric in how they fail:
 *
 *  1. The backend's kernel list, which is fixed and always known.
 *  2. fp16's `shader-f16` adapter feature. "Still probing" counts as "not yet",
 *     so fp16 is never used on the strength of an unanswered question: without
 *     the feature ORT builds a session and then transcribes silence.
 *  3. Whether the source hosts the file (`servable`). This one fails the OTHER
 *     way: null means the listing is unknown, and an unknown source must offer
 *     everything, because refusing a precision because a mirror published no
 *     manifest would make a perfectly loadable model unreachable.
 *
 * The answer is the selection when it survives all three, else the first
 * precision in the backend's preference order that does. That is what turns the
 * fp16 default into fp32 on a machine with no shader-f16, or on a source that
 * hosts no fp16 file, without rewriting the preference itself: the visitor who
 * moves to a machine that CAN run fp16 gets it back.
 *
 * @param {object} args
 * @param {string} args.backend 'wasm' | 'webgpu-hybrid' | ...
 * @param {string} args.selected The precision the visitor has chosen.
 * @param {{wasm: string[], webgpu: string[]}|null} [args.servable] From
 *   servableEncoderQuants, or null when the listing is unknown.
 * @param {boolean} [args.shaderF16] Whether the adapter exposes shader-f16.
 * @returns {string}
 */
export function effectiveEncoderQuant({ backend, selected, servable = null, shaderF16 = false } = {}) {
  const isWebgpu = String(backend || '').startsWith('webgpu');
  const offered = isWebgpu ? WEBGPU_ENCODER_QUANTS : WASM_ENCODER_QUANTS;
  const hosted = isWebgpu ? servable?.webgpu : servable?.wasm;
  const runnable = (q) => {
    if (!offered.includes(q)) return false;
    if (isWebgpu && q === 'fp16' && !shaderF16) return false;
    return !hosted || hosted.includes(q);
  };
  if (runnable(selected)) return selected;
  const next = offered.find(runnable);
  if (next) return next;
  // The source can serve nothing this backend runs, so the load is going to
  // fail whatever is named here and the GPU-to-WASM fallback takes it from
  // there. fp32 rather than the fp16 default because fp16 without the adapter
  // feature builds a session that transcribes silence, which is the one failure
  // worth never walking into blind.
  return isWebgpu ? 'fp32' : DEFAULT_WASM_ENCODER_QUANT;
}

/**
 * The precision to substitute when a GPU load finds its own precision
 * unservable, staying ON the GPU.
 *
 * The rule is cheapest-first, which is not an aesthetic preference: this
 * substitution is one the visitor did not ask for, so it must not be able to
 * turn a 1.2 GB choice into a 2.35 GB download by surprise. w4a8 is a quarter
 * of fp32's bytes at the same accuracy (slower kernels, which is a trade the
 * visitor can then reverse deliberately from the sidebar), so it goes first
 * wherever a source serves it.
 *
 * Returns null when nothing else on this GPU can be served, which is the only
 * case that justifies changing the BACKEND as well. Changing both at once was
 * the old behaviour and it is the wrong answer twice over: it moves a visitor
 * off the GPU they were measured onto, and it does it for a reason (a file the
 * deployment does not host) that says nothing about their hardware.
 *
 * @param {object} args
 * @param {string} args.current The precision that could not be served.
 * @param {string[]} [args.tried] Precisions already refused this load.
 * @param {string[]|null} [args.servable] Known-servable GPU precisions, or null
 *   when unknown; unknown means "try them all and let the load decide".
 * @param {boolean} [args.shaderF16]
 * @returns {string|null}
 */
export function nextGpuEncoderQuant({ current, tried = [], servable = null, shaderF16 = false } = {}) {
  const seen = new Set([current, ...tried]);
  const allowed = servable ? new Set(servable) : null;
  const candidates = WEBGPU_ENCODER_QUANTS
    .filter((q) => !seen.has(q))
    // A precision the machine cannot run is not a fallback, it is the next
    // failure: fp16 without shader-f16 builds a session and transcribes
    // nothing.
    .filter((q) => q !== 'fp16' || shaderF16)
    .filter((q) => !allowed || allowed.has(q))
    .sort((a, b) => (QUANT_DOWNLOAD_MB[a] ?? Infinity) - (QUANT_DOWNLOAD_MB[b] ?? Infinity));
  return candidates[0] ?? null;
}
