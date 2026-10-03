// Speaker diarization for the API server: NVIDIA's Streaming Sortformer
// (Nemotron-3-Diarization, exported as Olicorne/Nemotron-3-Diarization-web-onnx)
// run by the browser app's own pipeline, app/src/sortformer.js, on the SAME ONNX
// Runtime the transcription model uses (owner decision: diarization shares the
// server's core, it gets no engine of its own). Nothing here re-implements the
// model: this file only finds the files, opens the sessions and calls
// diarizeProbs + probsToSegments.
//
// The sessions are opened LAZILY on the first diarizing request, so an instance
// that never diarizes never pays the step graph's load (int8 ~100 MB).
//
// Built with Claude Code.

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  openSortformer, parseSortformerData, diarizeProbs, probsToSegments, SORTFORMER_STEP_FILES,
} from '../../../app/src/sortformer.js';
import { getOrt, ortRuntimeConfig, sessionOptionsFor } from '../../transcribe.mjs';
import { unavailable } from './errors.mjs';

/** Repo name, also the folder name looked for next to / inside the ASR model dir. */
export const DIARIZATION_REPO_DIR = 'Nemotron-3-Diarization-web-onnx';
const CONFIG_FILE = 'diarization-config.json';
const SILENCE_FILE = 'silence_embeds.bin';
const EMBED_FILE = 'embed.onnx';

/**
 * Find the Sortformer model directory and check every file it needs is there.
 *
 * Without an explicit `dir`, these are tried in order (the first holding
 * diarization-config.json wins):
 *   <modelDir>/Nemotron-3-Diarization-web-onnx   one mount carrying both repos
 *   <modelDir>                                   a flat tree
 *   <modelDir>/../Nemotron-3-Diarization-web-onnx  sibling checkouts (local dev)
 *
 * @param {object} a
 * @param {string} [a.dir] explicit --diarize-model directory
 * @param {string} a.modelDir the ASR model directory
 * @param {'int8'|'fp16'|'fp32'} a.precision step graph to use
 * @returns {{dir:string, embedPath:string, stepPath:string, config:object, silenceEmbeds:Float32Array}}
 */
export function resolveDiarizationModel({ dir, modelDir, precision }) {
  const stepFile = SORTFORMER_STEP_FILES[precision];
  if (!stepFile) throw new Error(`unknown diarization precision "${precision}"`);
  const candidates = dir
    ? [dir]
    : [join(modelDir, DIARIZATION_REPO_DIR), modelDir, join(dirname(modelDir), DIARIZATION_REPO_DIR)];
  const found = candidates.find((d) => existsSync(join(d, CONFIG_FILE)));
  if (!found) {
    throw new Error(`diarization is enabled but no ${CONFIG_FILE} was found in ${candidates.join(', ')} `
      + `(set --diarize-model, or fetch it with: hf download Olicorne/${DIARIZATION_REPO_DIR})`);
  }
  const missing = [SILENCE_FILE, EMBED_FILE, stepFile].filter((f) => !existsSync(join(found, f)));
  if (missing.length) {
    throw new Error(`diarization model ${found} lacks ${missing.join(', ')}`
      + (missing.includes(stepFile) ? ` (the ${precision} step; see --diarize-precision)` : ''));
  }
  const { config, silenceEmbeds } = parseSortformerData(
    readFileSync(join(found, CONFIG_FILE)), readFileSync(join(found, SILENCE_FILE)));
  return { dir: found, embedPath: join(found, EMBED_FILE), stepPath: join(found, stepFile), config, silenceEmbeds };
}

/**
 * Create the diarizer.
 *
 * @param {object} a
 * @param {object} a.model resolveDiarizationModel() result
 * @param {string} a.ort the server's --ort backend (wasm | node | cuda)
 * @param {number} [a.threads] intra-op threads on the native backends; the
 *   WASM backend's pool is process-wide and already sized by --threads
 * @param {boolean} [a.verbose]
 */
export function createDiarizer({ model, ort: ortBackend, threads = 0, verbose = false }) {
  let runner = null; // Promise of the openSortformer() result

  function open() {
    if (runner) return runner;
    runner = (async () => {
      const ortMod = await getOrt(ortBackend);
      const { fromPath, executionProviders } = ortRuntimeConfig(ortBackend);
      // Native bindings read the graph from disk themselves; the WASM build
      // needs the bytes. No Sortformer graph has external data.
      const load = (p) => (fromPath ? p : readFileSync(p));
      return openSortformer(ortMod, {
        embed: load(model.embedPath),
        step: load(model.stepPath),
        config: model.config,
        sessionOptions: sessionOptionsFor({ executionProviders, verbose, threads, ortBackend }),
      });
    })();
    // a failed open is retried by the next request rather than cached forever
    runner.catch(() => { runner = null; });
    return runner;
  }

  /**
   * Diarize 16 kHz mono PCM.
   *
   * @param {Float32Array} pcm
   * @param {object} [opts] probsToSegments options (threshold, maxSpeakers,
   *   minDurationOn, minDurationOff)
   * @returns {Promise<Array<{start:number,end:number,speaker:number}>>}
   */
  async function run(pcm, opts = {}) {
    let r;
    try {
      r = await open();
    } catch (err) {
      throw unavailable(`diarization model failed to load: ${err.message}`);
    }
    const out = await diarizeProbs(pcm, { config: model.config, silenceEmbeds: model.silenceEmbeds, ...r });
    return probsToSegments(out, opts);
  }

  async function dispose() {
    const r = runner;
    runner = null;
    if (r) await r.then((x) => x.release(), () => {});
  }

  return { run, dispose, get started() { return runner !== null; } };
}
