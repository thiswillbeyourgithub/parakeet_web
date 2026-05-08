/**
 * Live (streaming) transcriber.
 *
 * Reads a sliding window of recent PCM out of the shared `pcmChunksRef` that
 * both the local AudioWorklet and the phone-mic WebRTC path already feed,
 * runs the Parakeet model on it, and emits an updated word list with
 * absolute timestamps. A "commit boundary" (now - COMMIT_MARGIN) splits the
 * latest window's output into stable committed words and a replaceable
 * pending tail; once committed, words are never revised.
 *
 * Two adaptive control loops keep latency bounded without sacrificing
 * accuracy: STEP (how often we re-transcribe) and WINDOW (how much
 * acoustic context the encoder sees, in 'auto' mode only).
 */

import { resamplePcmTo16k } from './audio.js';

const COMMIT_MARGIN_SEC = 3;        // words older than (now - 3s) are committed
const STEP_MIN = 1.5, STEP_MAX = 8; // seconds
const WINDOW_MIN = 10, WINDOW_MAX = 60;
const STEP_TARGET_MS = 2000;        // budget driving WINDOW auto-sizing
const EMA_ALPHA = 0.4;              // EMA responsiveness
const HYSTERESIS = 0.10;            // ignore changes <10% to avoid flapping
const MIN_AUDIO_BEFORE_FIRST_TICK = 3; // seconds — short windows transcribe poorly

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ema = (prev, sample, alpha = EMA_ALPHA) => prev == null ? sample : prev + alpha * (sample - prev);

/**
 * Create a live transcriber.
 *
 * @param {Object} cfg
 * @param {Object} cfg.model            ParakeetModel instance (with transcribe()).
 * @param {() => Float32Array[]} cfg.getPcmChunks  Returns the live chunk array.
 * @param {() => number} cfg.getSampleRate         Returns source sample rate (Hz).
 * @param {'auto'|number} cfg.windowMode  'auto' or a fixed window size in seconds (10..60).
 * @param {(state: {text: string, words: Object[]}) => void} cfg.onUpdate
 * @param {(stats: Object) => void} [cfg.onStats]
 * @returns {{ start: () => void, stop: () => Promise<void>, getState: () => Object }}
 */
