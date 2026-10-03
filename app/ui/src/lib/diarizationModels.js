// Download + cache what speaker diarization needs: the Streaming Sortformer
// model (NVIDIA Nemotron-3-Diarization, exported for the browser as
// Olicorne/Nemotron-3-Diarization-web-onnx) and the CAM++ speaker-embedding
// model that cross-recording voice matching runs (speakerEmbedding.js). Reuses
// the app's hub (HuggingFace + IndexedDB cache) and its local-/models
// fallback, so diarization weights ride the exact same supply chain as the
// Parakeet weights.
//
// The Sortformer repo ships the network as two graphs plus two small data
// files (app/src/sortformer.js runs the rest):
//   embed.onnx               2 MB, feature stacking + projection, every backend
//   <precision>/step...onnx  the encoder: int8 100 MB (WASM), fp16 198 MB
//                            (WebGPU with shader-f16), fp32 396 MB (WebGPU without)
//   silence_embeds.bin       2 KB, float32 [512]
//   diarization-config.json  chunking + speaker-cache constants
// Only ONE step precision is downloaded, the one the backend runs
// (diarizationPrecision), the same rule the ASR encoder follows.
//
// Repos are operator-overridable via VITE_DIARIZATION_REPO and
// VITE_DIARIZATION_EMB_REPO/_FILE (see config.js, docker/env.example).
//
// These models live in DIFFERENT repos than the Parakeet model, so the
// generational cache sweep at the end of getParakeetModel would treat them as
// orphans and delete them. diarizationModelProtectKeys() exposes their base
// cache keys (every precision, so switching backend never sweeps the other)
// so App.jsx can pass them as getParakeetModel's protectCacheKeys.

import { getModelFile, getLocalModelFile, resolveLocalModelBase, HubDownloadError, modelFileCacheKeys } from 'parakeet.js';
import { CONFIG } from '../config.js';
import { diarizationFileName } from './modelRepos.js';
import { DIARIZATION_STEP_FILES, parseDiarizationData } from './diarizationFiles.js';

export const DIAR_REPO = CONFIG.VITE_DIARIZATION_REPO || 'Olicorne/Nemotron-3-Diarization-web-onnx';
const EMB_REPO = CONFIG.VITE_DIARIZATION_EMB_REPO || 'csukuangfj/speaker-embedding-models';
// Multilingual (zh+en "advanced common") CAM++: speaker embeddings transfer
// across languages, and this is the broadest CAM++, a better default for the
// en/fr Parakeet model than the zh-cn-only baked-in ERes2Net.
const EMB_FILE = diarizationFileName(
  CONFIG.VITE_DIARIZATION_EMB_FILE,
  '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
);

const CONFIG_FILE = 'diarization-config.json';
const EMBED_FILE = 'embed.onnx';
const SILENCE_FILE = 'silence_embeds.bin';
// Memoised per precision so concurrent callers (background prefetch + a
// click) share one download, and a second diarization reuses the bytes.
const _models = new Map();

// A local mirror can be flat (<base>/<file>) or nested by repo
// (<base>/<repo>/<file>). getLocalModelFile builds `<base>/<filename>` and uses
// repoId only for the cache key, so resolve the base per repo first, exactly as
// getParakeetModel does for the ASR weights.
//
// The flat fallback is deliberately NOT guarded the way the ASR one is. There
// the visitor picks the repo, so an unattributed flat tree could be served
// under a different model's name; here the repos are fixed (operator-set at
// build time at most), so there is no other model for a flat tree to be
// mistaken for.
async function localBase(baseUrl, repo, canary) {
  return (await resolveLocalModelBase(baseUrl, repo, { canary })) || baseUrl;
}

async function fetchBytes(repo, file, canary, { localBaseUrl, localOnly, localFirst, progress }) {
  const fromLocal = async () => getLocalModelFile(
    await localBase(localBaseUrl, repo, canary), repo, file, { asBytes: true, progress });
  if (localOnly) {
    return fromLocal();
  }
  // The background reachability preflight (lib/hubReachability.js) says this
  // machine cannot reach HuggingFace. Reordering, not skipping: a mirror that
  // does not carry these files still ends up at HuggingFace, which is what
  // keeps a false negative from breaking diarization outright.
  if (localFirst && localBaseUrl) {
    try {
      return await fromLocal();
    } catch (err) {
      console.warn(`[Diarize] HuggingFace looked unreachable so ${file} was tried at `
        + `${localBaseUrl} first, and missed; falling back to HuggingFace.`, err);
      return getModelFile(repo, file, { asBytes: true, progress });
    }
  }
  try {
    return await getModelFile(repo, file, { asBytes: true, progress });
  } catch (err) {
    if (err instanceof HubDownloadError && localBaseUrl) {
      console.warn(`[Diarize] HF fetch of ${file} failed; falling back to ${localBaseUrl}`);
      return fromLocal();
    }
    throw err;
  }
}

