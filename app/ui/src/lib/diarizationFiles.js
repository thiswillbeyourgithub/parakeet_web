// Pure helpers for the Sortformer diarization files (lib/diarizationModels.js
// does the downloading): which step precision a backend runs, where each
// precision lives in the model repo, and parsing the repo's two data files.
// Kept apart from diarizationModels.js because that module imports the hub
// through the 'parakeet.js' build alias, which Node unit tests cannot resolve.
//
// Built with Claude Code.

/** The step graph for each precision, as laid out in the model repo. */
export const DIARIZATION_STEP_FILES = {
  int8: 'int8/step.int8.onnx',
  fp16: 'fp16/step.fp16.onnx',
  fp32: 'fp32/step.onnx',
};

/**
 * Which step precision a backend runs. WASM has no fp16 kernels and int8 is a
 * quarter of the fp32 download at 99.97% decision agreement (model repo
 * README); WebGPU runs fp16 where the adapter has shader-f16 and fp32
 * elsewhere, as the ASR encoder does.
 *
 * @param {string} backend 'wasm' | 'webgpu' | 'webgpu-hybrid' | ...
 * @param {boolean|null} shaderF16 the adapter probe's answer
 * @returns {'int8'|'fp16'|'fp32'}
 */
export function diarizationPrecision(backend, shaderF16) {
  if (!String(backend || '').startsWith('webgpu')) return 'int8';
  return shaderF16 === true ? 'fp16' : 'fp32';
}

/**
 * Parse the repo's two data files. Pure, so the unit test can pin the checks.
 * @param {Uint8Array} configBytes diarization-config.json
 * @param {Uint8Array} silenceBytes silence_embeds.bin
 * @returns {{config: object, silenceEmbeds: Float32Array}}
 */
export function parseDiarizationData(configBytes, silenceBytes) {
  const config = JSON.parse(new TextDecoder().decode(configBytes));
  for (const k of ['hidden_size', 'num_mel_bins', 'num_speakers', 'subsampling_factor', 'offline', 'speaker_cache']) {
    if (config[k] == null) throw new Error(`diarization-config.json lacks "${k}"`);
  }
  if (silenceBytes.byteLength !== config.hidden_size * 4) {
    throw new Error(`silence_embeds.bin is ${silenceBytes.byteLength} bytes, expected ${config.hidden_size * 4}`);
  }
  // copy: the hub may hand back a view into a larger, unaligned buffer
  const silenceEmbeds = new Float32Array(silenceBytes.slice().buffer);
  return { config, silenceEmbeds };
}
