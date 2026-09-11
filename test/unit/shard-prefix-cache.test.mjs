// Tier-1 unit test for the PARTIAL cache of streamed (noCache) files in
// app/src/hub.js: the `prefixCacheBytes` option the fp32 encoder shards use.
//
// Why this exists: the ~2.4 GB fp32 shard set cannot be cached whole in ANY
// record shape. Three attempts proved it: one Blob per shard (88a39df, reverted
// in 7f19a4e: Chromium disk-spills a ~1.4 GB Blob and blob.arrayBuffer() throws
// NotReadableError), a size gate that let nothing through because every shard
// is over it, and chunked records, which failed for the reason that explains
// all three: reading a value back throws "Failed to read large IndexedDB value"
// once the origin holds more than ~2^31 aggregate bytes of large values,
// whatever the record size. Measured directly: 2.42 GB written as 72x32 MB
// records reports a clean 2.42 GB against a 10.74 GB quota, and after a reload
// records 0..62 read while 63..71 throw, with 63 * 33554432 == 2147483648.
//
// So the question is not whether to cache the shards but how much of them. This
// path keeps the first MAX_PREFIX_CACHE_BYTES of the set as ordinary resume
// state and Range-fetches the remainder on every load, which is worth doing
// because the cache is not competing with the network: reading 1.5 GB back out
// of IndexedDB was measured at 344 MB/s (4.4 s), against minutes for the same
// bytes over a real connection.
//
// The fp32 path itself can only be exercised end to end by
// test/e2e/transcription-fp32-wasm.spec.js (which self-skips without local
// shards), so what this pins in CI is the logic: the prefix is written, it is
// capped at the budget, the next load resumes from it with a Range request
// covering exactly the missing tail, and the bytes reassemble to the original.
// The last one is the property that matters most, because getting it wrong
// yields a silently corrupt model rather than a failed download.
//
// Built with Claude Code.

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalModelFile,
  MAX_PREFIX_CACHE_BYTES,
  PREFIX_SEGMENT_BYTES,
} from '../../app/src/hub.js';
import { fakeIdb, fakeIndexedDBOpen } from '../support/fake-indexeddb.mjs';

// ---------------------------------------------------------------------------
// Payload + a Range-capable fetch stub
// ---------------------------------------------------------------------------

function makePayload(n) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + 7) & 0xff;
  return a;
}

// Every request the stub served, so a test can assert WHAT was asked for and
// not merely how many times.
let requests = [];

// `opts.ranges === false` serves a 200 with the whole entity whatever was
// asked for, standing in for a server without Range support.
function serve(payload, opts = {}) {
  const { ranges = true, etag = '"v1"', chunkSize = 64 * 1024 } = opts;
  return async (_url, init = {}) => {
    const reqRange = init.headers?.Range || null;
    requests.push({ range: reqRange, ifRange: init.headers?.['If-Range'] || null });

    let start = 0;
    let status = 200;
    const headers = { 'content-type': 'application/octet-stream' };
    if (etag) headers.etag = etag;

    const m = ranges && reqRange && reqRange.match(/^bytes=(\d+)-$/);
    if (m) {
      start = parseInt(m[1], 10);
      status = 206;
      headers['content-range'] = `bytes ${start}-${payload.length - 1}/${payload.length}`;
    }
    const slice = payload.subarray(start);
    headers['content-length'] = String(slice.length);

    let offset = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (offset >= slice.length) { controller.close(); return; }
        const end = Math.min(offset + chunkSize, slice.length);
        controller.enqueue(slice.subarray(offset, end));
        offset = end;
      },
    });
    return new Response(body, { status, headers });
  };
}

const partialKeys = () => [...fakeIdb.data.keys()].filter((k) => k.startsWith('partial-'));
const segKeys = () => partialKeys().filter((k) => k.includes('-seg-'));
const metaRecord = () => fakeIdb.data.get(partialKeys().find((k) => !k.includes('-seg-')));
// Bytes actually on disk as prefix segments.
const storedBytes = () => segKeys().reduce((n, k) => n + fakeIdb.data.get(k).byteLength, 0);

const originalIndexedDB = globalThis.indexedDB;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  fakeIdb.reset();
  requests = [];
  globalThis.indexedDB = { open: fakeIndexedDBOpen };
});

