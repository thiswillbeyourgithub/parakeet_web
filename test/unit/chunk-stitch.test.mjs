// Tier-1 unit test for ParakeetModel.transcribeChunked() overlap stitching
// (app/src/parakeet.js). No ONNX/model download is needed: we borrow the real
// transcribeChunked off the prototype onto a stub whose `transcribe` is a
// scripted, deterministic transcriber.
//
// The trick (mirroring beam-decode.test.mjs) is to encode each sample's absolute
// index into the audio buffer itself: audio[i] = i. transcribeChunked hands the
// stub a zero-copy subarray, so chunk[0] recovers the chunk's absolute start
// sample, letting the stub emit chunk-local timestamps for a fixed "ground
// truth" transcript. That reproduces exactly what the real model does: the
// overlap zone is transcribed twice (once per neighbouring chunk).
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ParakeetModel, lcsPairs, mergeOverlapWords, normalizeWordText, planChunks } from '../../app/src/parakeet.js';

const SR = 16000;

// Ground-truth transcript in ABSOLUTE seconds. Two words ("echo", "charlie")
// land inside the overlap zone of the two-chunk layout below and so are seen by
// both chunks; "alpha"/"bravo" are exclusive to chunk 1 and "delta" to chunk 2.
const TRUTH = [
  { text: 'alpha',   start: 1.0,  end: 2.0 },  // chunk 1 only
  { text: 'bravo',   start: 5.0,  end: 6.0 },  // chunk 1 only
  { text: 'echo',    start: 8.2,  end: 8.4 },  // overlap, midpoint 8.3 (before seam)
  { text: 'charlie', start: 8.5,  end: 9.5 },  // overlap, midpoint 9.0 (== seam)
  { text: 'delta',   start: 11.0, end: 12.0 }, // chunk 2 only
];

// audio[i] = i so chunk[0] === absolute start sample of the chunk.
function makeAudio(nSamples) {
  const a = new Float32Array(nSamples);
  for (let i = 0; i < nSamples; i++) a[i] = i;
  return a;
}

// Scripted transcriber: emits every TRUTH word fully contained in the chunk's
// [startSec, endSec) span, with chunk-local timestamps. Honours returnTimestamps
// the way the real transcribe() does (no words => no timestamps).
// `metricsPerCall(i)` (optional) returns the per-stage metrics the stub reports
// for the i-th transcribe() call (0-based), letting a test feed distinct timings
// per chunk and assert how transcribeChunked aggregates them. Pass `null` to
// have the stub report no metrics at all (metrics: null), mirroring profiling
// being off. Defaults to a constant { total_ms: 1 } for the stitching tests,
// which don't inspect metrics.
function makeModel({ withTimestamps = true, metricsPerCall } = {}) {
  let calls = 0;
  return {
    transcribeChunked: ParakeetModel.prototype.transcribeChunked,
    transcribe: async (chunk, sampleRate, opts) => {
      const callIndex = calls++;
      const startSec = chunk[0] / sampleRate;
      const endSec = (chunk[0] + chunk.length) / sampleRate;
      const inChunk = TRUTH.filter((w) => w.start >= startSec && w.end <= endSec);
      const wantTs = withTimestamps && opts.returnTimestamps;
      const words = wantTs
        ? inChunk.map((w) => ({
            text: w.text,
            start_time: +(w.start - startSec).toFixed(3),
            end_time: +(w.end - startSec).toFixed(3),
            confidence: 1,
          }))
        : [];
      const metrics = metricsPerCall === undefined
        ? { total_ms: 1 }
        : (metricsPerCall ? metricsPerCall(callIndex) : null);
      return {
        utterance_text: inChunk.map((w) => w.text).join(' '),
        words,
        confidence_scores: {},
        metrics,
        is_final: true,
      };
    },
  };
}

// chunkDurationSec 10 + overlapSec 2 => maxChunkSamples 160000, stride 128000.
// audio of 200000 samples (12.5 s) gives exactly two chunks:
//   chunk 1: [0, 160000]      => 0..10 s
//   chunk 2: [128000, 200000] => 8..12.5 s
// overlap [8 s, 10 s], seam at the midpoint 9.0 s.
// snapToSilenceSec: 0 pins the fixed-stride layout: the audio[i]=i harness has
// monotonically increasing "energy" (it encodes sample indices, not real audio),
// which would snap every seam to the window start and move the boundaries these
// dedup tests reason about. Silence snapping has its own tests over planChunks.
const CHUNK_OPTS = { enableChunking: true, chunkDurationSec: 10, overlapSec: 2, returnTimestamps: true, snapToSilenceSec: 0 };
const AUDIO = makeAudio(200000);

