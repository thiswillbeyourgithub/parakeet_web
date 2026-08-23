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
import { getParakeetModel, QuantUnavailableError } from '../../app/src/hub.js';

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
// Upstream-istupakov-style: the flat fp32 single sidecar + int8, no shards.
const REPO_FLAT = [
  'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
  'encoder-model.onnx', 'encoder-model.onnx.data', 'vocab.txt', 'nemo128.onnx',
];
// Sharded fp32 (parakeet-tdt-0.6b-v3-optimized-onnx/scripts/shard-fp32.py): no single sidecar, two shards instead.
const REPO_FP32_SHARDS = [
  'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
  'encoder-model.onnx', 'encoder-model.onnx.data.000', 'encoder-model.onnx.data.001',
  'vocab.txt', 'nemo128.onnx',
];
// How the model repo (parakeet-tdt-0.6b-v3-optimized-onnx) ACTUALLY ships on
// HuggingFace: the flat single-file fp32 encoder at the root (WebGPU) PLUS the
// <2GB shards under a `sharded/` subfolder (WASM), which the HF tree API lists
// with that prefix. The old flat-only shard regex missed these, so WASM fp32
// wrongly threw "not serving fp32" while WebGPU (flat single-file) worked.
const REPO_HF_SHARDED = [
  'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
  'encoder-model.onnx', 'encoder-model.onnx.data',
  'sharded/encoder-model.onnx', 'sharded/encoder-model.onnx.data.000', 'sharded/encoder-model.onnx.data.001',
  'vocab.txt', 'nemo128.onnx',
];

// Path-aware HF mock: unlike mockHf (which records only the trailing segment),
// this records the FULL repo-relative path after /resolve/<rev>/ so a test can
// tell `sharded/encoder-model.onnx` apart from the flat `encoder-model.onnx`.
// Shared by the sharded-fp32 and canonical-names describes.
function mockHfPaths(repoFiles) {
  const present = new Set(repoFiles);
  const downloaded = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/api/models/') && u.includes('/tree/')) {
      const arr = repoFiles.map((path) => ({ type: 'file', path }));
      return new Response(JSON.stringify(arr), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const m = u.match(/\/resolve\/[^/]+\/(.+?)(?:\?|$)/);
    const rel = m ? m[1].split('/').map(decodeURIComponent).join('/') : u;
    if (opts.method === 'HEAD') return new Response(null, { status: present.has(rel) ? 200 : 404 });
    if (!present.has(rel)) return new Response('not found', { status: 404 });
    downloaded.push(rel);
    return bodyResponse();
  };
  return downloaded;
}

