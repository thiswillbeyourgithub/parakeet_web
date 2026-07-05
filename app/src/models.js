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
    repoId: 'Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx',
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
 * repo (App.jsx pins Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx), so the CLI and the
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
// The window is capped low (20 s default, 25 s max) because parakeet-tdt v3
// transcription quality degrades noticeably once a single chunk runs much past
// ~25 s of audio: accuracy drops off past that point regardless of backend or
// precision, so we never let a chunk grow long enough to hit it. The floor
// (10 s min) keeps the number of stitch seams sane on long files.
export const DEFAULT_CHUNK_DURATION_SEC = 20;
export const MIN_CHUNK_DURATION_SEC = 10;
export const MAX_CHUNK_DURATION_SEC = 25;

/**
 * Get language display name.
 * @param {string} langCode - ISO 639-1 language code
 * @returns {string} Language display name or the code itself if not found
 */
export function getLanguageName(langCode) {
  return LANGUAGE_NAMES[langCode.toLowerCase()] || langCode;
}
