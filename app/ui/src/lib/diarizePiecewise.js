// Parallel piecewise diarization. Long recordings are cut into silence-aligned
// pieces, each diarized on its own sherpa-onnx worker (a small pool runs them
// concurrently), then the per-piece speaker labels are reconciled into one global
// label space using the SAME embedding primitives the cross-recording matcher
// already uses (cosine over CAM++ centroids), and stitched into one timeline.
//
// This module owns the PURE reconciliation + planning; the worker pool and the
// single-run fallback live in App.jsx (which has the diarizer clients and the
// embedSpeakers front-end). Reconciliation deliberately errs toward OVER-splitting
// (minting a new speaker when unsure) because the UI has a manual speaker-merge
// affordance but no un-merge: a wrong merge would be unrecoverable.

import { planChunks, createEnergySampler } from '../../../src/parakeet.js';
import { cosineSimilarity, DEFAULT_MATCH_THRESHOLD } from './speakerMatch.js';

// Only piecewise-diarize clips longer than this. Below it, one worker is faster
// than the fixed per-piece overhead (engine warmup, embedding, reconcile).
export const PIECEWISE_MIN_SEC = 900;
// Target piece length. Seams snap to the quietest nearby point, so a speaker turn
// rarely straddles one.
export const DEFAULT_PIECE_SEC = 600;
// Snap radius for a piece seam (search this far back for the quietest point).
export const PIECE_SNAP_SEC = 2.0;
// Merge adjacent same-speaker segments across a seam when the gap is under this,
// mirroring sherpa's own minDurationOff bridging (0.5 s) inside a single run.
export const SEAM_MERGE_GAP_SEC = 0.5;

/**
 * Whether to take the parallel piecewise path.
 * @param {number} durationSec
 * @param {number} numSpeakers  the user's speaker-count override; -1 means auto.
 * @returns {boolean}
 * Piecewise only runs in auto-detect mode: an exact per-clip speaker count cannot
 * be enforced per piece (a piece may not contain every speaker), so an overridden
 * count takes the single-worker path.
 */
export function shouldPiecewise(durationSec, numSpeakers) {
  return durationSec > PIECEWISE_MIN_SEC && numSpeakers === -1;
}

/**
 * Plan silence-aligned [start, end) sample ranges for the pieces. Reuses the same
 * chunk planner + energy sampler as transcription so there is one seam-placement
 * implementation.
 * @param {Float32Array} pcm
 * @param {number} sampleRate
 * @param {object} [opts]
 * @returns {Array<{start:number, end:number}>}
 */
export function planPieceRanges(pcm, sampleRate, opts = {}) {
  const pieceSec = opts.pieceSec ?? DEFAULT_PIECE_SEC;
  const snapSec = opts.snapSec ?? PIECE_SNAP_SEC;
  const { energyAt } = createEnergySampler(pcm, sampleRate);
  return planChunks(pcm.length, {
    maxChunkSamples: Math.round(pieceSec * sampleRate),
    overlapSamples: 0,
    snapRadiusSamples: Math.round(snapSec * sampleRate),
    snapStepSamples: Math.max(1, Math.round(0.005 * sampleRate)),
    energyAt,
    lengthAlignSlack: 0,
  });
}

// Mean of a running global profile, or null if it has no embeddings yet.
function centroidOf(g) {
  if (!g.sum || g.count === 0) return null;
  const c = new Float32Array(g.dim);
  for (let i = 0; i < g.dim; i += 1) c[i] = g.sum[i] / g.count;
  return c;
}

// Fold one embedding into a global profile's running centroid.
function foldEmbedding(g, e) {
  if (!g.sum) { g.sum = Float64Array.from(e); g.count = 1; g.dim = e.length; return; }
  for (let i = 0; i < g.dim; i += 1) g.sum[i] += e[i];
  g.count += 1;
}

