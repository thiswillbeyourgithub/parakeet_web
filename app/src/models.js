/**
 * Model configurations for supported Parakeet variants.
 * Centralises model metadata (vocab size, mel bins, prediction network shape,
 * supported languages) so adding new model versions is a single-object change
 * rather than scattered hardcoded constants.
 */

/**
 * Language display names for supported languages.
 * @type {Object.<string, string>}
 */
export const LANGUAGE_NAMES = {
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  ru: 'Russian',
  uk: 'Ukrainian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
};

/**
 * @typedef {Object} ModelConfig
 * @property {string} repoId - HuggingFace repository ID
 * @property {string} displayName - Human-readable name for UI
 * @property {string[]} languages - Supported languages (ISO 639-1 codes)
 * @property {string} defaultLanguage - Default language for transcription
 * @property {number} vocabSize - Expected vocabulary size
 * @property {number} featuresSize - Mel spectrogram features (80 or 128)
 * @property {string} preprocessor - Default preprocessor variant
 * @property {number} subsampling - Subsampling factor
 * @property {number} predHidden - Prediction network hidden size
 * @property {number} predLayers - Prediction network layers
 */

/**
 * Supported model configurations.
 * Each key is a short model identifier that can be used with fromHub() and
 * getModelConfig() instead of a full HuggingFace repo ID.
 * @type {Object.<string, ModelConfig>}
 */
export const MODELS = {
  'parakeet-tdt-0.6b-v3': {
    repoId: 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx',
    displayName: 'Parakeet TDT 0.6B v3 (Multilingual)',
    languages: ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'uk', 'ja', 'ko', 'zh'],
    defaultLanguage: 'en',
    vocabSize: 4097,  // Larger vocabulary for multilingual support
    featuresSize: 128,
    preprocessor: 'nemo128',
    subsampling: 8,
    predHidden: 640,
    predLayers: 2,
    revision: 'main',
  },
};

/**
 * Default model to use when none specified. Matches the web app's own default
 * repo (App.jsx pins Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx), so the CLI and the
 * browser default to the same multilingual v3 model.
 * @type {string}
 */
export const DEFAULT_MODEL = 'parakeet-tdt-0.6b-v3';

/**
 * Get model configuration by model key or repo ID.
 * @param {string} modelKeyOrRepoId - Model key (e.g., 'parakeet-tdt-0.6b-v3') or repo ID
 * @returns {ModelConfig|null} Model configuration or null if not found
 */
export function getModelConfig(modelKeyOrRepoId) {
  // Direct key lookup
  if (MODELS[modelKeyOrRepoId]) {
    return MODELS[modelKeyOrRepoId];
  }

  // Search by repo ID
  for (const [key, config] of Object.entries(MODELS)) {
    if (config.repoId === modelKeyOrRepoId) {
      return config;
    }
  }

  return null;
}

/**
 * Get model key from repo ID.
 * @param {string} repoId - HuggingFace repository ID
 * @returns {string|null} Model key or null if not found
 */
export function getModelKeyFromRepoId(repoId) {
  for (const [key, config] of Object.entries(MODELS)) {
    if (config.repoId === repoId) {
      return key;
    }
  }
  return null;
}

/**
 * Check if a model supports a given language.
 * @param {string} modelKeyOrRepoId - Model key or repo ID
 * @param {string} language - ISO 639-1 language code
 * @returns {boolean} True if language is supported
 */
export function supportsLanguage(modelKeyOrRepoId, language) {
  const config = getModelConfig(modelKeyOrRepoId);
  if (!config) return false;
  return config.languages.includes(language.toLowerCase());
}

/**
 * List all available model keys.
 * @returns {string[]} Array of model keys
 */
export function listModels() {
  return Object.keys(MODELS);
}

// Default chunk window (seconds) for long-audio chunking. A single window for
// every backend and precision. This used to be backend-aware: the WASM/int8 path
// got a shorter window because the stock int8 encoder dropped long-range content
// past ~20 s within a chunk. The SmoothQuant int8 encoder this app ships no longer
// has that problem (it tracks fp16 over long single passes, see the model repo's
// WER tables), and fp16/fp32 never did, so the special case is gone.
//
// The old 20 s default / 25 s cap assumed parakeet-tdt v3 degrades past ~25 s
// per chunk. A 2026-08-07 grid over 200 long French-medical clips (2.7 h of
// audio, seam dedup verified engaged) measured the OPPOSITE: quality improves
// with the window, every seam costs a little (mostly deletions at the splice),
// and 60 s chunks sit within +0.14 WER of decoding each clip whole (vs +0.66
// at 20 s, +1.28 at 25 s). That grid also reported flat throughput across
// window sizes, which a later in-browser A/B refuted: on a 6C/12T box, n=20
// per arm, 60 s is 7-9 % SLOWER than 20 s end to end on the WASM path
// (confirmed independently on two builds and two quantisations, each p < 0.02)
// while being 2.3x FASTER on WebGPU, since conformer attention is quadratic in
// window length but the GPU is bound by per-run event-loop overhead instead.
// The accuracy result stands, and it is the reason for the default: the CPU
// path knowingly pays ~7 % for ~0.5 WER. So the
// default is 60 s; the cap leaves headroom above it (whole-clip decodes up to
// ~77 s measured clean; past that is extrapolation, bounded at 90 s because
// conformer attention memory grows quadratically with the window and an OOM
// on a weak device fails loudly but still fails). The floor (10 s min) keeps
// the number of stitch seams sane on long files.
export const DEFAULT_CHUNK_DURATION_SEC = 60;
export const MIN_CHUNK_DURATION_SEC = 10;
export const MAX_CHUNK_DURATION_SEC = 90;

/**
 * Get language display name.
 * @param {string} langCode - ISO 639-1 language code
 * @returns {string} Language display name or the code itself if not found
 */
export function getLanguageName(langCode) {
  return LANGUAGE_NAMES[langCode.toLowerCase()] || langCode;
}
