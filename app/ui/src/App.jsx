import React, { useState, useRef, useEffect, useTransition, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ParakeetModel, getParakeetModel, checkLocalModelFiles, resolveLocalModelBase, listLocalRepoFiles, listRepoFiles, HubDownloadError, QuantUnavailableError, shouldRetryLocally } from 'parakeet.js';
import { parseModelRepos, shortRepoLabel, matchModelRepo } from './lib/modelRepos.js';
import './App.css';
import { useI18n, LanguageSwitcher } from './i18n.jsx';
import Banner from './components/Banner.jsx';
import Modal, { useAnyModalOpen } from './components/Modal.jsx';
import { resamplePcmTo16k, createLevelMonitor, buildRecordingRateCandidates, createWavBlob, AUDIO_FILE_ACCEPT } from './lib/audio.js';
import { decodeToPcm16k } from './lib/audioDecode.js';
import { verifiedAddModule } from './lib/asset-integrity.js';
import { createLiveTranscriber } from './lib/liveTranscriber.js';
import { createCaptureQueue } from './lib/captureQueue.js';
import { acquireKeepalive, releaseKeepalive } from './lib/keepalive.js';
import { workerReady } from './lib/workerInit.js';
import VerificationModal from './components/VerificationModal.jsx';
import DecodeDebugView from './components/DecodeDebugView.jsx';
import { CONFIG } from './config.js';
import { openIdb, idbGet, idbPut, idbDelete, idbClear, idbDeleteDatabase } from '../../src/idb.js';
import { vocabSignature } from '../../src/bpeEncoder.js';
import { formatBoostConflict, MAX_PHRASE_WEIGHT, DEFAULT_DEPTH_SCALING } from '../../src/phraseBoost.js';
import { clearCache as clearModelCache, evictModelFiles, isModelDeserializeError } from '../../src/hub.js';
import { DEFAULT_CHUNK_DURATION_SEC, MIN_CHUNK_DURATION_SEC, MAX_CHUNK_DURATION_SEC } from '../../src/models.js';
import { formatTime, formatDuration, formatBytes, formatRate, formatEta, updateDownloadRate, relativeAge, isFresherThanDays, formatMetricsTooltip, wavNameFor, boldRuns, transcribeErrorMessage, sanitizeDeviceName } from './lib/format.js';
import { isModelLoading, formatLoadTiming } from './lib/loadPhase.js';
import { fetchTextCapped } from './lib/fetchCapped.js';
import { BOOST_MINP_DEFAULT, BOOST_STRENGTH_DEFAULT, BOOST_SOURCE_CUSTOM, BOOST_SOURCE_DISABLED } from './lib/boostConfig.js';
import { diarizationModelProtectKeys } from './lib/diarizationModels.js';
import { useDiarization } from './hooks/useDiarization.js';
import { useRemoteMic } from './hooks/useRemoteMic.js';
import { usePhraseBoost } from './hooks/usePhraseBoost.js';
import { usePipelineWorkers } from './hooks/usePipelineWorkers.js';
import { turnsToLabeledText } from './lib/speakerAssign.js';
import { createSerialQueue } from './lib/writeQueue.js';
import { restoreCpuThreads, encodePoolPlan } from './lib/cpuThreads.js';
import { restoreChunkDuration } from './lib/chunkDuration.js';
import { medModeRequested, MED_MODE_PRESET } from './lib/medMode.js';
import { probeHubReachable, preferLocalFirst } from './lib/hubReachability.js';
import { describeLoadedModel, reconcileSelection } from './lib/loadedModel.js';
import {
  QUANT_DOWNLOAD_MB,
  WASM_ENCODER_QUANTS,
  WEBGPU_ENCODER_QUANTS,
  DEFAULT_WASM_ENCODER_QUANT,
  DEFAULT_WEBGPU_ENCODER_QUANT,
  encoderQuantRows,
  effectiveEncoderQuant as resolveEffectiveEncoderQuant,
  gpuBackendAutoUsable,
  servableEncoderQuants,
} from './lib/encoderQuants.js';
import { restoreBeamWidthAuto, resolveAutoBeamWidth } from './lib/beamWidth.js';
import { defaultWasmThreads } from '../../src/backend.js';
import { collectEnvironment, buildSupportReport } from './lib/supportReport.js';
import {
  BENCHMARK_CLIP,
  LONG_PROFILE_TARGET_SEC,
  buildBenchmarkReport,
  estimatedDownloadMB,
  formatBenchmarkReport,
  markBenchmarkRowRunning,
  mergeBenchmarkRow,
  planBenchmark,
  planBenchmarkRows,
  runBenchmarkPlan,
  tilePcm,
} from './lib/benchmark.js';
import {
  PROBE_MODEL_PATHS, PROBE_SEQ, PROBE_DIM, PROBE_INPUT_NAME,
  PROBE_WARMUP_RUNS, PROBE_INIT_TIMEOUT_MS, PROBE_RUN_TIMEOUT_MS,
  pickBackendFromProbe, verdictStillValid, shouldAutoProbe, sourceQuantSignature,
  buildVerdict, planTimedRuns, median as probeMedian,
} from './lib/perfProbe.js';
import { isChromiumFamily } from './lib/browserFamily.js';
import { isHandheldDevice } from './lib/deviceClass.js';
import { numberWordsToDigits, numberWordsToDigitsInWords } from './lib/numberWords.js';

// Number of distinct colours in the speaker palette (CSS .diar-speaker-0..N-1
// in App.css); speaker labels cycle through it.
const DIAR_PALETTE_SIZE = 8;
import { requestPersistentStorage } from './lib/persistStorage.js';

