// Speaker diarization with NVIDIA's Nemotron-3-Diarization (Streaming
// Sortformer), shared by the browser app and the OpenAI-like Node server.
//
// The model repo (Olicorne/Nemotron-3-Diarization-web-onnx) ships the network
// as two graphs: embed.onnx (feature stacking + projection, frame-local) and
// step.onnx (one chunk through the 31-layer encoder + head). Everything with
// state lives here instead, ported line for line from the transformers
// reference (`Nemotron3DiarizationForAudioFrameClassification.forward` and
// `Nemotron3DiarizationSpeakerCache`): the chunk loop, the Arrival-Order
// Speaker Cache, the FIFO and the cache compression. The model repo's
// scripts/verify-onnx.py checks the graphs against that reference with the
// cache flow included; test/unit/sortformer*.test.mjs check this port against
// it.
//
// This module is runtime-agnostic: callers pass `runEmbed`/`runStep`
// functions (see createSortformerRunner for the ORT glue), so the same code
// runs on onnxruntime-web (worker or main thread) and onnxruntime-node.
//
// Built with Claude Code.

import { JsPreprocessor } from './mel.js';

export const SORTFORMER_SAMPLE_RATE = 16000;
const HOP = 160;           // mel hop (10 ms)
const N_MELS = 128;
// computeRawMel pads 256 zero samples on each side and pre-emphasis reads the
// previous sample, so a frame is exact only when its window (and that one
// sample before it) lies inside the slice it was computed from. Three hops of
// margin on each side cover the 256-sample half window plus that sample.
const MEL_MARGIN_FRAMES = 3;

/**
 * Raw log-mel features of `pcm` for mel frames [f0, f1), frame-major
 * ([f1 - f0, 128]), identical to the same frames of one whole-clip pass.
 * Computing in slices keeps memory bounded on long recordings (a whole-clip
 * pass would hold a Float64 copy of the PCM plus every frame at once).
 *
 * The reference feature extractor zeroes every frame at or past floor(N/160)
 * (its attention mask), which is the last frame of a centered STFT. Mirrored.
 */
export function melFrames(pre, pcm, f0, f1) {
  const n = pcm.length;
  const validFrames = Math.floor(n / HOP);
  const m0 = Math.max(0, f0 - MEL_MARGIN_FRAMES);
  const s0 = m0 * HOP;
  const s1 = Math.min(n, (f1 + MEL_MARGIN_FRAMES) * HOP);
  const { rawMel, nFrames } = pre.computeRawMel(pcm.subarray(s0, s1));
  const out = new Float32Array((f1 - f0) * N_MELS);
  for (let f = f0; f < f1 && f < validFrames; f++) {
    const t = f - m0;
    if (t >= nFrames) break;
    const row = (f - f0) * N_MELS;
    for (let m = 0; m < N_MELS; m++) out[row + m] = rawMel[m * nFrames + t];
  }
  return out;
}

/** Number of 10 ms mel frames a clip of `numSamples` yields (centered STFT). */
export function numMelFrames(numSamples) {
  return Math.floor(numSamples / HOP) + 1;
}

// Comparator for a descending sort that stays consistent on infinite scores.
function byScoreDesc(x, y) {
  return x > y ? -1 : x < y ? 1 : 0;
}

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

/**
 * Port of transformers' Nemotron3DiarizationSpeakerCache for batch size 1.
 * Frames are rows of `hidden` floats; probabilities rows of `numSpeakers`.
 */
