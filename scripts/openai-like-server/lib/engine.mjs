// The inference side of the server: model load, audio decode, transcription,
// diarization. The HTTP layer only ever sees this small interface, which is what
// lets test/http/openai-server.test.mjs drive every route with a fake engine and
// no model weights.
//
// EVERYTHING HERE IS GLUE, ON PURPOSE. The model construction, phrase-boost trie
// building and ffmpeg decode are imported from scripts/transcribe.mjs -- the same
// helpers the CLI and the WER benchmarks use -- so a transcript from this API is
// produced by exactly the same code path as `node scripts/transcribe.mjs`, and
// cannot drift from it. Only the request/response shaping is new.
//
// Built with Claude Code.

import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadParakeetModel, decodePcm, findFfmpeg } from '../../transcribe.mjs';
import { createWordlistRegistry } from './wordlists.mjs';
import { createDiarizer, resolveDiarizationModels } from './diarize.mjs';
import { badRequest } from './errors.mjs';
import { SAMPLE_RATE } from './constants.mjs';

export { SAMPLE_RATE };

/**
 * Accept either the model directory or a path to one of the .onnx files inside
 * it, so `-m /models/encoder-model.int8.onnx` works the way it does with
 * whisper.cpp. Returns the directory.
 */
export function normaliseModelDir(input) {
  if (!input) return input;
  try {
    if (statSync(input).isFile()) return dirname(input);
  } catch {
    // Fall through: a nonexistent path is reported by the caller's own check,
    // with the hf-download hint attached.
  }
  return input;
}

/**
 * Build the engine. Throws (fatally, at boot) when the weights are not there.
 *
 * @param {object} options resolved launch options
 * @returns {Promise<object>} engine
 */
export async function createEngine(options) {
  const modelDir = normaliseModelDir(options.modelDir);
  if (!existsSync(modelDir)) {
    throw new Error(
      `model directory ${modelDir} does not exist.\n`
      + '  Populate one with:  hf download Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx --local-dir ./models\n'
      + '  then point --model-dir / PARAKEET_MODEL_DIR at it (in the container: /models).',
    );
  }

  const t0 = Date.now();
  let loaded;
  try {
    loaded = await loadParakeetModel({
      model: options.model,
      modelDir,
      quant: options.quant,
      decoderQuant: options.decoderQuant,
      threads: options.threads,
      verbose: options.verbose,
      ortBackend: options.ort,
    });
  } catch (err) {
    // resolveFiles() names the missing file precisely; add the how-to-get-it.
    throw new Error(
      `${err.message}\n`
      + `  Expected ${options.quant} encoder + ${options.decoderQuant} decoder + vocab.txt in ${modelDir}.\n`
      + '  Fetch them with:  hf download Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx --local-dir ./models',
    );
  }
  const { model, tokenizer } = loaded;
  const loadMs = Date.now() - t0;

  const ffmpeg = findFfmpeg(options.ffmpeg);
  const wordlists = createWordlistRegistry({ dir: options.wordlistDir, tokenizer, verbose: options.verbose });

  // Diarization models are resolved (and their absence reported) at BOOT when
  // --diarize is the default, so a misconfigured instance fails immediately
  // rather than on the first diarizing request hours later.
  let diarizer = null;
  let diarizationModels = null;
  try {
    diarizationModels = resolveDiarizationModels({
      modelDir,
      segModel: options.diarizeSegModel,
      embModel: options.diarizeEmbModel,
    });
  } catch (err) {
    if (options.diarize) throw err;
    // Not configured for diarization: keep the reason for the 400 a request
    // asking for diarize=true will get.
    diarizationModels = { error: err.message };
  }

  function diarizerInstance() {
    if (diarizationModels.error) throw badRequest(diarizationModels.error, { param: 'diarize' });
    if (!diarizer) {
      diarizer = createDiarizer({
        segPath: diarizationModels.segPath,
        embPath: diarizationModels.embPath,
        threads: options.diarizeThreads,
        verbose: options.verbose,
      });
    }
    return diarizer;
  }

  // Pre-build the default wordlist's trie so the first request does not pay for
  // encoding a 1.7 MB list, and so a bad --wordlist is a boot error.
  if (options.wordlist || options.prompt) {
    await wordlists.get({
      name: options.wordlist,
      inline: options.prompt,
      strength: options.boostStrength,
      minp: options.boostMinp,
      depthScaling: options.depthScaling,
    });
  }

  return {
    /** Static description for /health and /v1/models. */
    info() {
      return {
        modelId: options.modelId,
        model: options.model,
        modelDir,
        quant: options.quant,
        decoderQuant: options.decoderQuant,
        ort: options.ort,
        ffmpeg,
        loadMs,
        wordlists: wordlists.list(),
        diarization: diarizationModels.error
          ? { available: false, reason: diarizationModels.error }
          : { available: true, segModel: diarizationModels.segPath, embModel: diarizationModels.embPath },
      };
    },

    /** Decode any container/codec ffmpeg can read into 16 kHz mono float32. */
    async decode(filePath) {
      try {
        return await decodePcm(ffmpeg, filePath);
      } catch (err) {
        // ffmpeg failing is virtually always a bad upload, not a server fault.
        throw badRequest(`could not decode the uploaded audio: ${err.message}`, { param: 'file' });
      }
    },

    /**
     * Transcribe PCM with per-request parameters.
     *
     * @param {object} a
     * @param {Float32Array} a.pcm
     * @param {object} a.params resolved request params
     * @returns {Promise<object>} the pipeline's own result object
     */
    async transcribe({ pcm, params }) {
      const phraseBoost = await wordlists.get({
        name: params.wordlist,
        inline: params.prompt,
        strength: params.boostStrength,
        minp: params.boostMinp,
        depthScaling: params.depthScaling,
      });
      return model.transcribeChunked(pcm, SAMPLE_RATE, {
        enableChunking: params.chunking,
        chunkDurationSec: params.chunkDuration,
        overlapSec: params.overlap,
        snapToSilenceSec: params.snapToSilence,
        phraseBoost,
        beamWidth: params.beamWidth,
        maesNumSteps: params.maesNumSteps,
        maesExpansionBeta: params.maesExpansionBeta,
        maesExpansionGamma: params.maesExpansionGamma,
        maesPrefixAlpha: params.maesPrefixAlpha,
        beamPrefetch: params.beamPrefetch,
        frameStride: params.frameStride,
        temperature: params.temperature,
        returnTimestamps: params.returnTimestamps,
        returnConfidences: params.returnConfidences,
        enableProfiling: params.verbose,
        debug: params.verbose,
      });
    },

    /** Speaker segments for the same PCM. */
    async diarize({ pcm, params }) {
      return diarizerInstance().run(pcm, {
        numSpeakers: params.numSpeakers,
        threshold: params.diarizeThreshold,
        minDurationOn: params.minDurationOn,
        minDurationOff: params.minDurationOff,
      });
    },

    /** Names a request may pass as `phrase_boost`. */
    wordlists: () => wordlists.list(),

    async dispose() {
      try { model.dispose(); } catch { /* already gone */ }
      if (diarizer) await diarizer.dispose();
    },
  };
}