describe('getParakeetModel file selection: WASM', () => {
  test('int8 request -> int8 encoder/decoder, no external sidecar, no preprocessor (JS default)', async () => {
    const downloaded = mockHf(REPO_FLAT);
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

  test('fp32 request without the opt-in throws rather than silently pinning to int8', async () => {
    // Even with the shards in the repo, omitting allowWasmFp32 means fp32 is not
    // satisfiable on WASM. Rather than silently swap in int8 (which made it
    // impossible to tell which precision actually loaded), getParakeetModel now
    // throws QuantUnavailableError, and nothing is downloaded.
    const downloaded = mockHf(REPO_FP32_SHARDS);
    await assert.rejects(
      getParakeetModel('test/wasm-fp32-noflag', {
        backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', // allowWasmFp32 omitted
      }),
      (err) => err instanceof QuantUnavailableError && err.requested.encoder === 'fp32',
    );
    assert.ok(!downloaded.some((f) => f.startsWith('encoder-model.onnx.data')), 'no fp32 shard should be fetched when the request is rejected');
  });
});

describe('getParakeetModel: sharded fp32 from a local mirror with a sharded/ subfolder', () => {
  // scripts/shard-fp32.py's default output is a `sharded/` subfolder. A real Caddy mirror
  // serves it at /models/sharded/... (the e2e serve.mjs fakes a flat rewrite that
  // production does NOT have). So the encoder graph + shards must be fetched from
  // sharded/ while vocab + the int8 decoder (which scripts/shard-fp32.py does not copy
  // into sharded/) stay at the flat root.
  let originalFetch2;
  beforeEach(() => { originalFetch2 = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch2; });

  // Path-aware local mirror: vocab + int8 decoder + the single fp32 sidecar live
  // flat; the rewritten encoder graph + shards live ONLY under sharded/.
  function mockLocalMirror() {
    const present = new Set([
      'vocab.txt',
      'decoder_joint-model.int8.onnx',
      'encoder-model.onnx',          // root: the single-sidecar 2.4 GB graph (WASM can't load)
      'encoder-model.onnx.data',     // root: its sidecar
      'sharded/encoder-model.onnx',  // rewritten graph pointing at the shards
      'sharded/encoder-model.onnx.data.000',
      'sharded/encoder-model.onnx.data.001',
    ]);
    const downloaded = [];
    globalThis.fetch = async (url, opts = {}) => {
      const rel = String(url).slice('/models/'.length).split('?')[0];
      if (opts.method === 'HEAD') return new Response(null, { status: present.has(rel) ? 200 : 404 });
      if (!present.has(rel)) return new Response('not found', { status: 404 });
      downloaded.push(rel);
      return bodyResponse();
    };
    return downloaded;
  }

  test('fetches the encoder graph + shards from sharded/, vocab + decoder from root', async () => {
    const downloaded = mockLocalMirror();
    const r = await getParakeetModel('test/local-sharded', {
      backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8',
      allowWasmFp32: true, localFallbackBaseUrl: '/models',
    });
    // The returned filename stays the bare basename the graph references.
    assert.equal(r.filenames.encoder, 'encoder-model.onnx');
    assert.equal(r.quantisation.encoder, 'fp32');
    assert.deepEqual(r.urls.encoderDataUrl.map((e) => e.path), ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001']);
    // Encoder graph + shards came from sharded/ (the rewritten graph), NOT the
    // flat single-sidecar graph at the root.
    assert.ok(downloaded.includes('sharded/encoder-model.onnx'), 'must fetch the rewritten encoder graph from sharded/');
    assert.ok(!downloaded.includes('encoder-model.onnx'), 'must NOT fetch the flat single-sidecar graph');
    assert.ok(downloaded.includes('sharded/encoder-model.onnx.data.000') && downloaded.includes('sharded/encoder-model.onnx.data.001'));
    // vocab + int8 decoder stay flat at the root.
    assert.ok(downloaded.includes('vocab.txt') && downloaded.includes('decoder_joint-model.int8.onnx'));
    assert.ok(!downloaded.includes('encoder-model.onnx.data'), 'the flat 2.4 GB sidecar must never be fetched');
  });
});

describe('getParakeetModel: sharded fp32 straight from HuggingFace (shards under sharded/)', () => {
  // Regression for "the instance is not serving the fp32 on WASM but WebGPU works":
  // the HF repo ships the shards under sharded/, which the tree API lists with the
  // prefix. BOTH backends must fetch the rewritten graph + shards from sharded/
  // when they exist: WASM cannot load the flat >2 GB single-file (32-bit
  // ArrayBuffer cap), and WebGPU cannot either (the 2.3 GB flat sidecar is cached
  // to IndexedDB and its readback throws "Failed to fetch" past Chromium's ~2 GB
  // Blob wall; verified headed + headless on an RTX 3090 Ti). The shard loop
  // streams each <2 GB shard straight to memory, clearing the wall on both.
  let originalFetch2;
  beforeEach(() => { originalFetch2 = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch2; });

  test('WASM fp32: fetches the rewritten graph + shards from sharded/, never the flat single-file', async () => {
    const downloaded = mockHfPaths(REPO_HF_SHARDED);
    const r = await getParakeetModel('test/hf-sharded-wasm', {
      backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', allowWasmFp32: true,
    });
    assert.equal(r.quantisation.encoder, 'fp32');
    assert.equal(r.filenames.encoder, 'encoder-model.onnx', 'filename stays the bare basename the graph references');
    assert.deepEqual(r.urls.encoderDataUrl.map((e) => e.path), ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001']);
    assert.ok(downloaded.includes('sharded/encoder-model.onnx'), 'must fetch the rewritten graph from sharded/');
    assert.ok(downloaded.includes('sharded/encoder-model.onnx.data.000') && downloaded.includes('sharded/encoder-model.onnx.data.001'));
    assert.ok(!downloaded.includes('encoder-model.onnx'), 'must NOT fetch the flat single-file graph on WASM');
    assert.ok(!downloaded.includes('encoder-model.onnx.data'), 'must NOT fetch the flat 2.4GB sidecar on WASM');
    // vocab + the int8 decoder stay at the flat root (sharded/ carries neither).
    assert.ok(downloaded.includes('vocab.txt') && downloaded.includes('decoder_joint-model.int8.onnx'));
  });

  test('WebGPU fp32: fetches the rewritten graph + shards from sharded/, never the flat single-file', async () => {
    const downloaded = mockHfPaths(REPO_HF_SHARDED);
    const r = await getParakeetModel('test/hf-sharded-webgpu', {
      backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8',
    });
    assert.equal(r.quantisation.encoder, 'fp32');
    // WebGPU used to load the flat single-file here; that path is broken (the
    // 2.3 GB sidecar dies on IndexedDB readback past Chromium's ~2 GB Blob wall),
    // so with shards present WebGPU now mounts them exactly like WASM.
    assert.ok(Array.isArray(r.urls.encoderDataUrl), 'WebGPU with shards present must mount the shard array');
    assert.deepEqual(r.urls.encoderDataUrl.map((e) => e.path), ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001']);
    assert.ok(downloaded.includes('sharded/encoder-model.onnx'), 'must fetch the rewritten graph from sharded/');
    assert.ok(downloaded.includes('sharded/encoder-model.onnx.data.000') && downloaded.includes('sharded/encoder-model.onnx.data.001'));
    assert.ok(!downloaded.includes('encoder-model.onnx.data'), 'must NOT fetch the flat 2.4GB sidecar on WebGPU');
    // WebGPU still hands the big weights to ORT as bytes (the graph fetched from sharded/).
    assert.ok(r.urls.encoderUrl instanceof Uint8Array, 'WebGPU encoder graph must load as bytes');
  });
});

describe('getParakeetModel file selection: WebGPU', () => {
  test('int8 request, no shards -> throws QuantUnavailableError (single-file fp32 is unloadable on WebGPU)', async () => {
    mockHf(REPO_FLAT);
    // int8 has no GPU encoder kernel so it resolves to fp32, but the repo ships
    // only the flat 2.3 GB sidecar and no shards. Single-file fp32 cannot load on
    // WebGPU (exceeds the browser's ~2 GB ArrayBuffer/Blob limits), so rather than
    // attempt a load that dies deep in ORT, getParakeetModel refuses cleanly.
    // This is the common case: int8 is the app's default, so a visitor the perf
    // probe moves onto WebGPU never asked for fp32 at all.
    await assert.rejects(
      getParakeetModel('test/webgpu-int8-no-shards', {
        backend: 'webgpu', encoderQuant: 'int8', decoderQuant: 'int8',
      }),
      (e) => e instanceof QuantUnavailableError && /shards|2 GB|ArrayBuffer/i.test(e.message),
    );
  });

  test('explicit fp32 request, no shards -> throws QuantUnavailableError', async () => {
    mockHf(REPO_FLAT);
    await assert.rejects(
      getParakeetModel('test/webgpu-fp32-explicit', {
        backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8',
      }),
      (e) => e instanceof QuantUnavailableError,
    );
  });
});

describe('getParakeetModel: cacheInfo for corrupt-cache eviction', () => {
  // cacheInfo lists the cached weight files evictModelFiles drops + re-downloads
  // when one fails to deserialize. It must name exactly the deserialized ONNX
  // blobs (+ their .data sidecars), never vocab/preprocessor, and carry the
  // repoId/revision/subfolder needed to rebuild the IndexedDB keys.
  test('int8 WASM: encoder + decoder only (no sidecar, no vocab)', async () => {
    mockHf(REPO_FLAT);
    const r = await getParakeetModel('test/wasm-int8', {
      backend: 'wasm', encoderQuant: 'int8', decoderQuant: 'int8',
    });
    assert.deepEqual(r.cacheInfo.filenames, ['encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx']);
    assert.equal(r.cacheInfo.repoId, 'test/wasm-int8');
    assert.equal(r.cacheInfo.revision, 'main');
    assert.equal(r.cacheInfo.subfolder, '');
    assert.ok(!r.cacheInfo.filenames.includes('vocab.txt'), 'vocab is not a deserialized weight');
  });

  test('sharded fp32 on WebGPU: graph is evictable, noCache shards are not', async () => {
    mockHf(REPO_HF_SHARDED);
    // WebGPU fp32 loads via the shards (single-file is unloadable). The small
    // rewritten graph is cached as bytes and stays evictable; the noCache shards
    // never touch IndexedDB, so like the WASM case they must NOT be listed.
    const r = await getParakeetModel('test/webgpu-fp32-shards', {
      backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8',
    });
    // REPO_HF_SHARDED ships the shards under sharded/, so the graph is fetched
    // (and cached) as sharded/encoder-model.onnx.
    assert.ok(r.cacheInfo.filenames.includes('sharded/encoder-model.onnx'));
    assert.ok(!r.cacheInfo.filenames.some((f) => f.includes('encoder-model.onnx.data')),
      'noCache shards are never in IndexedDB, so must not be in cacheInfo');
  });

  test('sharded fp32 (noCache): shards are NOT listed (never cached)', async () => {
    mockHf(REPO_FP32_SHARDS);
    const r = await getParakeetModel('test/wasm-fp32-shards', {
      backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', allowWasmFp32: true,
    });
    assert.ok(r.cacheInfo.filenames.includes('encoder-model.onnx'));
    assert.ok(!r.cacheInfo.filenames.some((f) => f.startsWith('encoder-model.onnx.data')),
      'noCache shards are never in IndexedDB, so must not be in cacheInfo');
  });
});

describe('getParakeetModel file selection: preprocessor backend', () => {
  test('preprocessorBackend "onnx" selects the preprocessor ONNX named for the model', async () => {
    const downloaded = mockHf(REPO_FLAT);
    const r = await getParakeetModel('test/onnx-preproc', {
      backend: 'wasm', encoderQuant: 'int8', decoderQuant: 'int8',
      preprocessorBackend: 'onnx', preprocessor: 'nemo128',
    });
    assert.equal(r.preprocessorBackend, 'onnx');
    assert.ok(r.urls.preprocessorUrl, 'onnx preprocessor backend must select the preprocessor file');
    assert.ok(downloaded.includes('nemo128.onnx'));
  });
});

// One build per quant, under the canonical istupakov names. The graph work the
// model repo does (optimize-encoder-graph.py fold on the encoders,
// optimize-decoder-graph.py lse + topk on the decoders) lands IN those files, so
// there is no name to prefer and no listing to consult. This describe pins that
// there is no longer any filename-based selection: whatever else a source
// serves, the loader asks for the canonical names and nothing else.
//
// The decoder fast paths are detected at runtime instead, from the loaded
// session's outputNames (parakeet.js _topkOutputsReady), which is what makes
// this safe: a decoder carrying the extra outputs engages them whatever it is
// called, and a stock upstream decoder does not.
const REPO_WITH_WITHDRAWN_VARIANTS = [
  'encoder-model.int8.smoothquant.optimized.onnx',
  'decoder_joint-model.int8.lse.onnx',
  'decoder_joint-model.int8.lse.topk.onnx',
  ...REPO_FLAT,
];
// A source still serving the withdrawn `.optimized` fp32 shard set alongside the
// canonical one.
const REPO_SHARDED_WITH_WITHDRAWN_VARIANTS = [
  ...REPO_HF_SHARDED,
  'sharded/encoder-model.optimized.onnx',
  'sharded/encoder-model.optimized.onnx.data.000',
  'sharded/encoder-model.optimized.onnx.data.001',
];

describe('getParakeetModel file selection: canonical names only', () => {
  test('WASM int8: the canonical encoder and decoder are fetched, withdrawn variant names ignored', async () => {
    const downloaded = mockHf(REPO_WITH_WITHDRAWN_VARIANTS);
    const r = await getParakeetModel('test/wasm-int8-canonical', {
      backend: 'wasm', encoderQuant: 'int8', decoderQuant: 'int8',
    });
    assert.equal(r.filenames.encoder, 'encoder-model.int8.onnx');
    assert.equal(r.filenames.decoder, 'decoder_joint-model.int8.onnx');
    assert.deepEqual(r.quantisation, { encoder: 'int8', decoder: 'int8' });
    assert.ok(downloaded.includes('encoder-model.int8.onnx'));
    assert.ok(downloaded.includes('decoder_joint-model.int8.onnx'));
    assert.ok(!downloaded.some((f) => f.includes('.optimized.') || f.includes('.lse.')),
      `no variant file may be fetched; got ${downloaded.join(', ')}`);
  });

  test('fp32 on either backend loads the canonical shard set, never a withdrawn one', async () => {
    for (const backend of ['wasm', 'webgpu']) {
      const downloaded = mockHfPaths(REPO_SHARDED_WITH_WITHDRAWN_VARIANTS);
      const r = await getParakeetModel(`test/${backend}-fp32-canonical`, {
        backend, encoderQuant: 'fp32', decoderQuant: 'int8', allowWasmFp32: true,
      });
      assert.equal(r.quantisation.encoder, 'fp32');
      assert.equal(r.filenames.encoder, 'encoder-model.onnx');
      assert.deepEqual(r.urls.encoderDataUrl.map((e) => e.path),
        ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001'],
        'mount paths must match the canonical graph\'s external_data basenames');
      assert.ok(downloaded.includes('sharded/encoder-model.onnx'), `[${backend}] must fetch the rewritten graph from sharded/`);
      assert.ok(!downloaded.some((f) => f.includes('optimized')),
        `[${backend}] withdrawn build must not be fetched; got ${downloaded.join(', ')}`);
      assert.ok(!downloaded.includes('encoder-model.onnx.data'),
        `[${backend}] must NOT fetch the flat 2.4GB sidecar when shards exist`);
    }
  });
});