export class SpeakerCache {
  /**
   * @param {object} cfg  the model repo's diarization-config.json
   * @param {{fifoLength:number, updatePeriod:number}} sizes  offline or streaming FIFO sizes
   * @param {Float32Array} silenceEmbeds  [hidden]
   */
  constructor(cfg, { fifoLength, updatePeriod }, silenceEmbeds) {
    const sc = cfg.speaker_cache;
    this.hidden = cfg.hidden_size;
    this.numSpeakers = cfg.num_speakers;
    this.factor = cfg.subsampling_factor;
    this.fifoLength = fifoLength;
    this.updatePeriod = updatePeriod;
    this.cacheLength = sc.length;
    this.numSilence = sc.silence_frames_per_speaker;
    this.threshold = sc.prediction_score_threshold;
    this.latestBoost = sc.latest_frames_score_boost;
    const budget = Math.floor(this.cacheLength / this.numSpeakers) - this.numSilence;
    this.minPositive = Math.floor(budget * sc.min_positive_scores_rate);
    this.numStrong = Math.floor(budget * sc.strong_boost_rate);
    this.numWeak = Math.floor(budget * sc.weak_boost_rate);
    this.silence = silenceEmbeds;
    // Arrays of per-frame rows: simple, and the sizes are a few hundred frames.
    this.cacheEmbeds = [];
    this.cacheProbs = [];
    this.fifo = [];
    this.isCompressed = false;
  }

  /** Embeds of [cache | FIFO], the frames every chunk attends to before itself. */
  cachedRows() {
    return this.cacheEmbeds.concat(this.fifo);
  }

  // Speaker probabilities at the encoder frame rate: sigmoid then mean over
  // each group of `factor` upsampled logit rows.
  poolProbs(logits, numRows) {
    const S = this.numSpeakers;
    const f = this.factor;
    const out = [];
    for (let r = 0; r < numRows; r++) {
      const p = new Float64Array(S);
      for (let j = 0; j < f; j++) {
        const base = (r * f + j) * S;
        for (let s = 0; s < S; s++) p[s] += sigmoid(logits[base + s]);
      }
      for (let s = 0; s < S; s++) p[s] /= f;
      out.push(p);
    }
    return out;
  }

  /**
   * Push a processed chunk, moving FIFO overflow into the cache and compressing
   * it when it outgrows its capacity.
   * @param {Array<Float32Array>} inputRows  the step's input frames: cache, FIFO, chunk, look-ahead
   * @param {Float32Array} logits  the step's logits, [rows * factor, numSpeakers]
   * @param {number} numChunkFrames  chunk frames (the look-ahead after them is fed again next step)
   */
  update(inputRows, logits, numChunkFrames) {
    const numCache = this.cacheEmbeds.length;
    const numFifo = this.fifo.length;
    const probs = this.poolProbs(logits, inputRows.length);
    const chunkStart = numCache + numFifo;
    let fifoEmbeds = this.fifo.concat(inputRows.slice(chunkStart, chunkStart + numChunkFrames));

    const numPopped = this.numPopped(fifoEmbeds.length);
    if (numPopped) {
      const fifoProbs = probs.slice(numCache, numCache + fifoEmbeds.length);
      // an uncompressed cache still holds plain chunk frames, whose probabilities
      // this step re-estimates; a compressed one is out of order, so the probs
      // stored alongside its frames are the only ones
      const storedProbs = this.isCompressed ? this.cacheProbs : probs.slice(0, numCache);
      let cacheEmbeds = this.cacheEmbeds.concat(fifoEmbeds.slice(0, numPopped));
      let cacheProbs = storedProbs.concat(fifoProbs.slice(0, numPopped));
      fifoEmbeds = fifoEmbeds.slice(numPopped);
      if (cacheEmbeds.length > this.cacheLength) {
        [cacheEmbeds, cacheProbs] = this.compress(cacheEmbeds, cacheProbs);
        this.isCompressed = true;
      }
      this.cacheEmbeds = cacheEmbeds;
      this.cacheProbs = cacheProbs;
    }
    this.fifo = fifoEmbeds;
  }

  // No frames move to the cache until the FIFO overflows; then at least
  // `updatePeriod` oldest frames move, plus whatever restores FIFO capacity.
  numPopped(numFifoFrames) {
    if (numFifoFrames <= this.fifoLength) return 0;
    return Math.min(Math.max(this.updatePeriod, numFifoFrames - this.fifoLength), numFifoFrames);
  }

