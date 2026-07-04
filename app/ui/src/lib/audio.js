/**
 * Audio helpers shared between local and remote-mic recording paths.
 */

/**
 * Attach an RMS level monitor to an AudioContext source. The monitor
 * pumps a 0..100 "level" value to `onLevel` once per animation frame
 * until `stop()` is called.
 *
 * @param {AudioContext} audioCtx Context to create the AnalyserNode in.
 * @param {AudioNode} sourceNode Source to analyse (must be in the same graph).
 * @param {(level: number) => void} onLevel Level callback.
 * @returns {{ stop: () => void }} Handle whose stop() ends the rAF loop.
 */
export function createLevelMonitor(audioCtx, sourceNode, onLevel) {
  const analyser = audioCtx.createAnalyser();
  sourceNode.connect(analyser);
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  const dataArray = new Uint8Array(analyser.fftSize);
  let running = true;
  const tick = () => {
    analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    onLevel(Math.min(100, rms * 250));
    if (running) requestAnimationFrame(tick);
  };
  tick();
  return { stop: () => { running = false; } };
}

/**
 * Build the ordered list of sample rates to try when opening the recording
 * AudioContext. Best candidate first.
 *
 * We want to capture at the mic's NATIVE rate so the recording context matches
 * the mic; the offline resamplePcmTo16k pass then owns the 16 kHz conversion
 * (a dedicated OfflineAudioContext with no live-stream rate mismatch). Chromium
 * reports the native rate via getSettings().sampleRate, so it is tried first.
 * Firefox reports NOTHING there, so we fall back to the browser default (which
 * IS the native rate) BEFORE the SpeechMike-specific low rates.
 *
 * Why the order matters: forcing a low rate (e.g. 16 kHz) on a normal Firefox
 * mic used to be the first attempt (reportedRate was undefined, so 16000 led
 * the list). Firefox no longer throws when the context rate mismatches the mic
 * rate; it silently relabels the downsampled stream, so a 48 kHz mic captured
 * in a 16 kHz context came out ~3x SLOWED DOWN (the WAV declared 16 kHz while
 * carrying 48 kHz-worth of samples). See mdn/browser-compat-data #16213.
 * Trying the browser default first keeps Firefox on the native rate and avoids
 * the mismatch entirely. The SpeechMike rates (16k/22.05k/44.1k) stay as
 * fallbacks for devices whose native rate the browser default cannot open
 * (connecting AudioNodes across mismatched rates can still throw there, which
 * the caller's try/catch skips past).
 *
 * `undefined` in the returned array means "browser default (no sampleRate
 * option)". The caller passes `rate ? { sampleRate: rate } : undefined` to the
 * AudioContext constructor and reads back the actual ctx.sampleRate.
 *
 * @param {number|undefined} reportedRate settings.sampleRate, or undefined.
 * @returns {Array<number|undefined>} Sample rates to try, best first.
 */
export function buildRecordingRateCandidates(reportedRate) {
  const out = [];
  const push = (r) => { if (!out.some((x) => x === r)) out.push(r); };
  push(reportedRate || undefined); // mic's reported native rate, if the browser gives one
  push(undefined);                 // browser default (== native rate when unknown, e.g. Firefox)
  for (const r of [16000, 22050, 44100, 48000]) push(r); // SpeechMike-specific fallbacks
  return out;
}

/**
 * Resample a Float32 PCM buffer to 16kHz mono via OfflineAudioContext.
 * If the source is already 16kHz, returns the input unchanged.
 *
 * @param {Float32Array} pcm Mono PCM samples.
 * @param {number} sourceSampleRate Source sample rate in Hz.
 * @returns {Promise<Float32Array>} 16kHz mono samples.
 */
export async function resamplePcmTo16k(pcm, sourceSampleRate) {
  const targetSampleRate = 16000;
  if (sourceSampleRate === targetSampleRate) return pcm;
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil((pcm.length / sourceSampleRate) * targetSampleRate),
    targetSampleRate
  );
  const buf = offlineCtx.createBuffer(1, pcm.length, sourceSampleRate);
  buf.getChannelData(0).set(pcm);
  const src = offlineCtx.createBufferSource();
  src.buffer = buf;
  src.connect(offlineCtx.destination);
  src.start();
  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}
