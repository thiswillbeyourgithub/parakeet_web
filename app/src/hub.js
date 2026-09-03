/**
 * Simplified HuggingFace Hub utilities for parakeet.js
 * Downloads models from HF and caches them in browser storage.
 * Supports an optional local fallback: if HuggingFace is unreachable
 * (firewalled, blocked, etc.), callers can provide a local base URL
 * from which the same model files are served.
 */

import { MODELS, getModelConfig } from './models.js';
import { openIdb, idbGet, idbPut, idbDelete, idbClear, idbGetAllKeys } from './idb.js';
import { candidatePaths, findRepoFile } from './modelLayout.js';
/** @typedef {import('./models.js').ModelConfig} ModelConfig */

/**
 * Custom error for HuggingFace download failures, so the UI can
 * distinguish "HF is blocked" from other errors and offer a fallback.
 */
export class HubDownloadError extends Error {
  constructor(filename, cause) {
    super(`Failed to download ${filename} from HuggingFace`);
    this.name = 'HubDownloadError';
    this.filename = filename;
    this.cause = cause;
  }
}

/**
 * Raised when the requested quantisation cannot be served by ANY source tried
 * (the primary HF repo and, when probed, the local /models mirror), so honouring
 * it would mean silently swapping in a different quant (e.g. fp32-on-WASM with no
 * shards anywhere -> int8). We refuse that silent downgrade and surface this
 * instead, so it is always obvious which quant actually loaded. NOT a
 * HubDownloadError: the bytes were reachable, the request was just unsatisfiable,
 * so the UI must not retry the local-fallback download (which hits the same wall).
 */
export class QuantUnavailableError extends Error {
  constructor({ backend, requested, message }) {
    super(message);
    this.name = 'QuantUnavailableError';
    this.backend = backend;
    this.requested = requested;
  }
}

const DB_NAME = 'parakeet-cache-db';
const STORE_NAME = 'file-store';

// Resumable-download tuning. Partial state is flushed to IndexedDB every
// FLUSH_INTERVAL bytes so a tab close or network drop only loses up to that
// much progress. MAX_RETRIES with exponential backoff handles transient
// drops; persistent failures (CORS, 404, hard offline) still surface.
// Callers can override MAX_RETRIES per-call (HF download caps at 1 retry
// so we fall back to the local mirror quickly).
const FLUSH_INTERVAL = 8 * 1024 * 1024;
const MAX_RETRIES = 6;
const PARTIAL_PREFIX = 'partial-';
const SEGMENT_INFIX = '-seg-';
// Sibling record storing validation metadata ({ etag, size, savedAt }) for a
// completed download, keyed META_PREFIX + cacheKey. Lets a later load confirm
// the cached blob is intact (size) and unchanged upstream (etag) before reusing
// it, instead of blindly trusting whatever bytes are in the cache.
const META_PREFIX = 'meta-';
// How long to wait on the freshness HEAD before falling back to the cache. Kept
// short so a slow/blocked HuggingFace never stalls startup for a user who
// already has the model cached.
const REVALIDATE_TIMEOUT_MS = 4000;
// If no chunk arrives for this long, abort the fetch and retry. Without it
// a silently half-open connection (proxy idle-out, dropped TCP) hangs the
// reader forever instead of triggering the existing retry/backoff logic.
const INACTIVITY_TIMEOUT_MS = 30000;

// Cache for repo file listings so we only hit the HF API once per page load
const repoFileCache = new Map();

function makeCacheKey(repoId, revision, subfolder, filename) {
  return `hf-${repoId}-${revision}-${subfolder}-${filename}`;
}

/**
 * Decide whether a cached model file can be reused as-is or must be
 * re-downloaded. Deliberately conservative: it only returns 'redownload' on
 * positive evidence the cached bytes are wrong, so a flaky network, a blocked
 * HuggingFace, or a download predating the metadata feature never triggers a
 * needless multi-GB re-download. Everything else reuses the cache.
 *
 * Re-download is returned when:
 *   - integrity: a recorded size exists and the cached blob's byte length does
 *     not match it (truncated / partially-written / corrupt cache), or
 *   - freshness: a successful HEAD returned an ETag that differs from the one
 *     recorded at download time (upstream file genuinely changed).
 *
 * @param {Object} args
 * @param {number} args.cachedSize Byte length of the cached blob.
 * @param {?{etag?: string, size?: number}} args.meta Recorded metadata, or null.
 * @param {?{ok: boolean, etag: ?string}} args.head HEAD revalidation result, or
 *   null when revalidation was skipped (offline) or failed.
 * @returns {'use'|'redownload'}
 */
export function decideCacheAction({ cachedSize, meta, head }) {
  // Integrity: we know how big the file should be and the cache disagrees.
  if (meta && typeof meta.size === 'number' && meta.size > 0 && cachedSize !== meta.size) {
    return 'redownload';
  }
  // Freshness: only act on a clear, two-sided ETag mismatch. A missing ETag on
  // either side (no recorded etag, HEAD failed/omitted it) means "can't tell" —
  // and we err toward keeping the cache.
  if (head && head.ok && head.etag && meta && meta.etag && head.etag !== meta.etag) {
    return 'redownload';
  }
  return 'use';
}

/**
 * Best-effort HEAD request to read the current ETag for a URL, used to detect
 * whether an upstream file changed since it was cached. Never throws: any
 * network error, non-OK status, or timeout resolves to null so the caller
 * falls back to using the cache. Skipped entirely when the browser reports it
 * is offline.
 *
 * @param {string} url
 * @returns {Promise<{ok: boolean, etag: ?string}|null>}
 */
async function headRevalidate(url) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('revalidate timeout')), REVALIDATE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: ac.signal });
    if (!resp.ok) return { ok: false, etag: null };
    return { ok: true, etag: resp.headers.get('etag') || resp.headers.get('last-modified') || null };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// One path SEGMENT accepted from HF's API. Restrict to a safe alphabet so
// a poisoned or attacker-controlled response cannot smuggle path
// traversal ('..'), query/fragment delimiters ('?', '#'), URL-encoding
// edge cases, or DOM-template gadgets if the value is ever interpolated
// somewhere stricter than a fetch URL.
const SAFE_RFILENAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Whether a repo file PATH from the HF tree API is safe to fetch/cache. A path
 * may legitimately contain a subfolder (the model repos keep each precision in
 * its own directory, listed by the recursive tree API as
 * `int8/encoder-model.int8.onnx`, `fp32/encoder-model.onnx.data.000` and so on;
 * older mirrors used `sharded/`), so allow forward-slash-separated
 * segments, but require EVERY segment to be a plain SAFE_RFILENAME_RE token and
 * reject any empty ('//', leading/trailing '/') or traversal ('.'/'..') segment.
 * Pure; used by listRepoFiles's filterSafe.
 * @param {string} name Repo-relative path.
 * @returns {boolean}
 */
export function isSafeRepoPath(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  return name.split('/').every((seg) => SAFE_RFILENAME_RE.test(seg) && seg !== '.' && seg !== '..');
}

async function listRepoFiles(repoId, revision = 'main') {
  const cacheKey = `${repoId}@${revision}`;
  if (repoFileCache.has(cacheKey)) return repoFileCache.get(cacheKey);

  const encodedRevision = encodeURIComponent(revision);
  // /tree/<rev> returns siblings scoped to that branch/SHA. The plain
  // /api/models?revision= endpoint always lists the default branch's
  // file set even when a revision is passed, which breaks quant-file
  // detection on repos that ship int8 vs fp32 on different branches.
  // `recursive=1` is load-bearing: without it the tree stops at the top level
  // and every precision folder (fp32/, int8/, ...) would come back as a `directory`
  // entry we drop, leaving the listing empty of weights. Both shapes below carry
  // FULL repo-relative paths (`entry.path`, `rfilename`), which is what
  // modelLayout.findRepoFile resolves against.
  const treeUrl = `https://huggingface.co/api/models/${repoId}/tree/${encodedRevision}?recursive=1`;
  const modelUrl = `https://huggingface.co/api/models/${repoId}?revision=${encodedRevision}`;

  const filterSafe = (names, source) => {
    const files = names.filter(isSafeRepoPath);
    if (files.length !== names.length) {
      console.warn(`[Hub] listRepoFiles ${repoId}@${revision} (${source}): dropped ${names.length - files.length} entry(ies) with unsafe filenames`);
    }
    return files;
  };

  try {
    const resp = await fetch(treeUrl);
    if (resp.ok) {
      const json = await resp.json();
      let raw = [];
      if (Array.isArray(json)) {
        raw = json
          .filter(entry => entry?.type === 'file' && typeof entry?.path === 'string')
          .map(entry => entry.path);
      } else {
        raw = json.siblings?.map(s => s.rfilename) || [];
      }
      const files = filterSafe(raw, 'tree');
      repoFileCache.set(cacheKey, files);
      return files;
    }
    if (resp.status >= 400 && resp.status < 500) {
      console.warn(`[Hub] listRepoFiles ${repoId}@${revision} tree returned ${resp.status}; trying model metadata`);
    } else {
      // 5xx: transient on the tree endpoint, but still try the model
      // endpoint before giving up.
      console.warn(`[Hub] listRepoFiles ${repoId}@${revision} tree server error ${resp.status} – falling back to model metadata`);
    }
  } catch (err) {
    console.warn('[Hub] listRepoFiles tree network error, falling back to model metadata:', err.message || err);
  }

  try {
    const resp = await fetch(modelUrl);
    if (resp.ok) {
      const json = await resp.json();
      const raw = json.siblings?.map(s => s.rfilename) || [];
      const files = filterSafe(raw, 'model');
      repoFileCache.set(cacheKey, files);
      return files;
    }
    if (resp.status >= 400 && resp.status < 500) {
      console.warn(`[Hub] listRepoFiles ${repoId}@${revision} model returned ${resp.status}`);
      repoFileCache.set(cacheKey, []);
      return [];
    }
    console.warn(`[Hub] listRepoFiles ${repoId}@${revision} model server error ${resp.status} – retry possible`);
    return [];
  } catch (err) {
    console.warn('[Hub] listRepoFiles model network error – falling back to optimistic fetch:', err.message || err);
    return [];
  }
}

function getDb() {
  return openIdb(DB_NAME, STORE_NAME);
}

async function getFileFromDb(key) {
  return idbGet(await getDb(), STORE_NAME, key);
}

async function saveFileToDb(key, blob) {
  return idbPut(await getDb(), STORE_NAME, key, blob);
}

/**
 * Wipe every cached model file and any in-flight partial-download state
 * from IndexedDB. Used by the UI's "Reset All Settings and Data" action so
 * a reset truly starts from zero, redownloading weights on next load.
 */
export async function clearCache() {
  if (typeof indexedDB === 'undefined') return;
  await idbClear(await getDb(), STORE_NAME);
  repoFileCache.clear();
  console.log('[Hub] Cleared cached model files and partial downloads');
}

// ONNX Runtime messages we treat as "the cached model bytes are unusable"
// (truncated download, disk error, quota corruption) rather than a transient or
// environmental failure. When InferenceSession.create throws one of these the
// weights in IndexedDB are almost certainly damaged, so the caller evicts them
// (evictModelFiles) and re-downloads instead of failing outright. Matching is
// substring + case-insensitive because ORT phrases the same fault differently
// across versions/builds ("Failed to load model", "Deserialize tensor X
// failed", "Protobuf parsing failed", "Can't create a session because ...",
// "ORT_INVALID_PROTOBUF", "ModelProto does not have ...").
const DESERIALIZE_ERROR_PATTERNS = [
  'deserialize',
  'protobuf',
  'failed to load model',
  'load model from',
  "can't create a session",
  'cannot create a session',
  'invalid model',
  'invalid_protobuf',
  'corrupt',
  'modelproto',
  'no graph was found',
];

