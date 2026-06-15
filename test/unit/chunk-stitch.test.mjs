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
import { ParakeetModel } from '../../app/src/parakeet.js';

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
const CHUNK_OPTS = { enableChunking: true, chunkDurationSec: 10, overlapSec: 2, returnTimestamps: true };
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

  test('seam assigns by word midpoint: before-seam word kept from earlier chunk, at/after from later', async () => {
    const model = makeModel();
    const res = await model.transcribeChunked(AUDIO, SR, CHUNK_OPTS);
    const echo = res.words.find((w) => w.text === 'echo');
    const charlie = res.words.find((w) => w.text === 'charlie');
    // "echo" midpoint 8.3 < seam 9.0 => kept from chunk 1 (its absolute time, unshifted).
    assert.ok(Math.abs(echo.start_time - 8.2) < 1e-6 && Math.abs(echo.end_time - 8.4) < 1e-6);
    // "charlie" midpoint 9.0 == seam => kept from chunk 2; absolute time still 8.5..9.5.
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
