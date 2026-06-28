// Pure helpers that merge diarization output with the transcript.
//
// Diarization gives us speaker segments {start, end, speaker} (seconds, 0-based
// integer speaker labels). The transcript gives us words {text, start_time,
// end_time, ...}. These functions assign each word to a speaker by temporal
// overlap and group consecutive same-speaker words into "turns" for the
// turns+colour rendering. No DOM, no engine: fully unit-testable.

/** Overlap (seconds) of [aStart,aEnd] and [bStart,bEnd]; 0 if disjoint. */
function overlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// Pick the speaker for one word: the segment it overlaps most. A word that
// overlaps nothing (it fell in a gap, or has zero duration) is assigned to the
// nearest segment by midpoint distance. With no segments at all, speaker 0.
function bestSpeakerFor(word, segments) {
  const ws = word.start_time ?? 0;
  const we = word.end_time ?? ws;
  const mid = (ws + we) / 2;
  let bestOv = 0, bestSpk = null;
  let bestDist = Infinity, nearestSpk = null;
  for (const s of segments) {
    const ov = overlap(ws, we, s.start, s.end);
    if (ov > bestOv) { bestOv = ov; bestSpk = s.speaker; }
    const dist = mid < s.start ? s.start - mid : (mid > s.end ? mid - s.end : 0);
    if (dist < bestDist) { bestDist = dist; nearestSpk = s.speaker; }
  }
  if (bestSpk !== null) return bestSpk;
  if (nearestSpk !== null) return nearestSpk;
  return 0;
}

/**
 * Assign each word a `speaker` by max temporal overlap with the segments.
 * Non-mutating: returns a new array of shallow-copied words with `speaker` set.
 *
 * @param {Array<{text:string,start_time:number,end_time:number}>} words
 * @param {Array<{start:number,end:number,speaker:number}>} segments
 * @returns {Array<object>} words with an added integer `speaker`
 */
export function assignSpeakersToWords(words, segments) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const segs = Array.isArray(segments) ? segments : [];
  return words.map((w) => ({ ...w, speaker: bestSpeakerFor(w, segs) }));
}

/**
 * Group consecutive same-speaker words into turns for rendering.
 *
 * @param {Array<object>} words words carrying a `speaker` (from
 *   {@link assignSpeakersToWords})
 * @returns {Array<{speaker:number,start_time:number,end_time:number,words:object[],text:string}>}
 */
export function groupWordsIntoTurns(words) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const turns = [];
  for (const w of words) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === w.speaker) {
      last.words.push(w);
      last.end_time = w.end_time ?? last.end_time;
    } else {
      turns.push({
        speaker: w.speaker,
        start_time: w.start_time ?? 0,
        end_time: w.end_time ?? w.start_time ?? 0,
        words: [w],
        text: '',
      });
    }
  }
  for (const turn of turns) {
    turn.text = turn.words.map((w) => (w.text ?? '').trim()).filter(Boolean).join(' ');
  }
  return turns;
}

/**
 * Resolve a raw speaker index to its merge ROOT, following the union-find parent
 * pointers in `merges` (a per-entry map `{ rawSpeaker -> mergedIntoRawSpeaker }`).
 * Cycle- and self-loop-safe. With no merges (or an unmerged speaker) returns the
 * speaker unchanged.
 *
 * @param {number} speaker
 * @param {Object<number|string, number>|null|undefined} merges
 * @returns {number}
 */
export function resolveSpeakerRoot(speaker, merges) {
  if (!merges) return speaker;
  let s = speaker;
  const seen = new Set();
  while (Object.prototype.hasOwnProperty.call(merges, s) && merges[s] !== s && !seen.has(s)) {
    seen.add(s);
    s = merges[s];
  }
  return s;
}

/**
 * Apply user speaker-merges and gap-free renumbering to a list of turns, so the
 * colours/labels the UI shows are merged and never skip an index.
 *
 * Two transforms, both pure (returns NEW turn objects, input untouched):
 *  1. Each turn's `speaker` is resolved to its merge ROOT (via {@link
 *     resolveSpeakerRoot}); adjacent turns that resolve to the same root are
 *     concatenated into one turn (so renaming speaker 3 -> speaker 2 collapses
 *     their now-adjacent turns and they share one colour).
 *  2. Each distinct root is assigned a contiguous, gap-free `position`
 *     (0,1,2,...) in order of first appearance, so raw speakers like 0,1,4 (the
 *     diarizer can skip a cluster index) render as positions 0,1,2 -- the
 *     palette and the default ordinal name never leave a gap.
 *
 * Output turns keep `speaker` = the stable root raw index (used for name lookup,
 * merge targeting and persistence) and gain `position` = the display slot (used
 * for the colour class and the default ordinal name).
 *
 * @param {Array<{speaker:number,text?:string,words?:object[],end_time?:number}>} turns
 * @param {Object<number|string, number>|null|undefined} merges
 * @returns {Array<object>} canonicalised turns with `speaker` (root) + `position`
 */
export function canonicalizeTurns(turns, merges) {
  if (!Array.isArray(turns) || turns.length === 0) return [];
  const merged = [];
  for (const turn of turns) {
    const root = resolveSpeakerRoot(turn.speaker, merges);
    const last = merged[merged.length - 1];
    if (last && last.speaker === root) {
      last.words = [...(last.words || []), ...(turn.words || [])];
      last.end_time = turn.end_time ?? last.end_time;
      last.text = [last.text, turn.text].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
    } else {
      merged.push({ ...turn, speaker: root });
    }
  }
  const positionOf = new Map();
  for (const turn of merged) {
    if (!positionOf.has(turn.speaker)) positionOf.set(turn.speaker, positionOf.size);
    turn.position = positionOf.get(turn.speaker);
  }
  return merged;
}

/** Number of distinct speakers in a diarization result. */
export function speakerCount(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return 0;
  return new Set(segments.map((s) => s.speaker)).size;
}

/**
 * Render turns as plain "Name: text" blocks for copying/exporting a diarized
 * transcript. `nameFor(speaker, position)` resolves a speaker (root index) and
 * its display position to its (possibly user-renamed) label -- the position lets
 * the resolver fall back to the gap-free default ordinal name from
 * {@link canonicalizeTurns}. `textFor(text)`, when given, transforms each turn's text
 * (e.g. the dictation regex cleanup) so the speaker view composes with it.
 * Turns with no text are dropped; blocks are separated by a blank line.
 *
 * @param {Array<{speaker:number,text:string}>} turns from {@link groupWordsIntoTurns}
 * @param {(speaker:number)=>string} nameFor
 * @param {((text:string)=>string)|null} [textFor] optional per-turn text transform
 * @returns {string}
 */
export function turnsToLabeledText(turns, nameFor, textFor = null) {
  if (!Array.isArray(turns) || turns.length === 0) return '';
  return turns
    .map((turn) => {
      const raw = turn.text ?? '';
      const text = textFor ? textFor(raw) : raw;
      return [nameFor(turn.speaker, turn.position), text.trim()];
    })
    .filter(([, text]) => text)
    .map(([name, text]) => `${name}: ${text}`)
    .join('\n\n');
}
