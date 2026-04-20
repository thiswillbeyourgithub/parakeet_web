import React, { useState, useRef, useEffect, useTransition, useCallback } from 'react';
import { ParakeetModel, getParakeetModel, checkLocalModelFiles, HubDownloadError } from 'parakeet.js';
import './App.css';
import { useI18n, LanguageSwitcher } from './i18n.jsx';
import Banner from './components/Banner.jsx';
import Modal from './components/Modal.jsx';
import { RemoteMicRTC } from './lib/remote-webrtc.js';
import {
    generateKeyPair, exportPublicKey, importPublicKey,
    deriveSharedKey, decrypt
} from './lib/remote-crypto.js';

// Dictation device support (Philips SpeechMike etc.) via WebHID.
// Conditionally imported so the feature can be fully disabled via env var.
const devMode = import.meta.env.VITE_DEV_MODE === 'true';
const dictationEnabled = import.meta.env.VITE_DICTATION_DEVICE_SUPPORT !== 'false';
// Lazy-loaded on first use to avoid top-level await issues
let _dictationLib = null;
async function getDictationLib() {
  if (!_dictationLib && dictationEnabled) {
    _dictationLib = await import('dictation_support');
  }
  return _dictationLib;
}

// Simple help icon component with click-based tooltip
function InfoTooltip({ text }) {
  const [isOpen, setIsOpen] = React.useState(false);
  
  return (
    <span className="info-help">
      <button
        type="button"
        className="info-help-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="?"
      >
        ?
      </button>
      {isOpen && (
        <>
          <div className="info-help-overlay" onClick={() => setIsOpen(false)} />
          <div className="info-help-text">
            {text}
            <button className="info-help-close" onClick={() => setIsOpen(false)}>×</button>
          </div>
        </>
      )}
    </span>
  );
}

// Helper functions for IndexedDB persistence
const SETTINGS_DB_NAME = 'parakeetweb-settings-db';
const SETTINGS_STORE_NAME = 'settings-store';
const STORAGE_KEY_PREFIX = 'parakeetweb_';
let settingsDbPromise = null;

function getSettingsDb() {
  if (!settingsDbPromise) {
    settingsDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(SETTINGS_DB_NAME, 1);
      request.onerror = () => reject("Error opening settings IndexedDB");
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
          db.createObjectStore(SETTINGS_STORE_NAME);
        }
      };
    });
  }
  return settingsDbPromise;
}

async function loadSetting(key, defaultValue) {
  try {
    const db = await getSettingsDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SETTINGS_STORE_NAME], 'readonly');
      const store = transaction.objectStore(SETTINGS_STORE_NAME);
      const request = store.get(STORAGE_KEY_PREFIX + key);
      request.onerror = () => {
        console.warn(`Failed to load setting ${key}:`, request.error);
        resolve(defaultValue);
      };
      request.onsuccess = () => {
        const value = request.result;
        resolve(value !== undefined ? value : defaultValue);
      };
    });
  } catch (e) {
    console.warn(`Failed to load setting ${key}:`, e);
    return defaultValue;
  }
}

async function saveSetting(key, value) {
  try {
    const db = await getSettingsDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SETTINGS_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(SETTINGS_STORE_NAME);
      const request = store.put(value, STORAGE_KEY_PREFIX + key);
      request.onerror = () => {
        console.warn(`Failed to save setting ${key}:`, request.error);
        reject(request.error);
      };
      request.onsuccess = () => resolve();
    });
  } catch (e) {
    console.warn(`Failed to save setting ${key}:`, e);
  }
}

async function clearAllSettings() {
  try {
    const db = await getSettingsDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SETTINGS_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(SETTINGS_STORE_NAME);
      const request = store.clear();
      request.onerror = () => {
        console.warn('Failed to clear settings:', request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        console.log('[App] All settings cleared');
        resolve();
      };
    });
  } catch (e) {
    console.warn('Failed to clear settings:', e);
  }
}

// Injected by Vite from app/package.json — no need to manually sync
const VERSION = __APP_VERSION__;

