// Tier-1 tests for the OpenAI-like server's response serialisers
// (scripts/openai-like-server/lib/formats.mjs).
//
// The pipeline emits WORDS; whisper clients consume SEGMENTS. Everything that can
// go subtly wrong lives in that conversion -- a cue that spans two speakers, a
// segment that never breaks and produces one unreadable subtitle, an off-by-one
// in the SRT timecode -- so each grouping rule gets its own case with word times
// chosen to trigger exactly one rule at a time.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSegments, toSrt, toVtt, toPlainText, toVerboseJson, serialiseResult,
  formatSrtTime, formatVttTime, compressionRatio, avgLogprob,
} from '../../scripts/openai-like-server/lib/formats.mjs';

/** Build a word list from [text, start, end, extra?] tuples. */
const words = (...rows) => rows.map(([text, start, end, extra = {}]) => ({
  text, start_time: start, end_time: end, ...extra,
}));

test('words with no pause and no punctuation stay in one segment', () => {
  const segs = buildSegments(words(['hello', 0, 0.4], ['there', 0.45, 0.9]));
  assert.equal(segs.length, 1);
  assert.equal(segs[0].text, 'hello there');
  assert.equal(segs[0].start, 0);
  assert.equal(segs[0].end, 0.9);
});

test('a pause longer than gapSec starts a new segment', () => {
  const segs = buildSegments(words(['one', 0, 0.5], ['two', 3, 3.5]), { gapSec: 0.8 });
  assert.equal(segs.length, 2);
  assert.deepEqual(segs.map((s) => s.text), ['one', 'two']);
  // A pause just under the threshold must NOT split.
  const together = buildSegments(words(['one', 0, 0.5], ['two', 1.2, 1.5]), { gapSec: 0.8 });
  assert.equal(together.length, 1);
});

test('sentence-final punctuation closes a segment', () => {
  const segs = buildSegments(words(['Bonjour.', 0, 0.5], ['Ensuite', 0.6, 1.0]));
  assert.deepEqual(segs.map((s) => s.text), ['Bonjour.', 'Ensuite']);
  // Also through a closing quote/bracket, and for ! ? and the ellipsis.
  for (const w of ['fini!', 'quoi?', 'attends…', 'dit."']) {
    const s = buildSegments(words([w, 0, 0.5], ['next', 0.6, 1]));
    assert.equal(s.length, 2, `${w} should close a segment`);
  }
  // A comma must not: it would fragment every cue.
  assert.equal(buildSegments(words(['alors,', 0, 0.5], ['ensuite', 0.6, 1])).length, 1);
});

test('a speaker change always closes a segment, even mid-sentence', () => {
  const segs = buildSegments(words(
    ['bonjour', 0, 0.5, { speaker: 0 }],
    ['ensuite', 0.6, 1.0, { speaker: 1 }],
  ));
  assert.equal(segs.length, 2, 'two voices must never share a cue');
  assert.deepEqual(segs.map((s) => s.speaker), [0, 1]);
});

test('maxChars caps a segment softly', () => {
  const long = Array.from({ length: 30 }, (_, i) => ['mot', i * 0.3, i * 0.3 + 0.25]);
  const segs = buildSegments(words(...long), { maxChars: 40, gapSec: 5 });
  assert.ok(segs.length > 1, 'a long run must be broken up');
  for (const s of segs) assert.ok(s.text.length <= 45, `segment too long: ${s.text.length}`);
});

test('segment ids are dense and ordered', () => {
  const segs = buildSegments(words(['a.', 0, 0.2], ['b.', 1.5, 1.7], ['c.', 3, 3.2]));
  assert.deepEqual(segs.map((s) => s.id), [0, 1, 2]);
});

test('no words means no segments (not a crash, not an empty cue)', () => {
  assert.deepEqual(buildSegments([]), []);
  assert.deepEqual(buildSegments(words(['   ', 0, 0.1])), []);
});

test('missing word times degrade to 0 instead of NaN', () => {
  const segs = buildSegments([{ text: 'mot' }]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].start, 0);
  assert.equal(segs[0].end, 0);
});

test('SRT and VTT timecodes are exact', () => {
  assert.equal(formatSrtTime(0), '00:00:00,000');
  assert.equal(formatSrtTime(1.5), '00:00:01,500');
  assert.equal(formatSrtTime(3661.5), '01:01:01,500');
  assert.equal(formatVttTime(3661.5), '01:01:01.500');
  // Negative times cannot happen but must not produce garbage timecodes.
  assert.equal(formatSrtTime(-1), '00:00:00,000');
});

test('SRT is 1-indexed with a blank line between cues', () => {
  const segs = buildSegments(words(['un.', 0, 0.5], ['deux.', 2, 2.5]));
  const srt = toSrt(segs);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:00,500\nun\.\n\n2\n/);
});

test('VTT starts with the WEBVTT header', () => {
  const vtt = toVtt(buildSegments(words(['un.', 0, 0.5])));
  assert.match(vtt, /^WEBVTT\n\n00:00:00\.000 --> 00:00:00\.500\nun\./);
});

test('speaker labels are inlined in srt/vtt when diarizing', () => {
  const segs = buildSegments(words(['salut.', 0, 0.5, { speaker: 2 }]));
  assert.match(toSrt(segs), /\[Speaker 2\] salut\./);
  assert.match(toVtt(segs), /\[Speaker 2\] salut\./);
});

