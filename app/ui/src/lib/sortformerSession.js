// Open the two Sortformer graphs (embed + step) as ORT sessions and wrap them
// in app/src/sortformer.js's runner. One function for both places a session is
// built: diarize.worker.js (WASM) and diarizer.js's main-thread WebGPU path,
// so the two can never drift onto different session options.
//
// Imports app/src directly (not the 'parakeet.js' alias) so the worker bundle
// stays free of the hub, as encode.worker.js does.
//
// Built with Claude Code.

import { executionProvidersFor, baseSessionOptions } from '../../../src/parakeet.js';
import { createSortformerRunner } from '../../../src/sortformer.js';

/**
 * @param {object} ort  the context's ORT module (initOrt / loadOrtModule)
 * @param {object} opts
 * @param {string} opts.backend  the app backend ('wasm', 'webgpu-hybrid', ...)
 * @param {Uint8Array} opts.embedBytes  embed.onnx
 * @param {Uint8Array} opts.stepBytes  the step graph for the backend's precision
 * @param {object} opts.config  diarization-config.json
 * @returns {Promise<{runEmbed:Function, runStep:Function, release:()=>Promise<void>}>}
 */
export async function openSortformer(ort, { backend, embedBytes, stepBytes, config }) {
  const executionProviders = executionProvidersFor(backend);
  if (!executionProviders.length) throw new Error(`diarization: unsupported backend '${backend}'`);
  const options = baseSessionOptions({ executionProviders });
  const embedSession = await ort.InferenceSession.create(embedBytes, options);
  let stepSession;
  try {
    stepSession = await ort.InferenceSession.create(stepBytes, options);
  } catch (err) {
    await embedSession.release();
    throw err;
  }
  const runner = createSortformerRunner(ort, embedSession, stepSession, {
    hidden: config.hidden_size, mels: config.num_mel_bins,
  });
  return {
    ...runner,
    release: async () => { await embedSession.release(); await stepSession.release(); },
  };
}