describe('transcribeChunked overlap dedup (seam)', () => {
  test('splits into two overlapping chunks', async () => {
    const seen = [];
    const model = makeModel();
    await model.transcribeChunked(AUDIO, SR, CHUNK_OPTS, async ({ totalChunks }) => { seen.push(totalChunks); });
    assert.equal(seen.length, 2, 'onChunk fires once per chunk');
    assert.ok(seen.every((n) => n === 2), 'totalChunks reported as 2');
  });

  test('each overlap word survives exactly once', async () => {
    const model = makeModel();
    const res = await model.transcribeChunked(AUDIO, SR, CHUNK_OPTS);
    assert.deepEqual(res.words.map((w) => w.text), ['alpha', 'bravo', 'echo', 'charlie', 'delta']);
  });

  test('combined text is rebuilt from the deduped words (no duplicate seam text)', async () => {
    const model = makeModel();
    const res = await model.transcribeChunked(AUDIO, SR, CHUNK_OPTS);
    assert.equal(res.utterance_text, 'alpha bravo echo charlie delta');
  });

  test('overlap words are text-anchored: earlier chunk kept through the middle anchor, later chunk after', async () => {
    const model = makeModel();
    const res = await model.transcribeChunked(AUDIO, SR, CHUNK_OPTS);
    const echo = res.words.find((w) => w.text === 'echo');
    const charlie = res.words.find((w) => w.text === 'charlie');
    // Overlap ["echo","charlie"] aligns 1:1; the middle common anchor is "echo",
    // so "echo" is kept from chunk 1 and "charlie" from chunk 2. Both chunks
    // report the same absolute times here, so the values are unambiguous.
    assert.ok(Math.abs(echo.start_time - 8.2) < 1e-6 && Math.abs(echo.end_time - 8.4) < 1e-6);
    assert.ok(Math.abs(charlie.start_time - 8.5) < 1e-6 && Math.abs(charlie.end_time - 9.5) < 1e-6);
  });

  test('word timestamps are absolute and strictly ordered', async () => {
    const model = makeModel();
    const res = await model.transcribeChunked(AUDIO, SR, CHUNK_OPTS);
    for (let i = 1; i < res.words.length; i++) {
      assert.ok(res.words[i].start_time >= res.words[i - 1].start_time, 'words ordered by start_time');
    }
  });
});

describe('transcribeChunked without dedup', () => {
  test('single pass (enableChunking false) returns words verbatim, no dedup applied', async () => {
    const model = makeModel();
    const res = await model.transcribeChunked(AUDIO, SR, { ...CHUNK_OPTS, enableChunking: false });
    // One pass over the whole buffer sees every word once anyway.
    assert.deepEqual(res.words.map((w) => w.text), ['alpha', 'bravo', 'echo', 'charlie', 'delta']);
  });

  test('returnTimestamps false falls back to plain concat (overlap text duplicated, documents the limitation)', async () => {
    const model = makeModel({ withTimestamps: false });
    const res = await model.transcribeChunked(AUDIO, SR, { ...CHUNK_OPTS, returnTimestamps: false });
    // No words to align on, so the overlap zone ("echo charlie") appears twice.
    assert.equal(res.utterance_text, 'alpha bravo echo charlie echo charlie delta');
    assert.equal(res.words.length, 0);
  });
});

describe('transcribeChunked metrics aggregation', () => {
  // Distinct per-stage timings per chunk so we prove every chunk is summed (not
  // just the first one doubled). Two-chunk layout (see CHUNK_OPTS/AUDIO above).
  const PERCALL = (i) => ({
    preprocess_ms: 1 + i,    // chunk0 1 + chunk1 2  => 3
    encode_ms: 100 + i,      // 100 + 101            => 201
    decode_ms: 50 + i,       // 50  + 51             => 101
    tokenize_ms: 2 + i,      // 2   + 3              => 5
    total_ms: 1000 + i * 10, // 1000 + 1010          => 2010
  });

  test('sums every per-stage timing across all chunks, not just the first', async () => {
    const model = makeModel({ metricsPerCall: PERCALL });
    const res = await model.transcribeChunked(AUDIO, SR, CHUNK_OPTS);
    assert.equal(res.metrics.preprocess_ms, 3);
    assert.equal(res.metrics.encode_ms, 201);
    assert.equal(res.metrics.decode_ms, 101);
    assert.equal(res.metrics.tokenize_ms, 5);
    assert.equal(res.metrics.total_ms, 2010);
  });

  test('procPerDur is the summed processing time over the whole audio duration', async () => {
    const model = makeModel({ metricsPerCall: PERCALL });
    const res = await model.transcribeChunked(AUDIO, SR, CHUNK_OPTS);
    // total 2010 ms over 200000 samples / 16000 = 12.5 s => 2.01/12.5 = 0.1608 -> 0.16
    assert.equal(res.metrics.procPerDur, 0.16);
  });

  test('returns metrics: null when no chunk reports timings (profiling off)', async () => {
    const model = makeModel({ metricsPerCall: null });
    const res = await model.transcribeChunked(AUDIO, SR, CHUNK_OPTS);
    assert.equal(res.metrics, null);
  });
});