/**
 * True when an InferenceSession.create error looks like a corrupt/undecodable
 * model file (see DESERIALIZE_ERROR_PATTERNS) as opposed to a network, memory,
 * or backend-capability error. Pure and side-effect-free for easy unit testing.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isModelDeserializeError(err) {
  if (!err) return false;
  const msg = ((err.message || err.toString?.() || err) + '').toLowerCase();
  return DESERIALIZE_ERROR_PATTERNS.some((p) => msg.includes(p));
}

/**
 * The three IndexedDB record keys that together hold one cached model file: the
 * completed blob (makeCacheKey), its validation metadata (META_PREFIX), and its
 * resumable-download record (PARTIAL_PREFIX). Pure so it can be unit-tested
 * without IndexedDB; evictModelFiles deletes exactly these (plus any partial
 * byte-segments named by the partial record).
 * @returns {{ blob: string, meta: string, partial: string }}
 */
export function modelFileCacheKeys(repoId, filename, { revision = 'main', subfolder = '' } = {}) {
  const base = makeCacheKey(repoId, revision, subfolder, filename);
  return { blob: base, meta: META_PREFIX + base, partial: PARTIAL_PREFIX + base };
}

/**
 * Delete the cached blob (and its meta + partial-download records) for each
 * given model weight file so the next getParakeetModel re-downloads it. Used to
 * recover from a corrupt cached file that fails ONNX deserialization at
 * session-create time (see isModelDeserializeError). Best-effort per key: one
 * failed delete never strands the rest. Returns the filenames it processed.
 *
 * @param {Object} info Shape of getParakeetModel's results.cacheInfo.
 * @param {string} info.repoId
 * @param {string} [info.revision='main']
 * @param {string} [info.subfolder='']
 * @param {string[]} [info.filenames=[]] Weight filenames to evict.
 * @returns {Promise<string[]>}
 */
export async function evictModelFiles({ repoId, revision = 'main', subfolder = '', filenames = [] } = {}) {
  if (typeof indexedDB === 'undefined' || !repoId || filenames.length === 0) return [];
  const db = await getDb();
  const del = async (k) => { try { await idbDelete(db, STORE_NAME, k); } catch (_) {} };
  for (const filename of filenames) {
    const { blob, meta, partial } = modelFileCacheKeys(repoId, filename, { revision, subfolder });
    // A resumable partial may have spilled byte-segments to disk; their count
    // lives in the partial record. Delete those before the records that name them.
    try {
      const pmeta = await getFileFromDb(partial);
      const segCount = pmeta?.segCount || 0;
      for (let i = 0; i < segCount; i++) await del(`${partial}${SEGMENT_INFIX}${i}`);
    } catch (_) {}
    await del(blob);
    await del(meta);
    await del(partial);
  }
  console.warn(`[Hub] Evicted ${filenames.length} cached model file(s) for ${repoId} to recover from a corrupt cache`);
  return filenames;
}

/**
 * Reduce any cache record key back to the base blob cacheKey it belongs to.
 * One cached file occupies up to three record kinds, all derived from the same
 * makeCacheKey value:
 *   - the completed blob:      `hf-...`
 *   - its validation sibling:  `meta-hf-...`     (META_PREFIX)
 *   - resumable partial state: `partial-hf-...`  (PARTIAL_PREFIX), plus
 *     append-only byte segments `partial-hf-...-seg-N` (SEGMENT_INFIX + index)
 * Stripping the prefix/suffix groups all of them under one identity so the
 * orphan sweep can decide per-file, not per-record. Pure / no IDB.
 * @param {string} key A raw IndexedDB key from the model-cache store.
 * @returns {string} The base blob cacheKey (unchanged if the key is none of the above).
 */
export function baseCacheKey(key) {
  let base = key;
  if (base.startsWith(META_PREFIX)) {
    base = base.slice(META_PREFIX.length);
  } else if (base.startsWith(PARTIAL_PREFIX)) {
    base = base.slice(PARTIAL_PREFIX.length);
    // Drop a trailing `-seg-N` only when N is all digits, so a repoId/filename
    // that happens to contain the literal "-seg-" is never mis-truncated.
    const i = base.lastIndexOf(SEGMENT_INFIX);
    if (i !== -1 && /^\d+$/.test(base.slice(i + SEGMENT_INFIX.length))) {
      base = base.slice(0, i);
    }
  }
  return base;
}

/**
 * Given every key in the model-cache store and the set of base cacheKeys that
 * belong to the just-loaded model, return the keys to delete: model records
 * (base starts with the `hf-` cacheKey prefix) that are NOT part of the live
 * set. Non-model keys (anything whose base does not start with `hf-`) are left
 * untouched so the sweep can never clobber unrelated data. Pure / no IDB, so
 * the orphan-selection logic is unit-testable without a browser.
 * @param {Array<string|*>} allKeys Every key currently in the store.
 * @param {Set<string>} liveBaseKeys Base cacheKeys of the current model's files.
 * @param {Set<string>} [protectBaseKeys] Extra base cacheKeys to never delete,
 *   even though they are not part of the just-loaded model. Used to shield other
 *   subsystems' cached weights (e.g. the speaker-diarization models, which live
 *   in a different repo and so are not in the Parakeet live set) from the
 *   generational sweep. Pure / no IDB.
 * @returns {string[]} Keys safe to delete.
 */
export function selectOrphanKeys(allKeys, liveBaseKeys, protectBaseKeys = new Set()) {
  return allKeys.filter((k) => {
    if (typeof k !== 'string') return false;
    const base = baseCacheKey(k);
    return base.startsWith('hf-') && !liveBaseKeys.has(base) && !protectBaseKeys.has(base);
  });
}

/**
 * Generational cache sweep: keep only the live set. After a model loads, every
 * file it needs is cached under the current (repoId, revision, subfolder) keys;
 * any other `hf-...` record in the store belongs to a model the user has since
 * switched away from (different repo, revision, or quant) and is dead weight.
 * Nothing else prunes these: a re-download overwrites in place, evictModelFiles
 * only targets a known-corrupt file, and clearCache is the user's all-or-nothing
 * "Reset All". Without this sweep, trying several quants/repos silently stacks
 * gigabytes of orphaned weights in IndexedDB forever.
 *
 * Best-effort and fully guarded: a sweep failure must never fail the load, so
 * any IDB error resolves to "swept nothing". A failed individual delete is
 * swallowed so one stuck record never strands the rest.
 * @param {Object} live The just-loaded model's cache identity.
 * @param {string} live.repoId
 * @param {string} [live.revision='main']
 * @param {string} [live.subfolder='']
 * @param {string[]} [live.filenames=[]] Every filename cached for this model.
 * @param {string[]} [live.protectKeys=[]] Base cacheKeys belonging to other
 *   subsystems (e.g. the diarization models) that must survive the sweep.
 * @returns {Promise<string[]>} The orphan keys it deleted.
 */
export async function sweepOrphanedFiles({ repoId, revision = 'main', subfolder = '', filenames = [], protectKeys = [] } = {}) {
  if (typeof indexedDB === 'undefined' || !repoId || filenames.length === 0) return [];
  let db, allKeys;
  try {
    db = await getDb();
    allKeys = await idbGetAllKeys(db, STORE_NAME);
  } catch (e) {
    console.warn('[Hub] Orphaned-cache sweep could not read IndexedDB (non-fatal):', e);
    return [];
  }
  const liveBaseKeys = new Set(filenames.map((f) => makeCacheKey(repoId, revision, subfolder, f)));
  const orphans = selectOrphanKeys(allKeys, liveBaseKeys, new Set(protectKeys));
  for (const k of orphans) {
    try { await idbDelete(db, STORE_NAME, k); } catch (_) {}
  }
  if (orphans.length) {
    console.log(`[Hub] Swept ${orphans.length} orphaned cache record(s) not part of ${repoId}@${revision}`);
  }
  return orphans;
}

/**
 * Download a file from HuggingFace Hub with caching support.
 * @param {string} repoId Model repo ID (e.g., 'nvidia/parakeet-tdt-1.1b')
 * @param {string} filename File to download (e.g., 'encoder-model.onnx')
 * @param {Object} [options]
 * @param {string} [options.revision='main'] Git revision
 * @param {string} [options.subfolder=''] Subfolder within repo
 * @param {Function} [options.progress] Progress callback
 * @returns {Promise<string>} URL to cached file (blob URL)
 */
// ORT InferenceSession.create accepts a Uint8Array as well as a URL string.
// For the big WebGPU encoder/decoder we hand it bytes rather than a blob: URL,
// because fetching a >1 GB blob URL trips Chromium's ERR_BLOB_OUT_OF_MEMORY
// (the WASM int8 encoder at ~800 MB stays under the cap; fp32 does not).
// Caching is unaffected: the blob is still persisted to IndexedDB first.
async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

// Largest a `noCache` stream may be and still be written to IndexedDB after the
// fact (see the shard-cache note in downloadModelFiles). Blobs this size are
// already proven to survive a cache round-trip: the ~840 MB int8 encoder is
// cached and read back on the shipping path every day. What does NOT survive is
// the ~1.4 GB shard that commit 88a39df tried to cache and 7f19a4e reverted:
// Chromium disk-spills a blob that size and `blob.arrayBuffer()` throws
// NotReadableError on the way back. That failure was size-dependent, so the
// answer is a size gate rather than a blanket refusal, and 700 MB sits below
// the proven-good mark with room to spare.
export const MAX_CACHEABLE_STREAM_BYTES = 700e6;

/**
 * Download a URL into a Blob with resume + retry, reporting progress,
 * then persist it to IndexedDB and return a blob URL. Shared between the
 * HuggingFace and local-fallback paths.
 *
 * Uses HTTP Range requests so a dropped connection picks up where it left
 * off instead of restarting from byte 0. Partial state (received chunks,
 * total, ETag) is flushed to IndexedDB every FLUSH_INTERVAL bytes, so even
 * the first download survives the tab being closed mid-stream. If the
 * server doesn't support ranges (returns 200 to a Range request) the code
 * falls back to a single-shot stream from 0.
 *
 * @param {string} url - Source URL to download
 * @param {string} cacheKey - IndexedDB key for the final blob
 * @param {string} filename - Friendly name for logs and progress events
 * @param {Function|undefined} progress - Optional progress callback
 * @param {string} logTag - Log prefix, e.g. '[Hub]' or '[Hub:local]'
 * @param {number} [maxRetries=MAX_RETRIES] - Number of retries after the initial
 *   attempt before giving up. Total HTTP attempts = maxRetries + 1.
 * @param {boolean} [asBytes=false] - Return the raw bytes (Uint8Array) instead of
 *   a blob URL. Used for the big WebGPU encoder/decoder to dodge the blob OOM.
 * @returns {Promise<string|Uint8Array>} Blob URL, or bytes when asBytes is set
 */
