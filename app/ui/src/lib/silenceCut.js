// Silence excision for the diarization pipeline. sherpa's pyannote segmentation
// cost scales with audio length, so long recordings with dead air are cheaper to
// diarize after their long silences are cut out. This module finds those
// silences, produces a condensed PCM buffer, and (critically) remaps the
// diarizer's condensed-timeline segments back onto the ORIGINAL timeline so
// nothing downstream (embeddings, word assignment, persistence) has to change.
//
// The energy machinery is NOT duplicated here: it is imported from
// createEnergySampler in app/src/parakeet.js (the same "~150 ms mean-square"
// definition used to snap chunk seams), whose hopProfile() gives a dense energy
// reading over the whole clip in one O(N) pass.

import { createEnergySampler } from '../../../src/parakeet.js';

// Hop between energy probes when scanning for silence (10 ms).
export const SILENCE_HOP_SEC = 0.010;
// Noise floor = this percentile of the per-hop energies. Low enough to sit inside
// genuine silence, high enough to ignore the single quietest hop.
export const NOISE_FLOOR_PERCENTILE = 5;
// A hop is "silent" when its energy is below max(noiseFloor * FACTOR, ABS_FLOOR),
// but never above SILENCE_MAX_FRAC of the speech level (see below).
export const SILENCE_FACTOR = 3;
// Absolute floor so digital-silence clips (noiseFloor == 0) still threshold sanely.
export const SILENCE_ABS_FLOOR = 1e-6;
// The "speech level" reference: a high percentile of the per-hop energies.
export const SILENCE_SPEECH_PERCENTILE = 95;
// Ceiling on the silence threshold as a fraction of the speech level. Without it,
// a clip with NO real silence has noiseFloor ~= speech energy, so noiseFloor*FACTOR
// rises ABOVE the actual signal and marks the whole clip silent. Capping the
// threshold well below the speech level makes an all-speech clip yield no cuts,
// while genuine pauses (energy near 0) still fall under it.
export const SILENCE_MAX_FRAC = 0.3;
// Only silences at least this long are worth excising.
export const DEFAULT_MIN_SILENCE_SEC = 2.0;
// Keep this much real silence at each edge of an excised run. 2*pad (0.7 s) stays
// above sherpa's minDurationOff (0.5 s) bridge, so two speech regions that were
// separate before excision stay separate after: no bridging regression by design.
export const DEFAULT_PAD_SEC = 0.35;
// In-place linear fade applied at each splice join (10 ms) to kill the step
// discontinuity. The joins sit inside the kept silence pads, so this taper
// removes no speech; it only prevents a click from reading as a false onset.
export const SPLICE_FADE_SEC = 0.010;

/**
 * The p-th percentile of a numeric array (linear interpolation), non-mutating.
 * @param {ArrayLike<number>} values
 * @param {number} p  percentile in [0, 100]
 * @returns {number}
 */
