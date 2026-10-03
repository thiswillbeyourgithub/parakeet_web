// Tier-1 parity test for the Streaming Sortformer port (app/src/sortformer.js):
// the chunk loop + Arrival-Order Speaker Cache + FIFO + compression, with NO
// model. test/fixtures/sortformer-cache.json was produced by
// scripts/gen-sortformer-fixtures.py running transformers' own
// Nemotron3DiarizationSpeakerCache and offline loop over random embeds with a
// tiny cache (24 rows for 8 speakers, a FIFO of 6 and an update period of 17
// that binds, so compression runs at almost every one of the 10 chunks) and a
// fake closed-form step. chunkProbs driven by the same fake step must
// reproduce the reference probabilities: any slip in which frames the cache
// keeps changes the next step's input and shows up downstream as a large
// probability difference.
//
// Mutation-checked (each of these, introduced into the port, fails the test):
// latest-frames boost and its range, weak boost, silence slots, stored vs
// re-estimated cache probs, the update period. NOT caught, by construction:
// the min-positive filter (with one speaker per frame every speech frame
// scores > 0, and overlap would bring the unreproducible ties described below)
// and the strong-boost amount (the weak boost covers the same top frame). The
// real-model test (sortformer-model.test.mjs) is what covers real overlap.
//
// Also covers melFrames: slicing the mel front end must be exact.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chunkProbs, melFrames, numMelFrames } from '../../app/src/sortformer.js';
import { JsPreprocessor } from '../../app/src/mel.js';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/sortformer-cache.json', import.meta.url)), 'utf8'));
const f64 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float64Array(b.buffer, b.byteOffset, b.length / 8); };

// Same closed form as fake_step in the generator:
// x(8t+j, s) = 3 sin(0.7 (s+1) e[t, s mod H] + 0.02 j + s + 0.5 m[s]),
// m[s] = sum_r cos(r) e[r, (s+1) mod H]. The m term mixes every input row by
// position (cache rows included), which is what makes the cache observable: a
// row-local fake step would pass with any cache policy at all. Only each row's
// argmax speaker stays high (the others get -10), so no frame is ever active
// for two speakers: such a frame lands in the cache twice, its copies tie
// exactly at the next compression, and the reference breaks that tie with
// torch.topk(sorted=False), whose order is unspecified (see the generator).
function fakeStep(H) {
  return async (input, numRows) => {
    const m = new Float64Array(8);
    for (let r = 0; r < numRows; r++) for (let s = 0; s < 8; s++) m[s] += Math.cos(r) * input[r * H + ((s + 1) % H)];
    const out = new Float64Array(numRows * 8 * 8);
    for (let t = 0; t < numRows; t++) {
      for (let j = 0; j < 8; j++) {
        const x = new Float64Array(8);
        for (let s = 0; s < 8; s++) x[s] = 3 * Math.sin(0.7 * (s + 1) * input[t * H + (s % H)] + 0.02 * j + s + 0.5 * m[s]);
        const top = Math.max(...x);
        for (let s = 0; s < 8; s++) out[(t * 8 + j) * 8 + s] = x[s] === top ? x[s] : x[s] - 10;
      }
    }
    return out;
  };
}

describe('sortformer chunkProbs vs transformers SpeakerCache', () => {
  test('reproduces the reference probabilities through repeated compression', async () => {
    const { config, numEmbeds } = fixture;
    const embeds = f64(fixture.embeds);
    const silence = f64(fixture.silence);
    const ref = f64(fixture.probs);
    const numFrames = numEmbeds * config.subsampling_factor;
    const progress = [];
    const got = await chunkProbs(embeds, numEmbeds, numFrames, {
      config, silenceEmbeds: silence, runStep: fakeStep(config.hidden_size), onProgress: (p) => progress.push(p),
    });
    assert.equal(got.length, ref.length);
    let maxDiff = 0;
    for (let i = 0; i < ref.length; i++) maxDiff = Math.max(maxDiff, Math.abs(got[i] - ref[i]));
    // output is Float32, so ~6e-8 is the floor; a wrong cache row is O(0.1)
    assert.ok(maxDiff < 1e-6, `max |dp| ${maxDiff}`);
    const chunks = Math.ceil(numEmbeds / config.offline.chunk_length);
    assert.deepEqual(progress.at(-1), { done: chunks, total: chunks });
  });

  test('truncates to numFrames when the last embed is feature-stacking padding', async () => {
    const { config, numEmbeds } = fixture;
    const numFrames = numEmbeds * config.subsampling_factor - 5;
    const got = await chunkProbs(f64(fixture.embeds), numEmbeds, numFrames, {
      config, silenceEmbeds: f64(fixture.silence), runStep: fakeStep(config.hidden_size),
    });
    const ref = f64(fixture.probs);
    assert.equal(got.length, numFrames * 8);
    for (let i = 0; i < got.length; i++) assert.ok(Math.abs(got[i] - ref[i]) < 1e-6);
  });
});

describe('sortformer melFrames', () => {
  test('slices equal one whole-clip pass, frames past floor(N/160) zeroed', () => {
    const n = 16000 * 3 + 77;
    const pcm = new Float32Array(n);
    let seed = 7;
    for (let i = 0; i < n; i++) { seed = (1664525 * seed + 1013904223) >>> 0; pcm[i] = (seed / 0xffffffff - 0.5) * 0.4; }
    const pre = new JsPreprocessor({ nMels: 128 });
    const total = numMelFrames(n);
    const whole = melFrames(pre, pcm, 0, total);
    assert.equal(whole.length, total * 128);
    // the reference zeroes the frame the centered STFT adds past the last hop
    assert.ok(whole.subarray((total - 1) * 128).every((v) => v === 0));
    for (const [a, b] of [[0, 1], [0, 100], [37, 140], [150, total], [total - 3, total]]) {
      const part = melFrames(pre, pcm, a, b);
      const expect = whole.subarray(a * 128, b * 128);
      let maxDiff = 0;
      for (let i = 0; i < part.length; i++) maxDiff = Math.max(maxDiff, Math.abs(part[i] - expect[i]));
      assert.ok(maxDiff < 1e-4, `[${a}, ${b}) max diff ${maxDiff}`);
    }
  });
});