async function _streamAndCache(url, cacheKey, filename, progress, logTag, {
  maxRetries = MAX_RETRIES,
  asBytes = false,
  noCache = false,
  // Under noCache, write the finished bytes to IndexedDB anyway when they came
  // to no more than this many bytes. Zero (the default) keeps the strict
  // never-touch-IDB behaviour. See MAX_CACHEABLE_STREAM_BYTES.
  cacheIfUnder = 0,
} = {}) {
  const partialKey = PARTIAL_PREFIX + cacheKey;
  const segKey = (i) => `${partialKey}${SEGMENT_INFIX}${i}`;

  // Stream-to-memory mode (noCache): used for the multi-hundred-MB fp32 encoder
  // shards. The normal path offloads streamed bytes to IndexedDB segment Blobs
  // (to bound heap) and reassembles a Blob at the end; but a multi-GB Blob is
  // disk-spilled by Chromium and reading it back via arrayBuffer() can throw
  // NotReadableError (observed on the sharded fp32 load). So here we touch IDB
  // not at all: the bytes accumulate in one preallocated Uint8Array (each shard
  // is < 2 GB by construction, see scripts/shard-fp32.py) and are returned directly.
  // Always returns bytes; noCache callers set asBytes too.
  let memBuf = null; // preallocated output when total is known under noCache

  // Resume metadata is tiny and safe to rewrite frequently. The actual
  // bytes live in append-only segment records (segKey(0..segCount-1)),
  // so each flush only writes the new bytes since the last flush. This
  // keeps total IDB write cost linear in the file size.
  let meta = null;
  if (!noCache && typeof indexedDB !== 'undefined') {
    try { meta = await getFileFromDb(partialKey); } catch (_) {}
  }
  // Backwards-compat: an old-format partial record had a `chunks` field.
  // Treat it as no partial (re-download) rather than try to migrate.
  if (meta && Array.isArray(meta.chunks)) meta = null;

  // Segment payloads already on disk from previous flushes, re-wrapped into
  // in-memory Blobs (spillable blob storage, not JS heap) until final assembly.
  const segments = [];
  let segCount = meta?.segCount || 0;
  let received = meta?.received || 0;
  let total = meta?.total || 0;
  let etag = meta?.etag || null;
  let contentType = meta?.contentType || 'application/octet-stream';

  if (segCount > 0 && typeof indexedDB !== 'undefined') {
    try {
      for (let i = 0; i < segCount; i++) {
        const seg = await getFileFromDb(segKey(i));
        // Segments are stored as plain ArrayBuffers (BY VALUE); wrap each into
        // a fresh Blob so the bytes move to spillable blob storage instead of
        // sitting in the JS heap. A legacy Blob segment (written before the
        // by-value change) is treated as unreadable: its backing can alias the
        // IDB record's file, which is the exact breakage the by-value store
        // exists to prevent, so restarting the download is the safe path.
        if (!(seg instanceof ArrayBuffer)) throw new Error(`segment ${i} missing or wrong type`);
        segments.push(new Blob([seg]));
      }
    } catch (e) {
      console.warn(`${logTag} Partial segments unreadable for ${filename}, restarting:`, e);
      await deleteAllPartial();
      segments.length = 0;
      segCount = 0;
      received = 0;
      total = 0;
      etag = null;
      contentType = 'application/octet-stream';
    }
  }

  // Tail chunks accumulated since the last flush, still in JS heap.
  let tailChunks = [];
  let tailBytes = 0;

  // Snapshot the resume offset so progress events can flag the file as
  // being resumed (UI shows "Resuming..." instead of a fresh download).
  const resumedFrom = received;
  if (resumedFrom > 0) {
    console.log(`${logTag} Resuming ${filename} from ${received}/${total || '?'} bytes`);
  }

  async function deleteAllPartial() {
    if (noCache || typeof indexedDB === 'undefined') return;
    try {
      const db = await getDb();
      await idbDelete(db, STORE_NAME, partialKey);
      for (let i = 0; i < segCount; i++) {
        try { await idbDelete(db, STORE_NAME, segKey(i)); } catch (_) {}
      }
    } catch (_) {}
  }

  async function writeMeta() {
    if (typeof indexedDB === 'undefined') return;
    try {
      await saveFileToDb(partialKey, { received, total, etag, contentType, segCount });
    } catch (e) {
      console.warn(`${logTag} Failed to persist partial meta for ${filename}:`, e);
    }
  }

  // Flush the in-memory tail to a new segment record, then drop it from heap.
  // No-op under noCache: there the bytes stay in `memBuf` and are never offloaded.
  //
  // The record value is a plain ArrayBuffer (BY VALUE), deliberately NOT a
  // Blob: Chromium can swap an IDB-written Blob's backing over to the
  // IDB-owned blob file, after which the final composite (and even the cached
  // record assembled from it) aliases those files, and deleteAllPartial()
  // dropping the segment records leaves every handle pointing at reclaimed
  // data: ORT's fetch of the model blob URL then dies with
  // net::ERR_BLOB_REFERENCED_BLOB_BROKEN (reproduced deterministically with
  // the ~880 MB int8 encoder in Chromium's full binary, e.g. Playwright
  // channel 'chromium'; the headless shell never swaps). Bytes stored by value
  // cannot alias anything, and the in-memory segment Blob below lives in
  // ordinary spillable blob storage, independent of IndexedDB.
  async function flushTail() {
    if (noCache || typeof indexedDB === 'undefined' || tailBytes === 0) return;
    const buf = new Uint8Array(tailBytes);
    let off = 0;
    for (const c of tailChunks) { buf.set(c, off); off += c.length; }
    const segBlob = new Blob([buf], { type: contentType });
    try {
      await saveFileToDb(segKey(segCount), buf.buffer);
      segments.push(segBlob);
      segCount += 1;
      tailChunks = [];
      tailBytes = 0;
      await writeMeta();
    } catch (e) {
      console.warn(`${logTag} Failed to persist segment ${segCount} for ${filename}:`, e);
    }
  }

  // Already complete from a prior run that crashed before the final write
  const alreadyComplete = total > 0 && received >= total;

  let attempt = 0;
  while (!alreadyComplete) {
    // Surface the attempt number so the UI can render "Retry N/total" before
    // any bytes flow. Distinct from a byte-progress event (loaded/total).
    if (progress) progress({ attempt: attempt + 1, maxAttempts: maxRetries + 1, file: filename });
    try {
      const headers = {};
      if (received > 0) {
        headers['Range'] = `bytes=${received}-`;
        if (etag) headers['If-Range'] = etag;
      }
      // Inactivity watchdog: rearmed on every successful chunk read below.
      const ac = new AbortController();
      let watchdog = setTimeout(() => ac.abort(new Error('inactivity timeout')), INACTIVITY_TIMEOUT_MS);
      const resetWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => ac.abort(new Error('inactivity timeout')), INACTIVITY_TIMEOUT_MS);
      };
      const clearWatchdog = () => clearTimeout(watchdog);
      let resp;
      try {
        resp = await fetch(url, { headers, signal: ac.signal });
      } catch (err) {
        clearWatchdog();
        throw err;
      }
      if (!resp.ok && resp.status !== 206) {
        clearWatchdog();
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
      }

      // We asked for a range but got a full body: server doesn't support
      // ranges, or If-Range invalidated the partial. Restart from 0,
      // dropping every segment we had on disk first.
      if (received > 0 && resp.status === 200) {
        console.warn(`${logTag} Server returned full body for ${filename}, restarting from 0`);
        await deleteAllPartial();
        segments.length = 0;
        segCount = 0;
        received = 0;
        tailChunks = [];
        tailBytes = 0;
      }

      // A content-encoded response describes the ENCODED entity in its headers
      // while `resp.body` hands us the DECODED bytes. Caddy's `precompressed`
      // serves an `encoder-model.int8.onnx.zst` sidecar exactly this way
      // (Content-Encoding: zstd, Content-Length = the compressed size), so
      // adopting that length as `total` would be wrong twice: the noCache path
      // preallocates `new Uint8Array(total)` and would overflow it mid-stream,
      // and progress would sail past 100%. Treat the length as UNKNOWN instead,
      // which every branch below already handles (chunk collection, no progress
      // events, `${total || '?'}` in the logs).
      const encoded = Boolean(resp.headers.get('content-encoding'));
      if (encoded) {
        total = 0;
      } else if (resp.status === 206) {
        const cr = resp.headers.get('content-range');
        const m = cr && cr.match(/\/(\d+)$/);
        if (m) total = parseInt(m[1], 10);
      } else {
        // 200 path: at this point received is guaranteed 0 (either fresh
        // download, or just reset above), so total = content-length.
        const cl = resp.headers.get('content-length');
        if (cl) total = parseInt(cl, 10);
      }
      // Resume survives compression: browsers send `Accept-Encoding: identity`
      // on any request carrying a Range header (verified in Chromium 148), so a
      // resumed attempt gets plain byte ranges of the real file and `received`,
      // counted in decoded bytes, is the right offset to ask for. The etag is
      // the one thing that does NOT carry over: a server serving a compressed
      // variant returns that VARIANT's etag, which can never match the identity
      // entity on the resume's If-Range, and a mismatch costs a full restart of
      // a multi-hundred-MB download. So keep whatever etag we already had (from
      // a previous identity response) rather than overwriting it with one that
      // is guaranteed to fail. The next resume's own 206 supplies a usable one.
      if (!encoded) {
        etag = resp.headers.get('etag') || resp.headers.get('last-modified') || etag;
      }
      contentType = resp.headers.get('content-type') || contentType;

      // noCache + known length: stream straight into one preallocated buffer so
      // we never hold the bytes twice (chunks + concat). A range-resume keeps
      // writing at `received`. If the length is unknown we fall back to
      // collecting chunks in tailChunks and concatenating at the end.
      if (noCache && total > 0 && !memBuf) {
        memBuf = new Uint8Array(total);
        // The length can become known only on a LATER attempt: a first attempt
        // that was content-encoded (or that omitted content-length) collected
        // its bytes in tailChunks, and the retry's 206 finally reveals the real
        // size. Fold those bytes in, or the buffer would start with `received`
        // zero bytes and the download would return a silently corrupt model.
        if (tailBytes > 0) {
          let off = 0;
          for (const c of tailChunks) { memBuf.set(c, off); off += c.length; }
          tailChunks = [];
          tailBytes = 0;
        }
      }

      const reader = resp.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetWatchdog();
          if (noCache && memBuf) {
            memBuf.set(value, received);
          } else {
            tailChunks.push(value);
            tailBytes += value.length;
          }
          received += value.length;
          if (progress && total > 0) progress({ loaded: received, total, file: filename, resumed: resumedFrom > 0, resumedFrom });
          if (tailBytes >= FLUSH_INTERVAL) {
            await flushTail();
          }
        }
      } finally {
        clearWatchdog();
      }
      break;
    } catch (err) {
      await flushTail();
      if (attempt >= maxRetries) throw err;
      const delay = Math.min(30000, 1000 * 2 ** attempt);
      console.warn(`${logTag} Download error for ${filename} at ${received}/${total || '?'}, retrying in ${delay}ms (${attempt + 1}/${maxRetries}):`, err.message || err);
      await new Promise(r => setTimeout(r, delay));
      attempt += 1;
    }
  }

  // noCache: return the bytes straight from memory, no Blob, no IDB. memBuf is
  // exactly `received` bytes when the length was known; otherwise concatenate
  // the collected chunks.
  if (noCache) {
    const bytes = memBuf
      ? (received === memBuf.length ? memBuf : memBuf.subarray(0, received))
      : (() => {
        const out = new Uint8Array(received);
        let off = 0;
        for (const c of tailChunks) { out.set(c, off); off += c.length; }
        return out;
      })();
    // Small enough to cache after the fact. The bytes are already in memory, so
    // this is one extra IDB write and no change to how they were streamed: the
    // segment-offloading path that assembles a multi-GB Blob is still never
    // taken. Entirely best-effort, since a failed write must only cost the next
    // load a re-download, never this load its model.
    if (cacheIfUnder > 0 && received > 0 && received <= cacheIfUnder && typeof indexedDB !== 'undefined') {
      try {
        const blobToCache = new Blob([bytes], { type: contentType });
        await saveFileToDb(cacheKey, blobToCache);
        try {
          await saveFileToDb(META_PREFIX + cacheKey, { etag, size: blobToCache.size, savedAt: Date.now() });
        } catch (e) {
          console.warn(`${logTag} Failed to write cache metadata for ${filename}:`, e);
        }
        console.log(`${logTag} Cached ${filename} in IndexedDB (${received} bytes, streamed)`);
      } catch (e) {
        console.warn(`${logTag} Failed to cache ${filename} in IndexedDB:`, e);
      }
    } else if (cacheIfUnder > 0 && received > cacheIfUnder) {
      console.log(`${logTag} Not caching ${filename}: ${received} bytes is over the ${cacheIfUnder}-byte cache limit`);
    }
    return bytes;
  }

  // Final assembly: segments on disk plus the trailing in-memory chunks.
  // Blob composition is by reference, so this is cheap.
  const composite = new Blob([...segments, ...tailChunks], { type: contentType });

  // The blob handed to the caller. Whenever the cache write succeeds it is
  // replaced by the blob READ BACK from the cache record instead of the
  // in-memory composite: the composite references many renderer blob-storage
  // parts, whose paged data Chromium's full binary has been observed to lose
  // under multi-GB blob traffic (NotReadableError on read,
  // net::ERR_BLOB_REFERENCED_BLOB_BROKEN on fetch; hit with the ~880 MB int8
  // encoder via scripts/transcribe-browser.mjs, 2026-08-12). The readback blob
  // is backed by the cache record's own IndexedDB storage, which lives as long
  // as the record, i.e. the exact blob every warm reload already serves.
  let blob = composite;
  if (typeof indexedDB !== 'undefined') {
    try {
      await saveFileToDb(cacheKey, composite);
      // Record validation metadata next to the blob so a later load can verify
      // integrity (size) and freshness (etag) before reusing it. Best-effort:
      // a failure here just means the next load skips validation and trusts the
      // cache, which matches the pre-metadata behaviour.
      try {
        await saveFileToDb(META_PREFIX + cacheKey, { etag, size: composite.size, savedAt: Date.now() });
      } catch (e) {
        console.warn(`${logTag} Failed to write cache metadata for ${filename}:`, e);
      }
      console.log(`${logTag} Cached ${filename} in IndexedDB`);
      const stored = await getFileFromDb(cacheKey);
      if (stored instanceof Blob && stored.size === composite.size) {
        blob = stored;
      } else {
        console.warn(`${logTag} Cache readback mismatch for ${filename} (got ${stored && stored.size}); serving the in-memory blob`);
      }
    } catch (e) {
      console.warn(`${logTag} Failed to cache in IndexedDB:`, e);
    }
    await deleteAllPartial();
  }

  return asBytes ? blobToBytes(blob) : URL.createObjectURL(blob);
}

