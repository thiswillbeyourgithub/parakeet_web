/**
 * Simplified HuggingFace Hub utilities for parakeet.js
 * Downloads models from HF and caches them in browser storage.
 * Supports an optional local fallback: if HuggingFace is unreachable
 * (firewalled, blocked, etc.), callers can provide a local base URL
 * from which the same model files are served.
 */

import { MODELS, getModelConfig } from './models.js';
import { openIdb, idbGet, idbPut, idbDelete, idbClear } from './idb.js';
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

const DB_NAME = 'parakeet-cache-db';
const STORE_NAME = 'file-store';

// Resumable-download tuning. Partial state is flushed to IndexedDB every
// FLUSH_INTERVAL bytes so a tab close or network drop only loses up to that
// much progress. MAX_RETRIES with exponential backoff handles transient
// drops; persistent failures (CORS, 404, hard offline) still surface.
const FLUSH_INTERVAL = 8 * 1024 * 1024;
const MAX_RETRIES = 6;
const PARTIAL_PREFIX = 'partial-';
const SEGMENT_INFIX = '-seg-';
// If no chunk arrives for this long, abort the fetch and retry. Without it
// a silently half-open connection (proxy idle-out, dropped TCP) hangs the
// reader forever instead of triggering the existing retry/backoff logic.
const INACTIVITY_TIMEOUT_MS = 30000;

// Cache for repo file listings so we only hit the HF API once per page load
const repoFileCache = new Map();

/**
 * SHA-256 a Blob and return a lowercase hex digest. Used to verify model
 * file integrity against per-file hashes pinned in models.js so a HF repo
 * takeover, force-push, or one-shot MITM cannot silently swap weights
 * (the model runs in WASM/WebGPU with full access to the user's mic audio).
 */