  frameScores(probs) {
    const S = this.numSpeakers;
    const thr = this.threshold;
    const F = probs.length;
    const scores = probs.map(() => new Float64Array(S));
    const positives = new Int32Array(S);
    for (let f = 0; f < F; f++) {
      const p = probs[f];
      let sumComp = 0;
      const logComp = new Float64Array(S);
      for (let s = 0; s < S; s++) { logComp[s] = Math.log(Math.max(1 - p[s], thr)); sumComp += logComp[s]; }
      for (let s = 0; s < S; s++) {
        const v = p[s] > 0.5
          ? Math.log(Math.max(p[s], thr)) - logComp[s] + sumComp - Math.log(0.5)
          : -Infinity;
        scores[f][s] = v;
        if (v > 0) positives[s]++;
      }
    }
    // a speaker with enough positive-score frames keeps only those
    for (let s = 0; s < S; s++) {
      if (positives[s] < this.minPositive) continue;
      for (let f = 0; f < F; f++) {
        if (probs[f][s] > 0.5 && !(scores[f][s] > 0)) scores[f][s] = -Infinity;
      }
    }
    return scores;
  }

  // Add `boost` to each speaker's `k` highest-scoring frames.
  boostScores(scores, k, boost) {
    const F = scores.length;
    for (let s = 0; s < this.numSpeakers; s++) {
      // descending by score; not `b - a`, which is NaN between two -inf scores
      // and an inconsistent comparator leaves the WHOLE order unspecified
      const order = Array.from({ length: F }, (_, f) => f).sort((a, b) => byScoreDesc(scores[a][s], scores[b][s]) || a - b);
      for (let i = 0; i < k && i < F; i++) scores[order[i]][s] += boost;
    }
  }

  /**
   * Keep the `cacheLength` most important frames, grouped by speaker and in
   * their original order within a speaker; each speaker's silence slot holds
   * the learned silence embedding.
   */
  compress(embeds, probs) {
    const S = this.numSpeakers;
    const F = probs.length;
    const scores = this.frameScores(probs);
    // frames beyond the cache capacity are the ones popped from the FIFO
    for (let f = this.cacheLength; f < F; f++) {
      for (let s = 0; s < S; s++) scores[f][s] += this.latestBoost;
    }
    this.boostScores(scores, this.numStrong, -2 * Math.log(0.5));
    this.boostScores(scores, this.numWeak, -Math.log(0.5));

    // Flatten speaker-major over F + numSilence frames, silence frames scoring
    // +inf, and keep the top `cacheLength`. Ranked candidates scoring -inf turn
    // into the silence frame. Sorting the kept flat indices gives speaker-major
    // order with frames ascending within a speaker.
    const rows = F + this.numSilence;
    const flat = [];
    for (let s = 0; s < S; s++) {
      for (let f = 0; f < rows; f++) flat.push({ idx: s * rows + f, score: f < F ? scores[f][s] : Infinity });
    }
    flat.sort((a, b) => byScoreDesc(a.score, b.score) || a.idx - b.idx);
    const sentinel = rows * S;
    const kept = flat.slice(0, this.cacheLength)
      .map(({ idx, score }) => (score === -Infinity ? sentinel : idx))
      .sort((a, b) => a - b);
    const zero = new Float64Array(S);
    const outEmbeds = [];
    const outProbs = [];
    for (const idx of kept) {
      const frame = idx === sentinel ? F : Math.min(idx % rows, F);
      outEmbeds.push(frame === F ? this.silence : embeds[frame]);
      outProbs.push(frame === F ? zero : probs[frame]);
    }
    return [outEmbeds, outProbs];
  }
}

/**
 * Encoder-rate embeddings of a whole clip: raw log-mel, then embed.onnx, in
 * slices aligned to `subsampling_factor` mel frames (the projection only ever
 * sees one group of that many frames, so slicing is exact).
 *
 * @returns {Promise<{embeds:Float32Array, numEmbeds:number, numFrames:number}>}
 */