export async function getModelFile(repoId, filename, options = {}) {
  const { revision = 'main', subfolder = '', progress, asBytes = false, noCache = false, cacheIfUnder = 0 } = options;

  // Encode the path components so slash-containing branch names (e.g.
  // 'refs/pr/1') and any URL-reserved characters in subfolder/filename
  // are escaped per-segment instead of being interpreted as path
  // separators by HuggingFace's router.
  const encodedRevision = encodeURIComponent(revision);
  const encodedSubfolder = subfolder
    ? subfolder.split('/').map((part) => encodeURIComponent(part)).join('/')
    : '';
  const encodedFilename = filename
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  // Construct HF URL
  const baseUrl = 'https://huggingface.co';
  const pathParts = [repoId, 'resolve', encodedRevision];
  if (encodedSubfolder) pathParts.push(encodedSubfolder);
  pathParts.push(encodedFilename);
  const url = `${baseUrl}/${pathParts.join('/')}`;

  // Check IndexedDB first
  const cacheKey = makeCacheKey(repoId, revision, subfolder, filename);

  // `cacheIfUnder` means "streamed, but cached anyway when small": such a file
  // can be in the cache, so it must be looked for there. Plain noCache still
  // skips the lookup entirely.
  if ((!noCache || cacheIfUnder > 0) && typeof indexedDB !== 'undefined') {
    try {
      const cachedBlob = await getFileFromDb(cacheKey);
      if (cachedBlob) {
        let meta = null;
        try { meta = await getFileFromDb(META_PREFIX + cacheKey); } catch (_) {}
        // Skip the freshness HEAD when there's no recorded etag to compare
        // against (nothing to learn) or no metadata at all (legacy cache):
        // size-only validation still runs, and we avoid a pointless round-trip.
        const head = meta?.etag ? await headRevalidate(url) : null;
        if (decideCacheAction({ cachedSize: cachedBlob.size, meta, head }) === 'use') {
          console.log(`[Hub] Using cached ${filename} from IndexedDB`);
          return asBytes ? blobToBytes(cachedBlob) : URL.createObjectURL(cachedBlob);
        }
        console.warn(`[Hub] Cached ${filename} failed validation (stale or corrupt); re-downloading`);
      }
    } catch (e) {
      console.warn('[Hub] IndexedDB cache check failed:', e);
    }
  }

  // Download from HF (resumable + retrying internally). Cap at 1 retry so a
  // genuinely-blocked HF (firewall, region block) falls back to the local
  // mirror within seconds rather than ~60 s of backoff. Local fallback keeps
  // the default retry count.
  console.log(`[Hub] Downloading ${filename} from ${repoId}...`);
  try {
    return await _streamAndCache(url, cacheKey, filename, progress, '[Hub]',
      { maxRetries: 1, asBytes, noCache, cacheIfUnder });
  } catch (fetchErr) {
    // Wrap in HubDownloadError so the UI can detect HF-specific failures
    // (network errors, CORS blocks, firewalls, HTTP errors after all retries).
    throw new HubDownloadError(filename, fetchErr);
  }
}

/**
 * Download text file from HF Hub.
 * @param {string} repoId Model repo ID
 * @param {string} filename Text file to download
 * @param {Object} [options] Same as getModelFile
 * @returns {Promise<string>} File content as text
 */
export async function getModelText(repoId, filename, options = {}) {
  const blobUrl = await getModelFile(repoId, filename, options);
  const response = await fetch(blobUrl);
  const text = await response.text();
  URL.revokeObjectURL(blobUrl); // Clean up blob URL
  return text;
}

/**
 * Download a file from a local server path (fallback when HuggingFace is unreachable).
 * Uses the same IndexedDB caching and progress streaming as getModelFile.
 * Files are expected at <baseUrl>/<path>, where <path> is the repo-relative path
 * the listing gave (e.g. 'int8/encoder-model.int8.onnx', or a bare basename on a
 * flat mirror). See app/src/modelLayout.js.
 * @param {string} baseUrl Local base URL (e.g., '/models')
 * @param {string} repoId Repo ID — only used for the IndexedDB cache key
 * @param {string} filename File to download
 * @param {Object} [options]
 * @param {Function} [options.progress] Progress callback
 * @returns {Promise<string>} Blob URL to the downloaded file
 */
export async function getLocalModelFile(baseUrl, repoId, filename, options = {}) {
  const { progress, revision = 'main', subfolder = '', asBytes = false, noCache = false, cacheIfUnder = 0 } = options;

  // Reuse IndexedDB cache (same key scheme so a prior HF download is also matched)
  const cacheKey = makeCacheKey(repoId, revision, subfolder, filename);
  // See getModelFile: a `cacheIfUnder` file may well be cached, so look for it.
  if ((!noCache || cacheIfUnder > 0) && typeof indexedDB !== 'undefined') {
    try {
      const cachedBlob = await getFileFromDb(cacheKey);
      if (cachedBlob) {
        console.log(`[Hub:local] Using cached ${filename} from IndexedDB`);
        return asBytes ? blobToBytes(cachedBlob) : URL.createObjectURL(cachedBlob);
      }
    } catch (e) {
      console.warn('[Hub:local] IndexedDB cache check failed:', e);
    }
  }

  const url = `${baseUrl}/${filename}`;
  console.log(`[Hub:local] Downloading ${filename} from ${url}...`);
  return _streamAndCache(url, cacheKey, filename, progress, '[Hub:local]',
      { asBytes, noCache, cacheIfUnder });
}

/**
 * Resolve the effective base URL for a locally-served model mirror, tolerating
 * either layout the operator may have bind-mounted:
 *   - flat:   the ONNX files + vocab.txt sit directly under baseUrl
 *             (`/models/vocab.txt`), the documented LOCAL_MODEL_PATH contract.
 *   - nested: a HuggingFace-style tree where the files live under the repo id
 *             (`/models/istupakov/parakeet-tdt-0.6b-v3-onnx/vocab.txt`), e.g.
 *             when the operator mounted a parent folder of one or more repos.
 * Probes vocab.txt (small, always present) flat first, then nested under repoId,
 * and returns whichever base resolves so every downstream fetch (listing,
 * weights, canary) targets the same place. Returns null when neither resolves.
 *
 * @param {string} baseUrl Local base URL serving the model files (e.g. '/models').
 * @param {string} [repoId] Repo id to try as a nested subfolder (e.g. 'istupakov/parakeet-tdt-0.6b-v3-onnx').
 * @returns {Promise<string|null>} The working base URL, or null if vocab.txt is reachable under neither.
 */
export async function resolveLocalModelBase(baseUrl, repoId) {
  const canary = 'vocab.txt';
  const reachable = async (base) => {
    try {
      const res = await fetch(`${base}/${canary}`, { method: 'HEAD' });
      return res.ok;
    } catch { return false; }
  };
  if (await reachable(baseUrl)) return baseUrl;
  if (repoId) {
    const nested = `${baseUrl}/${repoId}`;
    if (await reachable(nested)) return nested;
  }
  return null;
}

/**
 * Verify that local fallback model files are accessible on the server.
 * Performs a HEAD request against a small, required file (vocab.txt) to confirm
 * the model directory is properly set up. Call this at startup when local
 * fallback is enabled so the admin gets early feedback about missing files.
 * Tolerates both the flat and the nested-by-repoId layout (resolveLocalModelBase).
 *
 * @param {string} baseUrl Local base URL (e.g., '/models')
 * @param {string} [repoId] Repo id to also try as a nested subfolder.
 * @returns {Promise<{ok: boolean, message: string}>} Result with ok=true if the
 *   file is reachable, or ok=false with a descriptive message otherwise.
 */
export async function checkLocalModelFiles(baseUrl, repoId) {
  // vocab.txt is small and always required — a good canary file.
  const testFile = 'vocab.txt';
  const resolved = await resolveLocalModelBase(baseUrl, repoId);
  if (resolved) {
    return { ok: true, message: 'Local model files are accessible.' };
  }
  // Neither layout served the canary: re-probe the flat path purely to build a
  // precise status/error message (the nested path is best-effort, so we report
  // against the documented flat location the operator is expected to provide).
  const url = `${baseUrl}/${testFile}`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return {
      ok: false,
      message: `Local fallback is enabled but ${testFile} returned ${res.status} at ${url}.`,
    };
  } catch (e) {
    return {
      ok: false,
      message: `Local fallback is enabled but could not reach ${url}: ${e.message}`,
    };
  }
}

