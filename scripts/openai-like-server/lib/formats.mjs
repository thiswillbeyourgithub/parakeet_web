// Response serialisers: turn one ParakeetModel result into the shape the caller
// asked for (json / text / srt / vtt / verbose_json).
//
// The pipeline returns `{ utterance_text, words: [{text, start_time, end_time,
// confidence}], confidence_scores, metrics }` -- words, never segments. Whisper
// (and therefore every subtitle tool pointed at an OpenAI-compatible endpoint)
// works in segments, so {@link buildSegments} groups words into segment-shaped
// cues. The grouping rules are deliberately boring and explainable:
//
//   1. a pause longer than `gapSec` between two words ends a segment (this is
//      the real signal: parakeet's TDT durations give trustworthy word times),
//   2. sentence-final punctuation ends a segment,
//   3. a speaker change (when diarizing) ends a segment -- never merge two
//      voices into one cue,
//   4. otherwise a soft `maxChars` cap ends it, so no cue is unreadably long.
//
// Nothing here invents data. Fields whisper reports that parakeet has no
// equivalent for are either honestly computed (`compression_ratio` is the real
// gzip ratio, `avg_logprob` is the log of the model's own mean word confidence)
// or left at a documented constant (`tokens: []`, `no_speech_prob: 0`) -- see
// README's "verbose_json field mapping" table.
//
// Built with Claude Code.

import { gzipSync } from 'node:zlib';

// A word ending in one of these closes a segment (rule 2). Kept to unambiguous
// sentence enders: a comma or colon would fragment cues, and an abbreviation dot
// ("Dr.") is rare enough in dictation output to not be worth special-casing.
const SENTENCE_END = /[.!?…。！？]["'»”’)\]]*$/;

/**
 * Group words into segments.
 *
 * @param {Array<{text:string,start_time:number,end_time:number,confidence?:number,speaker?:number}>} words
 * @param {object} opts
 * @param {number} opts.maxChars  soft cap on a segment's text length
 * @param {number} opts.gapSec    pause that forces a segment break
 * @returns {Array<object>} segments with id/start/end/text/words (+ speaker when the words carry one)
 */
export function buildSegments(words, { maxChars = 180, gapSec = 0.8 } = {}) {
  const segments = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    cur.text = cur.words.map((w) => w.text).join(' ').trim();
    if (cur.text) segments.push(cur);
    cur = null;
  };

  for (const w of words) {
    const start = num(w.start_time);
    const end = Math.max(start, num(w.end_time, start));
    const speakerChanged = cur && cur.speaker !== undefined && cur.speaker !== w.speaker;
    const gapTooBig = cur && start - cur.end > gapSec;
    const tooLong = cur && cur.charCount + w.text.length + 1 > maxChars;
    if (cur && (speakerChanged || gapTooBig || tooLong)) flush();
    if (!cur) {
      cur = { id: segments.length, start, end, text: '', words: [], charCount: 0 };
      if (w.speaker !== undefined) cur.speaker = w.speaker;
    }
    cur.words.push(w);
    cur.charCount += w.text.length + 1;
    cur.end = end;
    if (SENTENCE_END.test(w.text)) flush();
  }
  flush();
  // Re-number after the fact: a flush can drop an all-whitespace segment, and
  // ids must stay dense for clients that use them as array indices.
  segments.forEach((s, i) => { s.id = i; delete s.charCount; });
  return segments;
}

