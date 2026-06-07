import React, { useState, useRef, useEffect, useTransition, useCallback, useMemo } from 'react';
import { ParakeetModel, getParakeetModel, checkLocalModelFiles, HubDownloadError, QuantUnavailableError, shouldRetryLocally } from 'parakeet.js';
import './App.css';
import { useI18n, LanguageSwitcher } from './i18n.jsx';
import Banner from './components/Banner.jsx';
import Modal, { useAnyModalOpen } from './components/Modal.jsx';
import { RemoteMicRTC } from './lib/remote-webrtc.js';
import { resamplePcmTo16k, createLevelMonitor } from './lib/audio.js';
import { verifiedAddModule } from './lib/asset-integrity.js';
import { createLiveTranscriber } from './lib/liveTranscriber.js';
import { acquireKeepalive, releaseKeepalive } from './lib/keepalive.js';
import {
    generateKeyPair, exportPublicKey, importPublicKey,
    deriveSharedKey, decrypt
} from './lib/remote-crypto.js';
import {
    getAdaptiveFingerprintLength, computePairFingerprintForRole
} from './lib/remote-mic-handshake.js';
import VerificationModal from './components/VerificationModal.jsx';
import { CONFIG } from './config.js';
import { openIdb, idbGet, idbPut, idbDelete, idbClear, idbDeleteDatabase } from '../../src/idb.js';
import { loadBpeEncoder, BPE_ASSET_URL, vocabSignature } from '../../src/bpeEncoder.js';
import { BoostingTrie, parseBoostPhrases, parseBoostDirectives, encodePhrases, expandAugmentations, selectPrebuilt, MAX_PHRASE_WEIGHT, FULL_AUGMENT } from '../../src/phraseBoost.js';
import { clearCache as clearModelCache, evictModelFiles, isModelDeserializeError } from '../../src/hub.js';
import { DEFAULT_CHUNK_DURATION_SEC } from '../../src/models.js';
import { formatTime, formatDuration, formatBytes, formatRate, formatEta, updateDownloadRate, relativeAge } from './lib/format.js';
import { requestPersistentStorage } from './lib/persistStorage.js';

// Dictation device support (Philips SpeechMike etc.) via WebHID.
// Conditionally imported so the feature can be fully disabled via env var.
const devMode = CONFIG.VITE_DEV_MODE === 'true';

// Localize relativeAge()'s { value, unit } into a phrase like "3 hours ago".
// Returns null when there is no parseable container start time so the dev
// banner can fall back to its generic (no-timestamp) wording.
function relativeAgePhrase(t, fromIso) {
  if (!fromIso) return null;
  const r = relativeAge(fromIso);
  if (!r) return null;
  if (r.unit === 'justNow') return t('ageJustNow');
  const plural = r.value !== 1;
  const key = {
    minute: plural ? 'ageMinutesAgo' : 'ageMinuteAgo',
    hour: plural ? 'ageHoursAgo' : 'ageHourAgo',
    day: plural ? 'ageDaysAgo' : 'ageDayAgo',
  }[r.unit];
  return t(key, { n: r.value });
}
const dictationEnabled = CONFIG.VITE_DICTATION_DEVICE_SUPPORT !== 'false';
// Lazy-loaded on first use to avoid top-level await issues
let _dictationLib = null;
async function getDictationLib() {
  if (!_dictationLib && dictationEnabled) {
    // The vendored dictation_support is a UMD bundle. Vite/Rollup treats it as
    // CJS and routes the factory result through the module's default export, so
    // the `self.DictationSupport=...` branch is never bundled. Read from the
    // import namespace's default (with a self-global fallback just in case).
    const mod = await import('dictation_support');
    _dictationLib = mod?.default ?? mod?.DictationSupport ?? self.DictationSupport;
    if (!_dictationLib || !_dictationLib.DictationDeviceManager) {
      throw new Error('dictation_support failed to expose DictationDeviceManager');
    }
  }
  return _dictationLib;
}

// Simple help icon component with click-based tooltip.
// The popup uses position: fixed with coordinates computed from the
// button's bounding rect, so it can overlay sibling containers (e.g.
// the settings sidebar) without being clipped by their overflow, and
// is clamped to stay inside the viewport horizontally.
function InfoTooltip({ text }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const rootRef = React.useRef(null);
  const popupRef = React.useRef(null);

  // Prevent the click from bubbling to a wrapping <label>, which would
  // otherwise toggle the associated checkbox/radio input.
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const toggle = (e) => { stop(e); setIsOpen(v => !v); };
  const close = (e) => { stop(e); setIsOpen(false); };

  // Compute popup coordinates from the button's rect, clamped to viewport.
  const computePos = React.useCallback(() => {
    const btn = rootRef.current && rootRef.current.querySelector('.info-help-button');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popupEl = popupRef.current;
    // Use a viewport-clamped target width. We deliberately do NOT read
    // offsetWidth: when the popup renders inside a narrow ancestor (e.g.
    // the settings sidebar), shrink-to-fit can give a tiny natural width
    // and pin the popup to a thin, very tall column that overflows on
    // phones. CSS sets the same min(320px, 100vw - 16px) width so the
    // hidden first frame already lays out at a sane width.
    const width = Math.min(320, vw - 2 * margin);
    const measuredH = popupEl ? popupEl.offsetHeight : 0;
    let left = rect.left + rect.width / 2 - width / 2;
    if (left + width > vw - margin) left = vw - margin - width;
    if (left < margin) left = margin;
    let top = rect.bottom + 8;
    const availH = vh - 2 * margin;
    const fitH = Math.min(measuredH, availH);
    if (fitH && top + fitH > vh - margin) {
      const above = rect.top - 8 - fitH;
      if (above >= margin) top = above;
      else top = Math.max(margin, vh - margin - fitH);
    }
    setPos({ left, top, width });
  }, []);

  // Dismiss on any outside interaction (click, touch, Escape) and
  // recompute on resize. We listen at the document level instead of
  // rendering a full-viewport overlay so the first click outside lands
  // on its real target (another tooltip, sidebar close button, scrollbar,
  // etc.) instead of being swallowed just to close the popup.
  React.useEffect(() => {
    if (!isOpen) return;
    computePos();
    const onOutside = (e) => {
      if (rootRef.current && rootRef.current.contains(e.target)) return;
      if (popupRef.current && popupRef.current.contains(e.target)) return;
      setIsOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    const onScroll = () => setIsOpen(false);
    const onResize = () => computePos();
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside, { passive: true });
    document.addEventListener('keydown', onKey);
    // Capture phase so scrolls inside any container also dismiss.
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, computePos]);

  // Re-measure once the popup has rendered so the initial frame already
  // shows it correctly clamped and (if needed) flipped above the button.
  React.useLayoutEffect(() => {
    if (isOpen) computePos();
  }, [isOpen, computePos]);

  return (
    <span ref={rootRef} className="info-help" onClick={stop}>
      <button
        type="button"
        className="info-help-button"
        onClick={toggle}
        aria-label="?"
      >
        ?
      </button>
      {isOpen && (
        <div
          ref={popupRef}
          className="info-help-text"
          onClick={stop}
          style={pos ? { left: pos.left + 'px', top: pos.top + 'px', width: pos.width + 'px' } : { visibility: 'hidden' }}
        >
          {text}
          <button className="info-help-close" onClick={close}>×</button>
        </div>
      )}
    </span>
  );
}

// IndexedDB-backed settings persistence built on the shared idb.js helper.
const SETTINGS_DB_NAME = 'parakeetweb-settings-db';
const SETTINGS_STORE_NAME = 'settings-store';
const STORAGE_KEY_PREFIX = 'parakeetweb_';

// F-128: transcripts live in their own DB so a per-entry delete can call
// idbDeleteDatabase on JUST the transcripts container and evict LevelDB
// residue, without taking the rest of the settings DB with it.
const TRANSCRIPTS_DB_NAME = 'parakeetweb-transcripts-db';
const TRANSCRIPTS_STORE_NAME = 'transcripts-store';
const TRANSCRIPTS_KEY = 'transcripts';

const getSettingsDb = () => openIdb(SETTINGS_DB_NAME, SETTINGS_STORE_NAME);
const getTranscriptsDb = () => openIdb(TRANSCRIPTS_DB_NAME, TRANSCRIPTS_STORE_NAME);

// Watchdog cap for restoring settings on startup. The scalar settings are tiny
// IndexedDB reads (sub-ms normally), so the only way they stall is a wedged DB
// (e.g. another tab holding a versionchange that blocks our open). Past this we
// stop waiting, log it, and boot on defaults rather than hang on a blank state.
const SETTINGS_LOAD_TIMEOUT_MS = 6000;

async function loadSetting(key, defaultValue) {
  try {
    const value = await idbGet(await getSettingsDb(), SETTINGS_STORE_NAME, STORAGE_KEY_PREFIX + key);
    return value !== undefined ? value : defaultValue;
  } catch (e) {
    console.warn(`Failed to load setting ${key}:`, e);
    return defaultValue;
  }
}

async function saveSetting(key, value) {
  try {
    await idbPut(await getSettingsDb(), SETTINGS_STORE_NAME, STORAGE_KEY_PREFIX + key, value);
  } catch (e) {
    console.warn(`Failed to save setting ${key}:`, e);
  }
}

// Load the persisted transcripts array from the dedicated transcripts DB.
// Migrates a legacy `parakeetweb_transcriptions` value out of the settings DB
// the first time it runs after the F-128 split.
async function loadPersistedTranscripts() {
  try {
    const fromOwn = await idbGet(await getTranscriptsDb(), TRANSCRIPTS_STORE_NAME, TRANSCRIPTS_KEY);
    if (Array.isArray(fromOwn)) return fromOwn;
    const legacy = await idbGet(await getSettingsDb(), SETTINGS_STORE_NAME, STORAGE_KEY_PREFIX + 'transcriptions');
    if (Array.isArray(legacy) && legacy.length > 0) {
      await saveTranscripts(legacy);
      await idbDelete(await getSettingsDb(), SETTINGS_STORE_NAME, STORAGE_KEY_PREFIX + 'transcriptions');
      return legacy;
    }
    return [];
  } catch (e) {
    console.warn('Failed to load transcripts:', e);
    return [];
  }
}

// F-130: persist only the minimum the history UI needs to render on reload
// (id, text, timestamp, wordCount). filename, words[] (per-word confidences
// and start/end timestamps), metrics, and duration stay in-memory and are
// re-derived/absent on reload. Narrows the on-disk record so a LevelDB
// recovery cannot reconstruct the audio fingerprint of the original recording
// (per-word timings, file name that may itself carry PHI like a patient
// identifier) beyond the text content the user explicitly opted into saving.
function slimTranscriptForPersist(t) {
  if (!t || typeof t !== 'object') return t;
  return {
    id: t.id,
    text: t.text,
    timestamp: t.timestamp,
    wordCount: t.wordCount,
  };
}

async function saveTranscripts(arr) {
  try {
    const slim = Array.isArray(arr) ? arr.map(slimTranscriptForPersist) : arr;
    await idbPut(await getTranscriptsDb(), TRANSCRIPTS_STORE_NAME, TRANSCRIPTS_KEY, slim);
  } catch (e) {
    console.warn('Failed to save transcripts:', e);
  }
}

// F-128: wipe the transcripts DB entirely so LevelDB drops the SST/log files
// holding the previous (longer) array, then re-persist the new shorter array
// into a fresh DB. Called on per-entry delete so a deleted transcript leaves
// no recoverable residue. The settings DB is untouched.
async function wipeAndRewriteTranscripts(arr) {
  try {
    await idbDeleteDatabase(TRANSCRIPTS_DB_NAME);
    if (Array.isArray(arr) && arr.length > 0) {
      await saveTranscripts(arr);
    }
  } catch (e) {
    console.warn('Failed to wipe transcripts DB:', e);
  }
}

// Forget the on-disk transcripts container entirely. Used when the user
// toggles persistTranscripts OFF or hits "Clear all transcripts". Uses
// idbDeleteDatabase to evict LevelDB residue rather than a logical delete.
async function forgetPersistedTranscripts() {
  try {
    await idbDeleteDatabase(TRANSCRIPTS_DB_NAME);
  } catch (e) {
    console.warn('Failed to forget transcripts:', e);
  }
}

async function clearAllSettings() {
  try {
    // Delete the whole DB file rather than store.clear(): the latter
    // only writes a delete-marker, leaving the cleared values
    // recoverable from LevelDB SST/log residue until the next
    // compaction (hours-to-days). deleteDatabase forces the backing
    // files to be dropped, which is what the user expects from a
    // "purge / reset" action. The next openIdb() rebuilds it empty.
    await idbDeleteDatabase(SETTINGS_DB_NAME);
    console.log('[App] All settings cleared (DB deleted)');
  } catch (e) {
    console.warn('Failed to clear settings:', e);
  }
}

// Injected by Vite from app/package.json — no need to manually sync
const VERSION = __APP_VERSION__;

// Module-scope hook: persists `value` to IndexedDB whenever it changes,
// gated on `loaded` so we don't overwrite the on-disk value with the
// initial React default before loadSetting has had a chance to run.
function usePersistedSetting(key, value, loaded) {
  useEffect(() => {
    if (loaded) saveSetting(key, value);
  }, [key, value, loaded]);
}

// Helper function to truncate long filenames
// Strip terminal-control and bidi-override codepoints before any
// clipboard write. Keeps tab and newline. Defends against a
// compromised dictation-regex CSV (F-51) and any other path that
// concatenates upstream text into the clipboard payload.
function sanitizeClipboardText(s) {
  return String(s ?? '').replace(
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f‪-‮⁦-⁩​-‏]/g,
    ''
  );
}

// Cap for any operator-supplied file fetched from a same-origin served
// directory (dictation-regex CSVs, boost-phrase TXTs). F-102: a poisoned
// upstream that fed the entrypoint a multi-GB body would otherwise OOM the
// tab when we call .text() with no cap. The entrypoint enforces the same
// cap server-side (defense in depth); this re-enforces it client-side
// because a host-side write to /var/regex or /var/boost can bypass that.
const SERVED_FILE_MAX_BYTES = 5 * 1024 * 1024;

// Sentinel for the boost-phrase source selector meaning "the user's own
// manually-typed text" rather than one of the operator-supplied files. Not a
// valid manifest entry (those all end in .txt), so it can never collide.
const BOOST_SOURCE_CUSTOM = '__custom__';

// Normalise a curated-list name to a manifest entry: manifest entries all end
// in `.txt`, so a bare name (e.g. "medical", as supplied via the
// ?phrase_boost= query param or the VITE_PHRASE_BOOST_DEFAULT env default) gets
// the extension appended. Returns null for an empty/blank value, and passes the
// Custom sentinel through untouched so ?phrase_boost=__custom__ forces manual
// entry. Validation against the actual served files happens later (boost-init),
// so an unknown name simply falls back to Custom rather than erroring.
function normalizeBoostName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name) return null;
  if (name === BOOST_SOURCE_CUSTOM) return name;
  return name.endsWith('.txt') ? name : `${name}.txt`;
}

// A ?phrase_boost=<name> query param lets a shareable link pre-select a curated
// boost list for first-time visitors. Read once at module load (the query
// string doesn't change within a session). Per the product decision it does NOT
// override a returning user's saved boost choice; it only seeds the default when
// none is saved. See the settings-load and boost-init effects.
const URL_PHRASE_BOOST = typeof window !== 'undefined'
  ? normalizeBoostName(new URLSearchParams(window.location.search).get('phrase_boost'))
  : null;

// Debounce (ms) before rebuilding the boosting trie after the phrase text
// changes. Pasting or fast-typing a large list (10k-100k phrases) would
// otherwise trigger an encode per keystroke; we wait for the input to settle.
const BOOST_REBUILD_DEBOUNCE_MS = 300;

// Phrase count past which a rebuild is slow enough to warrant the header
// spinner. Lists below this encode in a few ms, so showing a spinner would
// only flicker; above it the user benefits from knowing to wait.
const BOOST_SPINNER_MIN_PHRASES = 500;

// Byte cap for a server-prebuilt boost encoding (token ids). Larger than the
// 5 MB text cap because the encoded JSON of a 100k-phrase list is bigger than
// its source text; oversize just falls back to encoding the .txt in-browser.
const BOOST_PREBUILT_MAX_BYTES = 64 * 1024 * 1024;

// Phrase count past which a *served* (non-Custom) list is collapsed to a
// read-only summary instead of being dumped into the editable textarea. A
// curated list this large (e.g. a 60k-line medical lexicon) is never hand
// edited, and rendering it in a controlled textarea makes the field scroll and
// the whole sidebar lag (every re-render re-passes the giant string). The text
// still lives in `boostPhrases` for the rebuild/prebuilt path; we just don't
// render it. Custom text is always editable regardless of size.
const BOOST_COLLAPSE_MIN_PHRASES = 100;

// RAM cutoff (in GB) below which a device is treated as low-memory. The model
// needs ~100-200 MB plus runtime overhead; below 3 GB the tab is at risk.
// Shared by the low-RAM backend/model-load guard (isLowRam) and the default
// beam-width tier below.
const RAM_THRESHOLD_GB = 3;
const RAM_THRESHOLD_BYTES = RAM_THRESHOLD_GB * 1024 * 1024 * 1024;

// Phones/tablets: weak enough to warrant the lightest beam default and the
// low-RAM model-load warning. Shared by both.
const MOBILE_UA_RE = /Android|iPhone|iPad|iPod/i;

// Default beam-search width, chosen by device tier. Beam search costs ~Nx the
// decode, so weaker devices get a lighter default: phones (1), low-RAM
// computers (2), everything else (5). Phone UA is checked first so a low-RAM
// phone still gets 1 rather than the 2 the RAM tier would give. Detection
// mirrors the isLowRam heuristic (heap limit, then deviceMemory). Users can
// still override via the slider.
function defaultBeamWidth() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (MOBILE_UA_RE.test(ua)) return 1;
  const heapLimit = typeof performance !== 'undefined' ? performance?.memory?.jsHeapSizeLimit : undefined;
  if (heapLimit !== undefined) return heapLimit < RAM_THRESHOLD_BYTES ? 2 : 5;
  const mem = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined;
  if (mem !== undefined) return mem < RAM_THRESHOLD_GB ? 2 : 5;
  return 5;
}
const DEFAULT_BEAM_WIDTH = defaultBeamWidth();

// Fetch text from `url`, streaming and aborting if the body exceeds
// `maxBytes`. Returns {ok:true, text} on success, {ok:false, status} for a
// non-2xx response, or {ok:false, oversize:true, declared} when the body is
// too large (declared = the byte count that tripped the cap). Shared by the
// dictation-regex and boost-phrase loaders.
async function fetchTextCapped(url, maxBytes = SERVED_FILE_MAX_BYTES) {
  const res = await fetch(url);
  if (!res.ok) return { ok: false, status: res.status };
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { res.body?.cancel(); } catch (_) { /* noop */ }
    return { ok: false, oversize: true, declared };
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > maxBytes) {
      return { ok: false, oversize: true, declared: text.length };
    }
    return { ok: true, text };
  }
  let total = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { reader.cancel(); } catch (_) { /* noop */ }
      return { ok: false, oversize: true, declared: total };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
  return { ok: true, text: new TextDecoder('utf-8').decode(merged) };
}