// Helper function to truncate long filenames
function truncateFilename(filename, maxLength = 40) {
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
  const repoId = import.meta.env.VITE_MODEL_REPO || 'istupakov/parakeet-tdt-0.6b-v3-onnx';
  // Whether the instance can serve model weights locally (under /models/) as
  // a fallback when HuggingFace is blocked or unreachable.
  const localFallbackEnabled = import.meta.env.VITE_LOCAL_MODEL_FALLBACK === 'true';
  // Tracks whether we should show the "HF blocked, try local?" prompt
  const [showFallbackPrompt, setShowFallbackPrompt] = useState(false);
  // Warning message when local fallback is enabled but model files are missing
  const [fallbackWarning, setFallbackWarning] = useState(null);
  const [backend, setBackend] = useState('wasm');
  const [memoryInfo, setMemoryInfo] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [encoderQuant, setEncoderQuant] = useState('fp32');
  const [decoderQuant, setDecoderQuant] = useState('fp32');
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
  const [verboseLog, setVerboseLog] = useState(true);
  const [frameStride, setFrameStride] = useState(1);
  // Decoder temperature: higher = more diverse/noisy, lower = more greedy/confident
  const [temperature, setTemperature] = useState(0.0);
  // Chunking: split long audio into smaller segments before transcribing
  const [enableChunking, setEnableChunking] = useState(true);
  const [chunkDuration, setChunkDuration] = useState(60); // seconds
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
  const workletNodeRef = useRef(null);   // AudioWorkletNode for cleanup
  const [audioChunks, setAudioChunks] = useState([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioContext, setAudioContext] = useState(null);
  const [pendingAudioFile, setPendingAudioFile] = useState(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState(null);
  const [isProcessingPreview, setIsProcessingPreview] = useState(false);
  const [hasBeenTranscribed, setHasBeenTranscribed] = useState(false);
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
  const [remoteMicPaused, setRemoteMicPaused] = useState(false);
  const [remoteMicRecording, setRemoteMicRecording] = useState(false);
  const remoteMicRtcRef = useRef(null);
  const remoteMicKeyRef = useRef(null);
  const remoteMicSampleRateRef = useRef(16000);
  const remoteMicTimerRef = useRef(null);
  const remoteMicQrRef = useRef(null); // DOM ref for QR code container

  // Load QR code library when remote mic modal opens; returns a promise that resolves when ready
  const loadQRCode = useRef(null);
  if (!loadQRCode.current) {
    loadQRCode.current = new Promise((resolve) => {
      if (window.QRCode) { resolve(); return; }
      const script = document.createElement('script');
      script.src = '/js/qrcode.min.js';
      script.onload = () => { console.log('[RemoteMic] QR code library loaded'); setTimeout(resolve, 0); };
      document.head.appendChild(script);
    });
  }

  // Render QR code when both the URL is set and the DOM ref is available (status===waiting)
  useEffect(() => {
    if (!remoteMicQrUrl || remoteMicStatus !== 'waiting') return;
    loadQRCode.current.then(() => {
      if (remoteMicQrRef.current && window.QRCode) {
        remoteMicQrRef.current.innerHTML = '';
        const canvas = document.createElement('canvas');
        window.QRCode.toCanvas(canvas, remoteMicQrUrl, {
          width: 220,
          margin: 2,
          errorCorrectionLevel: 'M',
        }).then(() => {
          if (remoteMicQrRef.current) {
            remoteMicQrRef.current.innerHTML = '';
            remoteMicQrRef.current.appendChild(canvas);
          }
        });
      }
    });
  }, [remoteMicQrUrl, remoteMicStatus]);

  // Tracks which history item has its kebab menu open (by transcription id)
  const [openKebabId, setOpenKebabId] = useState(null);
  // Tracks which history item is showing its confidence score overlay
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showConfidenceHeatmap, setShowConfidenceHeatmap] = useState(false);
  // Auto-copy: when enabled, transcription text is automatically copied to clipboard
  const [autoCopyToClipboard, setAutoCopyToClipboard] = useState(true);
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
          savedEncoderQuant,
          savedDecoderQuant,
          savedPreprocessor,
          savedTranscriptions,
          savedVerboseLog,
          savedFrameStride,
          savedTemperature,
          savedCpuThreads,
          savedNoiseSuppression,
          savedEchoCancellation,
          savedAutoGainControl,
          savedShowConfidenceHeatmap,
          savedAutoTranscribe,
          savedAutoCopyToClipboard,
          savedShowAdvancedInfo,
          savedEnableChunking,
          savedChunkDuration,
          savedTranscriptDisplayMode,
        ] = await Promise.all([
          loadSetting('backend', 'wasm'),
          loadSetting('encoderQuant', 'fp32'),
          loadSetting('decoderQuant', 'fp32'),
          loadSetting('preprocessor', 'nemo128'),
          loadSetting('transcriptions', []),
          loadSetting('verboseLog', true),
          loadSetting('frameStride', 1),
          loadSetting('temperature', 0.5),
          loadSetting('cpuThreads', Math.max(1, maxCores - 2)),
          loadSetting('noiseSuppression', false),
          loadSetting('echoCancellation', false),
          loadSetting('autoGainControl', true),
          loadSetting('showConfidenceHeatmap', false),
          loadSetting('autoTranscribe', true),
          loadSetting('autoCopyToClipboard', true),
          loadSetting('showAdvancedInfo', false),
          loadSetting('enableChunking', true),
          loadSetting('chunkDuration', 60),
          loadSetting('transcriptDisplayMode', 'raw'),
        ]);

        setBackend(savedBackend);
        setEncoderQuant(savedEncoderQuant);
        setDecoderQuant(savedDecoderQuant);
        setPreprocessor(savedPreprocessor);
        setTranscriptions(savedTranscriptions.filter(t => t.text && t.text.trim() !== ''));
        setVerboseLog(savedVerboseLog);
        setFrameStride(savedFrameStride);
        setTemperature(savedTemperature);
        setCpuThreads(savedCpuThreads);
        setNoiseSuppression(savedNoiseSuppression);
        setEchoCancellation(savedEchoCancellation);
        setAutoGainControl(savedAutoGainControl);
        setShowConfidenceHeatmap(savedShowConfidenceHeatmap);
        setAutoTranscribe(savedAutoTranscribe);
        setAutoCopyToClipboard(savedAutoCopyToClipboard);
        setShowAdvancedInfo(savedShowAdvancedInfo);
        setEnableChunking(savedEnableChunking);
        setChunkDuration(savedChunkDuration);
        setTranscriptDisplayMode(savedTranscriptDisplayMode);
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
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // When local fallback is enabled, verify model files are actually present
  // on the server so the admin gets early feedback about misconfiguration.
  useEffect(() => {
    if (!localFallbackEnabled) return;
    checkLocalModelFiles('/models', repoId).then((result) => {
      if (result.ok) {
        console.log('[App] Local fallback check passed:', result.message);
      } else {
        const msg = `Local model fallback is enabled but model files are missing. `
          + `Download them first:\n\n`
          + `  hf download ${repoId} --local-dir ./fallback_models/${repoId.replace('/', '__')}\n\n`
          + `Then uncomment the volume bind in docker-compose.yml and restart.`;
        console.error('[App] FATAL:', msg);
        setFallbackWarning(msg);
        throw new Error(msg);
      }
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

  // Auto-adjust quant presets when backend changes and save all settings to IndexedDB
  useEffect(() => {
    if (!settingsLoaded) return;
    saveSetting('backend', backend);
    if (backend.startsWith('webgpu')) {
      setEncoderQuant('fp32');
      setDecoderQuant('fp32');
    } else if (backend === 'wasm') {
      setEncoderQuant('int8');
      setDecoderQuant('int8');
    }
  }, [backend, settingsLoaded]);

  // Save settings to IndexedDB whenever they change (only after initial load)
  useEffect(() => { if (settingsLoaded) saveSetting('encoderQuant', encoderQuant); }, [encoderQuant, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('decoderQuant', decoderQuant); }, [decoderQuant, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('preprocessor', preprocessor); }, [preprocessor, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('verboseLog', verboseLog); }, [verboseLog, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('frameStride', frameStride); }, [frameStride, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('temperature', temperature); }, [temperature, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('cpuThreads', cpuThreads); }, [cpuThreads, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('noiseSuppression', noiseSuppression); }, [noiseSuppression, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('echoCancellation', echoCancellation); }, [echoCancellation, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('autoGainControl', autoGainControl); }, [autoGainControl, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('showConfidenceHeatmap', showConfidenceHeatmap); }, [showConfidenceHeatmap, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('autoTranscribe', autoTranscribe); }, [autoTranscribe, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('autoCopyToClipboard', autoCopyToClipboard); }, [autoCopyToClipboard, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('enableChunking', enableChunking); }, [enableChunking, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('chunkDuration', chunkDuration); }, [chunkDuration, settingsLoaded]);
  useEffect(() => { if (settingsLoaded) saveSetting('transcriptDisplayMode', transcriptDisplayMode); }, [transcriptDisplayMode, settingsLoaded]);
  // Keep ref in sync so recorder.onstop callback always reads the latest value
  useEffect(() => { autoTranscribeRef.current = autoTranscribe; }, [autoTranscribe]);
  useEffect(() => { if (settingsLoaded) saveSetting('transcriptions', transcriptions); }, [transcriptions, settingsLoaded]);

  /**
   * Load model weights and create an ONNX inference session.
   * @param {Object} [opts]
   * @param {boolean} [opts.useLocalFallback=false] When true, download weights
   *   from this instance (/models/) instead of HuggingFace.
   */
  async function loadModel({ useLocalFallback = false } = {}) {
    // Clean up existing model first
    if (modelRef.current) {
      console.log('[App] Disposing existing model before loading new one...');
      modelRef.current.dispose();
      modelRef.current = null;
    }

    setShowFallbackPrompt(false);
    setStatus('loadingModel');
    // Collapse the info panel once model loading begins
    setShowInfo(false);
    setProgress('');
    setProgressText('');
    setProgressPct(0);
    console.time('LoadModel');

    try {
      const progressCallback = ({ loaded, total, file }) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        setProgressText(`${file}: ${pct}%`);
        setProgressPct(pct);
      };

      // 1. Download all model files (from HF or local fallback)
      const downloadOpts = {
        encoderQuant,
        decoderQuant,
        preprocessor,
        progress: progressCallback,
      };
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
          await ctx.audioWorklet.addModule('pcm-recorder-worklet.js');
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
      pcmChunksRef.current = [];
      workletNode.port.onmessage = (e) => {
        pcmChunksRef.current.push(e.data); // Float32Array, 128 samples each
      };

      sourceNode.connect(workletNode);
      // workletNode does NOT connect to destination — we capture only, no feedback loop

      workletNodeRef.current = workletNode;

      // Audio level monitoring via an AnalyserNode on the same graph
      const analyser = audioCtx.createAnalyser();
      sourceNode.connect(analyser);
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      const dataArray = new Uint8Array(analyser.fftSize);

      // `recording` flag is closed over; flipped to false in stopRecording
      let recording = true;
      const updateLevel = () => {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(100, rms * 250);
        setAudioLevel(level);
        if (recording) requestAnimationFrame(updateLevel);
      };
      updateLevel();

      // Stash a stop-helper on the audioCtx so stopRecording can flip the flag
      audioCtx._stopLevelMonitor = () => { recording = false; };

      setAudioContext(audioCtx);
      setMediaRecorder(stream); // reuse state slot to hold the stream for cleanup
      setIsRecording(true);
      setStatus('recordingClickStop');
      console.log('[Record] Recording started (AudioWorklet PCM capture)');

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
    setIsRecording(false);
    setIsPaused(false);
    setAudioLevel(0);

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
    pcmChunksRef.current = [];
    const totalSamples = chunks.reduce((n, c) => n + c.length, 0);
    const rawPcm = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      rawPcm.set(chunk, offset);
      offset += chunk.length;
    }
    const sourceSampleRate = audioContext?.sampleRate ?? 48000;
    console.log(`[Record] Captured ${totalSamples} samples at ${sourceSampleRate}Hz (${(totalSamples / sourceSampleRate).toFixed(2)}s)`);

    // Resample from mic native rate → 16kHz mono via OfflineAudioContext
    const targetSampleRate = 16000;
    const offlineCtx = new OfflineAudioContext(
      1,
      Math.ceil((totalSamples / sourceSampleRate) * targetSampleRate),
      targetSampleRate
    );
    const buf = offlineCtx.createBuffer(1, totalSamples, sourceSampleRate);
    buf.getChannelData(0).set(rawPcm);
    const src = offlineCtx.createBufferSource();
    src.buffer = buf;
    src.connect(offlineCtx.destination);
    src.start();
    const resampled = await offlineCtx.startRendering();
    const pcm16k = resampled.getChannelData(0);
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

      // Restart level-monitor animation loop with a fresh `recording` flag
      const analyser = audioContext.createAnalyser();
      // Re-use the existing source node — it is still connected to the worklet.
      // We need a new analyser because the old one's animation loop has stopped.
      // The source → worklet connection is still intact; just tap the source again.
      // mediaRecorder state slot holds the MediaStream
      const stream = mediaRecorder;
      if (stream) {
        const src = audioContext.createMediaStreamSource(stream);
        src.connect(analyser);
      }
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      const dataArray = new Uint8Array(analyser.fftSize);
      let monitoring = true;
      const updateLevel = () => {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(100, rms * 250);
        setAudioLevel(level);
        if (monitoring) requestAnimationFrame(updateLevel);
      };
      updateLevel();
      audioContext._stopLevelMonitor = () => { monitoring = false; };

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
    setRemoteMicLevel(0);
    setRemoteMicElapsed(0);
    pcmChunksRef.current = [];
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
        if (remoteMicTimerRef.current) {
          clearInterval(remoteMicTimerRef.current);
          remoteMicTimerRef.current = null;
        }
        remoteMicRtcRef.current = null;
        remoteMicKeyRef.current = null;
        pcmChunksRef.current = [];
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
          try {
            const msg = JSON.parse(data);
            if (msg.type === 'sender-public-key') {
              // Derive shared key from phone's public key
              const theirKey = await importPublicKey(msg.key);
              remoteMicKeyRef.current = await deriveSharedKey(keyPair.privateKey, theirKey);
              console.log('[RemoteMic] Shared key derived, ready to receive audio');
              setRemoteMicStatus('connected');
              setRemoteMicModal(false); // close setup modal; use main UI from here
              setRemoteMicPaused(false);
              setIsRemoteMic(true);

              // Start elapsed timer
              const startTime = Date.now();
              remoteMicTimerRef.current = setInterval(() => {
                setRemoteMicElapsed(Math.floor((Date.now() - startTime) / 1000));
              }, 1000);
            } else if (msg.type === 'audio-config') {
              remoteMicSampleRateRef.current = msg.sampleRate;
              console.log(`[RemoteMic] Phone sample rate: ${msg.sampleRate}Hz`);
              setRemoteMicRecording(true);
              // Restart elapsed timer for new recording session
              if (remoteMicTimerRef.current) clearInterval(remoteMicTimerRef.current);
              const startTime = Date.now();
              remoteMicTimerRef.current = setInterval(() => {
                setRemoteMicElapsed(Math.floor((Date.now() - startTime) / 1000));
              }, 1000);
            } else if (msg.type === 'audio-end') {
              console.log('[RemoteMic] Phone stopped recording, processing batch...');
              setRemoteMicRecording(false);
              // Process accumulated audio but keep RTC alive for next recording
              processRemoteMicBatch();
            } else if (msg.type === 'paused') {
              setRemoteMicPaused(true);
            } else if (msg.type === 'resumed') {
              setRemoteMicPaused(false);
            }
          } catch (e) {
            console.error('[RemoteMic] Error parsing message:', e);
          }
        } else {
          // Binary data: encrypted audio chunk
          if (!remoteMicKeyRef.current) return;
          try {
            const decrypted = await decrypt(data, remoteMicKeyRef.current);
            const float32 = new Float32Array(decrypted);
            pcmChunksRef.current.push(float32);

            // Compute audio level from decrypted PCM
            let sum = 0;
            for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
            const rms = Math.sqrt(sum / float32.length);
            setRemoteMicLevel(Math.min(100, rms * 250));
          } catch (e) {
            console.warn('[RemoteMic] Decrypt error:', e.message);
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
    if (remoteMicTimerRef.current) {
      clearInterval(remoteMicTimerRef.current);
      remoteMicTimerRef.current = null;
    }
    setRemoteMicLevel(0);
    setRemoteMicElapsed(0);
    setRemoteMicPaused(false);

    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    const totalSamples = chunks.reduce((n, c) => n + c.length, 0);

    if (totalSamples === 0) {
      console.log('[RemoteMic] No audio received in this batch');
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
    let pcm16k;
    if (sourceSampleRate === targetSampleRate) {
      pcm16k = rawPcm;
    } else {
      const offlineCtx = new OfflineAudioContext(
        1,
        Math.ceil((totalSamples / sourceSampleRate) * targetSampleRate),
        targetSampleRate
      );
      const buf = offlineCtx.createBuffer(1, totalSamples, sourceSampleRate);
      buf.getChannelData(0).set(rawPcm);
      const src = offlineCtx.createBufferSource();
      src.buffer = buf;
      src.connect(offlineCtx.destination);
      src.start();
      const resampled = await offlineCtx.startRendering();
      pcm16k = resampled.getChannelData(0);
    }
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
    await processRemoteMicBatch();
    if (remoteMicRtcRef.current) {
      try { remoteMicRtcRef.current.sendMessage({ type: 'stop-recording' }); } catch (_) {}
    }
    setRemoteMicRecording(false);
    setRemoteMicPaused(false);
  }

  async function disconnectRemoteMic() {
    // Full teardown — close RTC, phone goes to STOPPED
    await processRemoteMicBatch();
    if (remoteMicRtcRef.current) {
      try { remoteMicRtcRef.current.sendMessage({ type: 'stop' }); } catch (_) {}
      remoteMicRtcRef.current.close();
      remoteMicRtcRef.current = null;
    }
    remoteMicKeyRef.current = null;
    if (remoteMicTimerRef.current) {
      clearInterval(remoteMicTimerRef.current);
      remoteMicTimerRef.current = null;
    }
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
    // Tear down leftover state and start fresh — produces a new roomId/secret/QR.
    if (remoteMicTimerRef.current) {
      clearInterval(remoteMicTimerRef.current);
      remoteMicTimerRef.current = null;
    }
    if (remoteMicRtcRef.current) {
      try { remoteMicRtcRef.current.close(); } catch (_) {}
      remoteMicRtcRef.current = null;
    }
    remoteMicKeyRef.current = null;
    pcmChunksRef.current = [];
    setRemoteMicQrUrl('');
    setRemoteMicLevel(0);
    setRemoteMicPaused(false);
    setRemoteMicRecording(false);
    setIsRemoteMic(false);
    startRemoteMic();
  }

  function cancelRemoteMic() {
    if (remoteMicTimerRef.current) {
      clearInterval(remoteMicTimerRef.current);
      remoteMicTimerRef.current = null;
    }
    if (remoteMicRtcRef.current) {
      remoteMicRtcRef.current.close();
      remoteMicRtcRef.current = null;
    }
    remoteMicKeyRef.current = null;
    setIsRemoteMic(false);
    setRemoteMicRecording(false);
    setRemoteMicModal(false);
    setRemoteMicLevel(0);
    setRemoteMicQrUrl('');
    pcmChunksRef.current = [];
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
        ? (remaining[0].hidDevice.productName || 'Dictation device')
        : null);
    });

    // Update UI when a new device is connected (e.g. re-plugged)
    manager.addDeviceConnectedEventListener((device) => {
      setDictationDevice(device.hidDevice.productName || 'Dictation device');
    });

    if (requestDevice) {
      const devices = await manager.requestDevice();
      if (devices.length > 0) {
        setDictationDevice(devices[0].hidDevice.productName || 'Dictation device');
      }
    } else {
      // Auto-reconnect: check for already-paired devices (no user gesture needed)
      const devices = manager.getDevices();
      if (devices.length > 0) {
        setDictationDevice(devices[0].hidDevice.productName || 'Dictation device');
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
        setDictationDevice(devices[0].hidDevice.productName || 'Dictation device');
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

    setIsTranscribing(true);
    setStatus(`${t('transcribingFile')} "${file.name}"…`);

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
      setStatus(`${t('processingResampling')} "${file.name}"`);
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
              setStatus(`${t('transcribingFile')} "${file.name}" - ${chunkProgress}% ${t('complete')} (${t('chunk')} ${chunkNum}/${totalChunks})`);
              
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
        filename: file.name,
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
          await navigator.clipboard.writeText(textToCopy);
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
      
      alert(`Failed to transcribe "${file.name}": ${detailedMsg}`);
    } finally {
      setIsTranscribing(false);
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
    if (audioPreviewUrl) {
      URL.revokeObjectURL(audioPreviewUrl);
    }
    setPendingAudioFile(null);
    setAudioPreviewUrl(null);
    setHasBeenTranscribed(false);
    setIsProcessingPreview(false); // Reset processing state
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
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('[Copy] Failed to copy text:', err);
      alert(t('failedCopyClipboard'));
    }
  }

  async function copyHistoryItem(transcription) {
    if (!transcription?.text) return;

    try {
      await navigator.clipboard.writeText(getDisplayText(transcription));
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
    async function loadDictationRegex() {
      try {
        // Try to fetch the manifest first
        const manifestRes = await fetch('/dictation-regex/manifest.txt');
        if (!manifestRes.ok) {
          console.log('[Dictation] No regex manifest found — dictation mode unavailable (download rules via Docker entrypoint)');
          setDictationRegexLoaded(true);
          return;
        }
        const manifestText = await manifestRes.text();
        const files = manifestText.trim().split('\n').filter(f => f.endsWith('.csv'));

        const rules = [];
        for (const file of files) {
          try {
            const res = await fetch(`/dictation-regex/${file}`);
            if (!res.ok) continue;
            const csvText = await res.text();
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
                // Strip Python-style inline flags (e.g. (?i)) since JS uses RegExp flags instead
                const cleanedRegex = rawRegex.replace(/\(\?[gimsuy]+\)/g, '');
                // Validate regex
                new RegExp(cleanedRegex, 'gi');
                rules.push({
                  regex: cleanedRegex,
                  replacement: rawReplacement
                    .replace(/\\n/g, '\n') // support \n in replacements
                    .replace(/^"(.*)"$/, '$1'), // strip outer quotes
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
        const re = new RegExp(rule.regex, 'gi');
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
  }, [transcriptDisplayMode, dictationRegexRules, transcriptions, dictationCache]);

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
  const [lowRamInfo, setLowRamInfo] = useState(null); // { detectedGB, source }
  const [showLowRamBanner, setShowLowRamBanner] = useState(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('parakeetweb_lowram_dismissed')) return false;
    // Chrome exposes JS heap size limit — most reliable signal
    const heapLimit = performance?.memory?.jsHeapSizeLimit;
    if (heapLimit !== undefined) {
      const detectedGB = (heapLimit / 1024 / 1024 / 1024).toFixed(1);
      // Cannot call setLowRamInfo during useState init — stored on ref below
      window.__parakeet_lowram = { detectedGB, source: 'heap limit' };
      return heapLimit < RAM_THRESHOLD_BYTES;
    }
    // Chrome/Edge expose device RAM in GB
    const mem = navigator.deviceMemory;
    if (mem !== undefined) {
      window.__parakeet_lowram = { detectedGB: String(mem), source: 'device memory' };
      return mem < RAM_THRESHOLD_GB;
    }
    // Fallback: assume mobile devices are memory-constrained
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      window.__parakeet_lowram = { detectedGB: '?', source: 'mobile device' };
      return true;
    }
    return false;
  });

  // Populate lowRamInfo from the window scratch space set during useState init
  useEffect(() => {
    if (window.__parakeet_lowram) {
      setLowRamInfo(window.__parakeet_lowram);
      delete window.__parakeet_lowram;
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
        <h2>ParakeetWeb v{VERSION}</h2>
        <p style={{ margin: 0, flex: 1, paddingLeft: '1rem', fontSize: '0.9rem', color: 'var(--text-subtle)' }}>{t('status')}: {t(status) || status}</p>
        <LanguageSwitcher />
        <button
          className="settings-toggle"
          onClick={() => setShowSettings(!showSettings)}
          aria-label={t('toggleSettings')}
          title={showSettings ? t('hideSettings') : t('showSettings')}
        >
          ☰
        </button>
      </div>

      {/* About modal */}
      {showAbout && (
        <Modal onClose={() => setShowAbout(false)}>
          <h3 style={{ marginTop: 0 }}>{t('aboutTitle')}</h3>
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
            <strong>{t('install')}:</strong> {t('installText')}
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
        <p>
          <strong>{t('model')}:</strong> {repoId} <span style={{fontSize:'0.9em', color: 'var(--text-subtle)'}}>(nemo128)</span>
        </p>

          <div className="settings-content">
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

            <div className="setting-row">
              <span className="setting-label">
                {t('encoderQuantization')}:
                <InfoTooltip text={t('tooltipQuantization')} />
              </span>
              <div className="setting-options">
                <label className={status === 'modelReady' || backend.startsWith('webgpu') ? 'disabled-option' : ''}>
                  <input type="radio" name="encoderQuant" value="int8" checked={encoderQuant === 'int8'} onChange={e => setEncoderQuant(e.target.value)} disabled={status === 'modelReady' || backend.startsWith('webgpu')} />
                  {t('int8Faster')}
                </label>
                <label className={status === 'modelReady' ? 'disabled-option' : ''}>
                  <input type="radio" name="encoderQuant" value="fp32" checked={encoderQuant === 'fp32'} onChange={e => setEncoderQuant(e.target.value)} disabled={status === 'modelReady'} />
                  {t('fp32HigherQuality')}
                </label>
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                {t('decoderQuantization')}:
                <InfoTooltip text={t('tooltipQuantization')} />
              </span>
              <div className="setting-options">
                <label className={status === 'modelReady' || backend.startsWith('webgpu') ? 'disabled-option' : ''}>
                  <input type="radio" name="decoderQuant" value="int8" checked={decoderQuant === 'int8'} onChange={e => setDecoderQuant(e.target.value)} disabled={status === 'modelReady' || backend.startsWith('webgpu')} />
                  {t('int8Faster')}
                </label>
                <label className={status === 'modelReady' ? 'disabled-option' : ''}>
                  <input type="radio" name="decoderQuant" value="fp32" checked={decoderQuant === 'fp32'} onChange={e => setDecoderQuant(e.target.value)} disabled={status === 'modelReady'} />
                  {t('fp32HigherQuality')}
                </label>
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                {t('frameStride')}: {frameStride}
                <InfoTooltip text={t('tooltipFrameStride')} />
              </span>
              <input 
                type="range" 
                min="1" 
                max="4" 
                value={frameStride} 
                onChange={e=>setFrameStride(Number(e.target.value))} 
                style={{flexBasis: '100%', marginTop: '0.25rem'}} 
              />
            </div>

            {(backend === 'wasm' || backend.startsWith('webgpu')) && (
              <div className="setting-row">
                <span className="setting-label">
                  {t('cpuThreads')}: {cpuThreads}
                  <InfoTooltip text={t('tooltipCpuThreads')} />
                </span>
                <input 
                  type="range" 
                  min="1" 
                  max={maxCores} 
                  value={cpuThreads} 
                  onChange={e=>setCpuThreads(Number(e.target.value))} 
                  disabled={status === 'modelReady'}
                  style={{flexBasis: '100%', marginTop: '0.25rem', opacity: status === 'modelReady' ? 0.5 : 1}} 
                />
              </div>
            )}

            <div className="setting-row">
              <span className="setting-label">
                {t('temperature')}: {temperature.toFixed(1)}
                <InfoTooltip text={t('tooltipTemperature')} />
              </span>
              <input
                type="range"
                min="0.0"
                max="3.0"
                step="0.1"
                value={temperature}
                onChange={e=>setTemperature(Number(e.target.value))}
                style={{flexBasis: '100%', marginTop: '0.25rem'}}
              />
            </div>

            <div className="setting-row">
              <label>
                <input type="checkbox" checked={enableChunking} onChange={e => setEnableChunking(e.target.checked)} />
                {t('chunkLongAudio')}
                <InfoTooltip text={t('tooltipChunking')} />
              </label>
              {enableChunking && (
                <div style={{ marginTop: '0.25rem', width: '100%' }}>
                  <span className="setting-label">
                    {t('chunkDuration')}: {chunkDuration}s
                  </span>
                  <input
                    type="range"
                    min="15"
                    max="300"
                    step="5"
                    value={chunkDuration}
                    onChange={e => setChunkDuration(Number(e.target.value))}
                    style={{ flexBasis: '100%', marginTop: '0.25rem', width: '100%' }}
                  />
                </div>
              )}
            </div>

            <div className="setting-row">
              <label>
                <input type="checkbox" checked={showConfidenceHeatmap} onChange={e => setShowConfidenceHeatmap(e.target.checked)} />
                {t('showCertaintyHeatmap')}
                <InfoTooltip text={t('tooltipHeatmap')} />
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
                  {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, '0')}
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
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-subtle)' }}>
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
                        {trans.duration.toFixed(1)}s | {trans.wordCount} words{trans.metrics && ` | RTF: ${trans.metrics.rtf?.toFixed(2)}x`}
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
                              try { await navigator.clipboard.writeText(cleaned); setCopiedHistoryId(trans.id); setTimeout(() => setCopiedHistoryId(null), 2000); } catch (e) { console.error('[Copy] Failed:', e); }
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