// Basenames HEAD-probed against a local mirror, in probe order. Two groups:
//
//   - the weight GRAPHS the download plan may actually fetch. A local mirror
//     has no listing API, so this IS its listing: without an entry the plan
//     cannot know that (say) the int8 encoder lives in `int8/` rather than at
//     the root, and every fetch against a nested mirror would 404.
//   - the external-data sidecars and the optional encoder builds, which
//     resolveModelQuant reads before any weight is fetched. It refuses an
//     int8lite or w4a8 request the source cannot serve, so a mirror that HAS one
//     must be able to say so; omitting them would make those precisions
//     permanently unavailable on a local-weights deployment and would stop the
//     /models auto-upgrade from ever rescuing an HF repo that ships neither.
//
// The fp32 shards are walked separately (contiguous, unbounded count). vocab.txt
// is not here: it is the canary resolveLocalModelBase already probed, and it
// only ever sits at the root, so the download plan's basename fallback is right
// for it by construction.
const LOCAL_PROBE_CANDIDATES = [
  'encoder-model.onnx',
  'encoder-model.onnx.data',
  'decoder_joint-model.onnx',
  'decoder_joint-model.onnx.data',
  'encoder-model.int8.onnx',
  'decoder_joint-model.int8.onnx',
  'encoder-model.int8.lite.onnx',
  'encoder-model.w4a8.onnx',
  // Probed so the /models upgrade path can serve fp16 to a shader-f16 machine
  // when the configured HF repo has no such file. Costs one HEAD per candidate
  // path on a mirror that does not ship it, which is the same price every other
  // opt-in precision here pays.
  'encoder-model.fp16.onnx',
];

/**
 * List the quant-relevant files a locally-served model directory actually has.
 * The HuggingFace API lists a repo's files for us; a local mirror (served under
 * `baseUrl`, e.g. '/models') can't be listed, so we HEAD-probe each candidate
 * basename through modelLayout.candidatePaths (its precision folder, then the
 * flat root, then `sharded/`) and keep the path that answered, plus the
 * contiguous fp32 encoder shards up to the first gap.
 *
 * Returns FULL repo-relative paths, exactly like the HF tree listing, so
 * resolveModelQuant and the download plan treat both sources identically and
 * neither has to re-discover which directory a file came from.
 *
 * @param {string} baseUrl Local base URL serving the model files (e.g. '/models').
 * @returns {Promise<string[]>} Repo-relative paths present under baseUrl (subset of the probed candidates).
 */
export async function listLocalRepoFiles(baseUrl) {
  const reachable = async (rel) => {
    try {
      const res = await fetch(`${baseUrl}/${rel}`, { method: 'HEAD' });
      return !!res.ok;
    } catch { return false; }
  };
  // First path that answers wins, so a mirror in the current layout costs ONE
  // round trip per basename and a flat one costs two. Only a basename the mirror
  // does not ship at all pays for the full candidate list.
  const probe = async (basename) => {
    for (const rel of candidatePaths(basename)) {
      if (await reachable(rel)) return rel;
    }
    return null;
  };
  const files = (await Promise.all(LOCAL_PROBE_CANDIDATES.map(probe))).filter(Boolean);
  // Walk the contiguous fp32 encoder shards until the first gap so
  // resolveModelQuant and the download loop can see them. The shards (plus the
  // rewritten graph that points at them) sit in `fp32/` in the current layout,
  // flat in an old mirror, or under `sharded/` in the layout the optimized repo
  // published before the move: shard-fp32.py's DEFAULT output was
  // `<model-dir>/sharded`, so an operator who ran it over an `hf download` mirror
  // and bind-mounted the parent serves them at `/models/sharded/...`. The FULL
  // path is reported either way, which is what lets the encoder graph be fetched
  // from the same directory as its shards.
  //
  // Shard 000 decides the directory and the rest of the walk stays in it: a
  // shard set split across two directories is not loadable anyway (the graph's
  // external_data names one location), and locking on costs one round trip per
  // shard instead of one per candidate path.
  const shardName = (i) => `encoder-model.onnx.data.${String(i).padStart(3, '0')}`;
  const first = await probe(shardName(0));
  if (first) {
    const shardDir = first.slice(0, first.length - shardName(0).length);
    files.push(first);
    for (let i = 1; ; i++) {
      const rel = shardDir + shardName(i);
      if (!(await reachable(rel))) break;
      files.push(rel);
    }
    // One encoder GRAPH basename, two possible files: the single-sidecar graph
    // (external_data -> one 2.4 GB .data, unloadable in a browser) and the
    // rewritten one beside the shards. The candidate walk above stops at the
    // first hit, so on a mirror carrying both it would report only the root copy
    // and the download plan's preferDir would have nothing to select. Probe the
    // shard directory explicitly so BOTH are listed and preferDir can do its job.
    const shardedGraph = `${shardDir}encoder-model.onnx`;
    if (!files.includes(shardedGraph) && await reachable(shardedGraph)) files.push(shardedGraph);
  }
  return files;
}

// Map a resolved quant to its ONNX filename suffix. fp16 was withdrawn on
// 2026-08-23 on the grounds that "no GPU available here exposes `shader-f16`".
// That was true of the RTX 3090 Ti this project develops against (Dawn does not
// expose the feature there) and false of the install base: a 2026-09-03
// benchmark report from an Intel UHD 630 laptop lists `shader-f16` among its
// adapter features, and Intel iGPUs have had native double-rate fp16 ALUs since
// Skylake, which is most of the laptops that reach this app. So the selection
// code is back, with the two conditions that were missing the first time made
// explicit: the adapter must expose the feature AND the source must ship the
// file. What is NOT back is fp16 as the silent WebGPU default, which is what
// made an untested precision dangerous; it is an opt-in choice, exactly like
// w4a8. The model repo's fp16 files were deleted with the withdrawal and have to
// be regenerated (scripts/quantize-fp16.py) before anything can select this.
export const QUANT_SUFFIX = {
  int8: '.int8.onnx',
  int8lite: '.int8.lite.onnx',
  w4a8: '.w4a8.onnx',
  fp16: '.fp16.onnx',
  fp32: '.onnx',
};

// The encoder quants that are int8 under the hood. Both are CPU/WASM-only (the
// WebGPU EP has no int8 encoder kernel), and both pair with the int8 decoder.
// `int8lite` is the model repo's lighter SmoothQuant build: `--exclude-worst
// 0.05`, so 11 MatMuls stay fp32 instead of 18. That is ~84 MB less to download
// and ~164 MiB less peak RSS, for slightly higher WER/CER. It is a straight file
// swap: the decoder, tokenizer and preprocessor are the same files. (The DEFAULT
// int8 is no longer a SmoothQuant build: since 2026-09-03 both repos ship it as
// a MatMulNBits 8-bit one, so `int8lite` is not a lighter cut of the same
// calibration any more, it is a different build entirely.)
const INT8_ENCODER_QUANTS = ['int8', 'int8lite'];
const isInt8Encoder = (q) => INT8_ENCODER_QUANTS.includes(q);

// There is exactly ONE encoder and ONE decoder build per quant, under the
// canonical istupakov names, and both are already optimized at the source: the
// model repo folds the encoder's runtime shape-computation glue away
// (optimize-encoder-graph.py fold: same weights, same numerics, ~23% fewer int8
// nodes / ~55% fewer fp32 nodes, so ORT builds the session ~2 s faster on WASM)
// and appends the beam decoder's in-graph outputs to the decoder
// (optimize-decoder-graph.py lse + topk: `lse_token`/`lse_duration`, the
// log-partition scalars parakeet.js _partition would otherwise recompute with
// ~8k Math.exp per hypothesis per step, plus `topk_logits`/`topk_ids`/
// `duration_logits` so a decode step fetches a few dozen floats instead of the
// full ~8.2k-float row, see parakeet.js TOPK_FETCHES / _readTopkStep).
//
// So nothing here probes for optimized filenames any more. The decoder fast
// paths are detected at RUNTIME from the loaded session's outputNames, never
// from the filename, so they engage on our repo and stay dormant on a stock
// upstream one (istupakov) with no name list to keep in sync.

/**
 * Parse the fp32 encoder shard set (`<name>.data.NNN`) out of a repo file
 * listing, whichever directory it sits in: `fp32/` in the current layout, the
 * flat root in an old mirror, `sharded/` in the layout the optimized repo
 * published before the move. Both sources hand it full repo-relative paths (the
 * HF tree API and listLocalRepoFiles alike), and a bare basename still parses as
 * the flat case.
 *
 * Returns the shard BASENAMES (the path each is mounted under, baked into the
 * encoder graph's external_data location) sorted ascending, plus the common
 * directory prefix they live under ('' when flat). Pure so both resolveModelQuant
 * (does a shard set exist?) and getParakeetModel (where do we fetch them?) share
 * one parser and can be unit-tested without any I/O.
 *
 * @param {string[]} repoFiles Filenames/paths available in the repo/mirror.
 * @param {string} [encoderName='encoder-model.onnx'] Encoder graph basename.
 * @returns {{ shards: string[], subdir: string }}
 */
export function parseEncoderShards(repoFiles, encoderName = 'encoder-model.onnx') {
  const shardRe = new RegExp(`^(.*/)?(${encoderName.replace(/[.]/g, '\\.')}\\.data\\.\\d+)$`);
  const entries = repoFiles
    .map((f) => { const m = typeof f === 'string' ? f.match(shardRe) : null; return m ? { dir: m[1] || '', base: m[2] } : null; })
    .filter(Boolean)
    .sort((a, b) => a.base.localeCompare(b.base));
  return { shards: entries.map((e) => e.base), subdir: entries.length ? entries[0].dir : '' };
}

// Whether the listing carries a loadable fp32 shard set
// (encoder-model.onnx.data.NNN). fp32 weights are only ever loaded through
// shards on the browser backends, so this is the one existence check
// resolveModelQuant and quantSatisfiable share.
function hasFp32ShardSet(repoFiles) {
  return parseEncoderShards(repoFiles).shards.length > 0;
}

// Whether the listing carries the encoder build for a quant. Only the model repo
// builds the lite int8 and w4a8 encoders, so a mirror that predates them (or
// upstream istupakov, which never had them) legitimately does not ship them.
// findRepoFile matches the basename in its precision folder, at the flat root or
// under `sharded/`, so all three layouts answer the same question the same way.
function hasEncoderFor(repoFiles, quant) {
  return findRepoFile(repoFiles, `encoder-model${QUANT_SUFFIX[quant]}`) !== null;
}

