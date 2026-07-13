import { initOrt } from './backend.js';
import { ParakeetTokenizer } from './tokenizer.js';
import { OnnxPreprocessor } from './preprocessor.js';
import { JsPreprocessor } from './mel.js';

/**
 * Normalise an external-weights source into the ORT `externalData` array.
 *
 * A model's weights live either in a single `<model>.data` sidecar or, for a
 * sharded fp32 encoder (parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/shard-fp32.py), across several
 * `<model>.data.000/.001/...` files, each kept under the 2 GB WASM ArrayBuffer
 * and Chromium blob-fetch caps so the ~2.4 GB fp32 encoder can load on WASM.
 *
 * @param {string|ArrayBuffer|Uint8Array|Array<{path:string,data:*}>|null} source
 *   Single sidecar (URL/buffer) OR an array of `{ path, data }` shard entries.
 *   For shards each `path` MUST equal the basename baked into the graph's
 *   external_data `location` (e.g. `encoder-model.onnx.data.000`).
 * @param {string} [modelFilename] Model graph filename, used to derive the
 *   single-sidecar path (`<modelFilename>.data`). Ignored for the array form.
 * @returns {Array<{path:string,data:*}>|undefined} ORT externalData, or
 *   undefined when there is nothing to mount.
 */
export function buildExternalData(source, modelFilename) {
  if (!source) return undefined;
  // Sharded form: caller already paired each shard's bytes with its baked-in
  // location, so pass the entries straight through.
  if (Array.isArray(source)) return source.length ? source : undefined;
  // Single-sidecar form: needs the model filename to name the `.data` path.
  if (!modelFilename) return undefined;
  return [{ data: source, path: modelFilename + '.data' }];
}

/**
 * Build the per-transcription perf metrics object and, when `perfEnabled`, log
 * the `[Perf]` summary plus the per-phase table. `proc_t/dur_t` is the
 * processing-time / audio-duration ratio (lower is faster; < 1 = faster than
 * real time). The log and the metrics share a single total measurement, so
 * `total_ms` matches the logged time exactly. Returns `null` when perf is off.
 *
 * @param {boolean} perfEnabled Whether perf logging/metrics are requested.
 * @param {object} timings Timing inputs.
 * @param {number} timings.t0 `performance.now()` captured at the run start.
 * @param {number} timings.audioSec Audio duration in seconds.
 * @param {number} timings.preprocessMs Preprocessing time in ms.
 * @param {number} timings.encodeMs Encoder time in ms.
 * @param {number} timings.decodeMs Decoder time in ms.
 * @param {number} timings.tokenizeMs Tokenizer time in ms.
 * @param {object} [out] Output options.
 * @param {boolean} [out.log] Print the per-stage table/`[Perf]` line to the
 *   console. Building the metrics object is cheap (a few `performance.now()`
 *   reads), so the UI collects metrics on every run for its hover tooltip while
 *   keeping `log` off; only `verbose`/`debug` opts in to the console output.
 * @returns {object|null} The metrics object, or null when perf is disabled.
 */
function buildPerfMetrics(perfEnabled, { t0, audioSec, preprocessMs, encodeMs, decodeMs, tokenizeMs }, { log = false } = {}) {
  if (!perfEnabled) return null;
  const totalMs = performance.now() - t0;
  const procPerDur = (totalMs / 1000) / audioSec;
  if (log) {
    console.log(`[Perf] proc_t/dur_t: ${procPerDur.toFixed(2)} (audio ${audioSec.toFixed(2)} s, time ${(totalMs / 1000).toFixed(2)} s)`);
    console.table({
      Preprocess: `${preprocessMs.toFixed(1)} ms`,
      Encode: `${encodeMs.toFixed(1)} ms`,
      Decode: `${decodeMs.toFixed(1)} ms`,
      Tokenize: `${tokenizeMs.toFixed(1)} ms`,
      Total: `${totalMs.toFixed(1)} ms`,
    });
  }
  return {
    preprocess_ms: +preprocessMs.toFixed(1),
    encode_ms: +encodeMs.toFixed(1),
    decode_ms: +decodeMs.toFixed(1),
    tokenize_ms: +tokenizeMs.toFixed(1),
    total_ms: +totalMs.toFixed(1),
    procPerDur: +procPerDur.toFixed(2),
  };
}

// Hard ceiling on the encoder batch. Batching past this buys little (GPU
// dispatch overhead is already amortized) and only raises OOM risk, so even a
// huge GPU stays capped here.
const MAX_ENCODER_BATCH_CEIL = 4;

// Approximate encoder WEIGHT footprint on the GPU, inferred from the quant in
// the filename (int8 ~0.6 GB, fp16 ~1.2 GB, fp32 ~2.4 GB; see CLAUDE.md). Used
// only to leave room for weights when sizing the activation budget below.
export function encoderWeightBytesFromName(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('fp32') || (!n.includes('int8') && !n.includes('fp16'))) return 2.4e9; // fp32 / plain
  if (n.includes('fp16')) return 1.2e9;
  return 0.6e9; // int8 (and int8.smoothquant, int8.lite)
}

/**
 * Pick the largest encoder batch to fold into one encoderSession.run, adapting
 * to the actual GPU. WASM is always 1 (batching gains nothing on a single CPU
 * thread and the per-chunk encode() path must stay byte-identical). On WebGPU
 * we probe the adapter's memory limits and subtract the encoder weight
 * footprint so a big GPU batches more (up to MAX_ENCODER_BATCH_CEIL) and a small
 * one stays at the safe floor of 2.
 *
 * WebGPU exposes no total-VRAM figure, so we use `maxBufferSize` /
 * `maxStorageBufferBindingSize` as the strongest available proxy (Dawn/Chromium
 * scale these with the device: ~256 MB on weak GPUs, up to 2 GB+ on strong
 * ones). This is a heuristic, deliberately conservative, and guarded end to end:
 * any failure (no navigator.gpu, no adapter, Node) falls back to 2 on WebGPU.
 *
 * @param {{backend: string, encoderFilename?: string, verbose?: boolean}} p
 * @returns {Promise<number>}
 */
export async function resolveMaxEncoderBatch({ backend, encoderFilename, verbose = false }) {
  if (!backend || !backend.startsWith('webgpu')) return 1;
  const FLOOR = 2; // WebGPU always gets at least a small batch
  try {
    const gpu = (typeof navigator !== 'undefined') ? navigator.gpu : null;
    if (!gpu || typeof gpu.requestAdapter !== 'function') return FLOOR;
    const adapter = await gpu.requestAdapter();
    const limits = adapter?.limits;
    if (!limits) return FLOOR;
    // Largest single GPU buffer the device permits, our VRAM-headroom proxy.
    const maxBuffer = Number(limits.maxBufferSize || limits.maxStorageBufferBindingSize || 0);
    if (!(maxBuffer > 0)) return FLOOR;

    const weightBytes = encoderWeightBytesFromName(encoderFilename);
    // Budget the device can plausibly spare for batched activations: treat the
    // max single buffer as the headroom signal, minus the resident weights.
    // Each extra batched item roughly costs one weight-scale of transient
    // activation on a conformer, so use weightBytes as the per-item unit.
    const headroom = maxBuffer - weightBytes;
    let batch = FLOOR;
    if (headroom > 0) {
      // +1 batch item per weight-sized slab of headroom, on top of the floor.
      batch = FLOOR + Math.floor(headroom / Math.max(1, weightBytes));
    }
    batch = Math.max(FLOOR, Math.min(MAX_ENCODER_BATCH_CEIL, batch));
    if (verbose) {
      console.log(`[Perf] encoder batch=${batch} (maxBufferSize ${(maxBuffer / 1e9).toFixed(2)} GB, ` +
        `enc weights ~${(weightBytes / 1e9).toFixed(1)} GB)`);
    }
    return batch;
  } catch (e) {
    if (verbose) console.log(`[Perf] encoder batch probe failed (${e?.message ?? e}); using ${FLOOR}`);
    return FLOOR;
  }
}

/**
 * NeMo's `score_norm=True` (rnnt_beam_decoding.py: the final n-best is sorted by
 * `score / len(y_sequence)`): the beam's final best-hypothesis selection ranks by
 * score-per-emitted-token, NOT raw score. Raw beam scores are an unnormalized sum
 * of per-step log-probs, so the all-blank/empty path (fewest, near-zero blank
 * log-probs) has a structurally HIGHER raw score and wins at wide beam widths,
 * collapsing the transcript to empty on hard/ambiguous audio. Dividing by the
 * emitted-token count cancels that length bias; `max(numEmitted, 1)` guards the
 * empty hypothesis against divide-by-zero (and keeps a genuinely silent decode
 * representable rather than auto-losing). Intermediate per-frame beam pruning
 * stays on raw score, matching NeMo (only the final selection is normalized).
 * @param {{score:number, numEmitted:number}} hyp
 * @returns {number}
 */
export function lengthNormalizedScore({ score, numEmitted }) {
  return score / Math.max(numEmitted, 1);
}

/**
 * Max / median / mean of a numeric array (median over a sorted copy), with a
 * zeros fallback for an empty array. Dependency-free and pure so the opt-in
 * beam-stats path, the benchmark harness and the unit tests share one
 * reduction. The reduce avoids a `Math.max(...arr)` spread (which blows the call
 * stack on long utterances).
 * @param {number[]} arr
 * @returns {{max:number, median:number, mean:number}}
 */
export function summarizeCounts(arr) {
  const n = arr.length;
  if (!n) return { max: 0, median: 0, mean: 0 };
  let max = -Infinity, sum = 0;
  for (const v of arr) { if (v > max) max = v; sum += v; }
  const s = [...arr].sort((a, b) => a - b);
  const mid = n >> 1;
  const median = n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { max, median, mean: sum / n };
}

/**
 * Build the per-utterance beam-search stats object surfaced (opt-in) on the
 * decode/transcribe result as `beamStats`. `expansionSizes` is the headline
 * series: one entry per joint-network expansion call, each the batch size B
 * (number of hypotheses expanded that step) fed to `_runCombinedStepBatch` — the
 * per-step CPU cost driver this instrumentation exists to measure.
 * `keptSizes` is the surviving beam size after each frame's prune. `steps`
 * equals `expansionSizes.length`. The raw arrays are kept (the benchmark writes
 * them per-utterance) alongside the max/median/mean aggregates.
 * @param {{expansionSizes:number[], keptSizes:number[]}} stats
 * @returns {object}
 */
export function summarizeBeamStats({ expansionSizes, keptSizes }) {
  return {
    expansionSizes,
    keptSizes,
    steps: expansionSizes.length,
    expansion: summarizeCounts(expansionSizes),
    kept: summarizeCounts(keptSizes),
  };
}

/**
 * Collapse duplicate beam hypotheses (same emitted-token sequence AND frame,
 * `seqKey@t`) reached by different routes into one representative. Pure so the
 * beam decoder and the unit tests share exactly one implementation.
 *
 * `mergeDuplicates=true` is NeMo's `merge_duplicate_hypotheses`: the survivor's
 * score becomes the log-sum-exp of the whole group, recombining their
 * probability mass (a max-marginal, sum-over-alignments score). This is the
 * production default. `mergeDuplicates=false` is Viterbi: keep only the single
 * highest-scoring member of each group and DROP the rest with no score
 * recombination. The two differ because log-sum-exp inflates a sequence reached
 * by many TDT alignments (e.g. blank/deletion-heavy paths), which can let it
 * out-rank a longer correct path during pruning — the exact behaviour the
 * merge on/off diagnostic exists to measure. The representative is always the
 * highest-raw-score member either way, so map insertion order (hence the
 * post-merge prune input) is identical between the modes for a given input.
 * @param {Array<{seqKey:string, t:number, score:number}>} hyps
 * @param {{mergeDuplicates:boolean, logAddExp:(a:number,b:number)=>number}} opts
 * @returns {Array} the surviving representatives, in first-seen order
 */
export function mergeHypotheses(hyps, { mergeDuplicates, logAddExp }) {
  const merged = new Map();
  for (const child of hyps) {
    const key = `${child.seqKey}@${child.t}`;
    const rep = merged.get(key);
    if (rep === undefined) {
      merged.set(key, child);
    } else if (child.score > rep.score) {
      if (mergeDuplicates) child.score = logAddExp(child.score, rep.score);
      merged.set(key, child);
    } else if (mergeDuplicates) {
      rep.score = logAddExp(rep.score, child.score);
    }
    // mergeDuplicates=false and child not better: drop child, keep rep untouched.
  }
  return [...merged.values()];
}

/**
 * Normalize a word's text for cross-chunk overlap matching: lowercase and strip
 * everything but alphanumerics. This lets "You." and "you" (a common
 * chunk-boundary punctuation/case disagreement) still align. Comparison-only:
 * the ORIGINAL word object is what we emit, so the survivor keeps its casing and
 * punctuation.
 * @param {string} t
 * @returns {string}
 */
export function normalizeWordText(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Longest common subsequence over two arrays of (already normalized) tokens.
 * Returns the matched index pairs [[i, j], ...] in ascending order. Plain O(n*m)
 * DP; the overlap zone is only a couple of seconds (a handful of words per
 * side), so n and m are tiny and this never shows up in a profile.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Array<[number, number]>}
 */
export function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  // dp[i][j] = LCS length of a[i:] and b[j:].
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

/**
 * Merge the two independent transcripts of a shared overlap zone into a single
 * deduped word list. `leftOverlap` comes from the EARLIER chunk (reliable at its
 * start, degrading toward that chunk's trailing edge, i.e. toward the seam);
 * `rightOverlap` from the LATER chunk (degrading at its leading edge near the
 * seam, reliable afterwards). Both are timestamped word objects with `.text`.
 *
 * Strategy: align the two token sequences by longest common subsequence over
 * normalized text, then splice at the MIDDLE common anchor: keep the earlier
 * chunk up to and including that anchor (its higher-context first half), then
 * the later chunk after the matching anchor (its higher-context second half).
 * The shared anchor survives exactly once (from the left). This is robust to the
 * timestamp jitter that a pure midpoint-time split suffers from: the same word,
 * decoded in both chunks with different surrounding context, can get a slightly
 * different frame alignment on each side and land on opposite sides of a time
 * seam, so it gets duplicated or dropped. Anchoring on the TEXT instead makes
 * each shared word appear once regardless of that jitter.
 *
 * Falls back to the timestamp midpoint split (the historical behaviour) only
 * when the two sides share no common token at all, i.e. there is no reliable
 * text anchor to splice on.
 *
 * @param {Array} leftOverlap   earlier chunk's words inside the overlap zone
 * @param {Array} rightOverlap  later chunk's words inside the overlap zone
 * @param {{seamSec:number, wordMid:(w:object)=>number}} opts
 * @returns {Array} the deduped overlap words, time-ordered
 */
export function mergeOverlapWords(leftOverlap, rightOverlap, { seamSec, wordMid }) {
  if (!leftOverlap.length) return rightOverlap.slice();
  if (!rightOverlap.length) return leftOverlap.slice();

  const ln = leftOverlap.map((w) => normalizeWordText(w.text));
  const rn = rightOverlap.map((w) => normalizeWordText(w.text));
  const pairs = lcsPairs(ln, rn);

  if (pairs.length) {
    // Middle common anchor: take roughly half the overlap from each side, always
    // dropping each chunk's low-context edge nearest the seam.
    const [li, rj] = pairs[Math.floor((pairs.length - 1) / 2)];
    return leftOverlap.slice(0, li + 1).concat(rightOverlap.slice(rj + 1));
  }

  // No shared token: nothing to anchor on. Fall back to the timestamp midpoint
  // split so a garbled overlap still emits each side's half exactly once.
  const merged = [];
  for (const w of leftOverlap) if (wordMid(w) < seamSec) merged.push(w);
  for (const w of rightOverlap) if (wordMid(w) >= seamSec) merged.push(w);
  return merged;
}

/**
 * Default silence-snap search radius (seconds) for long-audio chunk seams. This
 * is a hardcoded product default, intentionally NOT exposed as a user setting
 * (an extra knob here would only confuse users; the value is the same for
 * everyone). The web UI inherits it by not passing snapToSilenceSec; the CLI
 * mirrors it. See transcribeChunked / planChunks for what it does.
 */
export const DEFAULT_SNAP_TO_SILENCE_SEC = 1.0;

/**
 * Default length-alignment slack (see planChunks `lengthAlignSlack`). Silence
 * snapping moves each interior seam by a data-dependent amount, so on its own it
 * makes chunk lengths RAGGED, which defeats the WebGPU encoder-batching path
 * (encodeBatch groups only EXACTLY equal-length chunks). This slack lets the
 * snapper prefer a seam that reproduces the previous chunk's length when a point
 * there is nearly as quiet, so consecutive chunks come out equal-length and
 * batchable. 0.15 = "accept an aligned seam whose energy is within 15% of the
 * window's quiet-to-loud range above the outright quietest point". Only applied
 * on backends that actually batch (WebGPU); WASM passes 0 so its seams (and thus
 * its transcripts) are byte-identical to before. Not a user setting.
 */
export const DEFAULT_LENGTH_ALIGN_SLACK = 0.15;

/**
 * Factory for the short-window (mean-square) energy machinery used to locate
 * quiet points in audio. It exists so the "~150 ms mean-square" definition lives
 * in exactly ONE place, shared by its two consumers:
 *   - transcribeChunked snaps chunk seams into pauses via `energyAt` at arbitrary
 *     sample offsets (see planChunks);
 *   - the diarization silence-excision pass (app/ui/src/lib/silenceCut.js) needs a
 *     DENSE energy reading across the whole clip to find silence runs.
 *
 * `energyAt(i)` is byte-identical to the old inline closure, so the chunk-seam
 * placement (and thus every WASM transcript) is unchanged.
 *
 * `hopProfile(hopSamples)` is the dense path. A naive scan calling `energyAt` at
 * every hop would be O(hops * windowSamples) (~0.9 GFLOP for 1 h at 16 kHz, on
 * the main thread); hopProfile computes the same windowed mean-square in ONE O(N)
 * pass via block prefix sums (Float64, ~2.9 MB for 1 h), never the ~460 MB a
 * sample-level prefix sum would cost. The window is quantised to whole hops, so a
 * reading is a correct 150 ms mean-square, just block-aligned rather than
 * sample-exact (which the silence percentile/threshold does not need).
 *
 * @param {Float32Array} audio  mono PCM samples.
 * @param {number} sampleRate   samples per second.
 * @returns {{energyWindow:number, energyHalf:number, energyAt:(i:number)=>number, hopProfile:(hopSamples:number)=>{energies:Float64Array, hopSamples:number, count:number}}}
 */
