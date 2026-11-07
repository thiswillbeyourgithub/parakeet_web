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