/**
 * Resolve the effective encoder/decoder quantisation for a backend, given what
 * the repo actually ships. Pure (no I/O) so it can be unit-tested.
 *
 *   - Non-WebGPU (WASM): pinned to int8 by default, because a single 2.4 GB fp32
 *     sidecar trips the ~2 GB ArrayBuffer / blob-fetch caps. There are two
 *     exceptions, both explicit opt-ins by name:
 *     'int8lite' resolves to the lite encoder when the repo ships it (a plain
 *     file swap, no sidecar and no shards), and 'fp32' resolves to fp32 when
 *     `allowWasmFp32` is set AND the repo ships the fp32 encoder as <2GB shards
 *     (encoder-model.onnx.data.NNN, from parakeet-tdt-0.6b-v3-optimized-onnx/scripts/shard-fp32.py):
 *     the shards clear both caps and the 2.4 GB fits the ~4 GB wasm32 heap. The
 *     decoder stays int8 either way (tiny, runs fine on WASM). Anything missing
 *     and the int8 pin stands, which is what makes a repo that cannot serve the
 *     request legible instead of a silent downgrade.
 *   - WebGPU: the GPU EP has no int8 encoder kernel, so the encoder is always
 *     fp32 (which needs the shards, see below), for 'int8lite' as much as for
 *     'int8'. The tiny decoder stays int8, which the GPU EP runs fine.
 *
 * @param {Object} args
 * @param {string} args.backend Backend mode ('wasm' | 'webgpu' | 'webgpu-*').
 * @param {('int8'|'int8lite'|'w4a8'|'fp16'|'fp32')} args.encoderQuant Requested encoder quant.
 * @param {('int8'|'fp32')} args.decoderQuant Requested decoder quant.
 * @param {string[]} args.repoFiles Filenames available in the repo.
 * @param {boolean} [args.shaderF16=false] Whether the WebGPU adapter exposes the
 *   `shader-f16` feature. Required for fp16: without it ORT builds the session
 *   and returns an empty transcript, so an fp16 request falls back to fp32 and
 *   is flagged rather than failing silently at transcription time.
 * @param {boolean} [args.allowWasmFp32=false] Opt-in: allow sharded fp32 on WASM
 *   when the repo ships encoder-model.onnx.data.NNN shards and fp32 is requested.
 * @returns {{encoderQ: string, decoderQ: string, pinnedToInt8: boolean, webgpuFp32NeedsShards: boolean, w4a8NeedsFile: boolean}}
 */
export function resolveModelQuant({ backend, encoderQuant, decoderQuant, repoFiles, shaderF16 = false, allowWasmFp32 = false }) {
  if (!backend.startsWith('webgpu')) {
    // The decoder is int8 on WASM, always: no fp32 decoder is shipped and the
    // int8 one is as accurate on this model. A request for anything else cannot
    // be honoured, so it has to flag NO MATTER WHICH ENCODER was picked. Both
    // opt-in encoder branches below return early, so without this the flag was
    // only raised on the pinned path: asking for an fp32 decoder alongside an
    // encoder choice that DID succeed came back pinnedToInt8:false, reporting a
    // downgrade as fully honoured.
    const decoderHonoured = decoderQuant === 'int8';
    // Opt-in lite int8 on WASM: a single smaller encoder file, no sidecar and no
    // shards, so the only condition is that the repo ships it. When it does not
    // we deliberately fall through to the int8 pin rather than quietly serving
    // the default int8: that routes through the same /models upgrade probe and
    // QuantUnavailableError as fp32, so the user learns their repo has no lite
    // build instead of silently running a heavier encoder than they picked.
    if (decoderHonoured && encoderQuant === 'int8lite' && hasEncoderFor(repoFiles, 'int8lite')) {
      return {
        encoderQ: 'int8lite',
        decoderQ: 'int8',
        pinnedToInt8: false,
      };
    }
    // Opt-in w4a8 on WASM, on the same terms as lite: one self-contained file
    // (int4 weights, int8 activations in-kernel), no sidecar and no shards, so
    // shipping it is the only condition. Same deliberate fall-through to the pin
    // when the repo lacks it.
    if (decoderHonoured && encoderQuant === 'w4a8' && hasEncoderFor(repoFiles, 'w4a8')) {
      return {
        encoderQ: 'w4a8',
        decoderQ: 'int8',
        pinnedToInt8: false,
      };
    }
    // Opt-in sharded fp32 on WASM: needs the explicit flag, an fp32 request, and
    // the repo to actually ship the <2GB shards. Anything missing keeps int8.
    // parseEncoderShards finds them in whichever directory the source keeps them
    // (fp32/, the flat root, or sharded/), so a request is not wrongly pinned
    // just because the shards are not at the root.
    const hasFp32Shards = hasFp32ShardSet(repoFiles);
    if (decoderHonoured && allowWasmFp32 && encoderQuant === 'fp32' && hasFp32Shards) {
      return {
        encoderQ: 'fp32',
        decoderQ: 'int8',
        pinnedToInt8: false,
      };
    }
    return {
      encoderQ: 'int8',
      decoderQ: 'int8',
      pinnedToInt8: encoderQuant !== 'int8' || decoderQuant !== 'int8',
    };
  }
  // fp32 is the GPU path's DEFAULT encoder precision. fp16 and w4a8 are opt-in
  // alternatives to it, each with its own condition. An int8 request on WebGPU becomes
  // fp32 (there is no GPU int8 encoder kernel either, for the lite build as much
  // as the default), and the decoder is always int8: it is as accurate as fp32 on
  // this model while being smaller and faster.
  //
  // w4a8 is NOT rewritten: MatMulNBits has a WebGPU kernel (it dequantizes the
  // int4 weights to fp16 in the shader, so the GPU gets no int8 arithmetic and
  // the win is download size and VRAM, not speed), and it loads as one flat file
  // with no shard requirement. Keeping it out of INT8_ENCODER_QUANTS is what
  // lets it through here.
  // A w4a8 request against a repo that does not ship the file falls back to fp32
  // here rather than 404ing deep in the download, but it is FLAGGED, unlike the
  // int8 rewrite above. The two are not the same case. int8 has no GPU encoder
  // kernel at any repo, so the UI greys that radio out and the rewrite surprises
  // nobody. w4a8 is offered on the GPU as a live choice, so silently serving
  // fp32 instead would hand a visitor who picked a 610 MB encoder a 2.35 GB one,
  // which is exactly the silent quant swap the rest of this module refuses to do.
  // The flag routes it through the /models upgrade probe and then
  // QuantUnavailableError, the same path the WASM pin takes.
  const w4a8Servable = encoderQuant === 'w4a8' && hasEncoderFor(repoFiles, 'w4a8');
  // fp16 needs BOTH conditions, and they fail for different reasons that the
  // caller has to be able to tell apart:
  //   - the adapter must expose `shader-f16`. Without it ORT still BUILDS the
  //     session and then returns an empty transcript, because its fp16 kernels
  //     emit WGSL `f16` types that fail to compile. That silent-empty failure is
  //     precisely what got fp16 withdrawn in the first place, so it is refused
  //     here rather than discovered at transcription time. It is a property of
  //     the machine, so no mirror can fix it.
  //   - the source must ship encoder-model.fp16.onnx. That is a property of the
  //     deployment, so the /models upgrade probe CAN fix it, exactly as for w4a8.
  // Either way the request is FLAGGED rather than quietly served as fp32:
  // handing a visitor who picked a 1.2 GB encoder a 2.35 GB one is the silent
  // quant swap the rest of this module refuses to do.
  const fp16NeedsF16Adapter = encoderQuant === 'fp16' && !shaderF16;
  const fp16NeedsFile = encoderQuant === 'fp16' && !hasEncoderFor(repoFiles, 'fp16');
  const fp16Servable = encoderQuant === 'fp16' && !fp16NeedsF16Adapter && !fp16NeedsFile;
  const encoderQ = isInt8Encoder(encoderQuant)
    || (encoderQuant === 'w4a8' && !w4a8Servable)
    || (encoderQuant === 'fp16' && !fp16Servable)
    ? 'fp32'
    : encoderQuant;
  const decoderQ = 'int8';
  // A single-file fp32 encoder cannot load on WebGPU: the ~2.3 GB weights exceed
  // BOTH Chromium's ~2 GB IndexedDB Blob-readback wall AND V8's ArrayBuffer cap,
  // so neither the cached nor the stream-to-one-buffer path works (verified on a
  // real GPU box). fp32 on WebGPU therefore REQUIRES the <2 GB shards, exactly
  // like WASM. Flag when it resolved to fp32 with no shards so the caller can try
  // a /models mirror that ships them, then surface QuantUnavailableError rather
  // than attempting a load that dies deep in ORT (Module.MountedFiles).
  const hasFp32Shards = hasFp32ShardSet(repoFiles);
  const webgpuFp32NeedsShards = encoderQ === 'fp32' && !hasFp32Shards;
  return {
    encoderQ,
    decoderQ,
    pinnedToInt8: false,
    webgpuFp32NeedsShards,
    w4a8NeedsFile: encoderQuant === 'w4a8' && !w4a8Servable,
    fp16NeedsFile,
    fp16NeedsF16Adapter,
  };
}

/**
 * Whether a given file set can fully satisfy the requested encoder quant for a
 * backend (i.e. resolveModelQuant returns NO downgrade: no int8 pin, no missing
 * fp32 shard set). Pure wrapper over resolveModelQuant, used to decide whether a
 * locally-served /models mirror can deliver a quant the primary (HF) repo could
 * not: fp32 needs the shards, on WASM and WebGPU alike.
 *
 * @param {Object} args Same shape as resolveModelQuant's args.
 * @returns {boolean} true when the request resolves with no downgrade.
 */
export function quantSatisfiable(args) {
  const r = resolveModelQuant(args);
  // fp16NeedsF16Adapter is deliberately included even though no mirror can fix
  // it: quantSatisfiable answers "can this source deliver what was asked", and
  // on a GPU without shader-f16 the honest answer is no, from any source. The
  // upgrade probe then finds the local mirror equally unable and the caller
  // throws, which is what keeps a 1.2 GB choice from silently becoming a
  // 2.35 GB download.
  return !r.pinnedToInt8 && !r.webgpuFp32NeedsShards && !r.w4a8NeedsFile
    && !r.fp16NeedsFile && !r.fp16NeedsF16Adapter;
}

/**
 * Decide whether a failed HuggingFace model load should be retried against the
 * locally-served /models weights instead of surfacing as a failure. Pure (no
 * I/O) so it can be unit-tested; the caller does the actual /models probe.
 *
 * Retry locally when the failure was an HF download error, this attempt did not
 * already use local weights (so we can't loop), AND either the operator
 * configured local fallback (VITE_MODEL_SOURCE=local|both) or a probe found the
 * files actually present at /models. The probe gate means the default 'hf'
 * source recovers from "model not on HF" when local weights exist, without
 * swapping a clear HF error for a confusing "local folder missing" one.
 *
 * @param {Object} a
 * @param {boolean} a.isHubError    The error was a HubDownloadError.
 * @param {boolean} a.alreadyLocal  This attempt already used local weights.
 * @param {boolean} a.localConfigured  Operator enabled local fallback.
 * @param {boolean} a.localReachable   /models actually has the files (probe result).
 * @returns {boolean}
 */
export function shouldRetryLocally({ isHubError, alreadyLocal, localConfigured, localReachable }) {
  if (!isHubError || alreadyLocal) return false;
  return Boolean(localConfigured || localReachable);
}