// Merge adjacent same-speaker segments whose gap is under gapSec. Input MUST be
// sorted by start.
function mergeAdjacent(segs, gapSec) {
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end < gapSec) {
      last.end = Math.max(last.end, s.end);
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/**
 * Reconcile per-piece diarization into one global-labelled, whole-clip segment
 * list. Segment times are offset by each piece's startSec, so the result is on the
 * original (condensed-or-not) clip timeline the pieces were cut from.
 *
 * @param {Array<{startSec:number, segments:Array<{start:number,end:number,speaker:number}>, embeddings:Object<number,Float32Array>}>} pieces
 *   In chronological order. `segments` times are piece-local seconds; `speaker`
 *   labels are piece-local and MAY be non-contiguous. `embeddings` is keyed by the
 *   piece-local label and MAY miss labels (a speaker with < 1 s of audio yields no
 *   embedding).
 * @param {object} [opts]
 * @param {number} [opts.threshold=DEFAULT_MATCH_THRESHOLD]  cosine acceptance.
 * @param {number} [opts.seamGapSec=SEAM_MERGE_GAP_SEC]
 * @returns {Array<{start:number, end:number, speaker:number}>} global labels, sorted by start.
 */
export function reconcilePieces(pieces, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const seamGap = opts.seamGapSec ?? SEAM_MERGE_GAP_SEC;

  const globals = []; // { label, sum:Float64Array|null, count, dim }
  let nextLabel = 0;
  const out = [];

  for (const piece of pieces) {
    const emb = piece.embeddings || {};
    // Every local speaker that appears in EITHER the segments or the embeddings.
    // Keyed on the actual label values (a Map), so non-contiguous labels like
    // {0, 2} are handled without an array-index assumption.
    const localSpeakers = new Set();
    for (const s of piece.segments) localSpeakers.add(s.speaker);
    for (const k of Object.keys(emb)) localSpeakers.add(Number(k));

    const localToGlobal = new Map();
    for (const local of localSpeakers) {
      const e = emb[local];
      const hasEmb = !!(e && e.length);
      let assigned = -1;
      if (hasEmb) {
        let best = -1;
        let bestScore = -Infinity;
        for (const g of globals) {
          const score = cosineSimilarity(e, centroidOf(g)); // 0 vs a not-yet-embedded global
          if (score > bestScore) { bestScore = score; best = g.label; }
        }
        if (best >= 0 && bestScore >= threshold) assigned = best;
      }
      if (assigned < 0) {
        assigned = nextLabel;
        nextLabel += 1;
        globals.push({
          label: assigned,
          sum: hasEmb ? Float64Array.from(e) : null,
          count: hasEmb ? 1 : 0,
          dim: hasEmb ? e.length : 0,
        });
      } else if (hasEmb) {
        foldEmbedding(globals.find((g) => g.label === assigned), e);
      }
      localToGlobal.set(local, assigned);
    }

    for (const s of piece.segments) {
      out.push({
        start: s.start + piece.startSec,
        end: s.end + piece.startSec,
        speaker: localToGlobal.get(s.speaker),
      });
    }
  }

  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return mergeAdjacent(out, seamGap);
}

/**
 * Run the pieces across a client pool and reconcile. The pool dispatch is
 * least-outstanding: each client pulls the next unstarted piece when it goes idle,
 * so a slow piece never blocks the others (unlike a static chunk % N assignment).
 * Embeddings are computed AFTER all pieces resolve (embedSpeakers runs CAM++ on the
 * main thread; overlapping it with a saturated worker pool only adds UI jank).
 *
 * Any client rejection propagates (the caller distinguishes err.cancelled from a
 * real failure and either unwinds or falls back to a single full run).
 *
 * @param {object} args
 * @param {Float32Array} args.pcm            the clip to diarize (condensed or not).
 * @param {number} args.sampleRate
 * @param {Array<{run:(pcm:Float32Array, opts:object)=>Promise<Array>}>} args.clients
 * @param {(pcm:Float32Array, segments:Array, embeddingBytes:Uint8Array)=>Promise<Object>} args.embed
 * @param {Uint8Array} args.embeddingBytes
 * @param {object} [args.diarOpts]  extra options forwarded to each client.run.
 * @returns {Promise<Array<{start:number,end:number,speaker:number}>>}
 */
export async function runPiecewiseDiarization({ pcm, sampleRate, clients, embed, embeddingBytes, diarOpts = {} }) {
  const ranges = planPieceRanges(pcm, sampleRate);
  const segResults = new Array(ranges.length);

  let next = 0;
  const clientLoop = async (client) => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= ranges.length) return;
      const r = ranges[i];
      // Views, not copies: each client's run() slices+transfers a copy internally,
      // so passing a subarray never detaches the shared pcm for the other pieces.
      const segments = await client.run(pcm.subarray(r.start, r.end), { numSpeakers: -1, ...diarOpts });
      segResults[i] = { startSec: r.start / sampleRate, range: r, segments };
    }
  };
  await Promise.all(clients.map((c) => clientLoop(c)));

  // Embeddings on the main thread, after every piece has come back.
  const pieces = [];
  for (const sr of segResults) {
    const embeddings = await embed(pcm.subarray(sr.range.start, sr.range.end), sr.segments, embeddingBytes);
    pieces.push({ startSec: sr.startSec, segments: sr.segments, embeddings });
  }
  return reconcilePieces(pieces);
}
