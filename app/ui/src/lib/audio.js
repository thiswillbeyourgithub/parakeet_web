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
