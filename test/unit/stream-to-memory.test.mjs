// Tier-1 unit test for the byte-download paths of getLocalModelFile
// (app/src/hub.js), with a focus on the noCache "stream-to-memory" mode added
// for the sharded fp32 encoder.
//
// Why this exists: the fp32 encoder ships as multi-hundred-MB shards. Handing
// ORT a blob: URL of that size trips Chromium's ~2 GB blob-URL fetch wall
// (TypeError: Failed to fetch), and the normal download path's IndexedDB Blob
// reassembly can throw NotReadableError when a multi-GB Blob is read back. The
// fix loads shards as bytes with caching off: the stream is written straight
// into one preallocated Uint8Array and returned, never touching IndexedDB.
// That in-browser path can only be exercised end-to-end with a GPU-less WASM
// Chromium and the local shards present (test/e2e/transcription-fp32-wasm.spec.js,
// which self-skips without them), so this tier-1 test guards the pure
// byte-assembly logic in CI: the bytes returned must equal the served bytes
// exactly, across an arbitrary chunk split.
//
// Node has no IndexedDB, so the cache branches are inert here regardless; what
// we are pinning down is that the streamed chunks reassemble losslessly.
//
// Built with Claude Code.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getLocalModelFile } from '../../app/src/hub.js';

// Build a Response whose body streams `payload` in chunks of `chunkSize`, so the
// reassembly logic is exercised over many reader.read() iterations rather than a
// single chunk.
function streamingResponse(payload, chunkSize) {
  let offset = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (offset >= payload.length) { controller.close(); return; }
      const end = Math.min(offset + chunkSize, payload.length);
      controller.enqueue(payload.subarray(offset, end));
      offset = end;
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'content-length': String(payload.length),
      'content-type': 'application/octet-stream',
    },
  });
}

// A deterministic, non-trivial payload (not all-zero, spans >1 chunk boundary).
function makePayload(n) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + 7) & 0xff;
  return a;
}

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

describe('getLocalModelFile noCache stream-to-memory', () => {
  test('returns the exact served bytes, reassembled across many chunks', async () => {
    const payload = makePayload(50_000);
    let headSeen = false;
    globalThis.fetch = async (_url, opts) => {
      if (opts?.method === 'HEAD') { headSeen = true; return new Response(null, { status: 200 }); }
      return streamingResponse(payload, 1024); // ~49 chunks
    };

    const got = await getLocalModelFile('/models', 'repo', 'encoder-model.onnx.data.000', {
      asBytes: true,
      noCache: true,
    });

    assert.ok(got instanceof Uint8Array, 'noCache + asBytes must return bytes, not a URL');
    assert.equal(got.length, payload.length);
    assert.deepEqual(got, payload);
    // noCache must not pre-flight a HEAD revalidation (it never consults a cache).
    assert.equal(headSeen, false);
  });

  test('a single-chunk body reassembles to the same bytes', async () => {
    const payload = makePayload(4096);
    globalThis.fetch = async () => streamingResponse(payload, payload.length);
    const got = await getLocalModelFile('/models', 'repo', 'encoder-model.onnx.data.001', {
      asBytes: true,
      noCache: true,
    });
    assert.deepEqual(got, payload);
  });

  test('an empty body yields an empty byte array, not a throw', async () => {
    const payload = makePayload(0);
    globalThis.fetch = async () => streamingResponse(payload, 1024);
    const got = await getLocalModelFile('/models', 'repo', 'encoder-model.onnx.data.000', {
      asBytes: true,
      noCache: true,
    });
    assert.ok(got instanceof Uint8Array);
    assert.equal(got.length, 0);
  });

  test('caching path (no noCache) returns the same bytes for asBytes', async () => {
    // Sanity: the byte content does not depend on whether caching is engaged.
    const payload = makePayload(20_000);
    globalThis.fetch = async (_url, opts) => {
      if (opts?.method === 'HEAD') return new Response(null, { status: 200 });
      return streamingResponse(payload, 777);
    };
    const got = await getLocalModelFile('/models', 'repo', 'vocab.txt', { asBytes: true });
    assert.deepEqual(got, payload);
  });
});
