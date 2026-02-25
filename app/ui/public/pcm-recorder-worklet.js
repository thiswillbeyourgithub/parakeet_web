/**
 * AudioWorklet processor that captures raw PCM samples from the microphone
 * and forwards them to the main thread via postMessage.
 *
 * This bypasses MediaRecorder's Opus codec entirely, eliminating the ~26.5ms
 * priming delay that causes the first word of recordings to be garbled.
 * Each message contains a Float32Array copy of 128 samples (one render quantum).
 */
class PCMRecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      // Channel 0 = mono; copy so the buffer doesn't get recycled
      this.port.postMessage(new Float32Array(input[0]));
    }
    return true; // Keep processor alive
  }
}

registerProcessor('pcm-recorder-processor', PCMRecorderProcessor);
