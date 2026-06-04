/**
 * Simplified HuggingFace Hub utilities for parakeet.js
 * Downloads models from HF and caches them in browser storage.
 * Supports an optional local fallback: if HuggingFace is unreachable
 * (firewalled, blocked, etc.), callers can provide a local base URL
 * from which the same model files are served.
 */

import { MODELS, getModelConfig } from './models.js';
import { openIdb, idbGet, idbPut, idbDelete, idbClear, idbGetAllKeys } from './idb.js';
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

// Filenames accepted from HF's API. Restrict to a flat, safe alphabet so
// a poisoned or attacker-controlled response cannot smuggle path
// traversal ('..'), query/fragment delimiters ('?', '#'), URL-encoding
// edge cases, or DOM-template gadgets if the value is ever interpolated
// somewhere stricter than a fetch URL.
const SAFE_RFILENAME_RE = /^[A-Za-z0-9._-]+$/;

async function listRepoFiles(repoId, revision = 'main') {
  const cacheKey = `${repoId}@${revision}`;
  if (repoFileCache.has(cacheKey)) return repoFileCache.get(cacheKey);

  const encodedRevision = encodeURIComponent(revision);
  // /tree/<rev> returns siblings scoped to that branch/SHA. The plain
  // /api/models?revision= endpoint always lists the default branch's
  // file set even when a revision is passed, which breaks quant-file
  // detection on repos that ship int8 vs fp32 on different branches.
  const treeUrl = `https://huggingface.co/api/models/${repoId}/tree/${encodedRevision}?recursive=1`;
  const modelUrl = `https://huggingface.co/api/models/${repoId}?revision=${encodedRevision}`;

  const filterSafe = (names, source) => {
    const files = names.filter(name => typeof name === 'string' && SAFE_RFILENAME_RE.test(name));
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
 * @returns {string[]} Keys safe to delete.
 */
export function selectOrphanKeys(allKeys, liveBaseKeys) {
  return allKeys.filter((k) => {
    if (typeof k !== 'string') return false;
    const base = baseCacheKey(k);
    return base.startsWith('hf-') && !liveBaseKeys.has(base);
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
 * @returns {Promise<string[]>} The orphan keys it deleted.
 */
export async function sweepOrphanedFiles({ repoId, revision = 'main', subfolder = '', filenames = [] } = {}) {
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
  const orphans = selectOrphanKeys(allKeys, liveBaseKeys);
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
// (the WASM int8 encoder at ~600 MB stays under the cap; fp16/fp32 do not).
// Caching is unaffected: the blob is still persisted to IndexedDB first.
async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

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
async function _streamAndCache(url, cacheKey, filename, progress, logTag, maxRetries = MAX_RETRIES, asBytes = false, noCache = false) {
  const partialKey = PARTIAL_PREFIX + cacheKey;
  const segKey = (i) => `${partialKey}${SEGMENT_INFIX}${i}`;

  // Stream-to-memory mode (noCache): used for the multi-hundred-MB fp32 encoder
  // shards. The normal path offloads streamed bytes to IndexedDB segment Blobs
  // (to bound heap) and reassembles a Blob at the end; but a multi-GB Blob is
  // disk-spilled by Chromium and reading it back via arrayBuffer() can throw
  // NotReadableError (observed on the sharded fp32 load). So here we touch IDB
  // not at all: the bytes accumulate in one preallocated Uint8Array (each shard
  // is < 2 GB by construction, see shard-fp32.py) and are returned directly.
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

  // Segment blobs already on disk from previous flushes. Kept as Blobs
  // (not loaded into JS heap) until final assembly.
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
        if (!(seg instanceof Blob)) throw new Error(`segment ${i} missing or wrong type`);
        segments.push(seg);
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
  async function flushTail() {
    if (noCache || typeof indexedDB === 'undefined' || tailBytes === 0) return;
    const segBlob = new Blob(tailChunks, { type: contentType });
    try {
      await saveFileToDb(segKey(segCount), segBlob);
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

      if (resp.status === 206) {
        const cr = resp.headers.get('content-range');
        const m = cr && cr.match(/\/(\d+)$/);
        if (m) total = parseInt(m[1], 10);
      } else {
        // 200 path: at this point received is guaranteed 0 (either fresh
        // download, or just reset above), so total = content-length.
        const cl = resp.headers.get('content-length');
        if (cl) total = parseInt(cl, 10);
      }
      etag = resp.headers.get('etag') || resp.headers.get('last-modified') || etag;
      contentType = resp.headers.get('content-type') || contentType;

      // noCache + known length: stream straight into one preallocated buffer so
      // we never hold the bytes twice (chunks + concat). A range-resume keeps
      // writing at `received`. If the length is unknown we fall back to
      // collecting chunks in tailChunks and concatenating at the end.
      if (noCache && total > 0 && !memBuf) memBuf = new Uint8Array(total);

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
    if (memBuf) return received === memBuf.length ? memBuf : memBuf.subarray(0, received);
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of tailChunks) { out.set(c, off); off += c.length; }
    return out;
  }

  // Final assembly: segments on disk plus the trailing in-memory chunks.
  // Blob composition is by reference, so this is cheap.
  const blob = new Blob([...segments, ...tailChunks], { type: contentType });

  if (typeof indexedDB !== 'undefined') {
    try {
      await saveFileToDb(cacheKey, blob);
      // Record validation metadata next to the blob so a later load can verify
      // integrity (size) and freshness (etag) before reusing it. Best-effort:
      // a failure here just means the next load skips validation and trusts the
      // cache, which matches the pre-metadata behaviour.
      try {
        await saveFileToDb(META_PREFIX + cacheKey, { etag, size: blob.size, savedAt: Date.now() });
      } catch (e) {
        console.warn(`${logTag} Failed to write cache metadata for ${filename}:`, e);
      }
      console.log(`${logTag} Cached ${filename} in IndexedDB`);
    } catch (e) {
      console.warn(`${logTag} Failed to cache in IndexedDB:`, e);
    }
    await deleteAllPartial();
  }

  return asBytes ? blobToBytes(blob) : URL.createObjectURL(blob);
}

export async function getModelFile(repoId, filename, options = {}) {
  const { revision = 'main', subfolder = '', progress, asBytes = false, noCache = false } = options;

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

  if (!noCache && typeof indexedDB !== 'undefined') {
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
    return await _streamAndCache(url, cacheKey, filename, progress, '[Hub]', 1, asBytes, noCache);
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
 * Files are expected at <baseUrl>/<filename> (flat layout).
 * @param {string} baseUrl Local base URL (e.g., '/models')
 * @param {string} repoId Repo ID — only used for the IndexedDB cache key
 * @param {string} filename File to download
 * @param {Object} [options]
 * @param {Function} [options.progress] Progress callback
 * @returns {Promise<string>} Blob URL to the downloaded file
 */
export async function getLocalModelFile(baseUrl, repoId, filename, options = {}) {
  const { progress, revision = 'main', subfolder = '', asBytes = false, noCache = false } = options;

  // Reuse IndexedDB cache (same key scheme so a prior HF download is also matched)
  const cacheKey = makeCacheKey(repoId, revision, subfolder, filename);
  if (!noCache && typeof indexedDB !== 'undefined') {
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
  return _streamAndCache(url, cacheKey, filename, progress, '[Hub:local]', MAX_RETRIES, asBytes, noCache);
}

/**
 * Verify that local fallback model files are accessible on the server.
 * Performs a HEAD request against a small, required file (vocab.txt) to confirm
 * the model directory is properly set up. Call this at startup when local
 * fallback is enabled so the admin gets early feedback about missing files.
 *
 * @param {string} baseUrl Local base URL (e.g., '/models')
 * @returns {Promise<{ok: boolean, message: string}>} Result with ok=true if the
 *   file is reachable, or ok=false with a descriptive message otherwise.
 */
export async function checkLocalModelFiles(baseUrl) {
  // vocab.txt is small and always required — a good canary file.
  const testFile = 'vocab.txt';
  const url = `${baseUrl}/${testFile}`;

  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) {
      return { ok: true, message: 'Local model files are accessible.' };
    }
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

/**
 * List the quant-relevant files a locally-served model directory actually has.
 * The HuggingFace API lists a repo's files for us; a local mirror (served flat
 * under `baseUrl`, e.g. '/models') can't be listed, so we HEAD-probe the
 * specific candidates resolveModelQuant cares about: the fp16 variants, the
 * single fp32 sidecar, and the contiguous fp32 encoder shards
 * (scripts/shard-fp32.py) up to the first gap. Returned in the same shape as
 * listRepoFiles so resolveModelQuant and the download loop treat both sources
 * identically.
 *
 * @param {string} baseUrl Local base URL serving the model files (e.g. '/models').
 * @returns {Promise<string[]>} Filenames present under baseUrl (subset of the probed candidates).
 */
export async function listLocalRepoFiles(baseUrl) {
  const probe = async (name) => {
    try {
      const res = await fetch(`${baseUrl}/${name}`, { method: 'HEAD' });
      return res.ok ? name : null;
    } catch { return null; }
  };
  const candidates = [
    'encoder-model.fp16.onnx',
    'decoder_joint-model.fp16.onnx',
    'encoder-model.onnx.data',
    'decoder_joint-model.onnx.data',
  ];
  const files = (await Promise.all(candidates.map(probe))).filter(Boolean);
  // Probe the contiguous fp32 encoder shards until the first gap so
  // resolveModelQuant and the download loop can see them.
  for (let i = 0; ; i++) {
    const name = `encoder-model.onnx.data.${String(i).padStart(3, '0')}`;
    if (!(await probe(name))) break;
    files.push(name);
  }
  return files;
}

// Map a resolved quant to its ONNX filename suffix. fp16 files are produced by
// scripts/quantize-fp16.py and must be hosted in the model repo to be selected.
export const QUANT_SUFFIX = { int8: '.int8.onnx', fp16: '.fp16.onnx', fp32: '.onnx' };

/**
 * Resolve the effective encoder/decoder quantisation for a backend, given what
 * the repo actually ships. Pure (no I/O) so it can be unit-tested.
 *
 *   - Non-WebGPU (WASM): pinned to int8 by default. fp16 overflows the WASM heap
 *     (the CPU/WASM EP upcasts fp16 to fp32, doubling it, and has no fp16 kernel)
 *     and a single 2.4 GB fp32 sidecar trips the ~2 GB ArrayBuffer / blob-fetch
 *     caps. The one exception is an explicit opt-in: when `allowWasmFp32` is set,
 *     `encoderQuant` is 'fp32', AND the repo ships the fp32 encoder as <2GB
 *     shards (encoder-model.onnx.data.NNN, from scripts/shard-fp32.py), the
 *     encoder resolves to fp32 (the shards clear both caps and the 2.4 GB fits
 *     the ~4 GB wasm32 heap). The decoder stays int8 (tiny, runs fine on WASM).
 *     Without all three the int8 pin stands.
 *   - WebGPU: the GPU EP has no int8 encoder kernel, so it needs fp16 or fp32.
 *     Prefer fp16 when the repo ships encoder-model.fp16.onnx (near-lossless vs
 *     fp32, ~half the download, and unlike int8 it does not drop content past
 *     ~20 s per chunk), else fall back to fp32. An explicit fp32 request is
 *     honoured. The tiny decoder follows to fp16 only when fp16 was requested
 *     and decoder_joint-model.fp16.onnx exists, otherwise stays int8 (which the
 *     GPU EP runs fine).
 *
 * @param {Object} args
 * @param {string} args.backend Backend mode ('wasm' | 'webgpu' | 'webgpu-*').
 * @param {('int8'|'fp16'|'fp32')} args.encoderQuant Requested encoder quant.
 * @param {('int8'|'fp16'|'fp32')} args.decoderQuant Requested decoder quant.
 * @param {string[]} args.repoFiles Filenames available in the repo.
 * @param {boolean} [args.allowWasmFp32=false] Opt-in: allow sharded fp32 on WASM
 *   when the repo ships encoder-model.onnx.data.NNN shards and fp32 is requested.
 * @returns {{encoderQ: string, decoderQ: string, pinnedToInt8: boolean, encoderFellBackToFp32: boolean}}
 */
export function resolveModelQuant({ backend, encoderQuant, decoderQuant, repoFiles, allowWasmFp32 = false }) {
  if (!backend.startsWith('webgpu')) {
    // Opt-in sharded fp32 on WASM: needs the explicit flag, an fp32 request, and
    // the repo to actually ship the <2GB shards. Anything missing keeps int8.
    const hasFp32Shards = repoFiles.some((f) => /^encoder-model\.onnx\.data\.\d+$/.test(f));
    if (allowWasmFp32 && encoderQuant === 'fp32' && hasFp32Shards) {
      return {
        encoderQ: 'fp32',
        decoderQ: 'int8',
        pinnedToInt8: false,
        encoderFellBackToFp32: false,
      };
    }
    return {
      encoderQ: 'int8',
      decoderQ: 'int8',
      pinnedToInt8: encoderQuant !== 'int8' || decoderQuant !== 'int8',
      encoderFellBackToFp32: false,
    };
  }
  const hasFp16Enc = repoFiles.includes('encoder-model.fp16.onnx');
  const hasFp16Dec = repoFiles.includes('decoder_joint-model.fp16.onnx');
  let encoderQ = encoderQuant;
  // int8/fp16 requests resolve to fp16-if-shipped-else-fp32; explicit fp32 stays.
  if (encoderQ === 'int8' || encoderQ === 'fp16') {
    encoderQ = hasFp16Enc ? 'fp16' : 'fp32';
  }
  const decoderQ = (decoderQuant === 'fp16' && hasFp16Dec) ? 'fp16' : 'int8';
  return {
    encoderQ,
    decoderQ,
    pinnedToInt8: false,
    encoderFellBackToFp32: encoderQ === 'fp32' && encoderQuant !== 'fp32',
  };
}

/**
 * Whether a given file set can fully satisfy the requested encoder quant for a
 * backend (i.e. resolveModelQuant returns NO downgrade: no int8 pin, no fp16->
 * fp32 fall-back). Pure wrapper over resolveModelQuant, used to decide whether a
 * locally-served /models mirror can deliver a quant the primary (HF) repo could
 * not: e.g. WASM fp32 needs the shards, WebGPU fp16 needs encoder-model.fp16.onnx.
 *
 * @param {Object} args Same shape as resolveModelQuant's args.
 * @returns {boolean} true when the request resolves with no downgrade.
 */
export function quantSatisfiable(args) {
  const r = resolveModelQuant(args);
  return !r.pinnedToInt8 && !r.encoderFellBackToFp32;
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
 * @param {('int8'|'fp16'|'fp32')} [options.encoderQuant='int8'] Requested encoder quant (resolved per backend/availability by resolveModelQuant)
 * @param {('int8'|'fp16'|'fp32')} [options.decoderQuant='int8'] Requested decoder quant
 * @param {('nemo80'|'nemo128')} [options.preprocessor] Preprocessor variant (auto-detected from model config if not specified)
 * @param {('js'|'onnx')} [options.preprocessorBackend='js'] Preprocessor backend selection.
 *   'js' uses the pure-JS mel.js (no ONNX download needed, supports streaming).
 *   'onnx' downloads the preprocessor ONNX model from the repo.
 * @param {('webgpu'|'webgpu-hybrid'|'webgpu-strict'|'wasm')} [options.backend='webgpu'] Backend mode
 * @param {boolean} [options.allowWasmFp32=false] Opt-in: on WASM, select the
 *   sharded fp32 encoder (instead of the int8 pin) when fp32 is requested and the
 *   repo ships encoder-model.onnx.data.NNN shards. Off by default (2.4 GB download).
 * @param {(progress: {loaded: number, total: number, file: string}) => void} [options.progress] Progress callback
 * @param {string} [options.localFallbackBaseUrl] When set, download files from this local
 *   base URL instead of HuggingFace (e.g., '/models'). Used as a fallback when HF is blocked.
 * @param {string} [options.localUpgradeBaseUrl] When set (and localFallbackBaseUrl is NOT),
 *   the HF path probes this local base URL (e.g. '/models') and switches the whole load to it
 *   BEFORE downloading when HF cannot serve the requested quant but the mirror can (WASM fp32
 *   shards, WebGPU fp16 encoder). Lets a user get a precision HF doesn't host without first
 *   downloading the downgraded weights. Ignored once localFallbackBaseUrl is set.
 * @returns {Promise<{urls: {encoderUrl: string|Uint8Array, decoderUrl: string|Uint8Array, tokenizerUrl: string, preprocessorUrl?: string, encoderDataUrl?: string|Array<{path:string,data:string}>|null, decoderDataUrl?: string|null}, filenames: {encoder: string, decoder: string}, quantisation: {encoder: ('int8'|'fp32'), decoder: ('int8'|'fp32')}, modelConfig: ModelConfig|null, preprocessorBackend: ('js'|'onnx')}>}
 */
export async function getParakeetModel(repoIdOrModelKey, options = {}) {
  // Resolve model key to repo ID and get config from the registry
  const modelConfig = getModelConfig(repoIdOrModelKey);
  const repoId = modelConfig?.repoId || repoIdOrModelKey;

  // Use model config defaults if available (e.g. nemo128 vs nemo80)
  const defaultPreprocessor = modelConfig?.preprocessor || 'nemo128';

  const { encoderQuant = 'int8', decoderQuant = 'int8', preprocessor = defaultPreprocessor, preprocessorBackend = 'js', backend = 'webgpu', progress, localFallbackBaseUrl, localUpgradeBaseUrl, allowWasmFp32 = false } = options;
  // The base URL all files are actually fetched from. Starts as the explicit
  // local fallback (if any), but can flip to localUpgradeBaseUrl below when the
  // primary (HF) source cannot serve the requested quant and the local mirror
  // can. `let` because of that pre-download switch.
  let effectiveLocalBase = localFallbackBaseUrl;

  // Resolve the effective revision: operator override (options.revision)
  // wins, otherwise the per-model pin in models.js, otherwise the moving
  // 'main' branch.
  const effectiveRevision = options.revision || modelConfig?.revision || 'main';

  // List the repo's files first: quant resolution below prefers fp16 when the
  // repo actually ships it, and the .data inclusion checks need the listing too.
  // Local fallback can't hit the HF API, so HEAD-probe the specific candidates
  // we care about (the fp16 variants and the fp32 external-data sidecars).
  let repoFiles = effectiveLocalBase
    ? await listLocalRepoFiles(effectiveLocalBase)
    : await listRepoFiles(repoId, effectiveRevision);

  // Resolve the effective quantisation per backend and per availability.
  let { encoderQ, decoderQ, pinnedToInt8, encoderFellBackToFp32 } =
    resolveModelQuant({ backend, encoderQuant, decoderQuant, repoFiles, allowWasmFp32 });

  // Pre-download upgrade: the primary (HF) source could not serve the requested
  // quant (WASM fp32 with no shards -> int8 pin, or WebGPU fp16 with no fp16
  // files -> fp32), but a locally-served /models mirror may ship the missing
  // pieces. Probe it BEFORE downloading the wrong (downgraded) weights; if it
  // can satisfy the request, switch the whole load to local. Only on the HF
  // path (no explicit localFallbackBaseUrl) and only when a probe target was
  // provided by the caller (localUpgradeBaseUrl).
  if (localUpgradeBaseUrl && !localFallbackBaseUrl && (pinnedToInt8 || encoderFellBackToFp32)) {
    const localFiles = await listLocalRepoFiles(localUpgradeBaseUrl).catch(() => []);
    if (quantSatisfiable({ backend, encoderQuant, decoderQuant, repoFiles: localFiles, allowWasmFp32 })) {
      console.log(`[Hub] HuggingFace cannot serve the requested quant (encoder=${encoderQuant}); `
        + `the local mirror at ${localUpgradeBaseUrl} can — switching the load to it`);
      effectiveLocalBase = localUpgradeBaseUrl;
      repoFiles = localFiles;
      ({ encoderQ, decoderQ, pinnedToInt8, encoderFellBackToFp32 } =
        resolveModelQuant({ backend, encoderQuant, decoderQuant, repoFiles, allowWasmFp32 }));
    }
  }

  if (pinnedToInt8) {
    // The user asked for a non-int8 quant on WASM and NO source we tried (the HF
    // repo, plus the local /models mirror when localUpgradeBaseUrl was probed
    // above) could serve it. We refuse to silently fall back to int8: a silent
    // quant swap makes it impossible to tell which precision actually loaded.
    // fp16 always overflows the WASM heap (no fp16 kernels, upcast doubles it).
    // fp32 only overflows as a single 2.4 GB sidecar; the SHARDED fp32 encoder
    // (scripts/shard-fp32.py + allowWasmFp32) loads fine, so this means the
    // requested quant's files were not available, not that fp32 is categorically
    // impossible on WASM. Throw so the caller surfaces it instead of proceeding.
    throw new QuantUnavailableError({
      backend,
      requested: { encoder: encoderQuant, decoder: decoderQuant },
      message: `Requested encoder=${encoderQuant}/decoder=${decoderQuant} cannot run on the `
        + `${backend} backend from any available source. fp16 cannot run on WASM at all; `
        + `fp32 needs the <2 GB shards (encoder-model.onnx.data.NNN from scripts/shard-fp32.py), `
        + `which neither HuggingFace nor the local /models mirror ships. Host the shards or pick int8.`,
    });
  }
  if (encoderFellBackToFp32) {
    console.warn('[Hub] No fp16 encoder in repo; using the fp32 encoder on WebGPU');
  }

  const encoderName = `encoder-model${QUANT_SUFFIX[encoderQ]}`;
  const decoderName = `decoder_joint-model${QUANT_SUFFIX[decoderQ]}`;

  // The big encoder/decoder weights are handed to ORT as bytes (not a blob URL)
  // on WebGPU, where they are fp16/fp32 (>1 GB) and a blob-URL fetch OOMs (see
  // blobToBytes). vocab + external-data sidecars stay as URLs.
  const loadAsBytes = backend.startsWith('webgpu');
  // `weight` marks the big ONNX files (and their external-data sidecars) whose
  // cached bytes get deserialized at session-create time; evictModelFiles
  // targets exactly these on a corrupt-cache recovery (results.cacheInfo below).
  const filesToGet = [
    { key: 'encoderUrl', name: encoderName, asBytes: loadAsBytes, weight: true },
    { key: 'decoderUrl', name: decoderName, asBytes: loadAsBytes, weight: true },
    { key: 'tokenizerUrl', name: 'vocab.txt' },
  ];

  // Only download preprocessor ONNX when not using JS backend.
  // The JS backend (mel.js) computes mel spectrograms locally without
  // needing a separate ONNX model, saving download bandwidth.
  if (preprocessorBackend !== 'js') {
    filesToGet.push({ key: 'preprocessorUrl', name: `${preprocessor}.onnx` });
    console.log(`[Hub] Preprocessor: ONNX — will download ${preprocessor}.onnx`);
  } else {
    console.log(`[Hub] Preprocessor: JS (mel.js) — skipping ${preprocessor}.onnx download`);
  }

  // External encoder weights come in one of two layouts. A sharded fp32 encoder
  // (scripts/shard-fp32.py) splits them into <name>.data.000/.001/... files, each
  // < 2 GB so it clears the WASM ArrayBuffer / Chromium blob-fetch caps; a plain
  // export keeps a single <name>.data sidecar. Prefer shards when the repo ships
  // them (they also let WebGPU fp32 dodge the 2 GB fetch cap), else the sidecar.
  // Shards are downloaded after the main loop into an array of { path, data }
  // entries (parakeet.js buildExternalData mounts that form directly).
  const shardRe = new RegExp(`^${encoderName.replace(/[.]/g, '\\.')}\\.data\\.\\d+$`);
  const encoderShards = repoFiles.filter((f) => shardRe.test(f)).sort();
  if (encoderShards.length === 0 && repoFiles.includes(`${encoderName}.data`)) {
    filesToGet.push({ key: 'encoderDataUrl', name: `${encoderName}.data`, weight: true });
  }

  if (repoFiles.includes(`${decoderName}.data`)) {
    filesToGet.push({ key: 'decoderDataUrl', name: `${decoderName}.data`, weight: true });
  }

  const results = {
      urls: {},
      filenames: {
          encoder: encoderName,
          decoder: decoderName
      },
      quantisation: { encoder: encoderQ, decoder: decoderQ },
      // Downgrade flags: true when this source could not satisfy the requested
      // quant (WASM int8 pin, or WebGPU fp16->fp32 fall-back). The caller uses
      // them to decide whether a local /models mirror should be tried instead.
      pinnedToInt8,
      encoderFellBackToFp32,
      modelConfig: modelConfig || null,  // Include model config for downstream use
      preprocessorBackend,  // Pass through so callers know which backend to use
      // Everything evictModelFiles needs to drop these exact cached blobs and
      // re-download them when a corrupt file fails to deserialize at session
      // create. Derived from the `weight` flag so it can't drift from the
      // download list. Sharded fp32 weights are noCache (never cached) so they
      // are not listed. subfolder is always '' for the Parakeet repos.
      cacheInfo: {
          repoId,
          revision: effectiveRevision,
          subfolder: '',
          filenames: filesToGet.filter((f) => f.weight).map((f) => f.name),
      },
  };

  // One place that knows how to fetch a single file (HF or local fallback),
  // reused by both the main file loop and the shard loop below so the two can
  // never diverge in revision/progress handling.
  const downloadFile = (name, asBytes = false, noCache = false) => {
    const wrappedProgress = progress ? (p) => progress({ ...p, file: name }) : undefined;
    const perFileOpts = { ...options, revision: effectiveRevision, progress: wrappedProgress, asBytes, noCache };
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
  //     straight to a Uint8Array skips IDB entirely. Not caching the shards is
  //     fine: they are huge and re-downloaded rarely, and the sharded encoder is
  //     an explicit opt-in. Each shard is < 2 GB by construction (shard-fp32.py),
  //     so the single Uint8Array clears the ArrayBuffer cap.
  if (encoderShards.length) {
    console.log(`[Hub] Encoder fp32 in ${encoderShards.length} shard(s); mounting as multi-file external data`);
    results.urls.encoderDataUrl = [];
    for (const name of encoderShards) {
      results.urls.encoderDataUrl.push({ path: name, data: await downloadFile(name, true, true) });
    }
  }

  // Every file for this model is now cached under the current (repoId,
  // effectiveRevision) keys, so prune any other model's records left behind by
  // a previous repo/revision/quant. cachedFilenames must list everything that
  // actually persisted to IDB, or the sweep would delete a file we just stored:
  // that is every entry in the main download loop (sharded fp32 weights are
  // loaded noCache, so they are NOT cached and are intentionally excluded here).
  // Keyed by repoId for both HF and local-mirror loads, matching downloadFile's
  // cacheKey scheme. sweepOrphanedFiles never throws.
  const cachedFilenames = filesToGet.map((f) => f.name);
  await sweepOrphanedFiles({ repoId, revision: effectiveRevision, subfolder: '', filenames: cachedFilenames });

  return results;
}