/**
 * Convenience function to get all Parakeet model files for a given architecture.
 * Accepts either a HuggingFace repo ID or a known model key from the registry.
 * @param {string} repoIdOrModelKey HF repo (e.g., 'nvidia/parakeet-tdt-1.1b') or model key (e.g., 'parakeet-tdt-0.6b-v3')
 * @param {Object} [options]
 * @param {('int8'|'int8lite'|'fp32')} [options.encoderQuant='int8'] Requested encoder quant (resolved per backend/availability by resolveModelQuant).
 * @param {('int8'|'fp32')} [options.decoderQuant='int8'] Requested decoder quant
 * @param {('nemo80'|'nemo128')} [options.preprocessor] Preprocessor variant (auto-detected from model config if not specified)
 * @param {('js'|'onnx')} [options.preprocessorBackend='js'] Preprocessor backend selection.
 *   'js' uses the pure-JS mel.js (no ONNX download needed, supports streaming).
 *   'onnx' downloads the preprocessor ONNX model from the repo.
 * @param {('webgpu'|'webgpu-hybrid'|'webgpu-strict'|'wasm')} [options.backend='webgpu'] Backend mode
 * @param {boolean} [options.shaderF16=false] Whether the WebGPU adapter exposes
 *   `shader-f16`. Required before an fp16 encoder request can resolve; without
 *   it the request is refused rather than silently served as fp32.
 * @param {boolean} [options.allowWasmFp32=false] Opt-in: on WASM, select the
 *   sharded fp32 encoder (instead of the int8 pin) when fp32 is requested and the
 *   repo ships encoder-model.onnx.data.NNN shards. Off by default (2.4 GB download).
 * @param {(progress: {loaded: number, total: number, file: string}) => void} [options.progress] Progress callback
 * @param {string} [options.localFallbackBaseUrl] When set, download files from this local
 *   base URL instead of HuggingFace (e.g., '/models'). Used as a fallback when HF is blocked.
 * @param {string} [options.localUpgradeBaseUrl] When set (and localFallbackBaseUrl is NOT),
 *   the HF path probes this local base URL (e.g. '/models') and switches the whole load to it
 *   BEFORE downloading when HF cannot serve the requested quant but the mirror can (the fp32
 *   shards). Lets a user get a precision HF doesn't host without first downloading the
 *   downgraded weights. Ignored once localFallbackBaseUrl is set.
 * @returns {Promise<{urls: {encoderUrl: string|Uint8Array, decoderUrl: string|Uint8Array, tokenizerUrl: string, preprocessorUrl?: string, encoderDataUrl?: string|Array<{path:string,data:string}>|null, decoderDataUrl?: string|null}, filenames: {encoder: string, decoder: string}, quantisation: {encoder: ('int8'|'int8lite'|'fp32'), decoder: ('int8'|'fp32')}, modelConfig: ModelConfig|null, preprocessorBackend: ('js'|'onnx')}>}
 */