function percentile(values, p) {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = Array.prototype.slice.call(values).sort((a, b) => a - b);
  if (n === 1) return sorted[0];
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/**
 * Find the sample-index runs to excise as silence.
 *
 * @param {Float32Array} pcm         mono PCM.
 * @param {number} sampleRate        samples per second.
 * @param {object} [opts]
 * @param {number} [opts.minSilenceSec=DEFAULT_MIN_SILENCE_SEC]
 * @param {number} [opts.padSec=DEFAULT_PAD_SEC]
 * @param {number} [opts.factor=SILENCE_FACTOR]
 * @param {number} [opts.absFloor=SILENCE_ABS_FLOOR]
 * @returns {Array<{start:number, end:number}>} runs (in samples) to REMOVE, in
 *   ascending order, non-overlapping. Empty when nothing qualifies.
 */
export function findSilenceCuts(pcm, sampleRate, opts = {}) {
  const minSilenceSec = opts.minSilenceSec ?? DEFAULT_MIN_SILENCE_SEC;
  const padSec = opts.padSec ?? DEFAULT_PAD_SEC;
  const factor = opts.factor ?? SILENCE_FACTOR;
  const absFloor = opts.absFloor ?? SILENCE_ABS_FLOOR;
  if (!pcm || pcm.length === 0 || sampleRate <= 0) return [];

  const hopSamples = Math.max(1, Math.round(SILENCE_HOP_SEC * sampleRate));
  const { energies } = createEnergySampler(pcm, sampleRate).hopProfile(hopSamples);
  const noiseFloor = percentile(energies, NOISE_FLOOR_PERCENTILE);
  const speechRef = percentile(energies, SILENCE_SPEECH_PERCENTILE);
  // Adaptive threshold, but ceilinged below the speech level so a clip without any
  // real silence is not wholly excised (see SILENCE_MAX_FRAC).
  const threshold = Math.max(Math.min(noiseFloor * factor, speechRef * SILENCE_MAX_FRAC), absFloor);

  const minSilenceSamples = Math.round(minSilenceSec * sampleRate);
  const padSamples = Math.round(padSec * sampleRate);
  const cuts = [];

  // Walk contiguous runs of below-threshold hops; convert each to a sample span.
  let runLo = -1;
  const flush = (loHop, hiHop) => {
    const runStart = loHop * hopSamples;
    const runEnd = Math.min(pcm.length, (hiHop + 1) * hopSamples);
    if (runEnd - runStart < minSilenceSamples) return;
    const excStart = runStart + padSamples;
    const excEnd = runEnd - padSamples;
    if (excEnd > excStart) cuts.push({ start: excStart, end: excEnd });
  };
  for (let h = 0; h < energies.length; h += 1) {
    const silent = energies[h] < threshold;
    if (silent && runLo < 0) runLo = h;
    else if (!silent && runLo >= 0) { flush(runLo, h - 1); runLo = -1; }
  }
  if (runLo >= 0) flush(runLo, energies.length - 1);
  return cuts;
}

/**
 * Produce a condensed PCM buffer with the given cut runs removed, plus a map that
 * lets condensed-timeline positions be translated back to the original timeline.
 *
 * @param {Float32Array} pcm
 * @param {Array<{start:number, end:number}>} cuts  sorted, non-overlapping sample runs to remove.
 * @param {number} [sampleRate=16000]  used only to size the anti-click splice fade.
 * @returns {{pcm:Float32Array, map:Array<{condStart:number, origStart:number, length:number}>}}
 *   `map` entries are the KEPT spans, in condensed order; each covers condensed
 *   samples [condStart, condStart+length) mapping to original [origStart, ...).
 */
export function excisePcm(pcm, cuts, sampleRate = 16000) {
  if (!cuts || cuts.length === 0) {
    return { pcm, map: [{ condStart: 0, origStart: 0, length: pcm.length }] };
  }
  // Kept spans are the complement of the cuts within [0, pcm.length).
  const kept = [];
  let cursor = 0;
  for (const c of cuts) {
    if (c.start > cursor) kept.push({ origStart: cursor, length: c.start - cursor });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < pcm.length) kept.push({ origStart: cursor, length: pcm.length - cursor });

  const condLength = kept.reduce((s, k) => s + k.length, 0);
  const out = new Float32Array(condLength);
  const map = [];
  let condStart = 0;
  for (const k of kept) {
    out.set(pcm.subarray(k.origStart, k.origStart + k.length), condStart);
    map.push({ condStart, origStart: k.origStart, length: k.length });
    condStart += k.length;
  }

  // Taper each splice join so the step from one span's tail into the next reads as
  // noise, not an onset: ramp the outgoing tail down to ~0 and the incoming head
  // up from ~0. Lengths are unchanged, so remapSegments' math is untouched. The
  // joins sit inside the kept silence pads, so no speech is lost. Fade is clamped
  // to each span so a short span never bleeds into its neighbour.
  const fadeSamples = Math.max(1, Math.round(SPLICE_FADE_SEC * sampleRate));
  for (let i = 1; i < map.length; i += 1) {
    const j = map[i].condStart;                       // join sample in condensed buffer
    const outFade = Math.min(fadeSamples, map[i - 1].length);
    for (let k = 0; k < outFade; k += 1) {
      out[j - 1 - k] *= (k + 1) / (outFade + 1);      // ...tail ramps 1 -> ~0 toward the join
    }
    const inFade = Math.min(fadeSamples, map[i].length);
    for (let k = 0; k < inFade; k += 1) {
      out[j + k] *= (k + 1) / (inFade + 1);           // head ramps ~0 -> 1 away from the join
    }
  }
  return { pcm: out, map };
}

/**
 * Remap diarizer segments from the condensed timeline back to the original
 * timeline. A segment that spans an excised gap (possible if sherpa bridges
 * across a splice) is SPLIT at kept-span boundaries into one same-speaker segment
 * per span, so it never inflates to cover the removed silence.
 *
 * @param {Array<{start:number, end:number, speaker:number}>} segments  condensed seconds.
 * @param {Array<{condStart:number, origStart:number, length:number}>} map  from excisePcm.
 * @param {number} sampleRate
 * @returns {Array<{start:number, end:number, speaker:number}>} original-timeline seconds.
 */
export function remapSegments(segments, map, sampleRate) {
  if (!segments || segments.length === 0) return [];
  if (!map || map.length === 0) return segments.map((s) => ({ ...s }));
  const out = [];
  for (const seg of segments) {
    const cs = seg.start * sampleRate;
    const ce = seg.end * sampleRate;
    for (const span of map) {
      const spanCondEnd = span.condStart + span.length;
      const lo = Math.max(cs, span.condStart);
      const hi = Math.min(ce, spanCondEnd);
      if (hi <= lo) continue;  // no overlap with this kept span
      const origLo = span.origStart + (lo - span.condStart);
      const origHi = span.origStart + (hi - span.condStart);
      out.push({ start: origLo / sampleRate, end: origHi / sampleRate, speaker: seg.speaker });
    }
  }
  return out;
}