export function createLiveTranscriber(cfg) {
  const {
    model,
    getPcmChunks,
    getSampleRate,
    windowMode,
    onUpdate,
    onStats,
  } = cfg;

  let stopped = false;
  let running = false;        // a transcribe() call is currently in flight
  let timer = null;

  let currentStep = 3;        // seconds — initial cadence
  let currentWindow = (windowMode === 'auto' ? 15 : clamp(Number(windowMode), WINDOW_MIN, WINDOW_MAX));
  let emaProcessMs = null;
  let emaCostPerS = null;     // ms of compute per second of audio in window

  /** @type {Object[]} */ let committedWords = [];
  /** @type {Object[]} */ let pendingWords = [];

  function setWindow(modeOrSec) {
    if (modeOrSec === 'auto') return;
    const n = Number(modeOrSec);
    if (Number.isFinite(n)) currentWindow = clamp(n, WINDOW_MIN, WINDOW_MAX);
  }

  function copyTailSamples(chunks, samplesNeeded) {
    const out = new Float32Array(samplesNeeded);
    let need = samplesNeeded;
    let dst = samplesNeeded;
    for (let i = chunks.length - 1; i >= 0 && need > 0; i--) {
      const c = chunks[i];
      const take = Math.min(need, c.length);
      dst -= take;
      need -= take;
      out.set(c.subarray(c.length - take), dst);
    }
    return out;
  }

  function adaptStep(processMs) {
    const desired = clamp(processMs * 1.5 / 1000, STEP_MIN, STEP_MAX);
    if (Math.abs(desired - currentStep) / currentStep > HYSTERESIS) currentStep = desired;
  }

  function adaptWindow() {
    if (windowMode !== 'auto' || emaCostPerS == null) return;
    // Budget: keep predicted process time at ~half the step target.
    const windowMaxBudget = (STEP_TARGET_MS * 0.5) / Math.max(emaCostPerS, 1);
    const target = clamp(windowMaxBudget, WINDOW_MIN, WINDOW_MAX);
    if (target > currentWindow + 0.5) currentWindow = Math.min(currentWindow + 1, WINDOW_MAX);
    else if (target < currentWindow - 0.5) currentWindow = Math.max(currentWindow - 1, WINDOW_MIN);
  }

  function applyCommit(windowWords, windowStartAbs, windowSec) {
    // Boundary: the right edge of the window minus COMMIT_MARGIN. Words
    // ending before this had at least COMMIT_MARGIN seconds of right-context
    // when transcribed and are considered stable.
    const commitBoundary = windowStartAbs + windowSec - COMMIT_MARGIN_SEC;
    const lastCommittedEnd = committedWords.length
      ? committedWords[committedWords.length - 1].end_time
      : -Infinity;

    const fresh = [];
    const pend = [];
    for (const w of windowWords) {
      if (w.end_time < commitBoundary) fresh.push(w);
      else pend.push(w);
    }
    // Only append words that genuinely advance the timeline.
    for (const w of fresh) {
      if (w.start_time + 1e-3 >= lastCommittedEnd) committedWords.push(w);
    }
    pendingWords = pend;
  }

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const sr = getSampleRate();
      const chunks = getPcmChunks();
      const totalSamples = chunks.reduce((n, c) => n + c.length, 0);
      const totalSec = totalSamples / sr;
      if (totalSec < MIN_AUDIO_BEFORE_FIRST_TICK) return;

      const windowSec = Math.min(currentWindow, totalSec);
      const windowSamples = Math.ceil(windowSec * sr);
      const windowStartAbs = totalSec - windowSec;

      const tail = copyTailSamples(chunks, windowSamples);
      const pcm16k = await resamplePcmTo16k(tail, sr);

      const t0 = performance.now();
      const result = await model.transcribe(pcm16k, 16000, {
        returnTimestamps: true,
        timeOffset: windowStartAbs,
      });
      const processMs = performance.now() - t0;

      emaProcessMs = ema(emaProcessMs, processMs);
      emaCostPerS = ema(emaCostPerS, processMs / windowSec);
      adaptStep(emaProcessMs);
      adaptWindow();

      applyCommit(result.words || [], windowStartAbs, windowSec);
      const allWords = committedWords.concat(pendingWords);
      const text = allWords.map(w => w.text).join(' ');
      onUpdate({ text, words: allWords });
      onStats?.({
        window: currentWindow,
        step: currentStep,
        process_ms: processMs,
        ema_process_ms: emaProcessMs,
        ema_cost_per_s: emaCostPerS,
        committed: committedWords.length,
        pending: pendingWords.length,
      });

      console.log(
        `[Live] window=${currentWindow.toFixed(1)}s step=${currentStep.toFixed(1)}s ` +
        `process=${processMs.toFixed(0)}ms cost/s=${(emaCostPerS || 0).toFixed(0)}ms ` +
        `committed=${committedWords.length} pending=${pendingWords.length}`
      );
    } catch (e) {
      console.warn('[Live] tick failed:', e);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, currentStep * 1000);
    }
  }

  return {
    start() {
      if (timer) return;
      stopped = false;
      timer = setTimeout(tick, currentStep * 1000);
    },
    async stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      // If a tick is in-flight, give it a moment to settle so we don't race
      // with the canonical stop-pass that runs right after.
      while (running) await new Promise(r => setTimeout(r, 50));
      const allWords = committedWords.concat(pendingWords);
      return { text: allWords.map(w => w.text).join(' '), words: allWords };
    },
    setWindow,
    getState() {
      const allWords = committedWords.concat(pendingWords);
      return { text: allWords.map(w => w.text).join(' '), words: allWords };
    },
  };
}