test('plain text is one blob without speakers, one line per turn with them', () => {
  const plain = toPlainText({ utterance_text: ' bonjour tout le monde ' }, []);
  assert.equal(plain, 'bonjour tout le monde\n');

  const segs = buildSegments(words(
    ['salut.', 0, 0.5, { speaker: 0 }],
    ['ca', 0.6, 0.8, { speaker: 0 }],
    ['va.', 0.85, 1.1, { speaker: 0 }],
    ['oui.', 1.4, 1.8, { speaker: 1 }],
  ));
  const lines = toPlainText({ utterance_text: 'salut. ca va. oui.' }, segs).trim().split('\n');
  // Consecutive segments from one speaker collapse into a single line.
  assert.deepEqual(lines, ['[Speaker 0] salut. ca va.', '[Speaker 1] oui.']);
});

test('compression_ratio is the real gzip ratio, not a constant', () => {
  const repetitive = 'la la la la la la la la la la la la la la la la la la la la la la';
  const varied = 'the quick brown fox jumps over the lazy dog while pondering entropy';
  assert.ok(compressionRatio(repetitive) > compressionRatio(varied),
    'repetition must compress better -- that is what clients use it to detect');
  assert.equal(compressionRatio(''), 0);
});

test('avg_logprob is null without confidences and log(mean) with them', () => {
  assert.equal(avgLogprob(words(['a', 0, 1])), null, 'no confidences -> null, never a fabricated 0');
  const w = words(['a', 0, 1, { confidence: 1 }], ['b', 1, 2, { confidence: 1 }]);
  assert.equal(avgLogprob(w), 0, 'confidence 1.0 (temperature 0) is log 0');
  const half = avgLogprob(words(['a', 0, 1, { confidence: 0.5 }]));
  assert.ok(half < 0 && half > -1, `expected log(0.5), got ${half}`);
});

test('verbose_json: segment granularity carries the whisper field set', () => {
  const result = { utterance_text: 'un deux.', words: words(['un', 0, 0.4], ['deux.', 0.5, 1]) };
  const segs = buildSegments(result.words);
  const body = toVerboseJson({
    result, durationSec: 1.23, language: 'fr', segments: segs, granularities: ['segment'],
  });
  assert.equal(body.task, 'transcribe');
  assert.equal(body.language, 'fr');
  assert.equal(body.duration, 1.23);
  assert.equal(body.text, 'un deux.');
  assert.equal(body.words, undefined, 'words only appear for the word granularity');
  assert.equal(body.segments.length, 1);
  const seg = body.segments[0];
  for (const k of ['id', 'seek', 'start', 'end', 'text', 'tokens', 'temperature',
    'avg_logprob', 'compression_ratio', 'no_speech_prob']) {
    assert.ok(k in seg, `verbose_json segment is missing ${k}`);
  }
  assert.equal(seg.text, ' un deux.', 'whisper emits a leading space');
  assert.deepEqual(seg.tokens, [], 'parakeet BPE ids are not whisper token ids');
});

test('verbose_json: word granularity emits OpenAI word objects', () => {
  const result = { utterance_text: 'un', words: words(['un', 0.123456, 0.4, { confidence: 0.9, speaker: 1 }]) };
  const body = toVerboseJson({
    result, durationSec: 1, language: 'fr', segments: [], granularities: ['word'],
  });
  assert.equal(body.segments, undefined);
  assert.deepEqual(body.words, [{ word: 'un', start: 0.123, end: 0.4, confidence: 0.9, speaker: 1 }]);
});

test('verbose_json: both granularities at once', () => {
  const result = { utterance_text: 'un.', words: words(['un.', 0, 0.4]) };
  const body = toVerboseJson({
    result, durationSec: 1, language: 'fr',
    segments: buildSegments(result.words), granularities: ['segment', 'word'],
  });
  assert.ok(Array.isArray(body.segments));
  assert.ok(Array.isArray(body.words));
});

test('verbose_json reports the speaker count only when diarization ran', () => {
  const result = { utterance_text: 'un.', words: words(['un.', 0, 0.4]) };
  const base = { result, durationSec: 1, language: 'fr', segments: [], granularities: [] };
  assert.equal('speakers' in toVerboseJson(base), false);
  assert.equal(toVerboseJson({ ...base, speakers: 3 }).speakers, 3);
});

test('serialiseResult picks the right content type for each format', () => {
  const result = { utterance_text: 'un.', words: words(['un.', 0, 0.4]) };
  const args = {
    result, durationSec: 1, language: 'fr',
    segments: buildSegments(result.words), granularities: ['segment'],
  };
  assert.match(serialiseResult('json', args).contentType, /application\/json/);
  assert.equal(JSON.parse(serialiseResult('json', args).body).text, 'un.');
  assert.match(serialiseResult('text', args).contentType, /text\/plain/);
  assert.match(serialiseResult('srt', args).contentType, /application\/x-subrip/);
  assert.match(serialiseResult('vtt', args).contentType, /text\/vtt/);
  assert.match(serialiseResult('verbose_json', args).contentType, /application\/json/);
  // An unknown format falls back to json rather than throwing (the route
  // validates the value long before this point).
  assert.match(serialiseResult('nonsense', args).contentType, /application\/json/);
});