// Sanitise an arbitrary device-supplied string before rendering it in
// the UI. WebHID productName comes from the USB descriptor and is
// trivially spoofable by a hostile USB device or a Bad-USB tool. A
// U+202E RLO override could make "SpeechMike" visually swap suffixes
// at render-time, fooling a user who reads the UI label to confirm
// they paired the right device (F-52). Strip control bytes and bidi
// codepoints, length-cap so a hostile device cannot fill the UI with
// a runaway productName.
function sanitizeDeviceName(s, fallback = 'Dictation device') {
  if (typeof s !== 'string' || !s.length) return fallback;
  const cleaned = s.replace(
    /[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/g,
    ''
  ).trim().slice(0, 64);
  return cleaned || fallback;
}

function truncateFilename(filename, maxLength = 40) {
  if (!filename) return '';
  if (filename.length <= maxLength) return filename;
  
  const extension = filename.split('.').pop();
  const nameWithoutExt = filename.slice(0, filename.lastIndexOf('.'));
  const availableLength = maxLength - extension.length - 4; // -4 for "..." and "."
  
  if (availableLength <= 10) return filename; // Too short to truncate meaningfully
  
  const halfLength = Math.floor(availableLength / 2);
  const start = nameWithoutExt.slice(0, halfLength);
  const end = nameWithoutExt.slice(-halfLength);
  
  return `${start}[...]${end}.${extension}`;
}

export default function App() {
  const { t, lang } = useI18n();
  const repoId = CONFIG.VITE_MODEL_REPO || 'Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx';
  // Where model weights are served from:
  //   'hf'    : HuggingFace only (default)
  //   'local' : instance-served /models/ only (skip HF entirely)
  //   'both'  : HF first, silent fallback to /models/ if HF is unreachable
  const rawModelSource = (CONFIG.VITE_MODEL_SOURCE || 'hf').toLowerCase();
  const modelSource = (rawModelSource === 'local' || rawModelSource === 'both') ? rawModelSource : 'hf';
  const forceLocalFallback = modelSource === 'local';
  const localFallbackEnabled = modelSource === 'local' || modelSource === 'both';
  // Warning message when local fallback is enabled but model files are missing
  const [fallbackWarning, setFallbackWarning] = useState(null);
  // Corrupt-cached-model recovery. A cached weight file that fails ONNX
  // deserialization at session-create time is evicted + re-downloaded once,
  // silently. The ref counts recoveries across this whole browser session;
  // from the second one on we surface `modelCorruptionWarning` because a repeat
  // points at unreliable storage (failing disk, AV interference, bad quota)
  // rather than a one-off truncated download.
  const modelCorruptionRecoveriesRef = useRef(0);
  const [modelCorruptionWarning, setModelCorruptionWarning] = useState(null);
  // Human-readable reason the last model load failed, shown under the "Failed"
  // status so the user can tell WHY (e.g. fp32 requested on WASM but no shards
  // are hosted) instead of being silently downgraded to a different quant.
  const [modelLoadError, setModelLoadError] = useState(null);
  const [backend, setBackend] = useState('wasm');
  // Encoder precision for the WASM/CPU backend: 'int8' (default; ~600 MB, fast,
  // good quality on long audio with the SmoothQuant encoder) or 'fp32' (sharded
  // ~2.4 GB, full quality, ~2x slower). fp32 is opt-in: only honoured when the
  // repo actually ships the fp32 shards, else hub.js falls back to int8
  // (resolveModelQuant). Ignored on WebGPU, which has its own fp16/fp32 selection.
  const [wasmEncoderQuant, setWasmEncoderQuant] = useState('int8');
  // Encoder precision for the WebGPU backend: 'fp16' (default; ~1.2 GB,
  // near-lossless, fast) or 'fp32' (~2.4 GB, full quality, ~2x slower). int8 is
  // not offered here: the GPU EP has no int8 encoder kernel. Resolved against
  // what the repo ships by resolveModelQuant (fp16 needs encoder-model.fp16.onnx,
  // else it falls back to fp32). Ignored on WASM, which uses wasmEncoderQuant.
  const [webgpuEncoderQuant, setWebgpuEncoderQuant] = useState('fp16');
  // WebGPU availability. `navigator.gpu` existing isn't enough: an adapter may
  // still be unavailable (blocklisted GPU, headless Chromium, etc.), so we
  // actually request one. null = still probing, true/false = resolved.
  const [webgpuAvailable, setWebgpuAvailable] = useState(null);
  // Why WebGPU is unavailable, so the UI can explain the grey-out instead of
  // showing a bare "(unavailable)". null while probing/available, else one of
  // 'insecure' (not an https/localhost context), 'unsupported' (no
  // navigator.gpu, e.g. Firefox today) or 'noAdapter' (requestAdapter failed,
  // e.g. blocklisted GPU or hardware acceleration off).
  const [webgpuUnavailableReason, setWebgpuUnavailableReason] = useState(null);
  // Whether the WebGPU adapter exposes the `shader-f16` feature. fp16 WGSL
  // kernels only compile with it; without it the fp16 encoder builds but emits
  // an empty transcript, so we resolve fp16 -> fp32 and grey out the fp16 radio.
  // null = unknown (still probing, or no adapter) -> assume supported; once an
  // adapter resolves it is true/false. Only an explicit false blocks fp16.
  const [webgpuShaderF16, setWebgpuShaderF16] = useState(null);
  // Tracks whether the backend reflects an explicit choice (restored from a
  // saved setting or picked in the UI) vs. our automatic default. The RAM-based
  // default heuristic only applies when this is false.
  const backendChosenByUserRef = useRef(false);
  const chooseBackend = (value) => {
    backendChosenByUserRef.current = true;
    setBackend(value);
  };
  const [memoryInfo, setMemoryInfo] = useState(null);
  const [, startTransition] = useTransition();
  const [preprocessor, setPreprocessor] = useState('nemo128');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(null);
  // EMA state for the download speed / ETA estimate, reset per model load.
  const downloadRateRef = useRef(null);
  const [text, setText] = useState('');
  const [latestMetrics, setLatestMetrics] = useState(null);
  const [transcriptions, setTranscriptions] = useState([]);
  // Track the most recently added transcription ID for fade-in animation
  const newestTranscriptionIdRef = useRef(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [verboseLog, setVerboseLog] = useState(false);
  const [frameStride, setFrameStride] = useState(1);
  // Beam search width. 1 = greedy (default, fastest, behavior unchanged). Higher
  // widths explore alternative hypotheses (~Nx decode cost) and let phrase
  // boosting recover phrases greedy would prune. Full-file only: the streaming
  // path forces width 1 in the decoder.
  const [beamWidth, setBeamWidth] = useState(DEFAULT_BEAM_WIDTH);
  // MAES (Modified Adaptive Expansion Search) knobs, used only when beamWidth>1.
  // Defaults match NeMo's `maes` strategy.
  const [maesNumSteps, setMaesNumSteps] = useState(3);
  const [maesExpansionBeta, setMaesExpansionBeta] = useState(4);
  const [maesExpansionGamma, setMaesExpansionGamma] = useState(4.0);
  const [maesPrefixAlpha, setMaesPrefixAlpha] = useState(1);
  // Chunking: split long audio into smaller segments before transcribing
  const [enableChunking, setEnableChunking] = useState(true);
  const [chunkDuration, setChunkDuration] = useState(DEFAULT_CHUNK_DURATION_SEC); // seconds
  // Live (streaming) transcription: re-runs the model on a sliding window
  // every few seconds while recording. The canonical stop-pass still runs.
  const [liveTranscriptionEnabled, setLiveTranscriptionEnabled] = useState(false);
  const [liveContextWindow, setLiveContextWindow] = useState('auto'); // 'auto' | '10'..'60'
  const [liveTranscript, setLiveTranscript] = useState({ text: '', words: [] });
  const [liveStats, setLiveStats] = useState(null);
  const liveTranscriberRef = useRef(null);
  // Refs mirror the state so stable callbacks (RTC data-channel handler,
  // built once per session) read the latest user setting.
  const liveTranscriptionEnabledRef = useRef(false);
  const liveContextWindowRef = useRef('auto');
  // Phrase boosting (context biasing): the user lists phrases to bias the
  // greedy decoder toward (PLAN.md). `boostPhrases` is the raw textarea text
  // (one phrase per line, optional `phrase:WEIGHT`); `boostStrength` is the
  // global multiplier (0 disables). The built BoostingTrie lives in a ref so
  // we rebuild it only when the phrase text changes (not on every keystroke of
  // unrelated state), and the strength slider just mutates trie.strength.
  const [boostPhrases, setBoostPhrases] = useState('');
  const [boostStrength, setBoostStrength] = useState(1);
  // Global default for surface-form augmentation (OFF by default): when ON, each
  // typed phrase is expanded with the full FULL_AUGMENT set (Title Case, ALL
  // CAPS, proclitic prefixes) before encoding, so e.g. "venlafaxine" also boosts
  // "Venlafaxine"/"VENLAFAXINE" and "amoxicilline" also boosts "l'amoxicilline"
  // (the BPE encoder is case-sensitive, so each form is a distinct token
  // sequence / trie branch). A per-phrase `:AUG` suffix overrides this. See
  // expandAugmentations.
  const [boostAugment, setBoostAugment] = useState(false);
  const [boostWarnings, setBoostWarnings] = useState([]); // [{phrase}] with out-of-range weight
  const [boostUnkWarnings, setBoostUnkWarnings] = useState([]); // phrases dropped: encode to <unk> (e.g. CJK)
  // True while a long phrase list is (re)encoding+building so the header status
  // shows a spinner; only set for lists past BOOST_SPINNER_MIN_PHRASES so a
  // small edit never flashes it (small lists rebuild in a few ms).
  const [boostRebuilding, setBoostRebuilding] = useState(false);
  const phraseBoostRef = useRef(null);   // BoostingTrie | null (null = inert)
  const boostStrengthRef = useRef(1);
  // Vocab signature of the currently loaded tokenizer (null when no model is
  // loaded). This is the *only* model-side input the boost-trie rebuild needs:
  // it changes when (and only when) the model's vocab does, so the rebuild
  // effect keys on it instead of `status`. Keying on `status` was the bug
  // behind the "My Computer tab frozen on load": `status` also flips on every
  // recording start/stop, file transcribe, and even each chunk-progress tick
  // (setStatus with a percentage string), and each flip re-ran the heavy
  // parseBoostPhrases + trie rebuild and pushed fresh boost-warning arrays that
  // forced the giant phrase-list textarea to reconcile. Now the rebuild fires
  // once per real model change, not once per status string.
  const [tokenizerVocabSig, setTokenizerVocabSig] = useState(null);
  // Current verbose-logging flag for use inside the debounced rebuild closure
  // (which captures a stale `verboseLog`); synced by the effect below.
  const verboseLogRef = useRef(false);
  // Operator-supplied phrase lists (BOOST_PHRASES_SOURCE -> /boost-phrases/).
  // `boostFiles` is the manifest filenames; when non-empty the UI shows a
  // selector. `boostSource` is the current choice: the BOOST_SOURCE_CUSTOM
  // sentinel (user-typed text) or one of the filenames. `boostCustomText`
  // preserves the user's own text so switching to a file and back never
  // loses it; it is persisted across sessions.
  const [boostFiles, setBoostFiles] = useState([]);
  const [boostFilesLoaded, setBoostFilesLoaded] = useState(false);
  const [boostSource, setBoostSource] = useState(BOOST_SOURCE_CUSTOM);
  const [boostCustomText, setBoostCustomText] = useState('');
  const boostCustomTextRef = useRef('');
  // Server-prebuilt encoding for the currently selected bundled list, or null.
  // { text, vocabSig, encoded, skipped }: `text` is the exact list text it was
  // built from, so the rebuild effect only trusts it while the textarea is
  // unedited and `vocabSig` matches the loaded tokenizer (else it re-encodes).
  const prebuiltBoostRef = useRef(null);
  // Cached BPE encoder, tied to the tokenizer it was built from so a model
  // swap (different vocab) rebuilds it. { tokenizer, encoder } | null. Only used
  // by the main-thread fallback when the encode worker is unavailable.
  const bpeEncoderRef = useRef(null);
  // Encode worker (lazy): offloads the heavy BPE tokenization of the boost
  // phrase list off the main thread. `undefined` = not yet created, `null` =
  // creation failed (fall back to main-thread encode). `boostReqIdRef` tags each
  // request so a superseded reply (after a debounce/model-swap race) is ignored.
  const boostWorkerRef = useRef(undefined);
  const boostReqIdRef = useRef(0);
  const maxCores = navigator.hardwareConcurrency || 8;
  // Default to all available CPU cores for best transcription throughput
  const [cpuThreads, setCpuThreads] = useState(maxCores);
  const modelRef = useRef(null);
  const fileInputRef = useRef(null);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false); // pause/resume support for long recordings
  const [recordingCountdown, setRecordingCountdown] = useState(null);
  const [mediaRecorder, setMediaRecorder] = useState(null); // legacy name kept for stopRecording guard
  // pcmChunksRef holds slab objects of the form `{ buf, used }` where `buf`
  // is a Float32Array backing buffer and `used` is the count of valid
  // samples written into it. The worklet emits 128-sample frames at the
  // mic sample rate (~375/sec at 48 kHz), so collecting them as separate
  // Float32Arrays would allocate ~1.35M ArrayBuffers per hour — same raw
  // byte size, but enormous allocator overhead and GC churn that
  // contributed to long-recording crashes. Slabbing them into ~1 MB
  // chunks keeps the object count under a few hundred per hour.
  const pcmChunksRef = useRef([]);
  const PCM_SLAB_SAMPLES = 1 << 18; // 262144 samples (~5.4s @ 48 kHz, ~2.7s @ 96 kHz)
  // Hard cap on remote-mic PCM sample accumulation. A compromised phone that
  // completes the handshake but never sends `audio-end` would otherwise grow
  // pcmChunksRef without bound and OOM the tab. 10 minutes at the highest
  // accepted sample rate (96 kHz) is the safety ceiling; in normal use the
  // phone streams at 48 kHz so the real-time ceiling is ~20 minutes.
  const REMOTE_MIC_MAX_SAMPLES = 10 * 60 * 96000;
  // Hard cap on local-mic accumulation. At 96 kHz this is 90 min (~518 MB
  // of raw float32 audio); at the typical 48 kHz mic rate it's ~3 hours.
  // Past this point continuing to grow the buffer risks crashing the tab,
  // so we stop the recording and surface an alert instead.
  const LOCAL_RECORDING_MAX_SAMPLES = 90 * 60 * 96000;
  const remoteMicSampleCountRef = useRef(0);
  // F-82: serialises processRemoteMicBatch invocations triggered by
  // back-to-back phone audio-end messages, so concurrent transcribe()
  // calls don't race on the shared ORT session and corrupt the user's
  // transcript history. Holds the in-flight Promise, or null.
  const inFlightBatchRef = useRef(null);
  // F-81 / F-84: tracks whether the phone has sent a valid audio-config
  // for the CURRENT recording session. Reset by processRemoteMicBatch
  // (after audio-end drains chunks) so each new recording starts a fresh
  // sample-rate negotiation. A second audio-config mid-stream is a
  // protocol violation that we close the channel on, rather than letting
  // it silently switch the resampler's source rate.
  const remoteMicAudioConfiguredRef = useRef(false);
  const clearPcmChunks = () => {
    pcmChunksRef.current = [];
    remoteMicSampleCountRef.current = 0;
    remoteMicAudioConfiguredRef.current = false;
  };
  // Append a Float32Array chunk into the slab list. Copies the data into
  // the current slab (allocating a new one when full), so callers may
  // safely reuse or discard the source buffer afterwards.
  const appendPcmChunk = (chunk) => {
    if (!chunk || chunk.length === 0) return;
    const slabs = pcmChunksRef.current;
    let writePos = 0;
    while (writePos < chunk.length) {
      let last = slabs[slabs.length - 1];
      if (!last || last.used >= last.buf.length) {
        // Size the slab generously enough to swallow the incoming chunk
        // even if it's larger than the default slab (remote-mic chunks
        // can be hundreds of ms long).
        const slabSize = Math.max(PCM_SLAB_SAMPLES, chunk.length - writePos);
        last = { buf: new Float32Array(slabSize), used: 0 };
        slabs.push(last);
      }
      const room = last.buf.length - last.used;
      const take = Math.min(room, chunk.length - writePos);
      last.buf.set(chunk.subarray(writePos, writePos + take), last.used);
      last.used += take;
      writePos += take;
    }
  };
  const getTotalPcmSamples = () => {
    const slabs = pcmChunksRef.current;
    let n = 0;
    for (const s of slabs) n += s.used;
    return n;
  };
  // Build one contiguous Float32Array from the slabs. Used at recording
  // stop to produce the canonical full-audio buffer.
  const concatPcmChunks = () => {
    const slabs = pcmChunksRef.current;
    const total = getTotalPcmSamples();
    const out = new Float32Array(total);
    let offset = 0;
    for (const s of slabs) {
      out.set(s.buf.subarray(0, s.used), offset);
      offset += s.used;
    }
    return out;
  };
  const workletNodeRef = useRef(null);   // AudioWorkletNode for cleanup
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioContext, setAudioContext] = useState(null);
  // True from the moment recording stops until the final transcription is
  // displayed. Keeps the live transcript and a status indicator on screen so
  // the UI never appears to freeze while audio is being assembled / decoded
  // and the model is running its canonical pass.
  const [awaitingFinal, setAwaitingFinal] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [echoCancellation, setEchoCancellation] = useState(false);
  const [autoGainControl, setAutoGainControl] = useState(true);
  // Linear gain multiplier applied on the phone before audio leaves the
  // device. Only affects the remote mic path; the local mic doesn't use
  // it. Default 2.0 because phones tend to under-amplify voice once
  // their AGC kicks in.
  const [remoteMicGain, setRemoteMicGain] = useState(2.0);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copiedHistoryId, setCopiedHistoryId] = useState(null);

  // Remote microphone state
  const [isRemoteMic, setIsRemoteMic] = useState(false);
  const [remoteMicModal, setRemoteMicModal] = useState(false);
  const [remoteMicStatus, setRemoteMicStatus] = useState(''); // connecting|waiting|connected|stopped|error
  const [remoteMicQrUrl, setRemoteMicQrUrl] = useState('');
  const [remoteMicLevel, setRemoteMicLevel] = useState(0);
  const [remoteMicElapsed, setRemoteMicElapsed] = useState(0);
  const [remoteMicError, setRemoteMicError] = useState('');
  const [remoteMicDecryptErrors, setRemoteMicDecryptErrors] = useState(0);
  const [remoteMicPaused, setRemoteMicPaused] = useState(false);
  const [remoteMicRecording, setRemoteMicRecording] = useState(false);
  const remoteMicRtcRef = useRef(null);
  const remoteMicKeyRef = useRef(null);
  const remoteMicSampleRateRef = useRef(16000);
  // Wire format of incoming binary chunks for the current recording. Set
  // from the audio-config message: 'pcm-s16' (Int16, ~v5.4.6+ phone) or
  // 'pcm-f32' (legacy Float32). Defaults to 'pcm-f32' so a phone running
  // an older bundle still works after this desktop upgrade.
  const remoteMicFormatRef = useRef('pcm-f32');
  const remoteMicTimerRef = useRef(null);
  const remoteMicQrRef = useRef(null); // DOM ref for QR code container
  // Fingerprint compare modal: shown after both ECDH public keys are exchanged
  // and before any encrypted audio is processed. Mitigates a malicious
  // signaling server that could swap keys to MITM the data channel.
  const [remoteMicFingerprint, setRemoteMicFingerprint] = useState('');
  // Timestamp of the most-recent successful fingerprint confirmation. The
  // sharedKey lives for the lifetime of the WebRTC connection across many
  // Start/Stop cycles; this surfaces that fact to the user so they
  // understand they are NOT re-verifying per recording. F-68: re-verifying
  // requires disconnecting the phone and re-pairing via fresh QR.
  const [remoteMicVerifiedAt, setRemoteMicVerifiedAt] = useState(null);
  const remoteMicVerifyResolveRef = useRef(null); // (boolean) => void
  // F-63: bilateral verify-ok ack. After local user confirms the fingerprint
  // we still wait for the peer's verify-ok before transitioning to the
  // operational ('connected') state. Otherwise an attacker who controls one
  // side (or a flaky network) could leave one peer streaming audio into a
  // half-aborted session: the local side believes verification succeeded
  // even though the remote user actually denied (or never responded).
  // Waiting for the explicit peer ack collapses that ambiguous window.
  const remoteMicPeerAckResolveRef = useRef(null); // (boolean) => void
  // Buffer for a peer verify-ok/deny that arrives BEFORE the local user
  // clicks confirm on the fingerprint modal. Whichever peer confirms first
  // sends verify-ok while the other is still staring at the modal; without
  // this buffer that early message hits the peer-ack handler with no
  // resolver armed yet, gets discarded as "stray", and the locally-late
  // peer then waits 60s for a message that already arrived. Values: true
  // (peer sent verify-ok), false (peer sent verify-deny), null (no early
  // arrival). Cleared on every handshake start/teardown via
  // resolveRemoteMicPeerAck so a fresh re-pair never inherits stale state.
  const remoteMicEarlyPeerVerifyRef = useRef(null);
  // F-137: synchronous handshake-in-progress flag. The duplicate-handshake
  // guard at the top of the 'sender-public-key' branch checks
  // remoteMicKeyRef / remoteMicVerifyResolveRef, but those refs are only
  // populated AFTER several awaits (importPublicKey, deriveSharedKey,
  // getAdaptiveFingerprintLength, computePairFingerprintForRole). A
  // malicious phone that sends two sender-public-key messages back-to-back
  // would see both pass the guard, both compute fingerprints, and the
  // second assignment to verifyResolveRef.current would clobber the first
  // resolver, orphaning the first ECDH closure. Setting this ref to true
  // synchronously before the first await closes that multi-await window.
  const remoteMicHandshakeInProgressRef = useRef(false);
  // Resolve any in-flight fingerprint verify and null the ref. Every teardown
  // path (onDisconnected, cancelRemoteMic, regenerateRemoteMicQr,
  // disconnectRemoteMic) must call this so the awaiting Promise inside
  // startRemoteMic doesn't hang and pin the ECDH private key in a dead
  // closure (a slow memory-pressure DoS if the attacker stacks attempts).
  const resolveRemoteMicVerify = useCallback((confirmed) => {
    if (remoteMicVerifyResolveRef.current) {
      remoteMicVerifyResolveRef.current(confirmed);
      remoteMicVerifyResolveRef.current = null;
    }
  }, []);
  const resolveRemoteMicPeerAck = useCallback((confirmed) => {
    if (remoteMicPeerAckResolveRef.current) {
      remoteMicPeerAckResolveRef.current(confirmed);
      remoteMicPeerAckResolveRef.current = null;
    }
    remoteMicEarlyPeerVerifyRef.current = null;
    // F-137: every teardown path funnels through here (onDisconnected,
    // cancelRemoteMic, regenerateRemoteMicQr, disconnectRemoteMic), so
    // clearing the handshake-in-progress flag here lets a re-pair claim
    // a fresh slot. The success path clears it explicitly after binding.
    remoteMicHandshakeInProgressRef.current = false;
  }, []);

  // Tiny helpers so the elapsed-timer setup/teardown is in one place — used to
  // be inlined ~7 times across the remote-mic flow which made changes risky.
  const stopRemoteMicTimer = useCallback(() => {
    if (remoteMicTimerRef.current) {
      clearInterval(remoteMicTimerRef.current);
      remoteMicTimerRef.current = null;
    }
  }, []);
  const startRemoteMicTimer = useCallback(() => {
    stopRemoteMicTimer();
    const startTime = Date.now();
    remoteMicTimerRef.current = setInterval(() => {
      setRemoteMicElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
  }, [stopRemoteMicTimer]);

  // Load QR code library when remote mic modal opens; returns a promise that resolves when ready.
  // qrLibRef captures the library object at the moment SRI-validated script
  // execution finishes, so subsequent uses no longer probe `window.QRCode`.
  // That global lookup is DOM-clobberable (an injected element with id or
  // name "QRCode" would shadow it); reading once after onload eliminates
  // the surface even before CSP lands.
  const qrLibRef = useRef(null);
  const loadQRCode = useRef(null);
  if (!loadQRCode.current) {
    loadQRCode.current = new Promise((resolve, reject) => {
      if (qrLibRef.current) { resolve(); return; }
      const script = document.createElement('script');
      script.src = '/js/qrcode.min.js';
      // SRI hash of app/ui/public/js/qrcode.min.js. If you replace that
      // file, recompute with: openssl dgst -sha384 -binary <file> | base64
      script.integrity = 'sha384-HGmnkDZJy7mRkoARekrrj0VjEFSh9a0Z8qxGri/kTTAJkgR8hqD1lHsYSh3JdzRi';
      script.crossOrigin = 'anonymous';
      // Wall-clock timeout: a network attacker who holds the script TCP
      // connection open without sending the close-of-body byte (slowloris)
      // would otherwise pin this Promise forever, hanging every consumer
      // of loadQRCode.current and breaking QR display until page reload.
      // 15 s is well past a normal LAN/WAN fetch of a ~10 KB script.
      let settled = false;
      const settle = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
      const timer = setTimeout(() => settle(() => {
        loadQRCode.current = null; // allow next attempt to retry the load
        reject(new Error('QR script load timed out'));
      }), 15000);
      script.onload = () => settle(() => {
        qrLibRef.current = window.QRCode;
        console.log('[RemoteMic] QR code library loaded');
        setTimeout(resolve, 0);
      });
      script.onerror = (e) => settle(() => {
        loadQRCode.current = null;
        reject(new Error('QR script load error'));
      });
      document.head.appendChild(script);
    });
    // Swallow unhandled-rejection noise from the load Promise itself; the
    // consumers attach their own .catch handlers where they care.
    loadQRCode.current.catch(() => {});
  }

  // Render QR code when both the URL is set and the DOM ref is available (status===waiting)
  useEffect(() => {
    if (!remoteMicQrUrl || remoteMicStatus !== 'waiting') return;
    loadQRCode.current.then(() => {
      if (remoteMicQrRef.current && qrLibRef.current) {
        const canvas = document.createElement('canvas');
        qrLibRef.current.toCanvas(canvas, remoteMicQrUrl, {
          width: 220,
          margin: 2,
          errorCorrectionLevel: 'M',
        }).then(() => {
          if (remoteMicQrRef.current) {
            // Clear previous QR (if any) and swap in the new canvas atomically.
            remoteMicQrRef.current.innerHTML = '';
            remoteMicQrRef.current.appendChild(canvas);
          }
        });
      }
    }).catch(err => {
      console.warn('[RemoteMic] QR library unavailable, skipping QR render:', err.message);
    });
  }, [remoteMicQrUrl, remoteMicStatus]);

  // F-127: when any modal is foregrounded, disable per-history kebab actions
  // so an extension keystroke-injection (Tab + Enter while a modal is open)
  // cannot drive clipboard exfiltration via the per-entry Copy buttons.
  const anyModalOpen = useAnyModalOpen();

  // Tracks which history item has its kebab menu open (by transcription id)
  const [openKebabId, setOpenKebabId] = useState(null);
  // Close any open kebab dropdown when a modal mounts so its inner Copy
  // buttons are not reachable by Tab+Enter from inside the modal.
  useEffect(() => { if (anyModalOpen) setOpenKebabId(null); }, [anyModalOpen]);

  // Per-entry display mode override (id -> 'raw'|'confidence'|'dictation').
  // Entries default to the global `transcriptDisplayMode` (the "default
  // transcript display" setting) until the user toggles them individually.
  const [entryDisplayModes, setEntryDisplayModes] = useState({});
  // Set of transcription ids whose inline audio player is expanded.
  const [openAudioIds, setOpenAudioIds] = useState(() => new Set());
  // Id of the entry currently being re-transcribed via "Transcribe again", so
  // its button can show a spinner. Only one runs at a time (isTranscribing).
  const [reTranscribingId, setReTranscribingId] = useState(null);
  // Lazily-created object URLs for the inline players (id -> url). Kept in a ref
  // so we can revoke them on close/delete/unmount without re-rendering.
  const entryAudioUrlsRef = useRef(new Map());

  // Tracks which history item is showing its confidence score overlay
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // True once the (potentially large/slow) transcript history has actually been
  // read back into state. The history loads *after* settingsLoaded flips, so the
  // transcript-persist effect must wait on this too: otherwise the early
  // settingsLoaded=true would let it write the still-empty array over the
  // on-disk history before the read resolves. See the load effect below.
  const transcriptsRestoredRef = useRef(false);
  const [showConfidenceHeatmap, setShowConfidenceHeatmap] = useState(false);
  // Auto-copy: when enabled, every transcription is written to the system
  // clipboard. F-125: default OFF so the headline "audio never leaves your
  // device" promise also holds for transcript text. The system clipboard is
  // readable by any other app and by browser extensions that hold
  // clipboardRead for any other site (Permissions-Policy on this origin
  // does not constrain extension content-scripts), so the privacy contract
  // is broken if this defaults on. Users who want auto-copy must opt in.
  const [autoCopyToClipboard, setAutoCopyToClipboard] = useState(false);
  // Opt-in transcript persistence. Default OFF for new installs (privacy-first
  // baseline matching the headline "audio never leaves your device" promise:
  // memory-only by default). Existing users with on-disk transcripts at the
  // time of upgrade get true so we don't silently abandon their history.
  // F-55: see app/src/idb.js comments re LevelDB residue surviving a logical
  // clear; this gate stops the write in the first place.
  const [persistTranscripts, setPersistTranscripts] = useState(false);
  // About modal visibility
  const [showAbout, setShowAbout] = useState(false);
  // Show advanced info: memory/heap counters, audio metadata, transcription performance stats
  const [showAdvancedInfo, setShowAdvancedInfo] = useState(false);
  // Global keyboard shortcuts (R/S/F/Space/Enter for record/settings/file/load).
  // Default OFF: the single-letter bindings fire on any keypress outside an
  // input, which surprises users who expect plain typing/navigation. Opt in
  // from Settings.
  const [keyboardShortcutsEnabled, setKeyboardShortcutsEnabled] = useState(false);

  // Dictation device (Philips SpeechMike) — WebHID connection state
  const [dictationDevice, setDictationDevice] = useState(null); // connected device name or null
  const dictationManagerRef = useRef(null);
  // True when we detect a SpeechMike-like audio input device on a browser
  // without WebHID support (e.g. Firefox, Safari). The user can still record
  // with it as a plain mic, but the physical buttons won't work, so we
  // surface a banner telling them to switch to a Chromium browser.
  const [dictationSuspectedNoWebhid, setDictationSuspectedNoWebhid] = useState(false);

  // Dictation regex post-processing
  // Display mode: 'raw' = plain transcription, 'confidence' = with heatmap, 'dictation' = regex-cleaned
  const [transcriptDisplayMode, setTranscriptDisplayMode] = useState('raw');
  const [dictationRegexRules, setDictationRegexRules] = useState([]); // [{regex, replacement, source}]
  const [dictationRegexLoaded, setDictationRegexLoaded] = useState(false);
  // Track which transcriptions have had dictation applied (id -> cleaned text)
  const [dictationCache, setDictationCache] = useState({});

  // Ask the browser to keep our IndexedDB (where the multi-GB model weights
  // live) in the persistent bucket so it is not evicted under disk pressure.
  // Eviction is the real reason a cached model gets re-downloaded "after an
  // update": the version-mismatch purge only clears the settings DB, never the
  // model cache. Fire-and-forget; never blocks boot.
  useEffect(() => {
    requestPersistentStorage().then((persisted) => {
      if (persisted === null) {
        console.log('[App] Persistent storage API unavailable; model cache may be evicted under pressure');
      } else {
        console.log(`[App] Persistent storage ${persisted ? 'granted' : 'NOT granted'} (model cache eviction ${persisted ? 'prevented' : 'still possible'})`);
      }
    });
  }, []);

  // Load settings from IndexedDB on mount
  useEffect(() => {
    // `booted` guards against the watchdog and the real load both finishing the
    // restore. Whichever flips it first wins; the loser bails (so a late real
    // load does not overwrite the defaults the watchdog already booted on).
    let booted = false;
    const watchdog = setTimeout(() => {
      if (booted) return;
      booted = true;
      console.warn(`[App] Settings restore timed out after ${SETTINGS_LOAD_TIMEOUT_MS}ms `
        + `(IndexedDB likely blocked by another tab holding a versionchange); `
        + `booting on defaults. Saved preferences were not applied this session.`);
      setSettingsLoaded(true);
    }, SETTINGS_LOAD_TIMEOUT_MS);

    async function loadSettings() {
      try {
        // Check version first - purge old data if version mismatch
        const storedVersion = await loadSetting('version', null);
        if (booted) return; // watchdog already booted on defaults; skip late restore

        if (!storedVersion || storedVersion !== VERSION) {
          console.log(`[App] Version mismatch (stored: ${storedVersion}, current: ${VERSION}). Purging old data...`);
          await clearAllSettings();
          await saveSetting('version', VERSION);
          if (booted) return;
          booted = true;
          clearTimeout(watchdog);
          // Set defaults without loading old values
          setSettingsLoaded(true);
          return;
        }

        // Fast phase: the scalar settings are tiny reads loaded together. The
        // transcript history (potentially large/slow) is deliberately NOT in
        // this batch; it loads last, after the app boots, so it can never delay
        // restore or trip the watchdog.
        const [
          savedBackend,
          savedWasmEncoderQuant,
          savedWebgpuEncoderQuant,
          savedPreprocessor,
          savedVerboseLog,
          savedFrameStride,
          savedBeamWidth,
          savedMaesNumSteps,
          savedMaesExpansionBeta,
          savedMaesExpansionGamma,
          savedMaesPrefixAlpha,
          savedCpuThreads,
          savedNoiseSuppression,
          savedEchoCancellation,
          savedAutoGainControl,
          savedRemoteMicGain,
          savedShowConfidenceHeatmap,
          savedAutoCopyToClipboard,
          savedPersistTranscripts,
          savedShowAdvancedInfo,
          savedKeyboardShortcutsEnabled,
          savedEnableChunking,
          savedChunkDuration,
          savedTranscriptDisplayMode,
          savedLiveTranscriptionEnabled,
          savedLiveContextWindow,
          savedBoostPhrases,
          savedBoostStrength,
          savedBoostSource,
          savedBoostCustomText,
          savedBoostAugment,
          savedBoostCaseInsensitiveLegacy,
        ] = await Promise.all([
          loadSetting('backend', null),
          loadSetting('wasmEncoderQuant', 'int8'),
          loadSetting('webgpuEncoderQuant', 'fp16'),
          loadSetting('preprocessor', 'nemo128'),
          loadSetting('verboseLog', false),
          loadSetting('frameStride', 1),
          loadSetting('beamWidth', DEFAULT_BEAM_WIDTH),
          loadSetting('maesNumSteps', 3),
          loadSetting('maesExpansionBeta', 4),
          loadSetting('maesExpansionGamma', 4.0),
          loadSetting('maesPrefixAlpha', 1),
          loadSetting('cpuThreads', Math.max(1, maxCores - 2)),
          loadSetting('noiseSuppression', true),
          loadSetting('echoCancellation', false),
          loadSetting('autoGainControl', true),
          loadSetting('remoteMicGain', 2.0),
          loadSetting('showConfidenceHeatmap', false),
          loadSetting('autoCopyToClipboard', false),
          // Load with `null` so the F-132 default below can tell "never set"
          // apart from an explicit choice (see the setPersistTranscripts comment).
          loadSetting('persistTranscripts', null),
          loadSetting('showAdvancedInfo', false),
          loadSetting('keyboardShortcutsEnabled', false),
          loadSetting('enableChunking', true),
          // Load with `null` so the restore below can tell "never set" apart from
          // an explicit choice; when never set, chunkDuration keeps its
          // DEFAULT_CHUNK_DURATION_SEC initial value.
          loadSetting('chunkDuration', null),
          loadSetting('transcriptDisplayMode', 'raw'),
          loadSetting('liveTranscriptionEnabled', false),
          loadSetting('liveContextWindow', 'auto'),
          loadSetting('boostPhrases', ''),
          loadSetting('boostStrength', 1),
          // Load with `null` (not the Custom sentinel) so the restore below can
          // tell "user never picked a boost source" apart from "user explicitly
          // chose Custom". Only the former falls back to the ?phrase_boost= param
          // / VITE_PHRASE_BOOST_DEFAULT; an explicit Custom choice is honoured.
          loadSetting('boostSource', null),
          loadSetting('boostCustomText', ''),
          // New "Augment" toggle key; null means never set so the legacy
          // `boostCaseInsensitive` value below can seed it for returning users.
          loadSetting('boostAugment', null),
          loadSetting('boostCaseInsensitive', false),
        ]);
        if (booted) return; // watchdog won while we awaited; skip the stale restore

        // A saved value means the user previously picked a backend explicitly;
        // honour it (subject to the WebGPU-availability override below). When
        // absent, leave `backend` at its initial value so the RAM-based default
        // heuristic can choose once the WebGPU probe resolves.
        if (savedBackend !== null) {
          backendChosenByUserRef.current = true;
          setBackend(savedBackend);
        }
        setWasmEncoderQuant(savedWasmEncoderQuant === 'fp32' ? 'fp32' : 'int8');
        setWebgpuEncoderQuant(savedWebgpuEncoderQuant === 'fp32' ? 'fp32' : 'fp16');
        setPreprocessor(savedPreprocessor);
        setVerboseLog(savedVerboseLog);
        setFrameStride(savedFrameStride);
        setBeamWidth(Number.isInteger(savedBeamWidth) && savedBeamWidth >= 1 ? Math.min(25, savedBeamWidth) : DEFAULT_BEAM_WIDTH);
        setMaesNumSteps(Number.isInteger(savedMaesNumSteps) && savedMaesNumSteps >= 1 ? savedMaesNumSteps : 3);
        setMaesExpansionBeta(Number.isInteger(savedMaesExpansionBeta) && savedMaesExpansionBeta >= 0 ? savedMaesExpansionBeta : 4);
        setMaesExpansionGamma(Number.isFinite(savedMaesExpansionGamma) && savedMaesExpansionGamma > 0 ? savedMaesExpansionGamma : 4.0);
        setMaesPrefixAlpha(Number.isInteger(savedMaesPrefixAlpha) && savedMaesPrefixAlpha >= 0 ? savedMaesPrefixAlpha : 1);
        setCpuThreads(savedCpuThreads);
        setNoiseSuppression(savedNoiseSuppression);
        setEchoCancellation(savedEchoCancellation);
        setAutoGainControl(savedAutoGainControl);
        setRemoteMicGain(Number.isFinite(savedRemoteMicGain) ? savedRemoteMicGain : 2.0);
        setShowConfidenceHeatmap(savedShowConfidenceHeatmap);
        setAutoCopyToClipboard(savedAutoCopyToClipboard);
        // F-132: strict privacy-first default. When the toggle key is null
        // (fresh install, profile import without the toggle, manual DevTools
        // edit that removed only the key) always default to OFF. The prior
        // "resurrect ON when on-disk transcripts exist" branch could
        // silently re-enable persistence on profile-import / dev-preview /
        // stale-leveldb scenarios, contradicting the privacy-first contract.
        // Pre-F-55 users keep their in-memory session for the current page
        // but new transcripts won't persist forward until they opt in
        // explicitly in Settings.
        setPersistTranscripts(savedPersistTranscripts === true);
        setShowAdvancedInfo(savedShowAdvancedInfo);
        setKeyboardShortcutsEnabled(savedKeyboardShortcutsEnabled === true);
        setEnableChunking(savedEnableChunking);
        // A saved value means the user previously picked a chunk window; honour
        // it. When absent, chunkDuration keeps its DEFAULT_CHUNK_DURATION_SEC
        // initial value.
        if (savedChunkDuration != null) setChunkDuration(savedChunkDuration);
        setTranscriptDisplayMode(savedTranscriptDisplayMode);
        setLiveTranscriptionEnabled(savedLiveTranscriptionEnabled);
        setLiveContextWindow(savedLiveContextWindow);
        // Whether the user has an explicit saved boost choice. When they don't
        // (savedBoostSource is null because it was never persisted), the
        // boost-init effect falls back to the ?phrase_boost= param / the
        // VITE_PHRASE_BOOST_DEFAULT env default. An explicit Custom choice is a
        // string, so it sets this true and is honoured (not overridden).
        boostSourceSavedRef.current = typeof savedBoostSource === 'string';
        const restoredSource = typeof savedBoostSource === 'string' ? savedBoostSource : BOOST_SOURCE_CUSTOM;
        // For a curated source, deliberately leave boostPhrases empty here: the
        // one-shot init effect below calls applyBoostSource(), which loads the
        // list's server-prebuilt encoding (.json) into prebuiltBoostRef *before*
        // setting boostPhrases. Seeding it from the saved text now would fire the
        // rebuild effect while prebuiltBoostRef is still null, forcing a full
        // from-scratch BPE re-encode of the whole list (tens of seconds, and
        // UI-freezing on the worker-less fallback path) that the prebuilt exists
        // to avoid; worse, applyBoostSource's later setBoostPhrases(sameText)
        // would be a no-op, so the prebuilt would never get a chance to apply.
        setBoostPhrases(restoredSource === BOOST_SOURCE_CUSTOM && typeof savedBoostPhrases === 'string'
          ? savedBoostPhrases : '');
        setBoostStrength(Number.isFinite(savedBoostStrength) ? savedBoostStrength : 1);
        // Prefer the new key; fall back to the legacy boostCaseInsensitive so a
        // returning user's "Boost all casings" choice carries over to "Augment".
        setBoostAugment((savedBoostAugment ?? savedBoostCaseInsensitiveLegacy) === true);
        {
          const customText = typeof savedBoostCustomText === 'string' ? savedBoostCustomText : '';
          // Migration: pre-feature profiles have no boostCustomText but may
          // hold a boostPhrases the user typed. Seed custom text from it so
          // selecting "Custom" later restores their words rather than blank.
          const seedCustom = customText || (typeof savedBoostPhrases === 'string' ? savedBoostPhrases : '');
          setBoostCustomText(seedCustom);
          boostCustomTextRef.current = seedCustom;
          setBoostSource(restoredSource);
        }
        // Scalar settings are in; boot the app now so the UI is configured and
        // persistence/boost-init can proceed, and stop the watchdog.
        booted = true;
        clearTimeout(watchdog);
        setSettingsLoaded(true);

        // Slow phase, last: restore the transcript history. Done after booting
        // so a large/slow read never blocks restore. transcriptsRestoredRef
        // gates the persist effect until this lands, so the setSettingsLoaded
        // above cannot write the empty in-memory array over the on-disk history.
        const savedTranscriptions = await loadPersistedTranscripts();
        setTranscriptions(savedTranscriptions.filter(t => t.text && t.text.trim() !== ''));
        transcriptsRestoredRef.current = true;
      } catch (e) {
        console.error('Failed to load settings from IndexedDB:', e);
        if (!booted) {
          booted = true;
          clearTimeout(watchdog);
          setSettingsLoaded(true);
        }
      }
    }

    loadSettings();
    return () => clearTimeout(watchdog);
  }, [maxCores]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (modelRef.current) {
        modelRef.current.dispose();
        modelRef.current = null;
      }
    };
  }, []);

  // Cleanup on page reload/close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (modelRef.current) {
        modelRef.current.dispose();
      }
    };

    // BFCache hardening: when the browser parks the page in the
    // back-forward cache (event.persisted === true on pagehide), the
    // entire DOM + React state is held in memory and restored on Back.
    // For a privacy-sensitive transcript UI on a shared machine this is
    // a cross-actor leak: the next person who hits Back sees the prior
    // user's transcript. Revoke every per-entry audio URL eagerly so the
    // restored page can't replay any recording; then on the matching
    // pageshow event with event.persisted=true, force a full reload so
    // every visit re-asks for mic permission and starts from a blank UI.
    const handlePageHide = (e) => {
      // Belt-and-suspenders: proactively drop the keepalive (screen wake lock +
      // silent-audio anti-throttle) so a page frozen into the back-forward cache
      // can't keep the machine awake or running inference in the background. On a
      // real unload the renderer is torn down anyway and the OS reclaims the mic,
      // AudioContext and GPU session; this just makes the power side explicit and
      // covers the parked-in-bfcache case. releaseKeepalive is ref-count guarded,
      // so it is a harmless no-op when nothing is recording or transcribing.
      releaseKeepalive();
      if (e.persisted) {
        for (const id of [...entryAudioUrlsRef.current.keys()]) revokeEntryAudioUrl(id);
      }
    };
    const handlePageShow = (e) => {
      if (e.persisted) {
        window.location.reload();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  // When local fallback is enabled, verify model files are actually present
  // on the server so the admin gets early feedback about misconfiguration.
  useEffect(() => {
    if (!localFallbackEnabled) return;
    checkLocalModelFiles('/models', repoId).then((result) => {
      if (result.ok) {
        console.log('[App] Local fallback check passed:', result.message);
      } else {
        const msg = `Local model fallback is enabled but model files are not reachable at /models/. `
          + `Bind-mount a folder containing the ONNX files (e.g. produced by\n`
          + `  hf download ${repoId} --local-dir /some/host/path)\n`
          + `into the container and set LOCAL_MODEL_PATH to that in-container path. `
          + `See docker-compose.yml.`;
        console.error('[App]', msg);
        setFallbackWarning(msg);
      }
    }).catch((e) => {
      console.error('[App] Local fallback check failed:', e);
    });
  }, [localFallbackEnabled, repoId]);

  // Keyboard shortcuts
  useEffect(() => {
    // Opt-in: when disabled (the default), don't bind the global handler at all
    // so plain typing/navigation outside inputs never triggers record/settings.
    if (!keyboardShortcutsEnabled) return;
    const handleKeyPress = (e) => {
      // Don't trigger shortcuts if user is typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key.toLowerCase();

      // If recording, P toggles pause/resume
      if (isRecording && key === 'p') {
        e.preventDefault();
        if (isPaused) resumeRecording();
        else pauseRecording();
        return;
      }

      // If recording, R / S / Space all stop recording
      if ((isRecording || recordingCountdown !== null) && (key === 'r' || key === 's' || key === ' ')) {
        e.preventDefault();
        stopRecording();
        return;
      }

      switch (key) {
        case 's':
          // Toggle settings
          e.preventDefault();
          setShowSettings(prev => !prev);
          break;

        case 'r':
        case ' ':
        case 'enter':
          // Before model is loaded: Space/Enter trigger model loading
          if (status !== 'modelReady' && (key === ' ' || key === 'enter')) {
            if ((status === 'failed' || status === 'transcriptionFailed') || status === 'idle') {
              e.preventDefault();
              loadModel();
            }
            break;
          }
          // After model is loaded: R/Space start recording
          e.preventDefault();
          if (status === 'modelReady' && !isTranscribing) {
            startRecordingCountdown();
          }
          break;

        case 'f':
          // Send a file
          e.preventDefault();
          if (fileInputRef.current && status === 'modelReady' && !isTranscribing && !isRecording) {
            fileInputRef.current.click();
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [keyboardShortcutsEnabled, status, isRecording, isPaused, isTranscribing, recordingCountdown]);

  // Monitor memory usage and system strain.
  //
  // Gated on showAdvancedInfo: the values are only rendered when the advanced
  // info panel is enabled, so running the monitor while it's hidden burns
  // main-thread work and forces an App-wide re-render every 1-3s for nothing.
  // The history list isn't memoized, so those idle re-renders walked every
  // word-span as transcriptions accumulated and were the dominant cause of
  // "idle freeze after a few transcriptions".
  useEffect(() => {
    if (!showAdvancedInfo) return;
    const info = {};
    let frameRateMonitor = null;
    let frameCount = 0;
    let lastFpsUpdate = performance.now();

    // Shallow-compare against the last committed object so identical readings
    // don't trigger a re-render. setMemoryInfo with a fresh {...info} would
    // otherwise always change reference and re-render.
    const commit = () => {
      setMemoryInfo((prev) => {
        if (Object.keys(info).length === 0) return prev == null ? prev : null;
        if (prev && Object.keys(prev).length === Object.keys(info).length) {
          let same = true;
          for (const k of Object.keys(info)) {
            if (prev[k] !== info[k]) { same = false; break; }
          }
          if (same) return prev;
        }
        return { ...info };
      });
    };

    const updateMemory = async () => {
      if (navigator.deviceMemory) {
        info.deviceRAM = `${navigator.deviceMemory} GB`;
      }
      if (performance.memory) {
        const used = (performance.memory.usedJSHeapSize / 1024 / 1024 / 1024).toFixed(2);
        const limit = (performance.memory.jsHeapSizeLimit / 1024 / 1024 / 1024).toFixed(2);
        info.heapUsed = `${used} GB / ${limit} GB`;
        info.heapPercent = ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1);
      }
      if (navigator.hardwareConcurrency) {
        info.cpuCores = `${navigator.hardwareConcurrency} cores`;
      }
      if (navigator.storage && navigator.storage.estimate) {
        try {
          const estimate = await navigator.storage.estimate();
          if (estimate.quota && estimate.usage) {
            const quotaGB = (estimate.quota / 1024 / 1024 / 1024).toFixed(1);
            const usageGB = (estimate.usage / 1024 / 1024 / 1024).toFixed(2);
            const usagePercent = ((estimate.usage / estimate.quota) * 100).toFixed(1);
            info.storage = `${usageGB} / ${quotaGB} GB (${usagePercent}%)`;
          }
        } catch (e) {
          console.warn('[Memory] Storage estimate failed:', e);
        }
      }
      commit();
    };

    const monitorFrameRate = () => {
      const now = performance.now();
      frameCount++;
      if (now - lastFpsUpdate >= 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
        info.fps = `${fps} fps`;
        if (fps < 30) {
          info.fpsWarning = '⚠️ Low FPS';
        } else {
          delete info.fpsWarning;
        }
        frameCount = 0;
        lastFpsUpdate = now;
        commit();
      }
      frameRateMonitor = requestAnimationFrame(monitorFrameRate);
    };

    updateMemory();
    const interval = setInterval(updateMemory, 3000);

    if (!navigator.deviceMemory && !performance.memory) {
      frameRateMonitor = requestAnimationFrame(monitorFrameRate);
    }

    return () => {
      clearInterval(interval);
      if (frameRateMonitor) {
        cancelAnimationFrame(frameRateMonitor);
      }
    };
  }, [showAdvancedInfo]);

  // Keepalive while recording or transcribing: prevents background-tab JS
  // throttling (silent audio trick) and keeps the screen on (wake lock).
  useEffect(() => {
    if (!isRecording && !isTranscribing && !isRemoteMic) return;
    acquireKeepalive();
    return () => releaseKeepalive();
  }, [isRecording, isTranscribing, isRemoteMic]);

  // Probe WebGPU availability once on mount. `navigator.gpu` existing isn't
  // enough (the adapter request can still fail on blocklisted GPUs or headless
  // Chromium), so we actually request an adapter.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let available = false;
      let reason = null;
      let shaderF16 = null;
      try {
        if (!window.isSecureContext) {
          // navigator.gpu is only exposed in secure contexts; a plain http://
          // LAN address (common for the phone-as-mic flow) hides it entirely.
          reason = 'insecure';
        } else if (!navigator.gpu) {
          // Secure context but the browser doesn't expose WebGPU at all
          // (e.g. Firefox stable today).
          reason = 'unsupported';
        } else {
          const adapter = await navigator.gpu.requestAdapter();
          available = !!adapter;
          if (!adapter) reason = 'noAdapter';
          // fp16 compute needs the shader-f16 adapter feature; record it so the
          // quant resolver can fall back to fp32 and the UI can grey out fp16.
          else shaderF16 = adapter.features.has('shader-f16');
        }
      } catch {
        available = false;
        reason = 'noAdapter';
      }
      if (!cancelled) {
        setWebgpuAvailable(available);
        setWebgpuUnavailableReason(available ? null : reason);
        setWebgpuShaderF16(shaderF16);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist backend selection
  useEffect(() => {
    if (!settingsLoaded) return;
    saveSetting('backend', backend);
  }, [backend, settingsLoaded]);

  // Persist the WASM encoder-precision choice (int8 / fp32).
  usePersistedSetting('wasmEncoderQuant', wasmEncoderQuant, settingsLoaded);
  // Persist the WebGPU encoder-precision choice (fp16 / fp32).
  usePersistedSetting('webgpuEncoderQuant', webgpuEncoderQuant, settingsLoaded);

  // Save settings to IndexedDB whenever they change (only after initial load).
  // usePersistedSetting (defined at module scope below) is a thin wrapper
  // around useEffect that fires once per setting, only after `loaded`
  // flips to true. Keeping the hook-call list flat (one per setting)
  // preserves the previous behavior: changing setting X writes only X,
  // not all eighteen of them.
  usePersistedSetting('preprocessor', preprocessor, settingsLoaded);
  usePersistedSetting('verboseLog', verboseLog, settingsLoaded);
  usePersistedSetting('frameStride', frameStride, settingsLoaded);
  usePersistedSetting('beamWidth', beamWidth, settingsLoaded);
  usePersistedSetting('maesNumSteps', maesNumSteps, settingsLoaded);
  usePersistedSetting('maesExpansionBeta', maesExpansionBeta, settingsLoaded);
  usePersistedSetting('maesExpansionGamma', maesExpansionGamma, settingsLoaded);
  usePersistedSetting('maesPrefixAlpha', maesPrefixAlpha, settingsLoaded);
  usePersistedSetting('cpuThreads', cpuThreads, settingsLoaded);
  usePersistedSetting('noiseSuppression', noiseSuppression, settingsLoaded);
  usePersistedSetting('echoCancellation', echoCancellation, settingsLoaded);
  usePersistedSetting('autoGainControl', autoGainControl, settingsLoaded);
  usePersistedSetting('remoteMicGain', remoteMicGain, settingsLoaded);

  // Keep the phone's getUserMedia constraints + gain in sync with the
  // desktop. Fires on first bind (isRemoteMic flips to true) and on any
  // subsequent change. The phone applies the toggles on its next
  // startMicCapture (active tracks aren't retroactively mutated); the
  // gain is applied live on its GainNode so the slider gives immediate
  // feedback mid-recording.
  useEffect(() => {
    if (!isRemoteMic) return;
    const rtc = remoteMicRtcRef.current;
    if (!rtc) return;
    try {
      rtc.sendMessage({
        type: 'audio-settings',
        noiseSuppression,
        echoCancellation,
        autoGainControl,
        gain: remoteMicGain,
      });
    } catch (_) { /* channel may be closing */ }
  }, [isRemoteMic, noiseSuppression, echoCancellation, autoGainControl, remoteMicGain]);
  usePersistedSetting('showConfidenceHeatmap', showConfidenceHeatmap, settingsLoaded);
  usePersistedSetting('autoCopyToClipboard', autoCopyToClipboard, settingsLoaded);
  usePersistedSetting('persistTranscripts', persistTranscripts, settingsLoaded);
  usePersistedSetting('keyboardShortcutsEnabled', keyboardShortcutsEnabled, settingsLoaded);
  usePersistedSetting('enableChunking', enableChunking, settingsLoaded);
  // chunkDuration is a single backend-independent default (DEFAULT_CHUNK_DURATION_SEC),
  // persisted like any other setting once the user changes it.
  usePersistedSetting('chunkDuration', chunkDuration, settingsLoaded);
  usePersistedSetting('transcriptDisplayMode', transcriptDisplayMode, settingsLoaded);
  usePersistedSetting('liveTranscriptionEnabled', liveTranscriptionEnabled, settingsLoaded);
  usePersistedSetting('liveContextWindow', liveContextWindow, settingsLoaded);
  usePersistedSetting('boostPhrases', boostPhrases, settingsLoaded);
  usePersistedSetting('boostStrength', boostStrength, settingsLoaded);
  usePersistedSetting('boostAugment', boostAugment, settingsLoaded);
  usePersistedSetting('boostSource', boostSource, settingsLoaded);
  usePersistedSetting('boostCustomText', boostCustomText, settingsLoaded);
  // F-128: transcripts persist to a dedicated DB (parakeetweb-transcripts-db).
  // When the array shrinks (per-entry delete, clear-all), wipe the whole DB
  // before re-persisting so LevelDB drops the SST/log files that still hold
  // the prior longer array. Append-only growth uses a plain idbPut.
  const prevTranscriptsLenRef = useRef(transcriptions.length);
  useEffect(() => {
    // Wait for the history read to land (transcriptsRestoredRef) before writing:
    // settingsLoaded flips before the read resolves, so persisting here too early
    // would clobber the on-disk history with the still-empty in-memory array.
    if (!settingsLoaded || !transcriptsRestoredRef.current || !persistTranscripts) {
      prevTranscriptsLenRef.current = transcriptions.length;
      return;
    }
    const prev = prevTranscriptsLenRef.current;
    prevTranscriptsLenRef.current = transcriptions.length;
    if (transcriptions.length < prev) {
      wipeAndRewriteTranscripts(transcriptions);
    } else {
      saveTranscripts(transcriptions);
    }
  }, [transcriptions, settingsLoaded, persistTranscripts]);
  useEffect(() => { liveTranscriptionEnabledRef.current = liveTranscriptionEnabled; }, [liveTranscriptionEnabled]);
  useEffect(() => { liveContextWindowRef.current = liveContextWindow; }, [liveContextWindow]);

  // Keep a ref of the user's custom boost text so async callbacks (switching
  // between a file and Custom) always read the latest value.
  useEffect(() => { boostCustomTextRef.current = boostCustomText; }, [boostCustomText]);

  // Discover operator-supplied boost lists served at /boost-phrases/. No
  // manifest (BOOST_PHRASES_SOURCE unset) just means no selector is shown and
  // the box stays in manual-entry mode.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const manifest = await fetchTextCapped('/boost-phrases/manifest.txt');
        if (!cancelled && manifest.ok) {
          const files = manifest.text.trim().split('\n')
            .map(f => f.trim())
            .filter(f => f.endsWith('.txt'));
          setBoostFiles(files);
        }
      } catch (e) {
        console.warn('[Boost] failed to load phrase-list manifest:', e);
      } finally {
        if (!cancelled) setBoostFilesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Apply a boost-source selection: fill the textarea from the chosen file, or
  // restore the user's own text for the Custom sentinel. Shared by the selector
  // onChange and the one-shot init resolution below.
  async function applyBoostSource(src) {
    setBoostSource(src);
    if (src === BOOST_SOURCE_CUSTOM) {
      prebuiltBoostRef.current = null; // user text is never server-prebuilt
      setBoostPhrases(boostCustomTextRef.current);
      return;
    }
    // Fetch the list text (for display/editing) and its server-prebuilt
    // encoding (token ids) in parallel. The prebuilt JSON lets the trie build
    // skip BPE; it is absent on pure-HF deploys or empty lists, in which case
    // the browser encodes the text itself (prebuiltBoostRef stays null).
    const jsonName = src.replace(/\.txt$/, '.json');
    const fetchT0 = performance.now();
    if (verboseLogRef.current) {
      console.log(`[Boost] loading list "${src}" (+ prebuilt "${jsonName}")...`);
    }
    const [r, pj] = await Promise.all([
      fetchTextCapped(`/boost-phrases/${encodeURIComponent(src)}`),
      // A prebuilt-JSON failure must never break the text load, so swallow it
      // to a soft miss (the browser then encodes the text itself).
      fetchTextCapped(`/boost-phrases/${encodeURIComponent(jsonName)}`, BOOST_PREBUILT_MAX_BYTES)
        .catch(() => ({ ok: false })),
    ]);
    if (verboseLogRef.current) {
      const ms = (performance.now() - fetchT0).toFixed(0);
      console.log(`[Boost] fetched "${src}" in ${ms}ms `
        + `(text: ${r.ok ? `${r.text.length} chars` : 'FAILED'}, `
        + `prebuilt JSON: ${pj.ok ? `${pj.text.length} chars` : 'absent (will encode in-browser)'}).`);
    }
    if (!r.ok) {
      console.warn(`[Boost] could not load phrase list "${src}":`,
        r.oversize ? `oversize ${r.declared} bytes` : `status ${r.status}`);
      prebuiltBoostRef.current = null;
      return;
    }
    // Tag the prebuilt encoding with the exact text it corresponds to, so the
    // rebuild effect only trusts it while the textarea is unedited.
    let pre = null;
    if (pj.ok) {
      try {
        const parsed = JSON.parse(pj.text);
        // Require a string augmentDefault: that field is the v2 marker, so a
        // legacy (v1 caseDefault) artifact is ignored here and re-encoded in the
        // browser rather than reused with stale, differently-expanded ids.
        if (parsed && Array.isArray(parsed.encoded) && typeof parsed.vocabSig === 'string'
            && typeof parsed.augmentDefault === 'string') {
          pre = {
            text: r.text,
            vocabSig: parsed.vocabSig,
            // The global augmentation-default the prebuild expanded at.
            augmentDefault: parsed.augmentDefault,
            encoded: parsed.encoded,
            skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
          };
        }
      } catch (e) {
        console.warn(`[Boost] prebuilt encoding for "${src}" was unparseable; will encode in-browser.`, e);
      }
    }
    prebuiltBoostRef.current = pre;
    if (verboseLogRef.current) {
      if (pre) {
        console.log(`[Boost] prebuilt encoding ready for "${src}": ${pre.encoded.length} entries, `
          + `${pre.skipped.length} skipped, vocabSig=${pre.vocabSig}, augmentDefault="${pre.augmentDefault}". `
          + `The trie rebuild will reuse this and skip the BPE encode (provided vocab + augment toggle match).`);
      } else {
        console.log(`[Boost] no usable prebuilt for "${src}"; the trie rebuild will BPE-encode the list in-browser `
          + `(slow for large lists; runs in a worker when available).`);
      }
    }
    // A curated list can ship its own default strength via a `#!strength N`
    // directive line; loading the list forces the strength control to that
    // value (clamped to the slider's range), so the list comes pre-tuned. A
    // list with no directive leaves whatever strength the user had.
    const { strength } = parseBoostDirectives(r.text);
    if (strength !== undefined) setBoostStrength(Math.max(-10, Math.min(10, strength)));
    setBoostPhrases(r.text);
  }

  // One-shot: once both settings and the manifest have loaded, resolve the
  // source to load. A filename that still exists is (re)fetched so the box shows
  // the canonical list; a filename the operator has since removed falls back to
  // Custom so the user is never stuck on a dead entry. Custom needs nothing
  // (boostPhrases was already seeded from the saved custom text).
  //
  // When the user has NO saved boost choice (a fresh visitor), seed the default
  // from the ?phrase_boost= query param, then the VITE_PHRASE_BOOST_DEFAULT env
  // default. Neither overrides an explicit saved choice (boostSourceSavedRef).
  // This lives here (not only in the settings restore) because a first-time
  // visitor's restore takes the version-mismatch fast path that skips the
  // restore block, so the param/env default must be applied unconditionally.
  const boostSourceSavedRef = useRef(false);
  const boostInitRef = useRef(false);
  useEffect(() => {
    if (!settingsLoaded || !boostFilesLoaded || boostInitRef.current) return;
    boostInitRef.current = true;
    let source = boostSource;
    if (!boostSourceSavedRef.current && source === BOOST_SOURCE_CUSTOM) {
      source = URL_PHRASE_BOOST || normalizeBoostName(CONFIG.VITE_PHRASE_BOOST_DEFAULT) || BOOST_SOURCE_CUSTOM;
    }
    if (source !== BOOST_SOURCE_CUSTOM) {
      if (boostFiles.includes(source)) {
        if (source !== boostSource) setBoostSource(source);
        applyBoostSource(source);
      } else {
        setBoostSource(BOOST_SOURCE_CUSTOM);
        setBoostPhrases(boostCustomTextRef.current);
      }
    }
  }, [settingsLoaded, boostFilesLoaded]);

  // Lazily create the encode worker. Returns null when Workers are unavailable
  // (e.g. an exotic environment), so the caller can fall back to the main
  // thread. The BPE asset only downloads once the worker is first used, i.e.
  // when the user actually enters boost phrases (PLAN.md Phase 1 "gate asset
  // download" / Phase 3).
  const getBoostWorker = useCallback(() => {
    if (boostWorkerRef.current !== undefined) return boostWorkerRef.current;
    try {
      boostWorkerRef.current = new Worker(
        new URL('./phraseBoost.worker.js', import.meta.url),
        { type: 'module' }
      );
    } catch (e) {
      console.warn('[Boost] encode worker unavailable, using main thread:', e);
      boostWorkerRef.current = null;
    }
    return boostWorkerRef.current;
  }, []);

  // Encode parsed phrase entries to token-id sequences, off the main thread via
  // the worker when available, otherwise on a main-thread encoder cached per
  // tokenizer (model swap rebuilds it). Resolves { encoded, skipped }.
  const encodeBoostPhrases = useCallback((entries, tokenizer) => {
    const worker = getBoostWorker();
    if (!worker) {
      return (async () => {
        if (!bpeEncoderRef.current || bpeEncoderRef.current.tokenizer !== tokenizer) {
          const encoder = await loadBpeEncoder(tokenizer);
          bpeEncoderRef.current = { tokenizer, encoder };
        }
        return encodePhrases(entries, bpeEncoderRef.current.encoder);
      })();
    }
    return new Promise((resolve, reject) => {
      const reqId = ++boostReqIdRef.current;
      const onMsg = (ev) => {
        if (ev.data.id !== reqId) return; // a different (e.g. older) request's reply
        worker.removeEventListener('message', onMsg);
        if (ev.data.ok) resolve({ encoded: ev.data.encoded, skipped: ev.data.skipped });
        else reject(new Error(ev.data.error));
      };
      worker.addEventListener('message', onMsg);
      worker.postMessage({
        id: reqId,
        entries,
        id2token: tokenizer.id2token,
        assetUrl: BPE_ASSET_URL,
      });
    });
  }, [getBoostWorker]);

  // Terminate the encode worker on unmount so it does not outlive the app.
  useEffect(() => () => {
    if (boostWorkerRef.current) boostWorkerRef.current.terminate();
  }, []);

  // Parse the phrase text once per change, not once per render. The full line
  // scan is cheap per call but the App component re-renders on every unrelated
  // state change (recording timer, status flips, ...); re-scanning a 60k-line
  // curated list on each of those is what made the sidebar lag. Both the
  // rebuild effect and the render (count + collapse gate) read this memo.
  const boostParsed = useMemo(() => parseBoostPhrases(boostPhrases), [boostPhrases]);
  const boostPhraseCount = useMemo(
    () => boostParsed.filter(p => p.phrase).length,
    [boostParsed],
  );
  // A large *served* (non-Custom) list is collapsed to a read-only summary
  // rather than rendered in the editable textarea: a 60k-line lexicon is never
  // hand edited, and a controlled textarea that big makes the field scroll and
  // the sidebar lag. The text still lives in `boostPhrases` for boosting.
  const boostCollapsed = boostSource !== BOOST_SOURCE_CUSTOM
    && boostPhraseCount >= BOOST_COLLAPSE_MIN_PHRASES;

  // Phrase boosting: rebuild the trie when the phrase text changes or the model
  // becomes ready (the encoder needs the loaded tokenizer's vocab). The rebuild
  // is debounced (a large paste shouldn't re-encode per keystroke) and the
  // encode runs in the worker, so the main thread never blocks on tokenizing a
  // big list; only the cheap trie insert happens here. Strength is applied
  // separately (below) so moving the slider does not force a re-encode. We key
  // on `tokenizerVocabSig` (not `status`) so a model load/swap refreshes the
  // trie exactly once: `status` also flips on every recording/transcribe/chunk
  // transition, none of which change the vocab, and re-running the parse +
  // rebuild + warning-state writes on each of those froze the UI on a large
  // curated list (the textarea reconciled the whole list every time).
  useEffect(() => {
    // The parse is memoized (boostParsed) so it runs once per text change, not
    // per render. It feeds the inline warnings; the expensive step is
    // expandAugmentations below, deferred until we know the prebuilt encoding
    // can't be reused.
    const parsed = boostParsed;
    setBoostWarnings(parsed.filter(p => p.warning).map(p => ({ phrase: p.phrase })));
    const phraseEntries = parsed.filter(p => p.phrase);
    const tokenizer = modelRef.current?.tokenizer;
    if (!phraseEntries.length || !tokenizer) {
      phraseBoostRef.current = null;
      // No tokenizer yet (model not loaded), but a server-prebuilt artifact
      // already ships its own `skipped` list (the phrases the model vocab can't
      // represent, computed against that vocab at prebuild time) and is fetched
      // into prebuiltBoostRef the moment the list is selected. Surface it now so
      // the untokenizable-words warning appears on list-load rather than only
      // once the model is ready; the full rebuild below recomputes it against
      // the live tokenizer. Guard on text match so an edited list shows nothing
      // stale (editing a curated list drops the prebuilt anyway).
      const pre = prebuiltBoostRef.current;
      const canPreview = phraseEntries.length && pre
        && pre.text === boostPhrases && Array.isArray(pre.skipped);
      setBoostUnkWarnings(canPreview ? pre.skipped : []);
      return;
    }
    // Use the server-prebuilt encoding when it matches the current text exactly
    // (unedited) and the vocab it was built for matches the loaded tokenizer;
    // that skips the BPE encode (the slow part) entirely. Decide this *before*
    // augment-expanding the list: the prebuilt already baked in the expansion, so
    // on the prebuilt path expandAugmentations would be pure wasted work, and
    // it is heavy enough (hundreds of ms to seconds on a large augmented
    // list) to freeze the UI on the main thread. Worse, this effect re-runs on
    // every `status` change, so re-expanding here would re-freeze on each model
    // load / recording transition, not just once.
    const pre = prebuiltBoostRef.current;
    const sig = tokenizer.id2token ? vocabSignature(tokenizer.id2token) : null;
    // The list's own `#!augment` directive overrides the global "Augment" toggle
    // for this list; a per-phrase `:AUG` still wins over both (in
    // expandAugmentations). Parse directives once for both the augment default
    // and the `#!prefixes` the `p` flag uses.
    const directives = parseBoostDirectives(boostPhrases);
    const augmentDefault = directives.augment ?? (boostAugment ? FULL_AUGMENT : '');
    // The prebuilt encoding bakes in the augmentation expansion at the global
    // default it was built with; selectPrebuilt() validates text + vocab +
    // augment toggle and, when rejected, explains why (see its docstring).
    const { usePrebuilt, reasons: prebuiltRejectReasons } = selectPrebuilt(pre, {
      text: boostPhrases, vocabSig: sig, augmentDefault,
    });
    // Augmentation expansion: turn each augmented phrase into one entry per
    // surface form so the case-sensitive encoder gets a trie branch for each.
    // Only needed on the encode path; a per-phrase `:AUG` flag can opt a phrase
    // in even when the global default is off (and `:s` can opt one out when it is
    // on). The list's own `#!prefixes` directive drives the `p` flag.
    const entries = usePrebuilt
      ? null
      : expandAugmentations(phraseEntries, augmentDefault, directives.prefixes);
    // Phrase count for the spinner gate and logs: the prebuilt is already encoded.
    const count = usePrebuilt ? pre.encoded.length : entries.length;
    let cancelled = false;
    // When a prebuilt exists but is rejected, say why: this is the difference
    // between a fast (prebuilt) rebuild and a slow from-scratch BPE re-encode,
    // so it is the first thing to check if a curated list is unexpectedly slow.
    if (verboseLogRef.current && pre && !usePrebuilt) {
      console.log(`[Boost] prebuilt encoding present but NOT used; will BPE-encode in-browser. Reason: ${prebuiltRejectReasons.join('; ')}.`);
    }
    // Long lists take long enough to encode+build that the user should see the
    // app is busy; small ones (or prebuilt ones, which only insert) rebuild in
    // a few ms, so a spinner would only flash.
    const showSpinner = !usePrebuilt && count >= BOOST_SPINNER_MIN_PHRASES;
    const timer = setTimeout(async () => {
      if (showSpinner) setBoostRebuilding(true);
      const t0 = performance.now();
      if (verboseLogRef.current) {
        console.log(`[Boost] rebuilding trie for ${count} phrase(s)`
          + `${usePrebuilt ? ' (server-prebuilt encoding, skipping BPE)' : ''}...`);
      }
      try {
        const { encoded, skipped } = usePrebuilt
          ? { encoded: pre.encoded, skipped: pre.skipped }
          : await encodeBoostPhrases(entries, tokenizer);
        if (cancelled) return;
        const trie = BoostingTrie.buildFromEncoded(encoded, { strength: boostStrengthRef.current });
        trie.skipped = skipped;
        // Phrases with characters the model vocab cannot represent (e.g. CJK)
        // were dropped during encode; surface them so the user knows why.
        setBoostUnkWarnings(skipped);
        phraseBoostRef.current = trie.isEmpty ? null : trie;
        if (verboseLogRef.current) {
          const ms = performance.now() - t0;
          const perLine = count ? ms / count : 0;
          console.log(
            `[Boost] trie rebuilt in ${ms.toFixed(1)}ms for ${count} phrase(s) `
            + `(avg ${perLine.toFixed(3)}ms/line, ${trie.size} inserted, ${skipped.length} skipped`
            + `${usePrebuilt ? ', prebuilt' : ''}).`
          );
        }
      } catch (e) {
        if (cancelled) return;
        console.warn('[Boost] failed to build boosting trie:', e);
        phraseBoostRef.current = null;
      } finally {
        if (showSpinner) setBoostRebuilding(false);
      }
    }, BOOST_REBUILD_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); if (showSpinner) setBoostRebuilding(false); };
  }, [boostPhrases, boostParsed, boostAugment, tokenizerVocabSig, encodeBoostPhrases]);

  // Apply the strength slider without rebuilding the trie.
  useEffect(() => {
    boostStrengthRef.current = boostStrength;
    if (phraseBoostRef.current) phraseBoostRef.current.strength = boostStrength;
  }, [boostStrength]);

  // Keep the verbose-log ref current for the debounced rebuild closure.
  useEffect(() => { verboseLogRef.current = verboseLog; }, [verboseLog]);

  /**
   * Load model weights and create an ONNX inference session.
   * @param {Object} [opts]
   * @param {boolean} [opts.useLocalFallback=false] When true, download weights
   *   from this instance (/models/) instead of HuggingFace.
   */
  async function loadModel({ useLocalFallback = forceLocalFallback, corruptionRetried = false } = {}) {
    // Clean up existing model first
    if (modelRef.current) {
      console.log('[App] Disposing existing model before loading new one...');
      modelRef.current.dispose();
      modelRef.current = null;
      // Drop the old vocab signature so the boost effect clears its trie now
      // (no tokenizer) and rebuilds once the new model publishes its signature.
      setTokenizerVocabSig(null);
    }

    setStatus('loadingModel');
    setProgress('');
    setProgressText('');
    setProgressPct(0);
    downloadRateRef.current = null;
    setModelLoadError(null);
    // The corrupt-cache retry re-enters loadModel; keep the original timer
    // running across it instead of restarting (which logs a duplicate-timer
    // warning) so console.timeEnd still reports the full load duration.
    if (!corruptionRetried) console.time('LoadModel');

    try {
      const progressCallback = ({ loaded, total, file, resumed, attempt, maxAttempts }) => {
        // Attempt-tracking events fire before any bytes flow so the user sees
        // "Retry N/M" even on a stalled connection. Distinct from byte events.
        if (attempt !== undefined) {
          if (maxAttempts > 1) {
            const msg = t('retryingDownload')
              .replace('{n}', attempt)
              .replace('{total}', maxAttempts)
              .replace('{file}', file);
            setProgressText(msg);
            if (attempt === 1) setProgressPct(0);
          }
          return;
        }
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        const prefix = resumed ? `${t('resuming')} ` : '';
        const sizes = total > 0 ? ` ${formatBytes(loaded)} / ${formatBytes(total)}` : '';
        // Smoothed transfer rate + MM:SS ETA, recomputed as bytes flow.
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const { state, rate, eta } = updateDownloadRate(downloadRateRef.current, { file, loaded, total, now });
        downloadRateRef.current = state;
        const rateStr = formatRate(rate);
        const etaStr = formatEta(eta);
        const stats = [rateStr, etaStr ? `${etaStr} ${t('etaRemaining')}` : ''].filter(Boolean).join(', ');
        const statsSuffix = stats ? ` (${stats})` : '';
        setProgressText(`${prefix}${file}:${sizes} (${pct}%)${statsSuffix}`);
        setProgressPct(pct);
      };

      // 1. Download all model files (from HF or local fallback).
      // Pass `backend` and a per-backend quant preference; hub.js resolves the
      // final quant against what the repo actually ships (resolveModelQuant):
      //   - WASM: int8 encoder (~600 MB), the only one that fits the 32-bit WASM
      //     heap / Chromium's ~2 GB blob limit.
      //   - WebGPU: prefer the fp16 encoder (~1.2 GB, near-lossless vs fp32 and
      //     lighter to serve) when the repo ships encoder-model.fp16.onnx, else
      //     fp32 (~2.4 GB). The GPU EP has no int8 encoder kernel.
      const wantWebgpu = backend.startsWith('webgpu');
      // On WASM the user may opt into the sharded fp32 encoder (full quality);
      // hub.js only honours it when the repo ships the shards
      // (allowWasmFp32 gate), else it falls back to the int8 pin. The decoder
      // stays int8 on WASM regardless (tiny, runs fine).
      const wasmWantsFp32 = !wantWebgpu && wasmEncoderQuant === 'fp32';
      // On WebGPU the user picks fp16 (default) or fp32; int8 is not offered
      // (no GPU int8 encoder kernel). The decoder follows to fp16 only when the
      // encoder is fp16 (and the repo ships decoder_joint-model.fp16.onnx);
      // otherwise it stays int8, which the GPU EP runs fine.
      const webgpuFp32 = wantWebgpu && webgpuEncoderQuant === 'fp32';
      const downloadOpts = {
        encoderQuant: wantWebgpu ? (webgpuFp32 ? 'fp32' : 'fp16') : (wasmWantsFp32 ? 'fp32' : 'int8'),
        decoderQuant: (wantWebgpu && !webgpuFp32) ? 'fp16' : 'int8',
        allowWasmFp32: wasmWantsFp32,
        // When the GPU lacks shader-f16, hub.js resolves the fp16 request above
        // to fp32 (fp16 shaders won't compile). null/unknown -> assume supported.
        shaderF16: webgpuShaderF16,
        preprocessor,
        backend,
        progress: progressCallback,
      };
      // Operator-level override of the model revision pin. If unset, hub.js
      // falls back to the per-model revision baked into models.js.
      if (CONFIG.VITE_MODEL_REVISION) {
        downloadOpts.revision = CONFIG.VITE_MODEL_REVISION;
      }
      if (useLocalFallback) {
        // Serve weights from this instance under /models/ (hub.js auto-detects a
        // flat layout or a nested /models/<repoId>/ tree via resolveLocalModelBase).
        downloadOpts.localFallbackBaseUrl = '/models';
        console.log('[App] Using local fallback for model download');
      } else {
        // First (HuggingFace) attempt: let hub.js transparently switch to the
        // locally-served /models mirror BEFORE downloading when HF cannot
        // deliver the requested quant but /models can (the user picked WASM fp32
        // and only /models ships the shards, or WebGPU fp16 and only /models
        // ships the fp16 encoder). Detecting it pre-download avoids fetching the
        // wrong (downgraded) weights only to throw them away.
        downloadOpts.localUpgradeBaseUrl = '/models';
      }
      const modelUrls = await getParakeetModel(repoId, downloadOpts);

      // Show compiling sessions stage
      setStatus('creatingSessions');
      setProgressText(t('compilingModel'));
      setProgressPct(null);

      // 2. Create the model instance with all file URLs
      // Determine mel bin count from model config (nemo128 → 128, nemo80 → 80)
      const nMels = modelUrls.modelConfig?.featuresSize || 128;
      try {
        modelRef.current = await ParakeetModel.fromUrls({
          ...modelUrls.urls,
          filenames: modelUrls.filenames,
          backend,
          verbose: verboseLog,
          cpuThreads,
          preprocessorBackend: modelUrls.preprocessorBackend,
          nMels,
        });
      } catch (sessErr) {
        // A cached weight file that fails ONNX deserialization (truncated
        // download, disk error, quota corruption) is recoverable: drop the bad
        // bytes from IndexedDB and re-download once. Count every occurrence this
        // session; the first recovers silently, a repeat warns the user that
        // their storage looks unreliable. Non-deserialize errors (network, OOM,
        // missing WebGPU) are not cache problems, so rethrow them unchanged.
        if (!isModelDeserializeError(sessErr)) throw sessErr;
        modelCorruptionRecoveriesRef.current += 1;
        if (modelCorruptionRecoveriesRef.current > 1) {
          setModelCorruptionWarning(t('modelCorruptionRepeated'));
        }
        if (corruptionRetried) {
          // Freshly re-downloaded bytes still won't deserialize: not a stale
          // cache. Surface it as a normal load failure (and the warning above).
          console.error('[App] Re-downloaded model still failed to deserialize; storage may be unreliable.', sessErr);
          throw sessErr;
        }
        console.warn('[App] Session create failed (corrupt cached model?); evicting cached weights and re-downloading.', sessErr);
        await evictModelFiles(modelUrls.cacheInfo || { repoId })
          .catch((err) => console.warn('[App] evictModelFiles failed:', err));
        return loadModel({ useLocalFallback, corruptionRetried: true });
      }

      console.timeEnd('LoadModel');
      // Publish the loaded tokenizer's vocab signature so the boost-trie rebuild
      // effect runs now (model became ready) and on a later vocab-changing swap,
      // but NOT on the unrelated status churn of recording/transcribing.
      const tk = modelRef.current?.tokenizer;
      setTokenizerVocabSig(tk?.id2token ? vocabSignature(tk.id2token) : 'ready');
      setStatus('modelReady');
      setProgressText('');
      setProgressPct(null);
    } catch (e) {
      console.error(e);
      // Recover from an HF download failure (HF blocked/unreachable, or the repo
      // simply doesn't host the requested model/files) by retrying against the
      // locally-served /models weights instead of crashing. When the operator
      // configured local fallback (VITE_MODEL_SOURCE=local|both) we retry
      // unconditionally; otherwise (default 'hf') we probe /models first and only
      // retry when the files are actually there, so we never swap a clear HF
      // error for a confusing "local folder missing" failure.
      if (e instanceof HubDownloadError && !useLocalFallback) {
        // Only probe /models when the operator hasn't already enabled local
        // fallback (then we'd retry regardless); avoids a needless HEAD request.
        let localReachable = false;
        if (!localFallbackEnabled) {
          const probe = await checkLocalModelFiles('/models', repoId).catch(() => null);
          localReachable = !!probe?.ok;
        }
        if (shouldRetryLocally({
          isHubError: true,
          alreadyLocal: false,
          localConfigured: localFallbackEnabled,
          localReachable,
        })) {
          console.log('[App] HuggingFace download failed; retrying against local /models weights');
          return loadModel({ useLocalFallback: true });
        }
      }
      // The requested quant couldn't be served by ANY source (e.g. fp32 on WASM
      // with no shards hosted). hub.js refuses to silently downgrade to int8, so
      // tell the user exactly why rather than leaving a bare "Failed".
      if (e instanceof QuantUnavailableError) {
        setModelLoadError(t('quantUnavailable'));
      }
      setStatus('failed');
      setProgress('');
    }
  }


  // Spin up the live transcriber if the user enabled it. Reads PCM out of
  // the same pcmChunksRef both record paths feed; safe to call once per
  // recording session. The canonical stop-pass still runs on stop.
  function maybeStartLiveTranscriber(audioCtx) {
    if (!liveTranscriptionEnabledRef.current) return;
    if (!modelRef.current) return;
    if (liveTranscriberRef.current) return;
    setLiveTranscript({ text: '', words: [] });
    setLiveStats(null);
    const winSetting = liveContextWindowRef.current;
    const live = createLiveTranscriber({
      model: modelRef.current,
      getPcmChunks: () => pcmChunksRef.current,
      getSampleRate: () => audioCtx?.sampleRate || 48000,
      windowMode: winSetting === 'auto' ? 'auto' : Number(winSetting),
      getPhraseBoost: () => phraseBoostRef.current,
      onUpdate: ({ text, words }) => setLiveTranscript({ text, words }),
      onStats: setLiveStats,
    });
    liveTranscriberRef.current = live;
    live.start();
  }

  async function stopLiveTranscriberIfRunning() {
    const live = liveTranscriberRef.current;
    if (!live) return;
    liveTranscriberRef.current = null;
    try { await live.stop(); } catch (e) { console.warn('[Live] stop failed:', e); }
  }

  async function startRecordingCountdown() {
    // Request microphone access immediately, in parallel with the countdown,
    // so the stream is ready by the time the countdown ends. This prevents
    // losing the first words of speech due to getUserMedia latency.
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: { ideal: 48000 },
        echoCancellation,
        noiseSuppression,
        autoGainControl,
      }
    });

    // Acquire the stream early so the mic hardware is warm by the time
    // the countdown finishes. But do NOT start recording yet — we only
    // want to capture audio from ~100ms before the countdown ends, to
    // avoid feeding seconds of silence/noise to the model.
    let stream;
    try {
      stream = await streamPromise;
    } catch (err) {
      console.error('[Record] Failed to access microphone:', err);
      alert(`Failed to access microphone: ${err.message}\n\nPlease ensure you've granted microphone permissions.`);
      return;
    }

    // Brief delay to let the mic hardware warm up before recording.
    // Previously a 2s countdown, reduced now that the underlying bug is fixed.
    setRecordingCountdown(1);
    setStatus('startingRecording');

    await new Promise(resolve => setTimeout(resolve, 250));
    await startRecordingActual(stream);

    setRecordingCountdown(0);
    setStatus('recordingStartsNow');

    await new Promise(resolve => setTimeout(resolve, 100)); // Brief visual feedback at 0
    setRecordingCountdown(null);
  }

  async function startRecordingActual(stream) {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      const settings = audioTrack.getSettings();
      console.log('[Record] Microphone access granted');
      console.log('[Record] Actual mic settings:', settings);

      // Try to create an AudioContext that matches the mic's actual sample rate.
      // Some devices (e.g. Philips SpeechMike) use non-standard rates (16k, 22.05k, 44.1k)
      // and connecting AudioNodes across mismatched sample rates throws an error.
      // Strategy: try the reported rate first, then SpeechMike-specific rates, then
      // fall back to the browser default and infer the actual rate from the context.
      const reportedRate = settings.sampleRate;
      const ratesToTry = [
        reportedRate,           // what the browser reports (may be undefined/0)
        16000, 22050, 44100,    // SpeechMike-specific rates
        48000,                  // common default
        undefined,              // browser default (no sampleRate option)
      ].filter((r, i, a) => r && a.indexOf(r) === i); // dedupe, drop falsy
      // Always include a browser-default fallback at the end
      ratesToTry.push(undefined);

      let audioCtx = null;
      let sourceNode = null;
      const attempts = [];
      console.log(`[Record] Will try sample rates: ${ratesToTry.map(r => r ?? 'browser-default').join(', ')}`);
      for (const rate of ratesToTry) {
        const label = rate ? `${rate}Hz` : 'browser-default';
        try {
          const opts = rate ? { sampleRate: rate } : undefined;
          const ctx = new AudioContext(opts);
          console.log(`[Record] Trying AudioContext at ${label} (actual: ${ctx.sampleRate}Hz)`);
          await verifiedAddModule(ctx.audioWorklet, '/pcm-recorder-worklet.js');
          const src = ctx.createMediaStreamSource(stream);
          audioCtx = ctx;
          sourceNode = src;
          attempts.push({ rate: label, actual: ctx.sampleRate, success: true });
          console.log(`[Record] SUCCESS: AudioContext at ${ctx.sampleRate}Hz`);
          break;
        } catch (e) {
          attempts.push({ rate: label, error: e.message });
          console.warn(`[Record] FAILED at ${label}:`, e.message);
        }
      }
      console.log('[Record] Sample rate attempts summary:', JSON.stringify(attempts, null, 2));
      if (!audioCtx) {
        const summary = attempts.map(a => `  ${a.rate}: ${a.error}`).join('\n');
        throw new Error(`Could not create AudioContext at any sample rate.\nAttempts:\n${summary}`);
      }

      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-recorder-processor');

      // Accumulate raw PCM chunks from the worklet processor
      clearPcmChunks();
      let localRecordingCapHit = false;
      workletNode.port.onmessage = (e) => {
        if (localRecordingCapHit) return;
        if (getTotalPcmSamples() + e.data.length > LOCAL_RECORDING_MAX_SAMPLES) {
          localRecordingCapHit = true;
          console.error('[Record] Local recording cap reached, stopping recording');
          alert(t('localRecordingCapExceeded') || 'Recording stopped: maximum duration reached.');
          // stopRecording is defined as a sibling function in this component
          // and tears down the worklet + AudioContext cleanly.
          stopRecording();
          return;
        }
        appendPcmChunk(e.data); // Float32Array, 128 samples each
      };

      sourceNode.connect(workletNode);
      // workletNode does NOT connect to destination — we capture only, no feedback loop

      workletNodeRef.current = workletNode;

      // Audio level monitoring via an AnalyserNode on the same graph.
      // Stash the stop-helper on the audioCtx so stopRecording can end it.
      const monitor = createLevelMonitor(audioCtx, sourceNode, setAudioLevel);
      audioCtx._stopLevelMonitor = monitor.stop;

      setAudioContext(audioCtx);
      setMediaRecorder(stream); // reuse state slot to hold the stream for cleanup
      setIsRecording(true);
      // Drop any leftover awaiting state from a previous session that the
      // user may have abandoned without transcribing.
      setAwaitingFinal(false);
      setStatus('recordingClickStop');
      console.log('[Record] Recording started (AudioWorklet PCM capture)');

      maybeStartLiveTranscriber(audioCtx);

    } catch (err) {
      console.error('[Record] Failed to start recording:', err);
      stream.getTracks().forEach(track => track.stop());
      alert(`Failed to start recording: ${err.message}`);
    }
  }

  async function stopRecording() {
    // Clear countdown if active
    if (recordingCountdown !== null) {
      setRecordingCountdown(null);
      setStatus('modelReady');
      return;
    }

    if (!isRecording) return;

    console.log('[Record] Stopping recording...');
    // Flip awaitingFinal first so the live transcript and status banner
    // remain visible across the (possibly long) gap between stop and the
    // final ASR result hitting the transcriptions list.
    setAwaitingFinal(true);
    setIsRecording(false);
    setIsPaused(false);
    setAudioLevel(0);

    // Drain the live transcriber before we tear down pcmChunksRef so its
    // last in-flight tick (if any) finishes against the buffer it expects.
    await stopLiveTranscriberIfRunning();

    // Resume AudioContext if paused, so cleanup and close work correctly
    if (audioContext?.state === 'suspended') {
      try { await audioContext.resume(); } catch (_) { /* ignore */ }
    }

    // Stop level-monitor animation loop
    if (audioContext?._stopLevelMonitor) audioContext._stopLevelMonitor();

    // Disconnect worklet and release mic
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // mediaRecorder state slot now holds the MediaStream
    const stream = mediaRecorder;
    if (stream && stream.getTracks) {
      stream.getTracks().forEach(track => track.stop());
    }
    setMediaRecorder(null);

    // Concatenate PCM slabs captured by the AudioWorklet into one buffer
    const rawPcm = concatPcmChunks();
    const totalSamples = rawPcm.length;
    clearPcmChunks();
    const sourceSampleRate = audioContext?.sampleRate ?? 48000;
    console.log(`[Record] Captured ${totalSamples} samples at ${sourceSampleRate}Hz (${(totalSamples / sourceSampleRate).toFixed(2)}s)`);

    // Resample from mic native rate → 16kHz mono
    const targetSampleRate = 16000;
    const pcm16k = await resamplePcmTo16k(rawPcm, sourceSampleRate);
    console.log(`[Record] Resampled to 16kHz (${pcm16k.length} samples, ${(pcm16k.length / 16000).toFixed(2)}s)`);

    // Close the recording AudioContext
    if (audioContext) {
      try { audioContext.close(); } catch (_) { /* ignore */ }
      setAudioContext(null);
    }

    // Build a WAV from the 16kHz PCM. It travels with the resulting entry as
    // its in-memory audio (inline player + "Transcribe again").
    const wavBlob = createWavBlob(pcm16k, targetSampleRate);
    const file = new File([wavBlob], `recording-${Date.now()}.wav`, { type: 'audio/wav' });
    setStatus('modelReady');

    // Feed the recorded 16kHz PCM straight to the transcription core (not
    // processAudioFile, which would decode+resample the WAV again at the device
    // rate and back, degrading the signal). The entry carries this exact PCM +
    // WAV so "Transcribe again" stays lossless.
    if (modelRef.current) {
      console.log('[Record] Transcribing...');
      const safeName = sanitizeDeviceName(file.name, 'file');
      runTranscription(pcm16k, { safeName, audioDuration: pcm16k.length / targetSampleRate, audioBlob: wavBlob });
    }
  }

  // Pause recording by suspending the AudioContext. The worklet stops receiving
  // audio frames while suspended, so pcmChunksRef accumulation pauses too.
  // The mic stream stays open so resume is instant (no re-negotiation).
  async function pauseRecording() {
    if (!isRecording || isPaused || !audioContext) return;
    try {
      // Stop level-monitor animation loop while paused
      if (audioContext._stopLevelMonitor) audioContext._stopLevelMonitor();
      await audioContext.suspend();
      setIsPaused(true);
      setAudioLevel(0);
      setStatus('recordingPaused');
      console.log('[Record] Paused');
    } catch (err) {
      console.error('[Record] Failed to pause:', err);
    }
  }

  // Resume a paused recording by resuming the AudioContext and restarting
  // the level-monitor animation loop.
  async function resumeRecording() {
    if (!isRecording || !isPaused || !audioContext) return;
    try {
      await audioContext.resume();

      // Restart the level-monitor; the previous animation loop was stopped
      // when pauseRecording() was called.
      const stream = mediaRecorder;
      if (stream) {
        const src = audioContext.createMediaStreamSource(stream);
        const monitor = createLevelMonitor(audioContext, src, setAudioLevel);
        audioContext._stopLevelMonitor = monitor.stop;
      }

      setIsPaused(false);
      setStatus('recordingClickStop');
      console.log('[Record] Resumed');
    } catch (err) {
      console.error('[Record] Failed to resume:', err);
    }
  }

  // ============ Remote Microphone (Phone as Mic) ============

  async function startRemoteMic() {
    if (isRecording || isRemoteMic) return;

    setRemoteMicModal(true);
    setRemoteMicStatus('connecting');
    setRemoteMicError('');
    setRemoteMicDecryptErrors(0);
    setRemoteMicLevel(0);
    setRemoteMicElapsed(0);
    clearPcmChunks();
    remoteMicSampleRateRef.current = 16000;
    remoteMicFormatRef.current = 'pcm-f32';

    try {
      const rtc = new RemoteMicRTC('/api/signal');
      remoteMicRtcRef.current = rtc;

      await rtc.init();
      const { roomId, secret } = await rtc.createRoom();

      // Generate ECDH key pair for E2E encryption
      const keyPair = await generateKeyPair();
      const ourKeyBase64 = await exportPublicKey(keyPair.publicKey);

      rtc.onDisconnected = () => {
        console.log('[RemoteMic] Disconnected');
        // Clean up audio/timer state but keep modal open with a "disconnected" status
        // so the user can click Regenerate QR instead of having to restart manually.
        stopRemoteMicTimer();
        resolveRemoteMicVerify(false);
        resolveRemoteMicPeerAck(false);
        // F-88: onDisconnected used to null the ref without closing the
        // underlying RTCPeerConnection, leaving its ICE poll setInterval
        // alive against the signaling server for any disconnected-not-
        // failed state (mobile network flap, ICE restart). Close
        // explicitly so the poll self-clears via the `closed` branch.
        try { remoteMicRtcRef.current?.close(); } catch (_) { /* already closing */ }
        remoteMicRtcRef.current = null;
        remoteMicKeyRef.current = null;
        clearPcmChunks();
        setRemoteMicVerifiedAt(null);
        setIsRemoteMic(false);
        setRemoteMicRecording(false);
        setRemoteMicLevel(0);
        setRemoteMicPaused(false);
        setRemoteMicStatus('disconnected');
        setRemoteMicModal(true);
      };

      // Handle incoming messages (JSON control + binary audio)
      rtc.onMessage = async (data) => {
        if (typeof data === 'string') {
          // F-122: bound the JSON parser input. Control messages are tiny
          // (handshake, audio-config, verify-ok/deny, paused/resumed). 4 KB
          // is generous and caps a hostile phone's per-message allocation
          // burst irrespective of the SCTP NDATA max-message-size.
          if (data.length > 4096) {
            console.warn('[RemoteMic] Dropping oversized control message:', data.length, 'bytes');
            return;
          }
          try {
            const msg = JSON.parse(data);
            // F-83: gate audio-* and pause/resume control messages on a
            // verified session. Before peer-ack completes (and thus
            // before remoteMicKeyRef is bound), the only legitimate
            // control messages are the handshake set (sender-public-key,
            // verify-ok, verify-deny). audio-config / audio-end /
            // paused / resumed sent during the verify modal must NOT
            // flip recording state, start the live transcriber, or
            // poison sample-rate refs. The binary path already gates on
            // remoteMicKeyRef.current; mirror that here.
            const SESSION_GATED_TYPES = new Set(['audio-config', 'audio-end', 'paused', 'resumed']);
            if (SESSION_GATED_TYPES.has(msg.type) && !remoteMicKeyRef.current) {
              console.warn(`[RemoteMic] Ignoring ${msg.type} before peer-ack (no shared key yet)`);
              return;
            }
            if (msg.type === 'sender-public-key') {
              // Refuse a second handshake once one is already bound or in
              // flight. Otherwise a malicious phone could overwrite
              // remoteMicKeyRef.current mid-stream (silent key swap on the
              // victim) or orphan the previous verify resolver, pinning
              // the original ECDH private key in a dead closure.
              //
              // F-137: include the synchronous in-progress flag. The two
              // other refs are only populated after several awaits below
              // (importPublicKey, deriveSharedKey, stats fetch, fingerprint
              // hash), and a flood of sender-public-key messages would
              // otherwise all pass this guard before any of them reaches
              // the verifyResolveRef assignment.
              if (remoteMicKeyRef.current || remoteMicVerifyResolveRef.current || remoteMicHandshakeInProgressRef.current) {
                console.warn('[RemoteMic] Ignoring duplicate sender-public-key — handshake already bound or in-flight');
                return;
              }
              remoteMicHandshakeInProgressRef.current = true;
              // Derive shared key from phone's public key
              const theirKey = await importPublicKey(msg.key);
              const sharedKey = await deriveSharedKey(keyPair.privateKey, theirKey);
              console.log('[RemoteMic] Shared key derived, asking user to verify fingerprint');

              // Compute a short adaptive fingerprint over both pubkeys.
              // The shared helper enforces the same byte order on both sides
              // (receiver-pub first, sender-pub second) — diverging here would
              // silently break the MITM defence.
              const hexLen = await getAdaptiveFingerprintLength();
              const fp = await computePairFingerprintForRole('receiver', keyPair.publicKey, theirKey, hexLen);
              setRemoteMicFingerprint(fp);

              // Block here until the user clicks Confirm or Deny in the modal.
              const confirmed = await new Promise((resolve) => {
                remoteMicVerifyResolveRef.current = resolve;
              });
              setRemoteMicFingerprint('');
              remoteMicVerifyResolveRef.current = null;

              if (!confirmed) {
                console.warn('[RemoteMic] User denied fingerprint match — aborting');
                rtc.sendMessage({ type: 'verify-deny' });
                setRemoteMicError(t('verifyAborted'));
                setRemoteMicStatus('error');
                rtc.close();
                return;
              }
              rtc.sendMessage({ type: 'verify-ok' });

              // F-63: wait for the phone's reciprocal verify-ok before
              // binding the shared key and flipping to 'connected'. A 60s
              // cap avoids hanging if the phone crashed or the user
              // walked away mid-handshake; in normal use both peers ack
              // within a second of each other.
              const PEER_ACK_TIMEOUT_MS = 60000;
              let peerAckTimer = null;
              const peerAcked = await new Promise((resolve) => {
                // If the phone confirmed before we did, its verify-ok (or
                // verify-deny) was buffered while our modal was up. Consume
                // it now instead of arming a 60s wait for a message that
                // already arrived.
                if (remoteMicEarlyPeerVerifyRef.current !== null) {
                  const early = remoteMicEarlyPeerVerifyRef.current;
                  remoteMicEarlyPeerVerifyRef.current = null;
                  resolve(early);
                  return;
                }
                remoteMicPeerAckResolveRef.current = resolve;
                peerAckTimer = setTimeout(() => {
                  if (remoteMicPeerAckResolveRef.current) {
                    remoteMicPeerAckResolveRef.current(false);
                    remoteMicPeerAckResolveRef.current = null;
                  }
                }, PEER_ACK_TIMEOUT_MS);
              });
              if (peerAckTimer) clearTimeout(peerAckTimer);
              remoteMicPeerAckResolveRef.current = null;

              if (!peerAcked) {
                console.warn('[RemoteMic] Peer did not ack verify-ok (deny or timeout), aborting');
                setRemoteMicError(t('verifyAborted'));
                setRemoteMicStatus('error');
                rtc.close();
                return;
              }

              remoteMicKeyRef.current = sharedKey;
              // F-137: handshake is now bound, future sender-public-key
              // messages are caught by the remoteMicKeyRef guard.
              remoteMicHandshakeInProgressRef.current = false;
              setRemoteMicVerifiedAt(Date.now());
              setRemoteMicStatus('connected');
              setRemoteMicModal(false); // close setup modal; use main UI from here
              setRemoteMicPaused(false);
              setIsRemoteMic(true);

              startRemoteMicTimer();
            } else if (msg.type === 'verify-ok') {
              // F-63: phone confirmed its end. Three cases:
              //  (a) Our peer-ack wait is already armed -> resolve it.
              //  (b) Session already bound (remoteMicKeyRef set) -> stale
              //      replay, ignore.
              //  (c) Otherwise the phone confirmed before us; buffer the
              //      arrival so the peer-ack wait consumes it as soon as
              //      the local user clicks confirm. Without (c) the
              //      locally-late side would wait the full 60s timeout
              //      and surface a misleading "verifyAborted" error.
              if (remoteMicPeerAckResolveRef.current) {
                remoteMicPeerAckResolveRef.current(true);
              } else if (remoteMicKeyRef.current) {
                console.warn('[RemoteMic] Stray verify-ok ignored (session already bound)');
              } else {
                remoteMicEarlyPeerVerifyRef.current = true;
                console.log('[RemoteMic] Peer verify-ok arrived before local confirm, buffered');
              }
            } else if (msg.type === 'verify-deny') {
              // Phone denied the fingerprint match, abort our side too.
              // Could arrive (a) before local confirm (verifyResolve in
              // flight), or (b) after local confirm while we're awaiting
              // the peer ack (peerAckResolve in flight).
              //
              // F-87: ignore verify-deny once peer-ack has completed
              // (remoteMicKeyRef is set). Otherwise a malicious phone
              // could send verify-deny mid-session to wipe the user's
              // in-flight transcript with a misleading "verifyAborted"
              // error message. After the handshake is bound the
              // legitimate teardown signal is rtc disconnect, not a
              // protocol message.
              if (remoteMicVerifyResolveRef.current) {
                remoteMicVerifyResolveRef.current(false);
              } else if (remoteMicPeerAckResolveRef.current) {
                remoteMicPeerAckResolveRef.current(false);
              } else if (!remoteMicKeyRef.current) {
                setRemoteMicError(t('verifyAborted'));
                setRemoteMicStatus('error');
                rtc.close();
              } else {
                console.warn('[RemoteMic] Ignoring verify-deny after peer-ack (session already bound)');
              }
            } else if (msg.type === 'audio-config') {
              // Validate the phone-supplied sample rate before letting it
              // reach the resampler / live transcriber. NaN, 0, negatives,
              // strings, and absurd values would otherwise wedge UI in a
              // stuck "connected" state via an unhandled rejection from
              // OfflineAudioContext or a divide-by-zero in totalSec math.
              //
              // F-81: refuse a second audio-config inside the same
              // recording. The live transcriber binds to the first rate
              // and won't re-bind; the batch resampler reads the current
              // ref, so a mid-stream rate swap would corrupt the final
              // transcript in a way that looks like model error.
              if (remoteMicAudioConfiguredRef.current) {
                console.error('[RemoteMic] Duplicate audio-config mid-recording, closing');
                setRemoteMicError(t('remoteMicInvalidConfig'));
                setRemoteMicStatus('error');
                rtc.close();
                return;
              }
              const sr = msg.sampleRate;
              if (!Number.isInteger(sr) || sr < 8000 || sr > 96000) {
                console.error('[RemoteMic] Invalid audio-config sampleRate:', sr);
                setRemoteMicError(t('remoteMicInvalidConfig'));
                setRemoteMicStatus('error');
                rtc.close();
                return;
              }
              // F-138: validate the optional format hint. An unknown
              // format string would silently land us in the f32 branch
              // and decode Int16 bytes as Float32 (or vice versa),
              // producing a buffer of NaN-or-near-zero noise without any
              // user-visible error. Fall back to 'pcm-f32' for legacy
              // phones that don't send the field, refuse anything else.
              let format = 'pcm-f32';
              if (msg.format !== undefined) {
                if (msg.format !== 'pcm-f32' && msg.format !== 'pcm-s16') {
                  console.error('[RemoteMic] Invalid audio-config format:', msg.format);
                  setRemoteMicError(t('remoteMicInvalidConfig'));
                  setRemoteMicStatus('error');
                  rtc.close();
                  return;
                }
                format = msg.format;
              }
              remoteMicAudioConfiguredRef.current = true;
              remoteMicSampleRateRef.current = sr;
              remoteMicFormatRef.current = format;
              console.log(`[RemoteMic] Phone sample rate: ${sr}Hz, format: ${format}`);
              setRemoteMicRecording(true);
              startRemoteMicTimer();
              // Phone audio is buffered into the same pcmChunksRef the local
              // path uses, so the live transcriber works without any other
              // wiring. Pass a getSampleRate() that reads the phone's rate.
              maybeStartLiveTranscriber({ sampleRate: remoteMicSampleRateRef.current });
            } else if (msg.type === 'audio-end') {
              console.log('[RemoteMic] Phone stopped recording, processing batch...');
              // Set awaitingFinal before flipping remoteMicRecording so the
              // live transcript banner stays visible without flicker.
              setAwaitingFinal(true);
              setRemoteMicRecording(false);
              await stopLiveTranscriberIfRunning();
              // F-82: serialise batch processing. processRemoteMicBatch
              // calls modelRef.current.transcribe against a SHARED ORT
              // session; concurrent invocations either queue silently
              // (breaking the live-pcm freshness invariant) or race on
              // the encoder's intermediate tensors and emit garbage
              // tokens into the user's transcript. await any prior
              // in-flight batch before starting the next.
              if (inFlightBatchRef.current) {
                try { await inFlightBatchRef.current; } catch (_) { /* prior batch error already surfaced */ }
              }
              const thisBatch = processRemoteMicBatch();
              inFlightBatchRef.current = thisBatch;
              thisBatch.finally(() => {
                if (inFlightBatchRef.current === thisBatch) inFlightBatchRef.current = null;
              });
            } else if (msg.type === 'paused') {
              // F-89: only honour paused/resumed while remoteMicRecording
              // is active. Outside a recording these messages can only
              // desync the UI from reality (showing "paused" while the
              // phone is idle, or "resumed" with nothing to resume).
              if (remoteMicRecording) setRemoteMicPaused(true);
              else console.warn('[RemoteMic] Ignoring paused: not recording');
            } else if (msg.type === 'resumed') {
              if (remoteMicRecording) setRemoteMicPaused(false);
              else console.warn('[RemoteMic] Ignoring resumed: not recording');
            } else {
              // Catches protocol drift between desktop and phone bundles —
              // silently dropping unknown types makes mismatches invisible.
              console.warn('[RemoteMic] Unknown control message type:', msg.type);
            }
          } catch (e) {
            // F-86: a throw inside any control-message handler used to
            // be only console.error'd, leaving the UI in 'waiting' or
            // 'connecting' with the QR still up and no user-visible
            // indication of failure. importPublicKey throws on
            // malformed base64 / wrong byte length, deriveSharedKey
            // throws on incompatible curve points, and the in-flight
            // verify resolver would dangle. Tear the session down so
            // the user can retry instead of staring at a wedged modal.
            console.error('[RemoteMic] Error handling control message:', e);
            resolveRemoteMicVerify(false);
            resolveRemoteMicPeerAck(false);
            setRemoteMicError(`Handshake error (${e?.message || 'unknown'})`);
            setRemoteMicStatus('error');
            try { rtc.close(); } catch (_) { /* already closing */ }
          }
        } else {
          // Binary data: encrypted audio chunk
          if (!remoteMicKeyRef.current) return;
          // F-84: refuse binary chunks until the phone has announced its
          // sample rate via audio-config. Without this gate a hostile
          // phone bundle (e.g. a coerced spousal-monitoring build) could
          // skip the audio-config step entirely and stream chunks against
          // the default 16 kHz rate. pcmChunksRef would accumulate and
          // reach the model on the next
          // audio-end, but remoteMicRecording would stay false the whole
          // time so the desktop's UI would show no recording indicator.
          // Dropping chunks until audio-config arrives keeps the
          // "phone is sending audio" state observable on screen.
          if (!remoteMicAudioConfiguredRef.current) {
            console.warn('[RemoteMic] Dropping binary chunk: no audio-config received yet');
            return;
          }
          // F-85: reject oversized binary messages BEFORE allocating the
          // Float32Array. F-01 caps cumulative samples but a single
          // decrypt of an N-byte ciphertext still allocates Float32Array
          // of length N/4 and synchronously RMS-scans it on the main
          // thread. 256 KiB caps a single chunk well above any honest
          // phone payload (16 kHz mono Float32 at 100 ms = 6400 bytes;
          // 96 kHz at 100 ms = 38400 bytes; even a 500 ms burst at
          // 96 kHz is 192 000 bytes) while bounding the main-thread
          // stall a flooding phone can inflict.
          const REMOTE_MIC_MAX_BINARY_BYTES = 256 * 1024;
          if (data.byteLength > REMOTE_MIC_MAX_BINARY_BYTES) {
            console.warn(`[RemoteMic] Dropping binary chunk: ${data.byteLength} bytes exceeds ${REMOTE_MIC_MAX_BINARY_BYTES}`);
            setRemoteMicDecryptErrors((n) => n + 1);
            return;
          }
          try {
            const decrypted = await decrypt(data, remoteMicKeyRef.current);
            // Dispatch on the per-session format. 'pcm-s16' phones send
            // little-endian Int16 (~v5.4.6+, halves the wire size);
            // 'pcm-f32' phones send native-endian Float32 (legacy). Both
            // sides run on little-endian hardware in practice, so the
            // bare typed-array view is byte-order-correct without a
            // DataView pass. The format ref is set from audio-config and
            // is validated there; an unknown value can't reach this code.
            let float32;
            let sum = 0;
            const fmt = remoteMicFormatRef.current;
            if (fmt === 'pcm-s16') {
              if (decrypted.byteLength % 2 !== 0) {
                console.warn('[RemoteMic] Dropped pcm-s16 chunk: byteLength not a multiple of 2');
                setRemoteMicDecryptErrors((n) => n + 1);
                return;
              }
              const int16 = new Int16Array(decrypted);
              float32 = new Float32Array(int16.length);
              for (let i = 0; i < int16.length; i++) {
                const s = int16[i] / 0x8000;
                float32[i] = s;
                sum += s * s;
              }
            } else {
              if (decrypted.byteLength % 4 !== 0) {
                console.warn('[RemoteMic] Dropped pcm-f32 chunk: byteLength not a multiple of 4');
                setRemoteMicDecryptErrors((n) => n + 1);
                return;
              }
              float32 = new Float32Array(decrypted);
              // AES-GCM authenticates the bytes but a peer holding the
              // legitimate key can still encrypt arbitrary 4-byte
              // patterns; NaN/Infinity would otherwise propagate into the
              // level meter, the resampler, and the model input,
              // silently corrupting the user's transcript. (No equivalent
              // check needed for pcm-s16: every 16-bit integer maps to a
              // finite float on the / 0x8000 line above.)
              let finite = true;
              for (let i = 0; i < float32.length; i++) {
                const s = float32[i];
                if (!Number.isFinite(s)) { finite = false; break; }
                sum += s * s;
              }
              if (!finite) {
                console.warn('[RemoteMic] Dropped chunk containing non-finite samples');
                setRemoteMicDecryptErrors((n) => n + 1);
                return;
              }
            }
            // Drop chunks once the per-session sample cap is reached. The
            // first overflow surfaces an error; later chunks short-circuit
            // silently so a flooding phone can't spam the UI.
            if (remoteMicSampleCountRef.current >= REMOTE_MIC_MAX_SAMPLES) return;
            const newCount = remoteMicSampleCountRef.current + float32.length;
            if (newCount > REMOTE_MIC_MAX_SAMPLES) {
              remoteMicSampleCountRef.current = REMOTE_MIC_MAX_SAMPLES;
              console.error('[RemoteMic] Sample cap reached, dropping further audio chunks');
              setRemoteMicError(t('remoteMicCapExceeded'));
              return;
            }
            appendPcmChunk(float32);
            remoteMicSampleCountRef.current = newCount;
            const rms = Math.sqrt(sum / float32.length);
            setRemoteMicLevel(Math.min(100, rms * 250));
          } catch (e) {
            // Don't swallow this: the user thinks audio is being received,
            // but every chunk is failing — surface a running count so the
            // modal shows the loss instead of just the first error.
            console.warn('[RemoteMic] Decrypt error:', e.message);
            setRemoteMicDecryptErrors((n) => n + 1);
            setRemoteMicError(`Decryption failed (${e.message})`);
          }
        }
      };

      await rtc.createOfferAndStore();

      // Build QR code URL
      const baseUrl = window.location.origin;
      const qrUrl = `${baseUrl}/remote-mic.html#${roomId}:${secret}`;

      setRemoteMicStatus('waiting');
      setRemoteMicQrUrl(qrUrl);

      // Send our public key once the data channel opens, then wait for answer
      const originalOnConnected = rtc.onConnected;
      rtc.onConnected = () => {
        if (originalOnConnected) originalOnConnected();
        rtc.sendMessage({ type: 'public-key', key: ourKeyBase64 });
      };

      // Long-poll for the phone's answer (blocks until phone joins)
      await rtc.waitForAnswer();

    } catch (e) {
      console.error('[RemoteMic] Error:', e);
      setRemoteMicStatus('error');
      setRemoteMicError(e.message || 'Connection failed');
    }
  }

  // Process the current batch of remote mic audio and reset for next recording.
  // Keeps the RTC connection alive.
  async function processRemoteMicBatch() {
    // Stop elapsed timer and reset level
    stopRemoteMicTimer();
    setRemoteMicLevel(0);
    setRemoteMicElapsed(0);
    setRemoteMicPaused(false);

    const rawPcm = concatPcmChunks();
    const totalSamples = rawPcm.length;
    clearPcmChunks();

    if (totalSamples === 0) {
      console.log('[RemoteMic] No audio received in this batch');
      // Nothing to transcribe, so processAudioFile will not run and clear
      // the awaiting flag for us.
      setAwaitingFinal(false);
      return;
    }

    const sourceSampleRate = remoteMicSampleRateRef.current;
    console.log(`[RemoteMic] Captured ${totalSamples} samples at ${sourceSampleRate}Hz (${(totalSamples / sourceSampleRate).toFixed(2)}s)`);

    // Resample to 16kHz if needed
    const targetSampleRate = 16000;
    const pcm16k = await resamplePcmTo16k(rawPcm, sourceSampleRate);
    console.log(`[RemoteMic] Final: ${pcm16k.length} samples at 16kHz (${(pcm16k.length / 16000).toFixed(2)}s)`);

    // Build WAV and feed to the transcription core. It travels with the entry.
    const wavBlob = createWavBlob(pcm16k, targetSampleRate);
    const file = new File([wavBlob], `remote-mic-${Date.now()}.wav`, { type: 'audio/wav' });
    setStatus('modelReady');

    // Feed the already-16kHz PCM directly so we don't decode+resample the WAV a
    // second time (see stopRecording).
    if (modelRef.current) {
      console.log('[RemoteMic] Transcribing...');
      const safeName = sanitizeDeviceName(file.name, 'file');
      runTranscription(pcm16k, { safeName, audioDuration: pcm16k.length / targetSampleRate, audioBlob: wavBlob });
    }
  }

  async function stopRemoteMic() {
    // Stop current recording but keep phone session alive
    setAwaitingFinal(true);
    await processRemoteMicBatch();
    if (remoteMicRtcRef.current) {
      try { remoteMicRtcRef.current.sendMessage({ type: 'stop-recording' }); } catch (_) {}
    }
    setRemoteMicRecording(false);
    setRemoteMicPaused(false);
  }

  async function disconnectRemoteMic() {
    // Full teardown, close RTC, phone goes to STOPPED
    setAwaitingFinal(true);
    await processRemoteMicBatch();
    if (remoteMicRtcRef.current) {
      try { remoteMicRtcRef.current.sendMessage({ type: 'stop' }); } catch (_) {}
      remoteMicRtcRef.current.close();
      remoteMicRtcRef.current = null;
    }
    resolveRemoteMicVerify(false);
    resolveRemoteMicPeerAck(false);
    remoteMicKeyRef.current = null;
    stopRemoteMicTimer();
    setRemoteMicVerifiedAt(null);
    setIsRemoteMic(false);
    setRemoteMicRecording(false);
    setRemoteMicModal(false);
    setRemoteMicLevel(0);
    setRemoteMicPaused(false);
  }

  function pauseRemoteMic() {
    if (remoteMicRtcRef.current) {
      remoteMicRtcRef.current.sendMessage({ type: 'pause' });
    }
    setRemoteMicPaused(true);
  }

  function resumeRemoteMic() {
    if (remoteMicRtcRef.current) {
      remoteMicRtcRef.current.sendMessage({ type: 'resume' });
    }
    setRemoteMicPaused(false);
  }

  function regenerateRemoteMicQr() {
    // Tear down leftover state and start fresh, produces a new roomId/secret/QR.
    stopRemoteMicTimer();
    resolveRemoteMicVerify(false);
    resolveRemoteMicPeerAck(false);
    if (remoteMicRtcRef.current) {
      try { remoteMicRtcRef.current.close(); } catch (_) {}
      remoteMicRtcRef.current = null;
    }
    remoteMicKeyRef.current = null;
    clearPcmChunks();
    setRemoteMicQrUrl('');
    setRemoteMicLevel(0);
    setRemoteMicPaused(false);
    setRemoteMicRecording(false);
    setIsRemoteMic(false);
    startRemoteMic();
  }

  function cancelRemoteMic() {
    stopRemoteMicTimer();
    resolveRemoteMicVerify(false);
    resolveRemoteMicPeerAck(false);
    if (remoteMicRtcRef.current) {
      remoteMicRtcRef.current.close();
      remoteMicRtcRef.current = null;
    }
    remoteMicKeyRef.current = null;
    setRemoteMicVerifiedAt(null);
    setIsRemoteMic(false);
    setRemoteMicRecording(false);
    setRemoteMicModal(false);
    setRemoteMicLevel(0);
    setRemoteMicQrUrl('');
    clearPcmChunks();
  }

  // --- Dictation device (SpeechMike) integration ---
  // Sets up a DictationDeviceManager, wires RECORD/STOP button events to the
  // recording lifecycle, and stores the manager for cleanup.  The `isRecordingRef`
  // / `isPausedRef` pattern avoids stale-closure issues inside the HID callback.
  const isRecordingRef = useRef(isRecording);
  const isPausedRef = useRef(isPaused);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // Initialise a DictationDeviceManager, register button listener, and
  // optionally trigger the WebHID device-picker (requestDevice = true).
  async function initDictationManager(requestDevice = false) {
    if (!dictationEnabled) return;
    // Avoid creating multiple managers
    if (dictationManagerRef.current) return dictationManagerRef.current;

    const lib = await getDictationLib();
    if (!lib) return;
    const { DictationDeviceManager, ButtonEvent } = lib;

    const manager = new DictationDeviceManager();
    await manager.init();

    // Wire physical buttons to recording actions
    manager.addButtonEventListener((_device, bitMask) => {
      console.log('[Dictation] Button event received, bitMask:', bitMask);

      let handled = false;

      // RECORD pressed → start recording (only when not recording)
      if (bitMask & ButtonEvent.RECORD) {
        handled = true;
        if (!isRecordingRef.current) {
          startRecordingCountdown();
        } else {
          console.log('[Dictation] RECORD pressed while already recording – ignored (use PLAY to pause/resume)');
        }
      }

      // PLAY pressed → pause / resume (only while recording)
      if (bitMask & ButtonEvent.PLAY) {
        handled = true;
        if (isRecordingRef.current) {
          if (!isPausedRef.current) {
            pauseRecording();
          } else {
            resumeRecording();
          }
        } else {
          console.log('[Dictation] PLAY pressed while not recording – ignored');
        }
      }

      // STOP pressed → stop if recording, otherwise start
      if (bitMask & ButtonEvent.STOP) {
        handled = true;
        if (isRecordingRef.current) {
          stopRecording();
        } else {
          console.log('[Dictation] STOP pressed while not recording – starting recording instead');
          startRecordingCountdown();
        }
      }

      if (!handled) {
        console.log('[Dictation] Unhandled button event, bitMask:', bitMask);
      }
    });

    // Update UI when a device is physically disconnected
    manager.addDeviceDisconnectedEventListener(() => {
      const remaining = manager.getDevices();
      setDictationDevice(remaining.length > 0
        ? sanitizeDeviceName(remaining[0].hidDevice.productName)
        : null);
    });

    // Update UI when a new device is connected (e.g. re-plugged)
    manager.addDeviceConnectedEventListener((device) => {
      setDictationDevice(sanitizeDeviceName(device.hidDevice.productName));
    });

    if (requestDevice) {
      const devices = await manager.requestDevice();
      if (devices.length > 0) {
        setDictationDevice(sanitizeDeviceName(devices[0].hidDevice.productName));
      }
    } else {
      // Auto-reconnect: check for already-paired devices (no user gesture needed)
      const devices = manager.getDevices();
      if (devices.length > 0) {
        setDictationDevice(sanitizeDeviceName(devices[0].hidDevice.productName));
      }
    }

    dictationManagerRef.current = manager;
    return manager;
  }

  // User-triggered: opens the WebHID picker to pair a new device.
  // If WebHID is unavailable (non-Chromium browser), show an explanatory
  // alert instead of silently doing nothing.
  async function connectDictationDevice() {
    if (typeof navigator === 'undefined' || !navigator.hid) {
      alert(t('dictationWebhidUnsupported'));
      return;
    }
    try {
      const manager = dictationManagerRef.current || await initDictationManager(false);
      if (!manager) return;
      const devices = await manager.requestDevice();
      if (devices.length > 0) {
        setDictationDevice(sanitizeDeviceName(devices[0].hidDevice.productName));
      }
    } catch (err) {
      console.error('[Dictation] Failed to connect device:', err);
    }
  }

  // Auto-reconnect previously paired devices on mount (no user gesture needed
  // for devices the user already granted permission to).
  useEffect(() => {
    if (!dictationEnabled || !navigator.hid) return;
    initDictationManager(false);
    return () => {
      if (dictationManagerRef.current) {
        dictationManagerRef.current.shutdown().catch(console.error);
        dictationManagerRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On browsers without WebHID (Firefox, Safari, ...), we cannot pair a
  // dictation device. We can still *guess* one is plugged in by looking at
  // audio-input device labels: enumerateDevices() only returns populated
  // labels once microphone permission has been granted (so this runs both
  // on mount and after mic permission events), but if a label matches we
  // surface a banner pointing the user at a Chromium browser.
  useEffect(() => {
    if (!dictationEnabled) return;
    if (typeof navigator === 'undefined') return;
    if (navigator.hid) return; // Chromium path is handled above
    if (!navigator.mediaDevices?.enumerateDevices) return;

    const DICTATION_LABEL_RX = /speechmike|philips\s*(speech|dict)|olympus\s*(dict|rec)|grundig\s*dict|dictation/i;

    let cancelled = false;
    const check = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const match = devices.some(d => d.kind === 'audioinput' && d.label && DICTATION_LABEL_RX.test(d.label));
        setDictationSuspectedNoWebhid(match);
      } catch (err) {
        console.warn('[Dictation] enumerateDevices failed:', err);
      }
    };
    check();
    // Re-check when the device list changes (e.g. user plugs the mike in
    // after page load, or grants mic permission which unmasks labels).
    navigator.mediaDevices.addEventListener?.('devicechange', check);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', check);
    };
  }, [dictationEnabled]);

  // Helper function to resample audio to 16kHz mono and create a WAV blob for preview

  // Helper to create a WAV blob from PCM Float32Array
  function createWavBlob(pcmData, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Convert float32 PCM to int16
    const offset = 44;
    for (let i = 0; i < pcmData.length; i++) {
      const sample = Math.max(-1, Math.min(1, pcmData[i]));
      view.setInt16(offset + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function processAudioFile(file) {
    if (!modelRef.current) return alert(t('loadModelFirst'));
    if (!file) return;

    // F-124: OS-controlled file.name can contain bidi-override / control
    // codepoints; sanitize once and use the cleaned name in every
    // user-visible string. Raw file.name still goes to console.log /
    // console.time below since those are devtools-only.
    const safeName = sanitizeDeviceName(file.name, 'file');

    setIsTranscribing(true);
    setStatus(`${t('transcribingFile')} "${safeName}"…`);

    // Hoisted so the outer finally can close the AudioContext even if the
    // transcription path throws. The decoded native-rate AudioBuffer plus
    // the audio thread can hold hundreds of MB for long files; leaving them
    // alive while the user transcribes a sequence of files balloons memory.
    let audioCtx = null;
    try {
      console.log(`[Transcribe] Starting transcription for file: "${file.name}"`);
      console.log(`[Transcribe] File details:`, {
        name: file.name,
        type: file.type,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        lastModified: new Date(file.lastModified).toISOString()
      });

      console.log(`[Transcribe] Reading file as ArrayBuffer...`);
      let buf = await file.arrayBuffer();
      console.log(`[Transcribe] ArrayBuffer loaded, size: ${buf.byteLength} bytes`);

      console.log(`[Transcribe] Creating AudioContext at native sample rate...`);
      audioCtx = new AudioContext();  // Use native rate
      console.log(`[Transcribe] AudioContext created:`, {
        sampleRate: audioCtx.sampleRate,
        state: audioCtx.state,
        baseLatency: audioCtx.baseLatency
      });

      console.log(`[Transcribe] Decoding audio data...`);
      let decoded = await audioCtx.decodeAudioData(buf);
      buf = null; // the ArrayBuffer is no longer needed once decoded
      console.log(`[Transcribe] Audio decoded successfully at native rate:`, {
        duration: `${decoded.duration.toFixed(2)}s`,
        numberOfChannels: decoded.numberOfChannels,
        sampleRate: decoded.sampleRate,
        length: decoded.length
      });

      // Properly resample to 16kHz using OfflineAudioContext
      const targetSampleRate = 16000;
      console.log(`[Transcribe] Resampling from ${decoded.sampleRate}Hz to ${targetSampleRate}Hz...`);
      
      // Yield to UI before heavy resampling operation
      await new Promise(resolve => setTimeout(resolve, 0));
      setStatus(`${t('processingResampling')} "${safeName}"`);
      setProgressText(t('resamplingTo16k'));

      const resampleStart = performance.now();
      const offlineCtx = new OfflineAudioContext(
        1,  // mono
        Math.ceil(decoded.duration * targetSampleRate),
        targetSampleRate
      );
      
      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(offlineCtx.destination);
      source.start();

      let resampled = await offlineCtx.startRendering();

      // Yield to UI after heavy resampling operation
      await new Promise(resolve => setTimeout(resolve, 0));

      const pcm = resampled.getChannelData(0);

      // The native-rate AudioBuffer is large (often >100MB for hour-long
      // files at 48kHz stereo). Now that pcm is in hand, drop references so
      // GC can reclaim them before the chunking loop allocates its own
      // working memory. Closing audioCtx also signals the audio thread it
      // can release the decoded buffer it still holds.
      decoded = null;
      resampled = null;
      try { await audioCtx.close(); } catch (_) { /* already closed */ }
      audioCtx = null;

      const resampleSeconds = (performance.now() - resampleStart) / 1000;
      console.log(`[Transcribe] Resampled successfully to ${targetSampleRate}Hz in ${resampleSeconds.toFixed(2)}s`);
      const audioDuration = pcm.length / 16000;
      
      // Find min/max without spreading to avoid "too many arguments" error
      let minVal = Infinity, maxVal = -Infinity;
      for (let i = 0; i < Math.min(pcm.length, 10000); i++) {
        if (pcm[i] < minVal) minVal = pcm[i];
        if (pcm[i] > maxVal) maxVal = pcm[i];
      }
      
      console.log(`[Transcribe] Extracted PCM data from channel 0:`, {
        length: pcm.length,
        duration: `${audioDuration.toFixed(2)}s`,
        samplesPerSecond: targetSampleRate,
        min: minVal,
        max: maxVal,
        note: pcm.length > 10000 ? '(min/max from first 10k samples)' : undefined
      });

      // Build a 16 kHz WAV from the resampled PCM so the resulting history
      // entry can carry a playable copy of exactly what the model heard. Kept
      // in memory only (never persisted; see slimTranscriptForPersist).
      const audioBlob = createWavBlob(pcm, targetSampleRate);

      // Hand the already-resampled PCM to the shared transcription core. It
      // owns the model call, the history entry and auto-copy; this path owns
      // audio decode + resample. "Transcribe again" calls runTranscription
      // directly with the stored PCM, skipping a second (lossy) resample.
      await runTranscription(pcm, { safeName, audioDuration, audioBlob });
    } catch (error) {
      // Only the decode/resample stage can throw here: runTranscription owns
      // (and swallows) model-side errors. Surface decode failures the same way.
      console.error('[Transcribe] Audio decode/resample failed:', error);
      setStatus('transcriptionFailed');
      setIsTranscribing(false);
      setAwaitingFinal(false);
      // F-124: file.name is OS-controlled and can contain bidi-override or
      // control codepoints. safeName is already sanitized above.
      alert(`Failed to transcribe "${safeName}": ${transcribeErrorMessage(error)}`);
    } finally {
      // If we threw before the explicit close above, the AudioContext is
      // still holding the decoded buffer + an audio thread. Make sure it
      // shuts down on every exit path.
      if (audioCtx) {
        try { await audioCtx.close(); } catch (_) { /* already closed */ }
      }
    }
  }

  // Format a transcription error into a user-facing alert string. Shared by the
  // decode path (processAudioFile) and the model path (runTranscription).
  function transcribeErrorMessage(error) {
    let errorMsg = 'Unknown error';
    if (error) {
      if (error.message) {
        errorMsg = error.message;
      } else if (error.name) {
        errorMsg = `${error.name} - The audio file format may not be supported. Try converting to WAV format.`;
      } else if (typeof error === 'string') {
        errorMsg = error;
      }
    }
    return error?.stack
      ? `${errorMsg}\n\nCheck console for full error details and stack trace.`
      : errorMsg;
  }

  // Shared transcription core: runs the model on already-16kHz PCM and either
  // appends a new history entry or replaces an existing one in place
  // (replaceId). The caller owns audio decode/resample, so this never touches
  // an AudioContext: the record/upload path (processAudioFile) and "Transcribe
  // again" (which feeds stored PCM, skipping a second resample) both reuse it.
  // audioBlob/pcm are attached to NEW entries only and live in memory.
  async function runTranscription(pcm, { safeName, audioDuration, audioBlob = null, replaceId = null }) {
    setIsTranscribing(true);
    setStatus(`${t('transcribingFile')} "${safeName}"…`);
    try {
      // Chunk large audio files to avoid "too many function arguments" error
      // This happens when audio is very long and internal operations hit JS engine limits
      // Chunking can be toggled off to send full audio to the model in one pass
      const MAX_CHUNK_DURATION = chunkDuration; // seconds (user-configurable)

      // Wall-clock timer for the whole transcription (covers both the chunked
      // and single-pass branches below) plus an accumulator for the decode
      // phase. Decode is the only stage whose cost scales ~linearly with beam
      // width (preprocess/encode/tokenize run once per chunk regardless), so
      // summing decode_ms lets us estimate the single-beam (greedy) wall time.
      // decode_ms is only populated when profiling is on, which we enable below
      // whenever beamWidth > 1 (the only case the estimate is meaningful).
      const transcribeStartTime = performance.now();
      let totalDecodeMs = 0;

      // Chunking, overlap and per-chunk stitching live in
      // ParakeetModel.transcribeChunked() so the web UI and the CLI harness
      // (scripts/transcribe.mjs) share one code path and cannot drift. The UI
      // only supplies the per-chunk callback that drives the progress bar and
      // streams partial text. Throttle state is kept across callback calls.
      let lastReportedProgress = -1; // update UI only when the % actually moves
      let runningProcessingMs = 0;   // sum of per-chunk model time for the ETA
      let chunksCompleted = 0;

      const res = await modelRef.current.transcribeChunked(pcm, 16000, {
        enableChunking,
        chunkDurationSec: MAX_CHUNK_DURATION,
        overlapSec: 2,
        returnTimestamps: true,
        returnConfidences: true,
        frameStride,
        // Pinned to 0: temperature never changes the transcript (greedy argmax
        // is scale-invariant; MAES ranks at temperature 1 regardless), it only
        // feeds confidence scores, where any value above 0 just adds noise.
        // Passed explicitly so we don't inherit transcribe()'s 1.2 default.
        temperature: 0,
        beamWidth,
        maesNumSteps,
        maesExpansionBeta,
        maesExpansionGamma,
        maesPrefixAlpha,
        enableProfiling: beamWidth > 1,
        phraseBoost: phraseBoostRef.current,
      }, async ({ chunkNum, totalChunks, result, partialText, elapsedMs }) => {
        // decode_ms scales with beam width; sum it for the single-beam estimate.
        totalDecodeMs += result.metrics?.decode_ms || 0;
        runningProcessingMs += result.metrics?.total_ms || 0;
        chunksCompleted += 1;

        // Single-pass (no chunking): no incremental UI, only metrics bookkeeping.
        if (totalChunks <= 1) return;

        console.log(`[Transcribe] Completed chunk ${chunkNum}/${totalChunks}`);

        // Only update the UI when the rounded progress actually advances (or on
        // the last chunk) to avoid thrashing the renderer on short chunks.
        const chunkProgress = Math.round((chunkNum / totalChunks) * 100);
        if (chunkProgress <= lastReportedProgress && chunkNum !== totalChunks) return;
        lastReportedProgress = chunkProgress;

        const avgChunkTime = runningProcessingMs / chunksCompleted;
        const estimatedRemaining = (totalChunks - chunkNum) * avgChunkTime / 1000;

        // Wrap UI updates in startTransition to keep the UI responsive.
        startTransition(() => {
          setText(partialText + ' [transcribing...]');
          setProgressPct(chunkProgress);
          setProgressText(`✓ Completed chunk ${chunkNum} of ${totalChunks} (${chunkProgress}%) • ${formatDuration(elapsedMs/1000)} • Est. ${formatDuration(estimatedRemaining)} remaining`);
          setStatus(`${t('transcribingFile')} "${safeName}" - ${chunkProgress}% ${t('complete')} (${t('chunk')} ${chunkNum}/${totalChunks})`);
          if (chunkNum === 1) setLatestMetrics(result.metrics);
        });

        // Yield to the browser so the progress paint lands between chunks.
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Clear progress indicators (no-op when no chunk UI ran).
      setProgressPct(null);
      setProgressText('');
      console.log(`[Transcribe] Transcription completed successfully`);

      // Total wall time for the entire audio. When a wide beam was used, also
      // report the estimated single-beam (greedy) time so the cost of the beam
      // width is visible: only the decode phase scales with beam width, so the
      // estimate keeps the beam-independent wall time and divides decode by it.
      const transcribeElapsedMs = performance.now() - transcribeStartTime;
      // RTF = Real-Time Factor: processing time / audio duration. RTF < 1 means
      // faster than real time (e.g. 0.25 = a 60s clip transcribed in 15s).
      const rtf = audioDuration > 0 ? (transcribeElapsedMs / 1000) / audioDuration : 0;
      let transcribeTimeLog = `[Transcribe] Total time for entire audio: ${formatDuration(transcribeElapsedMs / 1000)} (RTF ${rtf.toFixed(3)})`;
      if (beamWidth > 1 && totalDecodeMs > 0) {
        const nonDecodeMs = Math.max(0, transcribeElapsedMs - totalDecodeMs);
        const singleBeamMs = nonDecodeMs + totalDecodeMs / beamWidth;
        transcribeTimeLog += ` (~${formatDuration(singleBeamMs / 1000)} estimated with beamWidth=1, current beamWidth=${beamWidth})`;
      }
      console.log(transcribeTimeLog);

      setLatestMetrics(res.metrics);

      // Fields refreshed on every run, whether we append or replace in place.
      const resultFields = {
        filename: safeName,
        text: res.utterance_text,
        timestamp: new Date().toLocaleTimeString(),
        duration: audioDuration, // original duration (without padding)
        wordCount: res.words?.length || 0,
        confidence: res.confidence_scores?.token_avg ?? res.confidence_scores?.word_avg ?? null,
        metrics: res.metrics,
        words: res.words || [] // Store word-level data with confidence scores
      };

      if (replaceId != null) {
        // "Transcribe again": update the existing entry's text/words/metrics in
        // place, keeping its id and its attached audio (pcm/audioBlob/duration).
        newestTranscriptionIdRef.current = replaceId;
        setTranscriptions(prev => prev.map(tr => tr.id === replaceId ? { ...tr, ...resultFields } : tr));
      } else {
        const newTranscription = {
          id: Date.now(),
          ...resultFields,
          // In-memory only: the resampled audio the model heard plus the WAV
          // blob for the inline player. Dropped on persist and on reload.
          pcm,
          audioBlob,
          audioDuration,
        };
        newestTranscriptionIdRef.current = newTranscription.id;
        setTranscriptions(prev => [newTranscription, ...prev]);
      }
      setText(res.utterance_text); // Show latest transcription
      setStatus('modelReady'); // Ready for next file

      // Auto-copy transcription to clipboard if enabled
      if (autoCopyToClipboard && res.utterance_text) {
        try {
          const textToCopy = transcriptDisplayMode === 'dictation' && dictationRegexRules.length > 0
            ? applyDictationRegex(res.utterance_text)
            : res.utterance_text;
          await navigator.clipboard.writeText(sanitizeClipboardText(textToCopy));
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2000);
          console.log('[Transcribe] Auto-copied transcription to clipboard');
        } catch (err) {
          console.error('[Transcribe] Auto-copy to clipboard failed:', err);
        }
      }
    } catch (error) {
      console.error('[Transcribe] Transcription failed with error:', error);
      console.error('[Transcribe] Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        type: typeof error,
        errorObject: error
      });
      setStatus('transcriptionFailed');
      alert(`Failed to transcribe "${safeName}": ${transcribeErrorMessage(error)}`);
    } finally {
      setIsTranscribing(false);
      // The final transcription has now been pushed (or the run failed and
      // the user has been alerted). Either way, drop the awaiting indicator.
      setAwaitingFinal(false);
    }
  }

  async function transcribeFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Clear the input up front so the same file can be picked again after a
    // refusal (the value only changes when a *different* file is chosen).
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // The model must be fully ready before we accept a file. If it is still
    // loading (or was never loaded), refuse the file outright with a clear
    // message instead of silently dropping it when processAudioFile later
    // bails on the same guard.
    if (!modelRef.current) {
      alert(status === 'loadingModel' ? t('modelStillLoading') : t('loadModelFirst'));
      return;
    }

    // Transcribe the uploaded file immediately. processAudioFile decodes +
    // resamples to 16kHz, then runTranscription appends a history entry that
    // carries the resampled audio for inline playback / "Transcribe again".
    await processAudioFile(file);
  }

  function clearTranscriptions() {
    setTranscriptions([]);
    setText('');
    // Revoke every inline-player URL so the discarded audio leaves no leak.
    for (const id of [...entryAudioUrlsRef.current.keys()]) revokeEntryAudioUrl(id);
    setOpenAudioIds(new Set());
    // Forget the on-disk copy too. If persistTranscripts is OFF the key
    // may not exist; idbDelete on a missing key is a no-op.
    forgetPersistedTranscripts();
  }

  async function resetAllData() {
    const confirmed = window.confirm(
      t('resetConfirmTitle') + '\n\n' +
      t('resetConfirmQuestion')
    );
    
    if (!confirmed) return;
    
    try {
      // Clear all settings from IndexedDB
      await clearAllSettings();

      // Also wipe the model cache (completed weights and any partial-download
      // chunks live in a separate IndexedDB), so reset truly starts from zero.
      await clearModelCache();

      // F-128: wipe the dedicated transcripts DB explicitly.
      await forgetPersistedTranscripts();

      // F-129: the user-facing "delete all data" copy promises a virgin app.
      // localStorage holds parakeetweb_lang (i18n) and eruda-* keys when the
      // page was loaded with ?debug=1; sessionStorage holds the low-RAM
      // dismissal flag. Clear the whole scopes rather than allowlisting keys
      // so a future regression that adds a new localStorage key is wiped too.
      // The origin is dedicated to parakeet, so there are no legitimate
      // non-parakeet keys to preserve.
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}

      // Clear transcriptions
      setTranscriptions([]);
      setText('');

      // Reload the page to reset all state to defaults
      window.location.reload();
    } catch (err) {
      console.error('[App] Failed to reset all data:', err);
      alert(t('resetFailed'));
    }
  }

  async function copyToClipboard() {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(sanitizeClipboardText(text));
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('[Copy] Failed to copy text:', err);
      alert(t('failedCopyClipboard'));
    }
  }

  async function copyHistoryItem(transcription) {
    if (!transcription?.text) return;
    // F-127: defense in depth: refuse to copy if any modal is foregrounded
    // even if the kebab dropdown was already open before the modal mounted.
    if (anyModalOpen) return;

    try {
      await navigator.clipboard.writeText(sanitizeClipboardText(getDisplayText(transcription)));
      setCopiedHistoryId(transcription.id);
      setTimeout(() => setCopiedHistoryId(null), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('[Copy] Failed to copy text:', err);
      alert(t('failedCopyClipboard'));
    }
  }

  // Remove a single transcription entry from the list
  function deleteTranscription(id) {
    setTranscriptions(prev => prev.filter(t => t.id !== id));
    setOpenKebabId(null);
    revokeEntryAudioUrl(id);
    setOpenAudioIds(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next; });
  }

  // --- Per-entry display mode + inline audio player helpers ---

  // The display mode for one entry: its own override, else the global default.
  function getEntryMode(id) {
    return entryDisplayModes[id] ?? transcriptDisplayMode;
  }
  function setEntryMode(id, mode) {
    setEntryDisplayModes(prev => ({ ...prev, [id]: mode }));
  }

  // Lazily mint (and cache) the object URL backing an entry's inline player.
  function getEntryAudioUrl(trans) {
    if (!trans.audioBlob) return null;
    const cached = entryAudioUrlsRef.current.get(trans.id);
    if (cached) return cached;
    const url = URL.createObjectURL(trans.audioBlob);
    entryAudioUrlsRef.current.set(trans.id, url);
    return url;
  }
  // Revoke and forget an entry's player URL (on close / delete / clear).
  function revokeEntryAudioUrl(id) {
    const url = entryAudioUrlsRef.current.get(id);
    if (url) {
      try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
      entryAudioUrlsRef.current.delete(id);
    }
  }
  // Toggle the inline audio player for an entry; revoke its URL when collapsing.
  function toggleAudio(id) {
    setOpenAudioIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); revokeEntryAudioUrl(id); }
      else next.add(id);
      return next;
    });
  }

  // Re-run the full transcription pipeline on an entry's stored audio with the
  // current settings (beam width, chunking, phrase boost, ...), then replace
  // that entry's text/words/metrics in place. Reuses the resampled PCM the model
  // already heard, so it skips audio decode/resample entirely (no over-applying
  // the audio preprocessing that already ran when the entry was created).
  async function transcribeAgain(trans) {
    if (!trans?.pcm || !modelRef.current || isTranscribing) return;
    setReTranscribingId(trans.id);
    try {
      await runTranscription(trans.pcm, {
        safeName: trans.filename,
        audioDuration: trans.audioDuration ?? trans.duration,
        replaceId: trans.id,
      });
    } finally {
      setReTranscribingId(null);
    }
  }

  // Revoke any outstanding inline-player URLs when the app unmounts.
  useEffect(() => () => {
    for (const url of entryAudioUrlsRef.current.values()) {
      try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
    }
    entryAudioUrlsRef.current.clear();
  }, []);

  // Load dictation regex rules from CSV files served at /dictation-regex/
  useEffect(() => {
    async function loadDictationRegex() {
      try {
        // Try to fetch the manifest first
        const manifest = await fetchTextCapped('/dictation-regex/manifest.txt');
        if (!manifest.ok) {
          if (manifest.oversize) {
            console.warn('[Dictation] manifest.txt exceeds size cap; refusing to load any rules', manifest.declared);
          } else {
            console.log('[Dictation] No regex manifest found, dictation mode unavailable (download rules via Docker entrypoint)');
          }
          setDictationRegexLoaded(true);
          return;
        }
        const manifestText = manifest.text;
        const files = manifestText.trim().split('\n').filter(f => f.endsWith('.csv'));

        const rules = [];
        for (const file of files) {
          try {
            const r = await fetchTextCapped(`/dictation-regex/${file}`);
            if (!r.ok) {
              if (r.oversize) {
                console.warn(`[Dictation] ${file} exceeds size cap; skipping`, r.declared);
              }
              continue;
            }
            const csvText = r.text;
            const lines = csvText.trim().split('\n');
            // Parse header to find column indices
            const header = parseCSVLine(lines[0].trim()).map(h => h.trim().toLowerCase());
            const regexIdx = header.indexOf('regex');
            const replacementIdx = header.indexOf('remplacement') !== -1 ? header.indexOf('remplacement') : header.indexOf('replacement');
            if (regexIdx === -1 || replacementIdx === -1) {
              console.warn(`[Dictation] ${file}: could not find 'regex' and 'remplacement' columns in header: ${lines[0]}`);
              continue;
            }
            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line || line === ',,') continue;
              // Parse CSV: handle quoted fields
              const fields = parseCSVLine(line);
              const rawRegex = fields[regexIdx] ?? '';
              const rawReplacement = fields[replacementIdx] ?? '';
              if (!rawRegex) continue;
              try {
                // Extract Python-style inline flags (e.g. (?i), (?ims)) from the
                // pattern and translate to JS RegExp flags so case-sensitive
                // rules don't silently become insensitive.
                let cleanedRegex = rawRegex;
                let parsedFlags = '';
                cleanedRegex = cleanedRegex.replace(/\(\?([gimsuy]+)\)/g, (_, fl) => {
                  parsedFlags += fl;
                  return '';
                });
                // Default to case-insensitive when no flags specified (preserves
                // historical behaviour for rules that omit (?i)).
                const jsFlags = 'g' + (parsedFlags
                  ? [...new Set(parsedFlags.split(''))].filter(f => 'imsuy'.includes(f)).join('')
                  : 'i');
                new RegExp(cleanedRegex, jsFlags);
                const replacement = rawReplacement
                  .replace(/\\n/g, '\n') // support \n in replacements
                  .replace(/^"(.*)"$/, '$1'); // strip outer quotes
                // Refuse replacements containing C0/C1 controls (ESC, BEL,
                // backspace, OSC introducer) and bidi-override codepoints.
                // The auto-copy-to-clipboard path writes this directly into
                // the user's system clipboard; a tampered upstream CSV
                // could otherwise smuggle ANSI/OSC sequences that execute
                // on paste-to-terminal in shells without bracketed-paste.
                // Tab and newline are kept explicitly because they are
                // legitimate replacement content.
                if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f‪-‮⁦-⁩]/.test(replacement)) {
                  console.warn(`[Dictation] Rejecting rule in ${file} line ${i + 1}: replacement contains control or bidi characters`);
                  continue;
                }
                rules.push({
                  regex: cleanedRegex,
                  flags: jsFlags,
                  replacement,
                  source: file.replace('.csv', '')
                });
              } catch (e) {
                console.warn(`[Dictation] Invalid regex in ${file} line ${i + 1}: regex="${rawRegex}" replacement="${rawReplacement}" error=${e.message}`);
              }
            }
          } catch (e) {
            console.warn(`[Dictation] Failed to load ${file}:`, e);
          }
        }

        console.log(`[Dictation] Loaded ${rules.length} regex rules from ${files.length} files`);
        setDictationRegexRules(rules);
        setDictationRegexLoaded(true);
      } catch (e) {
        console.warn('[Dictation] Failed to load regex rules:', e);
        setDictationRegexLoaded(true);
      }
    }
    loadDictationRegex();
  }, []);

  // Simple CSV line parser that handles quoted fields with commas
  function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    let bracketDepth = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (!inQuotes && ch === '[') {
        bracketDepth++;
        current += ch;
      } else if (!inQuotes && ch === ']') {
        bracketDepth = Math.max(0, bracketDepth - 1);
        current += ch;
      } else if (ch === ',' && !inQuotes && bracketDepth === 0) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  }

  // Apply dictation regex rules to a text string
  function applyDictationRegex(text) {
    if (!dictationRegexRules.length || !text) return text;
    let result = text;
    for (const rule of dictationRegexRules) {
      try {
        const re = new RegExp(rule.regex, rule.flags || 'gi');
        result = result.replace(re, rule.replacement);
      } catch (e) {
        // Skip invalid regex at runtime
      }
    }
    // Strip whitespace from each line and capitalize the first letter
    result = result
      .split('\n')
      .map(line => {
        const trimmed = line.trim();
        if (!trimmed) return trimmed;
        return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      })
      .join('\n');
    return result;
  }

  // Build dictation cache lazily via useEffect to avoid setState during render.
  // Display mode is per-entry now, so cache any entry whose effective mode is
  // 'dictation' (its override, or the global default).
  useEffect(() => {
    if (!dictationRegexRules.length) return;
    const missing = transcriptions.filter(t => t.text && getEntryMode(t.id) === 'dictation' && !dictationCache[t.id]);
    if (missing.length === 0) return;
    const newEntries = {};
    for (const t of missing) {
      newEntries[t.id] = applyDictationRegex(t.text);
    }
    setDictationCache(prev => ({ ...prev, ...newEntries }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dictationCache
    // is read but intentionally excluded: the effect mutates it via the
    // functional updater above, and including it would re-trigger the
    // effect on every cache write (a no-op since `missing` is then empty).
  }, [transcriptDisplayMode, entryDisplayModes, dictationRegexRules, transcriptions]);

  // Get the display text for a transcription based on its per-entry display mode
  function getDisplayText(trans) {
    if (getEntryMode(trans.id) === 'dictation' && dictationRegexRules.length > 0) {
      // Return cached result, or compute synchronously without setting state
      return dictationCache[trans.id] || applyDictationRegex(trans.text);
    }
    return trans.text;
  }

  // Close kebab menu when clicking outside
  useEffect(() => {
    if (openKebabId === null) return;
    const handleClick = () => setOpenKebabId(null);
    // Delay listener so the opening click doesn't immediately close it
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
    };
  }, [openKebabId]);

  // Adaptive confidence color mapping per transcript
  // Maps confidence to a red gradient: lowest confidence = most red, 100% = transparent
  // Uses 80% threshold: if min confidence >= 80%, colors are less intense
  function getConfidenceColor(confidence, minConf = 0, maxConf = 1) {
    if (!confidence || confidence >= 1.0) return 'transparent';
  
    // Apply 80% threshold - if minimum confidence is high, use gentler coloring
    const effectiveMin = Math.max(minConf, 0.8);
  
    // Normalize confidence within the effective range
    const range = 1.0 - effectiveMin;
    if (range <= 0) return 'transparent';
  
    // Clamp confidence to effective range
    const clampedConf = Math.max(effectiveMin, Math.min(1.0, confidence));
  
    // Map to 0 (at effectiveMin) to 1 (at 100%)
    const normalized = (clampedConf - effectiveMin) / range;
  
    // Invert so lowest confidence = highest opacity
    // Use quadratic easing for smoother visual transition
    const opacity = (1 - normalized * normalized) * 0.35; // Max 35% opacity for visibility
  
    return `rgba(239, 68, 68, ${opacity})`;
  }

  // Low-RAM / mobile detection. Triggers when JS heap limit is below the shared
  // RAM_THRESHOLD_GB cutoff (the model needs ~100-200 MB plus runtime
  // overhead). Falls back to navigator.deviceMemory (Chrome/Edge) or mobile UA
  // sniffing when heap info is unavailable. When detected, clicking Load Model
  // opens a confirmation popup warning that the tab may crash.
  const _lowRamInfoRef = useRef(null);
  const [lowRamInfo, setLowRamInfo] = useState(null); // { detectedGB, source }
  const [isLowRam] = useState(() => {
    const heapLimit = performance?.memory?.jsHeapSizeLimit;
    if (heapLimit !== undefined) {
      const detectedGB = (heapLimit / 1024 / 1024 / 1024).toFixed(1);
      _lowRamInfoRef.current = { detectedGB, source: 'heap limit' };
      return heapLimit < RAM_THRESHOLD_BYTES;
    }
    const mem = navigator.deviceMemory;
    if (mem !== undefined) {
      _lowRamInfoRef.current = { detectedGB: String(mem), source: 'device memory' };
      return mem < RAM_THRESHOLD_GB;
    }
    if (MOBILE_UA_RE.test(navigator.userAgent)) {
      _lowRamInfoRef.current = { detectedGB: '?', source: 'mobile device' };
      return true;
    }
    return false;
  });

  useEffect(() => {
    if (_lowRamInfoRef.current) {
      setLowRamInfo(_lowRamInfoRef.current);
      _lowRamInfoRef.current = null;
    }
  }, []);

  // Resolve the effective backend once both the WebGPU probe and settings load
  // have completed.
  //   - WebGPU unavailable: force WASM, overriding any persisted choice (a
  //     saved 'webgpu-hybrid' would otherwise fail at load).
  //   - No explicit user choice yet: default by RAM. WebGPU runs the fp32
  //     encoder (~2.4 GB), so default to it only on devices that don't look
  //     low on memory; otherwise WASM (int8 encoder, ~600 MB).
  useEffect(() => {
    if (!settingsLoaded || webgpuAvailable === null) return;
    if (webgpuAvailable === false) {
      setBackend((prev) => (prev.startsWith('webgpu') ? 'wasm' : prev));
      return;
    }
    if (!backendChosenByUserRef.current) {
      setBackend(isLowRam ? 'wasm' : 'webgpu-hybrid');
    }
  }, [settingsLoaded, webgpuAvailable, isLowRam]);

  const [showLowRamConfirm, setShowLowRamConfirm] = useState(false);
  const handleLoadModelClick = (opts) => {
    if (isLowRam) {
      setShowLowRamConfirm(true);
      return;
    }
    loadModel(opts);
  };
  const confirmLowRamLoad = () => {
    setShowLowRamConfirm(false);
    loadModel();
  };

  // The model is fully loaded once its tokenizer vocab signature is published
  // (set to null at the start of loadModel, non-null on success, and left
  // untouched through the recording/transcribing status churn). Gating the
  // record / upload / remote-mic controls on this means they never appear while
  // the model is still downloading or creating sessions, removing the window in
  // which a user could click them before the worker is ready.
  const modelLoaded = tokenizerVocabSig !== null;

  return (
    <div className="app">
      {devMode && (
        <Banner tone="danger" style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: '1rem' }}>
          {(() => {
            const age = relativeAgePhrase(t, CONFIG.CONTAINER_STARTED_AT);
            if (!age) return t('devModeBanner');
            return (
              <>
                {t('devModeBannerIntro', { age })}
                <a href="https://github.com/thiswillbeyourgithub/parakeet_web/issues" target="_blank" rel="noopener noreferrer">{t('devModeBannerIssueLink')}</a>
                {t('devModeBannerOutro')}
              </>
            );
          })()}
        </Banner>
      )}
      {showLowRamConfirm && (
        <Modal onClose={() => setShowLowRamConfirm(false)}>
          <h3 style={{ marginTop: 0 }}>{t('lowRamConfirmTitle')}</h3>
          <p>
            {t('lowRamWarning')}{lowRamInfo ? ` (detected: ${lowRamInfo.detectedGB} GB ${lowRamInfo.source}, threshold: ${RAM_THRESHOLD_GB} GB)` : ''}{t('lowRamModelMayFail')}
          </p>
          <p style={{ fontWeight: 'bold' }}>{t('lowRamConfirmBody')}</p>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button onClick={() => setShowLowRamConfirm(false)}>{t('cancel')}</button>
            <button onClick={confirmLowRamLoad} className="primary">{t('lowRamConfirmContinue')}</button>
          </div>
        </Modal>
      )}
      <div className="app-header">
        <div className="app-header__title-row">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="app-logo" />
          <h2>ParakeetWeb</h2>
          <button
            className="settings-toggle"
            onClick={() => setShowSettings(!showSettings)}
            aria-label={t('toggleSettings')}
            title={showSettings ? t('hideSettings') : t('showSettings')}
          >
            ☰
          </button>
        </div>
        <p className="app-header__status">
          {(status === 'loadingModel' || isTranscribing || isRecording || (isRemoteMic && remoteMicRecording) || recordingCountdown !== null || awaitingFinal) && (
            <span className="spinner spinner--inline" aria-hidden="true" />
          )}
          {t('status')}: {t(status) || status}
          {boostRebuilding && (
            <span className="app-header__status-note">
              <span className="spinner spinner--inline" aria-hidden="true" />
              {t('boostRebuilding')}
            </span>
          )}
        </p>
      </div>

      {/* About modal */}
      {showAbout && (
        <Modal onClose={() => setShowAbout(false)} className="modal-panel--about">
          <h3 style={{ marginTop: 0 }}>{t('aboutTitle')} <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>v{VERSION}</span></h3>
          <p style={{ fontSize: '1.1rem', fontWeight: 'bold', textAlign: 'center', margin: '0.5rem 0 1rem', color: 'var(--accent)' }}>
            🔒 {t('tagline')}
          </p>
          <p style={{ textAlign: 'center', fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
            {t('privacyEmphasis')}
          </p>
          <p style={{ textAlign: 'center', fontSize: '0.95rem', marginBottom: '1rem', color: 'var(--text-muted)' }}>
            {t('instancePerks')}
          </p>
          <h4 style={{ marginBottom: '0.5rem' }}>{t('whatIsThis')}</h4>
          <p>{t('infoDescription1')}</p>
          <p>{t('infoDescription2')}</p>
          <p style={{ fontSize: '0.85rem', marginTop: '1rem', marginBottom: 0 }}>
            <strong>{t('sourceCode')}:</strong>{' '}
            <a href={lang === 'fr' ? 'https://github.com/thiswillbeyourgithub/parakeet_web/blob/main/README_fr.md' : 'https://github.com/thiswillbeyourgithub/parakeet_web/blob/main/README.md'} target="_blank" rel="noopener noreferrer">ParakeetWeb</a>
          </p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: 0 }}>
            <strong>{t('feedback')}:</strong> {t('feedbackText')}{' '}
            <a href="https://olicorne.org" target="_blank" rel="noopener noreferrer">olicorne.org</a>{' '}
            {t('orDirectlyBy')}{' '}
            <a href="https://github.com/thiswillbeyourgithub/parakeet_web/issues" target="_blank" rel="noopener noreferrer">{t('openingAnIssue')}</a>{' '}
            {t('onTheGitHubRepo')}
          </p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: 0 }}>
            <strong>{t('privacy')}:</strong> {t('privacyText')}{' '}
            <a href="https://umami.is" target="_blank" rel="noopener noreferrer">umami.is</a>{' '}
            {t('privacyText2')}
          </p>
        </Modal>
      )}

      {showSettings && (
        <>
        {/* Backdrop overlay — click to close sidebar */}
        <div className="settings-sidebar-overlay" onClick={() => setShowSettings(false)} />
        <div className="settings-sidebar">
        <button className="settings-sidebar-close" onClick={() => setShowSettings(false)} aria-label={t('closeSettings')}>×</button>
        <div className="settings-section">
        <div className="setting-row setting-row--language">
          <span className="setting-label">{t('language')}</span>
          <LanguageSwitcher />
        </div>
        <p>
          <strong>{t('model')}:</strong> {repoId} <span style={{fontSize:'0.9em', color: 'var(--text-subtle)'}}>(nemo128)</span>
        </p>

          <div className="setting-row" style={{ marginBottom: '0.5rem' }}>
            <label>
              <input
                type="checkbox"
                checked={keyboardShortcutsEnabled}
                onChange={e => setKeyboardShortcutsEnabled(e.target.checked)}
              />
              {t('enableKeyboardShortcuts')}
              <InfoTooltip text={t('tooltipKeyboardShortcuts')} />
            </label>
          </div>

          <button
            onClick={() => setShowShortcuts(prev => !prev)}
            style={{ marginBottom: '0.75rem', width: '100%' }}
            className="primary"
          >
            {showShortcuts ? t('hideKeyboardShortcuts') : t('showKeyboardShortcuts')}
          </button>

          {showShortcuts && (
            <div style={{
              marginBottom: '0.75rem',
              padding: '0.75rem',
              background: 'var(--bg-card)',
              color: 'var(--text)',
              borderRadius: '4px',
              border: '1px solid var(--border)',
              fontSize: '0.9rem',
              lineHeight: '1.8'
            }}>
              <strong>{t('keyboardShortcuts')}</strong>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.4rem' }}>
                <tbody>
                  {[
                    ['S', t('shortcutToggleSettings')],
                    ['R / S / Space', t('shortcutStopRecording')],
                    ['R / Space', t('shortcutStartRecording')],
                    ['F', t('shortcutSelectFile')],
                    ['L', t('shortcutLoadModel')],
                  ].map(([key, desc]) => (
                    <tr key={key}>
                      <td style={{ padding: '0.15rem 0.5rem 0.15rem 0', fontWeight: 'bold', fontFamily: 'monospace' }}>{key}</td>
                      <td style={{ padding: '0.15rem 0' }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                {t('shortcutsDisabledInInputs')}
              </p>
            </div>
          )}

          <div className="settings-content">
            <div className="setting-row">
              <span className="setting-label">
                {t('audioProcessing')}:
              </span>
              <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem', flexWrap: 'wrap' }}>
                <label>
                  <input
                    type="checkbox"
                    checked={noiseSuppression}
                    onChange={e => setNoiseSuppression(e.target.checked)}
                    disabled={isRecording}
                  />
                  {t('noiseSuppression')}
                  <InfoTooltip text={t('tooltipNoiseSuppression')} />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={echoCancellation}
                    onChange={e => setEchoCancellation(e.target.checked)}
                    disabled={isRecording}
                  />
                  {t('echoCancellation')}
                  <InfoTooltip text={t('tooltipEchoCancellation')} />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={autoGainControl}
                    onChange={e => setAutoGainControl(e.target.checked)}
                    disabled={isRecording}
                  />
                  {t('autoGainControl')}
                  <InfoTooltip text={t('tooltipAutoGainControl')} />
                </label>
              </div>
            </div>

            {isRemoteMic && (
              <div className="setting-row">
                <span className="setting-label" style={{ flex: '1 1 auto' }}>
                  {t('remoteMicGain')}:
                  <InfoTooltip text={t('tooltipRemoteMicGain')} />
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.5"
                  max="5"
                  step="0.1"
                  value={remoteMicGain}
                  onChange={e => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setRemoteMicGain(Math.max(0.5, Math.min(5, v)));
                  }}
                  style={{ width: '5rem' }}
                />
              </div>
            )}

            <div className="setting-row">
              <label>
                <input
                  type="checkbox"
                  checked={liveTranscriptionEnabled}
                  onChange={e => setLiveTranscriptionEnabled(e.target.checked)}
                  disabled={isRecording}
                />
                {t('liveTranscription')}
                <InfoTooltip text={t('tooltipLiveTranscription')} />
              </label>
              {liveTranscriptionEnabled && (
                <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span className="setting-label">
                    {t('liveContextWindow')}:
                    <InfoTooltip text={t('tooltipLiveContextWindow')} />
                  </span>
                  <select
                    value={liveContextWindow}
                    onChange={e => setLiveContextWindow(e.target.value)}
                    disabled={isRecording}
                  >
                    <option value="auto">{t('liveContextAuto')}</option>
                    <option value="10">10s</option>
                    <option value="15">15s</option>
                    <option value="20">20s</option>
                    <option value="30">30s</option>
                    <option value="45">45s</option>
                    <option value="60">60s</option>
                  </select>
                </div>
              )}
              {liveTranscriptionEnabled && (
                <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: '0.25rem 0 0' }}>
                  {t('liveStreamingNote')}
                </p>
              )}
            </div>

            <div className="setting-row">
              <label>
                <input type="checkbox" checked={autoCopyToClipboard} onChange={e => setAutoCopyToClipboard(e.target.checked)} />
                {t('autoCopyToClipboard')}
                <InfoTooltip text={t('tooltipAutoCopy')} />
              </label>
            </div>

            <div className="setting-row">
              <label>
                <input
                  type="checkbox"
                  checked={persistTranscripts}
                  onChange={e => {
                    const next = e.target.checked;
                    setPersistTranscripts(next);
                    // Toggle OFF: scrub the on-disk copy immediately so the
                    // user's existing history doesn't sit there forever.
                    // usePersistedSetting's gate already stops new writes.
                    if (!next) forgetPersistedTranscripts();
                  }}
                />
                {t('persistTranscripts')}
                <InfoTooltip text={t('tooltipPersistTranscripts')} />
              </label>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                {t('defaultTranscriptDisplay')}:
                <InfoTooltip text={t('tooltipDisplayMode')} />
              </span>
              <select
                value={transcriptDisplayMode}
                onChange={e => setTranscriptDisplayMode(e.target.value)}
                style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #d1d5db' }}
              >
                <option value="raw">{t('raw')}</option>
                <option value="confidence">{t('confidence')}</option>
                {dictationRegexRules.length > 0 && <option value="dictation">{t('dictationRules')} ({dictationRegexRules.length} {t('dictationRulesExperimental')}</option>}
              </select>
            </div>

            <div className="settings-group-header">{t('settingsGroupAdvanced')}</div>

            <div className="setting-row">
              <label>
                <input type="checkbox" checked={showConfidenceHeatmap} onChange={e => setShowConfidenceHeatmap(e.target.checked)} />
                {t('showCertaintyHeatmap')}
                <InfoTooltip text={t('tooltipHeatmap')} />
              </label>
            </div>

            <div className="setting-row">
              <label>
                <input type="checkbox" checked={enableChunking} onChange={e => setEnableChunking(e.target.checked)} />
                {t('chunkLongAudio')}
                <InfoTooltip text={t('tooltipChunking')} />
              </label>
              {enableChunking && (
                <div style={{ marginTop: '0.25rem', width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="setting-label" style={{ flex: '1 1 auto' }}>
                    {t('chunkDuration')} (s):
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="15"
                    max="300"
                    step="5"
                    value={chunkDuration}
                    onChange={e => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setChunkDuration(Math.max(15, Math.min(300, v)));
                    }}
                    style={{ width: '5rem' }}
                  />
                </div>
              )}
            </div>

            <div className="setting-row">
              <span className="setting-label">
                {t('backend')}:
                <InfoTooltip text={t('tooltipBackend')} />
              </span>
              <div className="setting-options">
                <label className={status === 'modelReady' ? 'disabled-option' : ''}>
                  <input type="radio" name="backend" value="wasm" checked={backend === 'wasm'} onChange={e => chooseBackend(e.target.value)} disabled={status === 'modelReady'} />
                  {t('wasmCpu')}
                </label>
                <label className={status === 'modelReady' || webgpuAvailable === false ? 'disabled-option' : ''}>
                  <input type="radio" name="backend" value="webgpu-hybrid" checked={backend === 'webgpu-hybrid'} onChange={e => chooseBackend(e.target.value)} disabled={status === 'modelReady' || webgpuAvailable === false} />
                  {webgpuAvailable === false ? t('webgpuUnavailable') : t('webgpu')}
                  {webgpuAvailable === false && (
                    <InfoTooltip text={t(`webgpuReason_${webgpuUnavailableReason || 'noAdapter'}`)} />
                  )}
                </label>
              </div>
            </div>

            {(backend === 'wasm' || backend.startsWith('webgpu')) && (() => {
              // Single fixed list (int8 / fp16 / fp32); only the greying moves
              // with the backend. int8 has no GPU encoder kernel (unavailable on
              // WebGPU); fp16 overflows the WASM heap (unavailable on WASM); fp32
              // runs on both. The remembered selection is per-backend, so WASM
              // keeps its int8<->fp32 choice and WebGPU its fp16<->fp32 choice.
              const isWebgpu = backend.startsWith('webgpu');
              const currentQuant = isWebgpu ? webgpuEncoderQuant : wasmEncoderQuant;
              const setQuant = isWebgpu ? setWebgpuEncoderQuant : setWasmEncoderQuant;
              // fp16 needs the GPU's shader-f16 feature; when an adapter resolved
              // WITHOUT it, fp16 can't run so it's greyed out and the load
              // silently resolves to fp32 (hub.js). null = unknown -> leave fp16
              // selectable (assume supported, matching the resolver default).
              const webgpuNoF16 = isWebgpu && webgpuShaderF16 === false;
              // Show the precision that will ACTUALLY load: fp32 when fp16 is
              // blocked, so the radio doesn't sit on a disabled fp16 option.
              const effectiveQuant = webgpuNoF16 ? 'fp32' : currentQuant;
              const rows = [
                { value: 'int8', label: t('precisionInt8'), available: !isWebgpu, note: t('precisionUnavailableWebgpu') },
                { value: 'fp16', label: t('precisionFp16'), available: isWebgpu && !webgpuNoF16, note: webgpuNoF16 ? t('precisionUnavailableNoF16') : t('precisionUnavailableWasm') },
                { value: 'fp32', label: t('precisionFp32'), available: true, note: '' },
              ];
              return (
                <div className="setting-row">
                  <span className="setting-label">
                    {t('encoderPrecision')}:
                    <InfoTooltip text={t('tooltipEncoderPrecision')} />
                  </span>
                  <div className="setting-options">
                    {rows.map(r => {
                      const disabled = status === 'modelReady' || !r.available;
                      return (
                        <label key={r.value} className={disabled ? 'disabled-option' : ''}>
                          <input type="radio" name="encoderQuant" value={r.value} checked={r.available && effectiveQuant === r.value} onChange={e => setQuant(e.target.value)} disabled={disabled} />
                          {r.label}{!r.available ? ` ${r.note}` : ''}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {(backend === 'wasm' || backend.startsWith('webgpu')) && (
              <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                <span className="setting-label" style={{ flex: '1 1 auto' }}>
                  {t('cpuThreads')} (1-{maxCores}):
                  <InfoTooltip text={t('tooltipCpuThreads')} />
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={maxCores}
                  value={cpuThreads}
                  onChange={e=>{
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setCpuThreads(Math.max(1, Math.min(maxCores, v)));
                  }}
                  disabled={status === 'modelReady'}
                  style={{ width: '4.5rem', opacity: status === 'modelReady' ? 0.5 : 1 }}
                />
              </div>
            )}

            <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
              <span className="setting-label" style={{ flex: '1 1 auto' }}>
                {t('frameStride')} (1-4):
                <InfoTooltip text={t('tooltipFrameStride')} />
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="4"
                value={frameStride}
                onChange={e=>{
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setFrameStride(Math.max(1, Math.min(4, v)));
                }}
                style={{ width: '4.5rem' }}
              />
            </div>

            <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
              <span className="setting-label" style={{ flex: '1 1 auto' }}>
                {t('beamWidth')} (1-25):
                <InfoTooltip text={t('tooltipBeamWidth')} />
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="25"
                value={beamWidth}
                onChange={e=>{
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setBeamWidth(Math.max(1, Math.min(25, Math.round(v))));
                }}
                style={{ width: '4.5rem' }}
              />
            </div>

            {/* MAES knobs: only meaningful when beamWidth>1 (the decoder ignores
                them at width 1, which is plain greedy), so hide them otherwise. */}
            {beamWidth > 1 && (
              <>
                <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                  <span className="setting-label" style={{ flex: '1 1 auto' }}>
                    {t('maesNumSteps')}:
                    <InfoTooltip text={t('tooltipMaesNumSteps')} />
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="10"
                    value={maesNumSteps}
                    onChange={e=>{
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setMaesNumSteps(Math.max(1, Math.min(10, Math.round(v))));
                    }}
                    style={{ width: '4.5rem' }}
                  />
                </div>

                <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                  <span className="setting-label" style={{ flex: '1 1 auto' }}>
                    {t('maesExpansionBeta')}:
                    <InfoTooltip text={t('tooltipMaesExpansionBeta')} />
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="10"
                    value={maesExpansionBeta}
                    onChange={e=>{
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setMaesExpansionBeta(Math.max(0, Math.min(10, Math.round(v))));
                    }}
                    style={{ width: '4.5rem' }}
                  />
                </div>

                <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                  <span className="setting-label" style={{ flex: '1 1 auto' }}>
                    {t('maesExpansionGamma')}:
                    <InfoTooltip text={t('tooltipMaesExpansionGamma')} />
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.1"
                    max="20"
                    step="0.1"
                    value={maesExpansionGamma}
                    onChange={e=>{
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v > 0) setMaesExpansionGamma(Math.min(20, v));
                    }}
                    style={{ width: '4.5rem' }}
                  />
                </div>

                <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                  <span className="setting-label" style={{ flex: '1 1 auto' }}>
                    {t('maesPrefixAlpha')}:
                    <InfoTooltip text={t('tooltipMaesPrefixAlpha')} />
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="5"
                    value={maesPrefixAlpha}
                    onChange={e=>{
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setMaesPrefixAlpha(Math.max(0, Math.min(5, Math.round(v))));
                    }}
                    style={{ width: '4.5rem' }}
                  />
                </div>
              </>
            )}

            <div className="settings-group-header">{t('settingsGroupBoosting')}</div>

            <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}>
              <span className="setting-label">
                {t('boostPhrases')}:
                <InfoTooltip text={t('tooltipBoost')} />
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
                {boostFiles.length > 0 && (
                  <select
                    value={boostSource}
                    onChange={e => applyBoostSource(e.target.value)}
                    style={{ flex: '1 1 auto', minWidth: 0, padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #d1d5db' }}
                  >
                    <option value={BOOST_SOURCE_CUSTOM}>{t('boostSourceCustom')}</option>
                    {boostFiles.map(f => (
                      <option key={f} value={f}>{f.replace(/\.txt$/, '')}</option>
                    ))}
                  </select>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap', marginLeft: boostFiles.length > 0 ? 0 : 'auto' }}>
                  {t('boostStrength')}:
                  <InfoTooltip text={t('tooltipBoostStrength')} />
                  <input
                    type="number"
                    inputMode="decimal"
                    min="-10"
                    max="10"
                    step="0.5"
                    value={boostStrength}
                    onChange={e => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setBoostStrength(Math.max(-10, Math.min(10, v)));
                    }}
                    style={{ width: '3.5rem' }}
                  />
                </label>
              </div>
              {boostCollapsed ? (
                <div
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    fontSize: '0.78rem', padding: '0.6rem 0.7rem',
                    borderRadius: '4px', border: '1px dashed #d1d5db',
                    background: 'var(--surface-muted, #f9fafb)', color: '#b45309',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {t('boostCuratedLoaded').replace('{name}', boostSource.replace(/\.txt$/, ''))}
                  </div>
                  <div>{t('boostCuratedEditHint')}</div>
                </div>
              ) : (
                <textarea
                  value={boostPhrases}
                  onChange={e => {
                    const v = e.target.value;
                    setBoostPhrases(v);
                    // Only the Custom slot is the user's own; edits while a file
                    // is selected stay in this session and aren't saved as custom.
                    if (boostSource === BOOST_SOURCE_CUSTOM) setBoostCustomText(v);
                  }}
                  placeholder={t('boostPhrasesPlaceholder')}
                  rows={4}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    fontFamily: 'monospace', fontSize: '0.85rem', padding: '0.4rem',
                    borderRadius: '4px', border: '1px solid #d1d5db',
                    background: 'var(--bg-card)', color: 'var(--text)',
                  }}
                />
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={boostAugment}
                  onChange={e => setBoostAugment(e.target.checked)}
                />
                {t('boostAugment')}
                <InfoTooltip text={t('tooltipBoostAugment')} />
              </label>
              {boostWarnings.length > 0 && (
                <p style={{
                  fontSize: '0.78rem', color: '#b45309', margin: 0,
                  overflowWrap: 'anywhere', wordBreak: 'break-word',
                }}>
                  {t('boostWeightWarning').replace('{max}', MAX_PHRASE_WEIGHT)}{' '}
                  {boostWarnings.map(w => w.phrase).join(', ')}
                </p>
              )}
              {boostPhrases.trim() && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                  {t('boostPhrasesLoaded').replace('{n}', boostPhraseCount)}
                </p>
              )}
              {boostUnkWarnings.length > 0 && (
                <details style={{ fontSize: '0.78rem', color: '#b45309' }}>
                  <summary style={{ cursor: 'pointer' }}>
                    {t('boostUnkSummary').replace('{n}', boostUnkWarnings.length)}
                  </summary>
                  <p style={{ margin: '0.4rem 0' }}>{t('boostUnkWarning')}</p>
                  <textarea
                    readOnly
                    value={boostUnkWarnings.join('\n')}
                    rows={Math.min(8, boostUnkWarnings.length)}
                    spellCheck={false}
                    style={{
                      width: '100%', boxSizing: 'border-box', resize: 'vertical',
                      fontFamily: 'monospace', fontSize: '0.85rem', padding: '0.4rem',
                      borderRadius: '4px', border: '1px solid #d1d5db',
                      background: 'var(--bg-card)', color: 'var(--text)',
                    }}
                  />
                </details>
              )}
            </div>

            <div className="settings-group-header">{t('settingsGroupDebug')}</div>

            <div className="setting-row">
              <span className="setting-label">
                {t('debugLogging')}:
                <InfoTooltip text={t('tooltipDebugLogging')} />
              </span>
              <select
                value={(showAdvancedInfo || verboseLog) ? 'full' : 'off'}
                onChange={e => {
                  const on = e.target.value === 'full';
                  setShowAdvancedInfo(on);
                  saveSetting('showAdvancedInfo', on);
                  setVerboseLog(on);
                }}
                style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #d1d5db' }}
              >
                <option value="off">{t('debugOff')}</option>
                <option value="full">{t('debugFullLogs')}</option>
              </select>
            </div>
          </div>
        
          {/* Dictation device (SpeechMike) connect button. The button itself
              is always shown when the feature is enabled: on Chromium it opens
              the WebHID picker; on Firefox/Safari clicking it shows an alert
              explaining the limitation (see connectDictationDevice). When we
              suspect a dictation device is plugged in on a non-WebHID browser
              we additionally render a Banner above it. */}
          {dictationEnabled && (
            <div className="setting-row" style={{ marginTop: '1rem' }}>
              {dictationSuspectedNoWebhid && (
                <Banner tone="warning" style={{ marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                  {t('dictationSuspectedNoWebhid')}
                </Banner>
              )}
              <button
                onClick={connectDictationDevice}
                style={{ width: '100%' }}
                className="primary"
              >
                {dictationDevice
                  ? `${t('connectedDevice')}: ${dictationDevice}`
                  : t('connectDictationDevice')}
              </button>
              {dictationDevice && (
                <p style={{ fontSize: '0.8rem', color: '#16a34a', margin: '0.25rem 0 0' }}>
                  {t('dictationDeviceHint')}
                </p>
              )}
            </div>
          )}

          <button
            onClick={clearTranscriptions}
            disabled={transcriptions.length === 0}
            style={{ marginTop: '1rem', width: '100%' }}
            className="primary"
          >
            {t('clearTranscriptionHistory')}
          </button>
          
          <button 
            onClick={resetAllData}
            style={{ 
              marginTop: '0.5rem', 
              width: '100%',
              background: '#dc2626',
              color: 'white'
            }}
            className="primary"
          >
            {t('resetAllSettingsAndData')}
          </button>

          <button
            onClick={() => { setShowSettings(false); setShowAbout(true); }}
            style={{ marginTop: '1rem', width: '100%' }}
            className="primary"
          >
            {t('about')}
          </button>
          <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
            v{VERSION}
          </p>
        </div>
        </div>
        </>
      )}

      {showAdvancedInfo && memoryInfo && Object.keys(memoryInfo).length > 0 && (
        <div style={{
          fontSize: '0.85rem',
          color: 'var(--text-subtle)',
          marginBottom: '1rem',
          padding: '0.75rem',
          background: 'var(--bg-subtle)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)'
        }}>
          <strong>{t('system')}:</strong>{' '}
          {memoryInfo.deviceRAM && <span>{t('ram')}: {memoryInfo.deviceRAM}</span>}
          {memoryInfo.heapUsed && (
            <>
              {memoryInfo.deviceRAM && ' | '}
              <span>{t('heap')}: {memoryInfo.heapUsed} ({memoryInfo.heapPercent}%)</span>
              {parseFloat(memoryInfo.heapPercent) > 80 && (
                <span style={{ color: 'var(--danger)', marginLeft: '0.5rem' }}>{t('high')}</span>
              )}
            </>
          )}
          {memoryInfo.cpuCores && (
            <>
              {(memoryInfo.deviceRAM || memoryInfo.heapUsed) && ' | '}
              <span>{t('cpu')}: {memoryInfo.cpuCores}</span>
            </>
          )}
          {memoryInfo.fps && (
            <>
              {' | '}
              <span>{t('fps')}: {memoryInfo.fps}</span>
              {memoryInfo.fpsWarning && (
                <span style={{ color: 'var(--danger)', marginLeft: '0.25rem' }}>{memoryInfo.fpsWarning}</span>
              )}
            </>
          )}
          {memoryInfo.storage && (
            <>
              <br />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                {t('storage')}: {memoryInfo.storage}
              </span>
            </>
          )}
        </div>
      )}

      {/* Load Model button: visible on initial load or after failure, hidden once model is loading/ready */}
      {(status === 'idle' || (status === 'failed' || status === 'transcriptionFailed')) && (
        <>
          <p style={{ fontSize: '1.05rem', fontWeight: 'bold', textAlign: 'center', margin: '0 0 0.75rem', color: 'var(--accent)' }}>
            🔒 {t('tagline')}
          </p>
          <p style={{ fontSize: '0.85rem', textAlign: 'center', margin: '0 0 0.5rem', color: 'var(--text-muted)' }}>
            {t('privacyEmphasis')}
          </p>
          <p style={{ fontSize: '0.85rem', textAlign: 'center', margin: '0 0 1rem', color: 'var(--text-muted)' }}>
            {t('instancePerks')}
          </p>
          <button
            onClick={handleLoadModelClick}
            className="primary"
            style={{ marginBottom: '1rem', width: '100%' }}
            data-umami-event="load_model_button"
          >
            {t('loadModel')}
          </button>
          {/* Error banner: the requested precision couldn't be served by any
              source, so the load failed instead of silently downgrading to a
              different quant. Rendered here (inside the idle/failed block) so it
              is visible alongside the Load Model button after a failed load. */}
          {modelLoadError && (
            <div className="fallback-prompt" style={{ borderColor: 'var(--danger)' }}>
              <p>⚠ {modelLoadError}</p>
              <button onClick={() => setModelLoadError(null)} style={{ marginTop: '0.5em' }}>
                {t('dismiss')}
              </button>
            </div>
          )}
        </>
      )}

      {/* Controls, transcribe button, and transcription history: hidden until model loading has been initiated */}
      {status !== 'idle' && !(status === 'failed' || status === 'transcriptionFailed') && (<>
      {typeof SharedArrayBuffer === 'undefined' && backend === 'wasm' && (
        <Banner tone="warning">{t('sharedArrayBufferWarning')}</Banner>
      )}

      {modelLoaded && (
      <div className="controls">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.aac,.m4a,.mp3,.wav,.ogg,.flac,.opus,.webm"
          onChange={transcribeFile}
          disabled={isTranscribing || isRecording}
          style={{ display: 'none' }}
          id="audio-file-input"
        />
        <label
          htmlFor="audio-file-input"
          className="file-upload-button"
          style={{
            opacity: (isTranscribing || isRecording) ? 0.5 : 1,
            pointerEvents: (isTranscribing || isRecording) ? 'none' : 'auto',
            flex: 1
          }}
          data-umami-event="upload_file_button"
        >
          {t('sendMp3')}
        </label>
        {/* When recording (local or remote), show Stop + Pause/Resume side by side; otherwise single Record button */}
        {isRecording ? (
          <>
            <button
              onClick={stopRecording}
              className="primary record-button"
              style={{ background: 'var(--danger)', flex: 1 }}
              data-umami-event="stop_record_button"
            >
              {t('stop')}
            </button>
            <button
              onClick={isPaused ? resumeRecording : pauseRecording}
              className="primary record-button"
              style={{ background: isPaused ? 'var(--success)' : 'var(--warning)', flex: 1 }}
              data-umami-event="pause_record_button"
            >
              {isPaused ? t('resume') : t('pause')}
            </button>
          </>
        ) : isRemoteMic ? (
          <>
            {remoteMicRecording && (
              <>
                <button
                  onClick={stopRemoteMic}
                  className="primary record-button"
                  style={{ background: 'var(--danger)', flex: 1 }}
                >
                  {t('stop') || 'Stop'}
                </button>
                <button
                  onClick={remoteMicPaused ? resumeRemoteMic : pauseRemoteMic}
                  className="primary record-button"
                  style={{ background: remoteMicPaused ? 'var(--success)' : 'var(--warning)', flex: 1 }}
                >
                  {remoteMicPaused ? t('resume') : t('pause')}
                </button>
              </>
            )}
            {!remoteMicRecording && (
              <button
                onClick={recordingCountdown !== null ? stopRecording : startRecordingCountdown}
                disabled={(status !== 'modelReady' && recordingCountdown === null) || isTranscribing}
                className="primary record-button"
                style={{
                  background: recordingCountdown !== null ? 'var(--danger)' : 'var(--success)',
                  flex: 1
                }}
                data-umami-event="record_button"
              >
                {recordingCountdown !== null ? `${t('getReady')} (${recordingCountdown})` : t('recordAudio')}
              </button>
            )}
            <button
              onClick={disconnectRemoteMic}
              className="primary record-button"
              style={{ background: 'var(--text-subtle)', flex: remoteMicRecording ? 1 : 1 }}
            >
              {t('remoteMicDisconnectPhone') || 'Disconnect Phone'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={recordingCountdown !== null ? stopRecording : startRecordingCountdown}
              disabled={(status !== 'modelReady' && recordingCountdown === null) || isTranscribing || isRemoteMic}
              className="primary record-button"
              style={{
                background: recordingCountdown !== null ? 'var(--danger)' : 'var(--success)',
                flex: 1
              }}
              data-umami-event="record_button"
            >
              {recordingCountdown !== null ? `${t('getReady')} (${recordingCountdown})` : t('recordAudio')}
            </button>
            <button
              onClick={startRemoteMic}
              disabled={isTranscribing || isRecording || isRemoteMic}
              className="primary record-button"
              style={{ background: '#8b5cf6', flex: 1 }}
              title={t('remoteMicTooltip') || 'Use your phone as a microphone'}
            >
              {t('remoteMic') || 'Phone Mic'}
            </button>
          </>
        )}
      </div>
      )}

      {recordingCountdown !== null && (
        <Banner tone="warning" style={{ marginTop: '0.5rem', fontSize: '1.1em', fontWeight: 'bold', justifyContent: 'center' }}>
          {t('getReadyToSpeak')} {recordingCountdown}...
        </Banner>
      )}

      {isRemoteMic && !remoteMicRecording && (
        <Banner tone="success" style={{ marginTop: '0.5rem', justifyContent: 'center' }}>
          {t('remoteMicConnectedIdle') || 'Phone connected \u2014 waiting for recording'}
        </Banner>
      )}

      {/* F-68: persistent verification status. The sharedKey is bound to
          the entire WebRTC connection lifetime, not per recording; surface
          that to the user so they know "re-verify" means "disconnect and
          re-pair", not "click the button again". */}
      {isRemoteMic && remoteMicVerifiedAt && (
        <Banner tone="info" style={{ marginTop: '0.5rem', justifyContent: 'center', fontSize: '0.85rem' }}>
          {t('verifyStatus').replace('{time}', new Date(remoteMicVerifiedAt).toLocaleTimeString())}
        </Banner>
      )}

      {(isRecording || (isRemoteMic && remoteMicRecording)) && (() => {
        const level = isRemoteMic ? remoteMicLevel : audioLevel;
        const paused = isRemoteMic ? remoteMicPaused : isPaused;
        const elapsed = isRemoteMic ? remoteMicElapsed : null;
        return (
          <div style={{
            marginTop: '0.5rem',
            padding: '0.5rem',
            background: 'var(--danger-soft-bg)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.9em',
            color: 'var(--danger)'
          }}>
            <span>
              {paused ? t('recordingPausedMsg') : (isRemoteMic ? (t('remoteMicRecording') || 'Phone recording') : t('recordingInProgress'))}
              {isRemoteMic && elapsed !== null && (
                <span style={{ marginLeft: '0.5rem', fontVariantNumeric: 'tabular-nums' }}>
                  {formatTime(elapsed)}
                </span>
              )}
            </span>
            <div style={{ marginTop: '0.5rem' }}>
              <div style={{
                width: '100%',
                height: '20px',
                background: 'var(--border)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${Math.min(100, level)}%`,
                  height: '100%',
                  background: level > 30 ? 'var(--success)' : 'var(--warning)',
                  transition: 'width 0.1s'
                }} />
              </div>
              <p style={{ fontSize: '0.8em', color: 'var(--text-subtle)', marginTop: '0.25rem', marginBottom: 0 }}>
                {level < 10 && t('tooQuiet')}
                {level >= 10 && level < 30 && t('speakLouder')}
                {level >= 30 && t('goodLevel')}
              </p>
            </div>
          </div>
        );
      })()}

      {/* Live transcript box. Stays mounted across the gap between stop and
          the final ASR result, so the streaming text the user has been
          watching does not vanish while audio is being assembled / decoded
          and the canonical pass is running. */}
      {liveTranscriptionEnabled && (isRecording || (isRemoteMic && remoteMicRecording) || awaitingFinal) && (
        <div style={{
          marginTop: '0.5rem',
          padding: '0.5rem 0.75rem',
          background: 'var(--bg-subtle, rgba(0,0,0,0.04))',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.95em',
          color: 'var(--text)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.4,
          minHeight: '1.4em',
        }}>
          {awaitingFinal && (
            <div style={{ fontSize: '0.85em', color: 'var(--text-subtle)', marginBottom: '0.35rem', fontStyle: 'italic', display: 'flex', alignItems: 'center' }}>
              <span className="spinner spinner--inline" aria-hidden="true" />
              {isTranscribing ? t('runningFinalTranscription') : t('receivingAudio')}
            </div>
          )}
          {liveTranscript.text
            ? (dictationRegexRules.length > 0 ? applyDictationRegex(liveTranscript.text) : liveTranscript.text)
            : (
              <span className="live-dots" aria-label="Listening" style={{ color: 'var(--text-subtle)' }}>
                <span /><span /><span />
              </span>
            )}
          {showAdvancedInfo && liveStats && (
            <div style={{ fontSize: '0.75em', opacity: 0.6, marginTop: '0.35rem', fontVariantNumeric: 'tabular-nums' }}>
              window={liveStats.window?.toFixed(1)}s · step={liveStats.step?.toFixed(1)}s · process={Math.round(liveStats.process_ms || 0)}ms
            </div>
          )}
        </div>
      )}

      {progressPct!==null && (
        <div className="progress-wrapper">
          <div className="progress-bar"><div style={{ width: `${progressPct}%` }} /></div>
          <p className="progress-text">{progressText}</p>
        </div>
      )}

      {/* Warning banner: local fallback is enabled but model files are missing */}
      {fallbackWarning && (
        <div className="fallback-prompt" style={{ borderColor: '#e8a838' }}>
          <p>⚠ {fallbackWarning}</p>
          <button onClick={() => setFallbackWarning(null)} style={{ marginTop: '0.5em' }}>
            {t('dismiss')}
          </button>
        </div>
      )}

      {/* Warning banner: the cached model had to be re-downloaded more than once
          this session because it kept failing to deserialize (unreliable storage). */}
      {modelCorruptionWarning && (
        <div className="fallback-prompt" style={{ borderColor: '#e8a838' }}>
          <p>⚠ {modelCorruptionWarning}</p>
          <button onClick={() => setModelCorruptionWarning(null)} style={{ marginTop: '0.5em' }}>
            {t('dismiss')}
          </button>
        </div>
      )}

      {/* Latest transcription performance info (advanced) */}
      {showAdvancedInfo && latestMetrics && (
        <div className="performance">
          <strong>{t('rtf')}:</strong> {latestMetrics.rtf?.toFixed(2)}x &nbsp;|&nbsp; {t('total')}: {(latestMetrics.total_ms / 1000).toFixed(2)} s<br/>
          {t('preprocess')} {latestMetrics.preprocess_ms} ms · {t('encode')} {(latestMetrics.encode_ms / 1000).toFixed(2)} s · {t('decode')} {(latestMetrics.decode_ms / 1000).toFixed(2)} s · {t('tokenize')} {latestMetrics.tokenize_ms} ms
        </div>
      )}

      {/* Transcriptions */}
      {transcriptions.length > 0 && (
        <div className="history">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1rem 0.5rem', flexWrap: 'wrap', gap: '0.5rem', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0 }}>{t('transcriptions')}</h3>
          </div>
          <div>
            {transcriptions.map((trans) => {
              // Calculate average and minimum confidence from words
              const wordConfs = trans.words?.map(w => w.confidence).filter(c => c != null) || [];
              const avgConf = wordConfs.length > 0 ? wordConfs.reduce((a, b) => a + b, 0) / wordConfs.length : null;
              const minConf = wordConfs.length > 0 ? Math.min(...wordConfs) : null;
              const entryMode = getEntryMode(trans.id);
              const audioOpen = openAudioIds.has(trans.id);

              return (
                <div className={`history-item${trans.id === newestTranscriptionIdRef.current ? ' history-item-enter' : ''}`} key={trans.id}>
                  <div className="history-meta">
                    <strong>{truncateFilename(trans.filename)}</strong>
                    {showAdvancedInfo && (
                      <span style={{ fontSize: '0.85em', color: 'var(--text-subtle)', marginLeft: '0.5rem' }}>
                        {typeof trans.duration === 'number' && `${formatDuration(trans.duration)} | `}{trans.wordCount} words{trans.metrics && ` | RTF: ${trans.metrics.rtf?.toFixed(2)}x`}
                        {avgConf !== null && minConf !== null && ` | Avg: ${(avgConf * 100).toFixed(1)}% | Min: ${(minConf * 100).toFixed(1)}%`}
                      </span>
                    )}
                    <span>{trans.timestamp}</span>
                  </div>

                  {/* Per-entry control row: [Audio][Raw][Confidence][Dictation?]
                      on the left, always-visible kebab on the right. */}
                  <div className="history-controls">
                    <div className="history-modes">
                      {trans.audioBlob && (
                        <button
                          onClick={() => toggleAudio(trans.id)}
                          className={`display-mode-button${audioOpen ? ' active' : ''}`}
                          title={t('audio')}
                          aria-expanded={audioOpen}
                        >
                          {audioOpen ? '▾' : '▸'} {t('audio')}
                        </button>
                      )}
                      <button
                        onClick={() => setEntryMode(trans.id, 'raw')}
                        className={`display-mode-button${entryMode === 'raw' ? ' active' : ''}`}
                        title="Raw transcription"
                      >
                        {t('raw')}
                      </button>
                      <button
                        onClick={() => { setEntryMode(trans.id, 'confidence'); setShowConfidenceHeatmap(true); }}
                        className={`display-mode-button${entryMode === 'confidence' ? ' active' : ''}`}
                        title={t('confidence')}
                      >
                        {t('confidence')}
                      </button>
                      {dictationRegexRules.length > 0 && (
                        <button
                          onClick={() => setEntryMode(trans.id, 'dictation')}
                          className={`display-mode-button${entryMode === 'dictation' ? ' active' : ''}`}
                          title={`${t('dictationRules')} (${dictationRegexRules.length} ${t('dictationRulesExperimental')})`}
                        >
                          {t('dictationExp')}
                        </button>
                      )}
                    </div>
                    {/* Kebab (three-dot) menu for per-entry actions */}
                    <div className="kebab-menu-wrapper">
                      <button
                        className="kebab-button"
                        title={t('moreActions')}
                        aria-label={t('moreActions')}
                        disabled={anyModalOpen}
                        onClick={(e) => { e.stopPropagation(); setOpenKebabId(openKebabId === trans.id ? null : trans.id); }}
                      >
                        ⋮
                      </button>
                      {openKebabId === trans.id && (
                        <div className="kebab-dropdown">
                          <button onClick={() => { copyHistoryItem(trans); setOpenKebabId(null); }}>
                            {copiedHistoryId === trans.id ? t('copied') : t('copyText')}
                          </button>
                          {dictationRegexRules.length > 0 && (
                            <button onClick={async () => {
                              const cleaned = applyDictationRegex(trans.text);
                              try { await navigator.clipboard.writeText(sanitizeClipboardText(cleaned)); setCopiedHistoryId(trans.id); setTimeout(() => setCopiedHistoryId(null), 2000); } catch (e) { console.error('[Copy] Failed:', e); }
                              setOpenKebabId(null);
                            }}>
                              {t('copyDictation')}
                            </button>
                          )}
                          {/* Audio is in-memory only, so this is absent on
                              entries restored after a reload. */}
                          {trans.audioBlob && (
                            <button
                              disabled={isTranscribing}
                              onClick={() => transcribeAgain(trans)}
                              title={t('transcribeAgainHint')}
                            >
                              {reTranscribingId === trans.id && <span className="spinner spinner--inline" aria-hidden="true" />}
                              {reTranscribingId === trans.id ? t('transcribingAgain') : t('transcribeAgain')}
                            </button>
                          )}
                          <button className="kebab-delete" onClick={() => deleteTranscription(trans.id)}>
                            {t('delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Inline audio player (audio is in-memory only, so this is
                      absent on entries restored after reload). The Transcribe
                      again action lives in the per-entry kebab menu above. */}
                  {audioOpen && trans.audioBlob && (
                    <div className="history-audio">
                      <audio controls src={getEntryAudioUrl(trans)} className="audio-player" />
                    </div>
                  )}

                  <div className="history-text-container">
                    <div className="history-text">
                      {showConfidenceHeatmap && entryMode === 'confidence' && trans.words && trans.words.length > 0 ? (
                        // Render word-by-word with adaptive confidence heatmap
                        (() => {
                          // Calculate min/max confidence for adaptive coloring
                          const confidences = trans.words.map(w => w.confidence).filter(c => c != null);
                          const minConf = confidences.length > 0 ? Math.min(...confidences) : 0;
                          const maxConf = confidences.length > 0 ? Math.max(...confidences) : 1;

                          return trans.words.map((word, i) => (
                            <span
                              key={i}
                              style={{
                                backgroundColor: getConfidenceColor(word.confidence, minConf, maxConf),
                                padding: '2px 3px',
                                borderRadius: '3px',
                                display: 'inline-block',
                                marginRight: '0.2em',
                                transition: 'background-color 0.2s'
                              }}
                              title={word.confidence ? `"${word.text}" - Confidence: ${(word.confidence * 100).toFixed(1)}% (Range: ${(minConf * 100).toFixed(1)}%-${(maxConf * 100).toFixed(1)}%)` : word.text}
                            >
                              {word.text}
                            </span>
                          ));
                        })()
                      ) : (
                        // Show raw or dictation-cleaned text
                        <span style={{ whiteSpace: 'pre-wrap' }}>{getDisplayText(trans)}</span>
                      )}
                    </div>
                    {/* Confidence score overlay shown in per-entry confidence mode */}
                    {entryMode === 'confidence' && avgConf !== null && (
                      <div className="confidence-overlay">
                        Avg: {(avgConf * 100).toFixed(1)}% &nbsp;|&nbsp; Min: {(minConf * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>)}

      {/* Fingerprint compare modal: blocks until the user confirms or denies. */}
      {remoteMicFingerprint && remoteMicVerifyResolveRef.current && (
        <VerificationModal
          fingerprint={remoteMicFingerprint}
          prompt={t('verifyPrompt')}
          warning={t('verifyWarning')}
          confirmLabel={t('verifyConfirm')}
          denyLabel={t('verifyDeny')}
          onConfirm={() => remoteMicVerifyResolveRef.current && remoteMicVerifyResolveRef.current(true)}
          onDeny={() => remoteMicVerifyResolveRef.current && remoteMicVerifyResolveRef.current(false)}
        />
      )}

      {/* Remote Microphone Modal */}
      {remoteMicModal && (
        <Modal onClose={remoteMicStatus !== 'connected' ? cancelRemoteMic : undefined} className="modal-panel--remote-mic">
          <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem', textAlign: 'center' }}>
            {t('remoteMicTitle') || 'Remote Microphone'}
          </h3>

          {remoteMicStatus === 'connecting' && (
            <p style={{ color: 'var(--accent)', textAlign: 'center' }}>{t('remoteMicConnecting') || 'Setting up...'}</p>
          )}

          {remoteMicStatus === 'waiting' && (
            <>
              <p style={{ color: 'var(--text-subtle)', marginBottom: '1rem', textAlign: 'center' }}>
                {t('remoteMicScanQr') || 'Scan this QR code with your phone'}
              </p>
              <div ref={remoteMicQrRef} style={{
                display: 'block', padding: '12px',
                background: 'white', borderRadius: 'var(--radius-md)',
                margin: '0 auto 1rem', width: 'fit-content',
              }} />
              <p style={{ color: 'var(--text-subtle)', fontSize: '0.8rem', textAlign: 'center' }}>
                {t('remoteMicWaiting') || 'Waiting for phone to connect...'}
              </p>
            </>
          )}

          {remoteMicStatus === 'disconnected' && (
            <>
              <p style={{ color: 'var(--warning)', marginBottom: '1rem', textAlign: 'center' }}>
                {t('remoteMicDisconnected')}
              </p>
              <button onClick={regenerateRemoteMicQr} style={{
                background: 'var(--accent)', color: 'white', border: 'none',
                borderRadius: 'var(--radius-md)', padding: '0.6rem 1.5rem', cursor: 'pointer',
                fontWeight: 'bold', marginBottom: '0.75rem', display: 'block', width: '100%',
              }}>
                {t('remoteMicRegenerateQr')}
              </button>
              <button onClick={cancelRemoteMic} style={{
                background: 'transparent', color: 'var(--text-subtle)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', padding: '0.5rem 1.5rem', cursor: 'pointer',
                display: 'block', width: '100%',
              }}>
                {t('close') || 'Close'}
              </button>
            </>
          )}

          {remoteMicStatus === 'error' && (
            <>
              <p style={{ color: 'var(--danger)', marginBottom: '1rem', textAlign: 'center' }}>{remoteMicError}</p>
              <button onClick={cancelRemoteMic} style={{
                background: 'var(--accent)', color: 'white', border: 'none',
                borderRadius: 'var(--radius-md)', padding: '0.5rem 1.5rem', cursor: 'pointer',
                display: 'block', margin: '0 auto',
              }}>
                {t('close') || 'Close'}
              </button>
            </>
          )}

          {remoteMicDecryptErrors > 0 && remoteMicStatus !== 'error' && (
            <p style={{ color: 'var(--danger)', textAlign: 'center', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              ⚠ {remoteMicDecryptErrors} decrypt error{remoteMicDecryptErrors === 1 ? '' : 's'}
            </p>
          )}
          {remoteMicStatus !== 'error' && remoteMicStatus !== 'disconnected' && (
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button onClick={cancelRemoteMic} style={{
                background: 'transparent', color: 'var(--text-subtle)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', padding: '0.5rem 1.5rem', cursor: 'pointer',
              }}>
                {t('cancel') || 'Cancel'}
              </button>
            </div>
          )}
        </Modal>
      )}

      {/* About button at the very bottom of the page */}
      <div style={{ textAlign: 'center', marginTop: '2rem', paddingBottom: '1rem' }}>
        <button
          onClick={() => setShowAbout(true)}
          style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}
        >
          {t('about')}
        </button>
      </div>
    </div>
  );
}
