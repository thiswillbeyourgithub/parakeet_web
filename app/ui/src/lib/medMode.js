// Pure policy for "Mode Dictée Médical": the one-shot preset that turns the
// generic transcriber into a French medical dictation station.
//
// It exists in two places that MUST agree, which is the whole reason the values
// live here rather than inline in App.jsx: a `?mode=<alias>` link (applied on
// page load) and a sidebar button (applied on click). Both call the same
// applier over this one table, so a link and a click can never configure two
// slightly different stations.
//
// Kept free of any DOM/CONFIG/React access so every rule below is unit-testable.
// That matters because the failure mode is silent: a preset that applies six of
// its seven settings still transcribes happily, just not the way the clinician
// was promised (wrong lexicon, wrong chunk window, wrong precision), and nothing
// in the UI says so.
//
// Built with Claude Code.

/**
 * Query-param values that request medical dictation mode.
 *
 * Deliberately a generous list rather than one canonical spelling: the param
 * exists for links people type from memory or read out to each other, so the
 * doctor-facing words are all accepted. Matching is case- AND accent-insensitive
 * (see foldModeValue), so `?mode=Médecin`, `?mode=medecin` and `?mode=MEDECIN`
 * are the same request and no separate accented entry is needed here.
 */
export const MED_MODE_ALIASES = Object.freeze([
  'med',
  'medecin',
  'medical',
  'doc',
  'doctor',
  'ultimed',
]);

/**
 * The preset itself. Only the MEDICAL-SPECIFIC choices live here; the phrase
 * boosting tuning knobs (strength / min-p gate / depth scaling) deliberately do
 * NOT, because the requirement for those is "the app's own defaults" and
 * duplicating those numbers here is exactly how the two copies drift apart. The
 * applier in App.jsx resets them from the constants that own them.
 *
 * Field notes:
 *  - modelQuery is fed to matchModelRepo() rather than being a hardcoded repo
 *    id, so the preset resolves against whatever the operator actually put in
 *    VITE_MODEL_REPO ("ultimed" -> Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx).
 *    An operator who offers no UltiMed repo gets a warning and keeps their
 *    model, rather than a 404 at download time.
 *  - chunkDurationSec 30 is half the app-wide 60 s default: dictation is short
 *    bursts, and a shorter window returns the first text sooner.
 *  - wasmEncoderQuant / webgpuEncoderQuant are set as a PAIR, not as one value
 *    for the current backend, because the on-load autoconfigure probe may still
 *    move the visitor between the two after this preset has been applied.
 *  - webgpuEncoderQuant is fp16 (changed 2026-09-11, owner instruction), the
 *    same default the app now uses everywhere else. It was fp32 because fp16
 *    needs two things at once that a medical deployment cannot always promise,
 *    an adapter exposing `shader-f16` and a model source hosting
 *    `encoder-model.fp16.onnx`, and missing either one used to fail the load
 *    over to WASM and PERSIST that flip, so the station quietly stopped using
 *    its GPU. Neither half of that survives: a missing adapter feature now
 *    degrades to fp32 in effectiveEncoderQuant before hub.js is ever asked, and
 *    a source that does not host the file clears its own
 *    `gpuWeightsUnservableSig` as soon as it starts serving it. What is left is
 *    a reason to prefer fp16 here more than anywhere else, not less: the
 *    station reloads all day on a network chosen for being locked down, and
 *    fp16 is half of fp32's bytes at the same accuracy. fp32 stays reachable by
 *    hand, and a later `?mode=med` deliberately resets such a pick, because the
 *    link is a setup instruction for the whole station. int8 is NOT an option
 *    here despite being the WASM choice: ORT has no WebGPU kernel for it (see
 *    WEBGPU_ENCODER_QUANTS in lib/encoderQuants.js), so asking for it on the
 *    GPU would either be refused or silently execute on the CPU.
 *  - lang is forced to French: the lexicon, the dictation regexes and the model
 *    are all French, so an English UI would misdescribe the station.
 *  - autoCopyToClipboard is the one preset value that turns a default OFF into
 *    an ON, and it is a deliberate trade rather than an oversight. It is off by
 *    default because the system clipboard is readable by other apps and
 *    extensions; on a dictation station the whole workflow is dictate-then-paste
 *    into a record, so paying that cost once buys back a click per utterance.
 *    Note it copies the DICTATED text (regexes applied) when the dictation view
 *    is on, which this preset also switches on.
 */
export const MED_MODE_PRESET = Object.freeze({
  modelQuery: 'ultimed',
  boostSource: 'french_medical.txt',
  enableChunking: true,
  chunkDurationSec: 30,
  transcriptDisplayMode: 'dictation',
  autoCopyToClipboard: true,
  wasmEncoderQuant: 'int8',
  webgpuEncoderQuant: 'fp16',
  lang: 'fr',
});

/**
 * Normalise a `?mode=` value for comparison: trimmed, lowercased and stripped of
 * combining accents (NFD splits "é" into "e" + U+0301, which the range below
 * then drops).
 *
 * @param {unknown} raw The raw param value.
 * @returns {string} The folded value, or '' when there was nothing usable.
 */
export function foldModeValue(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Whether a single `?mode=` value names medical dictation mode.
 *
 * @param {unknown} raw The raw param value.
 * @returns {boolean}
 */
export function isMedModeValue(raw) {
  const folded = foldModeValue(raw);
  return folded !== '' && MED_MODE_ALIASES.includes(folded);
}

/**
 * Whether a query string requests medical dictation mode.
 *
 * An unknown `?mode=` value is NOT an error: it means "no opinion", so the
 * visitor keeps their saved settings instead of being handed a preset they did
 * not ask for. Same reasoning as matchModelRepo() returning null.
 *
 * @param {string|undefined|null} search A `location.search` string (leading `?`
 *   optional), as URLSearchParams accepts it.
 * @returns {boolean}
 */
export function medModeRequested(search) {
  try {
    return isMedModeValue(new URLSearchParams(search || '').get('mode'));
  } catch {
    // URLSearchParams can throw on exotic input; a malformed query string must
    // never be able to stop the app from booting.
    return false;
  }
}
