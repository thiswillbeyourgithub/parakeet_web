import React, { useState, useRef, useEffect, useTransition, useCallback } from 'react';
import { ParakeetModel, getParakeetModel, checkLocalModelFiles, HubDownloadError } from 'parakeet.js';
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
import { clearCache as clearModelCache } from '../../src/hub.js';
import { formatTime } from './lib/format.js';

// Dictation device support (Philips SpeechMike etc.) via WebHID.
// Conditionally imported so the feature can be fully disabled via env var.
const devMode = CONFIG.VITE_DEV_MODE === 'true';
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

// Simple help icon component with click-based tooltip
function InfoTooltip({ text }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const rootRef = React.useRef(null);

  // Prevent the click from bubbling to a wrapping <label>, which would
  // otherwise toggle the associated checkbox/radio input.
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const toggle = (e) => { stop(e); setIsOpen(v => !v); };
  const close = (e) => { stop(e); setIsOpen(false); };

  // Dismiss on any outside interaction (click, touch, scroll, Escape).
  // We listen at the document level instead of rendering a full-viewport
  // overlay so the first click outside lands on its real target (another
  // tooltip, sidebar close button, scrollbar, etc.) instead of being
  // swallowed just to close the popup.
  React.useEffect(() => {
    if (!isOpen) return;
    const onOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    const onScroll = () => setIsOpen(false);
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside, { passive: true });
    document.addEventListener('keydown', onKey);
    // Capture phase so scrolls inside any container also dismiss.
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [isOpen]);

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
        <div className="info-help-text" onClick={stop}>
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
  const { t } = useI18n();
  const repoId = CONFIG.VITE_MODEL_REPO || 'istupakov/parakeet-tdt-0.6b-v3-onnx';
  // Whether the instance can serve model weights locally (under /models/) as
  // a fallback when HuggingFace is blocked or unreachable.
  // When true, always serve weights locally and skip HuggingFace entirely.
  // Useful for troubleshooting the local-fallback path without having to
  // simulate a blocked HF. Implies localFallbackEnabled.
  const forceLocalFallback = CONFIG.VITE_FORCE_LOCAL_MODEL_FALLBACK === 'true';
  const localFallbackEnabled = forceLocalFallback || CONFIG.VITE_LOCAL_MODEL_FALLBACK === 'true';
  // Tracks whether we should show the "HF blocked, try local?" prompt
  const [showFallbackPrompt, setShowFallbackPrompt] = useState(false);
  // Warning message when local fallback is enabled but model files are missing
  const [fallbackWarning, setFallbackWarning] = useState(null);
  const [backend, setBackend] = useState('wasm');
  const [memoryInfo, setMemoryInfo] = useState(null);
  const [, startTransition] = useTransition();
  const [preprocessor, setPreprocessor] = useState('nemo128');
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(null);
  const [text, setText] = useState('');
  const [latestMetrics, setLatestMetrics] = useState(null);
  const [transcriptions, setTranscriptions] = useState([]);
  // Track the most recently added transcription ID for fade-in animation
  const newestTranscriptionIdRef = useRef(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [verboseLog, setVerboseLog] = useState(false);
  const [frameStride, setFrameStride] = useState(1);
  // Decoder temperature: higher = more diverse/noisy, lower = more greedy/confident.
  // Kept tunable in code (still wired through to the backend) but hidden from the
  // sidebar and never loaded from persisted settings: this param is extremely
  // finicky, and any value above 0.0 breaks the model in unpredictable ways.
  // To re-expose it, restore the slider in the sidebar and re-add it to the
  // loadSetting/usePersistedSetting calls below.
  const [temperature, setTemperature] = useState(0.0);
  // Chunking: split long audio into smaller segments before transcribing
  const [enableChunking, setEnableChunking] = useState(true);
  const [chunkDuration, setChunkDuration] = useState(60); // seconds
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
  const maxCores = navigator.hardwareConcurrency || 8;
  // Default to all available CPU cores for best transcription throughput
  const [cpuThreads, setCpuThreads] = useState(maxCores);
  const modelRef = useRef(null);
  const fileInputRef = useRef(null);
  // Ref to access autoTranscribe inside recorder.onstop callback without stale closure
  const autoTranscribeRef = useRef(true);
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false); // pause/resume support for long recordings
  const [recordingCountdown, setRecordingCountdown] = useState(null);
  const [mediaRecorder, setMediaRecorder] = useState(null); // legacy name kept for stopRecording guard
  const pcmChunksRef = useRef([]);       // accumulates Float32Array chunks from AudioWorklet
  // Hard cap on remote-mic PCM sample accumulation. A compromised phone that
  // completes the handshake but never sends `audio-end` would otherwise grow
  // pcmChunksRef without bound and OOM the tab. 10 minutes at the highest
  // accepted sample rate (96 kHz) is the safety ceiling; in normal use the
  // phone streams at 48 kHz so the real-time ceiling is ~20 minutes.
  const REMOTE_MIC_MAX_SAMPLES = 10 * 60 * 96000;
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
  const workletNodeRef = useRef(null);   // AudioWorkletNode for cleanup
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioContext, setAudioContext] = useState(null);
  const [pendingAudioFile, setPendingAudioFile] = useState(null);
  const [audioPreviewUrl, _setAudioPreviewUrlRaw] = useState(null);
  // Always go through this setter — it revokes any previously-active blob URL
  // before swapping in the new one, so they don't accumulate over a session.
  const setAudioPreviewUrl = useCallback((next) => {
    _setAudioPreviewUrlRaw((prev) => {
      if (prev && prev !== next) {
        try { URL.revokeObjectURL(prev); } catch (_) { /* ignore */ }
      }
      return next;
    });
  }, []);
  // Final cleanup when the component unmounts.
  useEffect(() => () => {
    _setAudioPreviewUrlRaw((prev) => {
      if (prev) {
        try { URL.revokeObjectURL(prev); } catch (_) { /* ignore */ }
      }
      return null;
    });
  }, []);
  const [isProcessingPreview, setIsProcessingPreview] = useState(false);
  const [hasBeenTranscribed, setHasBeenTranscribed] = useState(false);
  // True from the moment recording stops until the final transcription is
  // displayed. Keeps the live transcript and a status indicator on screen so
  // the UI never appears to freeze while audio is being assembled / decoded
  // and the model is running its canonical pass.
  const [awaitingFinal, setAwaitingFinal] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(false);
  const [echoCancellation, setEchoCancellation] = useState(false);
  const [autoGainControl, setAutoGainControl] = useState(true);
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
  // Tracks which history item is showing its confidence score overlay
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
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
  // Auto-transcribe: when enabled, transcription starts automatically after recording stops
  const [autoTranscribe, setAutoTranscribe] = useState(true);

  // Dictation device (Philips SpeechMike) — WebHID connection state
  const [dictationDevice, setDictationDevice] = useState(null); // connected device name or null
  const dictationManagerRef = useRef(null);

  // Dictation regex post-processing
  // Display mode: 'raw' = plain transcription, 'confidence' = with heatmap, 'dictation' = regex-cleaned
  const [transcriptDisplayMode, setTranscriptDisplayMode] = useState('raw');
  const [dictationRegexRules, setDictationRegexRules] = useState([]); // [{regex, replacement, source}]
  const [dictationRegexLoaded, setDictationRegexLoaded] = useState(false);
  // Track which transcriptions have had dictation applied (id -> cleaned text)
  const [dictationCache, setDictationCache] = useState({});

  // Load settings from IndexedDB on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        // Check version first - purge old data if version mismatch
        const storedVersion = await loadSetting('version', null);
        
        if (!storedVersion || storedVersion !== VERSION) {
          console.log(`[App] Version mismatch (stored: ${storedVersion}, current: ${VERSION}). Purging old data...`);
          await clearAllSettings();
          await saveSetting('version', VERSION);
          // Set defaults without loading old values
          setSettingsLoaded(true);
          return;
        }
        
        const [
          savedBackend,
          savedPreprocessor,
          savedTranscriptions,
          savedVerboseLog,
          savedFrameStride,
          savedCpuThreads,
          savedNoiseSuppression,
          savedEchoCancellation,
          savedAutoGainControl,
          savedShowConfidenceHeatmap,
          savedAutoTranscribe,
          savedAutoCopyToClipboard,
          savedPersistTranscripts,
          savedShowAdvancedInfo,
          savedEnableChunking,
          savedChunkDuration,
          savedTranscriptDisplayMode,
          savedLiveTranscriptionEnabled,
          savedLiveContextWindow,
        ] = await Promise.all([
          loadSetting('backend', 'wasm'),
          loadSetting('preprocessor', 'nemo128'),
          loadPersistedTranscripts(),
          loadSetting('verboseLog', false),
          loadSetting('frameStride', 1),
          loadSetting('cpuThreads', Math.max(1, maxCores - 2)),
          loadSetting('noiseSuppression', false),
          loadSetting('echoCancellation', false),
          loadSetting('autoGainControl', true),
          loadSetting('showConfidenceHeatmap', false),
          loadSetting('autoTranscribe', true),
          loadSetting('autoCopyToClipboard', false),
          // Migration: load with `null` so we can distinguish "user opted in/out"
          // from "never set, default to false". Resolved below against existing
          // transcript presence so we don't silently delete history of users
          // who upgraded into the post-F-55 build.
          loadSetting('persistTranscripts', null),
          loadSetting('showAdvancedInfo', false),
          loadSetting('enableChunking', true),
          loadSetting('chunkDuration', 60),
          loadSetting('transcriptDisplayMode', 'raw'),
          loadSetting('liveTranscriptionEnabled', false),
          loadSetting('liveContextWindow', 'auto'),
        ]);

        setBackend(savedBackend);
        setPreprocessor(savedPreprocessor);
        setTranscriptions(savedTranscriptions.filter(t => t.text && t.text.trim() !== ''));
        setVerboseLog(savedVerboseLog);
        setFrameStride(savedFrameStride);
        setCpuThreads(savedCpuThreads);
        setNoiseSuppression(savedNoiseSuppression);
        setEchoCancellation(savedEchoCancellation);
        setAutoGainControl(savedAutoGainControl);
        setShowConfidenceHeatmap(savedShowConfidenceHeatmap);
        setAutoTranscribe(savedAutoTranscribe);
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
        setEnableChunking(savedEnableChunking);
        setChunkDuration(savedChunkDuration);
        setTranscriptDisplayMode(savedTranscriptDisplayMode);
        setLiveTranscriptionEnabled(savedLiveTranscriptionEnabled);
        setLiveContextWindow(savedLiveContextWindow);
        setSettingsLoaded(true);
      } catch (e) {
        console.error('Failed to load settings from IndexedDB:', e);
        setSettingsLoaded(true);
      }
    }
    
    loadSettings();
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
    // user's transcript. Revoke the audio preview URL eagerly so the
    // restored page can't replay the recording; then on the matching
    // pageshow event with event.persisted=true, force a full reload so
    // every visit re-asks for mic permission and starts from a blank UI.
    const handlePageHide = (e) => {
      if (e.persisted) {
        setAudioPreviewUrl(null);
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
  }, [setAudioPreviewUrl]);

  // When local fallback is enabled, verify model files are actually present
  // on the server so the admin gets early feedback about misconfiguration.
  useEffect(() => {
    if (!localFallbackEnabled) return;
    checkLocalModelFiles('/models').then((result) => {
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
          if (!status === 'modelReady' && (key === ' ' || key === 'enter')) {
            if ((status === 'failed' || status === 'transcriptionFailed') || status === 'idle') {
              e.preventDefault();
              loadModel();
            }
            break;
          }
          // After model is loaded: R/Space start recording
          e.preventDefault();
          if (status === 'modelReady' && !isTranscribing && !pendingAudioFile) {
            startRecordingCountdown();
          }
          break;

        case 'f':
          // Send a file
          e.preventDefault();
          if (fileInputRef.current && status === 'modelReady' && !isTranscribing && !isRecording && !pendingAudioFile && !isProcessingPreview) {
            fileInputRef.current.click();
          }
          break;

        case 't':
          // Start transcribing
          e.preventDefault();
          if (status === 'modelReady' && !isTranscribing && pendingAudioFile && audioPreviewUrl && !isProcessingPreview && !hasBeenTranscribed) {
            startTranscription();
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [status, isRecording, isPaused, isTranscribing, pendingAudioFile, audioPreviewUrl, isProcessingPreview, hasBeenTranscribed, recordingCountdown]);

  // Monitor memory usage and system strain
  useEffect(() => {
    const info = {};
    let frameRateMonitor = null;
    let lastFrameTime = performance.now();
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    
    const updateMemory = async () => {
      // Device RAM (if available) - shows total device RAM in GB
      if (navigator.deviceMemory) {
        info.deviceRAM = `${navigator.deviceMemory} GB`;
      }
      
      // JS heap usage (Chrome only) - shows current usage
      if (performance.memory) {
        const used = (performance.memory.usedJSHeapSize / 1024 / 1024 / 1024).toFixed(2);
        const limit = (performance.memory.jsHeapSizeLimit / 1024 / 1024 / 1024).toFixed(2);
        info.heapUsed = `${used} GB / ${limit} GB`;
        info.heapPercent = ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1);
      }
      
      // Fallback: Hardware concurrency (CPU cores)
      if (navigator.hardwareConcurrency) {
        info.cpuCores = `${navigator.hardwareConcurrency} cores`;
      }
      
      // Fallback: Storage quota (shows available disk space for browser)
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
      
      setMemoryInfo(Object.keys(info).length > 0 ? { ...info } : null);
    };
    
    // Frame rate monitoring (fallback for detecting system strain)
    const monitorFrameRate = () => {
      const now = performance.now();
      frameCount++;
      
      // Update FPS every second
      if (now - lastFpsUpdate >= 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
        info.fps = `${fps} fps`;
        
        // Add warning if FPS is low (indicates system strain)
        if (fps < 30) {
          info.fpsWarning = '⚠️ Low FPS';
        } else {
          delete info.fpsWarning;
        }
        
        frameCount = 0;
        lastFpsUpdate = now;
        setMemoryInfo({ ...info });
      }
      
      lastFrameTime = now;
      frameRateMonitor = requestAnimationFrame(monitorFrameRate);
    };
    
    // Start monitoring
    updateMemory();
    const interval = setInterval(updateMemory, 3000); // Update every 3 seconds
    
    // Only monitor FPS if standard memory APIs aren't available (reduces overhead)
    if (!navigator.deviceMemory && !performance.memory) {
      frameRateMonitor = requestAnimationFrame(monitorFrameRate);
    }
    
    return () => {
      clearInterval(interval);
      if (frameRateMonitor) {
        cancelAnimationFrame(frameRateMonitor);
      }
    };
  }, []);

  // Keepalive while recording or transcribing: prevents background-tab JS
  // throttling (silent audio trick) and keeps the screen on (wake lock).
  useEffect(() => {
    if (!isRecording && !isTranscribing && !isRemoteMic) return;
    acquireKeepalive();
    return () => releaseKeepalive();
  }, [isRecording, isTranscribing, isRemoteMic]);

  // Persist backend selection
  useEffect(() => {
    if (!settingsLoaded) return;
    saveSetting('backend', backend);
  }, [backend, settingsLoaded]);

  // Save settings to IndexedDB whenever they change (only after initial load).
  // usePersistedSetting (defined at module scope below) is a thin wrapper
  // around useEffect that fires once per setting, only after `loaded`
  // flips to true. Keeping the hook-call list flat (one per setting)
  // preserves the previous behavior: changing setting X writes only X,
  // not all eighteen of them.
  usePersistedSetting('preprocessor', preprocessor, settingsLoaded);
  usePersistedSetting('verboseLog', verboseLog, settingsLoaded);
  usePersistedSetting('frameStride', frameStride, settingsLoaded);
  usePersistedSetting('cpuThreads', cpuThreads, settingsLoaded);
  usePersistedSetting('noiseSuppression', noiseSuppression, settingsLoaded);
  usePersistedSetting('echoCancellation', echoCancellation, settingsLoaded);
  usePersistedSetting('autoGainControl', autoGainControl, settingsLoaded);
  usePersistedSetting('showConfidenceHeatmap', showConfidenceHeatmap, settingsLoaded);
  usePersistedSetting('autoTranscribe', autoTranscribe, settingsLoaded);
  usePersistedSetting('autoCopyToClipboard', autoCopyToClipboard, settingsLoaded);
  usePersistedSetting('persistTranscripts', persistTranscripts, settingsLoaded);
  usePersistedSetting('enableChunking', enableChunking, settingsLoaded);
  usePersistedSetting('chunkDuration', chunkDuration, settingsLoaded);
  usePersistedSetting('transcriptDisplayMode', transcriptDisplayMode, settingsLoaded);
  usePersistedSetting('liveTranscriptionEnabled', liveTranscriptionEnabled, settingsLoaded);
  usePersistedSetting('liveContextWindow', liveContextWindow, settingsLoaded);
  // F-128: transcripts persist to a dedicated DB (parakeetweb-transcripts-db).
  // When the array shrinks (per-entry delete, clear-all), wipe the whole DB
  // before re-persisting so LevelDB drops the SST/log files that still hold
  // the prior longer array. Append-only growth uses a plain idbPut.
  const prevTranscriptsLenRef = useRef(transcriptions.length);
  useEffect(() => {
    if (!settingsLoaded || !persistTranscripts) {
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
  // Keep ref in sync so recorder.onstop callback always reads the latest value
  useEffect(() => { autoTranscribeRef.current = autoTranscribe; }, [autoTranscribe]);
  useEffect(() => { liveTranscriptionEnabledRef.current = liveTranscriptionEnabled; }, [liveTranscriptionEnabled]);
  useEffect(() => { liveContextWindowRef.current = liveContextWindow; }, [liveContextWindow]);

  /**
   * Load model weights and create an ONNX inference session.
   * @param {Object} [opts]
   * @param {boolean} [opts.useLocalFallback=false] When true, download weights
   *   from this instance (/models/) instead of HuggingFace.
   */
  async function loadModel({ useLocalFallback = forceLocalFallback } = {}) {
    // Clean up existing model first
    if (modelRef.current) {
      console.log('[App] Disposing existing model before loading new one...');
      modelRef.current.dispose();
      modelRef.current = null;
    }

    setShowFallbackPrompt(false);
    setStatus('loadingModel');
    setProgress('');
    setProgressText('');
    setProgressPct(0);
    console.time('LoadModel');

    try {
      const progressCallback = ({ loaded, total, file, resumed }) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        const prefix = resumed ? `${t('resuming')} ` : '';
        setProgressText(`${prefix}${file}: ${pct}%`);
        setProgressPct(pct);
      };

      // 1. Download all model files (from HF or local fallback).
      // Pass `backend` so hub.js can pick the right encoder quant: WebGPU
      // forces fp32 (~2.4 GB, no int8 support on the GPU EP), while WASM
      // can use the int8 encoder (~600 MB) and stays under Chromium's
      // ~2 GB blob URL fetch limit.
      const downloadOpts = {
        encoderQuant: 'int8',
        decoderQuant: 'int8',
        preprocessor,
        backend,
        progress: progressCallback,
      };
      // Operator-level override of the model revision pin. If unset, hub.js
      // falls back to the per-model revision baked into models.js, which
      // defaults to 'main' (with a loud warning) until the operator runs
      // scripts/pin-model.sh to pin a commit SHA + per-file hashes.
      if (CONFIG.VITE_MODEL_REVISION) {
        downloadOpts.revision = CONFIG.VITE_MODEL_REVISION;
      }
      if (useLocalFallback) {
        // Serve weights from this instance under /models/<repoId>/
        downloadOpts.localFallbackBaseUrl = '/models';
        console.log('[App] Using local fallback for model download');
      }
      const modelUrls = await getParakeetModel(repoId, downloadOpts);

      // Show compiling sessions stage
      setStatus('creatingSessions');
      setProgressText(t('compilingModel'));
      setProgressPct(null);

      // 2. Create the model instance with all file URLs
      // Determine mel bin count from model config (nemo128 → 128, nemo80 → 80)
      const nMels = modelUrls.modelConfig?.featuresSize || 128;
      modelRef.current = await ParakeetModel.fromUrls({
        ...modelUrls.urls,
        filenames: modelUrls.filenames,
        backend,
        verbose: verboseLog,
        cpuThreads,
        preprocessorBackend: modelUrls.preprocessorBackend,
        nMels,
      });

      console.timeEnd('LoadModel');
      setStatus('modelReady');
      setProgressText('');
      setProgressPct(null);
    } catch (e) {
      console.error(e);
      // If HuggingFace is blocked and local fallback is available, prompt the user
      if (e instanceof HubDownloadError && localFallbackEnabled && !useLocalFallback) {
        setStatus('hfUnreachable');
        setProgressText('');
        setProgressPct(null);
        setShowFallbackPrompt(true);
      } else {
        setStatus('failed');
        setProgress('');
      }
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
      workletNode.port.onmessage = (e) => {
        pcmChunksRef.current.push(e.data); // Float32Array, 128 samples each
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

    // Concatenate PCM chunks captured by the AudioWorklet into one buffer
    const chunks = pcmChunksRef.current;
    clearPcmChunks();
    const totalSamples = chunks.reduce((n, c) => n + c.length, 0);
    const rawPcm = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      rawPcm.set(chunk, offset);
      offset += chunk.length;
    }
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

    // Build a WAV file from the 16kHz PCM — used for both preview and transcription
    const wavBlob = createWavBlob(pcm16k, targetSampleRate);
    const file = new File([wavBlob], `recording-${Date.now()}.wav`, { type: 'audio/wav' });

    // Preview
    setPendingAudioFile(file);
    const previewUrl = URL.createObjectURL(wavBlob);
    setAudioPreviewUrl(previewUrl);
    setStatus('modelReady');

    setHasBeenTranscribed(false);

    // Auto-transcribe if enabled
    if (autoTranscribeRef.current && modelRef.current) {
      console.log('[Record] Auto-transcribing...');
      processAudioFile(file).then(() => {
        setHasBeenTranscribed(true);
      });
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
              if (remoteMicKeyRef.current || remoteMicVerifyResolveRef.current) {
                console.warn('[RemoteMic] Ignoring duplicate sender-public-key — handshake already bound or in-flight');
                return;
              }
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
              setRemoteMicVerifiedAt(Date.now());
              setRemoteMicStatus('connected');
              setRemoteMicModal(false); // close setup modal; use main UI from here
              setRemoteMicPaused(false);
              setIsRemoteMic(true);

              startRemoteMicTimer();
            } else if (msg.type === 'verify-ok') {
              // F-63: phone confirmed its end. Resolve the peer-ack wait
              // so this side can bind the shared key. A stray verify-ok
              // outside an in-flight wait is ignored (it would indicate
              // protocol drift or a replay attempt by the phone).
              if (remoteMicPeerAckResolveRef.current) {
                remoteMicPeerAckResolveRef.current(true);
              } else {
                console.warn('[RemoteMic] Stray verify-ok ignored (no peer-ack wait in flight)');
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
              remoteMicAudioConfiguredRef.current = true;
              remoteMicSampleRateRef.current = sr;
              console.log(`[RemoteMic] Phone sample rate: ${sr}Hz`);
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
          // (with autoTranscribe on) reach the model on the next
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
            const float32 = new Float32Array(decrypted);
            // Single pass: validate finiteness and accumulate the RMS. AES-GCM
            // authenticates the bytes but a peer holding the legitimate key
            // can still encrypt arbitrary 4-byte patterns; NaN/Infinity would
            // otherwise propagate into the level meter, the resampler, and
            // the model input, silently corrupting the user's transcript.
            let sum = 0;
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
            pcmChunksRef.current.push(float32);
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

    const chunks = pcmChunksRef.current;
    clearPcmChunks();
    const totalSamples = chunks.reduce((n, c) => n + c.length, 0);

    if (totalSamples === 0) {
      console.log('[RemoteMic] No audio received in this batch');
      // Nothing to transcribe, so processAudioFile will not run and clear
      // the awaiting flag for us.
      setAwaitingFinal(false);
      return;
    }

    const rawPcm = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      rawPcm.set(chunk, offset);
      offset += chunk.length;
    }

    const sourceSampleRate = remoteMicSampleRateRef.current;
    console.log(`[RemoteMic] Captured ${totalSamples} samples at ${sourceSampleRate}Hz (${(totalSamples / sourceSampleRate).toFixed(2)}s)`);

    // Resample to 16kHz if needed
    const targetSampleRate = 16000;
    const pcm16k = await resamplePcmTo16k(rawPcm, sourceSampleRate);
    console.log(`[RemoteMic] Final: ${pcm16k.length} samples at 16kHz (${(pcm16k.length / 16000).toFixed(2)}s)`);

    // Build WAV and feed to existing pipeline
    const wavBlob = createWavBlob(pcm16k, targetSampleRate);
    const file = new File([wavBlob], `remote-mic-${Date.now()}.wav`, { type: 'audio/wav' });

    setPendingAudioFile(file);
    const previewUrl = URL.createObjectURL(wavBlob);
    setAudioPreviewUrl(previewUrl);
    setStatus('modelReady');
    setHasBeenTranscribed(false);

    // Auto-transcribe if enabled
    if (autoTranscribeRef.current && modelRef.current) {
      console.log('[RemoteMic] Auto-transcribing...');
      processAudioFile(file).then(() => {
        setHasBeenTranscribed(true);
      });
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

  // User-triggered: opens the WebHID picker to pair a new device
  async function connectDictationDevice() {
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

  // Helper function to resample audio to 16kHz mono and create a WAV blob for preview
  async function resampleToPreview(file) {
    console.log(`[Preview] Resampling "${file.name}" to 16kHz mono...`);
    
    const buf = await file.arrayBuffer();
    
    // Decode at native sample rate
    const audioCtx = new AudioContext();
    const decoded = await audioCtx.decodeAudioData(buf);
    
    // Resample to 16kHz mono using OfflineAudioContext
    const targetSampleRate = 16000;
    const offlineCtx = new OfflineAudioContext(
      1,  // mono
      Math.ceil(decoded.duration * targetSampleRate),
      targetSampleRate
    );
    
    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineCtx.destination);
    source.start();
    
    const resampled = await offlineCtx.startRendering();
    
    // Create WAV file from the resampled audio
    const pcm = resampled.getChannelData(0);
    const wavBlob = createWavBlob(pcm, targetSampleRate);
    
    console.log(`[Preview] Resampled to 16kHz mono (${(pcm.length / targetSampleRate).toFixed(2)}s)`);
    
    return wavBlob;
  }

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

    try {
      console.log(`[Transcribe] Starting transcription for file: "${file.name}"`);
      console.log(`[Transcribe] File details:`, {
        name: file.name,
        type: file.type,
        size: `${(file.size / 1024).toFixed(2)} KB`,
        lastModified: new Date(file.lastModified).toISOString()
      });

      console.log(`[Transcribe] Reading file as ArrayBuffer...`);
      const buf = await file.arrayBuffer();
      console.log(`[Transcribe] ArrayBuffer loaded, size: ${buf.byteLength} bytes`);

      console.log(`[Transcribe] Creating AudioContext at native sample rate...`);
      const audioCtx = new AudioContext();  // Use native rate
      console.log(`[Transcribe] AudioContext created:`, {
        sampleRate: audioCtx.sampleRate,
        state: audioCtx.state,
        baseLatency: audioCtx.baseLatency
      });

      console.log(`[Transcribe] Decoding audio data...`);
      const decoded = await audioCtx.decodeAudioData(buf);
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
      
      const offlineCtx = new OfflineAudioContext(
        1,  // mono
        Math.ceil(decoded.duration * targetSampleRate),
        targetSampleRate
      );
      
      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(offlineCtx.destination);
      source.start();
      
      const resampled = await offlineCtx.startRendering();
      
      // Yield to UI after heavy resampling operation
      await new Promise(resolve => setTimeout(resolve, 0));
      
      const pcm = resampled.getChannelData(0);

      console.log(`[Transcribe] Resampled successfully to ${targetSampleRate}Hz`);
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
        samplesPerSecond: decoded.sampleRate,
        min: minVal,
        max: maxVal,
        note: pcm.length > 10000 ? '(min/max from first 10k samples)' : undefined
      });

      // Chunk large audio files to avoid "too many function arguments" error
      // This happens when audio is very long and internal operations hit JS engine limits
      // Chunking can be toggled off to send full audio to the model in one pass
      const MAX_CHUNK_DURATION = chunkDuration; // seconds (user-configurable)
      const MAX_CHUNK_SAMPLES = MAX_CHUNK_DURATION * 16000;

      let res;
      if (enableChunking && pcm.length > MAX_CHUNK_SAMPLES) {
        console.log(`[Transcribe] Audio is long (${(pcm.length / 16000).toFixed(1)}s), processing in chunks...`);
        
        // Process in chunks with overlap for better boundary handling
        const OVERLAP_DURATION = 2; // seconds of overlap
        const OVERLAP_SAMPLES = OVERLAP_DURATION * 16000;
        const chunks = [];
        let lastReportedProgress = -1; // Track last reported progress to update UI only every 1%
        
        for (let start = 0; start < pcm.length; start += MAX_CHUNK_SAMPLES - OVERLAP_SAMPLES) {
          const end = Math.min(start + MAX_CHUNK_SAMPLES, pcm.length);
          const chunk = pcm.slice(start, end);
          const chunkNum = chunks.length + 1;
          const totalChunks = Math.ceil(pcm.length / (MAX_CHUNK_SAMPLES - OVERLAP_SAMPLES));
          
          console.log(`[Transcribe] Processing chunk ${chunkNum}/${totalChunks} (${(start/16000).toFixed(1)}s - ${(end/16000).toFixed(1)}s)`);
          
          const chunkStartTime = performance.now();
          console.time(`Transcribe-chunk-${chunkNum}`);
          const chunkRes = await modelRef.current.transcribe(chunk, 16000, {
            returnTimestamps: true,
            returnConfidences: true,
            frameStride,
            temperature
          });
          console.timeEnd(`Transcribe-chunk-${chunkNum}`);
          const chunkElapsed = performance.now() - chunkStartTime;
          
          // Adjust timestamps by chunk offset
          const timeOffset = start / 16000;
          if (chunkRes.words) {
            chunkRes.words.forEach(word => {
              word.start_time += timeOffset;
              word.end_time += timeOffset;
            });
          }
          
          chunks.push({
            text: chunkRes.utterance_text,
            words: chunkRes.words || [],
            metrics: chunkRes.metrics,
            timeOffset,
            processingTime: chunkElapsed
          });
          
          // Calculate current progress percentage
          const chunkProgress = Math.round((chunkNum / totalChunks) * 100);
          
          // Only update UI if progress increased by at least 1% or it's the last chunk
          if (chunkProgress > lastReportedProgress || chunkNum === totalChunks) {
            lastReportedProgress = chunkProgress;
            
            // Update text field with accumulated chunk texts
            const partialText = chunks.map(c => c.text).join(' ');
            
            // Update progress bar and status text with timing info
            const avgChunkTime = chunks.reduce((sum, c) => sum + (c.processingTime || 0), 0) / chunks.length;
            const remainingChunks = totalChunks - chunkNum;
            const estimatedRemaining = (remainingChunks * avgChunkTime / 1000).toFixed(1);
            
            // Wrap UI updates in startTransition to keep UI responsive
            startTransition(() => {
              setText(partialText + ' [transcribing...]');
              setProgressPct(chunkProgress);
              setProgressText(`✓ Completed chunk ${chunkNum} of ${totalChunks} (${chunkProgress}%) • ${(chunkElapsed/1000).toFixed(1)}s • Est. ${estimatedRemaining}s remaining`);
              setStatus(`${t('transcribingFile')} "${safeName}" - ${chunkProgress}% ${t('complete')} (${t('chunk')} ${chunkNum}/${totalChunks})`);
              
              if (chunkNum === 1) {
                setLatestMetrics(chunkRes.metrics);
              }
            });
            
            // Yield to browser to keep UI responsive
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }
        
        // Combine chunks and remove the "[transcribing...]" placeholder
        console.log(`[Transcribe] Combining ${chunks.length} chunks...`);
        const combinedText = chunks.map(c => c.text).join(' ');
        const combinedWords = chunks.flatMap(c => c.words);
        
        // Clear progress indicators
        setProgressPct(null);
        setProgressText('');
        
        // Combine metrics (use first chunk's metrics as baseline)
        const totalDuration = pcm.length / 16000;
        const totalProcessingTime = chunks.reduce((sum, c) => sum + (c.metrics?.total_ms || 0), 0);
        
        res = {
          utterance_text: combinedText,
          words: combinedWords,
          confidence_scores: chunks[0]?.confidence_scores || {},
          metrics: {
            ...chunks[0]?.metrics,
            total_ms: totalProcessingTime,
            rtf: totalDuration / (totalProcessingTime / 1000)
          },
          is_final: true
        };
        
        console.log(`[Transcribe] Chunked transcription completed successfully`);
      } else {
        console.log(`[Transcribe] Starting model.transcribe() with options:`, {
          returnTimestamps: true,
          returnConfidences: true,
          frameStride
        });
        console.time(`Transcribe-${file.name}`);
        res = await modelRef.current.transcribe(pcm, 16000, {
          returnTimestamps: true,
          returnConfidences: true,
          frameStride
        });
        console.timeEnd(`Transcribe-${file.name}`);
        console.log(`[Transcribe] Transcription completed successfully`);
      }

      setLatestMetrics(res.metrics);
      // Add to transcriptions list
      const newTranscription = {
        id: Date.now(),
        filename: safeName,
        text: res.utterance_text,
        timestamp: new Date().toLocaleTimeString(),
        duration: audioDuration, // original duration (without padding)
        wordCount: res.words?.length || 0,
        confidence: res.confidence_scores?.token_avg ?? res.confidence_scores?.word_avg ?? null,
        metrics: res.metrics,
        words: res.words || [] // Store word-level data with confidence scores
      };

      newestTranscriptionIdRef.current = newTranscription.id;
      setTranscriptions(prev => [newTranscription, ...prev]);
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
      
      // Log full error details for debugging
      console.error('[Transcribe] Error details:', {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        type: typeof error,
        errorObject: error
      });
      
      setStatus('transcriptionFailed');
      
      // Handle cases where error.message might be undefined
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
      
      // Include stack trace in alert for better debugging
      const detailedMsg = error?.stack 
        ? `${errorMsg}\n\nCheck console for full error details and stack trace.`
        : errorMsg;
      
      // F-124: file.name is OS-controlled and can contain bidi-override or
      // control codepoints. Run through sanitizeDeviceName which already
      // strips C0/C1 + bidi and length-caps to 64 chars.
      alert(`Failed to transcribe "${safeName}": ${detailedMsg}`);
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
    
    // Store the file for later transcription
    setPendingAudioFile(file);
    setHasBeenTranscribed(false);
    
    // Process the audio to show what the model will hear (16kHz mono)
    setIsProcessingPreview(true);
    setStatus('processingPreview');
    
    try {
      const resampledBlob = await resampleToPreview(file);
      const previewUrl = URL.createObjectURL(resampledBlob);
      setAudioPreviewUrl(previewUrl);
      setStatus('modelReady');
    } catch (err) {
      console.error('[Preview] Failed to process audio:', err);
      // Fallback to original file if processing fails
      setAudioPreviewUrl(URL.createObjectURL(file));
      setStatus('modelReady');
    } finally {
      setIsProcessingPreview(false);
    }
    
    // Clear the file input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // Always transcribe uploaded files immediately — unlike recordings,
    // there's no separate trigger to start transcription for file uploads.
    await processAudioFile(file);
    setHasBeenTranscribed(true);
  }

  function clearPendingAudio() {
    setPendingAudioFile(null);
    setAudioPreviewUrl(null); // setter revokes the previous blob URL
    setHasBeenTranscribed(false);
    setIsProcessingPreview(false);
    // The user threw away the just-recorded audio, so there is nothing
    // left to wait for. Hide the live transcript / "awaiting" UI.
    setAwaitingFinal(false);
    setLiveTranscript({ text: '', words: [] });
  }

  async function startTranscription() {
    if (!pendingAudioFile) return;
    
    await processAudioFile(pendingAudioFile);
    
    // Mark as transcribed but keep the audio in the player
    setHasBeenTranscribed(true);
  }

  function clearTranscriptions() {
    setTranscriptions([]);
    setText('');
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
  }

  // Load dictation regex rules from CSV files served at /dictation-regex/
  useEffect(() => {
    // F-102: cap dictation file size so a poisoned upstream that fed the
    // entrypoint a multi-GB body cannot OOM the tab via .text(). The
    // entrypoint applies the same cap server-side (defense in depth);
    // this enforces it again client-side because the entrypoint cap can
    // be bypassed by a host-side write to /var/regex/. Cap is two orders
    // of magnitude above the legitimate ~30 KB Murmure CSV.
    const DICTATION_MAX_BYTES = 5 * 1024 * 1024;
    async function fetchTextCapped(url) {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, status: res.status };
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > DICTATION_MAX_BYTES) {
        try { res.body?.cancel(); } catch (_) { /* noop */ }
        return { ok: false, oversize: true, declared };
      }
      const reader = res.body?.getReader();
      if (!reader) {
        const text = await res.text();
        if (text.length > DICTATION_MAX_BYTES) {
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
        if (total > DICTATION_MAX_BYTES) {
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

  // Build dictation cache lazily via useEffect to avoid setState during render
  useEffect(() => {
    if (transcriptDisplayMode !== 'dictation' || !dictationRegexRules.length) return;
    const missing = transcriptions.filter(t => t.text && !dictationCache[t.id]);
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
  }, [transcriptDisplayMode, dictationRegexRules, transcriptions]);

  // Get the display text for a transcription based on current display mode
  function getDisplayText(trans) {
    if (transcriptDisplayMode === 'dictation' && dictationRegexRules.length > 0) {
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

  // Low-RAM / mobile warning banner — dismissed per session via sessionStorage.
  // Triggers when JS heap limit is below 3 GB (the model needs ~100-200 MB plus runtime overhead).
  // Falls back to navigator.deviceMemory (Chrome/Edge) or mobile UA sniffing when heap info
  // is unavailable. Stores detected RAM info for display in the banner text.
  const RAM_THRESHOLD_GB = 3;
  const RAM_THRESHOLD_BYTES = RAM_THRESHOLD_GB * 1024 * 1024 * 1024;
  // Detection result computed once during the initial useState callback —
  // stashed on a ref instead of useState because we cannot call another
  // setter during a useState initializer.
  const _lowRamDetectedRef = useRef(null);
  const [lowRamInfo, setLowRamInfo] = useState(null); // { detectedGB, source }
  const [showLowRamBanner, setShowLowRamBanner] = useState(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('parakeetweb_lowram_dismissed')) return false;
    // Chrome exposes JS heap size limit — most reliable signal
    const heapLimit = performance?.memory?.jsHeapSizeLimit;
    if (heapLimit !== undefined) {
      const detectedGB = (heapLimit / 1024 / 1024 / 1024).toFixed(1);
      _lowRamDetectedRef.current = { detectedGB, source: 'heap limit' };
      return heapLimit < RAM_THRESHOLD_BYTES;
    }
    // Chrome/Edge expose device RAM in GB
    const mem = navigator.deviceMemory;
    if (mem !== undefined) {
      _lowRamDetectedRef.current = { detectedGB: String(mem), source: 'device memory' };
      return mem < RAM_THRESHOLD_GB;
    }
    // Fallback: assume mobile devices are memory-constrained
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      _lowRamDetectedRef.current = { detectedGB: '?', source: 'mobile device' };
      return true;
    }
    return false;
  });

  // Promote the ref-stashed detection result into state once mounted.
  useEffect(() => {
    if (_lowRamDetectedRef.current) {
      setLowRamInfo(_lowRamDetectedRef.current);
      _lowRamDetectedRef.current = null;
    }
  }, []);

  const dismissLowRamBanner = () => {
    sessionStorage.setItem('parakeetweb_lowram_dismissed', '1');
    setShowLowRamBanner(false);
  };

  return (
    <div className="app">
      {devMode && (
        <Banner tone="danger" style={{ fontWeight: 'bold', textAlign: 'center', marginBottom: '1rem' }}>
          {t('devModeBanner')}
        </Banner>
      )}
      {showLowRamBanner && (
        <Banner tone="warning">
          <span>{t('lowRamWarning')}{lowRamInfo ? ` (detected: ${lowRamInfo.detectedGB} GB ${lowRamInfo.source}, threshold: ${RAM_THRESHOLD_GB} GB)` : ''}{t('lowRamModelMayFail')}</span>
          <button onClick={dismissLowRamBanner} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', marginLeft: 'auto', color: 'inherit' }} aria-label={t('dismiss')}>×</button>
        </Banner>
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
          {(status === 'loadingModel' || isTranscribing || isProcessingPreview || isRecording || (isRemoteMic && remoteMicRecording) || recordingCountdown !== null || awaitingFinal) && (
            <span className="spinner spinner--inline" aria-hidden="true" />
          )}
          {t('status')}: {t(status) || status}
        </p>
      </div>

      {/* About modal */}
      {showAbout && (
        <Modal onClose={() => setShowAbout(false)}>
          <h3 style={{ marginTop: 0 }}>{t('aboutTitle')} <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>v{VERSION}</span></h3>
          <p style={{ fontSize: '1.1rem', fontWeight: 'bold', textAlign: 'center', margin: '0.5rem 0 1rem', color: 'var(--accent)' }}>
            🔒 {t('tagline')}
          </p>
          <p style={{ textAlign: 'center', fontSize: '0.95rem', marginBottom: '1rem', color: 'var(--text-muted)' }}>
            {t('privacyEmphasis')}
          </p>
          <h4 style={{ marginBottom: '0.5rem' }}>{t('whatIsThis')}</h4>
          <p>{t('infoDescription1')}</p>
          <p>{t('infoDescription2')}</p>
          <p style={{ fontSize: '0.85rem', marginTop: '1rem', marginBottom: 0 }}>
            <strong>{t('sourceCode')}:</strong>{' '}
            <a href="https://github.com/thiswillbeyourgithub/parakeet_web" target="_blank" rel="noopener noreferrer">ParakeetWeb</a>
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
                <input type="checkbox" checked={autoTranscribe} onChange={e => setAutoTranscribe(e.target.checked)} />
                {t('autoTranscribeAfterRecording')}
                <InfoTooltip text={t('tooltipAutoTranscribe')} />
              </label>
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

            <div className="settings-group-header">{t('settingsGroupAdvanced')}</div>

            <div className="setting-row">
              <span className="setting-label">
                {t('backend')}:
                <InfoTooltip text={t('tooltipBackend')} />
              </span>
              <div className="setting-options">
                <label className={status === 'modelReady' ? 'disabled-option' : ''}>
                  <input type="radio" name="backend" value="wasm" checked={backend === 'wasm'} onChange={e => setBackend(e.target.value)} disabled={status === 'modelReady'} />
                  {t('wasmCpu')}
                </label>
                <label className={status === 'modelReady' ? 'disabled-option' : ''}>
                  <input type="radio" name="backend" value="webgpu-hybrid" checked={backend === 'webgpu-hybrid'} onChange={e => setBackend(e.target.value)} disabled={status === 'modelReady'} />
                  {t('webgpu')}
                </label>
              </div>
            </div>

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

            {/* Temperature slider intentionally hidden: the param is extremely
                finicky and any value above 0.0 breaks the model in unpredictable
                ways. Still wired up in code via the `temperature` state (default
                0.0) so it can be re-added here without other plumbing. */}

            <div className="settings-group-header">{t('settingsGroupDebug')}</div>

            <div className="setting-row">
              <label>
                <input type="checkbox" checked={showAdvancedInfo} onChange={e => { setShowAdvancedInfo(e.target.checked); saveSetting('showAdvancedInfo', e.target.checked); }} />
                {t('displayMoreDetails')}
                <InfoTooltip text={t('tooltipAdvancedInfo')} />
              </label>
            </div>

            <div className="setting-row">
              <label>
                <input type="checkbox" checked={verboseLog} onChange={e => setVerboseLog(e.target.checked)} />
                {t('maxDebugVerbosity')}
                <InfoTooltip text={t('tooltipVerboseLog')} />
              </label>
            </div>
          </div>
        
          {/* Dictation device (SpeechMike) connect button — only shown when
              the feature is enabled and WebHID is available in this browser. */}
          {dictationEnabled && typeof navigator !== 'undefined' && navigator.hid && (
            <div className="setting-row" style={{ marginTop: '1rem' }}>
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
            onClick={() => setShowShortcuts(prev => !prev)}
            style={{ marginTop: '0.5rem', width: '100%' }}
            className="primary"
          >
            {showShortcuts ? t('hideKeyboardShortcuts') : t('showKeyboardShortcuts')}
          </button>

          {showShortcuts && (
            <div style={{
              marginTop: '0.5rem',
              padding: '0.75rem',
              background: '#f9fafb',
              borderRadius: '4px',
              border: '1px solid #e5e7eb',
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
                    ['T', t('shortcutTranscribe')],
                    ['L', t('shortcutLoadModel')],
                  ].map(([key, desc]) => (
                    <tr key={key}>
                      <td style={{ padding: '0.15rem 0.5rem 0.15rem 0', fontWeight: 'bold', fontFamily: 'monospace' }}>{key}</td>
                      <td style={{ padding: '0.15rem 0' }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#888' }}>
                {t('shortcutsDisabledInInputs')}
              </p>
            </div>
          )}
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
          <p style={{ fontSize: '0.85rem', textAlign: 'center', margin: '0 0 1rem', color: 'var(--text-muted)' }}>
            {t('privacyEmphasis')}
          </p>
          <button
            onClick={loadModel}
            className="primary"
            style={{ marginBottom: '1rem', width: '100%' }}
            data-umami-event="load_model_button"
          >
            {t('loadModel')}
          </button>
        </>
      )}

      {/* Controls, transcribe button, and transcription history: hidden until model loading has been initiated */}
      {status !== 'idle' && !(status === 'failed' || status === 'transcriptionFailed') && (<>
      {typeof SharedArrayBuffer === 'undefined' && backend === 'wasm' && (
        <Banner tone="warning">{t('sharedArrayBufferWarning')}</Banner>
      )}

      <div className="controls">
        <input 
          ref={fileInputRef}
          type="file" 
          accept="audio/*" 
          onChange={transcribeFile} 
          disabled={!status === 'modelReady' || isTranscribing || isRecording || isProcessingPreview}
          style={{ display: 'none' }}
          id="audio-file-input"
        />
        <label 
          htmlFor="audio-file-input"
          className="file-upload-button"
          style={{
            opacity: (!status === 'modelReady' || isTranscribing || isRecording || isProcessingPreview) ? 0.5 : 1,
            pointerEvents: (!status === 'modelReady' || isTranscribing || isRecording || isProcessingPreview) ? 'none' : 'auto',
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
                disabled={(!status === 'modelReady' && recordingCountdown === null) || isTranscribing}
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
              disabled={(!status === 'modelReady' && recordingCountdown === null) || isTranscribing || isRemoteMic}
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
              {(!pendingAudioFile || isTranscribing) && (
                <span className="spinner spinner--inline" aria-hidden="true" />
              )}
              {!pendingAudioFile
                ? t('receivingAudio')
                : isTranscribing
                  ? t('runningFinalTranscription')
                  : !hasBeenTranscribed
                    ? t('awaitingTranscribeClick')
                    : t('liveTranscriptKept')}
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

      {/* Placeholder shown where the audio player will land, so the user
          sees explicit "waiting for audio" feedback instead of a blank gap
          between stop and the player appearing. */}
      {awaitingFinal && !pendingAudioFile && (
        <div className="audio-preview-container" style={{ opacity: 0.85 }}>
          <div className="audio-preview-header" style={{ display: 'flex', alignItems: 'center' }}>
            <span className="spinner spinner--inline" aria-hidden="true" />
            <strong>{t('preparingAudioPreview')}</strong>
          </div>
          <div style={{ padding: '0.75rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.9em' }}>
            {t('preparingAudioHint')}
          </div>
        </div>
      )}

      {/* Audio preview player */}
      {pendingAudioFile && (
        <div className="audio-preview-container">
          <div className="audio-preview-header">
            <strong>📎 {pendingAudioFile.name}</strong>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', marginLeft: '0.5rem' }}>
              {t('whatModelHears')}
            </span>
          </div>
          {isProcessingPreview ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="spinner spinner--inline" aria-hidden="true" />
              {t('processingAudioPreview')}
            </div>
          ) : audioPreviewUrl ? (
            <div className="audio-player-wrapper">
              <audio 
                controls 
                src={audioPreviewUrl}
                className="audio-player"
              />
              <button
                onClick={clearPendingAudio}
                className="clear-audio-button"
                title={t('clearAudioFile')}
                aria-label={t('clearAudioFile')}
              >
                ✕
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* Transcribe button — only shown while transcribing, or when there is
          pending audio but auto-transcribe is off (so the user must trigger it manually) */}
      {(isTranscribing || (pendingAudioFile && !autoTranscribe && !hasBeenTranscribed)) && (
        <button
          onClick={startTranscription}
          disabled={!status === 'modelReady' || isTranscribing || !pendingAudioFile || !audioPreviewUrl || isProcessingPreview || hasBeenTranscribed}
          className="primary transcribe-button"
          style={{ marginTop: pendingAudioFile ? '0' : '1rem', marginBottom: '1rem' }}
          data-umami-event="transcribe_button"
        >
          {isTranscribing && <span className="spinner spinner--inline" aria-hidden="true" />}
          {isTranscribing ? t('transcribing') : t('transcribe')}
        </button>
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

      {/* Fallback prompt: shown when HuggingFace is unreachable and
          the instance has local model weights available */}
      {showFallbackPrompt && (
        <div className="fallback-prompt">
          <p>
            {t('couldNotReachHF')}
            {localFallbackEnabled
              ? ` ${t('localCopyAvailable')}`
              : ` ${t('localFallbackNotEnabled')}`}
          </p>
          {localFallbackEnabled && (
            <div className="fallback-actions">
              <button onClick={() => loadModel({ useLocalFallback: true })}>
                {t('downloadFromServer')}
              </button>
              <button onClick={() => setShowFallbackPrompt(false)}>
                {t('cancel')}
              </button>
            </div>
          )}
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
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <button
                onClick={() => setTranscriptDisplayMode('raw')}
                className={`display-mode-button${transcriptDisplayMode === 'raw' ? ' active' : ''}`}
                title="Raw transcription"
              >
                {t('raw')}
              </button>
              <button
                onClick={() => { setTranscriptDisplayMode('confidence'); setShowConfidenceHeatmap(true); }}
                className={`display-mode-button${transcriptDisplayMode === 'confidence' ? ' active' : ''}`}
                title={t('confidence')}
              >
                {t('confidence')}
              </button>
              {dictationRegexRules.length > 0 && (
                <button
                  onClick={() => setTranscriptDisplayMode('dictation')}
                  className={`display-mode-button${transcriptDisplayMode === 'dictation' ? ' active' : ''}`}
                  title={`${t('dictationRules')} (${dictationRegexRules.length} ${t('dictationRulesExperimental')})`}
                >
                  {t('dictationExp')}
                </button>
              )}
            </div>
          </div>
          <div>
            {transcriptions.map((trans) => {
              // Calculate average and minimum confidence from words
              const wordConfs = trans.words?.map(w => w.confidence).filter(c => c != null) || [];
              const avgConf = wordConfs.length > 0 ? wordConfs.reduce((a, b) => a + b, 0) / wordConfs.length : null;
              const minConf = wordConfs.length > 0 ? Math.min(...wordConfs) : null;
              
              return (
                <div className={`history-item${trans.id === newestTranscriptionIdRef.current ? ' history-item-enter' : ''}`} key={trans.id}>
                  <div className="history-meta">
                    <strong>{truncateFilename(trans.filename)}</strong>
                    {showAdvancedInfo && (
                      <span style={{ fontSize: '0.85em', color: 'var(--text-subtle)', marginLeft: '0.5rem' }}>
                        {typeof trans.duration === 'number' && `${trans.duration.toFixed(1)}s | `}{trans.wordCount} words{trans.metrics && ` | RTF: ${trans.metrics.rtf?.toFixed(2)}x`}
                        {avgConf !== null && minConf !== null && ` | Avg: ${(avgConf * 100).toFixed(1)}% | Min: ${(minConf * 100).toFixed(1)}%`}
                      </span>
                    )}
                    <span>{trans.timestamp}</span>
                  </div>
                  <div className="history-text-container">
                    <div className="history-text">
                      {showConfidenceHeatmap && transcriptDisplayMode === 'confidence' && trans.words && trans.words.length > 0 ? (
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
                    {/* Confidence score overlay shown when toggled via kebab menu */}
                    {transcriptDisplayMode === 'confidence' && avgConf !== null && (
                      <div className="confidence-overlay">
                        Avg: {(avgConf * 100).toFixed(1)}% &nbsp;|&nbsp; Min: {(minConf * 100).toFixed(1)}%
                      </div>
                    )}
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
                          <button className="kebab-delete" onClick={() => deleteTranscription(trans.id)}>
                            {t('delete')}
                          </button>
                        </div>
                      )}
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
          checklist={t('verifyChecklist')}
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