export function createEnergySampler(audio, sampleRate) {
  // ~150 ms window, probed narrowly: a real inter-word/sentence pause is that
  // long, whereas a stop-consonant closure inside a word is only ~20-50 ms, so a
  // window this wide averages the closure back up and only a genuine pause reads
  // as a minimum. A narrower window would let a seam snap mid-word.
  const energyWindow = Math.max(1, Math.round(0.15 * sampleRate));
  const energyHalf = energyWindow >> 1;
  const energyAt = (i) => {
    const a = Math.max(0, i - energyHalf);
    const b = Math.min(audio.length, a + energyWindow);
    let s = 0;
    for (let k = a; k < b; k += 1) { const v = audio[k]; s += v * v; }
    return s / Math.max(1, b - a);
  };
  const hopProfile = (hopSamples) => {
    const hop = Math.max(1, Math.floor(hopSamples));
    const nHops = Math.max(1, Math.ceil(audio.length / hop));
    // blockSumSq[b] = sum of squares in the hop-block [b*hop, (b+1)*hop). One
    // O(N) pass over the whole clip; every sample is touched exactly once.
    const blockSumSq = new Float64Array(nHops);
    for (let b = 0; b < nHops; b += 1) {
      const a = b * hop;
      const e = Math.min(audio.length, a + hop);
      let s = 0;
      for (let k = a; k < e; k += 1) { const v = audio[k]; s += v * v; }
      blockSumSq[b] = s;
    }
    // prefix[b] = sum of blockSumSq[0..b-1]; prefix[nHops] = grand total. A
    // windowed sum is then prefix[hi] - prefix[lo] in O(1).
    const prefix = new Float64Array(nHops + 1);
    for (let b = 0; b < nHops; b += 1) prefix[b + 1] = prefix[b] + blockSumSq[b];
    const windowHops = Math.max(1, Math.round(energyWindow / hop));  // ~15 at 16 kHz/10 ms
    const half = windowHops >> 1;
    const energies = new Float64Array(nHops);
    for (let h = 0; h < nHops; h += 1) {
      const lo = Math.max(0, h - half);
      const hi = Math.min(nHops, lo + windowHops);
      const sumSq = prefix[hi] - prefix[lo];
      const samples = Math.min(audio.length, hi * hop) - lo * hop;
      energies[h] = sumSq / Math.max(1, samples);
    }
    return { energies, hopSamples: hop, count: nHops };
  };
  return { energyWindow, energyHalf, energyAt, hopProfile };
}

/**
 * Plan the [start, end) sample windows for long-audio chunking. Each chunk spans
 * at most `maxChunkSamples` and overlaps the previous one by `overlapSamples`.
 *
 * Silence-aware boundaries: when `energyAt` is supplied and `snapRadiusSamples`
 * > 0 (the default in transcribeChunked, see snapToSilenceSec), each interior
 * boundary is snapped to the QUIETEST point within `snapRadiusSamples` BEFORE its
 * nominal end (searching backward, so a chunk
 * never grows past `maxChunkSamples` and the ~25 s quality wall is respected).
 * A chunk edge is where the encoder has the least acoustic context, so a word
 * sitting on the seam is transcribed with low context on both sides; landing the
 * seam in a pause instead removes that worst case. The overlap + text-anchored
 * dedup (see mergeOverlapWords) still runs and remains the primary safety net,
 * so a window with no real pause (continuous speech) is no worse than a fixed
 * cut. With snapping off (no `energyAt` / zero radius) this reproduces the plain
 * fixed-stride layout exactly.
 *
 * Length-alignment (`lengthAlignSlack` > 0): plain silence snapping moves each
 * seam back by a data-dependent pullback, so chunk lengths come out RAGGED. But
 * an interior chunk's length is exactly `maxChunkSamples - pullback` (its start
 * tracks the previous snapped end at a fixed overlap), so two chunks that share
 * the same pullback are EXACTLY equal-length, which is the precondition for the
 * WebGPU encoder to batch them (see encodeBatch / transcribeChunked). When this
 * slack is > 0, each interior seam first looks at the point that reproduces the
 * previous chunk's pullback (== its length); if that point is nearly as quiet as
 * the outright quietest (its energy within `lengthAlignSlack` of the window's
 * quiet-to-loud range above the minimum) the seam snaps THERE instead, extending
 * a run of equal-length chunks. When no aligned point is quiet enough the run
 * simply breaks and the best pause wins, so quality is never traded for more than
 * `lengthAlignSlack` of the local energy range. slack 0 disables it (ragged, old
 * behaviour); it is strictly a Pareto win for batching (never fewer equal-length
 * runs than slack 0).
 *
 * Pure and deterministic: `energyAt(i)` returns a short-window energy for the
 * candidate boundary sample i (lower = quieter); it is probed every
 * `snapStepSamples`. Returns [{start, end}, ...] covering [0, length).
 *
 * @param {number} length  total sample count.
 * @param {{maxChunkSamples:number, overlapSamples?:number, snapRadiusSamples?:number, snapStepSamples?:number, energyAt?:((i:number)=>number)|null, lengthAlignSlack?:number}} opts
 * @returns {Array<{start:number, end:number}>}
 */
export function planChunks(length, {
  maxChunkSamples,
  overlapSamples = 0,
  snapRadiusSamples = 0,
  snapStepSamples = 1,
  energyAt = null,
  lengthAlignSlack = 0,
}) {
  const chunks = [];
  if (length <= 0 || maxChunkSamples <= 0) return chunks;
  let start = 0;
  // Pullback (nominalEnd - snappedEnd) of the PREVIOUS interior chunk. An interior
  // chunk's length is exactly maxChunkSamples - pullback, so reusing the same
  // pullback makes two chunks EXACTLY equal-length (batchable). null until the
  // first interior chunk is placed. Only consulted when lengthAlignSlack > 0.
  let prevDelta = null;
  const align = !!energyAt && lengthAlignSlack > 0;
  // guard: start strictly advances each iteration, so length+1 iterations is an
  // impossible upper bound; it only exists to make a degenerate-params infinite
  // loop structurally impossible.
  for (let guard = 0; start < length && guard <= length; guard += 1) {
    const nominalEnd = Math.min(start + maxChunkSamples, length);
    let end = nominalEnd;
    if (energyAt && snapRadiusSamples > 0 && end < length) {
      const lo = Math.max(start + 1, end - snapRadiusSamples);
      const step = Math.max(1, snapStepSamples);
      // Baseline is the nominal boundary itself: only move the cut earlier for a
      // STRICTLY quieter point, so a flat/rising window (no real pause, e.g. pure
      // silence or continuous speech) stays at `end` and the chunk is not
      // needlessly shortened. Scan backward so ties resolve to the LATEST (i.e.
      // closest-to-nominal) minimum, again minimizing how much we shorten. Also
      // track the window's LOUDEST point so the length-alignment tolerance below
      // can be scaled to this window's own quiet-to-loud range (scale-free).
      let bestI = end;
      let bestE = energyAt(end);
      let maxE = bestE;
      for (let i = end - step; i >= lo; i -= step) {
        const e = energyAt(i);
        if (e != null) {
          if (e < bestE) { bestE = e; bestI = i; }
          if (e > maxE) maxE = e;
        }
      }
      // Length-alignment bonus: prefer the seam that reproduces the previous
      // chunk's length (cut at nominalEnd - prevDelta) when a point there is
      // nearly as quiet as the outright quietest, so the encoder can batch the
      // two. Gated by lengthAlignSlack of the window's energy range, so a loud
      // (mid-word) aligned point is never accepted; then the run breaks and the
      // best pause wins.
      if (align && prevDelta != null) {
        const target = end - prevDelta;
        if (target >= lo && target < end) {
          const te = energyAt(target);
          if (te != null && te <= bestE + lengthAlignSlack * (maxE - bestE)) {
            bestI = target;
          }
        }
      }
      if (bestI > start) end = bestI;
    }
    chunks.push({ start, end });
    // Record this interior chunk's pullback so the next chunk can align to it.
    if (end < length) prevDelta = nominalEnd - end;
    if (end >= length) break;
    // Next chunk starts `overlapSamples` before this end; clamp so it always
    // advances even if degenerate params would otherwise stall.
    start = Math.max(start + 1, end - overlapSamples);
  }
  return chunks;
}

/**
 * Sort hypotheses best-first and keep the top `beamWidth`. `lengthNormPrune`
 * selects the ranking key for the intermediate per-frame survival prune:
 *   - false (default, matches NeMo): rank by RAW score. Only the FINAL best
 *     selection is length-normalized (see lengthNormalizedScore), so during
 *     search a blank/deletion-heavy path with a structurally higher raw score
 *     can survive and crowd out a longer correct path.
 *   - true: rank by length-normalized score DURING pruning too, so the
 *     deletion bias cannot decide which hypotheses survive each frame. This is
 *     the candidate fix for "wide beam underperforms greedy"; the diagnostic
 *     sweep toggles it to test whether raw-score pruning is the culprit.
 * Does not mutate its input.
 * @param {Array<{score:number, numEmitted:number}>} hyps
 * @param {number} beamWidth
 * @param {{lengthNormPrune:boolean}} opts
 * @returns {Array}
 */
export function pruneBeam(hyps, beamWidth, { lengthNormPrune }) {
  const key = lengthNormPrune ? lengthNormalizedScore : (h) => h.score;
  return hyps.slice().sort((a, b) => key(b) - key(a)).slice(0, beamWidth);
}

/**
 * Walk a finished beam hypothesis' backpointer chain into ordered output
 * arrays (the seed node has no parent and is skipped). Reads only scalars/ids,
 * so it is safe after the decoder states have been disposed. Shared by the
 * 1-best reconstruction and the n-best (oracle) reconstruction so there is one
 * copy of the walk. With `collectDebug`, also gathers each emit node's `dbg`
 * record (attached by _decodeBeam under collectDecodeDebug), index-aligned
 * with `idsR`, so the winning path's per-token decode diagnostics survive the
 * walk.
 * @param {object|null} best leaf hypothesis, or null for an empty decode
 * @param {{returnTimestamps?:boolean, returnConfidences?:boolean, collectDebug?:boolean}} [opts]
 * @returns {{idsR:number[], framesR:number[], timesR:Array, confsR:number[], dbgR:Array, overall:number}}
 */
export function reconstructBeamPath(best, { returnTimestamps = false, returnConfidences = false, collectDebug = false } = {}) {
  const idsR = [], framesR = [], timesR = [], confsR = [], dbgR = [];
  let overall = 0;
  if (best) {
    overall = best.overallLogProb;
    for (let node = best; node && node.parent; node = node.parent) {
      framesR.push(node.confVal);
      if (node.emit) {
        idsR.push(node.id);
        if (returnTimestamps) timesR.push(node.tokenTime);
        if (returnConfidences) confsR.push(node.confVal);
        if (collectDebug) dbgR.push(node.dbg ?? null);
      }
    }
    idsR.reverse(); framesR.reverse(); timesR.reverse(); confsR.reverse(); dbgR.reverse();
  }
  return { idsR, framesR, timesR, confsR, dbgR, overall };
}

/**
 * Last up-to-`n` EMITTED token ids of a beam hypothesis, oldest-first, by
 * walking its backpointer chain (blank nodes are skipped). Decode-debug only:
 * the per-frame beam timeline uses it to label each surviving hypothesis with
 * a readable tail without storing full sequences on every node.
 */
function hypTailIds(hyp, n) {
  const out = [];
  for (let node = hyp; node && node.parent && out.length < n; node = node.parent) {
    if (node.emit) out.push(node.id);
  }
  return out.reverse();
}

// Number of alternative tokens recorded per emitted token when decode-debug
// collection is on (collectDecodeDebug). Small on purpose: the tail of the
// distribution is noise for troubleshooting, and every record is retained in
// memory for the whole transcription.
const DEBUG_ALTERNATIVES_K = 5;

/**
 * Lightweight Parakeet model wrapper designed for browser usage.
 * Supports the *combined* decoder_joint-model ONNX (encoder+decoder+joiner in
 * transformerjs style) exported by parakeet TDT.
 */
export class ParakeetModel {
  constructor({ tokenizer, encoderSession, joinerSession, preprocessor, ort, subsampling = 8, windowStride = 0.01, normalizer = (s)=>s, verbose = false, maxEncoderBatch = 1 }) {
    this.tokenizer = tokenizer;
    this.encoderSession = encoderSession;
    this.joinerSession = joinerSession;
    this.preprocessor = preprocessor;
    this.ort = ort;

    // Largest batch the encoder may fold into a single encoderSession.run.
    // 1 == today's byte-identical per-chunk encode (WASM, and the default). On
    // WebGPU it is raised so transcribeChunked can group-encode chunks (dynamic
    // batch axis, see encodeBatch); computed in fromUrls from the backend.
    this.maxEncoderBatch = Math.max(1, Math.floor(maxEncoderBatch) || 1);

    // Read blank ID from tokenizer (last vocab entry for TDT models).
    // Dynamic instead of hardcoded so multilingual models (v3, vocabSize 4097)
    // work without modification.
    this.blankId = tokenizer.blankId;

    // Combined model specific constants
    this.predHidden = 640;
    this.predLayers = 2;
    this.maxTokensPerStep = 10;

    // Allocate zero LSTM states for the combined decoder; will be reused.
    const numLayers = this.predLayers;
    const hidden = this.predHidden;
    const size = numLayers * 1 * hidden;
    const z = new Float32Array(size); // zeros
    this._combState1 = new ort.Tensor('float32', z, [numLayers, 1, hidden]);
    this._combState2 = new ort.Tensor('float32', z.slice(), [numLayers, 1, hidden]);

    this._normalizer = normalizer;
    this.verbose = verbose;
    this.subsampling = subsampling;
    this.windowStride = windowStride;

    // Pre-allocate reusable tensors for the decoder loop.
    // ORT-WASM tensors wrapping a typed array do NOT copy the data on creation,
    // so mutating _targetIdArray[0] before each .run() is enough — no need to
    // create (and GC) a fresh Tensor per step.
    this._targetIdArray = new Int32Array(1);
    this._targetTensor = new ort.Tensor('int32', this._targetIdArray, [1, 1]);
    this._targetLenArray = new Int32Array([1]);
    this._targetLenTensor = new ort.Tensor('int32', this._targetLenArray, [1]);
  }

  /**
   * Create ParakeetModel by downloading all required assets.
   * @param {Object} cfg
   * @param {string|Uint8Array} cfg.encoderUrl URL to encoder-model.onnx, or its raw bytes (WebGPU large models; see hub.js blobToBytes)
   * @param {string|Uint8Array} cfg.decoderUrl URL to decoder_joint-model.onnx, or its raw bytes
   * @param {string} cfg.tokenizerUrl URL to vocab.txt or tokens.txt
   * @param {string} [cfg.preprocessorUrl] URL to nemo80/128.onnx (required when preprocessorBackend='onnx')
   * @param {('js'|'onnx')} [cfg.preprocessorBackend='js'] 'js' uses pure-JS mel.js, 'onnx' uses ONNX preprocessor
   * @param {number} [cfg.nMels=128] Number of mel bins for JS preprocessor (80 or 128)
   * @param {('webgpu'|'wasm')} [cfg.backend='webgpu']
   */
  static async fromUrls(cfg) {
    const {
      encoderUrl,
      decoderUrl,
      tokenizerUrl,
      preprocessorUrl,
      encoderDataUrl,
      decoderDataUrl,
      filenames,
      backend = 'webgpu-hybrid',
      wasmPaths,
      subsampling = 8,
      windowStride = 0.01,
      verbose = false,
      enableProfiling = false,
      enableGraphCapture,
      cpuThreads = undefined,
      // 'js' uses the pure-JS mel.js preprocessor (no ONNX download needed);
      // 'onnx' uses the OnnxPreprocessor and requires preprocessorUrl.
      preprocessorBackend = 'js',
      // Number of mel bins for JS preprocessor (80 or 128, auto-detected from
      // model config preprocessor name when available)
      nMels = 128,
    } = cfg;

    const needsPreprocessorUrl = preprocessorBackend !== 'js';
    if (!encoderUrl || !decoderUrl || !tokenizerUrl || (needsPreprocessorUrl && !preprocessorUrl)) {
      throw new Error('fromUrls requires encoderUrl, decoderUrl, tokenizerUrl and preprocessorUrl (preprocessorUrl optional when preprocessorBackend="js")');
    }

    // 1. Init ONNX Runtime
    let ortBackend = backend;
    if (backend.startsWith('webgpu')) {
        ortBackend = 'webgpu';
    }
    const ort = await initOrt({ backend: ortBackend, wasmPaths, numThreads: cpuThreads });

    // 2. Configure session options for better performance
    // Graph-capture is beneficial only when every node runs on the same EP and
    // ORT can fully record the graph (currently true only for a “strict”
    // WebGPU session).  We therefore enable it *only* when the caller passes
    // `enableGraphCapture:true` **and** the selected backend is the strict
    // WebGPU preset.  In all other scenarios (hybrid WebGPU or pure WASM)
    // it is forced off to avoid the “External buffer must be provided …”
    // runtime error on recent ORT builds.
    const graphCaptureEnabled = !!enableGraphCapture && backend === 'webgpu-strict';
    const isFullWasm = backend === 'wasm';

    const baseSessionOptions = {
      executionProviders: [],
      graphOptimizationLevel: 'all',
      executionMode: 'parallel',
      enableCpuMemArena: true,
      enableMemPattern: true,
      enableProfiling,
      enableGraphCapture: graphCaptureEnabled,
      logSeverityLevel: verbose ? 0 : 2, // 0=verbose, 2=warning
    };

    // Set execution provider based on backend
    if (backend === 'webgpu-hybrid') {
      // WebGPU with fallback to WASM for encoder; decoder may be forced to WASM-only.
      baseSessionOptions.executionProviders = [
        {
          name: 'webgpu',
          deviceType: 'gpu',
          powerPreference: 'high-performance'
        },
        'wasm'
      ];
    } else if (backend === 'webgpu-strict') {
      baseSessionOptions.executionProviders = [
        {
          name: 'webgpu',
          deviceType: 'gpu',
          powerPreference: 'high-performance'
        }
      ];
    } else if (backend === 'wasm') {
      baseSessionOptions.executionProviders = ['wasm'];
    }

    console.log(`[Parakeet.js] Creating ONNX sessions with execution mode '${backend}'. Providers:`, baseSessionOptions.executionProviders);
    if (verbose) {
        console.log('[Parakeet.js] Verbose logging enabled for ONNX Runtime.');
    }

    // Create separate options for sessions that might have external data. Each
    // source is either a single <model>.data sidecar (URL/buffer) or, for a
    // sharded fp32 encoder (parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/shard-fp32.py), an array of { path, data }
    // shard entries; buildExternalData normalises both into the ORT array.
    const encoderSessionOptions = { ...baseSessionOptions };
    const encoderExternalData = buildExternalData(encoderDataUrl, filenames?.encoder);
    if (encoderExternalData) encoderSessionOptions.externalData = encoderExternalData;

    const decoderSessionOptions = { ...baseSessionOptions };
    const decoderExternalData = buildExternalData(decoderDataUrl, filenames?.decoder);
    if (decoderExternalData) decoderSessionOptions.externalData = decoderExternalData;

    // In hybrid mode, the decoder is always run on WASM to avoid per-step
    // stalls. In pure WASM mode, both EPs are WASM anyway.
    if (backend.startsWith('webgpu')) {
      // Force decoder to run on WASM
      decoderSessionOptions.executionProviders = ['wasm'];
    }

    // 3. Load tokenizer & preprocessor in parallel with model sessions
    // helper to create session with graceful fallback if graph capture is unsupported
    async function createSession(url, opts) {
      try {
        return await ort.InferenceSession.create(url, opts);
      } catch (e) {
        const msg = (e.message || '') + '';
        if (opts.enableGraphCapture && msg.includes('graph capture')) {
          console.warn('[Parakeet] Graph-capture unsupported for this model/backend; retrying without it');
          const retryOpts = { ...opts, enableGraphCapture: false };
          return await ort.InferenceSession.create(url, retryOpts);
        }
        throw e;
      }
    }

    const tokenizerPromise = ParakeetTokenizer.fromUrl(tokenizerUrl);
    // Use pure-JS mel spectrogram when preprocessorBackend is 'js' (default),
    // falling back to ONNX-based preprocessor when explicitly requested.
    const preprocPromise = preprocessorBackend === 'js'
      ? Promise.resolve(new JsPreprocessor({ nMels }))
      : Promise.resolve(new OnnxPreprocessor(preprocessorUrl, { backend, wasmPaths, enableProfiling, enableGraphCapture: isFullWasm ? false : graphCaptureEnabled, numThreads: cpuThreads }));

    let encoderSession, joinerSession;
    // ORT mounts externalData into a single global Module.MountedFiles map and
    // unmounts (clears) the entire map at the end of every createSession call.
    // Parallel creation races: whichever session finishes first wipes the map
    // out from under the other, surfacing as "Module.MountedFiles is not
    // available" / "Deserialize tensor ... failed" on the still-loading model.
    const hasExternalData = !!(encoderSessionOptions.externalData || decoderSessionOptions.externalData);
    if (backend === 'webgpu-hybrid' || hasExternalData) {
      // avoid parallel create to prevent double initWasm race / external-data unmount race
      encoderSession = await createSession(encoderUrl, encoderSessionOptions);
      joinerSession = await createSession(decoderUrl, decoderSessionOptions);
    } else {
      [encoderSession, joinerSession] = await Promise.all([
        createSession(encoderUrl, encoderSessionOptions),
        createSession(decoderUrl, decoderSessionOptions),
      ]);
    }

    const [tokenizer, preprocessor] = await Promise.all([tokenizerPromise, preprocPromise]);

    // Largest encoder batch transcribeChunked may fold into one run. The
    // encoder ONNX has a dynamic batch axis, so grouping chunks cuts GPU
    // dispatch overhead. WASM keeps 1 (single-threaded CPU gains nothing from
    // batching and the per-chunk encode() path must stay byte-identical); on
    // WebGPU the batch AUTO-ADAPTS to the GPU (see resolveMaxEncoderBatch:
    // adapter memory limits + encoder weight size), so big GPUs batch more and
    // small ones stay conservative. `cfg.maxEncoderBatch` is an explicit
    // override for benchmarks/tests. No UI knob, matching the project's
    // chunk-overlap / silence-snap hardcoded-default style.
    const maxEncoderBatch = Number.isFinite(cfg.maxEncoderBatch)
      ? Math.max(1, Math.floor(cfg.maxEncoderBatch))
      : await resolveMaxEncoderBatch({ backend, encoderFilename: filenames?.encoder, verbose });

    // Surface the resolved batch when batching is actually on (WebGPU, N>1) so a
    // real GPU run confirms it engaged end-to-end (webgpu-check asserts batch>=2).
    // WASM/CLI keeps N=1 and stays silent, so no CLI noise and no test-log churn.
    if (maxEncoderBatch > 1) {
      console.log(`[Parakeet.js] Encoder batching enabled: batch=${maxEncoderBatch} (backend=${backend})`);
    }

    return new ParakeetModel({ tokenizer, encoderSession, joinerSession, preprocessor, ort, subsampling, windowStride, verbose, maxEncoderBatch });
  }