/**
 * Download (or read from cache) the Sortformer files for one precision plus
 * the CAM++ embedding model. Memoised per precision: the first call wins, the
 * rest await it; a failure clears the memo so a retry can succeed.
 *
 * @param {object} [opts]
 * @param {'int8'|'fp16'|'fp32'} [opts.precision='int8'] step graph to fetch
 * @param {string|null} [opts.localBaseUrl] local mirror base (e.g. '/models')
 *   to fall back to when HF is unreachable; null to disable the fallback.
 * @param {boolean} [opts.localOnly=false] skip HF entirely, serve from localBaseUrl.
 * @param {boolean} [opts.localFirst=false] try localBaseUrl BEFORE HF (and fall
 *   back to HF if it misses), for when the reachability preflight has found HF
 *   unreachable from this machine.
 * @param {(p:{loaded:number,total:number})=>void} [opts.onProgress] aggregate
 *   byte progress across all files.
 * @returns {Promise<{precision:string, config:object, silenceEmbeds:Float32Array,
 *   embedBytes:Uint8Array, stepBytes:Uint8Array, embeddingBytes:Uint8Array}>}
 */
export function getDiarizationModels({ precision = 'int8', localBaseUrl = null, localOnly = false, localFirst = false, onProgress } = {}) {
  const stepFile = DIARIZATION_STEP_FILES[precision];
  if (!stepFile) throw new Error(`unknown diarization precision "${precision}"`);
  if (_models.has(precision)) return _models.get(precision);
  const files = [
    ['config', DIAR_REPO, CONFIG_FILE],
    ['silence', DIAR_REPO, SILENCE_FILE],
    ['embed', DIAR_REPO, EMBED_FILE],
    ['step', DIAR_REPO, stepFile],
    ['embedding', EMB_REPO, EMB_FILE],
  ];
  const promise = (async () => {
    const acc = Object.fromEntries(files.map(([slot]) => [slot, { loaded: 0, total: 0 }]));
    const report = () => onProgress && onProgress(Object.values(acc).reduce(
      (sum, p) => ({ loaded: sum.loaded + p.loaded, total: sum.total + p.total }), { loaded: 0, total: 0 }));
    const bytes = await Promise.all(files.map(([slot, repo, file]) => fetchBytes(repo, file,
      // canary: a file every layout of that repo serves
      repo === DIAR_REPO ? CONFIG_FILE : EMB_FILE,
      {
        localBaseUrl, localOnly, localFirst,
        progress: onProgress ? ({ loaded, total }) => { acc[slot] = { loaded: loaded || 0, total: total || 0 }; report(); } : undefined,
      })));
    const by = Object.fromEntries(files.map(([slot], i) => [slot, bytes[i]]));
    const { config, silenceEmbeds } = parseDiarizationData(by.config, by.silence);
    return { precision, config, silenceEmbeds, embedBytes: by.embed, stepBytes: by.step, embeddingBytes: by.embedding };
  })().catch((err) => {
    _models.delete(precision); // let a failed download be retried
    throw err;
  });
  _models.set(precision, promise);
  return promise;
}

/**
 * Base IndexedDB cache keys for every diarization file (all step precisions),
 * so the Parakeet model sweep can be told to keep them (getParakeetModel
 * protectCacheKeys).
 * @returns {string[]}
 */
export function diarizationModelProtectKeys() {
  return [
    ...[CONFIG_FILE, SILENCE_FILE, EMBED_FILE, ...Object.values(DIARIZATION_STEP_FILES)]
      .map((file) => modelFileCacheKeys(DIAR_REPO, file).blob),
    modelFileCacheKeys(EMB_REPO, EMB_FILE).blob,
  ];
}
