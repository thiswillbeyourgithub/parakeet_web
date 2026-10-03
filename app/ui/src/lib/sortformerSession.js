// The browser's Sortformer session contract: app/src/sortformer.js's
// openSortformer with the app-wide ORT session options for the app backend.
// One function for both places a browser session is built, diarize.worker.js
// (WASM) and diarizer.js's main-thread WebGPU path, so the two can never drift
// onto different options.
//
// Imports app/src directly (not the 'parakeet.js' alias) so the worker bundle
// stays free of the hub, as encode.worker.js does.
//
// Built with Claude Code.

import { executionProvidersFor, baseSessionOptions } from '../../../src/parakeet.js';
import { openSortformer } from '../../../src/sortformer.js';

/**
 * @param {object} ort  the context's ORT module (initOrt / loadOrtModule)
 * @param {object} opts
 * @param {string} opts.backend  the app backend ('wasm', 'webgpu-hybrid', ...)
 * @param {Uint8Array} opts.embedBytes  embed.onnx
 * @param {Uint8Array} opts.stepBytes  the step graph for the backend's precision
 * @param {object} opts.config  diarization-config.json
 * @returns {Promise<{runEmbed:Function, runStep:Function, release:()=>Promise<void>}>}
 */
export function openBrowserSortformer(ort, { backend, embedBytes, stepBytes, config }) {
  const executionProviders = executionProvidersFor(backend);
  if (!executionProviders.length) throw new Error(`diarization: unsupported backend '${backend}'`);
  return openSortformer(ort, {
    embed: embedBytes, step: stepBytes, config,
    sessionOptions: baseSessionOptions({ executionProviders }),
  });
}