export async function embedClip(pcm, { config, runEmbed }) {
  const factor = config.subsampling_factor;
  const hidden = config.hidden_size;
  const numFrames = numMelFrames(pcm.length);
  const numEmbeds = Math.ceil(numFrames / factor);
  const embeds = new Float32Array(numEmbeds * hidden);
  const pre = new JsPreprocessor({ nMels: N_MELS });
  const sliceFrames = config.offline.chunk_length * factor;
  for (let f0 = 0; f0 < numFrames; f0 += sliceFrames) {
    const f1 = Math.min(numFrames, f0 + sliceFrames);
    const out = await runEmbed(melFrames(pre, pcm, f0, f1), f1 - f0);
    embeds.set(out, (f0 / factor) * hidden);
  }
  return { embeds, numEmbeds, numFrames };
}

/**
 * The offline chunk loop over precomputed embeddings: transformers' forward
 * with no `speaker_cache` and no look-ahead argument.
 *
 * @returns {Promise<Float32Array>} probs [numFrames, numSpeakers]
 */
export async function chunkProbs(embeds, numEmbeds, numFrames, { config, silenceEmbeds, runStep, onProgress }) {
  const factor = config.subsampling_factor;
  const hidden = config.hidden_size;
  const S = config.num_speakers;
  const { chunk_length: chunkLength, chunk_right_context: rightContext,
    fifo_length: fifoLength, speaker_cache_update_period: updatePeriod } = config.offline;
  const row = (t) => embeds.subarray(t * hidden, (t + 1) * hidden);

  const cache = new SpeakerCache(config, { fifoLength, updatePeriod }, silenceEmbeds);
  const probs = new Float32Array(numFrames * S);
  const total = Math.ceil(numEmbeds / chunkLength);
  let written = 0;
  for (let start = 0, done = 0; start < numEmbeds; start += chunkLength, done++) {
    const end = Math.min(start + chunkLength, numEmbeds);
    const numChunkFrames = end - start;
    const inputRows = cache.cachedRows();
    const cachedLength = inputRows.length;
    for (let t = start; t < Math.min(end + rightContext, numEmbeds); t++) inputRows.push(row(t));

    // same array type as `embeds` (Float32 from embedClip; tests pass Float64)
    const input = new embeds.constructor(inputRows.length * hidden);
    inputRows.forEach((r, i) => input.set(r, i * hidden));
    const logits = await runStep(input, inputRows.length);
    cache.update(inputRows, logits, numChunkFrames);

    // this chunk's own rows, minus the cache before and the look-ahead after;
    // with no look-ahead the last row may be feature-stacking padding
    const from = cachedLength * factor;
    const to = Math.min((cachedLength + numChunkFrames) * factor, from + numFrames - written);
    for (let r = from; r < to; r++, written++) {
      for (let s = 0; s < S; s++) probs[written * S + s] = sigmoid(logits[r * S + s]);
    }
    if (onProgress) onProgress({ done: done + 1, total });
  }
  return probs;
}

/**
 * Speaker-activity probabilities for a whole recording (offline mode).
 *
 * @param {Float32Array} pcm  mono 16 kHz
 * @param {object} opts
 * @param {object} opts.config  diarization-config.json
 * @param {Float32Array} opts.silenceEmbeds  [hidden]
 * @param {(features:Float32Array, numFrames:number)=>Promise<Float32Array>} opts.runEmbed
 *   raw log-mel [numFrames, 128] -> embeds [ceil(numFrames/8), hidden]
 * @param {(embeds:Float32Array, numRows:number)=>Promise<Float32Array>} opts.runStep
 *   embeds [numRows, hidden] -> logits [numRows * 8, numSpeakers]
 * @param {(p:{done:number,total:number})=>void} [opts.onProgress]  per chunk
 * @returns {Promise<{probs:Float32Array, numFrames:number, numSpeakers:number, frameSec:number}>}
 *   probs [numFrames, numSpeakers], one row per 10 ms mel frame
 */