async function _sha256Hex(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _normalizeHash(h) {
  if (!h) return '';
  return String(h).toLowerCase().replace(/^sha-?256[:=-]/, '').trim();
}

/**
 * Compare a freshly computed hash against an expected pin.
 * - Empty expected: log a loud warning (integrity NOT enforced) and return.
 *   This keeps the app working when models.js hasn't been pinned yet, but
 *   the warning shows up in every console and is also surfaced in the UI
 *   via the global error banner if devs forget.
 * - Mismatch: throw HubDownloadError so the caller refuses InferenceSession
 *   creation and the user sees a clear failure instead of a silent swap.
 */
function _verifyHash(filename, actualHex, expected, logTag) {
  const exp = _normalizeHash(expected);
  if (!exp) {
    console.warn(`${logTag} INTEGRITY: no expected sha256 for ${filename}; model verification SKIPPED. Pin via recipe in docker/env.example and update models.js. Computed sha256: ${actualHex}`);
    return;
  }
  if (exp !== actualHex) {
    const err = new Error(`Integrity check failed for ${filename}: expected sha256 ${exp}, got ${actualHex}`);
    err.name = 'IntegrityError';
    throw err;
  }
  console.log(`${logTag} Integrity OK for ${filename} (sha256 ${actualHex.slice(0, 12)}...)`);
}

/**
 * Verify a cached blob against the expected hash before returning it.
 * On mismatch, evict the bad entry so the next call re-downloads. When no
 * hash is pinned, the cache hit is trusted (with a one-time warning that
 * also fired on the original download); the IndexedDB cache is treated as
 * a decoder-only optimisation, not a trust anchor, so trust here is gated
 * entirely on whether an expected hash exists. Returns true if safe to use.
 */
async function _isCacheHitValid(cachedBlob, filename, expectedHash, logTag, cacheKey) {
  const exp = _normalizeHash(expectedHash);
  if (!exp) {
    // No pinned hash: nothing to verify against. _verifyHash already
    // logs the unsafe-default warning on every download path.
    return true;
  }
  let actual;
  try {
    actual = await _sha256Hex(cachedBlob);
  } catch (e) {
    console.warn(`${logTag} Failed to hash cached ${filename}, will re-download:`, e);
    return false;
  }
  if (actual === exp) return true;
  console.warn(`${logTag} INTEGRITY: cached ${filename} hash mismatch (expected ${exp}, got ${actual}). Evicting and re-downloading.`);
  try {
    const db = await getDb();
    await idbDelete(db, STORE_NAME, cacheKey);
  } catch (e) {
    console.warn(`${logTag} Failed to evict tampered cache entry for ${filename}:`, e);
  }
  return false;
}

function makeCacheKey(repoId, revision, subfolder, filename) {
  return `hf-${repoId}-${revision}-${subfolder}-${filename}`;
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

  const url = `https://huggingface.co/api/models/${repoId}?revision=${encodeURIComponent(revision)}`;
  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const json = await resp.json();
      const raw = json.siblings?.map(s => s.rfilename) || [];
      const files = raw.filter(name => typeof name === 'string' && SAFE_RFILENAME_RE.test(name));
      if (files.length !== raw.length) {
        console.warn(`[Hub] listRepoFiles ${repoId}@${revision}: dropped ${raw.length - files.length} sibling(s) with unsafe filenames`);
      }
      repoFileCache.set(cacheKey, files);
      return files;
    }
    // 4xx (e.g. 404 wrong repo, 401 gated): empty listing is the right
    // answer; the caller's per-file fetch will surface the real error.
    if (resp.status >= 400 && resp.status < 500) {
      console.warn(`[Hub] listRepoFiles ${repoId}@${revision} returned ${resp.status}`);
      repoFileCache.set(cacheKey, []);
      return [];
    }
    // 5xx is transient — don't poison the cache so a later call can retry.
    console.warn(`[Hub] listRepoFiles ${repoId}@${revision} server error ${resp.status} – retry possible`);
    return [];
  } catch (err) {
    // Network/CORS error: also transient — leave the cache unset.
    console.warn('[Hub] listRepoFiles network error – falling back to optimistic fetch:', err.message || err);
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
 * @returns {Promise<string>} Blob URL
 */
async function _streamAndCache(url, cacheKey, filename, progress, logTag, expectedHash) {
  const partialKey = PARTIAL_PREFIX + cacheKey;
  const segKey = (i) => `${partialKey}${SEGMENT_INFIX}${i}`;

  // Resume metadata is tiny and safe to rewrite frequently. The actual
  // bytes live in append-only segment records (segKey(0..segCount-1)),
  // so each flush only writes the new bytes since the last flush. This
  // keeps total IDB write cost linear in the file size.
  let meta = null;
  if (typeof indexedDB !== 'undefined') {
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
    if (typeof indexedDB === 'undefined') return;
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
  async function flushTail() {
    if (typeof indexedDB === 'undefined' || tailBytes === 0) return;
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

      const reader = resp.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetWatchdog();
          tailChunks.push(value);
          tailBytes += value.length;
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
      if (attempt >= MAX_RETRIES) throw err;
      const delay = Math.min(30000, 1000 * 2 ** attempt);
      console.warn(`${logTag} Download error for ${filename} at ${received}/${total || '?'}, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES}):`, err.message || err);
      await new Promise(r => setTimeout(r, delay));
      attempt += 1;
    }
  }

  // Final assembly: segments on disk plus the trailing in-memory chunks.
  // Blob composition is by reference, so this is cheap.
  const blob = new Blob([...segments, ...tailChunks], { type: contentType });

  // Integrity verification BEFORE persisting to IndexedDB. If a hash is
  // pinned in models.js and the bytes we just received don't match, we
  // must not cache the tampered blob (which would otherwise survive across
  // reloads) and must not return a URL that the caller will feed to
  // InferenceSession.create.
  const actualHash = await _sha256Hex(blob);
  try {
    _verifyHash(filename, actualHash, expectedHash, logTag);
  } catch (err) {
    if (typeof indexedDB !== 'undefined') {
      await deleteAllPartial();
    }
    throw err;
  }

  if (typeof indexedDB !== 'undefined') {
    try {
      await saveFileToDb(cacheKey, blob);
      console.log(`${logTag} Cached ${filename} in IndexedDB`);
    } catch (e) {
      console.warn(`${logTag} Failed to cache in IndexedDB:`, e);
    }
    await deleteAllPartial();
  }

  return URL.createObjectURL(blob);
}

export async function getModelFile(repoId, filename, options = {}) {
  const { revision = 'main', subfolder = '', progress, expectedHash } = options;

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
  
  if (typeof indexedDB !== 'undefined') {
    try {
      const cachedBlob = await getFileFromDb(cacheKey);
      if (cachedBlob) {
        // Re-verify the cached bytes against the expected hash on every
        // hit. Otherwise a one-shot MITM during the very first download
        // (TLS-intercepting corporate proxy, captive portal, BGP hijack)
        // would persist across every subsequent reload: the cache key
        // never changes, and without this check the bad blob is returned
        // forever even after the network returns to normal.
        if (await _isCacheHitValid(cachedBlob, filename, expectedHash, '[Hub]', cacheKey)) {
          console.log(`[Hub] Using cached ${filename} from IndexedDB`);
          return URL.createObjectURL(cachedBlob);
        }
        // Fall through to re-download. _isCacheHitValid has already
        // evicted the bad entry from IndexedDB.
      }
    } catch (e) {
      console.warn('[Hub] IndexedDB cache check failed:', e);
    }
  }

  // Download from HF (resumable + retrying internally)
  console.log(`[Hub] Downloading ${filename} from ${repoId}...`);
  try {
    return await _streamAndCache(url, cacheKey, filename, progress, '[Hub]', expectedHash);
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
  const { progress, revision = 'main', subfolder = '', expectedHash } = options;

  // Reuse IndexedDB cache (same key scheme so a prior HF download is also matched)
  const cacheKey = makeCacheKey(repoId, revision, subfolder, filename);
  if (typeof indexedDB !== 'undefined') {
    try {
      const cachedBlob = await getFileFromDb(cacheKey);
      if (cachedBlob) {
        if (await _isCacheHitValid(cachedBlob, filename, expectedHash, '[Hub:local]', cacheKey)) {
          console.log(`[Hub:local] Using cached ${filename} from IndexedDB`);
          return URL.createObjectURL(cachedBlob);
        }
      }
    } catch (e) {
      console.warn('[Hub:local] IndexedDB cache check failed:', e);
    }
  }

  const url = `${baseUrl}/${filename}`;
  console.log(`[Hub:local] Downloading ${filename} from ${url}...`);
  return _streamAndCache(url, cacheKey, filename, progress, '[Hub:local]', expectedHash);
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
 * Convenience function to get all Parakeet model files for a given architecture.
 * Accepts either a HuggingFace repo ID or a known model key from the registry.
 * @param {string} repoIdOrModelKey HF repo (e.g., 'nvidia/parakeet-tdt-1.1b') or model key (e.g., 'parakeet-tdt-0.6b-v3')
 * @param {Object} [options]
 * @param {('int8'|'fp32')} [options.encoderQuant='int8'] Encoder quantization
 * @param {('int8'|'fp32')} [options.decoderQuant='int8'] Decoder quantization
 * @param {('nemo80'|'nemo128')} [options.preprocessor] Preprocessor variant (auto-detected from model config if not specified)
 * @param {('js'|'onnx')} [options.preprocessorBackend='js'] Preprocessor backend selection.
 *   'js' uses the pure-JS mel.js (no ONNX download needed, supports streaming).
 *   'onnx' downloads the preprocessor ONNX model from the repo.
 * @param {('webgpu'|'webgpu-hybrid'|'webgpu-strict'|'wasm')} [options.backend='webgpu'] Backend mode
 * @param {(progress: {loaded: number, total: number, file: string}) => void} [options.progress] Progress callback
 * @param {string} [options.localFallbackBaseUrl] When set, download files from this local
 *   base URL instead of HuggingFace (e.g., '/models'). Used as a fallback when HF is blocked.
 * @returns {Promise<{urls: {encoderUrl: string, decoderUrl: string, tokenizerUrl: string, preprocessorUrl?: string, encoderDataUrl?: string|null, decoderDataUrl?: string|null}, filenames: {encoder: string, decoder: string}, quantisation: {encoder: ('int8'|'fp32'), decoder: ('int8'|'fp32')}, modelConfig: ModelConfig|null, preprocessorBackend: ('js'|'onnx')}>}
 */
export async function getParakeetModel(repoIdOrModelKey, options = {}) {
  // Resolve model key to repo ID and get config from the registry
  const modelConfig = getModelConfig(repoIdOrModelKey);
  const repoId = modelConfig?.repoId || repoIdOrModelKey;

  // Use model config defaults if available (e.g. nemo128 vs nemo80)
  const defaultPreprocessor = modelConfig?.preprocessor || 'nemo128';

  const { encoderQuant = 'int8', decoderQuant = 'int8', preprocessor = defaultPreprocessor, preprocessorBackend = 'js', backend = 'webgpu', progress, localFallbackBaseUrl } = options;

  // Resolve the effective revision: operator override (options.revision)
  // wins, otherwise the per-model pin in models.js, otherwise the moving
  // 'main' branch (logged as a warning by _verifyHash when hashes is empty).
  const effectiveRevision = options.revision || modelConfig?.revision || 'main';
  const expectedHashes = modelConfig?.hashes || {};
  // F-99: fail-closed when running in production with no pinned hashes
  // AND no operator opt-in. The trust-on-first-use behaviour
  // (download whatever HF returns, hash it, never verify) is fine for
  // local development but ships every visitor a fresh weights blob
  // on a HF repo takeover or one-shot MITM. Default-deny means: a
  // prod operator who hasn't followed the env.example pinning recipe
  // must explicitly set VITE_ALLOW_UNVERIFIED_MODEL=true to acknowledge
  // the trust gap. Dev (`import.meta.env.PROD === false`) keeps the
  // warn-and-proceed path so local hacking is unaffected.
  const _PROD = typeof import.meta !== 'undefined' && import.meta.env?.PROD === true;
  const _ALLOW_UNVERIFIED = (typeof window !== 'undefined' && window.__CONFIG__?.VITE_ALLOW_UNVERIFIED_MODEL === 'true')
    || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ALLOW_UNVERIFIED_MODEL === 'true');
  if (Object.keys(expectedHashes).length === 0) {
    if (_PROD && !_ALLOW_UNVERIFIED) {
      throw new Error(`[Hub] model ${repoId} has no pinned hashes in models.js. Production refuses to load unverified weights. Either populate the hashes via the env.example recipe, or set VITE_ALLOW_UNVERIFIED_MODEL=true to opt in to trust-on-first-use.`);
    }
    if (effectiveRevision === 'main') {
      console.warn(`[Hub] WARNING: model ${repoId} is being loaded from the moving 'main' branch with NO pinned hashes. A HF repo takeover or one-shot MITM could swap weights. Run recipe in docker/env.example and update models.js, or set VITE_MODEL_REVISION.`);
    }
  }

  // Decide quantisation per component
  let encoderQ = encoderQuant;
  let decoderQ = decoderQuant;

  // WebGPU currently doesn't support int8 quantized encoder
  if (backend.startsWith('webgpu') && encoderQ === 'int8') {
    console.warn('[Hub] Forcing encoder to fp32 on WebGPU (int8 unsupported)');
    encoderQ = 'fp32';
  }

  const encoderSuffix = encoderQ === 'int8' ? '.int8.onnx' : '.onnx';
  const decoderSuffix = decoderQ === 'int8' ? '.int8.onnx' : '.onnx';

  const encoderName = `encoder-model${encoderSuffix}`;
  const decoderName = `decoder_joint-model${decoderSuffix}`;

  // When using local fallback, skip the HF API call (it would fail anyway).
  // HEAD-probe the optional .data files so we don't fire noisy 404s on the
  // main GET path when the model has none.
  let repoFiles;
  if (localFallbackBaseUrl) {
    const probe = async (name) => {
      try {
        const res = await fetch(`${localFallbackBaseUrl}/${name}`, { method: 'HEAD' });
        return res.ok ? name : null;
      } catch { return null; }
    };
    const probed = await Promise.all([probe(`${encoderName}.data`), probe(`${decoderName}.data`)]);
    repoFiles = probed.filter(Boolean);
  } else {
    repoFiles = await listRepoFiles(repoId, effectiveRevision);
  }

  const filesToGet = [
    { key: 'encoderUrl', name: encoderName },
    { key: 'decoderUrl', name: decoderName },
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

  // Conditionally include external data files only if they exist in the repo file list.
  if (repoFiles.includes(`${encoderName}.data`)) {
    filesToGet.push({ key: 'encoderDataUrl', name: `${encoderName}.data` });
  }

  if (repoFiles.includes(`${decoderName}.data`)) {
    filesToGet.push({ key: 'decoderDataUrl', name: `${decoderName}.data` });
  }

  const results = {
      urls: {},
      filenames: {
          encoder: encoderName,
          decoder: decoderName
      },
      quantisation: { encoder: encoderQ, decoder: decoderQ },
      modelConfig: modelConfig || null,  // Include model config for downstream use
      preprocessorBackend,  // Pass through so callers know which backend to use
  };

  for (const { key, name } of filesToGet) {
    try {
        const wrappedProgress = progress ? (p) => progress({ ...p, file: name }) : undefined;
        const perFileOpts = {
          ...options,
          revision: effectiveRevision,
          progress: wrappedProgress,
          expectedHash: expectedHashes[name],
        };
        if (localFallbackBaseUrl) {
          // Local fallback mode: download from the instance instead of HuggingFace
          results.urls[key] = await getLocalModelFile(localFallbackBaseUrl, repoId, name, perFileOpts);
        } else {
          results.urls[key] = await getModelFile(repoId, name, perFileOpts);
        }
    } catch (e) {
        if (key.endsWith('DataUrl')) {
            console.warn(`[Hub] Optional external data file not found: ${name}. This is expected if the model is small.`);
            results.urls[key] = null;
        } else {
            throw e;
        }
    }
  }

  return results;
}
