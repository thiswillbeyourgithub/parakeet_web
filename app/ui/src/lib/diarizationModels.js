// Download + cache the two ONNX models the sherpa-onnx diarization engine needs:
// a pyannote segmentation model and a CAM++ speaker-embedding model. Reuses the
// app's hub (HuggingFace + IndexedDB cache) and its local-/models fallback, so
// diarization weights ride the exact same supply chain as the Parakeet weights.
//
// Defaults point at un-gated, hub-resolvable HF mirrors (the canonical
// pyannote/segmentation-3.0 repo is gated, so we use csukuangfj's mirror). All
// four pieces are operator-overridable via VITE_DIARIZATION_* (see config.js).
//
// These models live in a DIFFERENT repo than the Parakeet model, so the
// generational cache sweep at the end of getParakeetModel would treat them as
// orphans and delete them. diarizationModelProtectKeys() exposes their base
// cache keys so App.jsx can pass them as getParakeetModel's protectCacheKeys.

import { getModelFile, getLocalModelFile, HubDownloadError, modelFileCacheKeys } from 'parakeet.js';
import { CONFIG } from '../config.js';

const SEG_REPO = CONFIG.VITE_DIARIZATION_SEG_REPO || 'csukuangfj/sherpa-onnx-pyannote-segmentation-3-0';
const SEG_FILE = CONFIG.VITE_DIARIZATION_SEG_FILE || 'model.onnx';
const EMB_REPO = CONFIG.VITE_DIARIZATION_EMB_REPO || 'csukuangfj/speaker-embedding-models';
// Multilingual (zh+en "advanced common") CAM++: speaker embeddings transfer
// across languages, and this is the broadest CAM++, a better default for the
// en/fr Parakeet model than the zh-cn-only baked-in ERes2Net.
const EMB_FILE = CONFIG.VITE_DIARIZATION_EMB_FILE || '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx';

/** The (repo, file) descriptors for the two diarization models. */
export const DIARIZATION_MODELS = [
  { kind: 'segmentation', repo: SEG_REPO, file: SEG_FILE },
  { kind: 'embedding', repo: EMB_REPO, file: EMB_FILE },
];

// Memoised so concurrent callers (background prefetch + a click) share one
// download, and a second diarization reuses the bytes already in memory.
let _modelsPromise = null;

async function fetchBytes(repo, file, { localBaseUrl, localOnly, progress }) {
  if (localOnly) {
    return getLocalModelFile(localBaseUrl, repo, file, { asBytes: true, progress });
  }
  try {
    return await getModelFile(repo, file, { asBytes: true, progress });
  } catch (err) {
    if (err instanceof HubDownloadError && localBaseUrl) {
      console.warn(`[Diarize] HF fetch of ${file} failed; falling back to ${localBaseUrl}`);
      return getLocalModelFile(localBaseUrl, repo, file, { asBytes: true, progress });
    }
    throw err;
  }
}

/**
 * Download (or read from cache) the segmentation + embedding models. Memoised:
 * the first call wins, the rest await it.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.localBaseUrl] local mirror base (e.g. '/models')
 *   to fall back to when HF is unreachable; null to disable the fallback.
 * @param {boolean} [opts.localOnly=false] skip HF entirely, serve from localBaseUrl.
 * @param {(p:{loaded:number,total:number})=>void} [opts.onProgress] aggregate
 *   byte progress across both files.
 * @returns {Promise<{segmentationBytes:Uint8Array, embeddingBytes:Uint8Array}>}
 */
export function getDiarizationModels({ localBaseUrl = null, localOnly = false, onProgress } = {}) {
  if (_modelsPromise) return _modelsPromise;
  _modelsPromise = (async () => {
    // Aggregate progress across the two parallel downloads.
    const acc = { seg: { loaded: 0, total: 0 }, emb: { loaded: 0, total: 0 } };
    const report = () => onProgress && onProgress({
      loaded: acc.seg.loaded + acc.emb.loaded,
      total: acc.seg.total + acc.emb.total,
    });
    const mkProgress = (slot) => onProgress
      ? ({ loaded, total }) => { acc[slot] = { loaded: loaded || 0, total: total || 0 }; report(); }
      : undefined;

    const [segmentationBytes, embeddingBytes] = await Promise.all([
      fetchBytes(SEG_REPO, SEG_FILE, { localBaseUrl, localOnly, progress: mkProgress('seg') }),
      fetchBytes(EMB_REPO, EMB_FILE, { localBaseUrl, localOnly, progress: mkProgress('emb') }),
    ]);
    return { segmentationBytes, embeddingBytes };
  })().catch((err) => {
    _modelsPromise = null; // let a failed download be retried
    throw err;
  });
  return _modelsPromise;
}

/**
 * Base IndexedDB cache keys for both diarization models, so the Parakeet model
 * sweep can be told to keep them (getParakeetModel protectCacheKeys).
 * @returns {string[]}
 */
export function diarizationModelProtectKeys() {
  return DIARIZATION_MODELS.map(({ repo, file }) => modelFileCacheKeys(repo, file).blob);
}
