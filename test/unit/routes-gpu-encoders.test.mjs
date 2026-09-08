// Tier-1 unit test for routeLocalMirrorWithoutGpuEncoders (test/e2e/routes.mjs),
// the helper that turns the local mirror into "a deployment with no GPU-runnable
// encoder" for gpu-quant-fallback.spec.js.
//
// This is worth a fast test because its failure mode is a spec that PASSES its
// setup and then tests nothing. The helper used to 404 the shard FILES only.
// Once the mirror started shipping model-manifest.json, hub.js stopped probing
// and read the manifest verbatim, so the shards were still announced, the fp32
// quant came back perfectly servable, and the fallback under test never had a
// reason to fire. The spec failed 90 seconds later on a symptom that said
// nothing about the route. Nothing in the e2e tier can catch that early, and a
// future discovery path would break it exactly the same way, so the invariant is
// pinned here: a file the helper hides must be hidden in BOTH the bytes and the
// listing.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeLocalMirrorWithoutGpuEncoders } from '../../test/e2e/routes.mjs';
import { MANIFEST_FILE } from '../../scripts/model-manifest.mjs';
import { resolveModelQuant } from '../../app/src/hub.js';

const ORIGIN = 'http://127.0.0.1:4178';

// A Playwright page/route pair thin enough to drive the handler directly. The
// handler is what the spec actually installs, so testing it is testing the real
// thing rather than a copy of its regex.
async function install() {
  let handler;
  await routeLocalMirrorWithoutGpuEncoders({ route: (_re, fn) => { handler = fn; } });
  return async (url, upstream) => {
    let outcome = null;
    await handler({
      request: () => ({ url: () => url }),
      fetch: async () => ({ ok: () => upstream !== undefined, json: async () => upstream }),
      fulfill: async (r) => { outcome = r; },
      continue: async () => { outcome = { continued: true }; },
    });
    return outcome;
  };
}

const MANIFEST = [
  'vocab.txt',
  'int8/encoder-model.int8.onnx',
  'int8/decoder_joint-model.int8.onnx',
  'fp32/encoder-model.onnx',
  'fp32/encoder-model.onnx.data.000',
  'fp32/encoder-model.onnx.data.001',
  'sharded/encoder-model.onnx.data.000',
];

describe('routeLocalMirrorWithoutGpuEncoders', () => {
  test('404s the shard bytes and passes everything else through', async () => {
    const call = await install();
    assert.equal((await call(`${ORIGIN}/models/repo/fp32/encoder-model.onnx.data.000`)).status, 404);
    assert.equal((await call(`${ORIGIN}/models/repo/sharded/encoder-model.onnx.data.000`)).status, 404);
    assert.deepEqual(await call(`${ORIGIN}/models/repo/int8/encoder-model.int8.onnx`), { continued: true });
    assert.deepEqual(await call(`${ORIGIN}/models/repo/vocab.txt`), { continued: true });
  });

  test('strips the same files from the mirror manifest, leaving the rest', async () => {
    const call = await install();
    const { json } = await call(`${ORIGIN}/models/repo/${MANIFEST_FILE}`, MANIFEST);
    assert.deepEqual(json, ['vocab.txt', 'int8/encoder-model.int8.onnx', 'int8/decoder_joint-model.int8.onnx']);
  });

  test('the filtered manifest reads as a source that cannot serve GPU fp32', async () => {
    // The assertion that actually matters, asked of the function that decides
    // it: resolveModelQuant over whatever listing hub.js ends up with is what
    // raises webgpuFp32NeedsShards, and that flag is the fallback's only
    // trigger. Checking the filter's output shape alone would not notice a
    // listing that still satisfies the shard set by some other spelling.
    const quant = (repoFiles) => resolveModelQuant({
      backend: 'webgpu-hybrid', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles, shaderF16: true,
    }).webgpuFp32NeedsShards;
    const call = await install();
    assert.equal(quant(MANIFEST), false, 'the unfiltered mirror does ship shards');
    const { json } = await call(`${ORIGIN}/models/repo/${MANIFEST_FILE}`, MANIFEST);
    assert.equal(quant(json), true);
  });

  test('a mirror with no manifest keeps 404ing it, rather than inventing one', async () => {
    // hub.js treats a non-listing response as "no manifest" and goes back to
    // probing, which the byte arm already handles. Fulfilling a fabricated empty
    // listing instead would hide the int8 files too and break the WASM retry.
    const call = await install();
    assert.equal((await call(`${ORIGIN}/models/repo/${MANIFEST_FILE}`)).status, 404);
    assert.equal((await call(`${ORIGIN}/models/repo/${MANIFEST_FILE}`, '<!doctype html>')).status, 404);
  });
});