  /**
   * Build a DECODE-ONLY ParakeetModel: the joiner/decoder ONNX session (forced
   * to the WASM EP, exactly as fromUrls forces it on WebGPU) + the tokenizer,
   * with NO encoder session and NO preprocessor. Such a model can only run
   * transcribe() when the caller supplies `opts.encoded` (precomputed encoder
   * output) — it never preprocesses or encodes. This is what the decode worker
   * (`app/ui/src/lib/decode.worker.js`) instantiates so WASM decode can overlap
   * the main thread's GPU encode. Reuses the same session/tokenizer/externalData
   * plumbing as fromUrls so no decode logic is duplicated.
   *
   * `decoderUrl`/`decoderDataUrl` may be URL strings OR raw bytes (Uint8Array),
   * matching fromUrls; the caller (main thread) is expected to hand pre-verified
   * bytes so the worker never does a second unverified fetch.
   */
  static async decoderOnlyFromUrls({
    decoderUrl, decoderDataUrl, tokenizerUrl, filenames,
    wasmPaths, cpuThreads, subsampling = 8, windowStride = 0.01, verbose = false,
  }) {
    if (!decoderUrl || !tokenizerUrl) {
      throw new Error('decoderOnlyFromUrls requires decoderUrl and tokenizerUrl');
    }
    const ort = await initOrt({ backend: 'wasm', wasmPaths, numThreads: cpuThreads });
    const sessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      executionMode: 'parallel',
      enableCpuMemArena: true,
      enableMemPattern: true,
      logSeverityLevel: verbose ? 0 : 2,
    };
    const decoderExternalData = buildExternalData(decoderDataUrl, filenames?.decoder);
    if (decoderExternalData) sessionOptions.externalData = decoderExternalData;
    const [joinerSession, tokenizer] = await Promise.all([
      ort.InferenceSession.create(decoderUrl, sessionOptions),
      ParakeetTokenizer.fromUrl(tokenizerUrl),
    ]);
    return new ParakeetModel({
      tokenizer, encoderSession: null, joinerSession, preprocessor: null,
      ort, subsampling, windowStride, verbose, maxEncoderBatch: 1,
    });
  }

  async _runCombinedStep(encTensor, token, currentState = null) {
    const singleToken = typeof token === 'number' ? token : this.blankId;

    // Reuse pre-allocated tensors — just mutate the backing array
    this._targetIdArray[0] = singleToken;

    const state1 = currentState?.state1 || this._combState1;
    const state2 = currentState?.state2 || this._combState2;

    const feeds = {
      encoder_outputs: encTensor,
      targets: this._targetTensor,
      target_length: this._targetLenTensor,
      input_states_1: state1,
      input_states_2: state2,
    };

    const out = await this.joinerSession.run(feeds);
    const logits = out['outputs'];
    const outputState1 = out['output_states_1'];
    const outputState2 = out['output_states_2'];

    const vocab = this.tokenizer.id2token.length;

    // Validate the joiner output shape early so callers see a clear error
    // (mirrors upstream 9218917). Eagerly dispose `logits` on every failure
    // path to free its WASM/GPU buffer; the per-frame decode loop already
    // owns decoder-state disposal so we don't repeat it here.
    if (!logits || !logits.data || typeof logits.data.subarray !== 'function') {
      logits?.dispose?.();
      throw new Error('ParakeetModel decoder output did not include a valid `outputs` tensor.');
    }
    if (!outputState1 || !outputState2) {
      logits.dispose?.();
      throw new Error('ParakeetModel decoder output did not include both decoder state tensors.');
    }
    const data = logits.data;
    if (data.length < vocab) {
      logits.dispose?.();
      throw new Error(`ParakeetModel decoder output is too small (${data.length}) for vocab size ${vocab}.`);
    }
    const totalDim = data.length;

    // subarray(): zero-copy view into joiner output buffer.
    // Do NOT mutate tokenLogits/durLogits without copying first (.slice()).
    const tokenLogits = data.subarray(0, vocab);
    const durLogits = data.subarray(vocab, totalDim);
    if (durLogits.length === 0) {
      logits.dispose?.();
      throw new Error('ParakeetModel decoder output is missing required TDT duration logits.');
    }

    let step = 0;
    if (durLogits.length) {
      let maxVal = -Infinity;
      for (let i = 0; i < durLogits.length; ++i) if (durLogits[i] > maxVal) { maxVal = durLogits[i]; step = i; }
    }

    const newState = {
      state1: outputState1 || state1,
      state2: outputState2 || state2,
    };

    // Expose the logits tensor so callers can dispose it after consuming the
    // subarray views (prevents WASM/GPU memory leaks in long decode loops).
    // `durLogits` is the raw per-duration logit view: the greedy path uses the
    // pre-argmaxed `step`, while the MAES beam path scores over it (the duration
    // index equals the frame advance, so durLogits[i] is the log-weight of
    // advancing `i` frames).
    return { tokenLogits, step, durLogits, newState, _logitsTensor: logits };
  }

  /**
   * Run the combined decoder+joiner over a BATCH of beam hypotheses in one
   * `joinerSession.run` call (one batch row per hypothesis) instead of
   * `hyps.length` serial batch-1 calls. A batch-1 joiner call is almost pure
   * per-call overhead (its matmuls are too small for ORT's intra-op threads),
   * so the serial loop was the MAES bottleneck: on the int8 decoder_joint one
   * batch-10 call costs ~1/6th of 10 serial batch-1 calls.
   *
   * Gather: each hypothesis contributes its encoder frame (`encoder_outputs`
   * row), its last token (`targets` row) and its LSTM state. The state inputs
   * are [layers, B, hidden], so a hypothesis is a COLUMN: its per-layer rows
   * land at offset (layer*B + b)*hidden. A null state falls back to the shared
   * zero state, exactly like `_runCombinedStep`.
   *
   * Scatter: the output STATES are copied back out per-hypothesis (they
   * persist on hypotheses across steps), but the per-row tokenLogits and
   * durLogits are zero-copy VIEWS into the one batched logits buffer. The
   * batched logits tensor is therefore returned alive as `sharedLogits` on
   * the result array; the caller must dispose it once every row has been
   * consumed (all three callers do so in a try/finally around their
   * consumption loop). Each result entry otherwise matches the
   * `_runCombinedStep` contract `_expandHyp` consumes ({tokenLogits,
   * durLogits, newState}); the minted states are plain CPU tensors, owned by
   * the caller via the usual `_disposeDecoderState` sweep.
   *
   * A single hypothesis delegates to `_runCombinedStep` so the batch-1 path
   * (and its pre-allocated input tensors) stays shared with the greedy loop;
   * that path attaches the per-row `_logitsTensor` handle instead of
   * `sharedLogits`, so callers dispose per-row handles as they consume rows
   * AND the shared handle at the end.
   *
   * @param {Array<object>} hyps - Hypotheses to expand ({t, lastTok, state}).
   * @param {Float32Array} transposed - Encoder output, [Tenc, D] row-major.
   * @param {number} D - Encoder feature dim.
   * @returns {Promise<Array<{tokenLogits: Float32Array, durLogits: Float32Array, newState: object}>>}
   *   Index-aligned with `hyps`; carries a `sharedLogits` property on the
   *   array when the rows view a shared batched buffer.
   */
  async _runCombinedStepBatch(hyps, transposed, D) {
    if (hyps.length === 1) {
      const hyp = hyps[0];
      const frameBuf = transposed.subarray(hyp.t * D, (hyp.t + 1) * D);
      const encTensor = new this.ort.Tensor('float32', frameBuf, [1, D, 1]);
      const out = await this._runCombinedStep(encTensor, hyp.lastTok, hyp.state);
      encTensor.dispose?.();
      return [out];
    }

    const B = hyps.length;
    const L = this.predLayers, H = this.predHidden;
    const vocab = this.tokenizer.id2token.length;

    // Grow-only per-instance gather scratch: the beam calls this every
    // expansion step with small, similar batch sizes, so re-allocating the
    // gather buffers each call is pure GC churn. The ORT wasm EP copies feed
    // data into its own heap during run(), so the backing arrays are free for
    // reuse as soon as run() resolves; transcribe() calls on one instance are
    // serialized (same non-reentrancy contract as _runCombinedStep's
    // preallocated batch-1 feeds), so no two in-flight runs share the scratch.
    let sc = this._batchScratch;
    if (!sc || sc.cap < B) {
      sc = this._batchScratch = {
        cap: B,
        encData: new Float32Array(B * D),
        targetIds: new Int32Array(B),
        // target_length is always a column of 1s (one token per row): filled
        // once at (re)allocation, only ever read afterwards.
        targetLen: new Int32Array(B).fill(1),
        s1: new Float32Array(L * B * H),
        s2: new Float32Array(L * B * H),
      };
    }
    const encData = sc.encData.subarray(0, B * D);
    const targetIds = sc.targetIds.subarray(0, B);
    const s1 = sc.s1.subarray(0, L * B * H);
    const s2 = sc.s2.subarray(0, L * B * H);
    for (let b = 0; b < B; b++) {
      const h = hyps[b];
      encData.set(transposed.subarray(h.t * D, (h.t + 1) * D), b * D);
      targetIds[b] = typeof h.lastTok === 'number' ? h.lastTok : this.blankId;
      const st1 = h.state?.state1 || this._combState1;
      const st2 = h.state?.state2 || this._combState2;
      for (let l = 0; l < L; l++) {
        s1.set(st1.data.subarray(l * H, (l + 1) * H), (l * B + b) * H);
        s2.set(st2.data.subarray(l * H, (l + 1) * H), (l * B + b) * H);
      }
    }

    const feeds = {
      encoder_outputs: new this.ort.Tensor('float32', encData, [B, D, 1]),
      targets: new this.ort.Tensor('int32', targetIds, [B, 1]),
      target_length: new this.ort.Tensor('int32', sc.targetLen.subarray(0, B), [B]),
      input_states_1: new this.ort.Tensor('float32', s1, [L, B, H]),
      input_states_2: new this.ort.Tensor('float32', s2, [L, B, H]),
    };
    let out;
    try {
      out = await this.joinerSession.run(feeds);
    } finally {
      for (const t of Object.values(feeds)) t.dispose?.();
    }

    const logits = out['outputs'];
    const outputState1 = out['output_states_1'];
    const outputState2 = out['output_states_2'];
    const disposeOutputs = () => {
      logits?.dispose?.();
      outputState1?.dispose?.();
      outputState2?.dispose?.();
    };

    // Mirror _runCombinedStep's early shape validation so callers see a clear
    // error, with every batched buffer freed on the failure paths.
    if (!logits || !logits.data || typeof logits.data.subarray !== 'function') {
      disposeOutputs();
      throw new Error('ParakeetModel batched decoder output did not include a valid `outputs` tensor.');
    }
    if (!outputState1 || !outputState2) {
      disposeOutputs();
      throw new Error('ParakeetModel batched decoder output did not include both decoder state tensors.');
    }
    const data = logits.data;
    const total = data.length / B;
    if (!Number.isInteger(total) || total <= vocab) {
      disposeOutputs();
      throw new Error(`ParakeetModel batched decoder output is too small (${data.length}) for batch ${B} and vocab size ${vocab}.`);
    }
    const sd1 = outputState1.data, sd2 = outputState2.data;
    if (sd1.length !== L * B * H || sd2.length !== L * B * H) {
      disposeOutputs();
      throw new Error(`ParakeetModel batched decoder state size is ${sd1.length}/${sd2.length}, expected ${L * B * H}.`);
    }

    const results = [];
    for (let b = 0; b < B; b++) {
      // tokenLogits/durLogits are zero-copy views straight into the batched
      // output buffer (same split as _runCombinedStep); the old per-row
      // slice() copied ~vocab floats per hypothesis per step. The buffer must
      // therefore outlive this call: callers dispose it via the
      // `sharedLogits` handle attached to the returned array once every row
      // has been consumed. Output STATES are still copied per row because
      // they persist on hypotheses across steps.
      const n1 = new Float32Array(L * H);
      const n2 = new Float32Array(L * H);
      for (let l = 0; l < L; l++) {
        n1.set(sd1.subarray((l * B + b) * H, (l * B + b + 1) * H), l * H);
        n2.set(sd2.subarray((l * B + b) * H, (l * B + b + 1) * H), l * H);
      }
      results.push({
        tokenLogits: data.subarray(b * total, b * total + vocab),
        durLogits: data.subarray(b * total + vocab, (b + 1) * total),
        newState: {
          state1: new this.ort.Tensor('float32', n1, [L, 1, H]),
          state2: new this.ort.Tensor('float32', n2, [L, 1, H]),
        },
      });
    }
    // States were copied out above; only the logits tensor still backs live
    // views. The batch-1 delegation path instead attaches a per-row
    // `_logitsTensor` (disposed by the row's consumer), so callers handle
    // both shapes: dispose per-row handles as they consume, then
    // `outs.sharedLogits?.dispose?.()` when done with the whole batch.
    outputState1.dispose?.();
    outputState2.dispose?.();
    results.sharedLogits = logits;
    return results;
  }

  /**
   * Dispose ORT tensors inside a decoder state object.
   * Safely skips null states, pre-allocated initial states, and tensors
   * shared with a `keepState` (to avoid double-dispose when the joiner
   * falls back to reusing its input state).
   * @param {object|null} state  - The state whose tensors should be freed.
   * @param {object|null} [keepState] - A state whose tensors must NOT be freed.
   */
  _disposeDecoderState(state, keepState = null) {
    if (!state) return;
    if (state.state1 && state.state1 !== this._combState1 && state.state1 !== keepState?.state1) {
      state.state1.dispose?.();
    }
    if (state.state2 && state.state2 !== this._combState2 && state.state2 !== keepState?.state2) {
      state.state2.dispose?.();
    }
  }

  /**
   * Argmax over a token-logit array. Pulled out of the decode loop so both the
   * greedy (width-1) path and a future beam path can share the same hot kernel.
   * The 8x unroll caches the block into v0..v7 before comparing, which sidesteps
   * redundant TypedArray index lookups and bounds checks in V8 each time a new
   * max is found. See upstream commit 514cea5.
   * @param {Float32Array} tokenLogits
   * @returns {{maxId: number, maxLogit: number}}
   */
  _pickArgmax(tokenLogits) {
    let maxLogit = -Infinity, maxId = 0;
    const tLen = tokenLogits.length;
    let ai = 0;
    for (; ai < tLen % 8; ai++) {
      if (tokenLogits[ai] > maxLogit) { maxLogit = tokenLogits[ai]; maxId = ai; }
    }
    for (; ai < tLen; ai += 8) {
      const v0 = tokenLogits[ai];
      const v1 = tokenLogits[ai+1];
      const v2 = tokenLogits[ai+2];
      const v3 = tokenLogits[ai+3];
      const v4 = tokenLogits[ai+4];
      const v5 = tokenLogits[ai+5];
      const v6 = tokenLogits[ai+6];
      const v7 = tokenLogits[ai+7];
      if (v0 > maxLogit) { maxLogit = v0; maxId = ai; }
      if (v1 > maxLogit) { maxLogit = v1; maxId = ai + 1; }
      if (v2 > maxLogit) { maxLogit = v2; maxId = ai + 2; }
      if (v3 > maxLogit) { maxLogit = v3; maxId = ai + 3; }
      if (v4 > maxLogit) { maxLogit = v4; maxId = ai + 4; }
      if (v5 > maxLogit) { maxLogit = v5; maxId = ai + 5; }
      if (v6 > maxLogit) { maxLogit = v6; maxId = ai + 6; }
      if (v7 > maxLogit) { maxLogit = v7; maxId = ai + 7; }
    }
    return { maxId, maxLogit };
  }

  /**
   * Softmax confidence (probability) of the chosen token, i.e. 1 / sum(exp((logit
   * - maxLogit)/T)) where `maxLogit` is the chosen token's logit. `temperature`
   * is the user-facing decoder temperature; at temperature 0 the model is fully
   * greedy and confidence is 1.0. Always computed on the model's true (unboosted)
   * logits so phrase boosting never distorts reported confidence. Clamps
   * degenerate outputs to a tiny positive value so the overall log-prob can't be
   * poisoned with -Infinity / NaN.
   *
   * The denom is unrolled 8x with eight independent accumulators for ILP, and
   * (logit/T - maxLogit/T) is folded into (logit - maxLogit) * invTemp so the
   * inner loop has one multiply instead of one divide per element. See upstream
   * commit 501cef3.
   * @param {Float32Array} tokenLogits
   * @param {number} maxLogit Chosen token's (true) logit.
   * @param {number} temperature
   * @returns {number}
   */
  _frameConfidence(tokenLogits, maxLogit, temperature) {
    let confVal;
    if (temperature > 1e-8) {
      confVal = 1 / this._expSumAround(tokenLogits, maxLogit, 1.0 / temperature);
    } else {
      // At temperature=0, the model is fully greedy, confidence is 1.0.
      confVal = 1.0;
    }
    if (!Number.isFinite(confVal) || confVal <= 0) confVal = 1e-10;
    return confVal;
  }

  /**
   * Sum of exp((logit - refLogit) * invTemp) over the whole logit array: the
   * softmax partition function expressed relative to a reference logit. With
   * refLogit = the chosen token's logit this is exactly _frameConfidence's
   * denominator (numerator 1); the beam path instead computes it ONCE per
   * hypothesis-step relative to the best candidate's logit and prices every
   * candidate from the same sum (see _expandHyp), because the per-candidate
   * denominators only differ by the factor exp((ref - candidate) * invTemp).
   * That replaces one full-vocab exp sweep PER CANDIDATE with one per step.
   *
   * The loop is unrolled 8x with eight independent accumulators for ILP, and
   * (logit/T - ref/T) is folded into (logit - ref) * invTemp so the inner loop
   * has one multiply instead of one divide per element (see upstream commit
   * 501cef3; this is the exact loop _frameConfidence historically inlined, so
   * the greedy path's arithmetic is unchanged).
   * @param {Float32Array} tokenLogits
   * @param {number} refLogit Reference logit the sum is centred on.
   * @param {number} invTemp 1 / temperature (caller guards temperature > 0).
   * @returns {number}
   */
  _expSumAround(tokenLogits, refLogit, invTemp) {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, s5 = 0, s6 = 0, s7 = 0;
    let i = 0;
    const len = tokenLogits.length;
    for (; i <= len - 8; i += 8) {
      s0 += Math.exp((tokenLogits[i]     - refLogit) * invTemp);
      s1 += Math.exp((tokenLogits[i + 1] - refLogit) * invTemp);
      s2 += Math.exp((tokenLogits[i + 2] - refLogit) * invTemp);
      s3 += Math.exp((tokenLogits[i + 3] - refLogit) * invTemp);
      s4 += Math.exp((tokenLogits[i + 4] - refLogit) * invTemp);
      s5 += Math.exp((tokenLogits[i + 5] - refLogit) * invTemp);
      s6 += Math.exp((tokenLogits[i + 6] - refLogit) * invTemp);
      s7 += Math.exp((tokenLogits[i + 7] - refLogit) * invTemp);
    }
    let sumExp = s0 + s1 + s2 + s3 + s4 + s5 + s6 + s7;
    for (; i < len; i++) {
      sumExp += Math.exp((tokenLogits[i] - refLogit) * invTemp);
    }
    return sumExp;
  }

  /**
   * Frame-advancement + emission rule for one decoded token, matching NeMo /
   * onnx-asr reference exactly. Pure (depends only on its args + model
   * constants) so the greedy loop and a future beam decoder share identical
   * timing semantics:
   *   - TDT duration > 0: advance by `step`, reset the per-frame emit counter.
   *   - blank OR max-tokens reached: advance by `frameStride`, reset counter.
   *   - else (non-blank, step 0, under cap): stay on the frame to emit again.
   * @param {number} t Current encoder-frame pointer.
   * @param {number} emittedAtFrame Tokens already emitted at this frame.
   * @param {number} id Chosen token id.
   * @param {number} step TDT duration argmax.
   * @param {number} frameStride
   * @param {number} [maxSymbols] Per-frame emission cap. Defaults to the model's
   *   greedy `maxTokensPerStep`; the MAES beam path passes `maesNumSteps` here so
   *   the per-frame expansion budget is the MAES knob rather than the greedy cap.
   * @returns {{emit: boolean, isBlank: boolean, nextT: number, nextEmitted: number}}
   */
  _advanceDecision(t, emittedAtFrame, id, step, frameStride, maxSymbols = this.maxTokensPerStep) {
    const isBlank = (id === this.blankId);
    let nextT, nextEmitted;
    if (step > 0) {
      nextT = t + step;
      nextEmitted = 0;
    } else if (isBlank || emittedAtFrame + 1 >= maxSymbols) {
      nextT = t + frameStride;
      nextEmitted = 0;
    } else {
      nextT = t;
      nextEmitted = emittedAtFrame + 1;
    }
    return { emit: !isBlank, isBlank, nextT, nextEmitted };
  }

  /**
   * Log-sum-exp of a logit array at temperature 1 (the true-model log partition
   * function). The beam decoder uses it to turn raw logits into comparable
   * log-probabilities for ranking. Two passes: max for numerical stability,
   * then the exponential sum.
   * @param {Float32Array} logits
   * @returns {number}
   */
  _logSumExp(logits) {
    let m = -Infinity;
    for (let i = 0; i < logits.length; i++) if (logits[i] > m) m = logits[i];
    if (!Number.isFinite(m)) return m;
    let s = 0;
    for (let i = 0; i < logits.length; i++) s += Math.exp(logits[i] - m);
    return m + Math.log(s);
  }

  /**
   * Numerically stable log(exp(a) + exp(b)). Used by the beam decoder to
   * recombine the scores (log-probabilities) of merged duplicate hypotheses.
   * @param {number} a
   * @param {number} b
   * @returns {number}
   */
  _logAddExp(a, b) {
    if (a === -Infinity) return b;
    if (b === -Infinity) return a;
    const m = Math.max(a, b);
    return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
  }

  /**
   * Indices of the `k` largest values in `logits` (unordered). O(V*k), cheap for
   * the small beam widths this decoder targets, and avoids sorting the whole
   * vocab each step.
   * @param {Float32Array} logits
   * @param {number} k
   * @returns {number[]}
   */
  _topK(logits, k) {
    const idx = [];
    const val = [];
    for (let i = 0; i < logits.length; i++) {
      const v = logits[i];
      if (idx.length < k) {
        idx.push(i); val.push(v);
      } else {
        let mi = 0; // index (within the kept set) of the current smallest
        for (let j = 1; j < k; j++) if (val[j] < val[mi]) mi = j;
        if (v > val[mi]) { val[mi] = v; idx[mi] = i; }
      }
    }
    return idx;
  }

  /**
   * Decode-debug record for one GREEDY emission (the beam path builds its
   * records from _expandHyp's candidate stats instead, where the boosted
   * distribution is already in hand). Called with the TRUE (restored) logits;
   * `boosted` maps the ids applyBoost touched to their boosted values, so
   * per-candidate bonus = boosted - true. The chosen token is forced into the
   * alternatives so the view can always show it in context, and alternatives
   * are sorted by boosted value: the order the argmax actually saw.
   * @param {Float32Array} tokenLogits true (unboosted) logits
   * @param {{chosenId:number, frame:number, duration:number, boosted:Map|null}} info
   * @returns {object} per-token debug record (see transcribe()'s decodeDebug)
   */
  _debugEmitRecord(tokenLogits, { chosenId, frame, duration, boosted = null }) {
    const altIds = this._topK(tokenLogits, DEBUG_ALTERNATIVES_K);
    if (!altIds.includes(chosenId)) altIds.push(chosenId);
    const logZ = this._logSumExp(tokenLogits);
    const bonusOf = (id) => (boosted?.has(id) ? boosted.get(id) - tokenLogits[id] : 0);
    const alternatives = altIds.map((id) => ({
      id,
      logit: tokenLogits[id],
      logp: tokenLogits[id] - logZ,
      boostBonus: bonusOf(id),
    })).sort((a, b) => (b.logit + b.boostBonus) - (a.logit + a.boostBonus));
    const logpChosen = tokenLogits[chosenId] - logZ;
    return {
      frame,
      duration,
      // Confidence shown in the debug view = the chosen token's temperature-1
      // softmax probability exp(logp). Deliberately NOT the decoder's confVal:
      // confVal follows the UI sampling temperature and collapses to a constant
      // 1.0 at temperature 0 (the app's pinned default), which made this column
      // and the pill colouring useless. This intrinsic probability is the
      // model's real per-token confidence and is meaningful at any UI temperature.
      conf: Math.exp(logpChosen),
      trueLogit: tokenLogits[chosenId],
      logp: logpChosen,
      boostBonus: bonusOf(chosenId),
      rankDelta: null, // greedy has no joint (token+duration) beam score
      alternatives,
    };
  }

  /**
   * Expand one beam hypothesis by a single joiner step (the per-hypothesis core
   * of the MAES decoder). Returns the candidate continuations and the shared next
   * decoder state.
   *
   * MAES adaptive expansion happens here in three stages, matching NeMo's
   * `modified_adaptive_expansion_search`, which expands over (token, duration)
   * pairs rather than a single argmaxed duration:
   *   - Over-generation (`maes_expansion_beta`): the caller's `expandK` is
   *     `beamWidth + beta`, so we pull the top-(beamWidth+beta) tokens, plus a
   *     forced blank so the hypothesis can always advance in time.
   *   - Duration branching: every kept token is crossed with every TDT duration,
   *     scoring `token_logp + duration_logp` (both temperature-1 log-softmax).
   *     The top-`expandK` (token, duration) pairs over that flattened space
   *     survive, so the beam can pick a non-argmax duration when its joint
   *     log-prob wins. Blank with duration 0 is forced to duration 1
   *     (`min_non_zero_duration_idx`) so it still advances a frame.
   *   - Adaptive prune (`maes_expansion_gamma`): non-blank pairs whose joint
   *     log-probability is more than `maesExpansionGamma` below the best pair are
   *     dropped. On a confident frame one pair dominates and every other falls
   *     below the threshold, so the hypothesis branches like greedy; on an
   *     ambiguous frame several survive and the beam widens. This is what makes
   *     the effective width adapt per token.
   *
   * Fan-out per hypothesis is `expandK * |durations|` pairs before the topk and
   * gamma prune; `|durations|` is small (typically 5) so the extra cost is modest.
   *
   * Each candidate carries:
   *   - id / isBlank / emit / step (the branched TDT duration, per candidate)
   *   - confVal: frame confidence at the UI temperature on the TRUE (unboosted)
   *     token logits, for output confidence_scores (matches greedy semantics;
   *     duration does not enter confVal so overallLogProb stays token-only).
   *   - rankDelta: boosted joint (token+duration) log-probability at temperature
   *     1, for ranking/pruning. It is independent of the UI temperature so
   *     ranking still discriminates at temperature 0 (where confVal collapses to
   *     1.0).
   *   - active: the boosting trie's active-node set for the child (advanced for
   *     emitted tokens, inherited for blank). The trie's `active` field is
   *     borrowed per-hyp via assignment so phraseBoost.js needs no change.
   *
   * The caller owns `newState`: it must retain it for surviving emit-children
   * and dispose it if no emit-child references it.
   * @param {object} hyp - The hypothesis being expanded.
   * @param {object} stepOut - This hypothesis' joiner output, one entry of a
   *   `_runCombinedStepBatch` result (the caller batches the joiner over every
   *   hypothesis due on the frame; scoring stays per-hypothesis here).
   * @param {object} opts
   * @returns {{cands: Array<object>, newState: object}}
   */
  _expandHyp(hyp, stepOut, opts) {
    const { temperature, expandK, maesExpansionGamma, phraseBoost, collectDecodeDebug = false } = opts;
    // The beam scores over the raw duration logits (see below), so it ignores
    // the pre-argmaxed `step` the greedy path consumes.
    const { tokenLogits, durLogits, newState, _logitsTensor } = stepOut;

    // Boost selection: borrow the trie's active set for this hypothesis.
    if (phraseBoost) phraseBoost.active = hyp.active;
    const boostSaved = phraseBoost ? phraseBoost.applyBoost(tokenLogits) : null;

    // Over-generate (top-(beamWidth+beta)) over the (possibly boosted) logits,
    // and always allow blank so the hypothesis can choose to advance time.
    const topIds = this._topK(tokenLogits, expandK);
    if (!topIds.includes(this.blankId)) topIds.push(this.blankId);

    // Capture boosted values, then restore so confidence/ranking use the true
    // distribution. boostBonus is the additive reward boosting applied (0 when
    // no trie or the token is not boosted).
    const boostedVal = new Map();
    for (const id of topIds) boostedVal.set(id, tokenLogits[id]);
    if (boostSaved) phraseBoost.restore(tokenLogits, boostSaved);

    const logZ = this._logSumExp(tokenLogits);   // temperature-1 token partition
    const durZ = this._logSumExp(durLogits);     // temperature-1 duration partition
    const nDur = durLogits.length;
    // Blank with duration 0 cannot advance time; force it to the smallest
    // non-zero duration (NeMo's min_non_zero_duration_idx == 1 under the
    // duration-index == frame-advance convention this codebase uses).
    const minNonZeroDur = nDur > 1 ? 1 : 0;

    // Per-token boosted log-prob (rankDelta's token term), computed once and
    // reused across every duration that token is crossed with. `refLogit` (the
    // best TRUE logit among the candidates) anchors the shared confidence
    // partition below so its numerators never overflow.
    const tokenLP = new Map();
    let refLogit = -Infinity;
    for (const id of topIds) {
      const trueLogit = tokenLogits[id];
      const boostBonus = boostedVal.get(id) - trueLogit;
      tokenLP.set(id, { trueLogit, logp: (trueLogit - logZ) + boostBonus });
      if (trueLogit > refLogit) refLogit = trueLogit;
    }

    // Decode-debug: one shared alternatives list per expansion (true logit,
    // true log-prob, boost bonus for every over-generated candidate), attached
    // by reference to each emitted cand so the winning path can report what
    // this step's competition looked like. Sorted by boosted value, i.e. the
    // order the beam actually ranked them in.
    let dbgAlts = null;
    if (collectDecodeDebug) {
      dbgAlts = topIds.map((id) => {
        const { trueLogit, logp } = tokenLP.get(id);
        const logpTrue = trueLogit - logZ;
        return { id, logit: trueLogit, logp: logpTrue, boostBonus: logp - logpTrue };
      }).sort((a, b) => (b.logit + b.boostBonus) - (a.logit + a.boostBonus));
    }

    // Cross every kept token with every TDT duration; score the joint
    // (token+duration) log-prob. Pairs with zero probability (a -Infinity
    // duration logit) carry no mass, so skip them.
    const pairs = [];
    let maxTotal = -Infinity;
    for (const id of topIds) {
      const isBlank = (id === this.blankId);
      const { trueLogit, logp: tlp } = tokenLP.get(id);
      for (let d = 0; d < nDur; d++) {
        const total = tlp + (durLogits[d] - durZ);
        if (!Number.isFinite(total)) continue;
        // The score keeps duration `d`'s log-prob even when blank's frame
        // advance is forced off 0 (NeMo forces the advance, not the score).
        const stepEff = (isBlank && d === 0) ? minNonZeroDur : d;
        pairs.push({ id, isBlank, trueLogit, rankDelta: total, step: stepEff });
        if (total > maxTotal) maxTotal = total;
      }
    }

    // Keep the top-`expandK` (token, duration) pairs (NeMo topks the flattened
    // space to max_candidates), then guarantee a blank advance survives even if
    // it fell outside that cut, so the hypothesis can always move forward in time.
    pairs.sort((a, b) => b.rankDelta - a.rankDelta);
    const kept = pairs.slice(0, expandK);
    if (!kept.some(p => p.isBlank)) {
      const bestBlank = pairs.find(p => p.isBlank); // pairs is sorted desc
      if (bestBlank) kept.push(bestBlank);
    }

    // Adaptive (MAES) prune: drop non-blank pairs more than `gamma` log-prob
    // below the best pair. Blank pairs always survive (advance guarantee).
    // Confidence is priced for EVERY candidate off one shared temperature
    // partition (`confDenom`, see _expSumAround): the per-candidate softmax
    // denominators only differ by exp((refLogit - candidate) * invTemp), so
    // conf(id) = exp((logit_id - refLogit) * invTemp) / confDenom. This is
    // mathematically identical to the per-candidate _frameConfidence form the
    // greedy loop uses (for the best candidate refLogit == its logit and it IS
    // the same arithmetic) but costs one full-vocab exp sweep per
    // hypothesis-step instead of one per candidate; only the reported
    // confidences can move by float-rounding noise, ranking (rankDelta) never
    // reads confVal. Trie advance stays token-only, so cache it per token id.
    const threshold = maxTotal - maesExpansionGamma;
    const cands = [];
    const tempered = temperature > 1e-8;
    const invTemp = tempered ? 1.0 / temperature : 0;
    const confDenom = tempered ? this._expSumAround(tokenLogits, refLogit, invTemp) : 1;
    const activeCache = new Map();
    for (const { id, isBlank, trueLogit, rankDelta, step } of kept) {
      if (!isBlank && rankDelta < threshold) continue;
      // Same degenerate-output clamp as _frameConfidence: an underflowed
      // numerator (0) or a non-finite sum both land on the 1e-10 floor.
      let confVal = tempered ? Math.exp((trueLogit - refLogit) * invTemp) / confDenom : 1.0;
      if (!Number.isFinite(confVal) || confVal <= 0) confVal = 1e-10;
      let active = hyp.active;
      if (!isBlank) {
        active = activeCache.get(id);
        if (active === undefined) {
          if (phraseBoost) {
            phraseBoost.active = hyp.active;
            phraseBoost.advance(id);
            active = phraseBoost.active;
          } else {
            active = hyp.active;
          }
          activeCache.set(id, active);
        }
      }
      if (dbgAlts) {
        // Debug-only extra fields (production cands stay lean): the chosen
        // candidate's true logit / log-prob / boost bonus plus the shared
        // alternatives list, consumed by makeChild's dbg record.
        const { trueLogit: tl, logp } = tokenLP.get(id);
        const logpTrue = tl - logZ;
        cands.push({ id, isBlank, emit: !isBlank, step, confVal, rankDelta, active,
          trueLogit: tl, logpTrue, boostBonus: logp - logpTrue, dbgAlts });
      } else {
        cands.push({ id, isBlank, emit: !isBlank, step, confVal, rankDelta, active });
      }
    }

    _logitsTensor?.dispose?.();
    return { cands, newState };
  }

  /**
   * NeMo's last-mAES-step blank closure (the `n == maes_num_steps - 1` branch of
   * `modified_adaptive_expansion_search`). A non-blank zero-duration emission
   * that exhausts the per-frame symbol budget (`maesNumSteps`) cannot emit again
   * on this frame, so NeMo does not just advance it one frame: it closes the
   * hypothesis with an implicit blank, advancing by the argmax (forced non-zero)
   * TDT duration and folding `logp(blank) + logp(best_dur)` into the score.
   * Without this the hypothesis would carry only its own (token, duration-0)
   * score and land on `t + frameStride`, leaving its score incomparable to
   * NeMo's and its landing frame wrong whenever the argmax duration is > 1.
   *
   * Mutates each `child` in place: bumps `score` and resets `t` to the closure
   * frame. `overallLogProb` (the token-only confidence accumulator) is left
   * untouched because the closing blank emits no token, matching greedy
   * semantics. The joiner states minted here are throwaways (a blank does not
   * advance the decoder), so they are disposed; each child keeps its post-emit
   * state.
   *
   * All the closures of one expansion step share the same frame, so they are
   * scored with ONE batched joiner call (`_runCombinedStepBatch`) instead of a
   * serial batch-1 call per child.
   * @param {Array<object>} children Post-emit child hypotheses (each carries
   *   its new state/lastTok).
   * @param {number} parentT Frame the emissions happened on (the closure frame).
   * @param {Float32Array} transposed
   * @param {number} D
   */
  async _applyBlankClosureBatch(children, parentT, transposed, D) {
    const entries = children.map((ch) => ({ t: parentT, lastTok: ch.lastTok, state: ch.state }));
    const outs = await this._runCombinedStepBatch(entries, transposed, D);
    try {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const { tokenLogits, durLogits, newState, _logitsTensor } = outs[i];

        const blankLogp = tokenLogits[this.blankId] - this._logSumExp(tokenLogits);

        // Argmax duration, forced to the smallest non-zero index so the closing
        // blank always advances the frame (NeMo's min_non_zero_duration_idx == 1
        // under this model's identity-indexed duration head).
        let bestIdx = 0, bestVal = -Infinity;
        for (let d = 0; d < durLogits.length; d++) {
          if (durLogits[d] > bestVal) { bestVal = durLogits[d]; bestIdx = d; }
        }
        if (bestIdx === 0) bestIdx = durLogits.length > 1 ? 1 : 0;
        const durLogp = durLogits[bestIdx] - this._logSumExp(durLogits);

        child.score += blankLogp + durLogp;
        child.t = parentT + bestIdx;

        _logitsTensor?.dispose?.();
        if (newState) this._disposeDecoderState(newState);
      }
    } finally {
      // Batched rows are views into one shared logits buffer (see
      // _runCombinedStepBatch); free it now that every row was consumed.
      outs.sharedLogits?.dispose?.();
    }
  }

  /**
   * Emitted-token id sequence of a backpointer hypothesis, oldest-first. Walks
   * the parent chain (cheap at the small beam widths this decoder targets).
   * @param {object} hyp
   * @returns {number[]}
   */
  _hypIds(hyp) {
    const ids = [];
    for (let node = hyp; node && node.parent; node = node.parent) {
      if (node.emit) ids.push(node.id);
    }
    ids.reverse();
    return ids;
  }

  /**
   * Prefix-search recombination (NeMo's `prefix_search` / `maes_prefix_alpha`).
   * Run at the start of each round on the current beam: whenever a shorter
   * hypothesis is a strict prefix of a longer one and they sit on the SAME
   * encoder frame, fold the probability of extending the short hypothesis into
   * the long one's tokens (at duration 0, since the extension must not advance
   * the frame) into the long hypothesis' score via log-sum-exp. This stops the
   * beam from double-counting the shared prefix and credits the longer path with
   * the mass it would otherwise lose to its own prefix.
   *
   * `maesPrefixAlpha` bounds the length gap considered (NeMo default 1). The
   * extension is scored on the TRUE model distribution (phrase-boost is a
   * per-emission search bias applied during expansion, not re-applied here). All
   * decoder states allocated while scoring are throwaway and disposed; the
   * hypotheses' own stored states are never touched (scores only are updated).
   *
   * Runs in three passes so the joiner work batches: collect every
   * (long, short) pair first (pure), then score all extensions in LOCKSTEP
   * (one `_runCombinedStepBatch` call advances every still-active extension by
   * one token; a chain step depends on its predecessor's decoder state, but
   * distinct pairs are independent; at the NeMo-default alpha 1 every
   * extension is a single token, so a frame's pairs cost ONE batched call),
   * then fold the scores in the original pair order. Scoring never reads the
   * scores this search updates (only the short side's stored state/lastTok and
   * the long side's token ids), so the deferred folds are exact.
   * @param {Array<object>} beam
   * @param {Float32Array} transposed
   * @param {number} D
   * @param {object} opts - { maesPrefixAlpha }
   */
  async _prefixSearch(beam, transposed, D, opts) {
    const { maesPrefixAlpha } = opts;
    if (maesPrefixAlpha <= 0 || beam.length < 2) return;

    // Only hypotheses on the same frame can recombine (NeMo's last_frame group).
    const byFrame = new Map();
    for (const h of beam) {
      const g = byFrame.get(h.t);
      if (g) g.push(h); else byFrame.set(h.t, [h]);
    }

    // Pass 1 (pure): collect the recombination pairs and their extensions.
    const jobs = [];
    for (const [t, group] of byFrame) {
      if (group.length < 2) continue;
      const entries = group.map(h => ({ hyp: h, ids: this._hypIds(h) }));
      // Longest first so a long hypothesis can absorb every shorter prefix.
      entries.sort((a, b) => b.ids.length - a.ids.length);

      for (let i = 0; i < entries.length; i++) {
        const longE = entries[i];
        for (let j = i + 1; j < entries.length; j++) {
          const shortE = entries[j];
          const gap = longE.ids.length - shortE.ids.length;
          if (gap < 1 || gap > maesPrefixAlpha) continue;
          // shortE must be a strict prefix of longE.
          let isPrefix = true;
          for (let k = 0; k < shortE.ids.length; k++) {
            if (shortE.ids[k] !== longE.ids[k]) { isPrefix = false; break; }
          }
          if (!isPrefix) continue;

          // Score the extension tokens (forced) from the short hypothesis'
          // decoder state, all at duration 0 on frame `t`.
          jobs.push({
            long: longE.hyp, short: shortE.hyp, t,
            extension: longE.ids.slice(shortE.ids.length),
            k: 0, extLogp: 0,
            state: shortE.hyp.state, prevTok: shortE.hyp.lastTok,
          });
        }
      }
    }
    if (!jobs.length) return;

    // Pass 2: lockstep-batched extension scoring.
    let active = jobs;
    while (active.length) {
      const outs = await this._runCombinedStepBatch(
        active.map((job) => ({ t: job.t, lastTok: job.prevTok, state: job.state })), transposed, D);
      const next = [];
      try {
        for (let i = 0; i < active.length; i++) {
          const job = active[i];
          const tok = job.extension[job.k];
          const { tokenLogits, durLogits, newState, _logitsTensor } = outs[i];
          job.extLogp += (tokenLogits[tok] - this._logSumExp(tokenLogits))
            + (durLogits[0] - this._logSumExp(durLogits));
          _logitsTensor?.dispose?.();
          if (job.state !== job.short.state) this._disposeDecoderState(job.state);
          job.state = newState;
          job.prevTok = tok;
          if (++job.k < job.extension.length) {
            next.push(job);
          } else if (job.state !== job.short.state) {
            this._disposeDecoderState(job.state);
          }
        }
      } finally {
        // Batched rows are views into one shared logits buffer (see
        // _runCombinedStepBatch); free it now that every row was consumed.
        outs.sharedLogits?.dispose?.();
      }
      active = next;
    }

    // Pass 3: fold each short prefix's mass into its extension, in the same
    // pair order the serial nested loops used (folds onto the same long
    // hypothesis accumulate in inner-pair order).
    for (const job of jobs) {
      job.long.score = this._logAddExp(job.long.score, job.short.score + job.extLogp);
    }
  }

  /**
   * Multi-hypothesis TDT beam search over the encoder frames, using Modified
   * Adaptive Expansion Search (MAES, Kim et al. 2020 — NeMo's `maes` strategy).
   * Returns the winning hypothesis' decoded ids and per-frame/per-token
   * accumulators. Full-file only: never returns a decoder state, and disposes
   * every ORT state tensor it allocates via refcounting (PLAN.md Q1).
   *
   * Frame-synchronous (matches NeMo's `maes` loop): an outer pass over encoder
   * frames `timeIdx`, with a global `keptHyps` pool partitioned each step into
   * the hypotheses due at this frame (`t === timeIdx`) and the future ones
   * (`t > timeIdx`) that wait their turn. Hypotheses are backpointer nodes
   * (parent chain) so per-step accumulators are reconstructed once at the end.
   * Processing all hypotheses on a frame together is what lets duplicate-merge
   * and prefix-search recombination actually co-occur, unlike a label-synchronous
   * loop (each hyp owning its own frame pointer) where they rarely line up.
   *
   * Per frame: prefix-search recombination over the due hypotheses; then an inner
   * expansion loop (up to `maesNumSteps`) whose every step runs ONE batched
   * joiner call over the hypotheses still on the frame (`_runCombinedStepBatch`;
   * serial batch-1 calls were the decode bottleneck) and re-expands zero-duration
   * emissions on the same frame while sending duration>0 children to the future pool; a
   * zero-duration emission that exhausts the `maesNumSteps` budget is closed with
   * NeMo's implicit best-duration blank (see `_applyBlankClosureBatch`) rather than a
   * bare advance; then duplicate-merge over the pool and prune to `beamWidth`.
   *
   * MAES knobs (defaults match NeMo): `beamWidth` is the global beam cap;
   * `maesExpansionBeta` over-generates to top-(beamWidth+beta) per hypothesis;
   * `maesExpansionGamma` adaptively prunes those expansions by log-prob (see
   * `_expandHyp`); `maesNumSteps` caps symbols emitted per frame; `maesPrefixAlpha`
   * bounds prefix-search recombination (see `_prefixSearch`; 0 disables it). The
   * duration index equals the frame advance throughout (the model's TDT duration
   * head is an identity-indexed skip count).
   *
   * The default `maesExpansionBeta` of 2 is kept deliberately (NeMo parity).
   * Measured decode cost of lowering it (real int8, min-of-3; this box is noisy,
   * ~20% run-to-run): jfk 11 s, beta 2/1/0 = 371/341/321 ms; jfk-moon 3 min /
   * 11 chunks, beta 2/1/0 = 5275/5588/5293 ms. Transcripts are byte-identical
   * across beta on both clips, and the 450-utterance real-audio sweep found
   * beta/gamma are not accuracy levers. There is NO consistent decode win from a
   * smaller beta: beta 1 beats the default on jfk but LOSES on the 3-min clip, and
   * the gap is within the measurement noise, so the default stays at 2.
   *
   * `beamPrefetch` (default on) is speculative cross-frame batching: a future
   * hypothesis' next joiner feed (t, lastTok, state) is frozen at creation, so
   * its step-0 output is computed by the current frame's batched call and
   * cached on the hypothesis (`h._spec`) until its frame arrives, instead of
   * costing that frame its own tiny call (per-call overhead dominates at
   * beam-sized batches, and TDT durations frequently split the beam across
   * frames). Search behaviour, scores and results are unchanged; only when
   * outputs are computed and which rows co-occupy a batch moves.
   * @returns {{ids: number[], tokenTimes: Array, tokenConfs: number[], frameConfs: number[], overallLogProb: number}}
   */
  async _decodeBeam(transposed, D, Tenc, opts) {
    const { beamWidth, frameStride, phraseBoost, returnTimestamps, returnConfidences, timeStride,
            maesNumSteps, maesExpansionBeta, maesExpansionGamma, maesPrefixAlpha, collectBeamStats,
            // Diagnostic knobs (production defaults keep the decode byte-for-byte
            // unchanged): mergeDuplicates=true is NeMo merge_duplicate_hypotheses,
            // lengthNormPrune=false ranks the per-frame survival prune by raw
            // score (NeMo), nBest=1 emits only the single best path.
            mergeDuplicates = true, lengthNormPrune = false, nBest = 1,
            // Speculative cross-frame batching (see the step loop): default on;
            // off is the A/B lever for benchmarks and the equivalence ablation.
            beamPrefetch = true,
            collectDecodeDebug = false } = opts;

    // Opt-in instrumentation (default OFF): when on, record the per-step
    // joint-network batch size (expansionSizes) and the surviving beam size after
    // each frame's prune (keptSizes). Guarded by this cheap boolean so the common
    // path allocates nothing and stays byte-for-byte unchanged.
    const stats = collectBeamStats ? { expansionSizes: [], keptSizes: [] } : null;
    // Opt-in decode-debug (default OFF, same zero-overhead contract): per-frame
    // snapshots of the surviving beam (the "beam timeline") plus per-emit dbg
    // records attached to backpointer nodes (see makeChild) that the winner's
    // reconstruction walk collects at the end.
    const timeline = collectDecodeDebug ? [] : null;

    if (Tenc <= 0) {
      const out = { ids: [], tokenTimes: [], tokenConfs: [], frameConfs: [], overallLogProb: 0 };
      if (stats) out.beamStats = summarizeBeamStats(stats);
      if (collectDecodeDebug) { out.debugTokens = []; out.beamTimeline = []; }
      return out;
    }

    // Per-hypothesis expansion budget: top-(beamWidth+beta) tokens. Threaded into
    // _expandHyp alongside the gamma threshold via the shared opts object below.
    const expandK = beamWidth + maesExpansionBeta;
    const expandOpts = { temperature: opts.temperature, phraseBoost, expandK, maesExpansionGamma, collectDecodeDebug };

    // Build one backpointer child node from a parent hypothesis and one of its
    // (token, duration) expansion candidates.
    const makeChild = (hyp, c, newState) => {
      const dec = this._advanceDecision(hyp.t, hyp.emittedAtFrame, c.id, c.step, frameStride, maesNumSteps);
      const child = {
        parent: hyp,
        emit: c.emit,
        id: c.emit ? c.id : null,
        confVal: c.confVal,
        tokenTime: (c.emit && returnTimestamps)
          ? [hyp.t * timeStride, (hyp.t + (c.step > 0 ? c.step : 1)) * timeStride]
          : null,
        state: c.emit ? newState : hyp.state,
        t: dec.nextT,
        emittedAtFrame: dec.nextEmitted,
        overallLogProb: hyp.overallLogProb + Math.log(c.confVal),
        score: hyp.score + c.rankDelta,
        // Emitted-token count, for NeMo length-normalized final selection
        // (see lengthNormalizedScore). Blank leaves it unchanged.
        numEmitted: hyp.numEmitted + (c.emit ? 1 : 0),
        active: c.active,
        lastTok: c.emit ? c.id : hyp.lastTok,
        // Incremental emitted-token sequence identity (blank leaves it
        // unchanged). Used to detect duplicate hypotheses for merging.
        seqKey: c.emit ? hyp.seqKey + c.id + ',' : hyp.seqKey,
      };
      // Decode-debug record for emitted tokens: the chosen candidate's stats
      // plus the shared alternatives list from _expandHyp. Lives on the
      // backpointer node so only the winner's records are ever read (see
      // reconstructBeamPath's collectDebug).
      if (collectDecodeDebug && c.emit) {
        child.dbg = {
          frame: hyp.t,
          duration: c.step > 0 ? c.step : 1,
          // Temperature-1 softmax probability of the chosen token (exp(logp)),
          // NOT the UI-temperature confVal that collapses to 1.0 at temperature
          // 0. Matches _debugEmitRecord's greedy conf so the view is consistent.
          conf: Math.exp(c.logpTrue),
          trueLogit: c.trueLogit,
          logp: c.logpTrue,
          boostBonus: c.boostBonus,
          rankDelta: c.rankDelta,
          alternatives: c.dbgAlts,
        };
      }
      return child;
    };

    const rootActive = phraseBoost ? phraseBoost.active : null; // caller already reset()
    let keptHyps = [{
      parent: null, emit: false, id: null, confVal: null, tokenTime: null,
      state: null, t: 0, emittedAtFrame: 0, overallLogProb: 0, score: 0,
      numEmitted: 0, active: rootActive, lastTok: this.blankId, seqKey: '',
    }];
    let best = null;     // highest-scoring finished hypothesis (t >= Tenc)
    // Opt-in n-best (oracle) collection: keyed by emitted-token sequence so each
    // DISTINCT final transcript is kept once, at its best length-normalized
    // score. Null (and zero overhead) unless nBest > 1. Used to ask whether the
    // correct transcript is present in the beam but ranked below the 1-best.
    const finishedNBest = nBest > 1 ? new Map() : null;
    let workFrames = 0;  // frames that actually carried hypotheses (for yield cadence)

    try {
      for (let timeIdx = 0; timeIdx < Tenc && keptHyps.length; timeIdx++) {
        const current = keptHyps.filter(h => h.t === timeIdx);
        if (!current.length) continue; // no hypothesis is due here; skip cheaply
        if (workFrames++ % 25 === 0) await new Promise(resolve => setTimeout(resolve, 0));

        const futures = keptHyps.filter(h => h.t > timeIdx); // wait for their frame

        // Prefix-search recombination over the due hypotheses (scores only;
        // never mutates their stored decoder states). NeMo runs this once per
        // frame, before expansion.
        await this._prefixSearch(current, transposed, D, { maesPrefixAlpha });

        // Per-frame mark-and-sweep seed: every decoder state in play this frame
        // (all current + future hypotheses), plus every newState minted below.
        // Anything not referenced by the post-frame keptHyps (or best) is freed
        // at the end. Set semantics make shared states (blank children reuse the
        // parent's state; emit siblings share one newState) safe without refcounts.
        // Prefetched step outputs (`h._spec`, see below) carry a minted decoder
        // state too, so they ride the same sweep: seeded here, kept below only
        // while their hypothesis survives.
        const disposable = new Set();
        for (const h of keptHyps) {
          disposable.add(h.state);
          if (h._spec) disposable.add(h._spec.newState);
        }

        const produced = []; // duration>0 children, advancing to a future frame
        let working = current; // hypotheses still emitting at this frame
        for (let n = 0; n < maesNumSteps && working.length; n++) {
          const stayed = []; // zero-duration emissions, re-expanded on this frame
          // `working.length` is the number of hypotheses expanded this step
          // (the headline expansion-width metric the opt-in stats track). With
          // prefetch it is no longer exactly the joint-network batch size:
          // cached rows subtract from it, speculative rows add to it.
          if (stats) stats.expansionSizes.push(working.length);
          // Speculative cross-frame batching: a hypothesis' next joiner feed
          // (t, lastTok, state) is FROZEN the moment it is created, so future
          // hypotheses (waiting for a later frame) can have their step-0
          // output computed by THIS frame's batched call and cached on the
          // hypothesis (`h._spec`). When their frame arrives the cached row is
          // consumed with no joiner call at all; with TDT durations the beam's
          // hypotheses frequently sit on different frames, so without this
          // every diverged frame costs its own tiny call (per-call overhead
          // dominates at beam-sized batches). The outputs are identical
          // either way (same feeds, same math): only WHEN they are computed
          // and WHICH rows co-occupy a batch changes, which the real-model
          // equivalence test pins. Speculative rows are only appended to
          // calls that must happen anyway (never a call purely to prefetch),
          // so waste is bounded by the beam width when a prefetched
          // hypothesis is pruned before its frame.
          const uncached = beamPrefetch ? working.filter((h) => !h._spec) : working;
          const prefetch = (beamPrefetch && n === 0 && uncached.length)
            ? futures.filter((h) => !h._spec)
            : [];
          const batchEntries = prefetch.length ? uncached.concat(prefetch) : uncached;
          const stepOuts = batchEntries.length
            ? await this._runCombinedStepBatch(batchEntries, transposed, D)
            : [];
          const children = [];       // this step's children, in expansion order
          const pendingClosure = []; // children owed the last-mAES-step blank closure
          try {
            let row = 0; // next un-consumed stepOuts entry (uncached order == working order)
            for (const hyp of working) {
              let stepOut = hyp._spec;
              if (stepOut) {
                hyp._spec = null; // consumed exactly once; drop for GC
              } else {
                stepOut = stepOuts[row++];
              }
              const { cands, newState } = this._expandHyp(hyp, stepOut, expandOpts);
              if (newState) disposable.add(newState);
              for (const c of cands) {
                const child = makeChild(hyp, c, newState);
                // Last-mAES-step blank closure (NeMo): a non-blank zero-duration
                // emission that hits the per-frame symbol cap is closed with an
                // implicit best-duration blank instead of a bare one-frame advance,
                // so its score and landing frame match
                // modified_adaptive_expansion_search. The cap condition mirrors
                // _advanceDecision's forced-advance branch exactly. Closures are
                // deferred so the whole step shares one batched joiner call (every
                // working hypothesis sits on timeIdx, so they all share the
                // closure frame); routing below waits for the closed `t`/`score`.
                if (c.emit && c.step === 0 && hyp.emittedAtFrame + 1 >= maesNumSteps) {
                  pendingClosure.push(child);
                }
                children.push(child);
              }
            }
            // Cache the speculative rows on their future hypotheses. Logits are
            // copied out (the shared batch buffer is disposed below); the
            // minted decoder state is kept as-is and swept with the usual
            // mark-and-sweep should the hypothesis die before its frame.
            for (let j = 0; j < prefetch.length; j++) {
              const out = stepOuts[uncached.length + j];
              const spec = {
                tokenLogits: out.tokenLogits.slice(),
                durLogits: out.durLogits.slice(),
                newState: out.newState,
                _logitsTensor: null,
              };
              out._logitsTensor?.dispose?.(); // batch-1 delegation shape only
              prefetch[j]._spec = spec;
              disposable.add(spec.newState);
            }
          } finally {
            // Batched rows are views into one shared logits buffer (see
            // _runCombinedStepBatch); _expandHyp extracted scalars from every
            // row above (and disposed any per-row batch-1 handle), so the
            // shared buffer can be freed before the closure/merge phases.
            stepOuts.sharedLogits?.dispose?.();
          }
          if (pendingClosure.length) {
            await this._applyBlankClosureBatch(pendingClosure, timeIdx, transposed, D);
          }
          for (const child of children) {
            if (child.t >= Tenc) {
              // Finished: keep the best by NeMo length-normalized score
              // (score_norm=True), so the empty/all-blank path's higher *raw*
              // score cannot win at wide beam (see lengthNormalizedScore).
              if (best === null || lengthNormalizedScore(child) > lengthNormalizedScore(best)) {
                if (best) disposable.add(best.state); // old best may now be free
                best = child;
              }
              // n-best (oracle) bookkeeping: keep the best-scoring instance of
              // each distinct emitted sequence. Cheap and null on the default path.
              if (finishedNBest) {
                const prev = finishedNBest.get(child.seqKey);
                if (!prev || lengthNormalizedScore(child) > lengthNormalizedScore(prev)) {
                  finishedNBest.set(child.seqKey, child);
                }
              }
            } else if (child.t > timeIdx) {
              produced.push(child);
            } else {
              stayed.push(child); // emitted at duration 0: still on this frame
            }
          }
          // Bound the zero-duration fan-out the same way the beam is bounded.
          stayed.sort((a, b) => b.score - a.score);
          working = stayed.slice(0, beamWidth);
        }

        // Merge duplicate hypotheses (NeMo's merge_duplicate_hypotheses) over the
        // surviving futures + this frame's new children: any two with the same
        // emitted-token sequence AND frame are the same hypothesis reached by
        // different routes, so collapse them into one representative (see
        // mergeHypotheses). The others never enter keptHyps, so the sweep below
        // frees any state they alone held. Then prune to the beam width by the
        // configured survival key (see pruneBeam).
        const merged = mergeHypotheses(futures.concat(produced),
          { mergeDuplicates, logAddExp: this._logAddExp.bind(this) });
        keptHyps = pruneBeam(merged, beamWidth, { lengthNormPrune });
        if (stats) stats.keptSizes.push(keptHyps.length); // surviving beam this frame

        // Decode-debug beam timeline: what survived this frame's merge+prune,
        // each hypothesis labelled with its score and the tail of its emitted
        // sequence. `merged` counts how many duplicates were collapsed.
        if (timeline) {
          timeline.push({
            frame: timeIdx,
            time: +(timeIdx * timeStride).toFixed(3),
            merged: futures.length + produced.length - merged.length,
            hyps: keptHyps.map((h) => ({
              score: +h.score.toFixed(4),
              normScore: +lengthNormalizedScore(h).toFixed(4),
              numEmitted: h.numEmitted,
              nextFrame: h.t,
              tail: hypTailIds(h, 8),
            })),
          });
        }

        // Sweep: free every in-play state no surviving hypothesis (or best) points at.
        // A surviving hypothesis' prefetched spec state is live too (it will be
        // consumed when its frame arrives); a pruned hypothesis' spec state is
        // in `disposable` (seeded/added above) and gets freed here.
        const keep = new Set();
        for (const h of keptHyps) {
          keep.add(h.state);
          if (h._spec) keep.add(h._spec.newState);
        }
        if (best) keep.add(best.state);
        for (const s of disposable) if (s && !keep.has(s)) this._disposeDecoderState(s);
      }
    } finally {
      // Dispose whatever is still live (the decoder never returns a state). On
      // the normal path keptHyps empties as hypotheses finish, so this just frees
      // best; on an error mid-decode it frees the live pool too (including any
      // un-consumed prefetched step outputs). Deduped so a shared state is
      // never double-disposed.
      const live = new Set();
      for (const h of keptHyps) {
        if (h.state) live.add(h.state);
        if (h._spec?.newState) live.add(h._spec.newState);
      }
      if (best && best.state) live.add(best.state);
      for (const s of live) this._disposeDecoderState(s);
    }

    // Reconstruct the winning path from the backpointer chain (seed has no
    // frame). Only scalars/ids are read here, so the disposed states don't matter.
    const { idsR, framesR, timesR, confsR, dbgR, overall } =
      reconstructBeamPath(best, { returnTimestamps, returnConfidences, collectDebug: collectDecodeDebug });
    const result = { ids: idsR, tokenTimes: timesR, tokenConfs: confsR, frameConfs: framesR, overallLogProb: overall };
    if (stats) result.beamStats = summarizeBeamStats(stats);
    if (collectDecodeDebug) { result.debugTokens = dbgR; result.beamTimeline = timeline; }
    // n-best (oracle) list: the top distinct emitted sequences by
    // length-normalized score, best first. Only its ids are reconstructed (the
    // oracle scores text, not timing/confidence). Absent on the default path.
    if (finishedNBest) {
      result.nbest = [...finishedNBest.values()]
        .sort((a, b) => lengthNormalizedScore(b) - lengthNormalizedScore(a))
        .slice(0, nBest)
        .map((h) => ({ ids: reconstructBeamPath(h).idsR, score: lengthNormalizedScore(h) }));
    }
    return result;
  }

  async computeFeatures(audio, sampleRate = 16000) {
    const { features, length } = await this.preprocessor.process(audio);
    const T = length; // number of frames returned by preprocessor
    const melBins = features.length / T;
    return { features, T, melBins };
  }

  /**
   * Run preprocessing + the encoder over 16-kHz mono PCM and return the
   * transposed encoder output [Tenc, D] (the only thing the decoder consumes),
   * its dims, and the preprocess/encode timings (ms; 0 unless profiling is on).
   *
   * The returned object is plain JS memory: every ORT tensor allocated here is
   * disposed before returning, so the result can be cached and fed back to
   * transcribe() via `opts.encoded` to decode the SAME utterance many times
   * without re-running the encoder. transcribe() itself calls this for its
   * encode stage, so the encode path lives in exactly one place.
   *
   * This is what makes the WER benchmark efficient: the encoder dominates
   * runtime yet is identical across every grid cell (beam width / phrase boost
   * only affect decoding) for a given utterance, so the benchmark encodes each
   * utterance once and reuses the result across the whole sweep.
   */
  async encode(audio, sampleRate = 16000, opts = {}) {
    const { enableProfiling = false } = opts;
    const perfEnabled = this.verbose || enableProfiling;
    let tPreproc = 0, tEncode = 0;
    let input = null, lenTensor = null, enc = null;
    try {
      // 1. Feature extraction (ONNX pre-processor)
      let features, T, melBins;
      if (perfEnabled) {
        const s = performance.now();
        ({ features, T, melBins } = await this.computeFeatures(audio, sampleRate));
        tPreproc = performance.now() - s;
      } else {
        ({ features, T, melBins } = await this.computeFeatures(audio, sampleRate));
      }

      // 2. Encode entire utterance
      input = new this.ort.Tensor('float32', features, [1, melBins, T]);
      lenTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]);
      let encOut;
      if (perfEnabled) {
        const s = performance.now();
        encOut = await this.encoderSession.run({ audio_signal: input, length: lenTensor });
        tEncode = performance.now() - s;
      } else {
        encOut = await this.encoderSession.run({ audio_signal: input, length: lenTensor });
      }
      enc = encOut['outputs'] ?? Object.values(encOut)[0];
      // Some encoder ONNX exports emit auxiliary outputs (e.g. encoded_length).
      // Dispose anything other than the main `enc` tensor; otherwise those
      // tensors leak into the WASM heap, one per encode() call.
      for (const v of Object.values(encOut)) {
        if (v !== enc) v?.dispose?.();
      }
      // Free encoder input tensors now that the encoder has produced its output —
      // long sessions (continuous recording) would otherwise accumulate them.
      input.dispose?.(); input = null;
      lenTensor.dispose?.(); lenTensor = null;

      // Transpose encoder output [B, D, T] ➔ [T, D] for B=1.
      // t-outer / d-inner gives sequential writes to `transposed`, and the
      // d-loop is unrolled 8x to cut V8's bounds-checking overhead. See
      // upstream commit 85cf1fc for the benchmark notes.
      const [ , D, Tenc ] = enc.dims;
      const transposed = new Float32Array(Tenc * D);
      const encData = enc.data;
      for (let t = 0; t < Tenc; t++) {
        const tOffset = t * D;
        let d = 0;
        for (; d <= D - 8; d += 8) {
          const srcOffset = d * Tenc + t;
          transposed[tOffset + d]     = encData[srcOffset];
          transposed[tOffset + d + 1] = encData[srcOffset + Tenc];
          transposed[tOffset + d + 2] = encData[srcOffset + 2 * Tenc];
          transposed[tOffset + d + 3] = encData[srcOffset + 3 * Tenc];
          transposed[tOffset + d + 4] = encData[srcOffset + 4 * Tenc];
          transposed[tOffset + d + 5] = encData[srcOffset + 5 * Tenc];
          transposed[tOffset + d + 6] = encData[srcOffset + 6 * Tenc];
          transposed[tOffset + d + 7] = encData[srcOffset + 7 * Tenc];
        }
        for (; d < D; d++) {
          transposed[tOffset + d] = encData[d * Tenc + t];
        }
      }

      // Encoder output has been copied into `transposed`; free its WASM/GPU
      // buffer. With chunked long-audio transcription this single dispose is the
      // biggest leak fix in the file.
      enc.dispose?.(); enc = null;

      // Raw (unrounded) timings so transcribe() rounds identically to before.
      return { transposed, D, Tenc, preprocess_ms: tPreproc, encode_ms: tEncode };
    } finally {
      // Best-effort cleanup if an await above threw mid-encode (mirrors
      // transcribe()'s function-scope tensor tracking).
      input?.dispose?.();
      lenTensor?.dispose?.();
      enc?.dispose?.();
    }
  }

  /**
   * Batched encode: fold N EQUAL-LENGTH chunks into ONE encoderSession.run and
   * return an index-aligned array of the same `{ transposed, D, Tenc,
   * preprocess_ms, encode_ms }` objects encode() returns, each ready to feed
   * transcribe() via `opts.encoded`. The encoder ONNX has dynamic batch + time
   * axes, so batching is a WebGPU throughput lever (fewer GPU dispatches /
   * better occupancy). On WASM the caller keeps maxEncoderBatch=1 and never
   * groups, so encode() stays the only path there, byte-for-byte unchanged.
   *
   * ALL CHUNKS MUST HAVE THE SAME feature length (same PCM sample count). This
   * is a hard requirement, enforced with a throw: an ablation on the real int8
   * encoder (test/unit/encode-batch-equivalence.test.mjs) showed equal-length
   * batches are byte-IDENTICAL to standalone encode() (maxAbsDiff 0), but a
   * padded, unequal-length batch diverges ~0.03 across ALL output frames because
   * the conformer's subsampling/normalization layers leak the zero-padding
   * despite the `length` mask (`length` only masks attention, not the convs). So
   * the caller (transcribeChunked) groups only runs of equal-length chunks and
   * encodes any ragged remainder alone. Silence snapping makes raw chunk lengths
   * ragged, so on batching backends planChunks aligns seams to equal lengths
   * (see its `lengthAlignSlack`) precisely so these runs form. Never pass mixed
   * lengths: it would silently degrade quality.
   *
   * @param {Float32Array[]} chunksPcm  Mono 16-kHz PCM per chunk, all same length.
   * @param {number} sampleRate
   * @param {{enableProfiling?: boolean}} [opts]
   * @returns {Promise<Array<{transposed: Float32Array, D: number, Tenc: number, preprocess_ms: number, encode_ms: number}>>}
   */
  async encodeBatch(chunksPcm, sampleRate = 16000, opts = {}) {
    const N = chunksPcm.length;
    if (N === 0) return [];
    // Single chunk: defer to encode() so a group of 1 is byte-identical to the
    // un-batched path (no slicing, same tensor lifetimes).
    if (N === 1) return [await this.encode(chunksPcm[0], sampleRate, opts)];

    const { enableProfiling = false } = opts;
    const perfEnabled = this.verbose || enableProfiling;

    let input = null, lenTensor = null, enc = null, encLen = null;
    try {
      // 1. Feature extraction per chunk (kept independent so a chunk-specific
      // failure surfaces before we allocate the batch buffer). Track each
      // chunk's feature length T_i; melBins is shared across chunks.
      const feats = new Array(N);
      const Ts = new Array(N);
      let melBins = 0;
      let tPreproc = 0;
      for (let n = 0; n < N; n++) {
        const s = perfEnabled ? performance.now() : 0;
        const { features, T, melBins: mb } = await this.computeFeatures(chunksPcm[n], sampleRate);
        if (perfEnabled) tPreproc += performance.now() - s;
        feats[n] = features;
        Ts[n] = T;
        melBins = mb;
      }
      // Hard equal-length guard: mixed lengths would need zero-padding, which the
      // encoder leaks (see method doc). The caller must group by equal length.
      const T0 = Ts[0];
      for (let n = 1; n < N; n++) {
        if (Ts[n] !== T0) {
          throw new Error(
            `encodeBatch requires equal-length chunks (got T=${Ts[n]} vs ${T0} at index ${n}); ` +
            `group by feature length or encode the remainder alone`,
          );
        }
      }
      const Tmax = T0; // all equal, so no padding actually occurs below

      // 2. Pack each chunk's [melBins, T] into a shared [N, melBins, T] buffer.
      // With equal lengths this is a straight copy (Tmax === T_i, zero padding).
      const padded = new Float32Array(N * melBins * Tmax);
      for (let n = 0; n < N; n++) {
        const src = feats[n];
        const Ti = Ts[n];
        const itemBase = n * melBins * Tmax;
        for (let m = 0; m < melBins; m++) {
          padded.set(src.subarray(m * Ti, m * Ti + Ti), itemBase + m * Tmax);
        }
      }
      const lengths = BigInt64Array.from(Ts, (t) => BigInt(t));

      input = new this.ort.Tensor('float32', padded, [N, melBins, Tmax]);
      lenTensor = new this.ort.Tensor('int64', lengths, [N]);

      const sEnc = perfEnabled ? performance.now() : 0;
      const encOut = await this.encoderSession.run({ audio_signal: input, length: lenTensor });
      const tEncode = perfEnabled ? performance.now() - sEnc : 0;

      enc = encOut['outputs'] ?? Object.values(encOut)[0];
      // The per-item real output length. Unlike encode() (which discards it),
      // batching NEEDS it: it is how each item's padding is trimmed off.
      encLen = encOut['encoded_lengths']
        ?? Object.values(encOut).find((v) => v !== enc && v?.dims?.length === 1)
        ?? null;
      const encLenData = encLen?.data ?? null;
      // Dispose any auxiliary outputs we are not reading (mirrors encode()).
      for (const v of Object.values(encOut)) {
        if (v !== enc && v !== encLen) v?.dispose?.();
      }
      input.dispose?.(); input = null;
      lenTensor.dispose?.(); lenTensor = null;

      const [ , D, TmaxEnc ] = enc.dims;
      const encData = enc.data;

      // 3. Slice + transpose each item [D, TmaxEnc] (valid width Tenc_n) ➔
      // [Tenc_n, D], reusing encode()'s 8x-unrolled inner loop with a per-item
      // base offset into the shared batch buffer.
      const results = new Array(N);
      for (let n = 0; n < N; n++) {
        // Real encoded length for this item; clamp to the padded width and fall
        // back to it if the encoder emitted no length output.
        let Tenc = encLenData ? Number(encLenData[n]) : TmaxEnc;
        if (!(Tenc > 0) || Tenc > TmaxEnc) Tenc = TmaxEnc;
        const srcBase = n * D * TmaxEnc;
        const transposed = new Float32Array(Tenc * D);
        for (let t = 0; t < Tenc; t++) {
          const tOffset = t * D;
          let d = 0;
          for (; d <= D - 8; d += 8) {
            const srcOffset = srcBase + d * TmaxEnc + t;
            transposed[tOffset + d]     = encData[srcOffset];
            transposed[tOffset + d + 1] = encData[srcOffset + TmaxEnc];
            transposed[tOffset + d + 2] = encData[srcOffset + 2 * TmaxEnc];
            transposed[tOffset + d + 3] = encData[srcOffset + 3 * TmaxEnc];
            transposed[tOffset + d + 4] = encData[srcOffset + 4 * TmaxEnc];
            transposed[tOffset + d + 5] = encData[srcOffset + 5 * TmaxEnc];
            transposed[tOffset + d + 6] = encData[srcOffset + 6 * TmaxEnc];
            transposed[tOffset + d + 7] = encData[srcOffset + 7 * TmaxEnc];
          }
          for (; d < D; d++) {
            transposed[tOffset + d] = encData[srcBase + d * TmaxEnc + t];
          }
        }
        results[n] = {
          transposed,
          D,
          Tenc,
          // Preprocess is per-chunk; the encode call is shared, so attribute the
          // whole group's encode time to the first item and 0 to the rest. This
          // keeps SUM(encode_ms) == real wall-clock encode for the group (what
          // transcribeChunked's totalEncodeMs sums), without double counting.
          preprocess_ms: perfEnabled ? tPreproc / N : 0,
          encode_ms: perfEnabled && n === 0 ? tEncode : 0,
        };
      }

      enc.dispose?.(); enc = null;
      encLen?.dispose?.(); encLen = null;
      return results;
    } finally {
      input?.dispose?.();
      lenTensor?.dispose?.();
      enc?.dispose?.();
      encLen?.dispose?.();
    }
  }

  /**
   * Transcribe 16-kHz mono PCM. Returns full rich output (timestamps/confidences opt-in).
   *
   * Pass `opts.encoded` (the object returned by encode() for this same audio) to
   * skip preprocessing + the encoder and decode a precomputed encoder output;
   * `audio` is then used only for its length (proc_t/dur_t reporting). This lets callers
   * sweep decode knobs over a fixed encoding without re-encoding (see encode()).
   */
  async transcribe(audio, sampleRate = 16000, opts = {}) {
    const {
      returnTimestamps = false,
      returnConfidences = false,
      temperature = 1.2,
      debug = false,
      enableProfiling = false,
      skipCMVN = false,
      frameStride = 1,
      previousDecoderState = null,
      returnDecoderState = false,
      timeOffset = 0,
      phraseBoost = null,
      beamWidth = 1,
      // MAES knobs (used only when beamWidth > 1). num-steps/beta/gamma match
      // NeMo's `maes`. maesPrefixAlpha deviates from NeMo's 1: a grid search over
      // French-medical + FLEURS-fr (494 utts, int8, beam 5), repeated on both the
      // CPU (node) and GPU (cuda) backends, found prefix-search recombination
      // (alpha=1) gave WER/CER identical to alpha=0 within noise while costing
      // ~15-20% more decode time, so it defaults off (0). See _prefixSearch.
      maesNumSteps = 2,
      maesExpansionBeta = 2,
      maesExpansionGamma = 2.3,
      maesPrefixAlpha = 0,
      // Speculative cross-frame batching in the beam decoder (default ON):
      // future hypotheses ride the current frame's batched joiner call and
      // their outputs are cached until their frame arrives, cutting the
      // session-call count when TDT durations make the beam's hypotheses sit
      // on different frames. Same feeds, same math; `false` is the A/B lever
      // for benchmarks and the real-model equivalence ablation.
      beamPrefetch = true,
      // Opt-in beam-search instrumentation (default OFF): when true and a beam
      // (width > 1) runs, the result carries a `beamStats` object with the
      // per-step joint-network batch sizes. Off by default so production, e2e
      // and existing callers are byte-for-byte unaffected.
      collectBeamStats = false,
      // Opt-in decode-debug collection (default OFF, same zero-overhead
      // contract): the result carries a `decodeDebug` object with a per-token
      // record for the winning path (true logit, log-prob, boost bonus, TDT
      // duration, top-k alternatives) and, on beam runs, a per-frame snapshot
      // of the surviving beam (`beamTimeline`). Never changes WHAT is decoded,
      // only what is reported. Feeds the UI's per-entry "Debug" token view.
      collectDecodeDebug = false,
      // Diagnostic decoder knobs (all default to the production behaviour, so
      // the common path is unchanged). mergeDuplicates/lengthNormPrune/nBest are
      // forwarded into the beam decoder (see _decodeBeam). forceBeam runs the
      // beam decoder even at width 1, so a width-1 beam can be compared against
      // the dedicated greedy loop (they should agree; if they don't, that gap is
      // itself a finding). Ignored when state continuity forces greedy.
      mergeDuplicates = true,
      lengthNormPrune = false,
      nBest = 1,
      forceBeam = false,
    } = opts;

    // Beam search is full-file only: a beam of N hypotheses cannot be serialized
    // into the single decoder state the streaming path round-trips, so width > 1
    // is forced back to greedy whenever decoder-state continuity is requested.
    let effBeamWidth = Math.max(1, Math.floor(beamWidth) || 1);
    if (returnDecoderState && effBeamWidth > 1) {
      console.warn('[Parakeet] beamWidth>1 is unsupported with decoder-state continuity (streaming); forcing width 1.');
      effBeamWidth = 1;
    }
    // forceBeam runs the beam decoder even at width 1 (diagnostic: a width-1
    // beam vs the greedy loop). Not available with state continuity, which the
    // beam path cannot serialize. nBest > 1 likewise needs the beam decoder.
    const useBeam = (effBeamWidth > 1 || forceBeam || nBest > 1) && !returnDecoderState;

    // Collect per-stage timings only when the caller opts in. Default off so a
    // production transcribe() doesn't spam the console; `verbose: true` at model
    // construction also flips it on for development.
    const perfEnabled = this.verbose || debug || enableProfiling;
    let t0, tPreproc = 0, tEncode = 0, tDecode = 0, tToken = 0;
    if (perfEnabled) t0 = performance.now();

    // ORT-allocated resources tracked at function scope so the finally block
    // can free them if any await between here and the normal dispose calls
    // throws. Without this, a joiner failure mid-run pins per-frame tensors in
    // the WASM/GPU heap until the page reloads, which is fatal for chunked
    // long-audio sessions. (Encoder-side tensors are owned by encode().)
    let inFlightEncTensor = null;
    let decoderState = null;
    let externalInitialState = null;
    let finalDecoderState = null;

    try {

    // 1+2. Preprocess + encode. Reuse a precomputed encoder output when the
    // caller passes one (opts.encoded), otherwise encode now. encode() owns and
    // disposes its ORT tensors and returns the transposed output as plain JS
    // memory, so this path holds no encoder tensors to clean up.
    const encoded = opts.encoded ?? await this.encode(audio, sampleRate, { enableProfiling: perfEnabled });
    const { transposed, D, Tenc } = encoded;
    tPreproc = encoded.preprocess_ms ?? 0;
    tEncode = encoded.encode_ms ?? 0;

    // --- Decode -------------------------------------------------------
    // Phrase boosting: reset the trie's active state per decode window (Q4) so
    // matches start fresh. When no trie is supplied, this whole path is inert
    // and the default decoding behavior is unchanged.
    phraseBoost?.reset();
    externalInitialState = previousDecoderState || null;
    const decStartTime = perfEnabled ? performance.now() : 0;
    const TIME_STRIDE = this.subsampling * this.windowStride;

    // Winning hypothesis' accumulators, populated by whichever decode path runs.
    let ids, tokenTimes, tokenConfs, frameConfs, overallLogProb;
    // Opt-in per-utterance beam stats: only the beam path fills this (greedy
    // width-1 never runs the beam decoder), and only when collectBeamStats is on.
    let beamStats = null;
    // Opt-in decode-debug accumulators: per-emitted-token records (both paths,
    // index-aligned with `ids`) and the beam-only per-frame timeline.
    let dbgTokens = collectDecodeDebug ? [] : null;
    let beamTimeline = null;

    let nbest = null; // beam n-best list (oracle), only when nBest > 1
    if (!useBeam) {
      // --- Greedy (= beam width 1) ------------------------------------
      // A single hypothesis carrying its own frame pointer, decoder state,
      // emitted ids and per-frame accumulators. Bit-for-bit identical to the
      // original greedy decoder.
      const hyp = {
        ids: [],
        state: previousDecoderState || null,
        t: 0,
        emittedAtFrame: 0,
        tokenTimes: [],
        tokenConfs: [],
        frameConfs: [],
        overallLogProb: 0,
      };
      decoderState = hyp.state; // keep the function-scope alias in sync for finally

      while (hyp.t < Tenc) {
        // Yield to browser every ~50 frames to keep UI responsive
        if (hyp.t % 50 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        const frameBuf = transposed.subarray(hyp.t * D, (hyp.t + 1) * D);
        inFlightEncTensor = new this.ort.Tensor('float32', frameBuf, [1, D, 1]);

        const prevTok = hyp.ids.length ? hyp.ids[hyp.ids.length - 1] : this.blankId;
        const { tokenLogits, step, newState, _logitsTensor } = await this._runCombinedStep(inFlightEncTensor, prevTok, hyp.state);

        // Phrase boosting (shallow fusion): add the trie's rewards into the
        // token logits before the argmax so the per-step choice is biased
        // toward continuing/starting a boost phrase. Restore right after so
        // confidence/log-prob below stay computed on the true distribution.
        // Argmax is invariant to a positive temperature divide, so we argmax
        // the raw logits directly (avoids the Infinity/NaN trap at temp 0).
        const boostSaved = phraseBoost ? phraseBoost.applyBoost(tokenLogits) : null;
        let { maxId, maxLogit } = this._pickArgmax(tokenLogits);

        // Decode-debug: the boosted values only exist between applyBoost and
        // restore, so capture them here (id -> boosted logit) for the emit
        // record below; per-candidate bonus = boosted - true after restore.
        let dbgBoosted = null;
        if (dbgTokens && boostSaved) {
          dbgBoosted = new Map();
          for (let i = 0; i < boostSaved.length; i += 2) {
            dbgBoosted.set(boostSaved[i], tokenLogits[boostSaved[i]]);
          }
        }

        // _frameConfidence assumes maxLogit == tokenLogits[maxId] (chosen
        // token's numerator is 1), so reset maxLogit to the true logit.
        if (boostSaved) {
          phraseBoost.restore(tokenLogits, boostSaved);
          maxLogit = tokenLogits[maxId];
        }

        const confVal = this._frameConfidence(tokenLogits, maxLogit, temperature);
        hyp.frameConfs.push(confVal);
        hyp.overallLogProb += Math.log(confVal);

        const dec = this._advanceDecision(hyp.t, hyp.emittedAtFrame, maxId, step, frameStride);

        if (dec.emit) {
          hyp.ids.push(maxId);
          // Advance the boosting trie by the emitted token (blank leaves it
          // unchanged, so no advance in the else branch below).
          phraseBoost?.advance(maxId);
          if (returnTimestamps) {
            const durFrames = step > 0 ? step : 1;
            const start = hyp.t * TIME_STRIDE;
            const end = (hyp.t + durFrames) * TIME_STRIDE;
            hyp.tokenTimes.push([start, end]);
          }
          if (returnConfidences) hyp.tokenConfs.push(confVal);
          if (dbgTokens) {
            dbgTokens.push(this._debugEmitRecord(tokenLogits, {
              chosenId: maxId,
              frame: hyp.t,
              duration: step > 0 ? step : 1,
              boosted: dbgBoosted,
            }));
          }
          // Only adopt the new decoder state when a non-blank token is emitted.
          // Free the previous state (unless caller-owned) before reassigning.
          if (hyp.state && hyp.state !== newState && hyp.state !== externalInitialState) {
            this._disposeDecoderState(hyp.state, newState);
          }
          hyp.state = newState;
          decoderState = hyp.state;
        } else {
          // Blank token: keep the previous state and discard newState.
          if (newState && newState !== hyp.state) {
            this._disposeDecoderState(newState, hyp.state);
          }
        }

        // Dispose the joiner logits tensor now that subarray views are consumed
        _logitsTensor?.dispose?.();
        // Dispose the per-frame encoder tensor. Without this, each decoded
        // frame leaks its WASM-side handle (~450k handles for a 1h audio at
        // sub=8/stride=0.01s).
        inFlightEncTensor.dispose?.();
        inFlightEncTensor = null;

        hyp.t = dec.nextT;
        hyp.emittedAtFrame = dec.nextEmitted;
      }

      // Dispose final decoder state unless the caller asked to keep it for a
      // future call. When returning state, the caller becomes its owner.
      finalDecoderState = hyp.state;
      if (!returnDecoderState) {
        this._disposeDecoderState(hyp.state);
      }
      decoderState = null;

      ids = hyp.ids;
      tokenTimes = hyp.tokenTimes;
      tokenConfs = hyp.tokenConfs;
      frameConfs = hyp.frameConfs;
      overallLogProb = hyp.overallLogProb;
    } else {
      // --- Beam search (width > 1) ------------------------------------
      // Full-file only (the streaming guard above forced width 1 when state
      // continuity is requested), so the beam never returns/owns a decoder
      // state and disposes everything it allocates internally.
      const out = await this._decodeBeam(transposed, D, Tenc, {
        beamWidth: effBeamWidth,
        temperature,
        frameStride,
        phraseBoost,
        returnTimestamps,
        returnConfidences,
        timeStride: TIME_STRIDE,
        maesNumSteps: Math.max(1, Math.floor(maesNumSteps) || 1),
        maesExpansionBeta: Math.max(0, Math.floor(maesExpansionBeta) || 0),
        maesExpansionGamma: Number.isFinite(maesExpansionGamma) ? maesExpansionGamma : 2.3,
        maesPrefixAlpha: Math.max(0, Math.floor(maesPrefixAlpha) || 0),
        collectBeamStats,
        collectDecodeDebug,
        mergeDuplicates,
        lengthNormPrune,
        nBest: Math.max(1, Math.floor(nBest) || 1),
        beamPrefetch: beamPrefetch !== false,
      });
      ids = out.ids;
      tokenTimes = out.tokenTimes;
      tokenConfs = out.tokenConfs;
      frameConfs = out.frameConfs;
      overallLogProb = out.overallLogProb;
      beamStats = out.beamStats ?? null;
      nbest = out.nbest ?? null;
      if (collectDecodeDebug) {
        dbgTokens = out.debugTokens ?? [];
        beamTimeline = out.beamTimeline ?? null;
      }
      finalDecoderState = null;
      decoderState = null;
    }

    if (perfEnabled) {
      tDecode = performance.now() - decStartTime;
    }

    let tokenStart;
    if (perfEnabled) tokenStart = performance.now();
    const rawText = this.tokenizer.decode(ids);
    if (this.verbose) console.log('[Parakeet.js] Raw decoded text:', rawText);
    const text = this._normalizer(rawText);
    if (this.verbose) console.log('[Parakeet.js] Normalized text (final):', text);
    if (perfEnabled) tToken = performance.now() - tokenStart;

    // Decode the beam n-best ids to normalized text (oracle diagnostics only;
    // null on the default path). Each entry keeps its length-normalized score.
    const nbestTexts = nbest
      ? nbest.map((h) => ({ text: this._normalizer(this.tokenizer.decode(h.ids)), score: h.score }))
      : null;

    // Opt-in decode-debug payload: the winning path's per-token records mapped
    // to vocab pieces (id -> subword string, kept raw with the sentencepiece
    // word-start marker so the view shows exactly what the model emits), plus
    // the beam timeline with each hypothesis tail decoded the same way. Built
    // before the early exit so the payload does not depend on the
    // timestamp/confidence options.
    let decodeDebug = null;
    if (collectDecodeDebug) {
      const piece = (id) => this.tokenizer.id2token[id] ?? `#${id}`;
      const round = (v, p) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(p));
      decodeDebug = {
        strategy: useBeam ? 'beam' : 'greedy',
        beamWidth: useBeam ? effBeamWidth : 1,
        tokens: ids.map((tokId, i) => {
          const d = dbgTokens[i] || null;
          const ts = tokenTimes[i] || null;
          return {
            id: tokId,
            piece: piece(tokId),
            start: ts ? round(ts[0], 3) : null,
            end: ts ? round(ts[1], 3) : null,
            frame: d ? d.frame : null,
            duration: d ? d.duration : null,
            conf: d ? round(d.conf, 4) : null,
            logit: d ? round(d.trueLogit, 4) : null,
            logp: d ? round(d.logp, 4) : null,
            boostBonus: d ? round(d.boostBonus, 4) : 0,
            score: d ? round(d.rankDelta, 4) : null,
            alternatives: d ? d.alternatives.map((a) => ({
              id: a.id,
              piece: piece(a.id),
              logit: round(a.logit, 4),
              logp: round(a.logp, 4),
              boostBonus: round(a.boostBonus, 4),
            })) : [],
          };
        }),
        beamTimeline: beamTimeline
          ? beamTimeline.map((f) => ({
              ...f,
              hyps: f.hyps.map((h) => ({ ...h, tailPieces: h.tail.map(piece) })),
            }))
          : null,
      };
    }

    // Early exit if no extras requested
    if (!returnTimestamps && !returnConfidences) {
      const metrics = buildPerfMetrics(perfEnabled, {
        t0, audioSec: audio.length / sampleRate,
        preprocessMs: tPreproc, encodeMs: tEncode, decodeMs: tDecode, tokenizeMs: tToken,
      }, { log: this.verbose || debug });
      const earlyOut = { utterance_text: text, words: [], metrics, is_final: !returnDecoderState };
      if (returnDecoderState) earlyOut.decoderState = finalDecoderState;
      if (beamStats) earlyOut.beamStats = beamStats;
      if (nbestTexts) earlyOut.nbest = nbestTexts;
      if (decodeDebug) earlyOut.decodeDebug = decodeDebug;
      return earlyOut;
    }

    // --- Build words & detailed token arrays ---------------------------
    const words = [];
    const tokensDetailed = [];
    let currentWord = '', wordStart = 0, wordEnd = 0;
    let wordConfs = [];

    ids.forEach((tokId, i) => {
      const raw = this.tokenizer.id2token[tokId];
      if (raw === this.tokenizer.blankToken) return;
      if (raw === this.tokenizer.unkToken) return;

      const isWordStart = raw.startsWith('▁');
      const cleanTok = isWordStart ? raw.slice(1) : raw;
      const ts = tokenTimes[i] || [null, null];
      const conf = tokenConfs[i];

      // tokensDetailed entry. timeOffset shifts windowed timestamps to absolute time.
      const tokEntry = { token: [cleanTok] };
      if (returnTimestamps) { tokEntry.start_time = +(ts[0] + timeOffset).toFixed(3); tokEntry.end_time = +(ts[1] + timeOffset).toFixed(3); }
      if (returnConfidences) tokEntry.confidence = +conf.toFixed(4);
      tokensDetailed.push(tokEntry);

      // accumulate into words
      if (isWordStart) {
        if (currentWord) {
          const avg = wordConfs.length ? wordConfs.reduce((a,b)=>a+b,0)/wordConfs.length : 0;
          words.push({ text: currentWord, start_time: +(wordStart + timeOffset).toFixed(3), end_time: +(wordEnd + timeOffset).toFixed(3), confidence: +avg.toFixed(4) });
        }
        currentWord = cleanTok;
        if (returnTimestamps) { wordStart = ts[0]; wordEnd = ts[1]; }
        wordConfs = returnConfidences ? [conf] : [];
      } else {
        currentWord += cleanTok;
        if (returnTimestamps) wordEnd = ts[1];
        if (returnConfidences) wordConfs.push(conf);
      }
    });

    if (currentWord) {
      const avg = wordConfs.length ? wordConfs.reduce((a,b)=>a+b,0)/wordConfs.length : 0;
      words.push({ text: currentWord, start_time: +(wordStart + timeOffset).toFixed(3), end_time: +(wordEnd + timeOffset).toFixed(3), confidence: +avg.toFixed(4) });
    }

    const avgWordConf = words.length && returnConfidences ? words.reduce((a,b)=>a+b.confidence,0)/words.length : null;
    const avgTokenConf = tokensDetailed.length && returnConfidences ? tokensDetailed.reduce((a,b)=>a+(b.confidence||0),0)/tokensDetailed.length : null;

    const metrics = buildPerfMetrics(perfEnabled, {
      t0, audioSec: audio.length / sampleRate,
      preprocessMs: tPreproc, encodeMs: tEncode, decodeMs: tDecode, tokenizeMs: tToken,
    }, { log: this.verbose || debug });

    const fullOut = {
      utterance_text: text,
      words,
      tokens: tokensDetailed,
      confidence_scores: returnConfidences ? {
        token: tokenConfs.map(c=>+c.toFixed(4)),
        token_avg: +avgTokenConf?.toFixed(4),
        word: words.map(w=>w.confidence),
        word_avg: +avgWordConf?.toFixed(4),
        frame: frameConfs.map(f=>+f.toFixed(4)),
        frame_avg: frameConfs.length ? +(frameConfs.reduce((a,b)=>a+b,0)/frameConfs.length).toFixed(4) : null,
        overall_log_prob: +overallLogProb.toFixed(6)
      } : { overall_log_prob: null, frame: null, frame_avg: null },
      metrics,
      is_final: !returnDecoderState,
    };
    if (returnDecoderState) fullOut.decoderState = finalDecoderState;
    if (beamStats) fullOut.beamStats = beamStats;
    if (nbestTexts) fullOut.nbest = nbestTexts;
    if (decodeDebug) fullOut.decodeDebug = decodeDebug;
    return fullOut;

    } finally {
      // Best-effort cleanup. On the success path each tensor is disposed and
      // nulled as soon as it's no longer needed, so these are no-ops. If an
      // await in the decode loop threw, the still-live per-frame tensor is freed
      // here. Skip `externalInitialState` — it's caller-owned. (Encoder-side
      // tensors are owned and freed by encode().)
      inFlightEncTensor?.dispose?.();
      if (decoderState && decoderState !== externalInitialState) {
        try { this._disposeDecoderState(decoderState); } catch (_) { /* ignore */ }
      }
    }
  }

  /**
   * Transcribe a (possibly long) audio buffer by splitting it into overlapping
   * chunks and stitching the per-chunk results back together. This is the
   * file-transcription path used by both the web UI and the CLI harness, so the
   * chunking/overlap/stitching behaviour stays in one place and the two callers
   * cannot drift apart.
   *
   * Each chunk is transcribed with this.transcribe(); the per-chunk options
   * (returnTimestamps, frameStride, temperature, beamWidth, MAES knobs,
   * phraseBoost, enableProfiling, ...) are forwarded verbatim from `opts` so the
   * model behaviour is identical to a single-pass call. Word timestamps are
   * shifted by each chunk's start offset before being concatenated.
   *
   * Overlap dedup: consecutive chunks share `overlapSec` of audio, so each side
   * independently transcribes the same words in that zone. Rather than emit them
   * twice, we align the two overlap transcripts by TEXT (longest common
   * subsequence) and splice at their middle shared word, so every overlap word
   * survives exactly once and each chunk contributes its higher-context half (see
   * mergeOverlapWords). This is deliberately text-anchored rather than a pure
   * midpoint-time cut: the same word decoded in both chunks can get slightly
   * different frame timestamps, and a time cut would then duplicate or drop it
   * right at the seam. Only when the two sides share no word at all do we fall
   * back to the timestamp midpoint split. The combined transcript text is rebuilt
   * from the deduped words so text and word list stay consistent. This requires
   * `returnTimestamps: true`; without timestamps there are no words to align on,
   * so we fall back to plain text concatenation (the old behaviour).
   *
   * Silence-aware seams (on by default): each interior chunk boundary is snapped
   * to the quietest point within `snapToSilenceSec` before its nominal end (see
   * planChunks), so the seam tends to fall in a pause rather than mid-word. It
   * complements the overlap dedup above (which stays the primary safety net).
   * Pass `snapToSilenceSec: 0` to disable and get a plain fixed-stride layout.
   *
   * When chunking is disabled (`enableChunking: false`) or the audio is shorter
   * than one chunk, this falls back to a single this.transcribe() pass; the
   * `onChunk` callback still fires once (with totalChunks === 1) so callers have
   * a single code path.
   *
   * @param {Float32Array} audio          PCM samples.
   * @param {number}       sampleRate      Sample rate of `audio` (Hz).
   * @param {object}       opts            Chunking options + transcribe() opts:
   *   @param {boolean} [opts.enableChunking=true]  Split long audio into chunks.
   *   @param {number}  [opts.chunkDurationSec=60]  Max chunk length, seconds.
   *   @param {number}  [opts.overlapSec=2]         Overlap between chunks, seconds.
   *   @param {number}  [opts.snapToSilenceSec=1]   Silence-snap search radius (s); 0 disables.
   *   (all other keys are forwarded to this.transcribe())
   * @param {function}     [onChunk]       Optional async callback invoked after
   *   each chunk with { chunkNum, totalChunks, result, partialText, start, end,
   *   elapsedMs }. Awaited, so callers may yield to the UI here.
   * @returns {Promise<object>} Combined result in the same shape transcribe()
   *   returns (utterance_text, words, confidence_scores, metrics, is_final).
   */
  async transcribeChunked(audio, sampleRate = 16000, opts = {}, onChunk = null) {
    const {
      enableChunking = true,
      chunkDurationSec = 60,
      overlapSec = 2,
      // Silence-aware seams: snap each chunk boundary to the quietest point
      // within this many seconds BEFORE its nominal end, so the seam lands in a
      // pause instead of mid-word. See planChunks. 0 disables (fixed-stride).
      //
      // On by default (hardcoded product value, not a user setting). The energy
      // window is 150 ms so only a real pause reads as a minimum, not a
      // ~20-50 ms stop-consonant closure inside a word (a 25 ms window did the
      // latter and regressed words like "shelter"->"shelding"). With the closure
      // bug fixed, a 3 min JFK A/B is regression-free: identical golden overlap
      // (0.987) vs snapping off, only trivial punctuation/formatting diffs. It
      // complements the overlap + text-anchored dedup (mergeOverlapWords), which
      // stays the primary safety net.
      snapToSilenceSec = DEFAULT_SNAP_TO_SILENCE_SEC,
      ...transcribeOpts
    } = opts;

    const maxChunkSamples = Math.max(1, Math.round(chunkDurationSec * sampleRate));

    // Short audio (or chunking disabled): one pass, but still fire onChunk once
    // so callers don't need a separate branch.
    if (!enableChunking || audio.length <= maxChunkSamples) {
      const t0 = performance.now();
      const result = await this.transcribe(audio, sampleRate, transcribeOpts);
      if (onChunk) {
        await onChunk({
          chunkNum: 1,
          totalChunks: 1,
          result,
          partialText: result.utterance_text,
          start: 0,
          end: audio.length,
          elapsedMs: performance.now() - t0,
        });
      }
      // Uniform decode-debug shape for consumers (opt-in, see transcribe()):
      // even the single-pass path wraps its payload as one "chunk" so the UI
      // renders one code path regardless of how the audio was split.
      if (result.decodeDebug) {
        result.decodeDebug = {
          chunks: [{ chunkNum: 1, startSec: 0, endSec: audio.length / sampleRate, ...result.decodeDebug }],
        };
      }
      return result;
    }

    const overlapSamples = Math.max(0, Math.round(overlapSec * sampleRate));

    // Short-window energy (mean square) around a candidate boundary sample, used
    // to snap seams into pauses (probed every ~5 ms). The ~150 ms window rationale
    // lives on createEnergySampler; energyAt here is byte-identical to the old
    // inline closure, so seam placement (and every WASM transcript) is unchanged.
    const { energyAt } = createEnergySampler(audio, sampleRate);
    const snapRadiusSamples = Math.max(0, Math.round(snapToSilenceSec * sampleRate));
    const snapStepSamples = Math.max(1, Math.round(0.005 * sampleRate));

    // Plan every chunk window up front (silence-snapped when enabled). Iterating
    // the plan makes totalChunks exact, so the per-chunk progress callback's
    // totalChunks matches the number of chunks actually produced.
    const chunkPlan = planChunks(audio.length, {
      maxChunkSamples,
      overlapSamples,
      snapRadiusSamples,
      snapStepSamples,
      energyAt: snapRadiusSamples > 0 ? energyAt : null,
      // Length-alignment only helps backends that actually batch the encoder
      // (WebGPU, maxEncoderBatch > 1): it nudges silence-snapped seams toward
      // equal chunk lengths so encodeBatch can group them. On WASM (batch == 1)
      // pass 0 so seams (and transcripts) stay byte-identical to before.
      lengthAlignSlack: this.maxEncoderBatch > 1 ? DEFAULT_LENGTH_ALIGN_SLACK : 0,
    });
    const totalChunks = chunkPlan.length;

    // Dedup is only possible when transcribe() returns timestamped words; with
    // returnTimestamps off there are no words, so we keep the plain-concat path.
    const canDedup = !!transcribeOpts.returnTimestamps;
    const wordMid = (w) => (w.start_time + w.end_time) / 2;

    const combinedTextParts = [];
    const combinedWords = [];
    let firstChunkConfidences = null;
    // Per-stage timings SUMMED across every chunk (not just the first), so the
    // reported encode/decode time reflects the whole audio. Each is 0 when
    // profiling is off; `anyMetrics` tracks whether any chunk reported timings
    // so we return null (rather than a zero-filled object) in that case.
    let totalPreprocessMs = 0;
    let totalEncodeMs = 0;
    let totalDecodeMs = 0;
    let totalTokenizeMs = 0;
    let totalProcessingTime = 0;
    let anyMetrics = false;
    let prevEnd = null; // absolute sample index where the previous chunk ended
    // Opt-in decode-debug: one entry per chunk, kept UNSTITCHED on purpose. The
    // overlap regions each chunk decoded (later trimmed by the seam dedup
    // above) are exactly where stitching bugs live, so the debug view groups
    // tokens per chunk with its absolute [startSec, endSec] window instead of
    // pretending the chunks were one pass.
    const debugChunks = [];

    // Text reflecting what's currently in combinedWords (deduped) when we have
    // words, otherwise the raw per-chunk concatenation.
    const buildText = () => (canDedup && combinedWords.length
      ? combinedWords.map((w) => w.text).join(' ')
      : combinedTextParts.join(' '));

    // Encoder batching (WebGPU throughput lever). When this.maxEncoderBatch > 1
    // we group consecutive EQUAL-LENGTH chunks into one encodeBatch() call, then
    // feed each chunk's precomputed encoder output to transcribe() via
    // opts.encoded so the decode/stitch path below is byte-for-byte the same.
    // Only equal-length chunks are grouped (unequal padding leaks, see
    // encodeBatch). Silence snapping makes raw chunk lengths ragged, so on
    // batching backends planChunks runs with lengthAlignSlack > 0 (see its doc):
    // it nudges seams toward equal lengths so consecutive chunks share a length
    // and this greedy run groups them; a ragged remainder just forms a group of
    // 1. On WASM (maxEncoderBatch == 1, lengthAlignSlack 0) this is fully
    // disabled and transcribe() encodes each chunk itself,
    // exactly as before. The encoder's own preprocess_ms/encode_ms ride through
    // encoded.* into transcribe()'s metrics, so the totals below are unchanged.
    const batchEncode = this.maxEncoderBatch > 1;
    const perfEnabled = this.verbose || !!transcribeOpts.enableProfiling;
    const chunkLen = (p) => p.end - p.start;
    const encodedCache = new Array(chunkPlan.length).fill(null);
    const ensureEncoded = async (ci) => {
      if (encodedCache[ci]) return encodedCache[ci];
      // Greedily grow an equal-length group [ci, ci+g) up to maxEncoderBatch.
      const base = chunkPlan[ci];
      const group = [ci];
      for (let j = ci + 1; j < chunkPlan.length && group.length < this.maxEncoderBatch; j += 1) {
        if (chunkLen(chunkPlan[j]) !== chunkLen(base)) break;
        group.push(j);
      }
      const pcms = group.map((gi) => audio.subarray(chunkPlan[gi].start, chunkPlan[gi].end));
      const encs = await this.encodeBatch(pcms, sampleRate, { enableProfiling: perfEnabled });
      group.forEach((gi, k) => { encodedCache[gi] = encs[k]; });
      return encodedCache[ci];
    };

    // Fold one decoded chunk result into the running transcript. MUST be called
    // in ascending chunk order (it depends on prevEnd / append order); both
    // drivers below honour that. Extracted verbatim from the old inline loop so
    // the stitch behaviour is identical whether decode ran in-thread or in a
    // worker.
    const consume = async (ci, chunkRes, elapsedMs) => {
      const { start, end } = chunkPlan[ci];
      const chunkNum = ci + 1;

      // Shift word timestamps from chunk-local to absolute time.
      const timeOffset = start / sampleRate;
      const chunkWords = chunkRes.words || [];
      for (const word of chunkWords) {
        word.start_time += timeOffset;
        word.end_time += timeOffset;
      }

      // Stitch this chunk's words onto the running list, deduping the shared
      // overlap zone [start, prevEnd]. Both neighbouring chunks transcribed that
      // zone independently, so each shared word appears on both sides. We align
      // the two overlap transcripts by text (LCS) and splice at their middle
      // common word (see mergeOverlapWords), which is robust to the timestamp
      // jitter a pure midpoint-time cut suffers at the seam. The first chunk
      // (prevEnd null) and the no-timestamp fallback just append everything.
      if (canDedup && prevEnd != null && combinedWords.length && chunkWords.length) {
        const overlapStartSec = start / sampleRate;
        const overlapEndSec = prevEnd / sampleRate;
        const seamSec = (start + prevEnd) / 2 / sampleRate;

        // Peel the earlier chunk's overlap words off the running list: it stays
        // time-ordered, so they are exactly the trailing run with a midpoint at
        // or after the overlap start.
        let splitIdx = combinedWords.length;
        while (splitIdx > 0 && wordMid(combinedWords[splitIdx - 1]) >= overlapStartSec) splitIdx -= 1;
        const leftOverlap = combinedWords.splice(splitIdx);

        // Split this chunk into (overlap, exclusive tail) at the overlap end.
        let rIdx = 0;
        while (rIdx < chunkWords.length && wordMid(chunkWords[rIdx]) < overlapEndSec) rIdx += 1;
        const rightOverlap = chunkWords.slice(0, rIdx);

        for (const word of mergeOverlapWords(leftOverlap, rightOverlap, { seamSec, wordMid })) {
          combinedWords.push(word);
        }
        for (let k = rIdx; k < chunkWords.length; k += 1) combinedWords.push(chunkWords[k]);
      } else {
        for (const word of chunkWords) combinedWords.push(word);
      }
      combinedTextParts.push(chunkRes.utterance_text);
      prevEnd = end;

      if (chunkNum === 1) {
        firstChunkConfidences = chunkRes.confidence_scores;
      }
      if (chunkRes.decodeDebug) {
        debugChunks.push({
          chunkNum,
          startSec: start / sampleRate,
          endSec: end / sampleRate,
          ...chunkRes.decodeDebug,
        });
      }
      const m = chunkRes.metrics;
      if (m) {
        anyMetrics = true;
        totalPreprocessMs += m.preprocess_ms || 0;
        totalEncodeMs += m.encode_ms || 0;
        totalDecodeMs += m.decode_ms || 0;
        totalTokenizeMs += m.tokenize_ms || 0;
        totalProcessingTime += m.total_ms || 0;
      }

      if (onChunk) {
        await onChunk({
          chunkNum,
          totalChunks,
          result: chunkRes,
          partialText: buildText(),
          start,
          end,
          elapsedMs,
        });
      }
    };

    // Optional injected decoder: an async fn (encoded, meta, decodeOpts) ->
    // transcribe-shaped result. App.jsx wires this to a decode WORKER so the
    // WASM decode of chunk k overlaps the GPU encode of chunk k+1 (the encoder
    // stays on this thread; only decode is off-loaded). parakeet.js never
    // imports the worker, keeping it worker-agnostic (Node/CLI never sets this).
    const decodeChunk = typeof transcribeOpts.decodeChunk === 'function'
      ? transcribeOpts.decodeChunk : null;

    if (decodeChunk) {
      // Pipelined producer/consumer. Producer: encode ahead on this thread and
      // dispatch each chunk's decode without awaiting it. A bounded in-flight
      // queue (depth ~ maxEncoderBatch + 1) caps how far the GPU runs ahead of
      // the worker, bounding memory. Consumer: drain the OLDEST decode first, so
      // consume() always sees chunks in order regardless of completion order.
      const depth = Math.max(2, (this.maxEncoderBatch || 1) + 1);
      const inflight = [];
      const { decodeChunk: _dc, encoded: _enc, ...decodeOpts } = transcribeOpts;
      const drainOne = async () => {
        const item = inflight.shift();
        const chunkRes = await item.promise;
        await consume(item.ci, chunkRes, performance.now() - item.tStart);
      };
      for (let ci = 0; ci < chunkPlan.length; ci += 1) {
        const enc = await ensureEncoded(ci);
        const { start, end } = chunkPlan[ci];
        const meta = { chunkIndex: ci, timeOffset: start / sampleRate, audioLen: end - start };
        const tStart = performance.now();
        const promise = Promise.resolve(decodeChunk(enc, meta, decodeOpts));
        encodedCache[ci] = null; // producer done with it; worker owns it now
        inflight.push({ ci, promise, tStart });
        if (inflight.length >= depth) await drainOne();
      }
      while (inflight.length) await drainOne();
    } else {
      for (let ci = 0; ci < chunkPlan.length; ci += 1) {
        const { start, end } = chunkPlan[ci];
        // subarray (zero-copy view); the model copies into its own ORT tensor.
        const chunk = audio.subarray(start, end);
        const tChunk = performance.now();
        // Batched path: reuse the group-encoded output; else let transcribe()
        // encode this chunk itself (the unchanged WASM/CLI path).
        const encoded = batchEncode ? await ensureEncoded(ci) : null;
        const chunkOpts = encoded ? { ...transcribeOpts, encoded } : transcribeOpts;
        const chunkRes = await this.transcribe(chunk, sampleRate, chunkOpts);
        // Release the (large) encoder output now that it's decoded.
        encodedCache[ci] = null;
        await consume(ci, chunkRes, performance.now() - tChunk);
      }
    }

    const combinedText = buildText();
    const totalDuration = audio.length / sampleRate;
    return {
      utterance_text: combinedText,
      words: combinedWords,
      ...(debugChunks.length ? { decodeDebug: { chunks: debugChunks } } : {}),
      confidence_scores: firstChunkConfidences || {},
      metrics: anyMetrics ? {
        preprocess_ms: +totalPreprocessMs.toFixed(1),
        encode_ms: +totalEncodeMs.toFixed(1),
        decode_ms: +totalDecodeMs.toFixed(1),
        tokenize_ms: +totalTokenizeMs.toFixed(1),
        total_ms: +totalProcessingTime.toFixed(1),
        procPerDur: totalProcessingTime ? +((totalProcessingTime / 1000) / totalDuration).toFixed(2) : null,
      } : null,
      is_final: true,
    };
  }

  /**
   * Release all ONNX sessions and clean up resources.
   * Call this before loading a new model or when the page unloads.
   */
  dispose() {
    try {
      this.encoderSession?.release();
      this.joinerSession?.release();
      this.preprocessor?.dispose();
      this.encoderSession = null;
      this.joinerSession = null;
      this.preprocessor = null;
      console.log('[Parakeet] Model sessions released');
    } catch (e) {
      console.warn('[Parakeet] Error releasing sessions:', e);
    }
  }

  /**
   * Stop ORT profiling (if enabled) for all sessions and print a quick summary
   * of time spent on GPU (WebGPU) vs CPU (WASM) kernels. Returns the parsed
   * summary object for further inspection.
   */
  endProfiling() {
    try { this.encoderSession?.endProfiling(); } catch(e) { /* ignore */ }
    try { this.joinerSession?.endProfiling(); } catch(e) { /* ignore */ }

    const FS = this.ort?.env?.wasm?.FS;
    if (!FS) {
      console.warn('[Parakeet] Profiling FS not accessible');
      return null;
    }

    const files = FS.readdir('/tmp').filter(f => f.startsWith('profile_') && f.endsWith('.json'));
    if (!files.length) {
      console.warn('[Parakeet] No profiling files found. Was profiling enabled?');
      return null;
    }

    const summary = {};
    for (const file of files) {
      try {
        const txt = FS.readFile('/tmp/' + file, { encoding: 'utf8' });
        const events = JSON.parse(txt);
        let gpu = 0, cpu = 0;
        for (const ev of events) {
          if (ev.cat === 'Node') {
            const prov = ev.args?.provider;
            if (prov === 'webgpu') gpu += ev.dur;
            else if (prov) cpu += ev.dur;
          }
        }
        summary[file] = { gpu_us: gpu, cpu_us: cpu, total_us: gpu + cpu };
      } catch (err) {
        console.warn('[Parakeet] Failed to parse profile file', file, err);
      }
    }
    console.table(summary);
    return summary;
  }
} 