// Word factory for the pure-function tests below: a timestamped word centred at
// `mid` seconds (a nominal 0.2 s span, only the midpoint matters to the seam).
const W = (text, mid) => ({ text, start_time: mid - 0.1, end_time: mid + 0.1 });
const wordMid = (w) => (w.start_time + w.end_time) / 2;

describe('normalizeWordText', () => {
  test('lowercases and strips punctuation so "You." matches "you"', () => {
    assert.equal(normalizeWordText('You.'), normalizeWordText('you'));
    assert.equal(normalizeWordText('  Ask, '), 'ask');
    assert.equal(normalizeWordText("don't"), 'dont');
    assert.equal(normalizeWordText(undefined), '');
  });
});

describe('lcsPairs', () => {
  test('empty inputs yield no pairs', () => {
    assert.deepEqual(lcsPairs([], ['a']), []);
    assert.deepEqual(lcsPairs(['a'], []), []);
  });
  test('identical sequences pair up 1:1', () => {
    assert.deepEqual(lcsPairs(['a', 'b', 'c'], ['a', 'b', 'c']), [[0, 0], [1, 1], [2, 2]]);
  });
  test('finds the longest common subsequence with a gap on each side', () => {
    // a X b c  vs  a b Y c  => common a,b,c
    assert.deepEqual(lcsPairs(['a', 'x', 'b', 'c'], ['a', 'b', 'y', 'c']), [[0, 0], [2, 1], [3, 3]]);
  });
  test('no shared token yields no pairs', () => {
    assert.deepEqual(lcsPairs(['a', 'b'], ['c', 'd']), []);
  });
});

describe('mergeOverlapWords (text-anchored seam)', () => {
  const seamSec = 9.0; // overlap [8,10], midpoint 9

  test('empty side returns the other verbatim', () => {
    const r = [W('delta', 9.5)];
    assert.deepEqual(mergeOverlapWords([], r, { seamSec, wordMid }), r);
    assert.deepEqual(mergeOverlapWords(r, [], { seamSec, wordMid }), r);
  });

  test('a word both chunks agree on survives exactly once (splice at the anchor)', () => {
    const left = [W('echo', 8.3), W('charlie', 9.0)];
    const right = [W('echo', 8.3), W('charlie', 9.0)];
    const merged = mergeOverlapWords(left, right, { seamSec, wordMid });
    assert.deepEqual(merged.map((w) => w.text), ['echo', 'charlie']);
  });

  test('JITTER: shared word whose per-chunk midpoints straddle the seam is NOT duplicated', () => {
    // "hello" decoded at 8.8 in the earlier chunk (< seam) and at 9.1 in the
    // later chunk (>= seam) due to frame-alignment jitter. A pure midpoint-time
    // split would keep it from BOTH sides and duplicate it; text anchoring keeps
    // it once.
    const left = [W('hello', 8.8)];
    const right = [W('hello', 9.1)];
    const merged = mergeOverlapWords(left, right, { seamSec, wordMid });
    assert.deepEqual(merged.map((w) => w.text), ['hello']);
  });

  test('JITTER: shared word whose midpoints cross the OTHER way is NOT dropped', () => {
    // Mirror case: "world" at 9.1 in the earlier chunk (>= seam, a midpoint cut
    // drops it from the left) and at 8.8 in the later chunk (< seam, dropped
    // from the right) => the old logic loses it entirely. Text anchoring keeps
    // it.
    const left = [W('world', 9.1)];
    const right = [W('world', 8.8)];
    const merged = mergeOverlapWords(left, right, { seamSec, wordMid });
    assert.deepEqual(merged.map((w) => w.text), ['world']);
  });

  test('case/punctuation disagreement still aligns (You. vs you)', () => {
    const left = [W('for', 8.4), W('You.', 8.9)];
    const right = [W('you', 8.9), W('ask', 9.4)];
    const merged = mergeOverlapWords(left, right, { seamSec, wordMid });
    // "You." (earlier chunk's casing) survives once; "ask" comes from the later
    // chunk. "for" is the earlier chunk's exclusive lead-in.
    assert.deepEqual(merged.map((w) => w.text), ['for', 'You.', 'ask']);
  });

  test('no shared token falls back to the timestamp midpoint split', () => {
    // Total disagreement across the seam: keep left words before the seam and
    // right words at/after it, each once.
    const left = [W('aaa', 8.5), W('bbb', 9.4)];  // 8.5 < seam kept; 9.4 dropped
    const right = [W('ccc', 8.6), W('ddd', 9.3)]; // 8.6 dropped; 9.3 >= seam kept
    const merged = mergeOverlapWords(left, right, { seamSec, wordMid });
    assert.deepEqual(merged.map((w) => w.text), ['aaa', 'ddd']);
  });
});