/** Coerce to a finite number, else `dflt`. Guards against undefined word times. */
function num(v, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** "[Speaker 3] " prefix, or "" when the segment has no speaker. */
function speakerPrefix(seg) {
  return seg.speaker === undefined || seg.speaker === null ? '' : `[Speaker ${seg.speaker}] `;
}

/** SRT timestamp: HH:MM:SS,mmm */
export function formatSrtTime(sec) {
  return timecode(sec, ',');
}

/** WebVTT timestamp: HH:MM:SS.mmm */
export function formatVttTime(sec) {
  return timecode(sec, '.');
}

function timecode(sec, msSep) {
  const t = Math.max(0, num(sec));
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${msSep}${p(rest, 3)}`;
}

/** SubRip subtitles. Speaker labels are inlined when the segments carry them. */
export function toSrt(segments) {
  return segments
    .map((seg, i) => `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${speakerPrefix(seg)}${seg.text}\n`)
    .join('\n');
}

/** WebVTT subtitles. */
export function toVtt(segments) {
  const cues = segments
    .map((seg) => `${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}\n${speakerPrefix(seg)}${seg.text}\n`)
    .join('\n');
  return `WEBVTT\n\n${cues}`;
}

/**
 * Plain text. With speakers, one line per turn prefixed by the label (the same
 * "[Speaker N]" convention the srt/vtt output uses) instead of one blob.
 */
export function toPlainText(result, segments) {
  const hasSpeakers = segments.some((s) => s.speaker !== undefined);
  if (!hasSpeakers) return `${result.utterance_text.trim()}\n`;
  const lines = [];
  for (const seg of segments) {
    const label = speakerPrefix(seg).trim();
    const prev = lines[lines.length - 1];
    // Merge consecutive segments from one speaker into a single line so a long
    // monologue is not chopped into a cue per sentence.
    if (prev && prev.label === label) prev.parts.push(seg.text);
    else lines.push({ label, parts: [seg.text] });
  }
  return `${lines.map((l) => `${l.label} ${l.parts.join(' ')}`.trim()).join('\n')}\n`;
}

/**
 * whisper's `compression_ratio`: len(text) / len(gzip(text)). Real, not faked --
 * clients use it to spot degenerate repetition loops, so a made-up constant
 * would defeat the check.
 */
export function compressionRatio(text) {
  if (!text) return 0;
  const raw = Buffer.byteLength(text, 'utf8');
  return +(raw / gzipSync(Buffer.from(text, 'utf8')).length).toFixed(6);
}

/**
 * Mean word confidence expressed as a log-prob, whisper's `avg_logprob` slot.
 * Returns null when the run produced no confidences (they are opt-in), which is
 * JSON-safe and unambiguous, unlike a fabricated 0.
 */
export function avgLogprob(words) {
  const confs = words.map((w) => Number(w.confidence)).filter((c) => Number.isFinite(c) && c > 0);
  if (!confs.length) return null;
  const mean = confs.reduce((a, b) => a + b, 0) / confs.length;
  return +Math.log(mean).toFixed(6);
}

/**
 * The OpenAI `verbose_json` body.
 *
 * @param {object} a
 * @param {object} a.result          ParakeetModel.transcribeChunked() result
 * @param {number} a.durationSec     decoded audio duration
 * @param {string} a.language        language echoed back (never detected here)
 * @param {Array}  a.segments        output of buildSegments (already speaker-tagged when diarizing)
 * @param {string[]} a.granularities requested timestamp_granularities
 * @param {number} [a.speakers]      speaker count, when diarization ran
 */
export function toVerboseJson({ result, durationSec, language, segments, granularities, speakers, temperature = 0 }) {
  const wantSegments = granularities.includes('segment');
  const wantWords = granularities.includes('word');
  const body = {
    task: 'transcribe',
    language,
    duration: +num(durationSec).toFixed(3),
    text: result.utterance_text.trim(),
  };
  if (wantWords) {
    body.words = (result.words || []).map((w) => {
      const out = { word: w.text, start: +num(w.start_time).toFixed(3), end: +num(w.end_time).toFixed(3) };
      if (Number.isFinite(Number(w.confidence))) out.confidence = +Number(w.confidence).toFixed(4);
      if (w.speaker !== undefined) out.speaker = w.speaker;
      return out;
    });
  }
  if (wantSegments) {
    body.segments = segments.map((seg) => {
      const out = {
        id: seg.id,
        // `seek` is whisper's 30-second-window offset. We have no such window;
        // 0 is the honest value (every segment is addressed by start/end).
        seek: 0,
        start: +num(seg.start).toFixed(3),
        end: +num(seg.end).toFixed(3),
        text: ` ${seg.text}`,            // whisper emits a leading space; tools strip it
        tokens: [],                      // parakeet BPE ids are not whisper token ids
        temperature,
        avg_logprob: avgLogprob(seg.words),
        compression_ratio: compressionRatio(seg.text),
        no_speech_prob: 0,               // no VAD/no-speech head in this pipeline
      };
      if (seg.speaker !== undefined) out.speaker = seg.speaker;
      return out;
    });
  }
  if (speakers !== undefined) body.speakers = speakers;
  return body;
}

/**
 * Serialise a finished run into `{ contentType, body }` for the wire.
 *
 * @param {string} format one of RESPONSE_FORMATS
 */
export function serialiseResult(format, { result, durationSec, language, segments, granularities, speakers, temperature }) {
  switch (format) {
    case 'text':
      return { contentType: 'text/plain; charset=utf-8', body: toPlainText(result, segments) };
    case 'srt':
      return { contentType: 'application/x-subrip; charset=utf-8', body: toSrt(segments) };
    case 'vtt':
      return { contentType: 'text/vtt; charset=utf-8', body: toVtt(segments) };
    case 'verbose_json':
      return {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(toVerboseJson({ result, durationSec, language, segments, granularities, speakers, temperature })),
      };
    case 'json':
    default:
      return {
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ text: result.utterance_text.trim() }),
      };
  }
}
