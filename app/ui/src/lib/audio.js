/**
 * Audio helpers shared between local and remote-mic recording paths.
 */

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