after(() => {
  if (originalIndexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = originalIndexedDB;
  globalThis.fetch = originalFetch;
});

// Stands in for a shard. The prefix machinery is all byte comparisons, so the
// only thing the real sizes would buy is a slow test.
const SIZE = 512 * 1024;
const BUDGET = 192 * 1024; // deliberately not a multiple of the segment size
const SEG = 64 * 1024;

// The shards go through getLocalModelFile exactly as downloadModelFiles calls
// it, minus the size of the numbers.
const load = (prefixCacheBytes, extra = {}) => getLocalModelFile(
  '/models', 'test/repo', 'enc.onnx.data.000',
  { asBytes: true, noCache: true, cacheIfUnder: 0, prefixCacheBytes, prefixSegmentBytes: SEG, ...extra },
);

describe('prefixCacheBytes: a file too big to cache keeps a prefix of itself', () => {
  test('the prefix is written, capped at the budget, and the bytes still come back whole', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);

    const got = await load(BUDGET);

    // The caller still gets every byte it asked for: the prefix cache is an
    // addition to the stream-to-memory path, not a rerouting of it.
    assert.equal(got.length, SIZE);
    assert.equal(Buffer.compare(Buffer.from(got), Buffer.from(payload)), 0);

    // And only the budget is on disk. Overshooting is the failure that matters,
    // because the budget is what keeps the origin under the 2^31 readback wall.
    assert.equal(storedBytes(), BUDGET, 'the prefix must stop exactly at the budget');
    assert.equal(metaRecord().received, BUDGET);
    assert.equal(metaRecord().total, SIZE);

    // The prefix is the LEADING bytes; anything else cannot be resumed from.
    const onDisk = Buffer.concat(segKeys()
      .sort((a, b) => Number(a.split('-seg-')[1]) - Number(b.split('-seg-')[1]))
      .map((k) => Buffer.from(fakeIdb.data.get(k))));
    assert.equal(Buffer.compare(onDisk, Buffer.from(payload.subarray(0, BUDGET))), 0);
  });

  test('the next load Range-fetches exactly the missing tail', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);

    await load(BUDGET);
    requests = [];

    const second = await load(BUDGET);

    // This is the whole point: the transfer shrinks by the size of the prefix.
    assert.equal(requests.length, 1);
    assert.equal(requests[0].range, `bytes=${BUDGET}-`, 'must resume at the end of the prefix');
    assert.equal(requests[0].ifRange, '"v1"', 'must validate the prefix against the etag');

    // Prefix from disk plus tail from the network has to equal the file. A
    // one-byte slip here ships a corrupt model that loads and transcribes
    // garbage, so this assertion is the reason the test exists.
    assert.equal(second.length, SIZE);
    assert.equal(Buffer.compare(Buffer.from(second), Buffer.from(payload)), 0);
  });

  test('a file that fits inside the budget is served entirely from disk', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);

    await load(SIZE * 2);
    assert.equal(storedBytes(), SIZE);
    requests = [];

    const second = await load(SIZE * 2);
    assert.equal(requests.length, 0, 'nothing left to fetch');
    assert.equal(Buffer.compare(Buffer.from(second), Buffer.from(payload)), 0);
  });

  test('a budget of zero keeps the never-touch-IndexedDB behaviour exactly', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);

    await load(0);
    assert.deepEqual([...fakeIdb.data.keys()], [], 'plain noCache must not write anything');

    await load(0);
    assert.equal(requests.length, 2, 'with nothing cached, the next load re-downloads in full');
    assert.equal(requests[1].range, null);
  });
});

describe('prefixCacheBytes: the prefix is dropped when it cannot be trusted', () => {
  test('a server that ignores Range restarts the download from zero', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);
    await load(BUDGET);

    // Same file, but now the origin answers every request with the full body.
    globalThis.fetch = serve(payload, { ranges: false });
    requests = [];
    const second = await load(BUDGET);

    assert.equal(requests[0].range, `bytes=${BUDGET}-`, 'it still tries the cheap path first');
    assert.equal(Buffer.compare(Buffer.from(second), Buffer.from(payload)), 0,
      'a full body after a Range request must not be appended to the prefix');
    assert.equal(storedBytes(), BUDGET, 'and the prefix is rebuilt for next time');
  });

  test('a file whose length changed is re-downloaded rather than stitched', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);
    await load(BUDGET);

    // A different file behind an etag that did not change: the case a naive
    // resume turns into a corrupt model instead of a failed download.
    const replacement = makePayload(SIZE + 4096).map((b) => b ^ 0x5a);
    globalThis.fetch = serve(replacement);
    requests = [];
    const second = await load(BUDGET);

    assert.equal(second.length, SIZE + 4096);
    assert.equal(Buffer.compare(Buffer.from(second), Buffer.from(replacement)), 0);
  });

  test('an unreadable prefix segment restarts the download instead of failing it', async () => {
    const payload = makePayload(SIZE);
    globalThis.fetch = serve(payload);
    await load(BUDGET);

    // The exact corruption the 2^31 ceiling produces in the field: the record
    // is listed, and reading it back does not hand over bytes.
    fakeIdb.data.set(segKeys()[0], 'not an ArrayBuffer');
    requests = [];
    const second = await load(BUDGET);

    assert.equal(requests[0].range, null, 'a bad prefix must not be resumed from');
    assert.equal(Buffer.compare(Buffer.from(second), Buffer.from(payload)), 0);
  });
});

describe('MAX_PREFIX_CACHE_BYTES', () => {
  test('leaves real headroom under the 2^31 aggregate readback ceiling', () => {
    // 1.5 GB was measured to read back with 0 failures on the same box where
    // 2.42 GB fails partway through. The headroom is not spare capacity: the
    // fp32 decoder sidecar (~72 MB) and any records still waiting for the
    // generational sweep are counted against the same ceiling.
    assert.ok(MAX_PREFIX_CACHE_BYTES > 0);
    assert.ok(MAX_PREFIX_CACHE_BYTES <= 1.6e9, 'must stay near the size proven to read back');
    assert.ok(2 ** 31 - MAX_PREFIX_CACHE_BYTES > 500e6, 'must leave room for the other cached files');
  });

  test('is worth more than one shard of the set the repo ships', () => {
    // 1.483 GB + 952 MB as of 2026-09. A budget under the first shard would
    // buy a partial prefix of it and nothing else; at the current value the
    // whole of .000 is cached and the per-load transfer drops to ~0.95 GB.
    assert.ok(MAX_PREFIX_CACHE_BYTES >= 1.483e9, 'must cover the first shard the repo ships');
  });

  test('the segment size is the one the readback ceiling was probed at', () => {
    // The ceiling was measured with 32 MB records; shipping a different record
    // size would mean shipping a shape nobody measured.
    assert.equal(PREFIX_SEGMENT_BYTES, 32e6);
  });
});