export async function diarizeProbs(pcm, opts) {
  const { embeds, numEmbeds, numFrames } = await embedClip(pcm, opts);
  const probs = await chunkProbs(embeds, numEmbeds, numFrames, opts);
  return { probs, numFrames, numSpeakers: opts.config.num_speakers, frameSec: HOP / SORTFORMER_SAMPLE_RATE };
}

/**
 * Turn per-frame probabilities into speaker segments.
 *
 * A frame counts as speech of a speaker when its probability exceeds
 * `threshold` (the reference post-processing). With `maxSpeakers` set and more
 * speakers detected, the most active `maxSpeakers` are kept and each dropped
 * speaker's active frames go to whichever kept speaker is most probable at that
 * frame. Per speaker, gaps shorter than `minDurationOff` are bridged, then
 * turns shorter than `minDurationOn` dropped. Speakers are renumbered 0.. in
 * order of first appearance (which is the model's own channel order).
 *
 * @returns {Array<{start:number,end:number,speaker:number}>} sorted by start
 */
export function probsToSegments({ probs, numFrames, numSpeakers, frameSec }, {
  threshold = 0.5, maxSpeakers = 0, minDurationOn = 0.3, minDurationOff = 0.5,
} = {}) {
  const S = numSpeakers;
  const active = new Uint8Array(numFrames * S);
  const activity = new Float64Array(S);
  for (let i = 0; i < numFrames * S; i++) {
    if (probs[i] > threshold) { active[i] = 1; activity[i % S]++; }
  }
  const present = [];
  for (let s = 0; s < S; s++) if (activity[s] > 0) present.push(s);

  let kept = present;
  if (maxSpeakers > 0 && present.length > maxSpeakers) {
    kept = [...present].sort((a, b) => activity[b] - activity[a] || a - b)
      .slice(0, maxSpeakers).sort((a, b) => a - b);
    const keptSet = new Set(kept);
    for (let t = 0; t < numFrames; t++) {
      const base = t * S;
      let dropped = false;
      for (const s of present) {
        if (!keptSet.has(s) && active[base + s]) { active[base + s] = 0; dropped = true; }
      }
      if (!dropped) continue;
      let best = kept[0];
      for (const s of kept) if (probs[base + s] > probs[base + best]) best = s;
      active[base + best] = 1;
    }
  }

  const minOnFrames = minDurationOn / frameSec;
  const minOffFrames = minDurationOff / frameSec;
  const segments = [];
  // labels go to speakers with a surviving turn only, so smoothing away a
  // speaker's every turn cannot leave a hole in the numbering
  let label = 0;
  for (const s of kept) {
    const runs = [];
    for (let t = 0; t < numFrames;) {
      if (!active[t * S + s]) { t++; continue; }
      let e = t;
      while (e < numFrames && active[e * S + s]) e++;
      const last = runs[runs.length - 1];
      if (last && t - last[1] < minOffFrames) last[1] = e;
      else runs.push([t, e]);
      t = e;
    }
    const before = segments.length;
    for (const [a, b] of runs) {
      if (b - a < minOnFrames) continue;
      segments.push({ start: a * frameSec, end: b * frameSec, speaker: label });
    }
    if (segments.length > before) label++;
  }
  segments.sort((x, y) => x.start - y.start || x.speaker - y.speaker);
  return segments;
}

/**
 * ORT glue: build `runEmbed`/`runStep` from two sessions. `ort` is the caller's
 * runtime module (onnxruntime-web or onnxruntime-node), so this file never
 * imports one and can never end up on a second, unconfigured ORT instance.
 */
export function createSortformerRunner(ort, embedSession, stepSession, { hidden = 512, mels = N_MELS } = {}) {
  return {
    async runEmbed(features, numFrames) {
      const out = await embedSession.run({ features: new ort.Tensor('float32', features, [1, numFrames, mels]) });
      return out.embeds.data;
    },
    async runStep(embeds, numRows) {
      const out = await stepSession.run({ embeds: new ort.Tensor('float32', embeds, [1, numRows, hidden]) });
      return out.logits.data;
    },
  };
}
