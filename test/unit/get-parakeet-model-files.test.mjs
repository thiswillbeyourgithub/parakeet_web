// Tier-1 unit test for the file-SELECTION layer of getParakeetModel
// (app/src/hub.js): the step that turns a resolved quant into the concrete set
// of files to download. resolveModelQuant (tested in resolve-quant.test.mjs)
// only decides the *quant*; this code then maps that to filenames via
// QUANT_SUFFIX, decides between a single <model>.onnx.data sidecar and the
// sharded fp32 layout (encoder-model.onnx.data.NNN), and includes the
// preprocessor ONNX only on the non-JS backend. That seam was previously
// exercised end-to-end only by transcription-fp32-wasm.spec.js, which needs the
// local shards and SKIPS in CI; this guards it in the fast tier instead.
//
// We mock globalThis.fetch (HF tree listing + file bodies) and
// URL.createObjectURL (absent in Node) so the whole HF download path runs
// headless. Node has no IndexedDB, so the cache branches are inert and every
// file is "downloaded" from the mock. We assert on the returned `filenames`,
// `quantisation`, and which `urls.*` keys get populated (the file list), not on
// byte content (that is stream-to-memory.test.mjs).
//
// Built with Claude Code.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getParakeetModel } from '../../app/src/hub.js';

// A streaming body so _streamAndCache's reader loop runs; content is irrelevant
// here (we assert on which files were selected, not their bytes).
function bodyResponse(bytes = new Uint8Array([1, 2, 3])) {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.length), 'content-type': 'application/octet-stream' },
  });
}

// Build a fetch mock that lists `repoFiles` for the HF tree API and serves a
// small body for any resolve/download URL. Records which file basenames were
// actually requested for download so a test can assert the selected set.
function mockHf(repoFiles) {
  const downloaded = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/models/') && u.includes('/tree/')) {
      const arr = repoFiles.map((path) => ({ type: 'file', path }));
      return new Response(JSON.stringify(arr), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (opts.method === 'HEAD') return new Response(null, { status: 200 });
    // A resolve URL: record the trailing path segment as the downloaded file.
    downloaded.push(decodeURIComponent(u.split('/').pop().split('?')[0]));
    return bodyResponse();
  };
  return downloaded;
}

let originalFetch;
let originalCreateObjectURL;
let blobCounter;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  // Node has no URL.createObjectURL; stub it so the blob-URL files (vocab +
  // external-data sidecars) resolve to a sentinel string instead of throwing.
  originalCreateObjectURL = URL.createObjectURL;
  blobCounter = 0;
  URL.createObjectURL = () => `blob:mock/${blobCounter++}`;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
});

// Repo fixtures mirroring the real repos resolveModelQuant must cope with.
const REPO_FP16 = [
  'encoder-model.fp16.onnx', 'decoder_joint-model.fp16.onnx',
  'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
  'encoder-model.onnx', 'encoder-model.onnx.data', 'vocab.txt', 'nemo128.onnx',
];
// Upstream-istupakov-style: fp32 single sidecar + int8, no fp16.
const REPO_NO_FP16 = [
  'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
  'encoder-model.onnx', 'encoder-model.onnx.data', 'vocab.txt', 'nemo128.onnx',
];
// Sharded fp32 (scripts/shard-fp32.py): no single sidecar, two shards instead.
const REPO_FP32_SHARDS = [
  'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
  'encoder-model.onnx', 'encoder-model.onnx.data.000', 'encoder-model.onnx.data.001',
  'vocab.txt', 'nemo128.onnx',
];

