// Tier-1 gate for ParakeetModel.encodeBatch() (app/src/parakeet.js): the batched
// encoder MUST produce, for each item, the same encoder output as a standalone
// encode() of that chunk. This is the safety gate the GPU-batching plan hinges
// on: if the `length` input does not perfectly mask the zero-padding a batch of
// unequal-length chunks needs, batching is unsafe and must not be wired into the
// transcription pipeline.
//
// Unlike the pure-JS stitching tests, this needs a REAL encoder session, so it
// loads the int8 model through the shared scripts/transcribe.mjs loader (native
// onnxruntime-web WASM build, the same engine the browser/e2e use). It
// self-skips when the local model dir is absent (the loader throws on missing
// files), exactly like the fp32-wasm e2e, so it never fails CI on a machine
// without the weights. Run locally with the fallback_models present (or point
// PARAKEET_E2E_MODEL_DIR at a model dir).
//
// Built with Claude Code.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const SR = 16000;

// Prefer an explicit override, else the repo's committed fallback_models mirror
// (same source the tier-3 e2e uses), so a checkout with the weights present runs
// this without any env setup.
const here = dirname(fileURLToPath(import.meta.url));
const FALLBACK_DIR = resolve(here, '../../fallback_models/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx');
function resolveTestModelDir() {
  if (process.env.PARAKEET_E2E_MODEL_DIR) return process.env.PARAKEET_E2E_MODEL_DIR;
  if (existsSync(FALLBACK_DIR)) return FALLBACK_DIR;
  return null; // loader will resolve the HF cache, throwing if absent -> skip
}

// Deterministic band-limited-ish noise so the encoder sees real, non-trivial
// input (silence collapses to a degenerate output that would mask a padding
// bug). A tiny LCG keeps it reproducible without Math.random.
function makePcm(nSamples, seed) {
  const a = new Float32Array(nSamples);
  let s = seed >>> 0;
  let prev = 0;
  for (let i = 0; i < nSamples; i++) {
    s = (1664525 * s + 1013904223) >>> 0;
    const white = (s / 0xffffffff) * 2 - 1;
    // one-pole smoothing to avoid pure white noise, scaled to a modest level
    prev = 0.85 * prev + 0.15 * white;
    a[i] = prev * 0.3;
  }
  return a;
}

// Max absolute element-wise difference between two equal-length Float32Arrays.
function maxAbsDiff(x, y) {
  assert.equal(x.length, y.length, `length mismatch ${x.length} vs ${y.length}`);
  let m = 0;
  for (let i = 0; i < x.length; i++) {
    const d = Math.abs(x[i] - y[i]);
    if (d > m) m = d;
  }
  return m;
}

let model = null;
let skipReason = null;

before(async () => {
  try {
    const { loadParakeetModel } = await import('../../scripts/transcribe.mjs');
    ({ model } = await loadParakeetModel({ quant: 'int8', ortBackend: 'wasm', modelDir: resolveTestModelDir() }));
  } catch (e) {
    skipReason = `model unavailable (${e?.message ?? e}); run with fallback_models present`;
  }
});

describe('encodeBatch numeric equivalence', () => {
  // transcribeChunked only ever batches chunks of the SAME feature length (the
  // fixed-duration chunks planChunks emits; the shorter final remainder encodes
  // alone). So the gate is: an equal-length batch must reproduce standalone
  // encode() EXACTLY. Two same-length, different-content chunks exercise it.
  const chunkA = makePcm(Math.round(4.3 * SR), 12345);
  const chunkB = makePcm(Math.round(4.3 * SR), 67890); // same length, different noise
  // A deliberately shorter chunk to prove the equal-length guard actually fires.
  const shorterPcm = makePcm(Math.round(1.7 * SR), 555);

  test('equal-length batch is byte-identical to standalone encode() per item', async (t) => {
    if (skipReason) return t.skip(skipReason);

    const [aSolo, bSolo] = await Promise.all([
      model.encode(chunkA, SR),
      model.encode(chunkB, SR),
    ]);
    const [aBatch, bBatch] = await model.encodeBatch([chunkA, chunkB], SR);

    assert.equal(aBatch.Tenc, aSolo.Tenc, 'item A Tenc');
    assert.equal(bBatch.Tenc, bSolo.Tenc, 'item B Tenc');
    assert.equal(aBatch.D, aSolo.D, 'item A D');
    // Byte-identical: equal-length batching introduces no padding and, on this
    // encoder, not even fp-reorder noise (ablation measured maxAbsDiff 0).
    assert.equal(maxAbsDiff(aBatch.transposed, aSolo.transposed), 0, 'item A must be exact');
    assert.equal(maxAbsDiff(bBatch.transposed, bSolo.transposed), 0, 'item B must be exact');
  });

  test('encodeBatch([c]) is byte-identical to encode(c) (N=1 delegates)', async (t) => {
    if (skipReason) return t.skip(skipReason);

    const solo = await model.encode(chunkA, SR);
    const [batch] = await model.encodeBatch([chunkA], SR);
    assert.equal(batch.Tenc, solo.Tenc);
    assert.equal(batch.D, solo.D);
    assert.equal(maxAbsDiff(batch.transposed, solo.transposed), 0, 'N=1 must be exact');
  });

  test('order independence: swapping equal-length items is exact per chunk', async (t) => {
    if (skipReason) return t.skip(skipReason);

    const [aAB, bAB] = await model.encodeBatch([chunkA, chunkB], SR);
    const [bBA, aBA] = await model.encodeBatch([chunkB, chunkA], SR);
    assert.equal(maxAbsDiff(aAB.transposed, aBA.transposed), 0, 'A position-invariant');
    assert.equal(maxAbsDiff(bAB.transposed, bBA.transposed), 0, 'B position-invariant');
  });

  test('mixed-length batch throws (padding would leak, so it is forbidden)', async (t) => {
    if (skipReason) return t.skip(skipReason);

    await assert.rejects(
      () => model.encodeBatch([chunkA, shorterPcm], SR),
      /equal-length/,
      'encodeBatch must reject unequal-length chunks',
    );
  });
});
