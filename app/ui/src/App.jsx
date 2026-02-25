import React, { useState, useRef, useEffect, useTransition } from 'react';
import { ParakeetModel, getParakeetModel } from 'parakeet.js';
import './App.css';

// Simple help icon component with click-based tooltip
function InfoTooltip({ text }) {
  const [isOpen, setIsOpen] = React.useState(false);
  
  return (
    <span className="info-help">
      <button
        type="button"
        className="info-help-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Help"
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

// Keep in sync with package.json version when bumping
const VERSION = '1.8.0';

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
  const repoId = import.meta.env.VITE_MODEL_REPO || 'istupakov/parakeet-tdt-0.6b-v3-onnx';
  const [backend, setBackend] = useState('wasm');
  const [memoryInfo, setMemoryInfo] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [encoderQuant, setEncoderQuant] = useState('fp32');
  const [decoderQuant, setDecoderQuant] = useState('fp32');
  const [preprocessor, setPreprocessor] = useState('nemo128');
  const [status, setStatus] = useState('Idle');
  const [progress, setProgress] = useState('');
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(null);
  const [text, setText] = useState('');
  const [latestMetrics, setLatestMetrics] = useState(null);
  const [transcriptions, setTranscriptions] = useState([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [verboseLog, setVerboseLog] = useState(true);
  const [frameStride, setFrameStride] = useState(1);
  // Decoder temperature: higher = more diverse/noisy, lower = more greedy/confident
  const [temperature, setTemperature] = useState(0.0);
  const maxCores = navigator.hardwareConcurrency || 8;
  // Default to all available CPU cores for best transcription throughput
  const [cpuThreads, setCpuThreads] = useState(maxCores);
  const modelRef = useRef(null);
  const fileInputRef = useRef(null);
  // Ref to access autoTranscribe inside recorder.onstop callback without stale closure
  const autoTranscribeRef = useRef(true);
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
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
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [echoCancellation, setEchoCancellation] = useState(true);
  const [autoGainControl, setAutoGainControl] = useState(true);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copiedHistoryId, setCopiedHistoryId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showConfidenceHeatmap, setShowConfidenceHeatmap] = useState(false);
  // Auto-copy: when enabled, transcription text is automatically copied to clipboard
  const [autoCopyToClipboard, setAutoCopyToClipboard] = useState(true);
  // Info panel is shown by default; collapses once model loading begins
  const [showInfo, setShowInfo] = useState(true);
  // Show advanced info: memory/heap counters, audio metadata, transcription performance stats
  const [showAdvancedInfo, setShowAdvancedInfo] = useState(false);
  // Auto-transcribe: when enabled, transcription starts automatically after recording stops
  const [autoTranscribe, setAutoTranscribe] = useState(true);

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
          loadSetting('noiseSuppression', true),
          loadSetting('echoCancellation', true),
          loadSetting('autoGainControl', true),
          loadSetting('showConfidenceHeatmap', false),
          loadSetting('autoTranscribe', true),
          loadSetting('autoCopyToClipboard', true),
          loadSetting('showAdvancedInfo', false),
        ]);

        setBackend(savedBackend);
        setEncoderQuant(savedEncoderQuant);
        setDecoderQuant(savedDecoderQuant);
        setPreprocessor(savedPreprocessor);
        setTranscriptions(savedTranscriptions);
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Don't trigger shortcuts if user is typing in an input/textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key.toLowerCase();

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
          // Start recording (R or Space)
          e.preventDefault();
          if (status.startsWith('Model ready ✔') && !isTranscribing && !pendingAudioFile) {
            startRecordingCountdown();
          }
          break;

        case 'f':
          // Send a file
          e.preventDefault();
          if (fileInputRef.current && status.startsWith('Model ready ✔') && !isTranscribing && !isRecording && !pendingAudioFile && !isProcessingPreview) {
            fileInputRef.current.click();
          }
          break;

        case 't':
          // Start transcribing
          e.preventDefault();
          if (status.startsWith('Model ready ✔') && !isTranscribing && pendingAudioFile && audioPreviewUrl && !isProcessingPreview && !hasBeenTranscribed) {
            startTranscription();
          }
          break;

        case 'l':
          // Load model
          e.preventDefault();
          if (!status.startsWith('Model ready ✔') && (status.toLowerCase().includes('fail') || status === 'Idle')) {
            loadModel();
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [status, isRecording, isTranscribing, pendingAudioFile, audioPreviewUrl, isProcessingPreview, hasBeenTranscribed]);

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
  // Keep ref in sync so recorder.onstop callback always reads the latest value
  useEffect(() => { autoTranscribeRef.current = autoTranscribe; }, [autoTranscribe]);
  useEffect(() => { if (settingsLoaded) saveSetting('transcriptions', transcriptions); }, [transcriptions, settingsLoaded]);

  async function loadModel() {
    // Clean up existing model first
    if (modelRef.current) {
      console.log('[App] Disposing existing model before loading new one...');
      modelRef.current.dispose();
      modelRef.current = null;
    }

    setStatus('Loading model…');
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

      // 1. Download all model files from HuggingFace Hub
      const modelUrls = await getParakeetModel(repoId, { 
        encoderQuant,
        decoderQuant,
        preprocessor,
        progress: progressCallback 
      });

      // Show compiling sessions stage
      setStatus('Creating sessions…');
      setProgressText('Compiling model…');
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

      // 3. Warm-up and verify (commented out - skipping verification)
      // setStatus('Warming up & verifying…');
      // setProgressText('Running a test transcription…');
      // const expectedText = 'it is not life as we know or understand it';
      // 
      // try {
      //   const audioRes = await fetch('/assets/life_Jim.wav');
      //   const buf = await audioRes.arrayBuffer();
      //   const audioCtx = new AudioContext({ sampleRate: 16000 });
      //   const decoded = await audioCtx.decodeAudioData(buf);
      //   const pcm = decoded.getChannelData(0);
      //   
      //   const { utterance_text } = await modelRef.current.transcribe(pcm, 16000);
      //
      //   // Normalize both texts: lowercase and remove punctuation
      //   const normalize = (str) => str.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");
      //
      //   if (normalize(utterance_text).includes(normalize(expectedText))) {
      //     console.log('[App] Model verification successful.');
      //     setStatus('Model ready ✔');
      //   } else {
      //     console.warn(`[App] Model verification mismatch - Expected: "${expectedText}", Got: "${utterance_text}"`);
      //     console.warn('[App] Proceeding anyway - please verify results meet your needs.');
      //     setStatus('Model ready ✔ (verification mismatch - check console)');
      //   }
      // } catch (err) {
      //   console.error('[App] Warm-up transcription failed', err);
      //   console.warn('[App] Proceeding anyway - model may still work for your use case.');
      //   setStatus('Model ready ✔ (warm-up failed - check console)');
      // }

      console.timeEnd('LoadModel');
      setStatus('Model ready ✔');
      setProgressText('');
      setProgressPct(null);
    } catch (e) {
      console.error(e);
      setStatus(`Failed: ${e.message}`);
      setProgress('');
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

    // Run the countdown while the mic stream stays open but idle.
    setRecordingCountdown(2);
    setStatus('Get ready to record... 2');

    await new Promise(resolve => setTimeout(resolve, 1000));
    setRecordingCountdown(1);
    setStatus('Get ready to record... 1');

    // Start recording ~100ms before the countdown visually hits 0.
    // This gives the Opus codec just enough time to prime its internal
    // buffer (~26.5ms lookahead) without capturing seconds of silence.
    await new Promise(resolve => setTimeout(resolve, 900));
    await startRecordingActual(stream);

    setRecordingCountdown(0);
    setStatus('Recording starts now!');

    await new Promise(resolve => setTimeout(resolve, 100)); // Brief pause at 0
    setRecordingCountdown(null);
  }

  async function startRecordingActual(stream) {
    try {
      const audioTrack = stream.getAudioTracks()[0];
      const settings = audioTrack.getSettings();
      console.log('[Record] Microphone access granted');
      console.log('[Record] Actual mic settings:', settings);

      // Use 48kHz AudioContext — matches most mic hardware natively.
      // Raw PCM is captured via AudioWorklet, bypassing MediaRecorder's Opus codec
      // entirely. This eliminates the ~26.5ms Opus priming delay that garbled
      // the first word of recordings.
      const audioCtx = new AudioContext({ sampleRate: 48000 });

      await audioCtx.audioWorklet.addModule('pcm-recorder-worklet.js');
      console.log('[Record] AudioWorklet module registered');

      const sourceNode = audioCtx.createMediaStreamSource(stream);
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
      setStatus('Recording... (click Stop to transcribe)');
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
      setStatus('Model ready ✔');
      return;
    }

    if (!isRecording) return;

    console.log('[Record] Stopping recording...');
    setIsRecording(false);
    setAudioLevel(0);

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
    const rawPcm48k = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      rawPcm48k.set(chunk, offset);
      offset += chunk.length;
    }
    console.log(`[Record] Captured ${totalSamples} samples at 48kHz (${(totalSamples / 48000).toFixed(2)}s)`);

    // Resample 48kHz → 16kHz mono via OfflineAudioContext
    const targetSampleRate = 16000;
    const sourceSampleRate = audioContext?.sampleRate ?? 48000;
    const offlineCtx = new OfflineAudioContext(
      1,
      Math.ceil((totalSamples / sourceSampleRate) * targetSampleRate),
      targetSampleRate
    );
    const buf = offlineCtx.createBuffer(1, totalSamples, sourceSampleRate);
    buf.getChannelData(0).set(rawPcm48k);
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
    setStatus('Model ready ✔');

    setHasBeenTranscribed(false);

    // Auto-transcribe if enabled
    if (autoTranscribeRef.current && modelRef.current) {
      console.log('[Record] Auto-transcribing...');
      processAudioFile(file).then(() => {
        setHasBeenTranscribed(true);
      });
    }
  }

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
    if (!modelRef.current) return alert('Load model first');
    if (!file) return;

    setIsTranscribing(true);
    setStatus(`Transcribing "${file.name}"…`);

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
      setStatus(`Processing "${file.name}" - Resampling audio...`);
      setProgressText('⏳ Resampling to 16kHz...');
      
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
      const MAX_CHUNK_DURATION = 60; // seconds
      const MAX_CHUNK_SAMPLES = MAX_CHUNK_DURATION * 16000;
      
      let res;
      if (pcm.length > MAX_CHUNK_SAMPLES) {
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
              setStatus(`Transcribing "${file.name}" - ${chunkProgress}% complete (chunk ${chunkNum}/${totalChunks})`);
              
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

      setTranscriptions(prev => [newTranscription, ...prev]);
      setText(res.utterance_text); // Show latest transcription
      setStatus('Model ready ✔'); // Ready for next file

      // Auto-copy transcription to clipboard if enabled
      if (autoCopyToClipboard && res.utterance_text) {
        try {
          await navigator.clipboard.writeText(res.utterance_text);
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
      
      setStatus('Transcription failed');
      
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
    setStatus('Processing audio preview...');
    
    try {
      const resampledBlob = await resampleToPreview(file);
      const previewUrl = URL.createObjectURL(resampledBlob);
      setAudioPreviewUrl(previewUrl);
      setStatus('Model ready ✔');
    } catch (err) {
      console.error('[Preview] Failed to process audio:', err);
      // Fallback to original file if processing fails
      setAudioPreviewUrl(URL.createObjectURL(file));
      setStatus('Model ready ✔ (preview processing failed)');
    } finally {
      setIsProcessingPreview(false);
    }
    
    // Clear the file input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
      '⚠️ This will permanently delete ALL saved settings and transcription history.\n\n' +
      'Are you sure you want to continue?'
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
      alert('Failed to reset data. Please check the console for details.');
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
      alert('Failed to copy to clipboard');
    }
  }

  async function copyHistoryItem(transcription) {
    if (!transcription?.text) return;
    
    try {
      await navigator.clipboard.writeText(transcription.text);
      setCopiedHistoryId(transcription.id);
      setTimeout(() => setCopiedHistoryId(null), 2000); // Reset after 2 seconds
    } catch (err) {
      console.error('[Copy] Failed to copy text:', err);
      alert('Failed to copy to clipboard');
    }
  }

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
  // Triggers when JS heap limit is below 2 GB (the model needs ~100-200 MB plus runtime overhead).
  // Falls back to navigator.deviceMemory (Chrome/Edge) or mobile UA sniffing when heap info
  // is unavailable.
  const [showLowRamBanner, setShowLowRamBanner] = useState(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('parakeetweb_lowram_dismissed')) return false;
    const TWO_GB = 2 * 1024 * 1024 * 1024;
    // Chrome exposes JS heap size limit — most reliable signal
    const heapLimit = performance?.memory?.jsHeapSizeLimit;
    if (heapLimit !== undefined) return heapLimit < TWO_GB;
    // Chrome/Edge expose device RAM in GB
    const mem = navigator.deviceMemory;
    if (mem !== undefined) return mem < 2;
    // Fallback: assume mobile devices are memory-constrained
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  });

  const dismissLowRamBanner = () => {
    sessionStorage.setItem('parakeetweb_lowram_dismissed', '1');
    setShowLowRamBanner(false);
  };

  return (
    <div className="app">
      {/* Warning banner for devices that may not have enough RAM for the ~100-200 MB model */}
      {showLowRamBanner && (
        <div style={{
          background: '#fef3c7', color: '#92400e', padding: '0.5rem 1rem',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '0.9rem', borderBottom: '1px solid #f59e0b',
        }}>
          <span>⚠️ Your device may have limited memory. The speech recognition model (~100–200 MB) might fail to load.</span>
          <button onClick={dismissLowRamBanner} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#92400e', marginLeft: '0.5rem' }} aria-label="Dismiss">×</button>
        </div>
      )}
      <div className="app-header">
        <h2>ParakeetWeb v{VERSION}</h2>
        <p style={{ margin: 0, flex: 1, paddingLeft: '1rem', fontSize: '0.9rem', color: '#666' }}>Status: {status}</p>
        <button 
          className="info-toggle"
          onClick={() => setShowInfo(!showInfo)}
          aria-label="Toggle info"
          title={showInfo ? "Hide info" : "Show info"}
        >
          ℹ️
        </button>
        <button 
          className="settings-toggle"
          onClick={() => setShowSettings(!showSettings)}
          aria-label="Toggle settings"
          title={showSettings ? "Hide settings" : "Show settings"}
        >
          ⚙️
        </button>
      </div>

      {showInfo && (
        <div className="info-section">
          <p style={{ fontSize: '1.1rem', fontWeight: 'bold', textAlign: 'center', margin: '0.5rem 0 1rem' }}>
            Dictation for any language, without installing anything!
          </p>
          <h3>What is this?</h3>
          <p>
            <strong>ParakeetWeb</strong> is a browser-based speech-to-text application that runs entirely in your browser using WebAssembly and WebGPU. 
            Your audio never leaves your device - all processing happens locally on your computer.
          </p>
          <p>
            It uses NVIDIA's Parakeet TDT model for high-quality transcription with word-level timestamps and confidence scores. 
            You can transcribe audio files or record directly from your microphone.
          </p>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '1rem', marginBottom: 0 }}>
            <strong>Source code:</strong>{' '}
            <a href="https://github.com/thiswillbeyourgithub/parakeet_web" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>github.com/thiswillbeyourgithub/parakeet_web</a>
          </p>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem', marginBottom: 0 }}>
            <strong>Feedback:</strong> If you have any complaint or feedback, you can reach out at{' '}
            <a href="https://olicorne.org" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>olicorne.org</a>{' '}
            or directly by{' '}
            <a href="https://github.com/thiswillbeyourgithub/parakeet_web/issues" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>opening an issue</a>{' '}
            on the GitHub repository.
          </p>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem', marginBottom: 0 }}>
            <strong>Install:</strong> You can install ParakeetWeb as a PWA (Progressive Web App) from your browser for quick, app-like access.
          </p>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem', marginBottom: 0 }}>
            <strong>Privacy:</strong> This app uses privacy-respecting analytics provided by a self-hosted{' '}
            <a href="https://umami.is" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>umami.is</a>{' '}
            instance. No personal data is collected, and no cookies are used for tracking.
          </p>
        </div>
      )}

      {showSettings && (
        <div className="settings-section">
        <p>
          <strong>Model:</strong> {repoId} <span style={{fontSize:'0.9em', color: '#666'}}>(nemo128)</span>
        </p>

          <div className="settings-content">
            <div className="setting-row">
              <span className="setting-label">
                Backend:
                <InfoTooltip text="WASM (CPU) is more compatible. WebGPU uses GPU for faster processing but requires modern browsers." />
              </span>
              <div className="setting-options">
                <label className={status.startsWith('Model ready ✔') ? 'disabled-option' : ''}>
                  <input type="radio" name="backend" value="wasm" checked={backend === 'wasm'} onChange={e => setBackend(e.target.value)} disabled={status.startsWith('Model ready ✔')} />
                  WASM (CPU)
                </label>
                <label className={status.startsWith('Model ready ✔') ? 'disabled-option' : ''}>
                  <input type="radio" name="backend" value="webgpu-hybrid" checked={backend === 'webgpu-hybrid'} onChange={e => setBackend(e.target.value)} disabled={status.startsWith('Model ready ✔')} />
                  WebGPU
                </label>
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                Encoder Quantization:
                <InfoTooltip text="int8 uses 8-bit integers for faster processing with slightly reduced quality. fp32 uses 32-bit floats for highest quality but slower." />
              </span>
              <div className="setting-options">
                <label className={status.startsWith('Model ready ✔') || backend.startsWith('webgpu') ? 'disabled-option' : ''}>
                  <input type="radio" name="encoderQuant" value="int8" checked={encoderQuant === 'int8'} onChange={e => setEncoderQuant(e.target.value)} disabled={status.startsWith('Model ready ✔') || backend.startsWith('webgpu')} />
                  int8 (faster)
                </label>
                <label className={status.startsWith('Model ready ✔') ? 'disabled-option' : ''}>
                  <input type="radio" name="encoderQuant" value="fp32" checked={encoderQuant === 'fp32'} onChange={e => setEncoderQuant(e.target.value)} disabled={status.startsWith('Model ready ✔')} />
                  fp32 (higher quality)
                </label>
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                Decoder Quantization:
                <InfoTooltip text="int8 uses 8-bit integers for faster processing with slightly reduced quality. fp32 uses 32-bit floats for highest quality but slower." />
              </span>
              <div className="setting-options">
                <label className={status.startsWith('Model ready ✔') || backend.startsWith('webgpu') ? 'disabled-option' : ''}>
                  <input type="radio" name="decoderQuant" value="int8" checked={decoderQuant === 'int8'} onChange={e => setDecoderQuant(e.target.value)} disabled={status.startsWith('Model ready ✔') || backend.startsWith('webgpu')} />
                  int8 (faster)
                </label>
                <label className={status.startsWith('Model ready ✔') ? 'disabled-option' : ''}>
                  <input type="radio" name="decoderQuant" value="fp32" checked={decoderQuant === 'fp32'} onChange={e => setDecoderQuant(e.target.value)} disabled={status.startsWith('Model ready ✔')} />
                  fp32 (higher quality)
                </label>
              </div>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                Frame Stride: {frameStride}
                <InfoTooltip text="Number of frames to skip during decoding. Higher values are faster but may reduce accuracy. Recommended: 1-2 for best quality, 3-4 for speed." />
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
                  CPU Threads: {cpuThreads}
                  <InfoTooltip text="Number of CPU threads to use for processing. More threads = faster, but limited by your CPU cores. Recommended: leave 1-2 cores free for the browser." />
                </span>
                <input 
                  type="range" 
                  min="1" 
                  max={maxCores} 
                  value={cpuThreads} 
                  onChange={e=>setCpuThreads(Number(e.target.value))} 
                  disabled={status.startsWith('Model ready ✔')}
                  style={{flexBasis: '100%', marginTop: '0.25rem', opacity: status.startsWith('Model ready ✔') ? 0.5 : 1}} 
                />
              </div>
            )}

            <div className="setting-row">
              <span className="setting-label">
                Temperature: {temperature.toFixed(1)}
                <InfoTooltip text="Decoder softmax temperature. Lower values (0.0-1.0) produce more confident/greedy output. Higher values (1.2-2.0) allow more diversity. Default: 0.0" />
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
                <input type="checkbox" checked={showConfidenceHeatmap} onChange={e => setShowConfidenceHeatmap(e.target.checked)} />
                Show Certainty Heatmap
                <InfoTooltip text="Highlights words with color-coded backgrounds based on transcription confidence. Red = low confidence, yellow = medium, green = high." />
              </label>
            </div>

            <div className="setting-row">
              <label>
                <input type="checkbox" checked={autoTranscribe} onChange={e => setAutoTranscribe(e.target.checked)} />
                Auto-transcribe after recording
                <InfoTooltip text="Automatically starts transcription when a recording is stopped. Disable to review the audio before transcribing." />
              </label>
            </div>
            <div className="setting-row">
              <label>
                <input type="checkbox" checked={autoCopyToClipboard} onChange={e => setAutoCopyToClipboard(e.target.checked)} />
                Auto-copy transcribed text to clipboard
                <InfoTooltip text="Automatically copies the transcribed text to your clipboard after transcription completes." />
              </label>
            </div>
            <div className="setting-row">
              <label>
                <input type="checkbox" checked={showAdvancedInfo} onChange={e => { setShowAdvancedInfo(e.target.checked); saveSetting('showAdvancedInfo', e.target.checked); }} />
                Show advanced info
                <InfoTooltip text="Displays system memory/heap usage, per-transcription performance metrics (RTF, timings), and detailed audio metadata." />
              </label>
            </div>
            <div className="setting-row">
              <label>
                <input type="checkbox" checked={verboseLog} onChange={e => setVerboseLog(e.target.checked)} />
                Verbose Log
                <InfoTooltip text="Enables detailed logging in browser console. Useful for debugging or performance analysis." />
              </label>
            </div>

            <div className="setting-row">
              <span className="setting-label">
                Audio Processing:
              </span>
              <div style={{ display: 'flex', flexDirection: 'row', gap: '1rem', flexWrap: 'wrap' }}>
                <label>
                  <input 
                    type="checkbox" 
                    checked={noiseSuppression} 
                    onChange={e => setNoiseSuppression(e.target.checked)} 
                    disabled={isRecording} 
                  />
                  Noise Suppression
                  <InfoTooltip text="Reduces background noise for clearer voice. Disable for music or when maximum audio fidelity is needed." />
                </label>
                <label>
                  <input 
                    type="checkbox" 
                    checked={echoCancellation} 
                    onChange={e => setEchoCancellation(e.target.checked)} 
                    disabled={isRecording} 
                  />
                  Echo Cancellation
                  <InfoTooltip text="Removes echo and feedback. Disable for music recording or if you experience audio quality issues." />
                </label>
                <label>
                  <input 
                    type="checkbox" 
                    checked={autoGainControl} 
                    onChange={e => setAutoGainControl(e.target.checked)} 
                    disabled={isRecording} 
                  />
                  Auto Gain Control
                  <InfoTooltip text="Automatically adjusts volume levels. Disable for music or when you want consistent volume." />
                </label>
              </div>
            </div>
          </div>
        
          <button 
            onClick={clearTranscriptions} 
            disabled={transcriptions.length === 0}
            style={{ marginTop: '1rem', width: '100%' }}
            className="primary"
          >
            Clear Transcription History
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
            ⚠️ Reset All Settings and Data
          </button>

          <button
            onClick={() => setShowShortcuts(prev => !prev)}
            style={{ marginTop: '0.5rem', width: '100%' }}
            className="primary"
          >
            {showShortcuts ? 'Hide' : 'Show'} Keyboard Shortcuts
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
              <strong>Keyboard Shortcuts</strong>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.4rem' }}>
                <tbody>
                  {[
                    ['S', 'Toggle settings panel'],
                    ['R / S / Space', 'Stop recording (while recording)'],
                    ['R / Space', 'Start recording'],
                    ['F', 'Select audio file'],
                    ['T', 'Start transcription'],
                    ['L', 'Load model'],
                  ].map(([key, desc]) => (
                    <tr key={key}>
                      <td style={{ padding: '0.15rem 0.5rem 0.15rem 0', fontWeight: 'bold', fontFamily: 'monospace' }}>{key}</td>
                      <td style={{ padding: '0.15rem 0' }}>{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: '#888' }}>
                Shortcuts are disabled while typing in input fields.
              </p>
            </div>
          )}
        </div>
      )}

      {showAdvancedInfo && memoryInfo && Object.keys(memoryInfo).length > 0 && (
        <div style={{ 
          fontSize: '0.85rem', 
          color: '#666', 
          marginBottom: '1rem',
          padding: '0.75rem',
          background: '#f9fafb',
          borderRadius: '4px',
          border: '1px solid #e5e7eb'
        }}>
          <strong>💾 System:</strong>{' '}
          {memoryInfo.deviceRAM && <span>RAM: {memoryInfo.deviceRAM}</span>}
          {memoryInfo.heapUsed && (
            <>
              {memoryInfo.deviceRAM && ' | '}
              <span>Heap: {memoryInfo.heapUsed} ({memoryInfo.heapPercent}%)</span>
              {parseFloat(memoryInfo.heapPercent) > 80 && (
                <span style={{ color: '#dc2626', marginLeft: '0.5rem' }}>⚠️ High</span>
              )}
            </>
          )}
          {memoryInfo.cpuCores && (
            <>
              {(memoryInfo.deviceRAM || memoryInfo.heapUsed) && ' | '}
              <span>CPU: {memoryInfo.cpuCores}</span>
            </>
          )}
          {memoryInfo.fps && (
            <>
              {' | '}
              <span>FPS: {memoryInfo.fps}</span>
              {memoryInfo.fpsWarning && (
                <span style={{ color: '#dc2626', marginLeft: '0.25rem' }}>{memoryInfo.fpsWarning}</span>
              )}
            </>
          )}
          {memoryInfo.storage && (
            <>
              <br />
              <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                Storage: {memoryInfo.storage}
              </span>
            </>
          )}
        </div>
      )}

      {/* Load Model button: visible on initial load or after failure, hidden once model is loading/ready */}
      {(status === 'Idle' || status.toLowerCase().includes('fail')) && (
        <button
          onClick={loadModel}
          className="primary"
          style={{ marginBottom: '1rem', width: '100%' }}
          data-umami-event="load_model_button"
        >
          Load Model
        </button>
      )}

      {/* Controls, transcribe button, and transcription history: hidden until model loading has been initiated */}
      {status !== 'Idle' && !status.toLowerCase().includes('fail') && (<>
      {typeof SharedArrayBuffer === 'undefined' && backend === 'wasm' && (
        <div style={{ 
          marginBottom: '1rem', 
          padding: '0.5rem', 
          backgroundColor: '#fff3cd', 
          border: '1px solid #ffeaa7',
          borderRadius: '4px',
          fontSize: '0.9em'
        }}>
          ⚠️ <strong>Performance Note:</strong> SharedArrayBuffer is not available. 
          WASM will run single-threaded. For better performance, serve over HTTPS 
          with proper headers or use WebGPU.
        </div>
      )}

      <div className="controls">
        <input 
          ref={fileInputRef}
          type="file" 
          accept="audio/*" 
          onChange={transcribeFile} 
          disabled={!status.startsWith('Model ready ✔') || isTranscribing || isRecording || isProcessingPreview}
          style={{ display: 'none' }}
          id="audio-file-input"
        />
        <label 
          htmlFor="audio-file-input"
          className="file-upload-button"
          style={{
            opacity: (!status.startsWith('Model ready ✔') || isTranscribing || isRecording || isProcessingPreview) ? 0.5 : 1,
            pointerEvents: (!status.startsWith('Model ready ✔') || isTranscribing || isRecording || isProcessingPreview) ? 'none' : 'auto',
            flex: 1
          }}
          data-umami-event="upload_file_button"
        >
          📁 Send mp3
        </label>
        <button
          onClick={(isRecording || recordingCountdown !== null) ? stopRecording : startRecordingCountdown}
          disabled={(!status.startsWith('Model ready ✔') && !isRecording && recordingCountdown === null) || isTranscribing}
          className="primary record-button"
          style={{
            background: (isRecording || recordingCountdown !== null) ? '#ef4444' : '#10b981',
            flex: 1
          }}
          data-umami-event="record_button"
        >
          {recordingCountdown !== null ? `⏱ Get Ready (${recordingCountdown})` : (isRecording ? '⏹ Stop Recording' : '🎤 Record Audio')}
        </button>
      </div>
      
      {recordingCountdown !== null && (
        <div style={{ 
          marginTop: '0.5rem', 
          padding: '1rem', 
          backgroundColor: '#fffbeb', 
          border: '2px solid #fbbf24',
          borderRadius: '8px',
          fontSize: '1.2em',
          fontWeight: 'bold',
          color: '#92400e',
          textAlign: 'center'
        }}>
          ⏱ Get ready to speak in {recordingCountdown}...
        </div>
      )}
      
      {isRecording && (
        <div style={{ 
          marginTop: '0.5rem', 
          padding: '0.5rem', 
          backgroundColor: '#fef2f2', 
          border: '1px solid #fecaca',
          borderRadius: '4px',
          fontSize: '0.9em',
          color: '#991b1b'
        }}>
          🔴 Recording in progress... Click "Stop Recording" when done.
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ 
              width: '100%', 
              height: '20px', 
              background: '#e0e0e0',
              borderRadius: '4px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${Math.min(100, audioLevel)}%`,
                height: '100%',
                background: audioLevel > 30 ? '#10b981' : '#fbbf24',
                transition: 'width 0.1s'
              }} />
            </div>
            <p style={{ fontSize: '0.8em', color: '#666', marginTop: '0.25rem', marginBottom: 0 }}>
              {audioLevel < 10 && '🔇 Too quiet - speak louder'}
              {audioLevel >= 10 && audioLevel < 30 && '🔉 Speak a bit louder'}
              {audioLevel >= 30 && '🔊 Good level'}
            </p>
          </div>
        </div>
      )}

      {/* Audio preview player */}
      {pendingAudioFile && (
        <div className="audio-preview-container">
          <div className="audio-preview-header">
            <strong>📎 {pendingAudioFile.name}</strong>
            <span style={{ fontSize: '0.8rem', color: '#6b7280', marginLeft: '0.5rem' }}>
              (16kHz mono - what the model hears)
            </span>
          </div>
          {isProcessingPreview ? (
            <div style={{ padding: '1rem', textAlign: 'center', color: '#6b7280' }}>
              ⏳ Processing audio preview...
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
                title="Clear audio file"
                aria-label="Clear audio file"
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
          disabled={!status.startsWith('Model ready ✔') || isTranscribing || !pendingAudioFile || !audioPreviewUrl || isProcessingPreview || hasBeenTranscribed}
          className="primary transcribe-button"
          style={{ marginTop: pendingAudioFile ? '0' : '1rem', marginBottom: '1rem' }}
          data-umami-event="transcribe_button"
        >
          {isTranscribing ? 'Transcribing...' : '🎯 Transcribe'}
        </button>
      )}

      {progressPct!==null && (
        <div className="progress-wrapper">
          <div className="progress-bar"><div style={{ width: `${progressPct}%` }} /></div>
          <p className="progress-text">{progressText}</p>
        </div>
      )}

      {/* Latest transcription performance info (advanced) */}
      {showAdvancedInfo && latestMetrics && (
        <div className="performance">
          <strong>RTF:</strong> {latestMetrics.rtf?.toFixed(2)}x &nbsp;|&nbsp; Total: {(latestMetrics.total_ms / 1000).toFixed(2)} s<br/>
          Preprocess {latestMetrics.preprocess_ms} ms · Encode {(latestMetrics.encode_ms / 1000).toFixed(2)} s · Decode {(latestMetrics.decode_ms / 1000).toFixed(2)} s · Tokenize {latestMetrics.tokenize_ms} ms
        </div>
      )}

      {/* Transcriptions */}
      {transcriptions.length > 0 && (
        <div className="history">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1rem 0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>Transcriptions</h3>
            <button
              onClick={() => setShowConfidenceHeatmap(!showConfidenceHeatmap)}
              className="heatmap-toggle-button"
              title={showConfidenceHeatmap ? 'Hide certainty heatmap' : 'Show certainty heatmap'}
            >
              {showConfidenceHeatmap ? '🎨 Hide Certainty' : '🎨 Show Certainty'}
            </button>
          </div>
          <div>
            {transcriptions.map((trans) => {
              // Calculate average and minimum confidence from words
              const wordConfs = trans.words?.map(w => w.confidence).filter(c => c != null) || [];
              const avgConf = wordConfs.length > 0 ? wordConfs.reduce((a, b) => a + b, 0) / wordConfs.length : null;
              const minConf = wordConfs.length > 0 ? Math.min(...wordConfs) : null;
              
              return (
                <div className="history-item" key={trans.id}>
                  <div className="history-meta">
                    <strong>{truncateFilename(trans.filename)}</strong>
                    {showAdvancedInfo && (
                      <span style={{ fontSize: '0.85em', color: '#6b7280', marginLeft: '0.5rem' }}>
                        {trans.duration.toFixed(1)}s | {trans.wordCount} words{trans.metrics && ` | RTF: ${trans.metrics.rtf?.toFixed(2)}x`}
                        {avgConf !== null && minConf !== null && ` | Avg: ${(avgConf * 100).toFixed(1)}% | Min: ${(minConf * 100).toFixed(1)}%`}
                      </span>
                    )}
                    <span>{trans.timestamp}</span>
                  </div>
                  <div className="history-text-container">
                    <div className="history-text">
                      {showConfidenceHeatmap && trans.words && trans.words.length > 0 ? (
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
                        // Fallback to plain text if heatmap is disabled or no word data
                        trans.text
                      )}
                    </div>
                    <button
                      onClick={() => copyHistoryItem(trans)}
                      className="copy-button copy-button-small"
                      title={copiedHistoryId === trans.id ? 'Copied!' : 'Copy to clipboard'}
                      aria-label="Copy to clipboard"
                    >
                      {copiedHistoryId === trans.id ? '✓' : '📋'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>)}
    </div>
  );
} 