describe('getParakeetModel file selection: WASM', () => {
  test('int8 request -> int8 encoder/decoder, no external sidecar, no preprocessor (JS default)', async () => {
    const downloaded = mockHf(REPO_NO_FP16);
    const r = await getParakeetModel('test/wasm-int8', {
      backend: 'wasm', encoderQuant: 'int8', decoderQuant: 'int8',
    });
    assert.deepEqual(r.filenames, { encoder: 'encoder-model.int8.onnx', decoder: 'decoder_joint-model.int8.onnx' });
    assert.deepEqual(r.quantisation, { encoder: 'int8', decoder: 'int8' });
    // int8 encoder is self-contained: no .data sidecar should be selected.
    assert.equal(r.urls.encoderDataUrl ?? null, null);
    assert.equal(r.urls.decoderDataUrl ?? null, null);
    assert.equal(r.urls.preprocessorUrl, undefined, 'JS preprocessor must not download the ONNX');
    assert.ok(downloaded.includes('encoder-model.int8.onnx'));
    assert.ok(downloaded.includes('vocab.txt'));
    assert.ok(!downloaded.includes('encoder-model.onnx.data'), 'must not fetch the fp32 sidecar on the int8 pin');
  });

  test('fp32 request honoured only with allowWasmFp32 + shards: shards mounted as array, single sidecar NOT added', async () => {
    const downloaded = mockHf(REPO_FP32_SHARDS);
    const r = await getParakeetModel('test/wasm-fp32-shards', {
      backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', allowWasmFp32: true,
    });
    assert.equal(r.filenames.encoder, 'encoder-model.onnx');
    assert.equal(r.quantisation.encoder, 'fp32');
    assert.equal(r.quantisation.decoder, 'int8');
    // The sharded layout must be handed to parakeet.js as an array of {path,data}.
    assert.ok(Array.isArray(r.urls.encoderDataUrl), 'sharded fp32 must mount as an array');
    assert.deepEqual(r.urls.encoderDataUrl.map((e) => e.path), ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001']);
    assert.ok(downloaded.includes('encoder-model.onnx.data.000') && downloaded.includes('encoder-model.onnx.data.001'));
    assert.ok(!downloaded.includes('encoder-model.onnx.data'), 'shards win: the single sidecar must not also be fetched');
  });

  test('fp32 request without the opt-in stays pinned to int8 (no shards fetched)', async () => {
    const downloaded = mockHf(REPO_FP32_SHARDS);
    const r = await getParakeetModel('test/wasm-fp32-noflag', {
      backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', // allowWasmFp32 omitted
    });
    assert.equal(r.filenames.encoder, 'encoder-model.int8.onnx');
    assert.equal(r.quantisation.encoder, 'int8');
    assert.ok(!downloaded.some((f) => f.startsWith('encoder-model.onnx.data')), 'no fp32 shard should be fetched without the opt-in');
  });
});

describe('getParakeetModel file selection: WebGPU', () => {
  test('fp16 request + fp16 in repo -> fp16 encoder/decoder, no sidecar', async () => {
    const downloaded = mockHf(REPO_FP16);
    const r = await getParakeetModel('test/webgpu-fp16', {
      backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16',
    });
    assert.deepEqual(r.filenames, { encoder: 'encoder-model.fp16.onnx', decoder: 'decoder_joint-model.fp16.onnx' });
    assert.deepEqual(r.quantisation, { encoder: 'fp16', decoder: 'fp16' });
    // The fp16 encoder is a single self-contained file: encoder-model.fp16.onnx.data
    // is not in the repo, so no sidecar should be selected.
    assert.equal(r.urls.encoderDataUrl ?? null, null);
    // WebGPU hands the big weights to ORT as bytes, not a blob URL.
    assert.ok(r.urls.encoderUrl instanceof Uint8Array, 'WebGPU encoder must load as bytes');
    assert.ok(downloaded.includes('encoder-model.fp16.onnx'));
  });

  test('fp16 request but no fp16 in repo -> fp32 encoder + its .data sidecar, decoder falls to int8', async () => {
    const downloaded = mockHf(REPO_NO_FP16);
    const r = await getParakeetModel('test/webgpu-fp32-fallback', {
      backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16',
    });
    assert.equal(r.filenames.encoder, 'encoder-model.onnx');
    assert.equal(r.filenames.decoder, 'decoder_joint-model.int8.onnx');
    assert.deepEqual(r.quantisation, { encoder: 'fp32', decoder: 'int8' });
    // The single-file fp32 encoder DOES carry an external-data sidecar here.
    assert.ok(r.urls.encoderDataUrl, 'fp32 single-file encoder must select its .data sidecar');
    assert.ok(!Array.isArray(r.urls.encoderDataUrl), 'single sidecar is a URL, not a shard array');
    assert.ok(downloaded.includes('encoder-model.onnx.data'));
  });
});

describe('getParakeetModel file selection: preprocessor backend', () => {
  test('preprocessorBackend "onnx" selects the preprocessor ONNX named for the model', async () => {
    const downloaded = mockHf(REPO_NO_FP16);
    const r = await getParakeetModel('test/onnx-preproc', {
      backend: 'wasm', encoderQuant: 'int8', decoderQuant: 'int8',
      preprocessorBackend: 'onnx', preprocessor: 'nemo128',
    });
    assert.equal(r.preprocessorBackend, 'onnx');
    assert.ok(r.urls.preprocessorUrl, 'onnx preprocessor backend must select the preprocessor file');
    assert.ok(downloaded.includes('nemo128.onnx'));
  });
});
