// Which Sortformer step precision a backend runs (lib/diarizationModels.js
// does the downloading; the repo layout and data-file parsing live in
// app/src/sortformer.js, shared with the server). Kept apart from
// diarizationModels.js because that module imports the hub through the
// 'parakeet.js' build alias, which Node unit tests cannot resolve.
//
// Built with Claude Code.

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