export async function getParakeetModel(repoIdOrModelKey, options = {}) {
  // Resolve model key to repo ID and get config from the registry
  const modelConfig = getModelConfig(repoIdOrModelKey);
  const repoId = modelConfig?.repoId || repoIdOrModelKey;

  // Use model config defaults if available (e.g. nemo128 vs nemo80)
  const defaultPreprocessor = modelConfig?.preprocessor || 'nemo128';

  const { encoderQuant = 'int8', decoderQuant = 'int8', preprocessor = defaultPreprocessor, preprocessorBackend = 'js', backend = 'webgpu', progress, localFallbackBaseUrl, localUpgradeBaseUrl, shaderF16 = false, allowWasmFp32 = false, protectCacheKeys = [] } = options;
  // The base URL all files are actually fetched from. Starts as the explicit
  // local fallback (if any), but can flip to localUpgradeBaseUrl below when the
  // primary (HF) source cannot serve the requested quant and the local mirror
  // can. `let` because of that pre-download switch.
  // resolveLocalModelBase tolerates a nested HF-style mirror (files under
  // <base>/<repoId>/) as well as a mount of the repo root itself, so a mount of a
  // parent folder doesn't 404 every fetch. Falls back to the raw base when the
  // canary is reachable under neither (preserves the prior missing-file flow).
  let effectiveLocalBase = localFallbackBaseUrl
    ? (await resolveLocalModelBase(localFallbackBaseUrl, repoId)) || localFallbackBaseUrl
    : localFallbackBaseUrl;

  // Resolve the effective revision: operator override (options.revision)
  // wins, otherwise the per-model pin in models.js, otherwise the moving
  // 'main' branch.
  const effectiveRevision = options.revision || modelConfig?.revision || 'main';

  // List the repo's files first: quant resolution below needs to know whether the
  // fp32 shards exist, and the .data inclusion checks need the listing too.
  // Local fallback can't hit the HF API, so HEAD-probe the specific candidates
  // we care about (the fp32 external-data sidecar and shards).
  let repoFiles = effectiveLocalBase
    ? await listLocalRepoFiles(effectiveLocalBase)
    : await listRepoFiles(repoId, effectiveRevision);

  // Resolve the effective quantisation per backend and per availability.
  let { encoderQ, decoderQ, pinnedToInt8, webgpuFp32NeedsShards, w4a8NeedsFile,
        fp16NeedsFile, fp16NeedsF16Adapter } =
    resolveModelQuant({ backend, encoderQuant, decoderQuant, repoFiles, shaderF16, allowWasmFp32 });

  // Pre-download upgrade: the primary (HF) source could not serve the requested
  // quant (fp32 with no shards on either backend, w4a8 with no encoder file),
  // but a locally-served /models mirror may ship the missing
  // pieces. Probe it BEFORE downloading the wrong (downgraded) weights; if it
  // can satisfy the request, switch the whole load to local. Only on the HF
  // path (no explicit localFallbackBaseUrl) and only when a probe target was
  // provided by the caller (localUpgradeBaseUrl).
  if (localUpgradeBaseUrl && !localFallbackBaseUrl
      && (pinnedToInt8 || webgpuFp32NeedsShards || w4a8NeedsFile || fp16NeedsFile)) {
    // Resolve flat-vs-nested once so the listing and the later weight fetches
    // both target the layout the operator actually mounted.
    const resolvedUpgrade = (await resolveLocalModelBase(localUpgradeBaseUrl, repoId)) || localUpgradeBaseUrl;
    const localFiles = await listLocalRepoFiles(resolvedUpgrade).catch(() => []);
    if (quantSatisfiable({ backend, encoderQuant, decoderQuant, repoFiles: localFiles, shaderF16, allowWasmFp32 })) {
      console.log(`[Hub] HuggingFace cannot serve the requested quant (encoder=${encoderQuant}); `
        + `the local mirror at ${resolvedUpgrade} can, switching the load to it`);
      effectiveLocalBase = resolvedUpgrade;
      repoFiles = localFiles;
      ({ encoderQ, decoderQ, pinnedToInt8, webgpuFp32NeedsShards, w4a8NeedsFile,
         fp16NeedsFile, fp16NeedsF16Adapter } =
        resolveModelQuant({ backend, encoderQuant, decoderQuant, repoFiles, shaderF16, allowWasmFp32 }));
    }
  }

  if (pinnedToInt8) {
    // The user asked for a non-int8 quant on WASM and NO source we tried (the HF
    // repo, plus the local /models mirror when localUpgradeBaseUrl was probed
    // above) could serve it. We refuse to silently fall back to int8: a silent
    // quant swap makes it impossible to tell which precision actually loaded.
    // Neither missing quant is categorically impossible on WASM, so the message
    // names the specific file that was absent: fp32 only overflows as a single
    // 2.4 GB sidecar (the SHARDED encoder + allowWasmFp32 loads fine), and the
    // lite int8 encoder is just one more file the repo happens not to carry.
    // Throw so the caller surfaces it instead of proceeding.
    const missing = encoderQuant === 'int8lite'
      ? `the lite int8 encoder (encoder-model${QUANT_SUFFIX.int8lite}, built by `
        + `parakeet-tdt-0.6b-v3-optimized-onnx/scripts/quantize-int8-smoothquant.py --exclude-worst 0.05), `
        + `which neither HuggingFace nor the local /models mirror ships. Host it or pick int8.`
      : encoderQuant === 'w4a8'
      ? `the w4a8 encoder (encoder-model${QUANT_SUFFIX.w4a8}, built by scripts/quantize-nbits.py), `
        + `which neither HuggingFace nor the local /models mirror ships. Host it or pick int8.`
      : `the <2 GB fp32 shards (encoder-model.onnx.data.NNN from `
        + `parakeet-tdt-0.6b-v3-optimized-onnx/scripts/shard-fp32.py), `
        + `which neither HuggingFace nor the local /models mirror ships. Host the shards or pick int8.`;
    throw new QuantUnavailableError({
      backend,
      requested: { encoder: encoderQuant, decoder: decoderQuant },
      message: `Requested encoder=${encoderQuant}/decoder=${decoderQuant} cannot run on the `
          + `${backend} backend from any available source. It needs ${missing}`,
    });
  }
  if (w4a8NeedsFile) {
    // w4a8 was picked on WebGPU and NO source we tried ships the encoder. The
    // resolution above already fell back to fp32 so the rest of this function
    // has a loadable graph, but serving that silently would be a 2.35 GB
    // download in place of the 610 MB the user chose, and unlike int8 (greyed
    // out on this backend) w4a8 is offered here as a live choice. Refuse for the
    // same reason the WASM pin above refuses.
    throw new QuantUnavailableError({
      backend,
      requested: { encoder: encoderQuant, decoder: decoderQuant },
      message: `Requested encoder=w4a8 cannot run on the ${backend} backend from any `
        + `available source: neither HuggingFace nor the local /models mirror ships `
        + `encoder-model${QUANT_SUFFIX.w4a8} (built by scripts/quantize-nbits.py). `
        + `Host it, or pick fp32.`,
    });
  }
  if (fp16NeedsF16Adapter || fp16NeedsFile) {
    // fp16 was picked on WebGPU and either this GPU cannot run it or no source
    // ships it. Resolution above already fell back to fp32 so the rest of this
    // function has a loadable graph, but serving that silently would hand a
    // visitor who chose a 1.2 GB encoder a 2.35 GB one, and in the adapter case
    // it would also hide the exact failure that got fp16 withdrawn in 2026-08:
    // ORT builds the session happily and then returns an empty transcript,
    // because its fp16 kernels emit WGSL `f16` types that will not compile
    // without the feature. Refuse for the same reason the w4a8 branch refuses.
    throw new QuantUnavailableError({
      backend,
      requested: { encoder: encoderQuant, decoder: decoderQuant },
      message: fp16NeedsF16Adapter
        ? `The fp16 encoder needs a WebGPU adapter exposing the \`shader-f16\` feature, `
          + `which this one does not: ONNX Runtime would build the session and then return an `
          + `empty transcript. Pick fp32 or w4a8.`
        : `Requested encoder=fp16 cannot run on the ${backend} backend from any available `
          + `source: neither HuggingFace nor the local /models mirror ships `
          + `encoder-model${QUANT_SUFFIX.fp16} (built by scripts/quantize-fp16.py). `
          + `Host it, or pick fp32.`,
    });
  }
  if (webgpuFp32NeedsShards) {
    // fp32 resolved on WebGPU (it is the GPU EP's default encoder precision)
    // but NO source we tried ships the shards. The single-file fp32 encoder cannot
    // load on WebGPU (its ~2.3 GB weights exceed both Chromium's IDB Blob-readback
    // wall and V8's ArrayBuffer cap; verified on a real GPU box), so rather than
    // attempt a load that dies deep in ORT with a cryptic Module.MountedFiles
    // error, refuse cleanly exactly like the WASM pin above.
    throw new QuantUnavailableError({
      backend,
      requested: { encoder: encoderQuant, decoder: decoderQuant },
      message: `The fp32 encoder cannot run on the ${backend} backend as a single file `
        + `(its ~2.3 GB weights exceed the browser's ~2 GB ArrayBuffer / Blob limits), and no `
        + `source ships the <2 GB shards (encoder-model.onnx.data.NNN from `
        + `parakeet-tdt-0.6b-v3-optimized-onnx/scripts/shard-fp32.py). Host the shards, `
        + `or use the wasm backend.`,
    });
  }
  // One build per quant, under the canonical names. Whether this source's
  // decoder carries the in-graph LSE / top-K outputs is discovered from the
  // loaded session's outputNames, not from the filename.
  const encoderName = `encoder-model${QUANT_SUFFIX[encoderQ]}`;
  const decoderName = `decoder_joint-model${QUANT_SUFFIX[decoderQ]}`;

  // External encoder weights come in one of two shapes. A sharded fp32 encoder
  // splits them into <name>.data.000/.001/... files, each < 2 GB so it clears the
  // WASM ArrayBuffer / Chromium blob-fetch caps; a plain export keeps a single
  // <name>.data sidecar. Detect the shards here (before the download list is
  // built) so the encoder graph fetch can be routed to wherever the shards
  // actually live. parseEncoderShards returns bare basenames (the path each is
  // mounted under, baked into the graph's external_data) plus the directory they
  // sit in: 'fp32/' in the current layout, '' in an old flat mirror, 'sharded/'
  // in the layout the optimized repo published before the move. Both the HF tree
  // listing and listLocalRepoFiles carry full paths, so this one parse settles
  // the directory for every source, which is what lets sharded fp32 load straight
  // from HuggingFace on WASM and not only from a local /models mirror.
  const { shards: encoderShards, subdir: encoderSubdir } = parseEncoderShards(repoFiles, encoderName);

  // Use the sharded layout wherever it is available. WASM cannot load the single
  // >2 GB fp32 sidecar (32-bit ArrayBuffer cap), and WebGPU cannot either: the
  // 2.3 GB flat sidecar is loaded as bytes but still cached to IndexedDB, and its
  // readback throws "TypeError: Failed to fetch" because Chromium disk-spills the
  // multi-GB Blob (the same ~2 GB wall that forced sharding on WASM; verified on a
  // real GPU box, RTX 3090 Ti / Chromium 148, headed and headless alike). So
  // whenever the repo ships shards, mount them on EITHER backend: the shard loop
  // streams each <2 GB shard straight to memory (asBytes + noCache), never
  // touching IDB. Only fp32 ever ships a `.data` sidecar alongside shards, so the
  // int8 path never sees this.
  const hasFlatSidecar = findRepoFile(repoFiles, `${encoderName}.data`) !== null;
  const useShards = encoderShards.length > 0;
  // Where each file is actually FETCHED from. The listing is the authority: it
  // carries the directory for every source now, so nothing here HEAD-probes for a
  // subfolder any more. preferDir pins the fp32 encoder graph to the directory
  // holding its shards, because a listing can hold two graphs under one basename
  // (a root single-sidecar one whose external_data names a 2.4 GB file, and the
  // rewritten one beside the shards) and only the latter is loadable. A basename
  // the listing does not carry falls back to itself: that is a bare flat mirror
  // whose listing was never built, exactly the case the fallback exists for.
  const fetchName = (basename, preferDir) => findRepoFile(repoFiles, basename, { preferDir }) || basename;
  const encoderFetchName = fetchName(encoderName, useShards ? encoderSubdir : undefined);
  const decoderFetchName = fetchName(decoderName);
  const vocabFetchName = fetchName('vocab.txt');

  // The big encoder/decoder weights are handed to ORT as bytes (not a blob URL)
  // on WebGPU, where they are fp32 (>1 GB) and a blob-URL fetch OOMs (see
  // blobToBytes). vocab + external-data sidecars stay as URLs.
  const loadAsBytes = backend.startsWith('webgpu');
  // `weight` marks the big ONNX files (and their external-data sidecars) whose
  // cached bytes get deserialized at session-create time; evictModelFiles
  // targets exactly these on a corrupt-cache recovery (results.cacheInfo below).
  const filesToGet = [
    { key: 'encoderUrl', name: encoderFetchName, asBytes: loadAsBytes, weight: true },
    { key: 'decoderUrl', name: decoderFetchName, asBytes: loadAsBytes, weight: true },
    { key: 'tokenizerUrl', name: vocabFetchName },
  ];

  // Only download preprocessor ONNX when not using JS backend.
  // The JS backend (mel.js) computes mel spectrograms locally without
  // needing a separate ONNX model, saving download bandwidth.
  if (preprocessorBackend !== 'js') {
    filesToGet.push({ key: 'preprocessorUrl', name: fetchName(`${preprocessor}.onnx`) });
    console.log(`[Hub] Preprocessor: ONNX — will download ${preprocessor}.onnx`);
  } else {
    console.log(`[Hub] Preprocessor: JS (mel.js) — skipping ${preprocessor}.onnx download`);
  }

  // Mount the single <name>.data sidecar whenever we are NOT using the shards.
  // In practice this is dead for the encoder: the only encoder with a .data
  // sidecar is fp32, and single-file fp32 cannot load on EITHER backend (WASM
  // pins to int8; WebGPU throws QuantUnavailableError because it needs the shards,
  // see resolveModelQuant/webgpuFp32NeedsShards). It survives only as defence for
  // a hypothetical small external-data export. The shards, when used, are handled
  // after the main loop.
  if (!useShards && hasFlatSidecar) {
    filesToGet.push({ key: 'encoderDataUrl', name: fetchName(`${encoderName}.data`), weight: true });
  }

  if (findRepoFile(repoFiles, `${decoderName}.data`) !== null) {
    filesToGet.push({ key: 'decoderDataUrl', name: fetchName(`${decoderName}.data`), weight: true });
  }

  const results = {
      urls: {},
      filenames: {
          encoder: encoderName,
          decoder: decoderName
      },
      quantisation: { encoder: encoderQ, decoder: decoderQ },
      // Downgrade flag: true when this source could not satisfy the requested
      // quant (the WASM int8 pin). The caller uses it to decide whether a local
      // /models mirror should be tried instead.
      pinnedToInt8,
      modelConfig: modelConfig || null,  // Include model config for downstream use
      preprocessorBackend,  // Pass through so callers know which backend to use
      // Everything evictModelFiles needs to drop these exact cached blobs and
      // re-download them when a corrupt file fails to deserialize at session
      // create. Derived from the `weight` flag so it can't drift from the
      // download list, plus the fp32 shards: a shard small enough to be cached
      // (see the shard note below) is a weight that can go corrupt like any
      // other, and one that was too big to cache is simply a key eviction will
      // not find. The names are repo-relative PATHS ('int8/encoder-model.
      // int8.onnx' on the current layout), matching the cache keys downloadFile
      // wrote. `subfolder` is the separate HF-API subfolder knob, always '' for
      // the Parakeet repos.
      cacheInfo: {
          repoId,
          revision: effectiveRevision,
          subfolder: '',
          filenames: filesToGet.filter((f) => f.weight).map((f) => f.name)
            .concat(useShards ? encoderShards.map((n) => `${encoderSubdir}${n}`) : []),
      },
  };

  // One place that knows how to fetch a single file (HF or local fallback),
  // reused by both the main file loop and the shard loop below so the two can
  // never diverge in revision/progress handling.
  const downloadFile = (name, asBytes = false, noCache = false, cacheIfUnder = 0) => {
    const wrappedProgress = progress ? (p) => progress({ ...p, file: name }) : undefined;
    const perFileOpts = { ...options, revision: effectiveRevision, progress: wrappedProgress, asBytes, noCache, cacheIfUnder };
    return effectiveLocalBase
      ? getLocalModelFile(effectiveLocalBase, repoId, name, perFileOpts)
      : getModelFile(repoId, name, perFileOpts);
  };

  for (const { key, name, asBytes } of filesToGet) {
    try {
        results.urls[key] = await downloadFile(name, asBytes);
    } catch (e) {
        if (key.endsWith('DataUrl')) {
            console.warn(`[Hub] Optional external data file not found: ${name}. This is expected if the model is small.`);
            results.urls[key] = null;
        } else {
            throw e;
        }
    }
  }

  // Sharded fp32 encoder weights: fetch each <2GB shard and hand parakeet.js an
  // array of { path, data } entries, where path is the shard basename baked into
  // the graph's external_data location (see buildExternalData in parakeet.js).
  //
  // Shards are loaded as BYTES and with caching OFF (asBytes + noCache), and the
  // two together are what make sharded fp32 actually load on WASM:
  //   - bytes, not a blob: URL: a shard is a multi-hundred-MB to ~1.5 GB fp32
  //     chunk, and ORT mounts external data by fetching whatever it is handed.
  //     A blob: URL that size trips Chromium's ~2 GB blob-URL fetch wall and
  //     dies with "TypeError: Failed to fetch" during session build (the same
  //     wall that pushed the WebGPU encoder/decoder to bytes in 10e88bb).
  //   - noCache: the normal path offloads streamed bytes to IndexedDB segment
  //     Blobs and reassembles a Blob at the end; a multi-GB Blob is disk-spilled
  //     and reading it back can throw NotReadableError (observed here). Streaming
  //     straight to a Uint8Array skips IDB entirely. Each shard is < 2 GB by
  //     construction (scripts/shard-fp32.py), so the single Uint8Array clears
  //     the ArrayBuffer cap.
  //
  // What noCache does NOT justify any more is refusing to cache the RESULT. The
  // original note said the shards "are re-downloaded rarely, and the sharded
  // encoder is an explicit opt-in"; that stopped being true on 2026-08-21, when
  // WebGPU was re-enabled and the autoconfigure probe started putting ordinary
  // visitors on fp32-via-shards by default. A real report from an Intel iGPU
  // laptop measured a 74 s model load against the int8 path's warm seconds, and
  // that 74 s is paid on every single page load, for a backend the visitor did
  // not choose. So a shard small enough to survive a cache round-trip is now
  // written to IndexedDB after streaming (cacheIfUnder), while one over the
  // limit keeps exactly the old behaviour. The current 1.4 GB shards are over
  // it, so nothing changes until the model repo re-shards smaller:
  //   uv run .../scripts/shard-fp32.py --max-shard-bytes 500000000
  // The streaming itself is untouched either way: the multi-GB Blob assembly
  // that commit 88a39df died on is still never performed.
  if (useShards) {
    console.log(`[Hub] Encoder fp32 in ${encoderShards.length} shard(s); mounting as multi-file external data`);
    results.urls.encoderDataUrl = [];
    for (const name of encoderShards) {
      // Fetch from the directory the shards physically live in (fp32/, the flat
      // root, or sharded/), but mount under the bare basename the graph's
      // external_data location names.
      results.urls.encoderDataUrl.push({
        path: name,
        data: await downloadFile(`${encoderSubdir}${name}`, true, true, MAX_CACHEABLE_STREAM_BYTES),
      });
    }
  }

  // Every file for this model is now cached under the current (repoId,
  // effectiveRevision) keys, so prune any other model's records left behind by
  // a previous repo/revision/quant. cachedFilenames must list everything that
  // actually persisted to IDB, or the sweep would delete a file we just stored:
  // that is every entry in the main download loop, PLUS the fp32 shards: they
  // stream rather than going through the cache-first path, but a small one is
  // written to IDB afterwards (see the shard note above), and a shard the sweep
  // deleted the moment it was stored would make the caching pointless. Listing
  // a shard that was too big to cache is harmless: the sweep only deletes keys
  // outside the live set, so naming a key that does not exist protects nothing
  // and breaks nothing.
  // Keyed by repoId for both HF and local-mirror loads, matching downloadFile's
  // cacheKey scheme. sweepOrphanedFiles never throws.
  const cachedFilenames = filesToGet.map((f) => f.name)
    .concat(useShards ? encoderShards.map((n) => `${encoderSubdir}${n}`) : []);
  await sweepOrphanedFiles({ repoId, revision: effectiveRevision, subfolder: '', filenames: cachedFilenames, protectKeys: protectCacheKeys });

  return results;
}
