// Tier-1 unit test for the size-gated cache of streamed (noCache) files in
// app/src/hub.js: the `cacheIfUnder` option the fp32 encoder shards use.
//
// Why this exists: the fp32 shards stream straight to a Uint8Array and used to
// touch IndexedDB not at all, so every WebGPU visitor re-downloaded ~2.3 GB of
// encoder on every single page load. That was defensible while the sharded
// encoder was an explicit opt-in, and stopped being so on 2026-08-21 when the
// autoconfigure probe started putting ordinary visitors on it: a real report
// from an Intel iGPU laptop measured a 74 s model load, paid every load, for a
// backend the visitor never chose.
//
// Caching the shards was tried once before (commit 88a39df) and reverted
// (7f19a4e): Chromium disk-spills a ~1.4 GB Blob and `blob.arrayBuffer()` throws
// NotReadableError reading it back. That failure was SIZE-dependent, which is
// what this gate encodes: a stream small enough to survive a cache round-trip
// (the ~840 MB int8 encoder does one on the shipping path every day) is written
// to IndexedDB after streaming, a larger one keeps the old never-cached
// behaviour exactly. Streaming itself is unchanged in both cases: the multi-GB
// Blob assembly that 88a39df died on is still never performed.
//
// Node has no IndexedDB, so this installs the same minimal fake as
// hub-cache-readback.test.mjs.
//
// Built with Claude Code.

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getLocalModelFile, MAX_CACHEABLE_STREAM_BYTES } from '../../app/src/hub.js';
import { fakeIdb, fakeIndexedDBOpen } from '../support/fake-indexeddb.mjs';

// ---------------------------------------------------------------------------
// Payload + fetch stub
// ---------------------------------------------------------------------------

function makePayload(n) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + 7) & 0xff;
  return a;
}

let fetchCount = 0;
function serve(payload) {
  return async () => {
    fetchCount += 1;
    let offset = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (offset >= payload.length) { controller.close(); return; }
        const end = Math.min(offset + 256 * 1024, payload.length);
        controller.enqueue(payload.subarray(offset, end));
        offset = end;
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-length': String(payload.length), 'content-type': 'application/octet-stream' },
    });
  };
}

// Only the completed cache records, not partial-download state or meta siblings.
function cacheRecordKeys() {
  return [...fakeIdb.data.keys()].filter((k) => !k.includes('partial') && !k.startsWith('meta-'));
}

const originalIndexedDB = globalThis.indexedDB;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fakeIdb.reset();
  fetchCount = 0;
  globalThis.indexedDB = { open: fakeIndexedDBOpen };
});

after(() => {
  if (originalIndexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = originalIndexedDB;
  globalThis.fetch = originalFetch;
});

const SIZE = 512 * 1024; // stands in for a shard; the gate is a byte comparison

describe('cacheIfUnder: a streamed file small enough to cache is cached', () => {
  test('bytes are returned AND written to IndexedDB', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);

    const got = await getLocalModelFile('/models', 'test/repo', 'enc.onnx.data.000', {
      asBytes: true, noCache: true, cacheIfUnder: SIZE * 2,
    });

    // The caller still gets the streamed bytes, unchanged: the cache write is
    // an addition to the noCache path, not a rerouting of it.
    assert.ok(got instanceof Uint8Array);
    assert.equal(got.length, SIZE);
    assert.equal(Buffer.compare(Buffer.from(got), Buffer.from(payload)), 0);

    const keys = cacheRecordKeys();
    assert.equal(keys.length, 1, `expected one cache record, got ${JSON.stringify([...fakeIdb.data.keys()])}`);
    assert.equal(fakeIdb.data.get(keys[0]).size, SIZE);
    // Validation metadata is written beside it, like every other cached file.
    assert.ok(fakeIdb.data.has(`meta-${keys[0]}`));
  });

  test('a second load is served from the cache instead of the network', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);
    const opts = { asBytes: true, noCache: true, cacheIfUnder: SIZE * 2 };

    const first = await getLocalModelFile('/models', 'test/repo', 'enc.onnx.data.000', opts);
    assert.equal(fetchCount, 1);

    // This is the whole point: the visitor stops re-downloading the encoder on
    // every page load.
    const second = await getLocalModelFile('/models', 'test/repo', 'enc.onnx.data.000', opts);
    assert.equal(fetchCount, 1, 'a cached shard must not be re-fetched');
    assert.equal(Buffer.compare(Buffer.from(second), Buffer.from(first)), 0);
  });
});

describe('cacheIfUnder: a stream over the limit keeps the old behaviour exactly', () => {
  test('nothing is written to IndexedDB, and the next load re-downloads', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);
    // One byte under the payload: the shard that Chromium would disk-spill.
    const opts = { asBytes: true, noCache: true, cacheIfUnder: SIZE - 1 };

    const got = await getLocalModelFile('/models', 'test/repo', 'enc.onnx.data.000', opts);
    assert.equal(got.length, SIZE, 'an uncacheable shard still loads');
    assert.deepEqual(cacheRecordKeys(), [], 'an over-limit stream must not reach IndexedDB');

    await getLocalModelFile('/models', 'test/repo', 'enc.onnx.data.000', opts);
    assert.equal(fetchCount, 2, 'with nothing cached, the next load re-downloads');
  });

  test('plain noCache (no cacheIfUnder) never touches the cache at all', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);

    await getLocalModelFile('/models', 'test/repo', 'enc.onnx.data.000', { asBytes: true, noCache: true });
    assert.deepEqual(cacheRecordKeys(), [], 'the default noCache path is unchanged');
    await getLocalModelFile('/models', 'test/repo', 'enc.onnx.data.000', { asBytes: true, noCache: true });
    assert.equal(fetchCount, 2);
  });
});

describe('MAX_CACHEABLE_STREAM_BYTES', () => {
  test('sits below the ~840 MB blob that is proven to survive a round-trip', () => {
    // The int8 encoder is cached and read back on the shipping path every day,
    // so blobs of that size work. The reverted 1.4 GB shard did not. The limit
    // has to leave the first alone and keep the second out.
    assert.ok(MAX_CACHEABLE_STREAM_BYTES > 0);
    assert.ok(MAX_CACHEABLE_STREAM_BYTES <= 840e6, 'must not exceed the size proven to read back');
    assert.ok(MAX_CACHEABLE_STREAM_BYTES < 1.4e9, 'must exclude the shard size that threw NotReadableError');
  });

  test('the shards the model repo ships today are still over it', () => {
    // 1.4 GB + 948 MB as of 2026-09. Until the repo re-shards smaller
    // (shard-fp32.py --max-shard-bytes), this change is a no-op in production,
    // which is exactly why it is safe to land before the re-shard.
    assert.ok(1414.6 * 1024 * 1024 > MAX_CACHEABLE_STREAM_BYTES);
    assert.ok(947.1 * 1024 * 1024 > MAX_CACHEABLE_STREAM_BYTES);
  });
});