// Dictation device support (Philips SpeechMike etc.) via WebHID.
// Conditionally imported so the feature can be fully disabled via env var.
const devMode = CONFIG.VITE_DEV_MODE === 'true';
// How long the development warning stays up after a restart. The banner's whole
// claim is that this instance was touched recently enough to be mid-change, so
// it expires: an instance left running for longer than this is not "under
// active development" in any sense a visitor can act on, and a permanent scary
// banner is one nobody reads. An instance with no stamped start time (the dev
// server) keeps the banner, see isFresherThanDays.
const DEV_BANNER_MAX_AGE_DAYS = 5;
const devBannerVisible = devMode
  && isFresherThanDays(CONFIG.CONTAINER_STARTED_AT, DEV_BANNER_MAX_AGE_DAYS);

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
// It is rendered through a PORTAL into <body> rather than inside the
// icon's own span: a dimmed ancestor (`.disabled-option`, opacity 0.5,
// used for the greyed-out WebGPU radio) would otherwise multiply into
// the popup and make the very explanation of WHY the option is greyed
// out unreadable. A portal also keeps the popup out of any ancestor
// stacking context or transform, which would break position: fixed.
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
      {isOpen && createPortal(
        <div
          ref={popupRef}
          className="info-help-text"
          onClick={stop}
          style={pos ? { left: pos.left + 'px', top: pos.top + 'px', width: pos.width + 'px' } : { visibility: 'hidden' }}
        >
          {text}
          <button className="info-help-close" onClick={close}>×</button>
        </div>,
        document.body,
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
// (id, text, timestamp, wordCount). filename, words[] (per-word start/end
// timestamps), metrics, and duration stay in-memory and are
// re-derived/absent on reload. Narrows the on-disk record so a LevelDB
// recovery cannot reconstruct the audio fingerprint of the original recording
// (per-word timings, file name that may itself carry PHI like a patient
// identifier) beyond the text content the user explicitly opted into saving.
function slimTranscriptForPersist(t) {
  if (!t || typeof t !== 'object') return t;
  const slim = {
    id: t.id,
    text: t.text,
    timestamp: t.timestamp,
    wordCount: t.wordCount,
  };
  // Opt-in diarization payload (attached by enrichTranscriptForPersist): the
  // grouped turns (speaker index + turn text) and the user's speaker names.
  // Still F-130-safe: no per-word timings, no raw float segments, no filename.
  if (Array.isArray(t.diarTurns) && t.diarTurns.length > 0) {
    slim.diarTurns = t.diarTurns.map(tn => ({ speaker: tn.speaker, text: tn.text }));
  }
  if (t.speakerNames && typeof t.speakerNames === 'object' && Object.keys(t.speakerNames).length > 0) {
    slim.speakerNames = t.speakerNames;
  }
  // RTF is a pure performance ratio (transcribe time / audio duration); it
  // carries no content, per-word timing, or duration fingerprint, so it is
  // F-130-safe to keep so the reloaded kebab menu can still show it.
  if (typeof t.rtf === 'number') slim.rtf = t.rtf;
  return slim;
}

// All mutations of the transcripts DB go through one serial queue so a burst of
// writes (e.g. diarize then rename in quick succession, or a delete's
// wipe-and-rewrite) cannot race as independent IndexedDB transactions and let an
// earlier put resolve AFTER a later one, leaving stale data on disk. The
// last-issued write is therefore the last-applied one. Ordering logic is the
// pure createSerialQueue (unit-tested in test/unit/write-queue.test.mjs).
const transcriptsWriteQueue = createSerialQueue();

async function putTranscripts(arr) {
  const slim = Array.isArray(arr) ? arr.map(slimTranscriptForPersist) : arr;
  await idbPut(await getTranscriptsDb(), TRANSCRIPTS_STORE_NAME, TRANSCRIPTS_KEY, slim);
}

function saveTranscripts(arr) {
  return transcriptsWriteQueue(async () => {
    try {
      await putTranscripts(arr);
    } catch (e) {
      console.warn('Failed to save transcripts:', e);
    }
  });
}

// F-128: wipe the transcripts DB entirely so LevelDB drops the SST/log files
// holding the previous (longer) array, then re-persist the new shorter array
// into a fresh DB. Called on per-entry delete so a deleted transcript leaves
// no recoverable residue. The settings DB is untouched.
function wipeAndRewriteTranscripts(arr) {
  return transcriptsWriteQueue(async () => {
    try {
      await idbDeleteDatabase(TRANSCRIPTS_DB_NAME);
      if (Array.isArray(arr) && arr.length > 0) {
        await putTranscripts(arr);
      }
    } catch (e) {
      console.warn('Failed to wipe transcripts DB:', e);
    }
  });
}

// Forget the on-disk transcripts container entirely. Used when the user
// toggles persistTranscripts OFF or hits "Clear all transcripts". Uses
// idbDeleteDatabase to evict LevelDB residue rather than a logical delete.
function forgetPersistedTranscripts() {
  return transcriptsWriteQueue(async () => {
    try {
      await idbDeleteDatabase(TRANSCRIPTS_DB_NAME);
    } catch (e) {
      console.warn('Failed to forget transcripts:', e);
    }
  });
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

// Escape hatch for a persisted setting that has wedged the app: loading the
// page with `?reset` (or the `#reset` hash fallback, in case a query string is
// awkward to add) wipes the saved settings and boots on defaults, WITHOUT
// touching transcript history (it lives in its own DB). This is the recovery
// path when the in-app "Reset All" can no longer be reached because a bad value
// froze the UI. See the reset branch at the top of loadSettings().
function urlRequestsSettingsReset() {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).has('reset')) return true;
    return (window.location.hash || '').replace(/^#/, '') === 'reset';
  } catch {
    return false;
  }
}

// Strip the reset directive from the address bar after we honour it, so a plain
// reload (or a bookmarked/shared link) does not keep re-purging on every visit.
function stripSettingsResetFromUrl() {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('reset');
    if ((url.hash || '').replace(/^#/, '') === 'reset') url.hash = '';
    window.history.replaceState(null, '', url.toString());
  } catch {
    /* replaceState can throw in exotic sandboxes; the purge already happened */
  }
}

// Injected by Vite from app/package.json — no need to manually sync
const VERSION = __APP_VERSION__;
// Injected by Vite from git at build time (short sha, `-dirty` when the tree was
// not clean, 'unknown' when git was unavailable). Reports carry it alongside the
// version because several pushes share one version number, so a report stamped
// only with a version cannot be attributed to the code that produced it.
const COMMIT = __APP_COMMIT__;

// Module-scope hook: persists `value` to IndexedDB whenever it changes,
// gated on `loaded` so we don't overwrite the on-disk value with the
// initial React default before loadSetting has had a chance to run.
function usePersistedSetting(key, value, loaded) {
  useEffect(() => {
    if (loaded) saveSetting(key, value);
  }, [key, value, loaded]);
}

// Collapsible settings group. The header is a button that toggles the body
// open/closed (the body unmounts when closed so the drawer stays a short list
// of section titles). Open/closed state lives in the parent so it can be
// persisted per-section; `open`/`onToggle` are controlled props.
function CollapsibleSection({ id, title, open, onToggle, children }) {
  return (
    <div className="settings-group">
      <button
        type="button"
        className="settings-group-toggle"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <span className="settings-group-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="settings-group-title">{title}</span>
      </button>
      {open && <div className="settings-group-body">{children}</div>}
    </div>
  );
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

// The dashed hint panel under the phrase-boost controls. Three sibling branches
// render it and they differ only in text colour, so it lives here once: the
// copy-paste is how one of them ended up reading a surface token that is
// defined in no stylesheet, which left the panel near-white on a dark card
// with --text-muted (#c4c8de in dark) on top of it at about 1.4:1. Every colour
// here is a theme token for that reason.
const BOOST_HINT_PANEL_STYLE = {
  width: '100%', boxSizing: 'border-box',
  fontSize: '0.78rem', padding: '0.6rem 0.7rem',
  borderRadius: '4px', border: '1px dashed var(--border-strong)',
  background: 'var(--bg-subtle)', color: 'var(--text-muted)',
};

// WebGPU is available app-wide, and which backend a visitor actually gets is
// decided by MEASURING their machine (lib/perfProbe.js), not by this constant.
//
// History worth keeping, because the obvious reading of this flag is wrong:
// WebGPU used to be pinned off for everyone on a ~15x-slower measurement that
// was blamed on the encoder's shape operators fragmenting the graph onto the
// CPU. That diagnosis was refuted in 2026-08: the cost was the PAGE, whose
// compositor activity gates JSEP's ~2000 per-run event-loop yields
// process-wide. With the `html.gpu-run` animation pause in place the same clip
// went 12m39s -> 8.5s, and WebGPU now measures ~5x FASTER than WASM int8 on
// the reference box. The pin outlived its own evidence by a month.
//
// It is still not a blanket "GPU is better" claim, which is why the probe
// exists: it only moves a visitor to WebGPU on a >=2x measured win on THEIR
// hardware, and every failure resolves to WASM.
//
// `?webgpu=0` is the kill switch: it forces WASM for a page load, for support
// ("does it work with ?webgpu=0?") and for the tests that pin this contract.
const WEBGPU_DISABLED = typeof location !== 'undefined'
  && /[?&]webgpu=0(?:&|$)/.test(location.search || '');

// `?ortep=` pins which ONNX Runtime distribution this page load uses, for that
// load only: nothing persists it and no UI offers it.
//
// The default is the JSPI build (ORT's native C++ WebGPU execution provider),
// so the meaningful value is `?ortep=jsep`, the escape hatch back to the older
// JS-implemented one. `?ortep=jspi` is still accepted, and is a no-op that
// keeps existing harnesses (scripts/webgpu-check.mjs, the specs) working.
//
// It is passed to the workers as well as the main thread. ORT pins one runtime
// per JS context, and the encode pool does real encoder work in workers, so a
// main-thread-only switch would leave most of the WASM path on the other
// runtime and would not be an escape hatch at all.
//
// A browser without JSPI resolves to jsep on its own (backend.js
// resolveOrtVariant), so neither the default nor the flag can break a load.
const ORT_VARIANT = (typeof location !== 'undefined'
  ? (/[?&]ortep=(jsep|jspi)(?:&|$)/.exec(location.search || '') || [])[1]
  : undefined) || undefined;

// Map any WebGPU backend id to 'wasm' while WebGPU is disabled, so a persisted
// or seeded 'webgpu-hybrid' can never actually be loaded. A no-op otherwise.
const coerceBackend = (b) => (WEBGPU_DISABLED && String(b).startsWith('webgpu') ? 'wasm' : b);

// The encoder precisions each backend's radios offer, and the whitelist the
// settings restore validates a saved value against. Anything else (a value from
// a newer build, a hand-edited record) falls back to the backend's default
// rather than reaching hub.js as a quant it cannot resolve.
//
// They live in lib/encoderQuants.js with the download-size table and the
// servability rules, because those three answer one question between them and
// had drifted apart while they were three places: the lists were here, the
// sizes were in lib/benchmark.js, and "can this source actually serve it" was
// nowhere, which is how the sidebar came to offer an fp16 no mirror hosted.
//
// Membership is only the FIRST of three gates. fp16 additionally needs the
// adapter's `shader-f16` feature (the adapter probe below), and every precision
// needs the model source to host its files (sourceQuants, further down).

// Every precision the radios can render, in display order: ascending DOWNLOAD
// SIZE, smallest first (w4a8 ~610MB, int8 lite ~810MB, int8 ~900MB, fp16 ~1.2GB,
// fp32 ~2.4GB). Size is what the visitor is actually trading here, and it is the
// one axis every row can be compared on (quality and speed do not order the same
// way, and w4a8 is smallest but slowest), so the column reads as a single ramp
// rather than needing each label to be read to place it. The recommended choice
// is int8, which the label says; ordering does not carry that.
//
// The two lists above stay the per-backend whitelists (a saved value is
// validated against them); this is only what the UI iterates, so a WebGPU-only
// precision like fp16 has a row to be greyed out in when WASM is selected.
const ENCODER_QUANT_ROWS = ['w4a8', 'int8lite', 'int8', 'fp16', 'fp32'];

// Where a benchmark report is POSTed, and whether the "send it to the
// maintainer" half of the Benchmark section exists at all. The operator opts in
// by pointing BENCHMARK_REPORTS_DIR at a writable folder, which makes the
// entrypoint set VITE_BENCHMARK_UPLOAD=true; with it unset the section still
// benchmarks and still lets the user copy the report, it just never offers to
// send anything. Same origin (Caddy proxies /api/signal/* to the sidecar), so
// no CSP connect-src host is involved.
const BENCHMARK_UPLOAD_PATH = '/api/signal/benchmark-report';
const BENCHMARK_UPLOAD_ENABLED = CONFIG.VITE_BENCHMARK_UPLOAD === 'true';

// A ?model=<query> query param lets a shareable link pin which model repo the
// page loads, e.g. ?model=ultimed for Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx.
// Read once at module load (the query string doesn't change within a session).
//
// UNLIKE ?phrase_boost above, this one DOES override a returning visitor's
// saved choice: the point is to hand someone a link that lands on a specific
// model regardless of what they last used. It is deliberately not persisted,
// so their own pick is still there on their next ordinary visit; the
// `modelRepoFromUrlRef` guard below is what enforces that.
const URL_MODEL = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('model')
  : null;

// The repos this instance offers, and which one (if any) the URL asks for.
// Resolved at module scope, next to the param itself, because the settings
// restore has FOUR paths that boot without reading a saved value (?reset, a
// version mismatch, the watchdog, and the catch), and a first-time visitor
// takes the version-mismatch one. Deciding this inside the full restore meant
// exactly the people a shared ?model= link is FOR -- someone opening the app
// for the first time -- silently got the default model instead.
// CONFIG is already frozen at import (config.js reads window.__CONFIG__ at
// module load), so this sees the same value the component would.
const MODEL_REPOS = parseModelRepos(CONFIG.VITE_MODEL_REPO);
// A flat /models mount carries no repo identity, so it can only be attributed
// to a repo when there is exactly one on offer. With a picker, letting the flat
// tree answer for a repo it has no subfolder for would load the mounted repo's
// weights under the selected repo's name: same architecture, same vocab size,
// so a fluent transcript from the wrong model and no error anywhere. Passed to
// hub.js, which then refuses that fallback. (docker/entrypoint.sh enforces the
// same invariant server-side by refusing to descend into a nested mount when
// several repos are configured; this also covers mounts it never saw.)
const ALLOW_FLAT_LOCAL_FALLBACK = MODEL_REPOS.length <= 1;
const URL_MODEL_REPO = matchModelRepo(URL_MODEL, MODEL_REPOS);
if (URL_MODEL && !URL_MODEL_REPO) {
  console.warn(`[App] ?model=${URL_MODEL} matched none of the offered repos; ignoring it.`);
} else if (URL_MODEL_REPO) {
  console.log(`[App] ?model=${URL_MODEL} -> ${URL_MODEL_REPO} (this visit only, not saved)`);
}

// `?mode=med` (and the other aliases in lib/medMode.js) boots the app straight
// into the French medical dictation preset: the UltiMed model, the French
// medical phrase list, 30 s chunks, int8 on CPU / fp16 on GPU, the dictation
// display, a French UI, and an autoconfigure probe fired on page load instead
// of at the Load-model click.
//
// UNLIKE `?model=`, this one IS sticky: the preset is applied through the
// ordinary setters so every value persists like a hand pick. That is the owner's
// call, and the reasoning is that a link named "medical mode" is a setup
// instruction ("configure this machine as a dictation station"), not a one-visit
// override the way pinning a model for a comparison is. The sidebar button
// applies the exact same preset, so a visitor can always re-run it, and the
// individual controls stay editable afterwards.
//
// Read once at module load (the query string doesn't change within a session).
const URL_MED_MODE = typeof window !== 'undefined' && medModeRequested(window.location.search);
// The offered repo the preset's model query resolves to, or null when this
// instance serves no UltiMed repo. Null is not fatal: the preset applies every
// OTHER setting and leaves the model alone (with a warning), because a medical
// lexicon over the generic model is still far closer to what was asked than
// refusing the whole preset would be.
const MED_MODE_REPO = matchModelRepo(MED_MODE_PRESET.modelQuery, MODEL_REPOS);
if (URL_MED_MODE && !MED_MODE_REPO) {
  console.warn(`[App] medical mode: no offered repo matches "${MED_MODE_PRESET.modelQuery}" `
    + `(VITE_MODEL_REPO = ${MODEL_REPOS.join(', ')}); keeping the current model.`);
}

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
  // setLang is pulled in for the medical-mode preset, which forces the UI to
  // French (its model, lexicon and dictation rules are all French).
  const { t, lang, setLang } = useI18n();
  // The model repos this instance offers. VITE_MODEL_REPO is a comma-separated
  // list; a single id (the historical value) simply yields a one-entry list and
  // the picker hides itself. Order matters: the first entry is the default for
  // a visitor who has never chosen.
  const modelRepos = MODEL_REPOS;
  // The repo actually loaded. Seeded with the URL's choice when it made one
  // (so it holds on EVERY boot path, including a first visit), else the
  // operator default; the settings restore below then applies a saved pick,
  // but only when the URL did not already decide.
  const [repoId, setRepoId] = useState(URL_MODEL_REPO || MODEL_REPOS[0]);
  // Where model weights are served from:
  //   'hf'    : HuggingFace only (default)
  //   'local' : instance-served /models/ only (skip HF entirely)
  //   'both'  : HF first, silent fallback to /models/ if HF is unreachable
  const rawModelSource = (CONFIG.VITE_MODEL_SOURCE || 'hf').toLowerCase();
  const modelSource = (rawModelSource === 'local' || rawModelSource === 'both') ? rawModelSource : 'hf';
  const forceLocalFallback = modelSource === 'local';
  const localFallbackEnabled = modelSource === 'local' || modelSource === 'both';
  // Background HuggingFace preflight (lib/hubReachability.js). On a network that
  // BLACKHOLES outbound traffic rather than refusing it, the default HF-first
  // load stalls for a full browser connect timeout before the local mirror it
  // could have used from the start is even tried. Answering the question from
  // page load, in the background, turns that stall into a reordering. The ref is
  // what loadModel reads, because loadModel's default arguments are evaluated
  // against a closure that a state update would leave stale.
  const localFirstRef = useRef(false);
  useEffect(() => {
    // 'local' never touches HF, so there is nothing to learn and no request
    // worth making (the CSP does not even list the host in that configuration).
    if (modelSource === 'local') return;
    let cancelled = false;
    (async () => {
      const hubReachable = await probeHubReachable({ repoId });
      if (cancelled) return;
      const localFirst = preferLocalFirst({ modelSource, hubReachable });
      localFirstRef.current = localFirst;
      if (localFirst) {
        console.log('[App] HuggingFace is unreachable from this machine; '
          + 'loading from /models first (and only falling back to HuggingFace if that misses).');
      }
    })();
    return () => { cancelled = true; };
    // Re-probes when the visitor switches repo: the probe URL is repo-scoped,
    // so a different repo is a different question even though host
    // reachability is not.
  }, [modelSource, repoId]);

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
  // The one model failure a visitor can do nothing about: this deployment does
  // not serve the default encoder, so no setting they could change would help.
  // A banner would sit above a page that still looks usable, so it gets the
  // blocking popup instead, the same one a phone gets.
  const [fatalModelError, setFatalModelError] = useState(null);
  // Non-fatal notice: the GPU backend could not be served by this model
  // source, so the load fell back to WASM. Separate from modelLoadError
  // because the load then SUCCEEDS, and loadModel clears that on entry.
  const [gpuFallbackWarning, setGpuFallbackWarning] = useState(null);
  // What the CURRENTLY LOADED model actually is:
  // `{ repoId, backend, encoderQuant, decoderQuant, servedFrom }`, or null when
  // nothing is loaded. Deliberately NOT persisted: it describes a live session's
  // model, and a value restored from disk would assert something about a model
  // that has not been loaded yet. Every other model control in the sidebar shows
  // a REQUEST; this is the only thing that shows the OUTCOME, which is what makes
  // a divergence visible instead of silent (a WebGPU pick answered by an int8 CPU
  // model after the quant fallback, or weights served by /models rather than by
  // HuggingFace).
  const [loadedModelInfo, setLoadedModelInfo] = useState(null);
  // The repo+precision combination this source was PROVEN unable to serve to
  // the GPU (`<repoId>|<webgpuEncoderQuant>`), or null. Written when the
  // QuantUnavailableError fallback below flips a visitor to WASM, and read by
  // the medical-mode autoconfigure so re-applying a stored WebGPU verdict
  // cannot fight that flip on every visit. Persisted because the flip itself is
  // persisted, so a session-only memory would forget one and not the other. It
  // needs no explicit invalidation: the signature stops matching the moment
  // either half changes, which is exactly when the GPU deserves another try.
  const [gpuWeightsUnservableSig, setGpuWeightsUnservableSig] = useState(null);
  // Signatures written by a load in THIS session. The self-healing effect below
  // clears an inherited mark when the source starts offering the precision
  // again, and this is what stops it from clearing one that a load just earned
  // the hard way against the real files.
  const gpuUnservableSetThisSessionRef = useRef(new Set());
  const [backend, setBackend] = useState('wasm');
  // Encoder precision for the WASM/CPU backend: 'int8' (default; ~900 MB, fast,
  // good quality on long audio: since 2026-09-03 both repos ship it as a
  // MatMulNBits 8-bit build, weight-only int8 with dynamic int8 activations),
  // 'int8lite' (the lighter SmoothQuant build, 11 MatMuls left in fp32 instead
  // of 18: ~88 MB smaller and ~164 MiB lighter on RAM, slightly less accurate)
  // or 'fp32' (sharded ~2.4 GB,
  // full quality, ~35 % slower). Both non-default values are opt-in: only
  // honoured when the repo actually ships the matching files, else hub.js throws
  // QuantUnavailableError (no silent downgrade; resolveModelQuant). Ignored on
  // WebGPU, which has its own selection.
  const [wasmEncoderQuant, setWasmEncoderQuant] = useState(DEFAULT_WASM_ENCODER_QUANT);
  // Encoder precision for the WebGPU backend: fp16 (~1.2 GB, near-lossless) by
  // default, else fp32 (~2.4 GB, sharded) or w4a8 (MatMulNBits, the only
  // quantised encoder with a GPU kernel; int8 has none). fp16 was withdrawn on
  // 2026-08-23 on the premise that no reachable GPU exposes the `shader-f16`
  // adapter feature its WGSL kernels need; a benchmark report from an Intel
  // UHD 630 laptop (2026-09-03) reported that feature present, so the premise
  // was simply wrong and it is offered again, gated on the feature rather than
  // assumed absent, and made the default on 2026-09-11 now that a machine
  // without the feature degrades to fp32 before hub.js ever sees the request.
  // Ignored on WASM, which uses wasmEncoderQuant.
  const [webgpuEncoderQuant, setWebgpuEncoderQuant] = useState(DEFAULT_WEBGPU_ENCODER_QUANT);
  // Whether the WebGPU adapter reports `shader-f16`. null = still probing (or
  // no adapter), true/false = resolved. Filled by the availability probe below
  // and the ONLY thing that decides whether fp16 is offered: without it ORT
  // builds the session happily and then returns an empty transcript, the worst
  // possible failure mode, so the precision must never be reachable.
  const [webgpuShaderF16, setWebgpuShaderF16] = useState(null);
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
  // Tracks whether the backend reflects an explicit choice (restored from a
  // saved setting or picked in the UI) vs. our automatic default. The automatic
  // default (always WASM int8) only applies when this is false.
  const backendChosenByUserRef = useRef(false);
  // Distinct from backendChosenByUserRef on purpose. That ref goes true as soon
  // as a SAVED backend is restored, and the app persists `backend` on every
  // boot, so by the second page load it is true for everyone, whether or not a
  // human ever touched the radios. The performance probe must not overrule a
  // real choice, so it needs the narrower fact: did the user actually pick?
  // Only chooseBackend (the radios) sets this, and it is persisted.
  const [backendUserPicked, setBackendUserPicked] = useState(false);
  const chooseBackend = (value) => {
    backendChosenByUserRef.current = true;
    setBackendUserPicked(true);
    setBackend(coerceBackend(value));
  };
  // First-load performance probe (lib/perfProbe.js): prefetched artifacts, the
  // stored verdict, and the in-flight guard. `probeState` drives the sidebar
  // button ('idle' | 'running' | 'done' | 'failed').
  const probeAssetsRef = useRef(null);      // Promise<{wasm,webgpu}> of ArrayBuffers
  // Coarse GPU identity, filled by the WebGPU availability probe below; a
  // stored verdict is only reused while the machine still reports this adapter.
  const webgpuAdapterSigRef = useRef(null);
  const probeRunningRef = useRef(false);
  const [probeState, setProbeState] = useState('idle');
  const [probeVerdict, setProbeVerdict] = useState(null);
  const [memoryInfo, setMemoryInfo] = useState(null);
  const [, startTransition] = useTransition();
  const [preprocessor, setPreprocessor] = useState('nemo128');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(null);
  // Sliding-window state (trailing 10 s mean) for the download speed / ETA
  // estimate, reset per model load.
  const downloadRateRef = useRef(null);
  // Bytes actually pulled over the network by the current model load, keyed by
  // file (the highest `loaded` each one reported). A file served from the
  // IndexedDB cache emits no byte progress at all, so a load that ends with an
  // empty map was fully warm. The benchmark reports this per row: a load time
  // with no cold/warm attached cannot be compared against another machine's,
  // and it is the only way to see that the GPU path re-downloads its uncacheable
  // fp32 shards on every single load while the int8 path pays once.
  const loadTransferRef = useRef(new Map());
  // When the first byte of this load actually crossed the network, or null
  // if none ever did. Set from the progress callback rather than from the
  // top of loadModel, so a cache-only load reports no fetch time at all.
  const fetchStartedRef = useRef(null);
  // Open/closed state of each collapsible settings group, keyed by section id.
  // A section is open only when its id maps to true, so every group starts
  // collapsed; the whole object is persisted so the choice survives reloads.
  const [sectionsOpen, setSectionsOpen] = useState({});
  const toggleSection = useCallback((id) => {
    setSectionsOpen(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);
  const [text, setText] = useState('');
  const [latestMetrics, setLatestMetrics] = useState(null);
  const [transcriptions, setTranscriptions] = useState([]);
  // Track the most recently added transcription ID for fade-in animation
  const newestTranscriptionIdRef = useRef(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  // Synchronous mirror of isTranscribing so the capture queue's canRun() sees
  // "a transcription is running" the instant it flips, not a render later.
  // setTranscribing keeps the ref and the state in lockstep; use it everywhere
  // instead of the raw setIsTranscribing.
  const isTranscribingRef = useRef(false);
  const setTranscribing = (v) => { isTranscribingRef.current = v; setIsTranscribing(v); };
  // Number of captures buffered by the queue (audio finished before the model
  // was ready). Surfaces a small "waiting for the model" note.
  const [pendingCaptureCount, setPendingCaptureCount] = useState(0);
  const [verboseLog, setVerboseLog] = useState(false);
  // Collect per-token decode introspection (logits, boost bonus, beam
  // timeline) on every transcription and expose a per-entry "Debug" view.
  // In-memory only: the payload is never persisted (slimTranscriptForPersist).
  const [debugDecode, setDebugDecode] = useState(false);
  // Machine-oriented environment recap shown in the Debug section (lib/
  // supportReport.js): regenerated each time the section opens and on copy,
  // never persisted.
  const [supportReport, setSupportReport] = useState('');
  const [supportReportCopied, setSupportReportCopied] = useState(false);
  // Sidebar Benchmark section (lib/benchmark.js): one click measures every
  // backend/precision this machine can run on a fixed clip that ships with the
  // app, then folds the timings into one anonymised report the user can read,
  // copy, and optionally send to the maintainer. All in-memory except the
  // "always send" opt-in, which is persisted and defaults to OFF.
  const [benchmarkPlan, setBenchmarkPlan] = useState([]);
  const [benchmarkSelected, setBenchmarkSelected] = useState({});
  const [benchmarkLongProfile, setBenchmarkLongProfile] = useState(false);
  const [benchmarkRepeats, setBenchmarkRepeats] = useState(1);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState('');
  const [benchmarkResults, setBenchmarkResults] = useState([]);
  const [benchmarkReport, setBenchmarkReport] = useState('');
  const [benchmarkCopied, setBenchmarkCopied] = useState(false);
  // Set when a run finishes with a report. It survives the progress line being
  // cleared, so the sidebar still says the benchmark is done while the restore
  // step (which can reload a model) is still running.
  const [benchmarkDone, setBenchmarkDone] = useState(false);
  const benchmarkReportRef = useRef(null);
  // idle | sending | sent | failed
  const [benchmarkSendState, setBenchmarkSendState] = useState('idle');
  const [benchmarkAutoSend, setBenchmarkAutoSend] = useState(false);
  const benchmarkCancelRef = useRef(false);
  // Set after every successful benchmark load so the run can put the user's
  // own model back only when the last combination left something else loaded.
  const benchmarkLoadedComboRef = useRef(null);
  const [frameStride, setFrameStride] = useState(1);
  // Beam search width. 1 = greedy (fastest). Higher widths explore alternative
  // hypotheses (~Nx decode cost) and let phrase boosting recover phrases greedy
  // would prune. Full-file only: the streaming path forces width 1 in the
  // decoder. While `beamWidthAuto` is true (the user never chose a width) the
  // value is coupled to the boost state (lib/beamWidth.js): greedy without an
  // active phrase list, DEFAULT_BEAM_WIDTH with one, because the 2026-08 sweep
  // showed a wide beam WORSENS accuracy without a lexical prior and improves
  // it with one. Editing the width in the UI turns the coupling off for good.
  const [beamWidth, setBeamWidth] = useState(DEFAULT_BEAM_WIDTH);
  const [beamWidthAuto, setBeamWidthAuto] = useState(true);
  // MAES (Modified Adaptive Expansion Search) knobs, used only when beamWidth>1.
  // num-steps/beta/gamma are NeMo's `maes` defaults (2 / 2 / 2.3), matching
  // parakeet.js and transcribe.mjs. An earlier build shipped wider values
  // (3 / 4 / 4.0); a grid sweep over these knobs plus a pink-noise SNR A/B (clean
  // down to 0 dB) found the wider preset gave no accuracy gain at any audio
  // quality while costing a little more decode, so they were aligned back to the
  // NeMo defaults. prefixAlpha defaults to 0 (NeMo uses 1): a grid search over
  // French-medical + FLEURS-fr (494 utts, int8, beam 5) on both the CPU and GPU
  // backends found prefix-search recombination gave WER/CER identical to off
  // within noise while costing ~15-20% more decode time, so it ships off. Users
  // can still re-enable any of these from the sidebar.
  const [maesNumSteps, setMaesNumSteps] = useState(2);
  const [maesExpansionBeta, setMaesExpansionBeta] = useState(2);
  const [maesExpansionGamma, setMaesExpansionGamma] = useState(2.3);
  const [maesPrefixAlpha, setMaesPrefixAlpha] = useState(0);
  // Chunking: split long audio into smaller segments before transcribing
  const [enableChunking, setEnableChunking] = useState(true);
  const [chunkDuration, setChunkDuration] = useState(DEFAULT_CHUNK_DURATION_SEC); // seconds
  // Chunk-parallel encoding on WASM (a pool of encode workers). Default ON;
  // encodePoolPlan additionally gates on hardware (cores/RAM/threads) at model
  // load, so weak machines never spawn the pool even with the toggle on.
  const [parallelEncode, setParallelEncode] = useState(true);
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
  // Depth of in-flight WebGPU transcription runs holding the html.gpu-run
  // animation pause (see runTranscription); the class drops only at 0.
  const gpuRunDepthRef = useRef(0);
  const maxCores = navigator.hardwareConcurrency || 8;
  // ORT-style default (min(4, ceil(cores/2))): hardwareConcurrency counts
  // hyperthreads and ORT-WASM's spin-waiting pool makes oversubscription
  // slower than fewer threads, so "all cores" was actively harmful.
  const [cpuThreads, setCpuThreads] = useState(() => defaultWasmThreads(maxCores));
  const modelRef = useRef(null);
  const fileInputRef = useRef(null);

  // --- Live model swap (Q1: change a model param while loaded -> reload) ---
  // Armed by a user edit of a model-defining control (backend / encoder
  // precision) while a model is already loaded, so the sig-watching effect
  // (near loadModel) disposes the current model and reloads with the new value
  // once it has been committed to state. Programmatic changes and the initial
  // load leave it unarmed, so they never trigger a reload.
  const reloadModelOnParamChangeRef = useRef(false);
  // True while the loaded repo came from ?model= rather than from this
  // visitor. It suppresses persistence (a link must not overwrite their own
  // pick) and is cleared the moment they choose in the sidebar, which makes
  // that choice theirs and saveable again.
  const modelRepoFromUrlRef = useRef(!!URL_MODEL_REPO);
  const armModelReloadIfLoaded = () => {
    if (modelRef.current) reloadModelOnParamChangeRef.current = true;
  };
  // CPU-threads reloads on blur (a number field can't sanely reload per
  // keystroke), so remember the thread count the live model was built with and
  // only reload when the committed value actually differs.
  const loadedCpuThreadsRef = useRef(maxCores);

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
  // Hard cap on local-mic accumulation. At 96 kHz this is 90 min (~518 MB
  // of raw float32 audio); at the typical 48 kHz mic rate it's ~3 hours.
  // Past this point continuing to grow the buffer risks crashing the tab,
  // so we stop the recording and surface an alert instead.
  const LOCAL_RECORDING_MAX_SAMPLES = 90 * 60 * 96000;
  const clearPcmChunks = () => {
    pcmChunksRef.current = [];
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
  const [autoGainControl, setAutoGainControl] = useState(true);
  // Linear gain multiplier applied on the phone before audio leaves the
  // device. Only affects the remote mic path; the local mic doesn't use
  // it. Default 2.0 because phones tend to under-amplify voice once
  // their AGC kicks in.
  const [remoteMicGain, setRemoteMicGain] = useState(2.0);

  // Remote microphone ("phone as mic"): the encrypted WebRTC session, its
  // handshake and fingerprint verification, and the batch it produces, lifted
  // into their own hook (hooks/useRemoteMic.js). Only these 22 names cross the
  // boundary; the RTC handle, the ECDH key, the rate/format negotiation, the
  // verify resolvers, the elapsed timer and the QR loader stay inside it.
  const {
    isRemoteMic, remoteMicModal, remoteMicStatus,
    remoteMicLevel, remoteMicElapsed, remoteMicError, remoteMicDecryptErrors,
    remoteMicPaused, remoteMicRecording, remoteMicQrRef,
    remoteMicFingerprint, remoteMicVerifiedAt, remoteMicVerifyResolveRef,
    startRemoteMic, stopRemoteMic, pauseRemoteMic, resumeRemoteMic,
    disconnectRemoteMic, cancelRemoteMic, regenerateRemoteMicQr,
  } = useRemoteMic({
    t,
    isRecording,
    clearPcmChunks,
    appendPcmChunk,
    concatPcmChunks,
    noiseSuppression,
    autoGainControl,
    remoteMicGain,
    setStatus,
    setAwaitingFinal,
    modelRef,
    isTranscribingRef,
    // captureQueue is built further down the body, so hand over a call rather
    // than the object: the arrow only runs once a batch really arrives.
    submitCapture: (job) => captureQueueRef.current.submit(job),
    maybeStartLiveTranscriber,
    stopLiveTranscriberIfRunning,
  });
  const [copySuccess, setCopySuccess] = useState(false);
  const [copiedHistoryId, setCopiedHistoryId] = useState(null);



  // F-127: when any modal is foregrounded, disable per-history kebab actions
  // so an extension keystroke-injection (Tab + Enter while a modal is open)
  // cannot drive clipboard exfiltration via the per-entry Copy buttons.
  const anyModalOpen = useAnyModalOpen();

  // Tracks which history item has its kebab menu open (by transcription id)
  const [openKebabId, setOpenKebabId] = useState(null);
  // Close any open kebab dropdown when a modal mounts so its inner Copy
  // buttons are not reachable by Tab+Enter from inside the modal.
  useEffect(() => { if (anyModalOpen) setOpenKebabId(null); }, [anyModalOpen]);

  // Per-entry display is two ORTHOGONAL axes, not one mode:
  //  - base view (id -> 'raw'|'diarized'): the structural view, mutually
  //    exclusive, lives in entryDisplayModes.
  //  - dictation (id -> bool): an independent regex-cleanup layer that applies
  //    on top of EITHER base (cleaned flat text, or cleaned per speaker turn),
  //    lives in entryDictation.
  // Both default to the global `transcriptDisplayMode` ("default transcript
  // display"), decomposed: 'diarized' -> diarized base, 'dictation' -> dictation
  // layer on a raw base, 'raw' -> neither. Either axis can be toggled per entry.
  const [entryDisplayModes, setEntryDisplayModes] = useState({});
  const [entryDictation, setEntryDictation] = useState({});
  // Set of transcription ids whose inline audio player is expanded.
  const [openAudioIds, setOpenAudioIds] = useState(() => new Set());
  // Id of the entry currently being re-transcribed via "Transcribe again", so
  // its button can show a spinner. Only one runs at a time (isTranscribing).
  const [reTranscribingId, setReTranscribingId] = useState(null);
  // Lazily-created object URLs for the inline players (id -> url). Kept in a ref
  // so we can revoke them on close/delete/unmount without re-rendering.
  const entryAudioUrlsRef = useRef(new Map());

  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Phrase boosting lives in its own hook (hooks/usePhraseBoost.js): the phrase
  // text and knobs, the operator-list manifest and its server-prebuilt
  // encodings, the BPE encode worker, the debounced trie rebuild, and the gate
  // a run waits on. Called HERE, below `settingsLoaded` and `modelRef`, because
  // both are inputs and a `const` cannot be read before its declaration; and
  // above the settings restore, which writes most of what it returns.
  const {
    boostPhrases, setBoostPhrases,
    boostStrength, setBoostStrength,
    boostMinp, setBoostMinp,
    boostDepthScaling, setBoostDepthScaling,
    boostFiles, boostFilesLoaded,
    boostSource, setBoostSource,
    boostCustomText, setBoostCustomText, boostCustomTextRef,
    applyBoostSource, boostSourceSavedRef,
    boostLineCount, boostCollapsed, boostCustomOversize,
    boostEditorOpen, setBoostEditorOpen, toggleBoostingSection,
    boostWarnings, boostConflicts, boostUnkWarnings, boostPhraseCount, boostRebuilding,
    phraseBoostRef, boostEncodedRef, waitForBoostReady,
    tokenizerVocabSig, setTokenizerVocabSig,
  } = usePhraseBoost({
    verboseLog,
    settingsLoaded,
    modelRef,
    toggleSection,
    // A ?mode= medical link resolves the boost source itself (applyMedModeSettings
    // below), so the hook's own one-shot init must stand down rather than race it.
    skipInit: URL_MED_MODE,
  });

  // The two off-main-thread pipeline workers (hooks/usePipelineWorkers.js): the
  // decode worker and the chunk-parallel encode pool. Called HERE because it
  // needs `boostEncodedRef` from usePhraseBoost above (the decode worker
  // rebuilds its own trie from those cloneable ids), and every consumer
  // (loadModel, runTranscription) sits far below.
  const {
    decodeWorkerRef, decodeWorkerReadyRef, decodeWorkerInitParamsRef,
    composedDecodeEligibleRef, startDecodeWorker, stopDecodeWorker,
    syncDecodeWorkerBoost, decodeChunkViaWorker,
    encodePoolRef, encodePoolReadyRef, encodePoolInitParamsRef,
    startEncodePool, teardownEncodePool, encodeChunkViaPool,
    wasmDecodePipelineEnabled,
  } = usePipelineWorkers({ cpuThreads, maxCores, parallelEncode, settingsLoaded, boostEncodedRef });



  // NOTE ON PLACEMENT: this block reads `settingsLoaded` and `webgpuShaderF16`
  // in a dependency array, which React evaluates during RENDER, so it has to
  // sit below both declarations. Putting it up with the other model state
  // (where it belongs by subject) threw `Cannot access '...' before
  // initialization` and took the whole app down, blank page and all.
  // Which encoder precisions the MODEL SOURCE can actually serve.
  //
  // Precision availability has three independent gates and only two of them
  // used to be checked before the visitor clicked. The backend's kernel list
  // (lib/encoderQuants.js) and the adapter's `shader-f16` feature were both
  // consulted up front; whether the deployment HOSTS the file was discovered
  // only after a load had already failed. That is how a station whose mirror
  // serves int8, w4a8 and sharded fp32 came to offer an fp16 radio, take the
  // click, and answer with "this source does not host it" plus a demotion to
  // the CPU. Nothing was broken in that message, it just arrived far too late
  // and after a decision it should have prevented.
  //
  // A source always describes itself in the end: a local mirror publishes
  // model-manifest.json (docker/entrypoint.sh writes one per repo at every
  // boot) and HuggingFace has a listing API. hub.js reads exactly that listing
  // during every load, so this asks the same question earlier and for all
  // precisions at once, and `quantSatisfiable` stays the single predicate.
  //
  // null means NO OPINION, and every consumer must treat it that way: an
  // unreachable listing, a mirror with no manifest, or a probe still in flight
  // must offer everything rather than grey out a precision that would have
  // loaded. Failing to the permissive side keeps this a hint, never a gate.
  const [sourceRepoFiles, setSourceRepoFiles] = useState(null);
  useEffect(() => {
    if (!settingsLoaded) return undefined;
    let cancelled = false;
    setSourceRepoFiles(null);
    (async () => {
      // Wait for the reachability answer before choosing WHICH source to list:
      // on a network that blocks HuggingFace the listing that matters is the
      // mirror's, and asking the hub first would just stall this out too.
      await new Promise((r) => setTimeout(r, 0));
      const localOnly = forceLocalFallback || localFirstRef.current;
      const listLocal = async () => {
        const base = (await resolveLocalModelBase('/models', repoId, {
          allowFlatFallback: ALLOW_FLAT_LOCAL_FALLBACK,
        }).catch(() => null))
          || ((!ALLOW_FLAT_LOCAL_FALLBACK && repoId) ? `/models/${repoId}` : '/models');
        return listLocalRepoFiles(base).catch(() => null);
      };
      let files = localOnly ? await listLocal() : await listRepoFiles(repoId).catch(() => null);
      // The same both-ways fallback the load itself performs, so the radios
      // describe whichever source will really answer rather than the one that
      // happens to be tried first.
      if (!files?.length && !localOnly) files = await listLocal();
      if (!files?.length && localOnly && modelSource !== 'local') {
        files = await listRepoFiles(repoId).catch(() => null);
      }
      if (cancelled) return;
      setSourceRepoFiles(files?.length ? files : null);
    })();
    return () => { cancelled = true; };
  }, [settingsLoaded, modelSource, repoId, forceLocalFallback]);

  // Recomputed rather than stored, because the adapter probe finishes on its own
  // schedule: a listing that arrived before `shader-f16` was known would
  // otherwise be frozen into an answer that says fp16 is unservable on a machine
  // that can run it.
  const sourceQuants = useMemo(
    () => servableEncoderQuants({ repoFiles: sourceRepoFiles, shaderF16: webgpuShaderF16 === true }),
    [sourceRepoFiles, webgpuShaderF16],
  );

  // Let the "this source cannot feed the GPU" memory heal itself once the source
  // can. The signature was written on the assumption that it needs no explicit
  // invalidation, because it stops matching as soon as the repo or the precision
  // changes. That reasoning missed the case that actually happened: NEITHER half
  // changes when the operator publishes the missing encoder, so a visitor pinned
  // to WASM over a file that is now sitting on the server stays pinned to WASM
  // for good. It is worse than a slow deployment reaching them late, because the
  // flip is persisted and medical mode reads this signature specifically to
  // avoid re-applying its WebGPU verdict. A listing that now offers the
  // precision is exactly the evidence that the pin is spent, so drop it.
  //
  // Only a mark inherited from an EARLIER session is cleared. One written by a
  // load in this session stays: that load just proved, against the real files,
  // that the listing is wrong, and clearing it on the listing's say-so would put
  // the visitor back on a GPU whose weights 404 on every visit.
  useEffect(() => {
    if (!settingsLoaded || !gpuWeightsUnservableSig) return;
    if (gpuUnservableSetThisSessionRef.current.has(gpuWeightsUnservableSig)) return;
    const servable = sourceQuants?.webgpu;
    if (!servable) return;
    const [sigRepo, sigQuant] = String(gpuWeightsUnservableSig).split('|');
    if (sigRepo !== repoId || !servable.includes(sigQuant)) return;
    console.log(`[App] ${repoId} now serves ${sigQuant} for the GPU; clearing the unservable mark.`);
    setGpuWeightsUnservableSig(null);
  }, [settingsLoaded, gpuWeightsUnservableSig, sourceQuants, repoId]);

  // True once the (potentially large/slow) transcript history has actually been
  // read back into state. The history loads *after* settingsLoaded flips, so the
  // transcript-persist effect must wait on this too: otherwise the early
  // settingsLoaded=true would let it write the still-empty array over the
  // on-disk history before the read resolves. See the load effect below.
  const transcriptsRestoredRef = useRef(false);
  // Auto-copy: when enabled, every transcription is written to the system
  // clipboard. F-125: default OFF so the headline "audio never leaves your
  // device" promise also holds for transcript text. The system clipboard is
  // readable by any other app and by browser extensions that hold
  // clipboardRead for any other site (Permissions-Policy on this origin
  // does not constrain extension content-scripts), so the privacy contract
  // is broken if this defaults on. Users who want auto-copy must opt in.
  const [autoCopyToClipboard, setAutoCopyToClipboard] = useState(false);
  // Rewrite spelled-out cardinal numbers as digits in the finished transcript
  // ("vingt-cinq milligrammes" -> "25 milligrammes"). ON by default: a dictated
  // dose or measurement is what the reader actually wants to see. The language
  // is the UI language, since the converter's vocabularies overlap ("cent" is
  // 100 in French and money in English) and guessing wrong is worse than not
  // converting. See lib/numberWords.js.
  const [numbersToDigits, setNumbersToDigits] = useState(true);
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
  // Display mode: 'raw' = plain transcription, 'dictation' = regex-cleaned
  const [transcriptDisplayMode, setTranscriptDisplayMode] = useState('raw');
  const [dictationRegexRules, setDictationRegexRules] = useState([]); // [{regex, replacement, source}]
  const [dictationRegexLoaded, setDictationRegexLoaded] = useState(false);
  // Track which transcriptions have had dictation applied (id -> cleaned text)
  const [dictationCache, setDictationCache] = useState({});

  // Speaker diarization ("Speakers" view): 15 state slots, the run itself and
  // the rename/merge helpers, lifted into their own hook (hooks/useDiarization.js).
  // Called here rather than beside the other transcript state because it needs
  // transcriptDisplayMode, which is declared just above.
  const {
    diarizationCache,
    persistedTurns, setPersistedTurns,
    speakerNames, setSpeakerNames,
    diarizeEntry, cancelDiarizeEntry, diarizingId, diarProgress,
    diarizationModelError, diarPrefetchDoneRef,
    diarizationNumSpeakers, setDiarizationNumSpeakers,
    diarizationNumByEntry, setDiarizationNumByEntry,
    speakerDisplayName, commitSpeakerRename,
    editingSpeaker, setEditingSpeaker,
    editingSpeakerDraft, setEditingSpeakerDraft,
    renameCancelRef, setSpeakerMerges,
    getDiarizedTurns, hasDiarization, enrichTranscriptForPersist,
  } = useDiarization({
    t,
    status,
    transcriptions,
    forceLocalFallback,
    localFirstRef,
    entryDisplayModes,
    transcriptDisplayMode,
    getEntryBase,
    setEntryBase,
  });

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
        // Escape hatch: `?reset` / `#reset` in the URL wipes saved settings and
        // boots on defaults (recovery for a persisted value that wedged the UI).
        // Runs BEFORE any saved value is read, so a bad setting is never applied.
        if (urlRequestsSettingsReset()) {
          console.log('[App] URL reset requested; purging saved settings and booting on defaults.');
          await clearAllSettings();
          await saveSetting('version', VERSION);
          stripSettingsResetFromUrl();
          if (booted) return;
          booted = true;
          clearTimeout(watchdog);
          setSettingsLoaded(true);
          return;
        }

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
          savedBackendUserPicked,
          savedPerfProbeVerdict,
          savedGpuWeightsUnservableSig,
          savedWasmEncoderQuant,
          savedWebgpuEncoderQuant,
          savedPreprocessor,
          savedVerboseLog,
          savedDebugDecode,
          savedFrameStride,
          savedBeamWidth,
          savedBeamWidthAuto,
          savedMaesNumSteps,
          savedMaesExpansionBeta,
          savedMaesExpansionGamma,
          savedMaesPrefixAlpha,
          savedCpuThreads,
          savedCpuThreadsMigrated,
          savedParallelEncode,
          savedNoiseSuppression,
          savedAutoGainControl,
          savedRemoteMicGain,
          savedAutoCopyToClipboard,
          savedNumbersToDigits,
          savedPersistTranscripts,
          savedShowAdvancedInfo,
          savedKeyboardShortcutsEnabled,
          savedEnableChunking,
          savedChunkDuration,
          savedChunkDurationMigrated,
          savedTranscriptDisplayMode,
          savedDiarizationNumSpeakers,
          savedLiveTranscriptionEnabled,
          savedLiveContextWindow,
          savedBoostPhrases,
          savedBoostStrength,
          savedBoostMinp,
          savedBoostDepthScaling,
          savedBoostSource,
          savedBoostCustomText,
          savedSectionsOpen,
          savedBenchmarkAutoSend,
          savedModelRepo,
        ] = await Promise.all([
          loadSetting('backend', null),
          loadSetting('backendUserPicked', false),
          loadSetting('perfProbeVerdict', null),
          loadSetting('gpuWeightsUnservableSig', null),
          loadSetting('wasmEncoderQuant', DEFAULT_WASM_ENCODER_QUANT),
          loadSetting('webgpuEncoderQuant', DEFAULT_WEBGPU_ENCODER_QUANT),
          loadSetting('preprocessor', 'nemo128'),
          loadSetting('verboseLog', false),
          loadSetting('debugDecode', false),
          loadSetting('frameStride', 1),
          // null defaults so restoreBeamWidthAuto can tell "never set" apart
          // from an explicit choice (see lib/beamWidth.js).
          loadSetting('beamWidth', null),
          loadSetting('beamWidthAuto', null),
          loadSetting('maesNumSteps', 2),
          loadSetting('maesExpansionBeta', 2),
          loadSetting('maesExpansionGamma', 2.3),
          loadSetting('maesPrefixAlpha', 0), // off by default (see useState above)
          // null default so restoreCpuThreads can tell "never set" apart from
          // a persisted value; the migrated flag makes its legacy-default
          // rescue run exactly once (see lib/cpuThreads.js).
          loadSetting('cpuThreads', null),
          loadSetting('cpuThreadsMigrated', false),
          loadSetting('parallelEncode', true),
          loadSetting('noiseSuppression', true),
          loadSetting('autoGainControl', true),
          loadSetting('remoteMicGain', 2.0),
          loadSetting('autoCopyToClipboard', false),
          loadSetting('numbersToDigits', true),
          // Load with `null` so the F-132 default below can tell "never set"
          // apart from an explicit choice (see the setPersistTranscripts comment).
          loadSetting('persistTranscripts', null),
          loadSetting('showAdvancedInfo', false),
          loadSetting('keyboardShortcutsEnabled', false),
          loadSetting('enableChunking', true),
          // Load with `null` so the restore below can tell "never set" apart from
          // an explicit choice; when never set, chunkDuration keeps its
          // DEFAULT_CHUNK_DURATION_SEC initial value. The migrated flag makes
          // the legacy-default rescue run exactly once (see lib/chunkDuration.js).
          loadSetting('chunkDuration', null),
          loadSetting('chunkDurationMigrated', false),
          loadSetting('transcriptDisplayMode', 'raw'),
          loadSetting('diarizationNumSpeakers', 0),
          loadSetting('liveTranscriptionEnabled', false),
          loadSetting('liveContextWindow', 'auto'),
          loadSetting('boostPhrases', ''),
          loadSetting('boostStrength', BOOST_STRENGTH_DEFAULT),
          loadSetting('boostMinp', BOOST_MINP_DEFAULT), // null = off; number in [0,1] = gate (0 boost-all, 1 off)
          loadSetting('boostDepthScaling', DEFAULT_DEPTH_SCALING),
          // Load with `null` (not the Custom sentinel) so the restore below can
          // tell "user never picked a boost source" apart from "user explicitly
          // chose Custom". Only the former falls back to the ?phrase_boost= param
          // / VITE_PHRASE_BOOST_DEFAULT; an explicit Custom choice is honoured.
          loadSetting('boostSource', null),
          loadSetting('boostCustomText', ''),
          loadSetting('settingsSectionsOpen', {}),
          // Benchmark reports are never sent without a decision: this is the
          // "stop asking, always send" opt-in, and it defaults to OFF.
          loadSetting('benchmarkAutoSend', false),
          // Which model repo the visitor last picked. Validated against the
          // repos this instance currently offers before it is applied, so an
          // entry the operator removed from VITE_MODEL_REPO stops being loaded
          // instead of 404ing at download time.
          loadSetting('modelRepo', null),
        ]);
        if (booted) return; // watchdog won while we awaited; skip the stale restore

        // Model repo: the URL already decided at module scope if it had an
        // opinion, and it outranks the saved pick, so only fill in the saved
        // one otherwise. A saved repo the operator has since removed from
        // VITE_MODEL_REPO is discarded rather than loaded.
        if (!URL_MODEL_REPO && savedModelRepo && modelRepos.includes(savedModelRepo)) {
          setRepoId(savedModelRepo);
        }

        // A saved value means the user previously picked a backend explicitly;
        // honour it (subject to the WebGPU-availability override below). When
        // absent, leave `backend` at its initial value so the RAM-based default
        // heuristic can choose once the WebGPU probe resolves.
        setBackendUserPicked(!!savedBackendUserPicked);
        if (savedPerfProbeVerdict && typeof savedPerfProbeVerdict === 'object') {
          setProbeVerdict(savedPerfProbeVerdict);
        }
        if (typeof savedGpuWeightsUnservableSig === 'string') {
          setGpuWeightsUnservableSig(savedGpuWeightsUnservableSig);
        }
        if (savedBackend !== null) {
          backendChosenByUserRef.current = true;
          // Coerce a persisted 'webgpu-hybrid' to WASM: WebGPU is disabled
          // app-wide, so an old saved choice must not resurrect the GPU path.
          setBackend(coerceBackend(savedBackend));
        }
        // Whitelist rather than a fp32-or-int8 ternary. That ternary silently
        // reset ANY other saved value to int8 on every boot, so when 'int8lite'
        // joined the radios the choice did not survive a reload at all. It has
        // to stay a whitelist so a value from a NEWER build (or a hand-edited
        // record) still lands on the safe default instead of being handed to
        // hub.js as an unresolvable quant.
        setWasmEncoderQuant(
          WASM_ENCODER_QUANTS.includes(savedWasmEncoderQuant)
            ? savedWasmEncoderQuant
            : DEFAULT_WASM_ENCODER_QUANT,
        );
        // Same whitelist treatment for WebGPU, which runs fp16, fp32 and w4a8:
        // a saved int8 (no GPU kernel) is coerced to the default rather than
        // restored. A saved 'fp16' DOES restore, because the list is about what
        // the app supports; whether this particular adapter can run it is a
        // separate, machine-dependent question the shader-f16 probe answers,
        // and the effective-quant fallback below turns a no into fp32 without
        // losing the preference for the next machine.
        setWebgpuEncoderQuant(
          WEBGPU_ENCODER_QUANTS.includes(savedWebgpuEncoderQuant)
            ? savedWebgpuEncoderQuant
            : DEFAULT_WEBGPU_ENCODER_QUANT,
        );
        setPreprocessor(savedPreprocessor);
        setVerboseLog(savedVerboseLog);
        setDebugDecode(!!savedDebugDecode);
        setFrameStride(savedFrameStride);
        {
          // Auto mode leaves beamWidth alone here: the coupling effect below
          // resolves it from the boost state once settingsLoaded flips.
          const beamAuto = restoreBeamWidthAuto({
            savedAuto: savedBeamWidthAuto, savedBeamWidth, deviceDefault: DEFAULT_BEAM_WIDTH,
          });
          setBeamWidthAuto(beamAuto);
          if (!beamAuto) {
            setBeamWidth(Number.isInteger(savedBeamWidth) && savedBeamWidth >= 1 ? Math.min(10, savedBeamWidth) : DEFAULT_BEAM_WIDTH);
          }
        }
        setMaesNumSteps(Number.isInteger(savedMaesNumSteps) && savedMaesNumSteps >= 1 ? savedMaesNumSteps : 3);
        setMaesExpansionBeta(Number.isInteger(savedMaesExpansionBeta) && savedMaesExpansionBeta >= 0 ? savedMaesExpansionBeta : 4);
        setMaesExpansionGamma(Number.isFinite(savedMaesExpansionGamma) && savedMaesExpansionGamma > 0 ? savedMaesExpansionGamma : 4.0);
        setMaesPrefixAlpha(Number.isInteger(savedMaesPrefixAlpha) && savedMaesPrefixAlpha >= 0 ? savedMaesPrefixAlpha : 1);
        {
          const { threads, migrationApplied } = restoreCpuThreads({
            stored: savedCpuThreads, migrated: savedCpuThreadsMigrated === true, maxCores,
          });
          setCpuThreads(threads);
          // Stamp the flag after the first restore so the legacy-default
          // rescue never re-fires on a value the user re-picks on purpose.
          if (!savedCpuThreadsMigrated || migrationApplied) saveSetting('cpuThreadsMigrated', true);
        }
        setParallelEncode(savedParallelEncode !== false);
        setNoiseSuppression(savedNoiseSuppression);
        setAutoGainControl(savedAutoGainControl);
        setRemoteMicGain(Number.isFinite(savedRemoteMicGain) ? savedRemoteMicGain : 2.0);
        setAutoCopyToClipboard(savedAutoCopyToClipboard);
        setNumbersToDigits(savedNumbersToDigits !== false);
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
        // A saved value means the user previously picked a chunk window (or the
        // old 20 s default was written back on first boot); honour it, clamped
        // to the allowed range, except the one-time legacy-default rescue to
        // the current 60 s default (see lib/chunkDuration.js). When absent,
        // chunkDuration keeps its DEFAULT_CHUNK_DURATION_SEC initial value.
        {
          const { duration, migrationApplied } = restoreChunkDuration({
            stored: savedChunkDuration, migrated: savedChunkDurationMigrated === true,
          });
          if (duration != null) setChunkDuration(duration);
          // Stamp the flag after the first restore so the rescue never
          // re-fires on a 20 s value the user re-picks on purpose.
          if (!savedChunkDurationMigrated || migrationApplied) saveSetting('chunkDurationMigrated', true);
        }
        // 'confidence' was a removed display mode; map any persisted value to 'raw'.
        setTranscriptDisplayMode(savedTranscriptDisplayMode === 'confidence' ? 'raw' : savedTranscriptDisplayMode);
        setDiarizationNumSpeakers(Number.isInteger(savedDiarizationNumSpeakers) && savedDiarizationNumSpeakers > 0 ? savedDiarizationNumSpeakers : 0);
        setLiveTranscriptionEnabled(savedLiveTranscriptionEnabled);
        setLiveContextWindow(savedLiveContextWindow);
        // Whether the user has an explicit saved boost choice. When they don't
        // (savedBoostSource is null because it was never persisted), the
        // boost-init effect falls back to the ?phrase_boost= param / the
        // VITE_PHRASE_BOOST_DEFAULT env default. An explicit Custom choice is a
        // string, so it sets this true and is honoured (not overridden).
        boostSourceSavedRef.current = typeof savedBoostSource === 'string';
        const restoredSource = typeof savedBoostSource === 'string' ? savedBoostSource : BOOST_SOURCE_CUSTOM;
        // For a curated source, deliberately leave boostPhrases empty here:
        // usePhraseBoost's one-shot init calls applyBoostSource(), which loads
        // the list's server-prebuilt encoding (.json) *before* setting
        // boostPhrases. Seeding it from the saved text now would fire the
        // rebuild effect while no prebuilt is held yet, forcing a full
        // from-scratch BPE re-encode of the whole list (tens of seconds, and
        // UI-freezing on the worker-less fallback path) that the prebuilt exists
        // to avoid; worse, applyBoostSource's later setBoostPhrases(sameText)
        // would be a no-op, so the prebuilt would never get a chance to apply.
        setBoostPhrases(restoredSource === BOOST_SOURCE_CUSTOM && typeof savedBoostPhrases === 'string'
          ? savedBoostPhrases : '');
        setBoostStrength(Number.isFinite(savedBoostStrength) ? savedBoostStrength : BOOST_STRENGTH_DEFAULT);
        // The override is `null` (a blank field) = off, so each phrase keeps its
        // own gate; or a number in [0, 1] = the global gate (0 = boost all, 1 =
        // disabled). Any other stored value (undefined/NaN) falls back to the
        // default; an explicit null is preserved as off.
        setBoostMinp(
          savedBoostMinp === null ? null
            : (Number.isFinite(savedBoostMinp) && savedBoostMinp >= 0 && savedBoostMinp <= 1
              ? savedBoostMinp : BOOST_MINP_DEFAULT)
        );
        setBoostDepthScaling(Number.isFinite(savedBoostDepthScaling) && savedBoostDepthScaling >= 0 ? savedBoostDepthScaling : DEFAULT_DEPTH_SCALING);
        {
          const customText = typeof savedBoostCustomText === 'string' ? savedBoostCustomText : '';
          // Migration: pre-feature profiles have no boostCustomText but may
          // hold a boostPhrases the user typed. Seed custom text from it so
          // selecting "Custom" later restores their words rather than blank.
          // Gated on the saved source actually being Custom: `boostPhrases` used
          // to be persisted for curated sources too, so an ungated seed pasted
          // the whole curated lexicon (75k lines for french_medical) into the
          // user's editable Custom slot, which then froze the sidebar for
          // seconds every time they selected Custom or reopened the section.
          const seedCustom = customText
            || (restoredSource === BOOST_SOURCE_CUSTOM && typeof savedBoostPhrases === 'string'
              ? savedBoostPhrases : '');
          setBoostCustomText(seedCustom);
          boostCustomTextRef.current = seedCustom;
          setBoostSource(restoredSource);
        }
        // Restore which settings groups are expanded (a plain id->bool map).
        if (savedSectionsOpen && typeof savedSectionsOpen === 'object') {
          setSectionsOpen(savedSectionsOpen);
        }
        setBenchmarkAutoSend(savedBenchmarkAutoSend === true);
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
        // Split the opt-in diarization payload back out of each record into its
        // own state maps: the transcripts array stays the slim text shape the
        // rest of the UI expects, while restored turns/names drive the diarized
        // view. Entries that had turns reopen in the Speakers view.
        const restoredTurns = {};
        const restoredNames = {};
        const restoredModes = {};
        const cleaned = [];
        for (const tr of savedTranscriptions) {
          if (!tr.text || tr.text.trim() === '') continue;
          const { diarTurns, speakerNames: names, ...rest } = tr;
          if (Array.isArray(diarTurns) && diarTurns.length > 0) {
            restoredTurns[rest.id] = diarTurns;
            restoredModes[rest.id] = 'diarized';
          }
          if (names && typeof names === 'object' && Object.keys(names).length > 0) {
            restoredNames[rest.id] = names;
          }
          cleaned.push(rest);
        }
        setTranscriptions(cleaned);
        if (Object.keys(restoredTurns).length > 0) setPersistedTurns(restoredTurns);
        if (Object.keys(restoredNames).length > 0) setSpeakerNames(prev => ({ ...prev, ...restoredNames }));
        if (Object.keys(restoredModes).length > 0) setEntryDisplayModes(prev => ({ ...prev, ...restoredModes }));
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
    checkLocalModelFiles('/models', repoId, { allowFlatFallback: ALLOW_FLAT_LOCAL_FALLBACK }).then((result) => {
      if (result.ok) {
        console.log('[App] Local fallback check passed:', result.message);
      } else {
        // With several repos on offer a flat mount is refused on purpose (see
        // ALLOW_FLAT_LOCAL_FALLBACK), so the single-repo advice below would send
        // the operator to build the one layout that cannot work. Name the
        // per-repo path instead: it is both the fix and the reason.
        const msg = ALLOW_FLAT_LOCAL_FALLBACK
          ? `Local model fallback is enabled but model files are not reachable at /models/. `
            + `Bind-mount a folder containing the ONNX files (e.g. produced by\n`
            + `  hf download ${repoId} --local-dir /some/host/path)\n`
            + `into the container and set LOCAL_MODEL_PATH to that in-container path. `
            + `See docker-compose.yml.`
          : `Local model fallback is enabled but model files are not reachable at /models/${repoId}/. `
            + `This instance offers a choice of models, so each one must live in its own `
            + `subfolder: a flat mount carries no repo id and would be served under the `
            + `wrong model's name. Bind-mount the PARENT folder (e.g. produced by\n`
            + `  hf download ${repoId} --local-dir /some/host/path/${repoId})\n`
            + `and set LOCAL_MODEL_PATH to /some/host/path. See docker-compose.yml.`;
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
      // Never shadow a browser/OS chord: Ctrl+R (reload), Ctrl+S (save),
      // Ctrl+F (find), Cmd+R on macOS. The bindings are single keys, so any
      // Ctrl/Cmd/Alt modifier means the press was not aimed at us. (Shift is
      // allowed: a capital letter is still just that letter.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Don't trigger shortcuts while a form control has focus: text entry
      // (INPUT/TEXTAREA/contenteditable) but also SELECT, whose own type-ahead
      // and Space/Enter open-list behaviour we would otherwise swallow.
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
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
          // Before a load has started: Space/Enter kick off model loading.
          if ((status === 'idle' || status === 'failed' || status === 'transcriptionFailed') && (key === ' ' || key === 'enter')) {
            e.preventDefault();
            loadModel();
            break;
          }
          // Once loading has begun (or the model is ready): R/Space start
          // recording. Audio captured mid-load is queued and transcribed once
          // the model is ready (Q2). Mirroring the buttons, this also works
          // while a transcription is running (isTranscribing: the status is a
          // free-form "Transcribing ..." string then); the capture queues.
          e.preventDefault();
          if ((status === 'modelReady' || isModelLoading(status) || isTranscribing)
              && !isRecording && !isRemoteMic) {
            startRecordingCountdown();
          }
          break;

        case 'f':
          // Send a file (also allowed mid-load or mid-transcription: it is
          // decoded and queued, same gate as the upload button).
          e.preventDefault();
          if (fileInputRef.current
              && (status === 'modelReady' || isModelLoading(status) || isTranscribing)
              && !isRecording) {
            fileInputRef.current.click();
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [keyboardShortcutsEnabled, status, isRecording, isPaused, isTranscribing, recordingCountdown, isRemoteMic]);

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

  // Keepalive while recording, transcribing, or benchmarking: prevents
  // background-tab JS throttling (silent audio trick) and keeps the screen on
  // (wake lock, which on every desktop OS also blocks the idle suspend that
  // follows a dark screen; a lid close or a manual sleep still wins). The
  // benchmark is held for its WHOLE run, not just its transcriptions: the
  // model loads between rows are the long part (a 2.3 GB fp32 download
  // easily), and used to run with nothing held, so a machine left alone to
  // benchmark could sleep halfway and hand back a run that never finished.
  // Keyed on the ONE combined boolean, not the four inputs: with the inputs
  // as deps every transition between them (transcribing ends while the
  // benchmark is still running, recording turns into transcribing) re-ran the
  // effect, releasing the wake lock and re-requesting it a millisecond later.
  const keepAwake = isRecording || isTranscribing || isRemoteMic || benchmarkRunning;
  useEffect(() => {
    if (!keepAwake) return;
    acquireKeepalive();
    return () => releaseKeepalive();
  }, [keepAwake]);

  // Probe WebGPU availability once on mount. `navigator.gpu` existing isn't
  // enough (the adapter request can still fail on blocklisted GPUs or headless
  // Chromium), so we actually request an adapter.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let available = false;
      let reason = null;
      let shaderF16 = false;
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
          else {
            // ORT's fp16 kernels need this feature to compile their WGSL;
            // without it an fp16 session builds and then transcribes nothing.
            shaderF16 = adapter.features?.has?.('shader-f16') === true;
            // Coarse identity of the GPU, used only to invalidate a stored
            // performance-probe verdict when the machine's GPU changes (docked
            // eGPU, switched integrated/discrete). Adapter info is deliberately
            // vague in browsers, which is fine: this never leaves the device.
            const info = adapter.info || {};
            webgpuAdapterSigRef.current =
              `${info.vendor || ''}/${info.architecture || ''}/${info.device || ''}`.trim() || 'unknown-adapter';
          }
        }
      } catch {
        available = false;
        reason = 'noAdapter';
      }
      if (!cancelled) {
        setWebgpuAvailable(available);
        setWebgpuUnavailableReason(available ? null : reason);
        setWebgpuShaderF16(available ? shaderF16 : null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist backend selection
  useEffect(() => {
    if (!settingsLoaded) return;
    saveSetting('backend', backend);
  }, [backend, settingsLoaded]);

  // Whether a human ever picked the backend by hand, and the probe's stored
  // verdict. Both gate whether the probe may run and act on its own.
  usePersistedSetting('backendUserPicked', backendUserPicked, settingsLoaded);
  usePersistedSetting('perfProbeVerdict', probeVerdict, settingsLoaded);
  usePersistedSetting('gpuWeightsUnservableSig', gpuWeightsUnservableSig, settingsLoaded);
  // Persist the WASM encoder-precision choice (int8 / fp32).
  // Not usePersistedSetting: a repo that came from ?model= must NOT be written
  // back, or following a link once would silently redefine the visitor's
  // default for every later visit.
  useEffect(() => {
    if (!settingsLoaded || modelRepoFromUrlRef.current) return;
    saveSetting('modelRepo', repoId);
  }, [repoId, settingsLoaded]);
  usePersistedSetting('wasmEncoderQuant', wasmEncoderQuant, settingsLoaded);
  // Persist the WebGPU encoder-precision choice.
  usePersistedSetting('webgpuEncoderQuant', webgpuEncoderQuant, settingsLoaded);

  // Save settings to IndexedDB whenever they change (only after initial load).
  // usePersistedSetting (defined at module scope below) is a thin wrapper
  // around useEffect that fires once per setting, only after `loaded`
  // flips to true. Keeping the hook-call list flat (one per setting)
  // preserves the previous behavior: changing setting X writes only X,
  // not all eighteen of them.
  usePersistedSetting('preprocessor', preprocessor, settingsLoaded);
  usePersistedSetting('verboseLog', verboseLog, settingsLoaded);
  usePersistedSetting('debugDecode', debugDecode, settingsLoaded);
  usePersistedSetting('frameStride', frameStride, settingsLoaded);
  usePersistedSetting('beamWidth', beamWidth, settingsLoaded);
  usePersistedSetting('beamWidthAuto', beamWidthAuto, settingsLoaded);

  // Auto-coupled beam width (lib/beamWidth.js): until the user chooses a width
  // themselves, follow the boost state. The sweep behind this showed the beam
  // effect FLIPS SIGN with the lexical prior: without a phrase list, widening
  // the beam degrades accuracy on term-dense audio (more room to prefer a
  // fluent-but-wrong reading) while costing decode time; with one it is where
  // the boosting gains come from. boostPhraseCount is the parse-time count (it
  // updates even before a model loads), boostStrength 0 disables boosting.
  useEffect(() => {
    if (!settingsLoaded || !beamWidthAuto) return;
    setBeamWidth(resolveAutoBeamWidth(boostPhraseCount > 0 && boostStrength !== 0, DEFAULT_BEAM_WIDTH));
  }, [settingsLoaded, beamWidthAuto, boostPhraseCount, boostStrength]);
  usePersistedSetting('maesNumSteps', maesNumSteps, settingsLoaded);
  usePersistedSetting('maesExpansionBeta', maesExpansionBeta, settingsLoaded);
  usePersistedSetting('maesExpansionGamma', maesExpansionGamma, settingsLoaded);
  usePersistedSetting('maesPrefixAlpha', maesPrefixAlpha, settingsLoaded);
  usePersistedSetting('cpuThreads', cpuThreads, settingsLoaded);
  usePersistedSetting('parallelEncode', parallelEncode, settingsLoaded);
  usePersistedSetting('benchmarkAutoSend', benchmarkAutoSend, settingsLoaded);
  usePersistedSetting('noiseSuppression', noiseSuppression, settingsLoaded);
  usePersistedSetting('autoGainControl', autoGainControl, settingsLoaded);
  usePersistedSetting('remoteMicGain', remoteMicGain, settingsLoaded);

  usePersistedSetting('autoCopyToClipboard', autoCopyToClipboard, settingsLoaded);
  usePersistedSetting('numbersToDigits', numbersToDigits, settingsLoaded);
  usePersistedSetting('persistTranscripts', persistTranscripts, settingsLoaded);
  usePersistedSetting('keyboardShortcutsEnabled', keyboardShortcutsEnabled, settingsLoaded);
  usePersistedSetting('enableChunking', enableChunking, settingsLoaded);
  // chunkDuration is a single backend-independent default (DEFAULT_CHUNK_DURATION_SEC),
  // persisted like any other setting once the user changes it.
  usePersistedSetting('chunkDuration', chunkDuration, settingsLoaded);
  usePersistedSetting('transcriptDisplayMode', transcriptDisplayMode, settingsLoaded);
  usePersistedSetting('diarizationNumSpeakers', diarizationNumSpeakers, settingsLoaded);
  usePersistedSetting('liveTranscriptionEnabled', liveTranscriptionEnabled, settingsLoaded);
  usePersistedSetting('liveContextWindow', liveContextWindow, settingsLoaded);
  // Only the user's OWN text is persisted under `boostPhrases`; a curated list's
  // text is not. It would be dead weight (the list is re-fetched from
  // /boost-phrases/ on every load, and the restore deliberately ignores the
  // saved text for a curated source, see the settings restore above), it wrote
  // ~2 MB to IndexedDB on every selection of a large clinical lexicon, and the
  // Custom-slot migration below used to seed the user's Custom text from it,
  // silently pasting a 75k-line list into their editable box.
  usePersistedSetting(
    'boostPhrases',
    boostSource === BOOST_SOURCE_CUSTOM ? boostPhrases : '',
    settingsLoaded,
  );
  usePersistedSetting('boostStrength', boostStrength, settingsLoaded);
  usePersistedSetting('boostMinp', boostMinp, settingsLoaded);
  usePersistedSetting('boostDepthScaling', boostDepthScaling, settingsLoaded);
  usePersistedSetting('boostSource', boostSource, settingsLoaded);
  usePersistedSetting('boostCustomText', boostCustomText, settingsLoaded);
  usePersistedSetting('settingsSectionsOpen', sectionsOpen, settingsLoaded);
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
    // Attach each entry's diarized turns + speaker names (when any) so they
    // persist alongside the text. Diarizing or renaming a speaker mutates
    // diarizationCache/speakerNames/persistedTurns (in the deps below), so this
    // effect re-fires and re-saves without the transcriptions array changing.
    const records = transcriptions.map(enrichTranscriptForPersist);
    if (transcriptions.length < prev) {
      wipeAndRewriteTranscripts(records);
    } else {
      saveTranscripts(records);
    }
  }, [transcriptions, settingsLoaded, persistTranscripts, diarizationCache, speakerNames, persistedTurns]);
  useEffect(() => { liveTranscriptionEnabledRef.current = liveTranscriptionEnabled; }, [liveTranscriptionEnabled]);
  useEffect(() => { liveContextWindowRef.current = liveContextWindow; }, [liveContextWindow]);

  // ---- Medical dictation mode ("Mode Dictee Medical") -----------------------
  // One preset, two entry points that MUST configure the same station: the
  // `?mode=` link (applied here, on page load) and the sidebar button (applied
  // on click). Both go through applyMedModeSettings over the single table in
  // lib/medMode.js. This is the ONLY writer of the initial boost source when a
  // `?mode=` link opened the page: usePhraseBoost is passed `skipInit:
  // URL_MED_MODE` so its own one-shot resolution stands down, rather than the
  // two racing to be the last fetch to land.
  const medModeSettingsAppliedRef = useRef(false);
  const medModeProbeDoneRef = useRef(false);

  /**
   * Apply the French medical dictation preset. Every value goes through the
   * ordinary setter, so it persists exactly like a hand pick: this is a setup
   * instruction, not a one-visit override (see URL_MED_MODE at module scope).
   *
   * @param {object} [opts]
   * @param {boolean} [opts.fromUser] True when it came from the sidebar button.
   *   Arms a model reload, because the preset changes model-defining settings
   *   and a model already in memory is now the wrong one. On the page-load path
   *   there is nothing loaded yet, so arming would be noise.
   */
  async function applyMedModeSettings({ fromUser = false } = {}) {
    console.log('[MedMode] applying the French medical dictation preset.');
    // French UI first, so the rest of the screen is already in the right
    // language while the (large) phrase list is still being fetched below.
    setLang(MED_MODE_PRESET.lang);

    // Model. An explicit ?model= is the more specific request of the two, so it
    // wins; and when this instance offers no UltiMed repo, MED_MODE_REPO is null
    // (warned about at module scope) and the current model is left alone.
    if (MED_MODE_REPO && !URL_MODEL_REPO) {
      if (fromUser) armModelReloadIfLoaded();
      // Clear the ?model= no-persist guard: the preset IS a persisted choice, so
      // without this the repo would have to be re-picked on every single visit.
      modelRepoFromUrlRef.current = false;
      setRepoId(MED_MODE_REPO);
    }

    // Encoder precision is set for BOTH backends, not just the current one,
    // because the autoconfigure probe below can still move the visitor between
    // them after this has run.
    if (fromUser) armModelReloadIfLoaded();
    setWasmEncoderQuant(MED_MODE_PRESET.wasmEncoderQuant);
    setWebgpuEncoderQuant(MED_MODE_PRESET.webgpuEncoderQuant);

    setEnableChunking(MED_MODE_PRESET.enableChunking);
    setChunkDuration(MED_MODE_PRESET.chunkDurationSec);
    setTranscriptDisplayMode(MED_MODE_PRESET.transcriptDisplayMode);
    // The one default this preset flips ON rather than restores (see the field
    // note in lib/medMode.js): dictate-then-paste is the whole workflow here.
    setAutoCopyToClipboard(MED_MODE_PRESET.autoCopyToClipboard);

    // Phrase boosting: the curated French medical list at its DEFAULT tuning.
    // The three globals are re-asserted rather than left at whatever the visitor
    // happened to have, so the preset lands on the same station every time. They
    // are only multipliers: the list carries its own per-phrase weights via its
    // `*:WEIGHT:MINP:AUG` header line, which is what actually tunes it.
    setBoostStrength(BOOST_STRENGTH_DEFAULT);
    setBoostMinp(BOOST_MINP_DEFAULT);
    setBoostDepthScaling(DEFAULT_DEPTH_SCALING);
    if (boostFiles.includes(MED_MODE_PRESET.boostSource)) {
      await applyBoostSource(MED_MODE_PRESET.boostSource);
    } else {
      console.warn(`[MedMode] "${MED_MODE_PRESET.boostSource}" is not served at /boost-phrases/ `
        + `(manifest: ${boostFiles.join(', ') || 'empty'}); leaving phrase boosting untouched. `
        + `Point BOOST_PHRASES_SOURCE at a folder containing it to enable the medical lexicon.`);
    }
  }

  /**
   * Decide WASM vs WebGPU by measuring this machine, and apply the answer.
   *
   * Medical mode runs this on PAGE LOAD rather than at the Load-model click the
   * ordinary path uses: a dictation station should already know which backend it
   * is on before the clinician touches anything, and the verdict is what decides
   * which encoder weights the Load button will then fetch.
   *
   * Two cases, and the SECOND one is the one that bites. Measuring is gated by
   * the ordinary `shouldAutoProbe` rules (never over a hand-picked backend,
   * never a machine already measured, nothing at all without an adapter). But
   * "already measured" must not mean "do nothing": a stored verdict is an answer
   * we own and have to APPLY, because the live backend can have drifted away
   * from it since. It really does drift, by exactly one route: a GPU load that
   * cannot be served falls back to WASM and PERSISTS that flip, so the next
   * visit boots on WASM while the stored verdict still says WebGPU, and nothing
   * puts the two back in agreement. That is the "medical mode shows WASM but
   * Autoconfigure picks WebGPU" report.
   *
   * Re-applying that verdict must not turn into a per-visit ping-pong against
   * the very fallback that caused the drift, so `gpuWeightsUnservableSig`
   * records the repo+precision combination that was proven unservable and this
   * skips a GPU verdict while it still matches. The signature invalidates
   * itself when either half changes, so hosting the missing files (or picking
   * another precision) puts the GPU back in play with no reset needed.
   */
  async function autoconfigureBackendForMedMode() {
    const storedVerdictValid = verdictStillValid(probeVerdict, {
      appVersion: VERSION, adapter: webgpuAdapterSigRef.current, at: Date.now(),
      sourceSig: sourceQuantSignature(sourceQuants),
    });
    if (shouldAutoProbe({
      settingsLoaded,
      // Deliberately NOT `backendUserPicked`, and this is the whole reason the
      // measurement failed to run from a ?mode=med link while the button did it
      // every time. shouldAutoProbe refuses whenever the visitor has ever
      // touched the backend radios, which is exactly right for the ordinary
      // page load it was written for: an unasked-for measurement must not
      // overrule a deliberate choice. But `?mode=med` is not an ordinary page
      // load. It is an explicit instruction to set this machine up as a
      // dictation station, and it already overwrites the model, the chunk
      // window, the display mode, the language and both precisions, every one
      // of which the visitor may equally have set by hand. Honouring their
      // backend pick while overwriting all of that is not caution, it is an
      // inconsistency, and on any machine where the radios had once been
      // touched (which is every machine anyone has ever debugged on) the mode's
      // headline promise (decide CPU-vs-GPU for me) silently did nothing.
      // The measurement still cannot pick a backend that does not work: it
      // measures rather than assumes, and the unservable-weights guard below
      // keeps it from re-selecting a GPU this source cannot feed.
      userPickedBackend: false,
      // Same fp16 condition as the ordinary gate below: a station whose adapter
      // or mirror cannot do fp16 has nothing to measure, because the answer
      // could only be acted on in one direction.
      webgpuSelectable: !WEBGPU_DISABLED && webgpuAvailable === true
        && gpuBackendAutoUsable({ servable: sourceQuants, shaderF16: webgpuShaderF16 === true }),
      hasValidVerdict: storedVerdictValid,
      running: probeRunningRef.current,
    })) {
      const verdict = await runPerfProbe({ trigger: 'medmode' });
      if (verdict) await applyProbeVerdict(verdict);
      return;
    }
    // Not measuring, because this machine has already been measured. Honour the
    // answer on disk (same reasoning as above: the link outranks an earlier
    // hand-pick, and re-measuring on every page load of a station that reloads
    // all day would be the wrong way to reconcile them).
    if (!storedVerdictValid) return;
    const want = coerceBackend(probeVerdict.backend);
    if (want === liveSettingsRef.current.backend) return;
    if (want.startsWith('webgpu') && gpuWeightsUnservableSig === `${repoId}|${webgpuEncoderQuant}`) {
      console.log(`[MedMode] stored verdict says ${want}, but this source could not serve `
        + `${webgpuEncoderQuant} weights for the GPU; staying on ${liveSettingsRef.current.backend}.`);
      return;
    }
    console.log(`[MedMode] applying the stored ${want} verdict (backend had drifted to `
      + `${liveSettingsRef.current.backend}).`);
    await applyProbeVerdict(probeVerdict);
  }

  // ?mode= entry point, part 1: the settings. Waits for the boost manifest as
  // well as the settings restore, because the preset's phrase list can only be
  // validated against a manifest that has actually loaded.
  useEffect(() => {
    if (!URL_MED_MODE || medModeSettingsAppliedRef.current) return;
    if (!settingsLoaded || !boostFilesLoaded) return;
    medModeSettingsAppliedRef.current = true;
    applyMedModeSettings();
  }, [settingsLoaded, boostFilesLoaded]);

  // ?mode= entry point, part 2: the backend. Split from part 1 so a WebGPU
  // adapter probe that never settles cannot hold up the settings preset; it
  // waits on webgpuAvailable resolving to true/false instead of the manifest.
  useEffect(() => {
    if (!URL_MED_MODE || medModeProbeDoneRef.current) return;
    if (!settingsLoaded || webgpuAvailable === null) return;
    medModeProbeDoneRef.current = true;
    autoconfigureBackendForMedMode();
  }, [settingsLoaded, webgpuAvailable]);
  // Slow-browser heads-up: the WASM engine is ~9x slower outside the
  // Chromium family (SpiderMonkey SIMD codegen, measured 2026-08-10, see
  // lib/browserFamily.js). Dismissal is DELIBERATELY not persisted: the
  // slowness is real on every visit, so the popup returns on every reload.
  const slowBrowser = useMemo(() => !isChromiumFamily(typeof navigator !== 'undefined' ? navigator : null), []);
  const [slowBrowserDismissed, setSlowBrowserDismissed] = useState(false);
  // Same treatment for phones and tablets (lib/deviceClass.js): a
  // hundreds-of-megabytes download decoded on the device's own CPU is a desktop
  // workload, and a backgrounded mobile tab is suspended mid-transcription.
  // Also not persisted, for the same reason: the mismatch is real every visit.
  const handheldDevice = useMemo(() => isHandheldDevice(typeof navigator !== 'undefined' ? navigator : null), []);
  const [handheldDismissed, setHandheldDismissed] = useState(false);
  // Second warning, gated on the same detection: on a handheld, "Phone Mic"
  // offers to pair a phone with the machine running the model, which is the
  // device the visitor is holding. Acknowledged once per load, then it starts
  // the pairing normally.
  const [remoteMicHandheldWarn, setRemoteMicHandheldWarn] = useState(false);
  const remoteMicHandheldAckRef = useRef(false);
  /**
   * Load model weights and create an ONNX inference session.
   * @param {Object} [opts]
   * @param {boolean} [opts.useLocalFallback=false] When true, download weights
   *   from this instance (/models/) instead of HuggingFace.
   */
  async function loadModel({ useLocalFallback = forceLocalFallback || localFirstRef.current, corruptionRetried = false,
                             gpuQuantFallbackTried = false, hubRetryTried = false,
                             // Whether a precision this source cannot serve may be answered
                             // with WASM int8. The app wants that; the BENCHMARK must not have
                             // it, because a row labelled fp16 carrying int8's numbers is
                             // worse than a row that says the combination is not served here.
                             allowQuantSubstitution = true } = {}) {
    // Clean up existing model first
    if (modelRef.current) {
      console.log('[App] Disposing existing model before loading new one...');
      modelRef.current.dispose();
      modelRef.current = null;
      // The previous load's outcome no longer describes anything running, and a
      // stale one is worse than none: it would keep claiming a precision while a
      // different one is being fetched.
      setLoadedModelInfo(null);
      // Drop the old vocab signature so the boost effect clears its trie now
      // (no tokenizer) and rebuilds once the new model publishes its signature.
      setTokenizerVocabSig(null);
    }

    setStatus('loadingModel');
    // Phase clock. A load is a cache lookup, then whatever has to come over the
    // network, then the ORT session build, and only their SUM was ever recorded
    // (as the benchmark's loadMs). That made "the load took 48 minutes"
    // unanswerable without a rerun: a connection and a GPU shader compile are
    // not the same problem. fetchStartedRef stays null on a fully cached load.
    const loadT0 = performance.now();
    fetchStartedRef.current = null;
    let sessionT0 = null;
    // Remember the thread count this (re)load is built with, so the CPU-threads
    // field's onBlur only triggers another reload when the value truly changed.
    loadedCpuThreadsRef.current = cpuThreads;
    // Re-arm the one-shot diarization-model prefetch for this (re)load, so a
    // freshly loaded model warms the diarization weights once.
    diarPrefetchDoneRef.current = false;
    setProgress('');
    setProgressText('');
    setProgressPct(0);
    downloadRateRef.current = null;
    // Not reset on the corrupt-cache retry: that re-enters loadModel and its
    // re-downloaded bytes belong to the same load the caller is timing.
    if (!corruptionRetried) loadTransferRef.current = new Map();
    setModelLoadError(null);
    setFatalModelError(null);
    // Clear the GPU-fallback notice only on a FRESH attempt. Both retry paths
    // re-enter loadModel, and the GPU fallback sets this banner immediately
    // before its own retry, so clearing unconditionally here would wipe the
    // very notice that retry exists to explain.
    if (!gpuQuantFallbackTried && !corruptionRetried) setGpuFallbackWarning(null);
    // The corrupt-cache retry re-enters loadModel; keep the original timer
    // running across it instead of restarting (which logs a duplicate-timer
    // warning) so console.timeEnd still reports the full load duration.
    if (!corruptionRetried) console.time('LoadModel');

    try {
      const progressCallback = ({ loaded, total, file, resumed, resumedFrom, attempt, maxAttempts }) => {
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
        // Byte events only ever fire for a file being streamed, so this map
        // counts network bytes and nothing else. `loaded` is how much of the
        // FILE is in hand, which on a resumed download starts at whatever was
        // already cached, so the resumed part has to come back off: the point
        // of the number is what the connection was asked for. It is the
        // progress BAR that wants the total, and that reads `loaded` directly.
        const transferred = Math.max(0, (loaded || 0) - (resumedFrom || 0));
        loadTransferRef.current.set(file, Math.max(loadTransferRef.current.get(file) || 0, transferred));
        // ...which is also what makes this the honest moment to say
        // "downloading". The phase cannot be announced up front, because a load
        // answered entirely from IndexedDB never streams anything and would
        // then claim a download it never made. A byte event is proof.
        if (fetchStartedRef.current === null) fetchStartedRef.current = performance.now();
        setStatus('downloadingModel');
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        const prefix = resumed ? `${t('resuming')} ` : '';
        const sizes = total > 0 ? ` ${formatBytes(loaded)} / ${formatBytes(total)}` : '';
        // Transfer rate averaged over the trailing 10 s window + MM:SS ETA,
        // recomputed as bytes flow.
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
      //   - WASM: int8 encoder (~800 MB), the only one that fits the 32-bit WASM
      //     heap / Chromium's ~2 GB blob limit.
      //   - WebGPU: the fp32 encoder (~2.4 GB, sharded), the only precision the
      //     GPU EP has an encoder kernel for.
      const wantWebgpu = backend.startsWith('webgpu');
      // On WASM the user may opt into the sharded fp32 encoder (full quality);
      // hub.js only honours it when the repo ships the shards
      // (allowWasmFp32 gate), else it falls back to the int8 pin. The decoder
      // stays int8 on WASM regardless (tiny, runs fine).
      const wasmWantsFp32 = !wantWebgpu && wasmEncoderQuant === 'fp32';
      // On WebGPU the encoder is fp32 unless the user opted into w4a8, the only
      // quantised encoder with a GPU kernel (MatMulNBits; int8 has none).
      // The fused decoder_joint always runs int8 on both backends: on this model
      // the int8 joiner is as accurate as fp32 (measured) while being smaller and
      // faster, and the GPU EP runs the int8 decoder fine.
      // Resolve the WASM encoder request: fp32 (shards), the lite int8 build,
      // the 4-bit w4a8 build, or the default int8. 'int8lite' and 'w4a8' are
      // passed straight through rather than collapsed to 'int8' so hub.js can
      // tell "the user picked that build and this repo has none"
      // (-> quantUnavailable banner) apart from "the user picked the default",
      // which is the whole point of the no-silent-downgrade rule. Anything
      // unrecognised still lands on the default int8.
      const wasmEncoderRequest = wasmWantsFp32
        ? 'fp32'
        : (wasmEncoderQuant === 'int8lite' || wasmEncoderQuant === 'w4a8' ? wasmEncoderQuant : 'int8');
      // The GPU precision to ASK FOR: exactly what is selected, with no local
      // rewriting. This used to degrade fp16 to fp32 whenever the adapter had no
      // `shader-f16`, which is a 2.35 GB download nobody requested; since
      // 2026-09-11 the only substitution the app makes on its own is WASM int8,
      // so an fp16 request that this machine or this source cannot honour is
      // sent as fp16, refused by hub.js with QuantUnavailableError (it re-checks
      // the adapter feature itself, see `shaderF16` below) and caught into the
      // GPU-to-WASM fallback. A hand-picked fp32 or w4a8 passes through
      // untouched, which is the only way either one is ever loaded.
      const downloadOpts = {
        encoderQuant: wantWebgpu ? webgpuEncoderQuant : wasmEncoderRequest,
        decoderQuant: 'int8',
        allowWasmFp32: wasmWantsFp32,
        // hub.js re-checks fp16 against this rather than trusting the caller:
        // it is the one quant that can load and then silently produce nothing.
        shaderF16: webgpuShaderF16 === true,
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
        // or WebGPU, and only /models ships the shards). Detecting it
        // pre-download avoids fetching the wrong (downgraded) weights only to
        // throw them away.
        downloadOpts.localUpgradeBaseUrl = '/models';
      }
      // Shield any cached diarization models from the generational orphan sweep
      // (they live in a different repo, so the sweep would otherwise delete them
      // on every model load and force a re-download).
      // Never let an unattributed flat /models tree stand in for a repo the
      // mount has no subfolder for (see ALLOW_FLAT_LOCAL_FALLBACK). Applies to
      // both local paths above: the explicit fallback and the pre-download
      // quant upgrade.
      downloadOpts.allowFlatLocalFallback = ALLOW_FLAT_LOCAL_FALLBACK;
      downloadOpts.protectCacheKeys = diarizationModelProtectKeys();
      const modelUrls = await getParakeetModel(repoId, downloadOpts);

      // Show compiling sessions stage
      sessionT0 = performance.now();
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
          ortVariant: ORT_VARIANT,
          preprocessorBackend: modelUrls.preprocessorBackend,
          nMels,
        });
        // Chunk-parallel encode pool (WASM only). Stash the worker init params
        // whenever the loaded model is pool-eligible, so the sidebar toggle can
        // start/stop the pool later without a model reload, and start it now
        // when the toggle is on. fp32 is excluded: each pool worker holds its
        // own copy of the encoder weights, fine at int8 (~850 MB) but not at
        // fp32 (~2.4 GB per copy). Best-effort: a gate or failure just means
        // the serial in-thread encode runs, exactly as before.
        encodePoolInitParamsRef.current = (!wantWebgpu && wasmEncoderRequest !== 'fp32') ? {
          type: 'init',
          encoderUrl: modelUrls.urls.encoderUrl,
          encoderDataUrl: modelUrls.urls.encoderDataUrl,
          filenames: modelUrls.filenames,
          nMels,
          preprocessorBackend: modelUrls.preprocessorBackend,
          preprocessorUrl: modelUrls.urls.preprocessorUrl,
          // Each worker is its own JS context with its own ORT runtime, so the
          // variant has to travel with the init or ?ortep=jsep would leave the
          // pool (which does the encoding) on the default runtime.
          ortVariant: ORT_VARIANT,
        } : null;
        // NOTE (2026-08-11): running the WebGPU encoder session in a dedicated
        // worker was tried as the fix for the rendering coupling (JSEP yields
        // inside session.run queueing behind compositor frames while the
        // spinner animates) and MEASURED WORSE: WebGPU callback delivery is
        // gated by the page's compositor activity process-wide, so a worker
        // encode under an animating main page ran ~3x slower than the animated
        // main thread (723 s vs ~227 s on the 3-min fp32 clip; an ORT-free
        // mapAsync probe confirmed worker awaits stall >2 s/iter while the
        // page animates, vs 2.4 ms idle). The actual fix is pausing the page's
        // CSS animations for the duration of a WebGPU run (the html.gpu-run
        // toggle in runTranscription), which restores probe speed in-thread.
        if (encodePoolInitParamsRef.current && parallelEncode) {
          startEncodePool();
        } else {
          teardownEncodePool(encodePoolInitParamsRef.current
            ? 'parallel encode disabled' : 'encode pool unsupported for this model');
        }
        // Decode worker. On WebGPU it overlaps WASM decode with GPU encode; on
        // WASM it only ever engages COMPOSED with the encode pool (pooled
        // encodes feed worker decodes, this thread just orchestrates and
        // stitches), so it is created only when the model is pool-eligible,
        // the hardware clears the pool gate, and the operator opted in with
        // VITE_WASM_DECODE_PIPELINE='true'. It starts even while the pool toggle
        // is off so toggling parallel encode later composes without a model
        // reload. numThreads differs on purpose: the decode loop's joiner
        // GEMMs are too small to scale with threads, and on WASM the pool
        // already budgets ~all cores, so the worker gets 2 threads instead of
        // the user budget. Best-effort: any failure falls back to in-thread
        // decode.
        const wasmComposedEligible = backend === 'wasm' && wasmDecodePipelineEnabled
          && !!encodePoolInitParamsRef.current
          && encodePoolPlan({
            cpuThreads,
            maxCores,
            deviceMemory: typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined,
          }).workers > 0;
        composedDecodeEligibleRef.current = wasmComposedEligible;
        decodeWorkerInitParamsRef.current = (backend.startsWith('webgpu') || wasmComposedEligible) ? {
          type: 'init',
          decoderUrl: modelUrls.urls.decoderUrl,
          decoderDataUrl: modelUrls.urls.decoderDataUrl,
          tokenizerUrl: modelUrls.urls.tokenizerUrl,
          filenames: modelUrls.filenames,
          numThreads: backend === 'wasm' ? 2 : cpuThreads,
          ortVariant: ORT_VARIANT,
        } : null;
        // The WASM worker follows the parallelEncode toggle (it is useless
        // without the pool, and the user turning the feature off should get
        // the memory back); the WebGPU one is independent and always starts.
        if (decodeWorkerInitParamsRef.current && (!wasmComposedEligible || parallelEncode)) {
          startDecodeWorker({ restart: true });
        } else {
          stopDecodeWorker(decodeWorkerInitParamsRef.current
            ? 'parallel encode disabled' : 'decode pipeline unsupported for this model');
        }
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
        return loadModel({ useLocalFallback, corruptionRetried: true, gpuQuantFallbackTried });
      }

      console.timeEnd('LoadModel');
      // Record what ACTUALLY loaded, as opposed to what was requested.
      // Everything else in the sidebar describes the request: the backend and
      // precision radios keep showing the visitor's pick even when this load
      // resolved to something else, which it legitimately can (the WASM int8
      // pin, the GPU->WASM fallback on an unservable precision, a switch to the
      // local /models mirror). Nothing reported the outcome before, so a
      // divergence was completely silent: a station could sit on a WebGPU
      // selection while an int8 CPU model did the work. This is the value the
      // sidebar renders back, so the two can be compared at a glance.
      setLoadedModelInfo({
        repoId,
        backend: modelUrls.resolvedBackend || backend,
        encoderQuant: modelUrls.quantisation?.encoder || null,
        decoderQuant: modelUrls.quantisation?.decoder || null,
        servedFrom: modelUrls.servedFrom || (useLocalFallback ? 'local' : 'hf'),
      });
      console.log(`[App] Loaded ${repoId} on ${modelUrls.resolvedBackend || backend} `
        + `(encoder ${modelUrls.quantisation?.encoder}, from `
        + `${modelUrls.servedFrom === 'local' ? '/models' : 'HuggingFace'})`);
      // A fallback must move the CONTROLS, not just the console. The backend
      // half already does (the GPU->WASM fallback flips it through applyBackend
      // before retrying, since the retry has to read the new value); the
      // precision was the half left behind, showing a resolved value on screen
      // while the stored setting quietly said something else. Writing the
      // outcome back is what stops the two from drifting apart across reloads.
      const fixes = reconcileSelection(
        { backend: modelUrls.resolvedBackend || backend, encoderQuant: modelUrls.quantisation?.encoder || null },
        { backend, wasmEncoderQuant, webgpuEncoderQuant },
      );
      if (fixes.wasmEncoderQuant) {
        console.log(`[App] Sidebar precision corrected to ${fixes.wasmEncoderQuant} (WASM) to match what loaded`);
        setWasmEncoderQuant(fixes.wasmEncoderQuant);
      }
      if (fixes.webgpuEncoderQuant) {
        console.log(`[App] Sidebar precision corrected to ${fixes.webgpuEncoderQuant} (WebGPU) to match what loaded`);
        setWebgpuEncoderQuant(fixes.webgpuEncoderQuant);
      }
      // Publish the loaded tokenizer's vocab signature so the boost-trie rebuild
      // effect runs now (model became ready) and on a later vocab-changing swap,
      // but NOT on the unrelated status churn of recording/transcribing.
      const tk = modelRef.current?.tokenizer;
      setTokenizerVocabSig(tk?.id2token ? vocabSignature(tk.id2token) : 'ready');
      // Don't clobber a live recording's status: if the user started recording
      // while the model was still loading (Q2), leave the recording UI in place
      // (the captured audio drains through the queue when recording stops).
      // Otherwise mark ready.
      if (!isRecordingRef.current) setStatus('modelReady');
      setProgressText('');
      setProgressPct(null);
      // Account for the load, phase by phase. The sum alone (which is all the
      // benchmark's loadMs ever was) cannot tell a slow connection from a slow
      // session build, and those have nothing to do with each other: the fp32
      // shards are re-downloaded on EVERY load, since each is over hub.js's
      // MAX_CACHEABLE_STREAM_BYTES, so a multi-minute fetch here is expected
      // and a multi-minute `sessions` is not.
      {
        const loadEnd = performance.now();
        let bytes = 0;
        for (const n of loadTransferRef.current.values()) bytes += n;
        console.log(formatLoadTiming({
          totalMs: loadEnd - loadT0,
          // Measured from the first byte, so a cache lookup that found
          // everything reports 0 rather than being charged for the lookup.
          fetchMs: fetchStartedRef.current === null
            ? 0
            : (sessionT0 ?? loadEnd) - fetchStartedRef.current,
          sessionMs: sessionT0 === null ? 0 : loadEnd - sessionT0,
          bytes,
        }));
      }
      // Transcribe anything captured while the model was loading.
      captureQueue.drain();
    } catch (e) {
      console.error(e);
      // Recover from an HF download failure (HF blocked/unreachable, or the repo
      // simply doesn't host the requested model/files) by retrying against the
      // locally-served /models weights instead of crashing. When the operator
      // configured local fallback (VITE_MODEL_SOURCE=local|both) we retry
      // unconditionally; otherwise (default 'hf') we probe /models first and only
      // retry when the files are actually there, so we never swap a clear HF
      // error for a confusing "local folder missing" failure.
      // The MIRROR of the retry below, and what makes the reachability
      // preflight safe to act on without first verifying the mirror: this load
      // went local-first only because HuggingFace looked unreachable, and the
      // mirror turned out not to serve it. A false negative (an extension or a
      // proxy blocking the probe on a machine where HuggingFace works) must
      // therefore cost one fast same-origin miss, not a failed load.
      if (e instanceof HubDownloadError && useLocalFallback && !forceLocalFallback
          && localFirstRef.current && !hubRetryTried) {
        console.log('[App] /models could not serve this model and HuggingFace only LOOKED '
          + 'unreachable; trying HuggingFace after all');
        return loadModel({ useLocalFallback: false, hubRetryTried: true });
      }
      if (e instanceof HubDownloadError && !useLocalFallback) {
        // Only probe /models when the operator hasn't already enabled local
        // fallback (then we'd retry regardless); avoids a needless HEAD request.
        let localReachable = false;
        if (!localFallbackEnabled) {
          const probe = await checkLocalModelFiles('/models', repoId, { allowFlatFallback: ALLOW_FLAT_LOCAL_FALLBACK }).catch(() => null);
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
        // On a GPU backend it means this machine cannot RUN the precision the
        // visitor is on (fp16 with no `shader-f16`) or this source does not HOST
        // it. Either way the answer is WASM int8, never another GPU precision:
        // substituting fp32 would hand someone who asked for 1.2 GB a 2.35 GB
        // download, and substituting w4a8 would quietly swap in the weakest
        // encoder on long audio. Both are reachable by hand and only by hand.
        //
        // Retrying on WASM rather than stranding them on Failed matters because
        // they may never have chosen WebGPU: the performance probe can select it
        // for them, and a deployment pointed at a repo without GPU weights would
        // otherwise break for every visitor whose machine wins that probe.
        //
        // Deliberately NOT a general "GPU failed, use the CPU" net: this fires
        // only for a quant that cannot be SERVED, which is a property of the
        // deployment and is known before a single weight byte is fetched. A
        // GPU that fails later (OOM, device lost) is a different problem and
        // must stay visible rather than be silently absorbed here.
        if (backend.startsWith('webgpu') && allowQuantSubstitution && !gpuQuantFallbackTried) {
          // Nothing this GPU can run is hosted here, so the backend really is
          // what has to change. Only now.
          console.warn(`[App] ${webgpuEncoderQuant} cannot be run here or is not hosted; falling back to WASM int8`);
          setGpuFallbackWarning(t('gpuQuantFallback'));
          // Remember WHICH repo+precision could not be served, so the flip to
          // WASM below is not undone on the next visit by a stored WebGPU
          // verdict (medical mode re-applies those). Recorded before the flip,
          // because `backend` becomes 'wasm' a line from here.
          gpuUnservableSetThisSessionRef.current.add(`${repoId}|${webgpuEncoderQuant}`);
          setGpuWeightsUnservableSig(`${repoId}|${webgpuEncoderQuant}`);
          await applyBackend('wasm');
          return loadModelRef.current({ useLocalFallback, gpuQuantFallbackTried: true });
        }
        // Any other precision reaching here was picked by hand and CAN be
        // changed, so it gets the banner naming it. The default-int8 case falls
        // through to the popup below instead.
        if (backend.startsWith('webgpu') || wasmEncoderQuant !== DEFAULT_WASM_ENCODER_QUANT) {
          setModelLoadError(t('quantUnavailable'));
        }
      }
      // Nowhere left to go, on the one configuration the app picks for itself.
      // Every retry above has either not applied or been spent, and the visitor
      // is on WASM asking for the default int8: the backend every fallback ends
      // on, at the precision nothing is allowed to substitute for. So there is
      // no other precision, backend or source left to try and nothing in the
      // settings to revisit, which is what separates this from every other load
      // failure. It gets the blocking popup, like the handheld notice, rather
      // than a `Failed` status under a page that still looks usable. Any
      // hand-picked precision keeps the old quiet failure: that one IS a choice
      // the visitor can go back and change.
      if (!backend.startsWith('webgpu') && wasmEncoderQuant === DEFAULT_WASM_ENCODER_QUANT) {
        setFatalModelError(true);
      }
      setStatus('failed');
      setProgress('');
    }
  }

  // Immediate model reload when a model-defining control changes while a model
  // is already loaded (Q1). armModelReloadIfLoaded() is called from the
  // control's onChange; this effect runs after the new value lands in state,
  // so loadModel() reads the fresh backend/precision. Only a change that armed
  // the flag reloads: the initial load and any programmatic change do not.
  const modelParamSig = `${repoId}|${backend}|${wasmEncoderQuant}|${webgpuEncoderQuant}`;
  const modelParamSigRef = useRef(modelParamSig);
  useEffect(() => {
    if (modelParamSigRef.current === modelParamSig) return;
    modelParamSigRef.current = modelParamSig;
    if (reloadModelOnParamChangeRef.current) {
      reloadModelOnParamChangeRef.current = false;
      loadModel();
    }
    // loadModel intentionally omitted from deps: it is recreated every render
    // and this effect must fire only on a param-signature change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelParamSig]);

  // Spin up the live transcriber if the user enabled it. Reads PCM out of
  // the same pcmChunksRef both record paths feed; safe to call once per
  // recording session. The canonical stop-pass still runs on stop.
  function maybeStartLiveTranscriber(audioCtx) {
    if (!liveTranscriptionEnabledRef.current) return;
    if (!modelRef.current) return;
    if (liveTranscriberRef.current) return;
    // A capture can now start while another transcription is running (it gets
    // queued on stop), but the live pass shares the single ORT session with the
    // batch path, and concurrent invocations either queue silently or race on
    // the encoder's intermediate tensors and emit garbage (F-82). A recording
    // started mid-transcription therefore runs WITHOUT the live preview; the
    // final batch pass is unaffected.
    if (isTranscribingRef.current) return;
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

      // Open the recording AudioContext at the mic's NATIVE sample rate so the
      // context matches the mic; resamplePcmTo16k (below) then owns the 16 kHz
      // conversion offline. Chromium reports the native rate via
      // settings.sampleRate; Firefox reports nothing, so buildRecordingRateCandidates
      // tries the browser default (== native) before the SpeechMike-specific low
      // rates. This avoids forcing a 16 kHz context on a normal Firefox mic, which
      // Firefox silently relabels into ~3x slowed-down audio (see the helper's
      // docstring and mdn/browser-compat-data #16213). SpeechMike rates remain as
      // fallbacks; connecting AudioNodes across mismatched rates can throw, which
      // the try/catch below skips past.
      const reportedRate = settings.sampleRate;
      const ratesToTry = buildRecordingRateCandidates(reportedRate);

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
      // Keep the ref in lockstep synchronously (the mirroring effect lags a
      // render) so the capture queue treats a recording started mid-load as
      // "live" and holds its drain until we stop.
      isRecordingRef.current = true;
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
      // Only claim 'modelReady' if the model actually is: the countdown can now
      // run while the model is still loading (Q2), and clobbering the loading
      // status there would hide the download progress.
      if (modelRef.current) setStatus('modelReady');
      return;
    }

    if (!isRecording) return;

    console.log('[Record] Stopping recording...');
    // Flip awaitingFinal first so the live transcript and status banner
    // remain visible across the (possibly long) gap between stop and the
    // final ASR result hitting the transcriptions list.
    setAwaitingFinal(true);
    setIsRecording(false);
    // Update the ref synchronously (the effect that mirrors isRecording lags a
    // render) so the capture queue we submit to below sees recording as over
    // and can drain immediately.
    isRecordingRef.current = false;
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
    const safeName = sanitizeDeviceName(file.name, 'file');

    // Feed the recorded 16kHz PCM straight to the transcription core (not
    // processAudioFile, which would decode+resample the WAV again at the device
    // rate and back, degrading the signal). The entry carries this exact PCM +
    // WAV so "Transcribe again" stays lossless. Go through the shared queue: it
    // transcribes now if the model is ready, or waits until the in-progress
    // load finishes (Q2) instead of dropping the recording. Skip the status
    // reset when another transcription is mid-flight: this capture is only
    // being queued behind it, and 'modelReady' would clobber its progress line.
    if (modelRef.current && !isTranscribingRef.current) setStatus('modelReady');
    console.log('[Record] Queuing for transcription...');
    captureQueue.submit({ pcm: pcm16k, opts: { safeName, audioDuration: pcm16k.length / targetSampleRate, audioBlob: wavBlob } });
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


  // --- Dictation device (SpeechMike) integration ---
  // Sets up a DictationDeviceManager, wires RECORD/STOP button events to the
  // recording lifecycle, and stores the manager for cleanup.  The `isRecordingRef`
  // / `isPausedRef` pattern avoids stale-closure issues inside the HID callback.
  const isRecordingRef = useRef(isRecording);
  const isPausedRef = useRef(isPaused);
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  // --- Capture queue (Q2: capture while the model is still loading) ---
  // Mirror runTranscription into a ref so the (stable) queue always calls the
  // latest closure (fresh state) rather than a stale first-render one.
  const runTranscriptionRef = useRef(null);
  runTranscriptionRef.current = runTranscription;
  // Same mirroring for the benchmark driver: it changes backend/precision
  // state, waits for the change to be LIVE (liveSettingsRef, refreshed on every
  // render just like these function refs), then calls through the ref so it
  // always runs the closure that sees the new settings. Without this the driver
  // would reload the model with the previous render's backend.
  const loadModelRef = useRef(null);
  loadModelRef.current = loadModel;
  const liveSettingsRef = useRef({});
  liveSettingsRef.current = { backend, wasmEncoderQuant, webgpuEncoderQuant };
  // Created once; canRun/runJob read live values through refs, so a single
  // stable instance stays correct across renders. A job may start only when a
  // model is loaded, no local recording is live, and no transcription is
  // already in flight (the single ONNX session can't run two at once).
  const captureQueueRef = useRef(null);
  if (!captureQueueRef.current) {
    captureQueueRef.current = createCaptureQueue({
      canRun: () => !!modelRef.current && !isRecordingRef.current && !isTranscribingRef.current,
      runJob: (job) => runTranscriptionRef.current(job.pcm, job.opts),
      onCountChange: (n) => setPendingCaptureCount(n),
    });
  }
  const captureQueue = captureQueueRef.current;

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

  async function processAudioFile(file) {
    // Accept the file even while the model is still loading (Q2): decode +
    // resample need no model, and the queue transcribes it once ready. Only
    // refuse when nothing is loaded AND nothing is loading (idle/failed).
    const modelLoadingNow = isModelLoading(status);
    if (!modelRef.current && !modelLoadingNow) return alert(t('loadModelFirst'));
    if (!file) return;

    // F-124: OS-controlled file.name can contain bidi-override / control
    // codepoints; sanitize once and use the cleaned name in every
    // user-visible string. Raw file.name still goes to console.log /
    // console.time below since those are devtools-only.
    const safeName = sanitizeDeviceName(file.name, 'file');

    // A file can be handed in WHILE another transcription is running (the
    // upload control stays enabled so the user can keep feeding the queue). In
    // that case the busy flag, status line and progress text belong to the
    // in-flight run: leave them alone for the whole decode and let the
    // queued-captures banner be the feedback. Snapshot once here; no await sits
    // between this read and setTranscribing(true) below, so the flag cannot
    // flip in between.
    const anotherRunActive = isTranscribingRef.current;
    if (!anotherRunActive) {
      setTranscribing(true);
      setStatus(`${t('transcribingFile')} "${safeName}"…`);
    }

    try {
      console.log(`[Transcribe] Starting transcription for file: "${file.name}"`);
      console.log(`[Transcribe] File details:`, {
        name: file.name,
        type: file.type,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        lastModified: new Date(file.lastModified).toISOString()
      });

      const targetSampleRate = 16000;

      // Decode + resample to 16 kHz mono float32. Prefer the vendored ffmpeg.wasm
      // decoder (src/lib/audioDecode.js) so the browser reproduces the CLI's
      // `ffmpeg -i <file> -ac 1 -ar 16000 -f f32le` byte-for-byte, including the
      // AAC encoder-delay/priming trim that decodeAudioData omits. If the ~31 MB
      // core cannot load (CSP/memory) or the decode throws, fall back to the Web
      // Audio single-pass path (decodeAudioData into a 16 kHz OfflineAudioContext)
      // so uploads never hard-break. Both decoders read the File themselves; the
      // fallback re-reads it (File stays re-readable) after ffmpeg detaches its
      // own copy, so a failed ffmpeg attempt cannot corrupt the fallback input.
      console.log(`[Transcribe] Decoding + resampling "${file.name}" to ${targetSampleRate}Hz...`);
      const resampleStart = performance.now();

      // Yield to UI before the heavy decode so the status line paints.
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!anotherRunActive) {
        setStatus(`${t('processingResampling')} "${safeName}"`);
        setProgressText(t('resamplingTo16k'));
      }

      const { pcm, via: decodedVia } = await decodeToPcm16k(file);

      // Yield to UI after the heavy decode.
      await new Promise(resolve => setTimeout(resolve, 0));

      const resampleSeconds = (performance.now() - resampleStart) / 1000;
      console.log(`[Transcribe] Decoded + resampled to ${targetSampleRate}Hz via ${decodedVia} in ${resampleSeconds.toFixed(2)}s`);
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

      // Hand the already-resampled PCM to the shared queue. It transcribes now
      // if the model is ready, waits until the in-progress load finishes (Q2),
      // or waits behind the transcription already running. Clear the
      // decode-phase busy flag first so the queue's own runTranscription owns
      // isTranscribing cleanly (and canRun() is not blocked by our own flag);
      // when another run set the flag it is NOT ours to clear (the queue drains
      // from that run's finally). "Transcribe again" calls runTranscription
      // directly with the stored PCM, skipping a second (lossy) resample.
      if (!anotherRunActive) setTranscribing(false);
      captureQueue.submit({ pcm, opts: { safeName, audioDuration, audioBlob } });
    } catch (error) {
      // Only the decode/resample stage can throw here: runTranscription owns
      // (and swallows) model-side errors. Surface decode failures the same way,
      // but never reset state owned by a transcription that is still running
      // (the alert below is this file's whole failure surface then).
      console.error('[Transcribe] Audio decode/resample failed:', error);
      if (!anotherRunActive) {
        setStatus('transcriptionFailed');
        setTranscribing(false);
        setAwaitingFinal(false);
      }
      // F-124: file.name is OS-controlled and can contain bidi-override or
      // control codepoints. safeName is already sanitized above.
      alert(`Failed to transcribe "${safeName}": ${transcribeErrorMessage(error)}`);
    }
    // No finally/close needed: decode + resample now runs entirely on
    // OfflineAudioContexts, which hold no realtime audio thread. Their decoded
    // buffers are dropped above (decoded = null) or become GC-eligible when
    // this scope unwinds, so there is nothing to tear down on the error path.
  }

  // Shared transcription core: runs the model on already-16kHz PCM and either
  // appends a new history entry or replaces an existing one in place
  // (replaceId). The caller owns audio decode/resample, so this never touches
  // an AudioContext: the record/upload path (processAudioFile) and "Transcribe
  // again" (which feeds stored PCM, skipping a second resample) both reuse it.
  // audioBlob/pcm are attached to NEW entries only and live in memory.
  // `benchmark: true` (sidebar Benchmark section) runs the very same pipeline
  // but keeps its output out of the user's way: no history entry, no clipboard
  // copy, no transcript replacement, and failures are RETHROWN instead of
  // alerted so the benchmark driver can record them as a result row. Everything
  // that decides speed (boost wait, chunking, pools, pipelines, metrics) is
  // untouched, which is the whole point: the benchmark must measure the real
  // path, not a private copy of it.
  async function runTranscription(pcm, { safeName, audioDuration, audioBlob = null, replaceId = null, benchmark = false }) {
    setTranscribing(true);
    setStatus(`${t('transcribingFile')} "${safeName}"…`);
    // WebGPU rendering-coupling guard: pause every CSS animation for the whole
    // run (the html.gpu-run rule in App.css). Continuous compositor frames
    // gate WebGPU callback delivery process-wide, so an animating spinner
    // taxes every JSEP yield inside encoder session.run: measured ~50x on the
    // fp32 encoder (227 s -> 4.5 s on a 3-min clip, 2026-08-11). Moving the
    // encoder to a worker does NOT escape this (workers stall even harder
    // while the page animates), so pausing the page's own animations is the
    // fix. Depth-counted so overlapping runs never unpause each other early.
    const gpuRun = backend.startsWith('webgpu');
    if (gpuRun) {
      gpuRunDepthRef.current += 1;
      document.documentElement.classList.add('gpu-run');
      // Positive marker asserted by scripts/webgpu-check.mjs.
      console.log('[Transcribe] animations paused (WebGPU rendering-coupling guard)');
    }
    try {
      // Never decode with a stale/absent boost trie while a rebuild for the
      // current config is pending (see waitForBoostReady above).
      await waitForBoostReady();
      // Chunk large audio files to avoid "too many function arguments" error
      // This happens when audio is very long and internal operations hit JS engine limits
      // Chunking can be toggled off to send full audio to the model in one pass
      const MAX_CHUNK_DURATION = chunkDuration; // seconds (user-configurable)

      // Wall-clock timer for the whole transcription (covers both the chunked
      // and single-pass branches below) plus an accumulator for the decode
      // phase. Decode is the only stage whose cost scales ~linearly with beam
      // width (preprocess/encode/tokenize run once per chunk regardless), so
      // summing decode_ms lets us estimate the single-beam (greedy) wall time
      // (only meaningful, and only logged, when beamWidth > 1). Per-stage
      // timings are collected on every run (enableProfiling below) so the
      // history timestamp's hover tooltip can show encode/decode times; that
      // collection is just a few performance.now() reads and does not log.
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
      let observedChunks = 1;        // how many chunks the planner actually made

      const chunkedOpts = {
        enableChunking,
        chunkDurationSec: MAX_CHUNK_DURATION,
        overlapSec: 2,
        // Silence-aware seam snapping is intentionally NOT passed here: it uses
        // transcribeChunked's hardcoded DEFAULT_SNAP_TO_SILENCE_SEC. It is a
        // product default, deliberately not surfaced as a user setting (an extra
        // knob would only confuse users).
        returnTimestamps: true,
        frameStride,
        // Pinned to 0: temperature never changes the transcript (greedy argmax
        // is scale-invariant; MAES ranks at temperature 1 regardless), so it has
        // no effect on output. Passed explicitly so we don't inherit
        // transcribe()'s 1.2 default.
        temperature: 0,
        beamWidth,
        maesNumSteps,
        maesExpansionBeta,
        maesExpansionGamma,
        maesPrefixAlpha,
        // Always collect per-stage timings (cheap; no console output unless the
        // model is in verbose/debug mode) so every transcription has metrics for
        // the timestamp hover tooltip and the advanced perf panel.
        enableProfiling: true,
        phraseBoost: phraseBoostRef.current,
        // Opt-in decode introspection for the per-entry Debug view (sidebar
        // "Decode debug" checkbox). Off = zero overhead in the decoder.
        collectDecodeDebug: debugDecode,
      };
      const onChunk = async ({ chunkNum, totalChunks, result, partialText, elapsedMs }) => {
        // decode_ms scales with beam width; sum it for the single-beam estimate.
        totalDecodeMs += result.metrics?.decode_ms || 0;
        runningProcessingMs += result.metrics?.total_ms || 0;
        chunksCompleted += 1;
        if (totalChunks > 0) observedChunks = totalChunks;

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
      };

      // WASM chunk-parallel encode: engage the pool only when the clip will
      // actually chunk (a single-pass clip never calls encodeChunk, so awaiting
      // pool readiness would only delay it) and every worker is ready.
      let pipelineEncodeChunk = null;
      try {
        if (backend === 'wasm' && encodePoolRef.current.length
            && enableChunking && pcm.length > MAX_CHUNK_DURATION * 16000
            && await (encodePoolReadyRef.current || Promise.resolve(false))) {
          pipelineEncodeChunk = encodeChunkViaPool;
          // Positive marker (asserted by the e2e) that chunk-parallel encoding
          // actually engaged rather than silently falling through to serial.
          console.log(`[Encode] pool engaged: ${encodePoolRef.current.length} workers encoding chunks in parallel`);
        }
      } catch (e) {
        console.warn('[Encode] pool setup failed, encoding in-thread:', e);
        pipelineEncodeChunk = null;
      }
      // Decode worker: engage it only when it is ready, syncing its boost trie
      // to the main thread's first. On WebGPU it overlaps GPU encode with WASM
      // decode; on WASM it engages only COMPOSED with the pool (pooled encodes
      // feed worker decodes), so a short clip or a gated-off pool keeps the
      // ground-truth in-thread decode. Best-effort: any setup failure just
      // runs the in-thread path.
      let pipelineDecodeChunk = null;
      try {
        const wantDecodeWorker = backend.startsWith('webgpu')
          || (backend === 'wasm' && !!pipelineEncodeChunk && wasmDecodePipelineEnabled);
        if (wantDecodeWorker && decodeWorkerRef.current
            && await (decodeWorkerReadyRef.current || Promise.resolve(false))) {
          await syncDecodeWorkerBoost(decodeWorkerRef.current);
          pipelineDecodeChunk = decodeChunkViaWorker;
          // Positive marker so a run can confirm the overlap actually engaged
          // (vs. a silent fall-through to in-thread). The composed variant is
          // asserted by the composed-pipeline e2e.
          console.log(backend === 'wasm'
            ? '[Decode] pipeline engaged: pooled encode overlapping WASM decode in worker (composed)'
            : '[Decode] pipeline engaged: GPU encode overlapping WASM decode in worker');
        }
      } catch (e) {
        console.warn('[Decode] pipeline setup failed, using in-thread decode:', e);
        pipelineDecodeChunk = null;
      }
      // If a pipelined run fails mid-flight, reset progress accounting and retry
      // once on the in-thread path so the old sequential loop stays ground truth.
      const resetProgressCounters = () => {
        lastReportedProgress = -1; runningProcessingMs = 0; chunksCompleted = 0; totalDecodeMs = 0;
      };
      let res;
      if (pipelineDecodeChunk && pipelineEncodeChunk) {
        // Composed mode (WASM): pooled encodes feed worker decodes; a failure
        // anywhere retries the whole clip on the fully in-thread ground truth.
        try {
          res = await modelRef.current.transcribeChunked(pcm, 16000, { ...chunkedOpts, decodeChunk: pipelineDecodeChunk, encodeChunk: pipelineEncodeChunk }, onChunk);
        } catch (e) {
          console.warn('[Decode] composed run failed, retrying in-thread:', e);
          resetProgressCounters();
          res = await modelRef.current.transcribeChunked(pcm, 16000, chunkedOpts, onChunk);
        }
      } else if (pipelineDecodeChunk) {
        try {
          res = await modelRef.current.transcribeChunked(pcm, 16000, { ...chunkedOpts, decodeChunk: pipelineDecodeChunk }, onChunk);
        } catch (e) {
          console.warn('[Decode] pipelined run failed, retrying in-thread:', e);
          resetProgressCounters();
          res = await modelRef.current.transcribeChunked(pcm, 16000, chunkedOpts, onChunk);
        }
      } else if (pipelineEncodeChunk) {
        try {
          res = await modelRef.current.transcribeChunked(pcm, 16000, { ...chunkedOpts, encodeChunk: pipelineEncodeChunk }, onChunk);
        } catch (e) {
          console.warn('[Encode] pooled run failed, retrying in-thread:', e);
          resetProgressCounters();
          res = await modelRef.current.transcribeChunked(pcm, 16000, chunkedOpts, onChunk);
        }
      } else {
        res = await modelRef.current.transcribeChunked(pcm, 16000, chunkedOpts, onChunk);
      }

      // Clear progress indicators (no-op when no chunk UI ran).
      setProgressPct(null);
      setProgressText('');
      console.log(`[Transcribe] Transcription completed successfully`);

      // Total wall time for the entire audio. When a wide beam was used, also
      // report the estimated single-beam (greedy) time so the cost of the beam
      // width is visible: only the decode phase scales with beam width, so the
      // estimate keeps the beam-independent wall time and divides decode by it.
      const transcribeElapsedMs = performance.now() - transcribeStartTime;
      // proc_t/dur_t = processing time / audio duration (lower is faster). < 1
      // means faster than real time (e.g. 0.25 = a 60s clip transcribed in 15s).
      const procPerDur = audioDuration > 0 ? (transcribeElapsedMs / 1000) / audioDuration : 0;
      let transcribeTimeLog = `[Transcribe] Total time for entire audio: ${formatDuration(transcribeElapsedMs / 1000)} (proc_t/dur_t ${procPerDur.toFixed(3)})`;
      if (beamWidth > 1 && totalDecodeMs > 0) {
        const nonDecodeMs = Math.max(0, transcribeElapsedMs - totalDecodeMs);
        const singleBeamMs = nonDecodeMs + totalDecodeMs / beamWidth;
        transcribeTimeLog += ` (~${formatDuration(singleBeamMs / 1000)} estimated with beamWidth=1, current beamWidth=${beamWidth})`;
      }
      console.log(transcribeTimeLog);

      // Encode/decode split + the WebGPU pipeline's overlap ceiling. On the
      // decode-worker path GPU encode runs concurrently with WASM decode, so the
      // most wall time it can hide is min(encode, decode) (the shorter stage fits
      // entirely under the longer). Logging the split makes that ceiling, and how
      // decode-dominated a given backend/beam config is, measurable per run.
      const mx = res.metrics;
      if (mx && ((mx.encode_ms || 0) + (mx.decode_ms || 0)) > 0) {
        const enc = mx.encode_ms || 0;
        const dec = mx.decode_ms || 0;
        console.log(`[Transcribe] Stage split: encode ${(enc / 1000).toFixed(1)}s, decode ${(dec / 1000).toFixed(1)}s`
          + ` | pipeline overlap ceiling ~${(Math.min(enc, dec) / 1000).toFixed(1)}s (min of the two)`);
      }

      setLatestMetrics(res.metrics);

      if (benchmark) {
        // Hand the numbers back to the benchmark driver and leave the history,
        // the visible transcript and the clipboard exactly as the user left them.
        setStatus('modelReady');
        return {
          text: res.utterance_text,
          metrics: res.metrics,
          chunks: observedChunks,
          wallMs: transcribeElapsedMs,
        };
      }

      // Spelled-out numbers -> digits, applied once here, after the benchmark
      // early-return above (that path is measured against a known sentence, so
      // it must see the model's raw output). Text and word timestamps go through
      // the same core, so the plain and speaker views can never disagree.
      if (numbersToDigits) {
        res.utterance_text = numberWordsToDigits(res.utterance_text, lang);
        res.words = numberWordsToDigitsInWords(res.words || [], lang);
      }

      // Fields refreshed on every run, whether we append or replace in place.
      const resultFields = {
        filename: safeName,
        text: res.utterance_text,
        timestamp: new Date().toLocaleTimeString(),
        duration: audioDuration, // original duration (without padding)
        wordCount: res.words?.length || 0,
        // Full wall-clock RTF (real-time factor): total transcribe time / audio
        // duration. Distinct from metrics.procPerDur (model-internal proc/dur):
        // this includes decode/resample, chunk overhead and gaps. Shown in the
        // kebab menu. Persisted (harmless speed number, no PHI) so it survives a
        // reload; see slimTranscriptForPersist.
        rtf: procPerDur,
        metrics: res.metrics,
        words: res.words || [], // Store word-level data (timestamps)
        // In-memory only (slimTranscriptForPersist allowlist drops it): the
        // per-token decode-debug payload when the sidebar checkbox was on.
        // Also clears a stale payload on a "Transcribe again" with debug off.
        decodeDebug: res.decodeDebug ?? null
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
          const textToCopy = defaultDictation && dictationRegexRules.length > 0
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
      // The benchmark expects failures as data (a "failed" row for that
      // backend), not as a modal the user has to dismiss mid-run.
      if (benchmark) throw error;
      alert(`Failed to transcribe "${safeName}": ${transcribeErrorMessage(error)}`);
    } finally {
      if (gpuRun) {
        gpuRunDepthRef.current = Math.max(0, gpuRunDepthRef.current - 1);
        if (gpuRunDepthRef.current === 0) document.documentElement.classList.remove('gpu-run');
      }
      setTranscribing(false);
      // The final transcription has now been pushed (or the run failed and
      // the user has been alerted). Either way, drop the awaiting indicator.
      setAwaitingFinal(false);
      // Pick up anything queued while this transcription ran (a capture that
      // arrived mid-run, or the next buffered clip). No-op if this call was
      // itself the queue draining (its guard bails on re-entry).
      captureQueue.drain();
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

    // Accept the file even while the model is still loading (Q2): processAudioFile
    // decodes it (no model needed) and the queue transcribes it once the model
    // is ready. Only refuse when nothing is loaded AND nothing is loading.
    if (!modelRef.current && !isModelLoading(status)) {
      alert(t('loadModelFirst'));
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

  // Build the support report: environment probes (lib/supportReport.js) plus
  // the app/settings/model state only App has. Regenerated on section open and
  // on copy so the pasted text reflects the current session, never a stale
  // render.
  async function generateSupportReport() {
    const env = await collectEnvironment();
    return buildSupportReport({
      generatedAt: new Date().toISOString(),
      app: {
        name: 'parakeet_web',
        version: VERSION,
        commit: COMMIT,
        mode: (typeof import.meta !== 'undefined' && import.meta.env?.MODE) || null,
        url: typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : null,
        uiLanguage: lang,
        modelRepo: repoId,
      },
      settings: {
        backend,
        wasmEncoderQuant,
        webgpuEncoderQuant,
        cpuThreads,
        parallelEncode,
        enableChunking,
        chunkDurationSec: chunkDuration,
        beamWidth,
        debugDecode,
      },
      model: {
        loaded: !!modelRef.current,
        status,
        maxEncoderBatch: modelRef.current?.maxEncoderBatch ?? null,
        encodePool: {
          workers: encodePoolRef.current.length,
          plan: encodePoolPlan({ cpuThreads, maxCores, deviceMemory: navigator.deviceMemory }),
        },
        decodeWorker: {
          // 'composed' = the WASM companion of the pool, 'webgpu' = the
          // independent GPU-side one, false = this model runs decode in-thread.
          mode: decodeWorkerInitParamsRef.current
            ? (composedDecodeEligibleRef.current ? 'composed' : 'webgpu') : false,
          running: !!decodeWorkerRef.current,
          threads: decodeWorkerInitParamsRef.current?.numThreads ?? null,
          operatorEnabled: wasmDecodePipelineEnabled,
        },
      },
      env,
    });
  }

  async function copySupportReport() {
    try {
      const report = await generateSupportReport();
      setSupportReport(report);
      await navigator.clipboard.writeText(sanitizeClipboardText(report));
      setSupportReportCopied(true);
      setTimeout(() => setSupportReportCopied(false), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('[Copy] Failed to copy support report:', err);
      alert(t('failedCopyClipboard'));
    }
  }

  // Refresh the report whenever the Debug section is (re)opened or the model
  // status/backend changes while it is open. The async probes (GPU adapter,
  // storage estimate) resolve a tick after open; the cancel flag keeps a slow
  // probe from clobbering a fresher regeneration.
  useEffect(() => {
    if (!sectionsOpen.debug) return undefined;
    let cancelled = false;
    generateSupportReport()
      .then((r) => { if (!cancelled) setSupportReport(r); })
      .catch((err) => { if (!cancelled) setSupportReport(`support report failed: ${err?.message || err}`); });
    return () => { cancelled = true; };
  }, [sectionsOpen.debug, status, backend]);

  // ── Sidebar benchmark (lib/benchmark.js) ────────────────────────────────
  // Rebuild the candidate matrix whenever the section is open and something
  // that decides what this device can run changes. Selections the user already
  // made are kept; new rows arrive with the planner's default.
  useEffect(() => {
    if (!sectionsOpen.benchmark || benchmarkRunning) return;
    const plan = planBenchmark({
      webgpuAvailable: webgpuAvailable !== false,
      webgpuDisabled: WEBGPU_DISABLED,
      currentBackend: backend,
      currentWasmQuant: wasmEncoderQuant,
      currentWebgpuQuant: webgpuEncoderQuant,
      shaderF16: webgpuShaderF16 === true,
      // Rows this deployment cannot serve are not offered: they can only spend
      // a load attempt to report "not served here", and the sidebar radios
      // already say so before the visitor gets here. Null (no listing) offers
      // everything, exactly as before.
      servableQuants: sourceQuants,
    });
    setBenchmarkPlan(plan);
    setBenchmarkSelected((prev) => {
      const next = {};
      for (const row of plan) next[row.id] = row.id in prev ? prev[row.id] : row.defaultSelected;
      return next;
    });
  }, [sectionsOpen.benchmark, benchmarkRunning, webgpuAvailable, webgpuShaderF16,
      backend, wasmEncoderQuant, webgpuEncoderQuant, sourceQuants]);

  // Push one combination into the settings and wait until the change is LIVE.
  // React state lands on the next render, and loadModel/runTranscription read
  // the backend from their closure, so calling them in the same tick would
  // silently benchmark the PREVIOUS combination. liveSettingsRef is refreshed
  // during render, so polling it (with a real sleep, never a spin) is the
  // point at which the fresh closures exist.
  async function applyBenchmarkCombo(combo, capMs = 5000) {
    const wantBackend = coerceBackend(combo.backend);
    setBackend(wantBackend);
    if (wantBackend.startsWith('webgpu')) setWebgpuEncoderQuant(combo.quant);
    else setWasmEncoderQuant(combo.quant);
    const t0 = performance.now();
    for (;;) {
      const live = liveSettingsRef.current;
      const liveQuant = wantBackend.startsWith('webgpu') ? live.webgpuEncoderQuant : live.wasmEncoderQuant;
      if (live.backend === wantBackend && liveQuant === combo.quant) return;
      if (performance.now() - t0 > capMs) {
        throw new Error(`benchmark could not apply ${combo.id} (settings still ${live.backend}/${liveQuant})`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function sendBenchmarkReport(reportText) {
    setBenchmarkSendState('sending');
    try {
      const res = await fetch(BENCHMARK_UPLOAD_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: reportText,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log('[Benchmark] Report sent to the instance operator');
      setBenchmarkSendState('sent');
      return true;
    } catch (err) {
      console.error('[Benchmark] Sending the report failed:', err);
      setBenchmarkSendState('failed');
      return false;
    }
  }

  async function copyBenchmarkReport() {
    if (!benchmarkReport) return;
    try {
      await navigator.clipboard.writeText(sanitizeClipboardText(benchmarkReport));
      setBenchmarkCopied(true);
      setTimeout(() => setBenchmarkCopied(false), 2000);
    } catch (err) {
      console.error('[Benchmark] Failed to copy the report:', err);
      alert(t('failedCopyClipboard'));
    }
  }

  // Return the app to its pre-load state: no model, no decode/encode workers,
  // and the Load model button back on screen. Used by the benchmark when the
  // user had no model of their own loaded when they started it.
  function unloadModel(reason) {
    if (modelRef.current) {
      modelRef.current.dispose();
      modelRef.current = null;
    }
    teardownEncodePool(reason);
    stopDecodeWorker(reason);
    setLoadedModelInfo(null);
    // The boost effect keys off the vocab signature: clearing it drops the trie
    // built for the model that just went away.
    setTokenizerVocabSig(null);
    setStatus('idle');
    console.log(`[App] Model unloaded: ${reason}`);
  }

  // Scroll a finished run's report into view, once the sidebar has actually
  // reopened and the section has expanded (both are state changes made by
  // runBenchmark, so the node does not exist yet when it makes them).
  useEffect(() => {
    if (!benchmarkDone || !showSettings || !sectionsOpen.benchmark) return undefined;
    const el = benchmarkReportRef.current;
    if (!el) return undefined;
    const id = requestAnimationFrame(() => {
      try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { el.scrollIntoView(); }
    });
    return () => cancelAnimationFrame(id);
  }, [benchmarkDone, showSettings, sectionsOpen.benchmark, benchmarkReport]);

  // Run the selected matrix end to end. Everything is driven through the app's
  // own loading and transcription paths (loadModelRef / runTranscriptionRef),
  // so the timings describe what a real user gets on this machine, and the
  // driver in lib/benchmark.js owns the sequencing, timing and error handling.
  async function runBenchmark() {
    if (benchmarkRunning || isTranscribingRef.current) return;
    const combos = benchmarkPlan.filter((c) => benchmarkSelected[c.id]);
    if (!combos.length) return;

    benchmarkCancelRef.current = false;
    benchmarkLoadedComboRef.current = null;
    setBenchmarkRunning(true);
    setBenchmarkDone(false);
    // Lay the whole table out up front, one placeholder per row the run will
    // visit, and let the driver fill it in as it goes. A run takes minutes, and
    // an empty panel behind a one-line progress string said nothing about what
    // was coming or how far along it was.
    setBenchmarkResults(planBenchmarkRows(combos, benchmarkLongProfile ? ['short', 'long'] : ['short']));
    setBenchmarkReport('');
    setBenchmarkSendState('idle');
    setBenchmarkProgress(t('benchmarkPreparing'));

    // What to put back afterwards: the settings the user had, and whether they
    // had a model loaded at all (the run swaps models and the cache only holds
    // one at a time, so anything else would leave them worse off).
    const restore = {
      id: `${backend}:${backend.startsWith('webgpu') ? webgpuEncoderQuant : wasmEncoderQuant}`,
      backend,
      quant: backend.startsWith('webgpu') ? webgpuEncoderQuant : wasmEncoderQuant,
    };
    const hadModel = !!modelRef.current;
    console.log(`[Benchmark] Starting: ${combos.map((c) => c.id).join(', ')}`);

    try {
      // One fetch + one decode, shared by every combination and both profiles,
      // so decode cost never lands in a backend's numbers.
      const clipUrl = new URL(BENCHMARK_CLIP.url, document.baseURI).toString();
      const res = await fetch(clipUrl);
      if (!res.ok) throw new Error(`benchmark clip: HTTP ${res.status}`);
      const blob = await res.blob();
      const { pcm } = await decodeToPcm16k(new File([blob], 'benchmark.mp3', { type: 'audio/mpeg' }));
      const longPcm = benchmarkLongProfile ? tilePcm(pcm, LONG_PROFILE_TARGET_SEC) : null;
      const profiles = benchmarkLongProfile ? ['short', 'long'] : ['short'];

      const results = await runBenchmarkPlan(combos, {
        profiles,
        repeats: benchmarkRepeats,
        now: () => performance.now(),
        shouldCancel: () => benchmarkCancelRef.current,
        onProgress: ({ phase, combo, profile, step, totalSteps }) => {
          if (phase === 'done') return setBenchmarkProgress('');
          const what = phase === 'load' ? t('benchmarkLoading')
            : phase === 'warmup' ? t('benchmarkWarmingUp')
            : t('benchmarkTranscribing');
          setBenchmarkProgress(`${what} ${combo.backend} / ${combo.quant}`
            + (profile ? ` (${profile})` : '') + ` (${Math.min(step + 1, totalSteps)}/${totalSteps})`);
          // Same words in the row itself, so the table says where the run is
          // and not only where it has been.
          setBenchmarkResults((rows) => markBenchmarkRowRunning(rows, { id: combo.id, profile, phase: what }));
          return undefined;
        },
        onResult: (row) => setBenchmarkResults((rows) => mergeBenchmarkRow(rows, row)),
        applyCombo: (combo) => applyBenchmarkCombo(combo),
        loadModel: async (combo) => {
          // No substitution during a benchmark. The app's own load happily
          // swaps an unservable precision for one that works, which is right
          // for a visitor who just wants to transcribe and wrong here: the
          // driver would time whatever loaded and file it under the row's
          // label, so an fp16 row on a mirror with no fp16 would report w4a8's
          // numbers as fp16's, with nothing in the table saying otherwise. With
          // substitution off the load throws QuantUnavailableError and the row
          // reads "not served here", which is both true and useful. It also
          // stops a benchmark from pulling a multi-GB substitute nobody asked
          // to measure.
          await loadModelRef.current({ allowQuantSubstitution: false });
          if (!modelRef.current) throw new Error('model failed to load');
          benchmarkLoadedComboRef.current = combo.id;
          // Bytes this load actually pulled (loadTransferRef is reset at the top
          // of loadModel and filled by its progress callback). Zero means every
          // file came from the IndexedDB cache, which is what makes loadMs
          // readable: a cold load times a download on the visitor's connection,
          // a warm one times a cache read plus session build.
          let downloadedBytes = 0;
          for (const n of loadTransferRef.current.values()) downloadedBytes += n;
          return { downloadedBytes };
        },
        transcribe: async ({ profile }) => {
          const audio = profile === 'long' ? longPcm : pcm;
          const audioSec = audio.length / 16000;
          const out = await runTranscriptionRef.current(audio, {
            safeName: `benchmark (${profile})`,
            audioDuration: audioSec,
            benchmark: true,
          });
          return { ...out, audioSec };
        },
      });

      // The live merges above already produced this table; assigning the
      // driver's own array at the end is what guarantees the two agree, so a
      // merge bug can never leave a stale placeholder on screen next to a
      // report that has the real row.
      setBenchmarkResults(results);
      const env = await collectEnvironment();
      const report = buildBenchmarkReport({
        reportId: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
        generatedAt: new Date().toISOString(),
        app: {
          version: VERSION,
          commit: COMMIT,
          modelRepo: repoId,
          modelSource,
        },
        // Settings that change the numbers. Recorded rather than forced, so a
        // report describes a real configuration and rows inside one report stay
        // comparable with each other.
        settings: {
          cpuThreads,
          parallelEncode,
          enableChunking,
          chunkDurationSec: chunkDuration,
          beamWidth,
          phraseBoostActive: !!phraseBoostRef.current,
          boostStrength: phraseBoostRef.current ? boostStrength : null,
        },
        clip: {
          source: BENCHMARK_CLIP.source,
          shortSec: +(pcm.length / 16000).toFixed(2),
          longSec: longPcm ? +(longPcm.length / 16000).toFixed(2) : null,
          repeats: benchmarkRepeats,
        },
        results,
        env,
      });
      const reportText = formatBenchmarkReport(report);
      setBenchmarkReport(reportText);
      // Bring the user back to the numbers. A run takes minutes and the sidebar
      // is usually closed by then (it is where the Run button was, and it
      // covers the page while the run is watched), so a finished benchmark that
      // only changes something inside a closed panel reads as nothing having
      // happened. Reopen it, expand the section, and say it is done; the scroll
      // to the report is an effect, once the panel has actually rendered.
      setBenchmarkDone(true);
      setSectionsOpen((prev) => ({ ...prev, benchmark: true }));
      setShowSettings(true);
      if (BENCHMARK_UPLOAD_ENABLED && benchmarkAutoSend) await sendBenchmarkReport(reportText);
    } catch (err) {
      console.error('[Benchmark] Run failed:', err);
      setBenchmarkProgress('');
      alert(`${t('benchmarkFailed')}: ${transcribeErrorMessage(err)}`);
    } finally {
      setBenchmarkRunning(false);
      setBenchmarkProgress('');
      // Put the user's own configuration back. The plan runs their combination
      // last, so this is usually a settings-only no-op; it only reloads when
      // the run ended on someone else's model (they deselected their own row,
      // it failed, or they cancelled).
      try {
        await applyBenchmarkCombo(restore);
        if (hadModel && benchmarkLoadedComboRef.current !== restore.id) {
          console.log(`[Benchmark] Restoring ${restore.id} (run ended on ${benchmarkLoadedComboRef.current || 'nothing'})`);
          await loadModelRef.current();
        }
      } catch (err) {
        console.error('[Benchmark] Could not restore the previous configuration:', err);
      }
      // Nothing was loaded before the run, so nothing should be loaded after
      // it: the weights sitting in memory are whichever combination the plan
      // happened to end on, which is not necessarily the configuration the
      // settings now show. Drop them and put the Load model button back, so the
      // next load is the one the user actually asks for (the weights stay
      // cached, so that load is cheap) and the run's memory is handed back.
      // Outside the try above on purpose: a restore that failed is all the more
      // reason not to leave a stranger's model loaded.
      if (!hadModel) unloadModel('benchmark finished');
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

  // Decompose the global default display setting into the two per-entry axes.
  // Values: 'raw', 'dictation', 'diarized', 'diarized+dictation' -> a value
  // containing 'diarized' means a diarized base, one containing 'dictation'
  // means the dictation layer is on. One source of truth for every default.
  const defaultBase = transcriptDisplayMode.includes('diarized') ? 'diarized' : 'raw';
  const defaultDictation = transcriptDisplayMode.includes('dictation');

  // The structural base view for one entry ('raw'|'diarized'|'debug'): its own
  // override, else the global default decomposed. 'debug' is per-entry only
  // (never a global default) and callers gate it on trans.decodeDebug.
  function getEntryBase(id) {
    const m = entryDisplayModes[id];
    if (m === 'diarized' || m === 'raw' || m === 'debug') return m;
    return defaultBase;
  }
  function setEntryBase(id, base) {
    setEntryDisplayModes(prev => ({ ...prev, [id]: base }));
  }
  // Whether the dictation regex-cleanup layer is on for an entry (independent of
  // the base view). Defaults from the global default. Callers gate the actual
  // transform on dictationRegexRules.length so an empty rule set is a no-op even
  // when the flag is on.
  function entryDictationOn(id) {
    return entryDictation[id] ?? defaultDictation;
  }
  function toggleEntryDictation(id) {
    setEntryDictation(prev => ({ ...prev, [id]: !(prev[id] ?? defaultDictation) }));
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
  // Save an entry's audio to disk. Mints its own object URL rather than reusing
  // the inline player's (getEntryAudioUrl), so revoking it here can never pull
  // the source out from under an open player; the download has already been
  // handed to the browser by the time the click returns.
  //
  // The blob is the 16 kHz mono WAV the model actually heard (built in
  // processAudioFile / stopRecording), not the uploaded file, so the name gets
  // a .wav extension whatever the source was named.
  function downloadEntryAudio(trans) {
    if (!trans.audioBlob) return;
    const url = URL.createObjectURL(trans.audioBlob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = wavNameFor(trans);
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Give the navigation the URL is feeding a tick before dropping it.
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ } }, 0);
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
  // The dictation layer is per-entry and independent of the base view, so cache
  // any entry whose dictation flag is on (its override, or the global default).
  // Only the flat (raw-base) view reads this cache; the diarized view applies
  // the regex per turn at render time.
  useEffect(() => {
    if (!dictationRegexRules.length) return;
    const missing = transcriptions.filter(t => t.text && entryDictationOn(t.id) && !dictationCache[t.id]);
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
  }, [transcriptDisplayMode, entryDisplayModes, entryDictation, dictationRegexRules, transcriptions]);

  // Get the display text for a transcription from its two display axes. The
  // dictation layer composes with the base view: diarized + dictation copies as
  // "Speaker: cleaned text" blocks (the regex applied to each turn).
  function getDisplayText(trans) {
    const dictate = entryDictationOn(trans.id) && dictationRegexRules.length > 0;
    if (getEntryBase(trans.id) === 'diarized' && hasDiarization(trans)) {
      // Diarized copies/exports as "Speaker: text" blocks (renamed labels
      // included), which is what makes the speaker view useful to paste.
      return diarizedPlainText(trans, dictate);
    }
    if (dictate) {
      // Return cached result, or compute synchronously without setting state
      return dictationCache[trans.id] || applyDictationRegex(trans.text);
    }
    return trans.text;
  }


  // Diarized transcript as plain "Name: text" blocks, for copy/export. When
  // `dictate` is set, the dictation regex is applied to each turn's text so the
  // speaker view and the dictation cleanup compose.
  function diarizedPlainText(trans, dictate = false) {
    const turns = getDiarizedTurns(trans);
    if (!turns || turns.length === 0) return dictate ? applyDictationRegex(trans.text) : trans.text;
    const textFor = dictate ? (txt) => applyDictationRegex(txt) : null;
    return turnsToLabeledText(turns, (spk, pos) => speakerDisplayName(trans.id, spk, pos), textFor);
  }

  // Render an entry's transcript as speaker turns (turns + colour). Maps each
  // word to its diarization speaker, groups consecutive same-speaker words, and
  // labels/colours each turn. Colours cycle through the .diar-speaker-N palette.
  // The speaker label is a button that becomes a text input on click so the user
  // can rename the speaker (the rename applies to every turn for that speaker).
  function renderDiarizedTranscript(trans) {
    const turns = getDiarizedTurns(trans);
    if (!turns || turns.length === 0) {
      return <span style={{ whiteSpace: 'pre-wrap' }}>{trans.text}</span>;
    }
    // Dictation layer composes with the speaker view: clean each turn's text.
    const dictate = entryDictationOn(trans.id) && dictationRegexRules.length > 0;
    return (
      <div className="diar-turns">
        {turns.map((turn, i) => {
          const editKey = `${trans.id}:${i}`;
          return (
            <div key={i} className={`diar-turn diar-speaker-${turn.position % DIAR_PALETTE_SIZE}`}>
              {editingSpeaker === editKey ? (
                <input
                  className="diar-speaker-input"
                  autoFocus
                  value={editingSpeakerDraft}
                  onChange={e => setEditingSpeakerDraft(e.target.value)}
                  onBlur={() => {
                    if (renameCancelRef.current) { renameCancelRef.current = false; setEditingSpeaker(null); return; }
                    commitSpeakerRename(trans.id, turn, turns);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
                    else if (e.key === 'Escape') { e.preventDefault(); renameCancelRef.current = true; e.currentTarget.blur(); }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="diar-speaker-label"
                  title={t('renameSpeakerHint')}
                  onClick={() => { setEditingSpeakerDraft(speakerDisplayName(trans.id, turn.speaker, turn.position)); setEditingSpeaker(editKey); }}
                >
                  {speakerDisplayName(trans.id, turn.speaker, turn.position)}
                </button>
              )}
              <span className="diar-turn-text">{dictate ? applyDictationRegex(turn.text) : turn.text}</span>
            </div>
          );
        })}
      </div>
    );
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
  //   - Kill switch used (?webgpu=0 / WEBGPU_DISABLED): always force WASM,
  //     coercing any persisted/seeded webgpu backend. Checked BEFORE the probe
  //     guard so it holds even if the (now-skippable) probe never resolves.
  //   - WebGPU unavailable: force WASM, overriding any persisted choice. This
  //     is what protects a profile that saved 'webgpu-hybrid' on a machine
  //     whose GPU later disappeared (driver blocklist, changed hardware), which
  //     would otherwise fetch GPU weights and fail, or run them on the CPU.
  //   - No explicit user choice yet: default to WASM (int8, ~800 MB), which
  //     downloads small and runs everywhere. WebGPU is never assumed from here;
  //     a visitor only lands on it by picking it, or through the performance
  //     probe MEASURING a clear win on this machine. An explicit prior choice
  //     (persisted setting or a UI pick, both of which set
  //     backendChosenByUserRef) is honoured and never overridden here.
  useEffect(() => {
    if (!settingsLoaded) return;
    if (WEBGPU_DISABLED) {
      setBackend((prev) => coerceBackend(prev));
      return;
    }
    if (webgpuAvailable === null) return;
    if (webgpuAvailable === false) {
      setBackend((prev) => (prev.startsWith('webgpu') ? 'wasm' : prev));
      return;
    }
    if (!backendChosenByUserRef.current) {
      setBackend('wasm');
    }
  }, [settingsLoaded, webgpuAvailable]);

  // --- First-load performance probe -----------------------------------------
  // Measures this machine instead of guessing for it: the two ~5 MB graphs in
  // public/probe/ are timed through the WASM and WebGPU providers and the
  // faster one wins, subject to a margin that prices the bigger GPU download
  // (see lib/perfProbe.js for the whole rationale).

  // Prefetch in the background of a normal page load so a later probe never
  // waits on the network. Deliberately lazy and failure-tolerant: a blocked
  // fetch just means the probe fetches on demand or, failing that, reports an
  // error and the visitor stays on WASM.
  useEffect(() => {
    if (WEBGPU_DISABLED) return;             // nothing the probe could change
    // Wait for the adapter check, then only spend the ~5 MB where there is
    // genuinely something to decide: a machine with no adapter is staying on
    // WASM whatever a measurement would say, and so is one whose adapter or
    // whose model source cannot do fp16, because that is the only precision
    // the app will put a visitor on a GPU backend at unasked. Same gate as the
    // run below, deliberately: prefetching for a probe that is never going to
    // run is the pure-waste half of guessing.
    if (webgpuAvailable !== true) return;
    if (!gpuBackendAutoUsable({ servable: sourceQuants, shaderF16: webgpuShaderF16 === true })) return;
    let cancelled = false;
    const prefetch = () => {
      if (cancelled || probeAssetsRef.current) return;
      probeAssetsRef.current = (async () => {
        const [wasmRes, gpuRes] = await Promise.all([
          fetch(PROBE_MODEL_PATHS.wasm),
          fetch(PROBE_MODEL_PATHS.webgpu),
        ]);
        if (!wasmRes.ok || !gpuRes.ok) throw new Error('probe assets unavailable');
        return { wasm: await wasmRes.arrayBuffer(), webgpu: await gpuRes.arrayBuffer() };
      })().catch((e) => {
        probeAssetsRef.current = null;       // let a later explicit run retry
        console.warn('[Probe] prefetch failed:', e?.message ?? e);
        return null;
      });
    };
    // Idle time if the browser offers it, a plain timeout otherwise: this must
    // never compete with the page's own first paint.
    const idle = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(prefetch, { timeout: 5000 })
      : setTimeout(prefetch, 2000);
    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === 'function' && typeof idle === 'number') cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, [webgpuAvailable, webgpuShaderF16, sourceQuants]);

  // Run ONE arm end to end in its own worker. Resolves to null (never throws)
  // so a broken arm degrades into "stay on WASM" instead of a failed load.
  async function probeArm(arm, bytes, { numThreads }) {
    const worker = new Worker(new URL('./lib/perf.worker.js', import.meta.url), { type: 'module' });
    const pending = new Map();
    let nextId = 0;
    worker.addEventListener('message', (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'ran') pending.get(msg.id)?.resolve(msg.times);
      // Init-scoped errors (no id) belong to workerReady; only route per-run ones.
      else if (msg.type === 'error' && msg.id != null) pending.get(msg.id)?.reject(new Error(msg.message));
    });
    const run = (count) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${arm} run timed out after ${PROBE_RUN_TIMEOUT_MS} ms`));
      }, PROBE_RUN_TIMEOUT_MS);
      const done = (fn) => (v) => { clearTimeout(timer); pending.delete(id); fn(v); };
      pending.set(id, { resolve: done(resolve), reject: done(reject) });
      worker.postMessage({ type: 'run', id, count });
    });
    // The bytes are COPIED per arm (slice) rather than transferred: both arms
    // need them, and a transferred buffer would be detached for the second.
    // workerReady posts the init message and folds in every way an init can
    // fail, watchdog included, so a wedged arm can never hold up the load.
    const ready = workerReady(worker, {
      type: 'init', arm, modelBytes: bytes.slice(0), numThreads,
      seq: PROBE_SEQ, dim: PROBE_DIM, inputName: PROBE_INPUT_NAME,
      ortVariant: ORT_VARIANT,
    }, { timeoutMs: PROBE_INIT_TIMEOUT_MS, label: `Probe ${arm}` });
    return { worker, ready, run, dispose: () => { try { worker.postMessage({ type: 'dispose' }); } catch { /* gone */ } worker.terminate(); } };
  }

  /**
   * Measure both arms and record the verdict. `trigger` is 'load' (automatic,
   * from the Load model button) or 'manual' (the sidebar button).
   * Returns the verdict, or null when the probe could not run.
   */
  async function runPerfProbe({ trigger = 'manual' } = {}) {
    if (probeRunningRef.current) return null;
    probeRunningRef.current = true;
    setProbeState('running');
    // Same WebGPU rendering-coupling guard the real runs use: an animating page
    // gates JSEP callback delivery process-wide, which would tax every yield in
    // the GPU arm and make this measurement a measurement of the spinner.
    gpuRunDepthRef.current += 1;
    document.documentElement.classList.add('gpu-run');
    console.log('[Probe] animations paused (WebGPU rendering-coupling guard)');
    let arms = [];
    try {
      if (!probeAssetsRef.current) {
        probeAssetsRef.current = (async () => {
          const [w, g] = await Promise.all([fetch(PROBE_MODEL_PATHS.wasm), fetch(PROBE_MODEL_PATHS.webgpu)]);
          if (!w.ok || !g.ok) throw new Error('probe assets unavailable');
          return { wasm: await w.arrayBuffer(), webgpu: await g.arrayBuffer() };
        })().catch(() => null);
      }
      const assets = await probeAssetsRef.current;
      if (!assets) throw new Error('probe assets unavailable');

      const cfg = { numThreads: cpuThreads };

      const wasmArm = await probeArm('wasm', assets.wasm, cfg);
      const gpuArm = await probeArm('webgpu', assets.webgpu, cfg);
      arms = [wasmArm, gpuArm];
      const [wasmReady, gpuReady] = [await wasmArm.ready, await gpuArm.ready];
      if (!wasmReady) throw new Error('wasm arm did not initialise');

      // Warm both (untimed), then INTERLEAVE timed runs so ambient load drifts
      // across both arms instead of landing on whichever went second.
      const wasmWarm = await wasmArm.run(PROBE_WARMUP_RUNS);
      const gpuWarm = gpuReady ? await gpuArm.run(PROBE_WARMUP_RUNS).catch(() => null) : null;
      const timed = Math.min(planTimedRuns(wasmWarm.at(-1)), planTimedRuns(gpuWarm?.at(-1)));
      const wasmTimes = [];
      const gpuTimes = [];
      let gpuBroke = !gpuReady || !gpuWarm;
      for (let i = 0; i < timed; i++) {
        wasmTimes.push(...await wasmArm.run(1));
        if (!gpuBroke) {
          const t = await gpuArm.run(1).catch(() => null);
          if (t) gpuTimes.push(...t); else gpuBroke = true;
        }
      }

      const wasmMs = probeMedian(wasmTimes);
      const gpuMs = gpuBroke ? NaN : probeMedian(gpuTimes);
      const gpuReason = gpuBroke ? (webgpuAvailable === false ? 'no-adapter' : 'session-failed') : null;
      const pick = pickBackendFromProbe({ wasmMs, gpuMs, gpuReason });
      const verdict = buildVerdict({
        pick, wasmMs, gpuMs, appVersion: VERSION,
        adapter: webgpuAdapterSigRef.current, at: Date.now(), trigger,
        sourceSig: sourceQuantSignature(sourceQuants),
      });
      console.log(`[Probe] ${verdict.backend} wins: wasm ${wasmMs.toFixed(1)} ms vs gpu `
        + `${Number.isFinite(gpuMs) ? gpuMs.toFixed(1) + ' ms' : 'n/a'}`
        + `${pick.speedup ? ` (${pick.speedup.toFixed(2)}x)` : ''}${pick.reason ? ` [${pick.reason}]` : ''}`);
      setProbeVerdict(verdict);
      setProbeState('done');
      return verdict;
    } catch (e) {
      console.warn('[Probe] could not run:', e?.message ?? e);
      setProbeState('failed');
      return null;
    } finally {
      for (const a of arms) a.dispose();
      probeRunningRef.current = false;
      gpuRunDepthRef.current -= 1;
      if (gpuRunDepthRef.current === 0) document.documentElement.classList.remove('gpu-run');
    }
  }

  // Switch the backend, then wait until the change is LIVE before the caller
  // loads a model. React state lands on the next render and loadModel reads the
  // backend from its closure, so calling it in the same tick would load the
  // PREVIOUS backend's weights (the same trap applyBenchmarkCombo documents).
  // For the probe that would mean measuring the machine and then ignoring the
  // answer; for the GPU-weights fallback it would mean retrying the very load
  // that just failed. Never marks the backend as user-picked: nothing that
  // comes through here is a human decision.
  /**
   * Push a model-defining setting into React state and WAIT for it to be live.
   *
   * loadModel reads backend and precision from its closure, so a bare setState
   * followed by a reload re-enters with the OLD value and loads exactly the
   * model that just failed. liveSettingsRef is refreshed on every render, so
   * polling it is the only way to know the change has actually landed.
   *
   * Written once and shared by the backend flip and the GPU precision
   * substitution: a second copy of this poll is how the two would end up with
   * different timeout behaviour on the path where both fire.
   */
  async function applyLiveSetting(key, want, setter, { label = 'App', capMs = 5000 } = {}) {
    if (want === liveSettingsRef.current[key]) return;
    setter(want);
    const t0 = performance.now();
    while (liveSettingsRef.current[key] !== want) {
      if (performance.now() - t0 > capMs) {
        console.warn(`[${label}] ${key} still ${liveSettingsRef.current[key]}, wanted ${want}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function applyBackend(want, opts = {}) {
    return applyLiveSetting('backend', want, setBackend, opts);
  }

  async function applyProbeVerdict(verdict, capMs = 5000) {
    return applyBackend(coerceBackend(verdict.backend), { label: 'Probe', capMs });
  }

  const [showLowRamConfirm, setShowLowRamConfirm] = useState(false);
  const handleLoadModelClick = async (opts) => {
    if (isLowRam) {
      setShowLowRamConfirm(true);
      return;
    }
    // Probe before the download starts, so the verdict can still choose which
    // weights to fetch. It stays out of the way of anyone who made their own
    // choice, and runs once per machine (see shouldAutoProbe).
    if (shouldAutoProbe({
      settingsLoaded,
      userPickedBackend: backendUserPicked,
      // The GPU is only worth MEASURING when the app would be willing to select
      // it, and since 2026-09-11 that means fp16 specifically: on a machine or a
      // source that cannot do fp16, a probe win would be followed by the
      // GPU-to-WASM fallback on the very next load, so there is nothing to
      // decide and two timed runs to skip.
      webgpuSelectable: !WEBGPU_DISABLED && webgpuAvailable === true
        && gpuBackendAutoUsable({ servable: sourceQuants, shaderF16: webgpuShaderF16 === true }),
      hasValidVerdict: verdictStillValid(probeVerdict, {
        appVersion: VERSION, adapter: webgpuAdapterSigRef.current, at: Date.now(),
        sourceSig: sourceQuantSignature(sourceQuants),
      }),
      running: probeRunningRef.current,
    })) {
      const verdict = await runPerfProbe({ trigger: 'load' });
      if (verdict) {
        await applyProbeVerdict(verdict);
        // Call through the ref so the closure sees the backend just applied.
        loadModelRef.current(opts);
        return;
      }
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

  // Model-defining controls (backend / encoder precision / CPU threads) stay
  // editable once a model is loaded; changing one disposes the current model
  // and reloads with the new setting (freeing memory before the new weights
  // download). They lock only while a swap can't safely happen: during an
  // active transcription (Q3 - don't dispose the session mid-inference), during
  // an in-flight (re)load, or during a live recording/phone capture.
  const modelSwapBlocked = isTranscribing
    || isModelLoading(status)
    || isRecording
    || remoteMicRecording;

  // Which encoder precision the CURRENT selection would really load. Hoisted to
  // component scope because two places need the identical answer and a second
  // copy of these rules is exactly how they drift: the precision radios (which
  // must never sit on an option the backend cannot serve) and the loaded-model
  // row (which compares what loaded against what is selected, and would cry
  // "mismatch" on every fp16 pick made on a GPU with no shader-f16 if it
  // compared against the raw selection instead of this).
  const isWebgpuSelected = backend.startsWith('webgpu');
  const selectedEncoderQuant = isWebgpuSelected ? webgpuEncoderQuant : wasmEncoderQuant;
  // The three gates and the preference-order fallback live in
  // lib/encoderQuants.js with the rest of the policy, so they can be tested
  // against real repo listings instead of only through the rendered app. Note
  // `webgpuShaderF16 !== true`: null means the probe has not answered yet, and
  // "not yet" must read as "no" here rather than as permission.
  const effectiveEncoderQuant = resolveEffectiveEncoderQuant({
    backend,
    selected: selectedEncoderQuant,
    servable: sourceQuants,
    shaderF16: webgpuShaderF16 === true,
  });

  // Show the record / upload / phone controls as soon as a load has STARTED,
  // not only once it finishes (Q2): the user can capture during the download
  // and the audio is queued (captureQueue) until the model is ready. In idle /
  // failed they stay hidden, leaving just the Load Model button. isRecording /
  // isRemoteMic keep them mounted through a capture that began mid-load (when
  // the status is a recording one and the model is not yet loaded), so the
  // Stop/Pause buttons never vanish under the user.
  // A benchmark drives the very same load/transcribe paths, so the status is a
  // loading or transcribing one for its whole duration and these controls would
  // otherwise sit there looking usable. They are not: a capture would fight the
  // run for the model it is timing. Hide them until it is over.
  const showCaptureControls = !benchmarkRunning && (modelLoaded
    || isModelLoading(status)
    || isRecording
    || isRemoteMic);

  // Status line. Defined once and rendered from the two mutually exclusive
  // branches below (idle/failed, where it sits under the Load Model button, and
  // loaded, where it sits under the capture controls) so it always ends up
  // directly beneath the buttons and above the chunk progress bar, instead of
  // being stranded between the logo and the controls.
  const statusLine = (
    <p className="app-status">
      {(status === 'loadingModel' || status === 'downloadingModel' || isTranscribing || isRecording || (isRemoteMic && remoteMicRecording) || recordingCountdown !== null || awaitingFinal) && (
        <span className="spinner spinner--inline" aria-hidden="true" />
      )}
      {t('status')}: {t(status) || status}
      {boostRebuilding && (
        <span className="app-status__note">
          <span className="spinner spinner--inline" aria-hidden="true" />
          {t('boostRebuilding')}
        </span>
      )}
    </p>
  );

  return (
    <div className="app">
      {devBannerVisible && (
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
      </div>

      {/* Slow-browser warning: dismissable, never persisted, so it returns on
          every reload (the slowness does too). */}
      {slowBrowser && !slowBrowserDismissed && (
        <Modal onClose={() => setSlowBrowserDismissed(true)}>
          <div data-testid="slow-browser-modal">
            <h3 style={{ marginTop: 0 }}>🐢 {t('slowBrowserTitle')}</h3>
            <p>{t('slowBrowserBody1')}</p>
            <p>{t('slowBrowserBody2')}</p>
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button className="btn" onClick={() => setSlowBrowserDismissed(true)}>
                {t('slowBrowserDismiss')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* This deployment cannot serve the model. Not a warning like the two
          above and not dismissable-and-forgotten like them either: there is
          nothing the visitor can change, so it says who can. Same popup shape as
          the phone and slow-browser notices on purpose, because it is the same
          kind of message (something about where you are, not about what you
          did). Only reachable once WASM int8 itself has failed, which is where
          the GPU-to-WASM fallback and every source retry already lead. */}
      {fatalModelError && (
        <Modal onClose={() => setFatalModelError(null)}>
          <div data-testid="model-unservable-modal">
            <h3 style={{ marginTop: 0 }}>🚫 {t('modelUnservableTitle')}</h3>
            <p>{t('modelUnservableBody1')}</p>
            <p>{t('modelUnservableBody2')}</p>
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button className="btn" onClick={() => setFatalModelError(null)}>
                {t('modelUnservableDismiss')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Handheld warning: same contract as the slow-browser one above
          (dismissable, never persisted). Shown first, before any weights are
          fetched, because the point is to warn ahead of the download. */}
      {handheldDevice && !handheldDismissed && (
        <Modal onClose={() => setHandheldDismissed(true)}>
          <div data-testid="handheld-modal">
            <h3 style={{ marginTop: 0 }}>📱 {t('handheldTitle')}</h3>
            <p>{t('handheldBody1')}</p>
            <p>{t('handheldBody2')}</p>
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <button className="btn" onClick={() => setHandheldDismissed(true)}>
                {t('handheldDismiss')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Phone Mic on a handheld: explain what the feature is actually for
          before pairing, since here it would pair a phone with a phone. Unlike
          the two warnings above this one is a fork, so it offers a way out. */}
      {remoteMicHandheldWarn && (
        <Modal onClose={() => setRemoteMicHandheldWarn(false)}>
          <div data-testid="remote-mic-handheld-modal">
            <h3 style={{ marginTop: 0 }}>📱 {t('remoteMicHandheldTitle')}</h3>
            <p>{t('remoteMicHandheldBody1')}</p>
            <p>{t('remoteMicHandheldBody2')}</p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setRemoteMicHandheldWarn(false)}>
                {t('cancel')}
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  remoteMicHandheldAckRef.current = true;
                  setRemoteMicHandheldWarn(false);
                  startRemoteMic();
                }}
              >
                {t('remoteMicHandheldContinue')}
              </button>
            </div>
          </div>
        </Modal>
      )}

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
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem', marginBottom: 0 }}>
            <strong>{t('diarizationCredit')}:</strong>{' '}
            <a href="https://github.com/k2-fsa/sherpa-onnx" target="_blank" rel="noopener noreferrer">sherpa-onnx</a> (Apache-2.0),{' '}
            <a href="https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0" target="_blank" rel="noopener noreferrer">pyannote</a> (MIT),{' '}
            <a href="https://huggingface.co/csukuangfj/speaker-embedding-models" target="_blank" rel="noopener noreferrer">3D-Speaker CAM++</a> (Apache-2.0).
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

        {/* "Mode Dictee Medical": the same preset `?mode=med` applies, one click
            away. It sits ABOVE the collapsible groups rather than inside one
            because it is not a setting, it is a shortcut that rewrites a dozen
            of them across four different groups (model, precision, chunking,
            display, boosting, language), and burying it in any single group
            would misrepresent its reach. Locked while a model swap is unsafe,
            like every other model-defining control. */}
        <div className="setting-row setting-row--med-mode">
          <button
            type="button"
            className="primary med-mode-button"
            onClick={async () => {
              await applyMedModeSettings({ fromUser: true });
              // The button means "set this machine up as a dictation station",
              // and choosing the backend by measurement is part of that setup.
              // Unlike the page-load path this ignores the hand-picked-backend
              // and stored-verdict gates: the click IS the user asking the
              // machine to decide, now. It is still skipped when WebGPU could
              // not be selected here anyway, because then there is no question
              // to answer and the probe would just be a wait.
              if (!WEBGPU_DISABLED && webgpuAvailable === true) {
                const verdict = await runPerfProbe({ trigger: 'medmode-button' });
                if (verdict && coerceBackend(verdict.backend) !== liveSettingsRef.current.backend) {
                  armModelReloadIfLoaded();
                  await applyProbeVerdict(verdict);
                }
              }
            }}
            disabled={modelSwapBlocked || probeState === 'running'}
            title={t('tooltipMedMode')}
            data-umami-event="med_mode_button"
          >
            {t('medMode')}
          </button>
          <p className="setting-hint">{t('medModeHint')}</p>
        </div>

          <div className="settings-content">
          <CollapsibleSection id="general" title={t('settingsGroupGeneral')} open={!!sectionsOpen.general} onToggle={toggleSection}>
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
                    ['Space / Enter', t('shortcutLoadModel')],
                    ['R / Space', t('shortcutStartRecording')],
                    ['R / S / Space', t('shortcutStopRecording')],
                    ['P', t('shortcutPauseRecording')],
                    ['F', t('shortcutSelectFile')],
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

            <div className="setting-row">
              <label>
                <input type="checkbox" checked={autoCopyToClipboard} onChange={e => setAutoCopyToClipboard(e.target.checked)} />
                {t('autoCopyToClipboard')}
                <InfoTooltip text={t('tooltipAutoCopy')} />
              </label>
            </div>

            <div className="setting-row">
              <label>
                <input type="checkbox" checked={numbersToDigits} onChange={e => setNumbersToDigits(e.target.checked)} />
                {t('numbersToDigits')}
                <InfoTooltip text={t('tooltipNumbersToDigits')} />
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
                style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-strong)' }}
              >
                <option value="raw">{t('raw')}</option>
                {dictationRegexRules.length > 0 && <option value="dictation">{t('dictationRules')} ({dictationRegexRules.length} {t('dictationRulesExperimental')}</option>}
                {/* Grey out the Speakers default options when the diarization
                    models could not be loaded; the title surfaces the reason on
                    hover in the open dropdown. */}
                <option value="diarized" disabled={!!diarizationModelError} title={diarizationModelError ? `${t('diarizeModelsUnavailable')} (${diarizationModelError})` : undefined}>{t('speakers')}</option>
                {dictationRegexRules.length > 0 && <option value="diarized+dictation" disabled={!!diarizationModelError} title={diarizationModelError ? `${t('diarizeModelsUnavailable')} (${diarizationModelError})` : undefined}>{t('speakers')} + {t('dictationExp')}</option>}
              </select>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                {t('numSpeakers')}:
                <InfoTooltip text={t('tooltipNumSpeakers')} />
              </span>
              <select
                value={diarizationNumSpeakers}
                onChange={e => setDiarizationNumSpeakers(parseInt(e.target.value, 10) || 0)}
                style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-strong)' }}
              >
                <option value="0">{t('auto')}</option>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          </CollapsibleSection>

          <CollapsibleSection id="recording" title={t('settingsGroupRecording')} open={!!sectionsOpen.recording} onToggle={toggleSection}>
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
          </CollapsibleSection>

          <CollapsibleSection id="boosting" title={t('settingsGroupBoosting')} open={!!sectionsOpen.boosting} onToggle={toggleBoostingSection}>
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
                    style={{ flex: '1 1 auto', minWidth: 0, padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-strong)' }}
                  >
                    <option value={BOOST_SOURCE_DISABLED}>{t('boostSourceDisabled')}</option>
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
              {boostSource === BOOST_SOURCE_DISABLED ? (
                <div style={BOOST_HINT_PANEL_STYLE}>
                  {t('boostDisabledHint')}
                </div>
              ) : boostCollapsed ? (
                <div style={{ ...BOOST_HINT_PANEL_STYLE, color: 'var(--warning-soft-text)' }}>
                  <div style={{ fontWeight: 600 }}>
                    {t('boostCuratedLoaded').replace('{name}', boostSource.replace(/\.txt$/, ''))}
                  </div>
                  <div>{t('boostCuratedEditHint')}</div>
                </div>
              ) : (boostCustomOversize && !boostEditorOpen) ? (
                <div style={BOOST_HINT_PANEL_STYLE}>
                  <div style={{ fontWeight: 600, color: 'var(--warning-soft-text)' }}>
                    {t('boostCustomLarge').replace('{n}', boostLineCount)}
                  </div>
                  <div>{t('boostCustomLargeHint')}</div>
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                    <button type="button" onClick={() => setBoostEditorOpen(true)}>
                      {t('boostCustomEdit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(t('boostCustomClearConfirm'))) return;
                        setBoostPhrases('');
                        setBoostCustomText('');
                        setBoostEditorOpen(false);
                      }}
                    >
                      {t('boostCustomClear')}
                    </button>
                  </div>
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
                    borderRadius: '4px', border: '1px solid var(--border-strong)',
                    background: 'var(--bg-card)', color: 'var(--text)',
                  }}
                />
              )}
              {boostWarnings.length > 0 && (
                <p style={{
                  fontSize: '0.78rem', color: 'var(--warning-soft-text)', margin: 0,
                  overflowWrap: 'anywhere', wordBreak: 'break-word',
                }}>
                  {t('boostWeightWarning').replace('{max}', MAX_PHRASE_WEIGHT)}{' '}
                  {boostWarnings.map(w => w.phrase).join(', ')}
                </p>
              )}
              {boostConflicts.length > 0 && (
                <p style={{
                  fontSize: '0.78rem', color: 'var(--warning-soft-text)', margin: 0,
                  overflowWrap: 'anywhere', wordBreak: 'break-word',
                }}>
                  {t('boostConflictWarning')}{' '}
                  {boostConflicts.map(formatBoostConflict).join('; ')}
                </p>
              )}
              {boostPhrases.trim() && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
                  {t('boostPhrasesLoaded').replace('{n}', boostPhraseCount)}
                </p>
              )}
              {boostUnkWarnings.length > 0 && (
                <details style={{ fontSize: '0.78rem', color: 'var(--warning-soft-text)' }}>
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
                      borderRadius: '4px', border: '1px solid var(--border-strong)',
                      background: 'var(--bg-card)', color: 'var(--text)',
                    }}
                  />
                </details>
              )}
            </div>

            {/* Advanced boost knobs (the CLI's --boost-minp / --depth-scaling),
                presented like the MAES rows above. Only meaningful when a
                phrase list is loaded (with no phrases the trie is inert), so
                hide them otherwise, mirroring the beamWidth>1 gate on MAES. */}
            {boostPhrases.trim() && (
              <>
                <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                  <span className="setting-label" style={{ flex: '1 1 auto' }}>
                    {t('boostMinp')}:
                    <InfoTooltip text={t('tooltipBoostMinp')} />
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="1"
                    step="0.01"
                    placeholder={t('boostMinpOff')}
                    value={boostMinp ?? ''}
                    onChange={e=>{
                      const raw = e.target.value;
                      // Blank field = off (each phrase keeps its own gate); a
                      // number in [0,1] = the global gate (0 = boost all, 1 = off).
                      if (raw === '') { setBoostMinp(null); return; }
                      const v = Number(raw);
                      if (Number.isFinite(v)) setBoostMinp(Math.max(0, Math.min(1, v)));
                    }}
                    style={{ width: '4.5rem' }}
                  />
                </div>

                <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                  <span className="setting-label" style={{ flex: '1 1 auto' }}>
                    {t('boostDepthScaling')}:
                    <InfoTooltip text={t('tooltipBoostDepthScaling')} />
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="5"
                    step="0.1"
                    value={boostDepthScaling}
                    onChange={e=>{
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setBoostDepthScaling(Math.max(0, Math.min(5, v)));
                    }}
                    style={{ width: '4.5rem' }}
                  />
                </div>
              </>
            )}

          </CollapsibleSection>

          <CollapsibleSection id="engine" title={t('settingsGroupEngine')} open={!!sectionsOpen.engine} onToggle={toggleSection}>
            {/* Model picker. Only rendered when the operator configured more
                than one repo in VITE_MODEL_REPO: with a single one there is
                nothing to choose and a one-option control would just be noise.
                Locked during a transcription like the other model-defining
                controls, since switching disposes the live session. Choosing
                here makes the choice the visitor's own, so it clears the
                ?model= flag and becomes persistable again. */}
            {modelRepos.length > 1 && (
              <div className="setting-row">
                <span className="setting-label">
                  {t('model')}:
                  <InfoTooltip text={t('tooltipModel')} />
                </span>
                <select
                  value={repoId}
                  onChange={e => {
                    armModelReloadIfLoaded();
                    modelRepoFromUrlRef.current = false;
                    setRepoId(e.target.value);
                  }}
                  disabled={modelSwapBlocked}
                  style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-strong)' }}
                  data-umami-event="model_repo_select"
                >
                  {modelRepos.map(id => (
                    <option key={id} value={id} title={id}>{shortRepoLabel(id)}</option>
                  ))}
                </select>
              </div>
            )}
            <p style={{ marginTop: 0 }}>
              <strong>{t('model')}:</strong>{' '}
              {/* Link to the HuggingFace model page whenever weights come from HF
                  ('hf' or 'both'); in 'local' mode there is no HF page to open,
                  so show the repo id as plain text. */}
              {modelSource !== 'local'
                ? <a href={`https://huggingface.co/${repoId}`} target="_blank" rel="noopener noreferrer">{repoId}</a>
                : repoId}
            </p>

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
                    <InfoTooltip text={t('tooltipChunkDuration')} />
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={MIN_CHUNK_DURATION_SEC}
                    max={MAX_CHUNK_DURATION_SEC}
                    step="1"
                    value={chunkDuration}
                    onChange={e => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setChunkDuration(Math.max(MIN_CHUNK_DURATION_SEC, Math.min(MAX_CHUNK_DURATION_SEC, v)));
                    }}
                    style={{ width: '5rem' }}
                  />
                </div>
              )}
            </div>

            {/* What actually loaded, versus what the controls below request.
                Rendered only once a model is up, and called out when the two
                disagree. hub.js is allowed to resolve a request differently
                (the WASM int8 pin, the GPU->WASM fallback on a precision this
                source cannot serve, a switch to the /models mirror), and every
                one of those was invisible before this row existed: the controls
                kept showing the request, so a station could sit on
                "WebGPU / fp32" while an int8 CPU model did the work. */}
            {(() => {
              const described = describeLoadedModel(
                loadedModelInfo,
                { repoId, backend, encoderQuant: effectiveEncoderQuant },
                {
                  wasm: t('wasmCpu'),
                  webgpu: t('webgpu'),
                  fromHub: t('loadedFromHub'),
                  fromLocal: t('loadedFromLocal'),
                },
              );
              if (!described) return null;
              return (
                <div className={`setting-row setting-row--loaded${described.mismatch ? ' setting-row--mismatch' : ''}`}>
                  <span className="setting-label">
                    {t('loadedModel')}:
                    <InfoTooltip text={t('tooltipLoadedModel')} />
                  </span>
                  <span className="loaded-model-value" data-testid="loaded-model">{described.text}</span>
                  {described.mismatch && <p className="setting-hint">{t('loadedDiffers')}</p>}
                </div>
              );
            })()}

            <div className="setting-row">
              <span className="setting-label">
                {t('backend')}:
                <InfoTooltip text={t('tooltipBackend')} />
              </span>
              <div className="setting-options">
                <label className={modelSwapBlocked ? 'disabled-option' : ''}>
                  <input type="radio" name="backend" value="wasm" checked={backend === 'wasm'} onChange={e => { armModelReloadIfLoaded(); chooseBackend(e.target.value); }} disabled={modelSwapBlocked} />
                  {t('wasmCpu')}
                </label>
                <label className={modelSwapBlocked || WEBGPU_DISABLED || webgpuAvailable === false ? 'disabled-option' : ''}>
                  <input type="radio" name="backend" value="webgpu-hybrid" checked={backend === 'webgpu-hybrid'} onChange={e => { armModelReloadIfLoaded(); chooseBackend(e.target.value); }} disabled={modelSwapBlocked || WEBGPU_DISABLED || webgpuAvailable === false} />
                  {WEBGPU_DISABLED ? t('webgpuDisabled') : (webgpuAvailable === false ? t('webgpuUnavailable') : t('webgpu'))}
                  {WEBGPU_DISABLED ? (
                    <InfoTooltip text={t('tooltipWebgpuDisabled')} />
                  ) : (webgpuAvailable === false && (
                    <InfoTooltip text={t(`webgpuReason_${webgpuUnavailableReason || 'noAdapter'}`)} />
                  ))}
                </label>
              </div>
            </div>

            {/* Autoconfigure: time both providers on THIS machine and pick.
                Offered whenever WebGPU could be selected here, because that is
                the only case where the answer can change anything. */}
            {!WEBGPU_DISABLED && webgpuAvailable !== false && (
              <div className="setting-row">
                <span className="setting-label">
                  {t('autoconfigure')}: <InfoTooltip text={t('tooltipAutoconfigure')} />
                </span>
                <div className="setting-options">
                  <button
                    type="button"
                    className="primary"
                    onClick={async () => {
                      const verdict = await runPerfProbe({ trigger: 'manual' });
                      // An explicit run is the user asking the machine to
                      // decide, so its answer is applied like a hand pick
                      // (without claiming they picked it, which would stop
                      // future automatic probes). Arm the reload only when the
                      // verdict actually moves the backend: the flag survives
                      // until the next signature change, so arming it for a
                      // verdict that confirms the current choice would leave a
                      // later programmatic change to trip an unwanted reload.
                      if (verdict && coerceBackend(verdict.backend) !== liveSettingsRef.current.backend) {
                        armModelReloadIfLoaded();
                        await applyProbeVerdict(verdict);
                      }
                    }}
                    disabled={probeState === 'running' || modelSwapBlocked}
                    data-umami-event="autoconfigure_button"
                  >
                    {probeState === 'running' ? t('autoconfigureRunning') : t('autoconfigureRun')}
                  </button>
                  {probeState !== 'running' && probeVerdict && (
                    <span className="setting-hint">
                      {probeVerdict.backend === 'webgpu-hybrid'
                        ? t('autoconfigureResultGpu', { speedup: (probeVerdict.speedup ?? 0).toFixed(1) })
                        : (probeVerdict.speedup
                          ? t('autoconfigureResultCpu', { speedup: (probeVerdict.speedup ?? 0).toFixed(1) })
                          : t('autoconfigureResultCpuOnly'))}
                    </span>
                  )}
                  {probeState === 'failed' && (
                    <span className="setting-hint">{t('autoconfigureFailed')}</span>
                  )}
                </div>
              </div>
            )}

            {(backend === 'wasm' || backend.startsWith('webgpu')) && (() => {
              // One display order (w4a8 / int8 lite / int8 / fp16 / fp32, by
              // ascending download size, see ENCODER_QUANT_ROWS), filtered per
              // backend and per source. Neither int8 build has a GPU encoder
              // kernel and fp16 has no usable WASM one, so those rows are
              // absent rather than greyed; fp32 and w4a8 run on both, w4a8
              // through the MatMulNBits kernel the GPU EP does implement. The
              // remembered selection is per-backend, so WASM keeps its choice
              // independently of WebGPU.
              // The runnable/effective rules live in lib/encoderQuants.js and
              // are resolved once at component scope (effectiveEncoderQuant)
              // because the loaded-model row above needs the same answer; a
              // local copy here is how the two would drift apart.
              const isWebgpu = isWebgpuSelected;
              const setQuant = isWebgpu ? setWebgpuEncoderQuant : setWasmEncoderQuant;
              const effectiveQuant = effectiveEncoderQuant;
              // int8 is the default on WASM. int8 lite is the same recipe with
              // fewer MatMuls quantised: ~88 MB smaller and lighter on RAM, at
              // slightly higher error, and only the model repo ships it (a repo
              // without it surfaces the quantUnavailable banner rather than
              // silently loading the heavier int8). w4a8 is the 4-bit build:
              // the smallest download by far and the fastest to load, but
              // slower to run than int8 on WASM and than fp32 on WebGPU (the
              // encoder is compute-bound, so shrinking the weights buys load
              // time, not throughput). fp16 is WebGPU-only: lossless at
              // half the fp32 download, the best GPU option on an adapter that
              // reports shader-f16. fp32 is opt-in on WASM via the <2 GB
              // shards (~2.4 GB, ~35 % slower) and the WebGPU default.
              // Built from ENCODER_QUANT_ROWS so the radios and the whitelists
              // the settings restore validates against cannot drift apart: a
              // value offered here but missing there would be silently reset to
              // int8 on the next reload, which is exactly how int8lite first
              // shipped without surviving a page load. A value with no entry in
              // PRECISION_ROW throws here rather than rendering a blank radio.
              const PRECISION_ROW = {
                int8lite: () => t('precisionInt8Lite'),
                int8: () => t('precisionInt8'),
                w4a8: () => t('precisionW4a8'),
                fp16: () => t('precisionFp16'),
                fp32: () => t('precisionFp32'),
              };
              // Which rows exist at all is policy, not rendering, so it lives in
              // lib/encoderQuants.js with the rest of the three-question
              // taxonomy: a precision this BACKEND has no kernel for, or one
              // this SOURCE does not host, is not rendered, and only a
              // precision the MACHINE cannot run gets a greyed row with a
              // reason. The greyed row is worth keeping for exactly that case
              // because the visitor's own adapter is the thing that decided it.
              const rows = encoderQuantRows({
                backend,
                repoFiles: sourceRepoFiles,
                shaderF16: webgpuShaderF16 === true,
                order: ENCODER_QUANT_ROWS,
              }).map((r) => ({
                ...r,
                label: PRECISION_ROW[r.value](),
                note: r.reason === 'no-shader-f16' ? t('precisionUnavailableNoF16')
                  : r.reason === 'source' ? t('precisionUnavailableSource')
                    : '',
              }));
              return (
                <div className="setting-row">
                  <span className="setting-label">
                    {t('encoderPrecision')}:
                    <InfoTooltip text={t('tooltipEncoderPrecision')} />
                  </span>
                  <div className="setting-options">
                    {/* The rows run smallest download first (ENCODER_QUANT_ROWS),
                        and that is worth stating because the obvious reading of
                        the ladder is wrong: the smallest entry, w4a8, is also
                        the slowest to run and the weakest on long audio. Without
                        this line a visitor reasonably assumes small means fast.
                        Full width so it sits on its own line above the radios. */}
                    <span className="setting-hint precision-order-hint">{t('precisionOrderHint')}</span>
                    {rows.map(r => {
                      const disabled = modelSwapBlocked || !r.available;
                      return (
                        <label key={r.value} className={disabled ? 'disabled-option' : ''}>
                          <input type="radio" name="encoderQuant" value={r.value} checked={r.available && effectiveQuant === r.value} onChange={e => { armModelReloadIfLoaded(); setQuant(e.target.value); }} disabled={disabled} />
                          {/* The label carries `**bold**` markers (int8's
                              "recommended"), so it renders as runs rather than
                              as one text node. */}
                          <span>{boldRuns(r.label).map((run, i) => (run.bold ? <strong key={i}>{run.text}</strong> : run.text))}{!r.available ? ` ${r.note}` : ''}</span>
                        </label>
                      );
                    })}
                    {/* Nothing here is checked, which needs saying rather than
                        leaving a group of radios looking undecided: the visitor
                        is on a GPU backend whose default (fp16) this machine or
                        this source cannot deliver, and the app will not pick
                        fp32 or w4a8 for them. So a load started now moves to
                        the processor at int8, and the note says so before they
                        press the button rather than as a banner after it. */}
                    {effectiveQuant === null && isWebgpu && (
                      <span className="setting-hint">{t('precisionNoneAutoUsable')}</span>
                    )}
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
                  name="cpuThreads"
                  inputMode="numeric"
                  min="1"
                  max={maxCores}
                  value={cpuThreads}
                  onChange={e=>{
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setCpuThreads(Math.max(1, Math.min(maxCores, v)));
                  }}
                  onBlur={() => {
                    // Q1: reload with the new thread count once a model is
                    // loaded, but only when the committed value truly changed
                    // (a number field can't reload sanely on every keystroke).
                    if (modelRef.current && cpuThreads !== loadedCpuThreadsRef.current) loadModel();
                  }}
                  disabled={modelSwapBlocked}
                  style={{ width: '4.5rem', opacity: modelSwapBlocked ? 0.5 : 1 }}
                />
              </div>
            )}

            {backend === 'wasm' && (
              <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                <label style={{ flex: '1 1 auto' }}>
                  <input
                    type="checkbox"
                    name="parallelEncode"
                    checked={parallelEncode}
                    onChange={e => setParallelEncode(e.target.checked)}
                    disabled={modelSwapBlocked}
                  />
                  {' '}{t('parallelEncode')}
                  <InfoTooltip text={t('tooltipParallelEncode')} />
                </label>
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
                {t('beamWidth')} (1-10):
                <InfoTooltip text={t('tooltipBeamWidth')} />
                {beamWidthAuto && <span className="setting-hint"> {t('beamWidthAutoHint')}</span>}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                max="10"
                value={beamWidth}
                onChange={e=>{
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    // An explicit edit ends the boost-state coupling for good.
                    setBeamWidthAuto(false);
                    setBeamWidth(Math.max(1, Math.min(10, Math.round(v))));
                  }
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

          </CollapsibleSection>

          {/* Benchmark: one click measures every backend/precision this device
              can run on a clip that ships with the app, then builds one
              anonymised report the user can read before copying or sending it.
              Nothing leaves the browser without an explicit action. */}
          <CollapsibleSection id="benchmark" title={t('settingsGroupBenchmark')} open={!!sectionsOpen.benchmark} onToggle={toggleSection}>
            <p style={{ marginTop: 0, fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
              {t('benchmarkIntro')}
            </p>
            <Banner tone="warning" style={{ fontSize: '0.78rem', marginBottom: '0.5rem' }}>
              {t('benchmarkCacheWarning')}
            </Banner>

            <div className="setting-row">
              <span className="setting-label">
                {t('benchmarkCombos')}:
                <InfoTooltip text={t('tooltipBenchmarkCombos')} />
              </span>
              <div className="setting-options">
                {benchmarkPlan.length === 0 && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>{t('benchmarkNoCombos')}</span>
                )}
                {benchmarkPlan.map(row => (
                  <label key={row.id} className={benchmarkRunning ? 'disabled-option' : ''}>
                    <input
                      type="checkbox"
                      name={`benchmark-combo-${row.id}`}
                      checked={!!benchmarkSelected[row.id]}
                      disabled={benchmarkRunning}
                      onChange={e => setBenchmarkSelected(prev => ({ ...prev, [row.id]: e.target.checked }))}
                    />
                    {row.backend === 'wasm' ? t('wasmCpu') : t('webgpu')} / {row.quant}
                    <span style={{ color: 'var(--text-subtle)' }}>
                      {row.cached ? ` (${t('benchmarkAlreadyDownloaded')})` : ` (~${row.downloadMB} MB)`}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="setting-row">
              <label className={benchmarkRunning ? 'disabled-option' : ''}>
                <input
                  type="checkbox"
                  name="benchmarkLongProfile"
                  checked={benchmarkLongProfile}
                  disabled={benchmarkRunning}
                  onChange={e => setBenchmarkLongProfile(e.target.checked)}
                />
                {t('benchmarkLongProfile')}
                <InfoTooltip text={t('tooltipBenchmarkLongProfile')} />
              </label>
            </div>

            <div className="setting-row" style={{ alignItems: 'center', gap: '0.5rem' }}>
              <span className="setting-label" style={{ flex: '1 1 auto' }}>
                {t('benchmarkRepeats')} (1-3):
                <InfoTooltip text={t('tooltipBenchmarkRepeats')} />
              </span>
              <input
                type="number"
                name="benchmarkRepeats"
                inputMode="numeric"
                min="1"
                max="3"
                value={benchmarkRepeats}
                disabled={benchmarkRunning}
                onChange={e => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setBenchmarkRepeats(Math.max(1, Math.min(3, Math.round(v))));
                }}
                style={{ width: '4rem' }}
              />
            </div>

            {(() => {
              const selected = benchmarkPlan.filter(c => benchmarkSelected[c.id]);
              const mb = estimatedDownloadMB(selected, benchmarkPlan.filter(c => c.cached).map(c => c.id));
              return (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', margin: '0.25rem 0 0.5rem' }}>
                  {t('benchmarkEstimatedDownload')}: {mb >= 1000 ? `~${(mb / 1000).toFixed(1)} GB` : `~${mb} MB`}
                </p>
              );
            })()}

            <button
              type="button"
              className="primary"
              style={{ width: '100%' }}
              data-umami-event="benchmark_run"
              disabled={benchmarkRunning || isTranscribing || !benchmarkPlan.some(c => benchmarkSelected[c.id])}
              onClick={runBenchmark}
            >
              {benchmarkRunning ? t('benchmarkRunning') : t('benchmarkRun')}
            </button>
            {benchmarkRunning && (
              <button
                type="button"
                style={{ width: '100%', marginTop: '0.35rem' }}
                onClick={() => { benchmarkCancelRef.current = true; setBenchmarkProgress(t('benchmarkCancelling')); }}
              >
                {t('cancel')}
              </button>
            )}
            {benchmarkProgress && (
              <p className="benchmark-progress" style={{ fontSize: '0.78rem', margin: '0.4rem 0 0' }}>{benchmarkProgress}</p>
            )}

            {benchmarkDone && !benchmarkRunning && (
              <p className="benchmark-complete">{t('benchmarkComplete')}</p>
            )}

            {benchmarkResults.length > 0 && (
              <table className="benchmark-results">
                <thead>
                  <tr>
                    <th>{t('benchmarkColBackend')}</th>
                    <th>{t('benchmarkColProfile')}</th>
                    <th>{t('benchmarkColSpeed')}</th>
                    <th>{t('benchmarkColLoad')}</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmarkResults.map((r, i) => (
                    <tr
                      key={`${r.id}-${r.profile || 'na'}-${i}`}
                      className={r.status === 'pending' || r.status === 'running' ? 'benchmark-row--waiting' : ''}
                      data-testid={`benchmark-row-${r.id}-${r.profile || 'na'}`}
                      data-status={r.status}
                    >
                      <td>{r.backend} / {r.quant}</td>
                      <td>{r.profile || '-'}</td>
                      <td>
                        {/* Speed as AUDIO PER SECOND OF COMPUTE, not the
                            inverse. Both describe the same measurement, but this
                            way round is the one that reads without translation:
                            "6x" means an hour of audio in ten minutes, and
                            bigger is better, which is what every other speed
                            figure in the app already means. The report keeps the
                            conventional rtf (compute per second of audio) so
                            scripts/benchmark-throughput.mjs and older reports
                            stay comparable; the two are reciprocals, so nothing
                            is lost by showing one and storing the other. */}
                        {r.status === 'ok' ? (
                          `${r.rtf > 0 ? `${(1 / r.rtf).toFixed(2)}x` : '-'} (${formatDuration((r.wallMs || 0) / 1000)})`
                        ) : r.status === 'pending' ? (
                          // An em dash would be a value; this is the absence of
                          // one, and it has to stay visibly different from a row
                          // that ran and produced nothing.
                          <span className="benchmark-cell--pending">{t('benchmarkRowPending')}</span>
                        ) : r.status === 'running' ? (
                          <span className="benchmark-cell--running">
                            <span className="spinner spinner--inline" aria-hidden="true" />
                            {r.phase || t('benchmarkTranscribing')}
                          </span>
                        ) : t(`benchmarkStatus_${r.status}`)}
                        {r.status === 'ok' && r.similarity != null && r.similarity < 0.8 && (
                          <span style={{ color: 'var(--danger)' }}> ⚠</span>
                        )}
                      </td>
                      {/* A load time means little on its own: a cold load times a
                          download on this connection, a warm one a cache read plus
                          session build. The GPU rows are always cold, because the
                          fp32 shards cannot be cached. */}
                      <td>
                        {r.loadMs != null ? formatDuration(r.loadMs / 1000)
                          : (r.status === 'pending' || r.status === 'running') ? '' : '-'}
                        {r.loadCached === true && <span className="benchmark-load-note"> ({t('benchmarkLoadCached')})</span>}
                        {r.loadCached === false && r.loadDownloadMB > 0 && (
                          <span className="benchmark-load-note"> ({Math.round(r.loadDownloadMB)} MB)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {benchmarkReport && (
              <div ref={benchmarkReportRef} className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem', marginTop: '0.5rem' }}>
                <span className="setting-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>
                    {t('benchmarkReport')}
                    <InfoTooltip text={t('tooltipBenchmarkReport')} />
                  </span>
                  <button
                    type="button"
                    className="benchmark-report-copy"
                    onClick={copyBenchmarkReport}
                    style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem' }}
                  >
                    {benchmarkCopied ? t('copied') : t('supportReportCopy')}
                  </button>
                </span>
                <textarea
                  className="benchmark-report-text"
                  readOnly
                  value={benchmarkReport}
                  spellCheck={false}
                  wrap="off"
                  aria-label={t('benchmarkReport')}
                  style={{
                    width: '100%',
                    minHeight: '6rem',
                    maxHeight: '11rem',
                    overflow: 'auto',
                    resize: 'vertical',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    fontSize: '0.68rem',
                    lineHeight: 1.35,
                    whiteSpace: 'pre',
                    border: '1px solid var(--border-strong)',
                    borderRadius: '4px',
                    padding: '0.4rem',
                    boxSizing: 'border-box',
                  }}
                />
                {BENCHMARK_UPLOAD_ENABLED && (
                  <>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', margin: 0 }}>
                      {t('benchmarkSendExplainer')}
                    </p>
                    <button
                      type="button"
                      className="primary"
                      data-umami-event="benchmark_send"
                      disabled={benchmarkSendState === 'sending' || benchmarkSendState === 'sent'}
                      onClick={() => sendBenchmarkReport(benchmarkReport)}
                    >
                      {benchmarkSendState === 'sent' ? t('benchmarkSent')
                        : benchmarkSendState === 'sending' ? t('benchmarkSending')
                        : t('benchmarkSend')}
                    </button>
                    {benchmarkSendState === 'failed' && (
                      <p style={{ fontSize: '0.78rem', color: 'var(--danger)', margin: 0 }}>{t('benchmarkSendFailed')}</p>
                    )}
                    <label>
                      <input
                        type="checkbox"
                        name="benchmarkAutoSend"
                        checked={benchmarkAutoSend}
                        onChange={e => setBenchmarkAutoSend(e.target.checked)}
                      />
                      {t('benchmarkAutoSend')}
                      <InfoTooltip text={t('tooltipBenchmarkAutoSend')} />
                    </label>
                  </>
                )}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection id="debug" title={t('settingsGroupDebug')} open={!!sectionsOpen.debug} onToggle={toggleSection}>
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
                style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid var(--border-strong)' }}
              >
                <option value="off">{t('debugOff')}</option>
                <option value="full">{t('debugFullLogs')}</option>
              </select>
            </div>
            <div className="setting-row">
              <label>
                <input
                  type="checkbox"
                  checked={debugDecode}
                  onChange={e => setDebugDecode(e.target.checked)}
                />
                {t('debugDecode')}
                <InfoTooltip text={t('tooltipDebugDecode')} />
              </label>
            </div>
            <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.35rem' }}>
              <span className="setting-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  {t('supportReport')}
                  <InfoTooltip text={t('tooltipSupportReport')} />
                </span>
                <button
                  type="button"
                  className="support-report-copy"
                  onClick={copySupportReport}
                  style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem' }}
                >
                  {supportReportCopied ? t('copied') : t('supportReportCopy')}
                </button>
              </span>
              <textarea
                className="support-report-text"
                readOnly
                value={supportReport}
                spellCheck={false}
                wrap="off"
                aria-label={t('supportReport')}
                style={{
                  width: '100%',
                  minHeight: '6rem',
                  maxHeight: '11rem',
                  overflow: 'auto',
                  resize: 'vertical',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '0.68rem',
                  lineHeight: 1.35,
                  whiteSpace: 'pre',
                  border: '1px solid var(--border-strong)',
                  borderRadius: '4px',
                  padding: '0.4rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </CollapsibleSection>
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
          {statusLine}
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

      {showCaptureControls && (
      <div className="controls">
        {/* The upload / record / phone entry points stay ENABLED while a
            transcription is running: new audio just joins the capture queue
            (drained from runTranscription's finally), so the user can keep
            stacking work instead of waiting for each run. They only lock
            during an active local recording, where a second capture source
            makes no sense. */}
        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_FILE_ACCEPT}
          onChange={transcribeFile}
          disabled={isRecording}
          style={{ display: 'none' }}
          id="audio-file-input"
        />
        <label
          htmlFor="audio-file-input"
          className="file-upload-button"
          style={{
            opacity: isRecording ? 0.5 : 1,
            pointerEvents: isRecording ? 'none' : 'auto',
            flex: 1
          }}
          data-umami-event="upload_file_button"
          title={t('sendMp3Hint')}
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
              disabled={isRemoteMic}
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
              onClick={() => {
                // On a phone/tablet, say what Phone Mic is for before pairing.
                // Acknowledged once, then this is the plain button again.
                if (handheldDevice && !remoteMicHandheldAckRef.current) {
                  setRemoteMicHandheldWarn(true);
                  return;
                }
                startRemoteMic();
              }}
              disabled={isRecording || isRemoteMic}
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

      {statusLine}

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
            ? (() => {
                // Same two transforms the finished transcript gets, so the live
                // preview does not respell itself when the final pass lands.
                const live = numbersToDigits ? numberWordsToDigits(liveTranscript.text, lang) : liveTranscript.text;
                return dictationRegexRules.length > 0 ? applyDictationRegex(live) : live;
              })()
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

      {/* Captures made while the model is loading (Q2) OR while another
          transcription is running are buffered; tell the user they will
          transcribe automatically once the model is free. */}
      {pendingCaptureCount > 0 && (
        <Banner tone="info" style={{ marginTop: '0.5rem', justifyContent: 'center' }}>
          ⏳ {t('capturesQueued').replace('{n}', String(pendingCaptureCount))}
        </Banner>
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

      {/* Warning banner: the GPU backend could not be served by this model source
          (no fp32 shards), so the load fell back to WASM. The app
          works normally after this, hence a warning rather than an error. */}
      {gpuFallbackWarning && (
        <div className="fallback-prompt" style={{ borderColor: '#e8a838' }}>
          <p>⚠ {gpuFallbackWarning}</p>
          <button onClick={() => setGpuFallbackWarning(null)} style={{ marginTop: '0.5em' }}>
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
          <strong>{t('procPerDur')}:</strong> {latestMetrics.procPerDur?.toFixed(2)} &nbsp;|&nbsp; {t('total')}: {(latestMetrics.total_ms / 1000).toFixed(2)} s<br/>
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
              const entryBase = getEntryBase(trans.id);
              const dictateOn = entryDictationOn(trans.id);
              const audioOpen = openAudioIds.has(trans.id);

              return (
                <div className={`history-item${trans.id === newestTranscriptionIdRef.current ? ' history-item-enter' : ''}`} key={trans.id}>
                  <div className="history-meta">
                    <strong>{truncateFilename(trans.filename)}</strong>
                    {showAdvancedInfo && (
                      <span style={{ fontSize: '0.85em', color: 'var(--text-subtle)', marginLeft: '0.5rem' }}>
                        {typeof trans.duration === 'number' && `${formatDuration(trans.duration)} | `}{trans.wordCount} words{trans.metrics && ` | proc_t/dur_t: ${trans.metrics.procPerDur?.toFixed(2)}`}
                      </span>
                    )}
                    {(() => {
                      // Hover the timestamp to see this run's timing breakdown
                      // (encode/decode time, their ratios over the audio
                      // duration, total processing time). Metrics are in-memory
                      // only, so a reloaded entry has none and gets a plain span.
                      const tip = formatMetricsTooltip(trans.metrics, trans.duration, {
                        encode: t('encode'),
                        decode: t('decode'),
                        decodePerDur: t('decodePerDur'),
                        encodeDecodePerDur: t('encodeDecodePerDur'),
                        total: t('total'),
                      });
                      return <span title={tip || undefined} style={tip ? { cursor: 'help' } : undefined}>{trans.timestamp}</span>;
                    })()}
                  </div>

                  {/* Per-entry control row: [Audio][Raw][Dictation?][Speakers?]
                      on the left, always-visible kebab on the right. Raw and
                      Speakers are the structural base view (mutually exclusive);
                      Dictation is an INDEPENDENT toggle that layers on either, so
                      Speakers + Dictation can both be active (cleaned per turn). */}
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
                        onClick={() => setEntryBase(trans.id, 'raw')}
                        className={`display-mode-button${entryBase === 'raw' ? ' active' : ''}`}
                        title="Raw transcription"
                      >
                        {t('raw')}
                      </button>
                      {dictationRegexRules.length > 0 && (
                        <button
                          onClick={() => toggleEntryDictation(trans.id)}
                          className={`display-mode-button${dictateOn ? ' active' : ''}`}
                          aria-pressed={dictateOn}
                          title={`${t('dictationRules')} (${dictationRegexRules.length} ${t('dictationRulesExperimental')})`}
                        >
                          {t('dictationExp')}
                        </button>
                      )}
                      {/* Speakers (diarization): needs word timestamps to run,
                          but a reloaded entry keeps its restored turns, so the
                          button also shows there to reopen the cached view. It
                          is disabled only while diarizing or when there is
                          nothing to show and no PCM to compute from. */}
                      {(trans.words?.length > 0 || hasDiarization(trans)) && (() => {
                        // A fresh run needs the diarization models; reopening an
                        // entry's already-cached turns does not. So a model-load
                        // failure only greys out entries with nothing cached yet.
                        const blockedByModelError = !hasDiarization(trans) && !!diarizationModelError;
                        return (
                        <button
                          onClick={() => {
                            if (blockedByModelError) return;
                            hasDiarization(trans)
                              ? setEntryBase(trans.id, 'diarized')
                              : diarizeEntry(trans);
                          }}
                          // Native `disabled` for the spinner/no-PCM cases. For the
                          // model-load failure use aria-disabled + a greyed class
                          // instead, so pointer events stay on and the title
                          // tooltip (the reason) shows on hover.
                          disabled={diarizingId === trans.id || (!trans.pcm && !hasDiarization(trans))}
                          aria-disabled={blockedByModelError || undefined}
                          className={`display-mode-button${entryBase === 'diarized' ? ' active' : ''}${blockedByModelError ? ' display-mode-button--unavailable' : ''}`}
                          title={blockedByModelError
                            ? `${t('diarizeModelsUnavailable')} (${diarizationModelError})`
                            : t('speakersHint')}
                        >
                          {diarizingId === trans.id && <span className="spinner spinner--inline" aria-hidden="true" />}
                          {t('speakers')}
                          {/* Piecewise diarization reports progress; fold its two
                              phases into one monotonic 0-100% (diarize 0-90%,
                              embed 90-100%) so the number never appears to
                              restart. Short single-run clips report nothing, so
                              this stays hidden and only the spinner shows. */}
                          {diarizingId === trans.id && diarProgress && diarProgress.total > 0 && (
                            <span className="diar-progress">
                              {' '}{diarProgress.phase === 'embed'
                                ? Math.round(90 + (diarProgress.done / diarProgress.total) * 10)
                                : Math.round((diarProgress.done / diarProgress.total) * 90)}%
                            </span>
                          )}
                        </button>
                        );
                      })()}
                      {/* Cancel the in-flight diarization (it runs in a worker, so
                          this button stays clickable and the spinner animates). */}
                      {diarizingId === trans.id && (
                        <button
                          onClick={() => cancelDiarizeEntry(trans)}
                          className="display-mode-button display-mode-button--cancel"
                          title={t('cancelDiarization')}
                        >
                          {t('cancel')}
                        </button>
                      )}
                      {/* Decode-debug view: only offered when the entry carries a
                          debug payload (run with the sidebar checkbox on; the
                          payload is in-memory only, so reloaded entries never
                          have it). */}
                      {trans.decodeDebug && (
                        <button
                          onClick={() => setEntryBase(trans.id, 'debug')}
                          className={`display-mode-button${entryBase === 'debug' ? ' active' : ''}`}
                          title={t('debugModeHint')}
                        >
                          {t('debugMode')}
                        </button>
                      )}
                      {/* Copy sits with the view buttons, not in the kebab: it
                          copies the entry exactly as the buttons to its left
                          render it (base view + dictation layer), so having to
                          open a menu for the most common action was pure
                          friction. Same handler as the old kebab item. */}
                      <button
                        onClick={() => copyHistoryItem(trans)}
                        disabled={anyModalOpen}
                        className="display-mode-button display-mode-button--copy"
                        title={t('copyDisplayedHint')}
                      >
                        {copiedHistoryId === trans.id ? t('copied') : t('copyText')}
                      </button>
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
                          {/* Real-time factor: wall-clock transcribe time vs
                              audio length (lower is faster than real time). */}
                          {typeof trans.rtf === 'number' && (
                            <div className="kebab-info" title={t('rtfHint')}>
                              {t('rtf')}: {trans.rtf.toFixed(2)}×
                            </div>
                          )}
                          {/* "Copy text" moved out to the view-button row above;
                              this one stays because it copies something the
                              buttons cannot show: the dictation-cleaned text
                              while the entry is displayed raw. */}
                          {dictationRegexRules.length > 0 && (
                            <button onClick={async () => {
                              const cleaned = applyDictationRegex(trans.text);
                              try { await navigator.clipboard.writeText(sanitizeClipboardText(cleaned)); setCopiedHistoryId(trans.id); setTimeout(() => setCopiedHistoryId(null), 2000); } catch (e) { console.error('[Copy] Failed:', e); }
                              setOpenKebabId(null);
                            }}>
                              {t('copyDictation')}
                            </button>
                          )}
                          {/* Audio is in-memory only, so both of these are
                              absent on entries restored after a reload. */}
                          {trans.audioBlob && (
                            <button
                              onClick={() => { downloadEntryAudio(trans); setOpenKebabId(null); }}
                              title={t('downloadAudioHint')}
                            >
                              {t('downloadAudio')}
                            </button>
                          )}
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
                          {/* Speaker count for THIS entry: changing it
                              re-segments. Needs the in-memory PCM, so it is
                              absent on entries restored after a reload. The
                              wrapper stops the click from bubbling to the
                              global handler that closes the kebab, so the
                              native select stays open long enough to pick. */}
                          {trans.pcm && trans.words?.length > 0 && (
                            <div className="kebab-speakers" onClick={e => e.stopPropagation()}>
                              <span>{t('numSpeakers')}:</span>
                              <select
                                value={diarizationNumByEntry[trans.id] ?? diarizationNumSpeakers}
                                disabled={!!diarizingId}
                                onChange={e => {
                                  const n = parseInt(e.target.value, 10) || 0;
                                  setDiarizationNumByEntry(prev => ({ ...prev, [trans.id]: n }));
                                  // Re-segmenting redefines the speakers, so drop
                                  // this entry's custom names AND merges (their
                                  // indices no longer mean the same person).
                                  setSpeakerNames(prev => {
                                    if (!prev[trans.id]) return prev;
                                    const next = { ...prev }; delete next[trans.id]; return next;
                                  });
                                  setSpeakerMerges(prev => {
                                    if (!prev[trans.id]) return prev;
                                    const next = { ...prev }; delete next[trans.id]; return next;
                                  });
                                  diarizeEntry(trans, n);
                                  setOpenKebabId(null);
                                }}
                              >
                                <option value="0">{t('auto')}</option>
                                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                                  <option key={n} value={n}>{n}</option>
                                ))}
                              </select>
                            </div>
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
                      {entryBase === 'debug' && trans.decodeDebug
                        ? <DecodeDebugView debug={trans.decodeDebug} t={t} />
                        : entryBase === 'diarized' && hasDiarization(trans)
                        ? renderDiarizedTranscript(trans)
                        /* Raw or dictation-cleaned text */
                        : <span style={{ whiteSpace: 'pre-wrap' }}>{getDisplayText(trans)}</span>}
                    </div>
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
              {/* Escape hatch: mint a brand-new room/QR if the phone can't
                  rejoin the current one (e.g. it reloaded and lost the link). */}
              <button onClick={regenerateRemoteMicQr} style={{
                background: 'transparent', color: 'var(--text-subtle)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', padding: '0.4rem 1rem', cursor: 'pointer',
                fontSize: '0.8rem', display: 'block', margin: '0.75rem auto 0',
              }}>
                {t('remoteMicRegenerateQr')}
              </button>
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
