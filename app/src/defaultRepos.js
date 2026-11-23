// Default HuggingFace repos, in ONE place.
//
// The browser app (modelRepos.js, diarizationModels.js) falls back to these
// when the operator configures nothing, and the container entrypoint reads
// the same file to build the HF relay's repo allowlist. Two copies would
// drift: a default bumped in the UI but not in the allowlist makes the relay
// refuse the very repo the app asks it for, with nothing failing at build.
//
// Kept dependency-free so `node` can import it standalone inside the image.
//
// Built with Claude Code.

/** ASR model repo used when VITE_MODEL_REPO is unset. */
export const DEFAULT_MODEL_REPO = 'Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx';

/** Streaming Sortformer diarization repo used when VITE_DIARIZATION_REPO is unset. */
export const DEFAULT_DIARIZATION_REPO = 'Olicorne/Nemotron-3-Diarization-web-onnx';

/** Speaker-embedding repo used when VITE_DIARIZATION_EMB_REPO is unset. */
export const DEFAULT_DIARIZATION_EMB_REPO = 'csukuangfj/speaker-embedding-models';

/**
 * The French medical fine-tune the app ships for medical dictation. UltiMed v1
 * again since 2026-11-23: v2 turned out WORSE than v1 (owner finding), so v1 is
 * the default and v2 is only offered as an experimental pick.
 */
export const ULTIMED_MODEL_REPO = 'Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v1-onnx';

/** UltiMed v2: still offerable, but experimental (often far worse than v1). */
export const ULTIMED_V2_REPO = 'Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v2-onnx';

/**
 * Repos the picker labels "(experimental)", lists last, warns about when picked
 * and never remembers as the visitor's choice.
 */
export const EXPERIMENTAL_REPOS = Object.freeze([ULTIMED_V2_REPO]);

/** @param {string|null|undefined} repoId */
export function isExperimentalRepo(repoId) {
  return EXPERIMENTAL_REPOS.includes(repoId);
}

/**
 * Repo ids that no longer name the model the app should load, old id -> new
 * id. Shared with the entrypoint for the same reason as the defaults above:
 * the browser migrates a configured id, so the relay must allowlist the
 * migrated one or it refuses the very repo the app asks for.
 *
 *  - 2026-10-19: the hub renamed `-UltiMed-onnx` to `-ultra-UltiMed-onnx` and
 *    `-redux-UltiMed-onnx` to `-redux-UltiMed-experimental-onnx`.
 * - 2026-11-23: `-redux-UltiMed-experimental-onnx` renamed to
 *   `-redux-UltiMed-v2-experimental-onnx` (it already held the v2 redux).
 *  - 2026-11-21: `-ultra-UltiMed-onnx` was renamed again to
 *    `-ultra-UltiMed-v1-onnx` (the hub redirects there) and UltiMed v2 shipped
 *    as `-ultra-UltiMed-v2-onnx`. Both pre-v2 ids go to ULTIMED_MODEL_REPO,
 *    because neither named a version: whoever saved or configured them wanted
 *    "the UltiMed model", which is v1 again since 2026-11-23 (it was v2 for two
 *    days, until v2 measured worse).
 *
 * A saved pick, a `?model=` link and a VITE_MODEL_REPO entry all go through
 * this map, so none of them silently falls back to the default model.
 */
export const RENAMED_REPOS = Object.freeze({
  'Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx': ULTIMED_MODEL_REPO,
  'Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-onnx': ULTIMED_MODEL_REPO,
  'Olicorne/parakeet-tdt-0.6b-v3-redux-UltiMed-onnx': 'Olicorne/parakeet-tdt-0.6b-v3-redux-UltiMed-v2-experimental-onnx',
  'Olicorne/parakeet-tdt-0.6b-v3-redux-UltiMed-experimental-onnx': 'Olicorne/parakeet-tdt-0.6b-v3-redux-UltiMed-v2-experimental-onnx',
});

/**
 * Map a possibly renamed repo id to its current id (identity otherwise).
 *
 * @param {string|null|undefined} repoId
 * @returns {string|null|undefined}
 */
export function migrateRepoId(repoId) {
  return RENAMED_REPOS[repoId] ?? repoId;
}