describe('planChunks (silence-aware boundaries)', () => {
  test('with snapping off, reproduces the fixed-stride layout exactly', () => {
    // 290 samples, max 160, overlap 32 => stride 128. Matches the old
    // for(start+=stride) loop: [0,160], [128,288], [256,290].
    const plan = planChunks(290, { maxChunkSamples: 160, overlapSamples: 32 });
    assert.deepEqual(plan, [
      { start: 0, end: 160 },
      { start: 128, end: 288 },
      { start: 256, end: 290 },
    ]);
  });

  test('short audio is a single chunk', () => {
    assert.deepEqual(planChunks(100, { maxChunkSamples: 160, overlapSamples: 32 }), [{ start: 0, end: 100 }]);
  });

  test('chunks tile the whole buffer with the requested overlap', () => {
    const plan = planChunks(1000, { maxChunkSamples: 200, overlapSamples: 40 });
    assert.equal(plan[0].start, 0);
    assert.equal(plan[plan.length - 1].end, 1000, 'last chunk reaches the end');
    for (let i = 1; i < plan.length; i++) {
      assert.ok(plan[i].start < plan[i - 1].end, 'consecutive chunks overlap');
      assert.ok(plan[i].start > plan[i - 1].start, 'each chunk advances');
      assert.ok(plan[i].end - plan[i].start <= 200, 'no chunk exceeds the max length');
    }
  });

  test('snaps the interior boundary to the quietest point within the radius', () => {
    // energyAt: loud everywhere except a narrow dip at sample 180. The nominal
    // first boundary is 200; with a radius of 40 the window is [160,200] and the
    // quietest point 180 must be chosen, cutting the chunk short at 180.
    const energyAt = (i) => (i === 180 ? 0 : 1);
    const plan = planChunks(1000, {
      maxChunkSamples: 200,
      overlapSamples: 40,
      snapRadiusSamples: 40,
      snapStepSamples: 1,
      energyAt,
    });
    assert.equal(plan[0].end, 180, 'first seam snapped to the silent dip');
    assert.equal(plan[1].start, 140, 'next chunk starts overlapSamples before the snapped seam');
  });

  test('never snaps past the max length (searches backward only, respecting the ~25 s wall)', () => {
    // A dip AFTER the nominal end must be ignored: honoring it would make the
    // chunk longer than maxChunkSamples.
    const energyAt = (i) => (i === 230 ? 0 : 1); // 230 > nominal end 200
    const plan = planChunks(1000, {
      maxChunkSamples: 200,
      overlapSamples: 40,
      snapRadiusSamples: 40,
      snapStepSamples: 1,
      energyAt,
    });
    assert.ok(plan[0].end <= 200, 'first chunk never exceeds the max length');
  });

  test('a flat window (no strictly-quieter point) is NOT snapped, so the chunk is not needlessly shortened', () => {
    // Uniform energy everywhere (e.g. pure silence or steady tone): nothing beats
    // the nominal boundary, so it must stay put rather than collapse to the
    // window start. This is the all-zero-audio case that must not shrink chunks.
    const energyAt = () => 0;
    const plan = planChunks(1000, {
      maxChunkSamples: 200,
      overlapSamples: 40,
      snapRadiusSamples: 40,
      snapStepSamples: 1,
      energyAt,
    });
    assert.equal(plan[0].end, 200, 'flat window leaves the nominal boundary untouched');
  });

  test('the final boundary (== length) is never snapped', () => {
    // Even with a dip just before the end, the last chunk must still reach length.
    const energyAt = (i) => (i === 980 ? 0 : 1);
    const plan = planChunks(1000, {
      maxChunkSamples: 400,
      overlapSamples: 40,
      snapRadiusSamples: 40,
      snapStepSamples: 1,
      energyAt,
    });
    assert.equal(plan[plan.length - 1].end, 1000, 'coverage reaches the end regardless of a nearby dip');
  });
});
