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
// The second invariant landed the same way, one behaviour change later. Hiding
// fp32 alone used to mean "cannot serve WebGPU" because fp32 was the only GPU
// precision the app would reach for. It stopped meaning that the moment the app
// offered more than one: whichever precision a future App.jsx reaches for, a
// mirror still serving it is not the deployment this helper claims to build, so
// the fallback spec would go on passing over an evaporated premise. The
// whitelist is therefore asked of the same module the app asks
// (lib/encoderQuants.js) rather than restated here, and every precision in it
// has to come back unservable through the filtered listing.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeLocalMirrorWithoutGpuEncoders } from '../../test/e2e/routes.mjs';
import { MANIFEST_FILE } from '../../scripts/model-manifest.mjs';
import { quantSatisfiable, resolveModelQuant } from '../../app/src/hub.js';
import { WEBGPU_ENCODER_QUANTS } from '../../app/ui/src/lib/encoderQuants.js';

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

// A mirror that is generous on purpose: it ships every GPU-runnable precision,
// in both fp32 shard layouts, so the helper has something to hide for each of
// them and "nothing left for the GPU" is a claim it has to earn.
const MANIFEST = [
  'vocab.txt',
  'int8/encoder-model.int8.onnx',
  'int8/decoder_joint-model.int8.onnx',
  'fp32/encoder-model.onnx',
  'fp32/encoder-model.onnx.data.000',
  'fp32/encoder-model.onnx.data.001',
  'sharded/encoder-model.onnx.data.000',
  'w4a8/encoder-model.w4a8.onnx',
  'fp16/encoder-model.fp16.onnx',
];

describe('routeLocalMirrorWithoutGpuEncoders', () => {
  test('404s every GPU encoder byte and passes everything else through', async () => {
    const call = await install();
    for (const path of [
      'fp32/encoder-model.onnx',
      'fp32/encoder-model.onnx.data.000',
      'sharded/encoder-model.onnx.data.000',
      'w4a8/encoder-model.w4a8.onnx',
      'fp16/encoder-model.fp16.onnx',
    ]) {
      assert.equal((await call(`${ORIGIN}/models/repo/${path}`)).status, 404, path);
    }
    assert.deepEqual(await call(`${ORIGIN}/models/repo/int8/encoder-model.int8.onnx`), { continued: true });
    assert.deepEqual(await call(`${ORIGIN}/models/repo/vocab.txt`), { continued: true });
  });

  test('strips the same files from the mirror manifest, leaving the rest', async () => {
    const call = await install();
    const { json } = await call(`${ORIGIN}/models/repo/${MANIFEST_FILE}`, MANIFEST);
    assert.deepEqual(json, ['vocab.txt', 'int8/encoder-model.int8.onnx', 'int8/decoder_joint-model.int8.onnx']);
  });

  test('the filtered manifest serves NO GPU precision, not merely no fp32', async () => {
    // The invariant the helper's name claims, asked of the same predicate the
    // app uses to grey a radio out or to pick a substitute. Asserting only
    // "fp32 is gone" would pass against a mirror still handing the GPU w4a8,
    // and the spec that installs this helper would then prove nothing about
    // the GPU-to-WASM fallback.
    const call = await install();
    const { json } = await call(`${ORIGIN}/models/repo/${MANIFEST_FILE}`, MANIFEST);
    for (const encoderQuant of WEBGPU_ENCODER_QUANTS) {
      assert.equal(
        quantSatisfiable({
          backend: 'webgpu-hybrid', encoderQuant, decoderQuant: 'int8', repoFiles: MANIFEST, shaderF16: true,
        }),
        true,
        `${encoderQuant}: the unfiltered mirror was supposed to serve it`,
      );
      assert.equal(
        quantSatisfiable({
          backend: 'webgpu-hybrid', encoderQuant, decoderQuant: 'int8', repoFiles: json, shaderF16: true,
        }),
        false,
        `${encoderQuant}: still servable after filtering, so the mirror can still feed the GPU`,
      );
    }
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
