// Tier-1 unit test for how the download path (app/src/hub.js) handles a
// CONTENT-ENCODED response, i.e. the one Caddy's `file_server { precompressed
// zstd }` returns when it finds an `encoder-model.int8.onnx.zst` sidecar next
// to the model file (see scripts/precompress.mjs).
//
// Why this exists: such a response describes the COMPRESSED entity in its
// headers (content-length ~643 MB, and a variant etag) while `resp.body` hands
// over the DECODED bytes (~841 MB), because the browser undoes the encoding
// before fetch resolves. Adopting that content-length as the expected total is
// wrong twice over:
//   - the noCache path preallocates `new Uint8Array(total)` for the fp32 shards
//     and would overflow it mid-stream (a hard failure, not a cosmetic one);
//   - progress would sail past 100%.
// And the variant etag can never match the identity entity, so persisting it
// would guarantee an If-Range mismatch and restart a multi-hundred-MB download
// from byte 0 on the first hiccup.
//
// Resume itself is safe by construction: browsers send `Accept-Encoding:
// identity` on any request carrying a Range header (verified in Chromium 148),
// so a resumed attempt gets plain byte ranges of the real file. That is the
// case the last two tests pin down, including the one where the length only
// becomes known on the retry.
//
// This cannot be covered by the e2e tier: the test server (test/e2e/serve.mjs)
// is not Caddy and serves the weights identity-encoded, so the encoded branch
// never executes there.
//
// Built with Claude Code.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getLocalModelFile } from '../../app/src/hub.js';

// Deterministic, non-trivial payload (not all-zero, spans >1 chunk boundary).
function makePayload(n) {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + 7) & 0xff;
  return a;
}

// A response streaming `payload` in `chunkSize` pieces. `headers` describes the
// entity the SERVER is talking about, which for an encoded response is not the
// body the reader sees: that asymmetry is the whole point of this file.
function streamingResponse(payload, chunkSize, { status = 200, headers = {} } = {}) {
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
    status,
    headers: { 'content-type': 'application/octet-stream', ...headers },
  });
}

// A response that delivers `cut` bytes and then drops the connection, so the
// retry/resume machinery engages.
function truncatedResponse(payload, cut, headers = {}) {
  let sent = false;
  const body = new ReadableStream({
    // The error has to land on a LATER pull than the chunk: erroring a stream
    // resets its queue, so enqueueing and erroring in one go would deliver
    // nothing at all and there would be no partial download to resume.
    pull(controller) {
      if (!sent) { sent = true; controller.enqueue(payload.subarray(0, cut)); return; }
      controller.error(new Error('connection reset'));
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/octet-stream', ...headers },
  });
}

// What Caddy sends for a precompressed sidecar: the encoding, the COMPRESSED
// length, and the etag of the `.zst` variant rather than of the model file.
function zstdHeaders(compressedLength) {
  return {
    'content-encoding': 'zstd',
    'content-length': String(compressedLength),
    'etag': '"zst-variant-abc"',
  };
}

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

describe('content-encoded model download', () => {
  test('returns the whole decoded body although content-length is the compressed size', async () => {
    const payload = makePayload(40_000);
    globalThis.fetch = async (_url, opts) => {
      if (opts?.method === 'HEAD') return new Response(null, { status: 200 });
      // 30_000 stands in for the ~27% zstd wins on the int8 encoder.
      return streamingResponse(payload, 1024, { headers: zstdHeaders(30_000) });
    };

    const got = await getLocalModelFile('/models', 'repo', 'encoder-model.int8.onnx', {
      asBytes: true,
      noCache: true,
    });

    // Before the fix this threw RangeError from memBuf.set() once the decoded
    // stream ran past the 30_000-byte preallocation.
    assert.ok(got instanceof Uint8Array);
    assert.equal(got.length, payload.length);
    assert.deepEqual(got, payload);
  });

  test('never reports progress past the announced total', async () => {
    const payload = makePayload(40_000);
    globalThis.fetch = async (_url, opts) => {
      if (opts?.method === 'HEAD') return new Response(null, { status: 200 });
      return streamingResponse(payload, 1024, { headers: zstdHeaders(30_000) });
    };

    const events = [];
    await getLocalModelFile('/models', 'repo', 'encoder-model.int8.onnx', {
      asBytes: true,
      noCache: true,
      progress: (e) => events.push(e),
    });

    for (const e of events) {
      if (typeof e.total === 'number' && e.total > 0) {
        assert.ok(e.loaded <= e.total, `progress ${e.loaded}/${e.total} overshoots 100%`);
      }
    }
  });

  test('does not send the compressed variant etag on a resume', async () => {
    const payload = makePayload(40_000);
    const seen = [];
    let call = 0;
    globalThis.fetch = async (_url, opts) => {
      if (opts?.method === 'HEAD') return new Response(null, { status: 200 });
      const h = opts?.headers || {};
      seen.push({ range: h.Range || null, ifRange: h['If-Range'] || null });
      if (call++ === 0) return truncatedResponse(payload, 12_000, zstdHeaders(30_000));
      // The resume asks with a Range header, which browsers pair with
      // `Accept-Encoding: identity`, so this is a plain byte range.
      const from = parseInt(String(h.Range).replace('bytes=', ''), 10);
      return streamingResponse(payload.subarray(from), 1024, {
        status: 206,
        headers: {
          'content-range': `bytes ${from}-${payload.length - 1}/${payload.length}`,
          'etag': '"identity-xyz"',
        },
      });
    };

    const got = await getLocalModelFile('/models', 'repo', 'encoder-model.int8.onnx', {
      asBytes: true,
      noCache: true,
    });

    assert.equal(seen.length, 2, 'expected exactly one resume');
    assert.equal(seen[0].range, null);
    assert.equal(seen[1].range, 'bytes=12000-');
    assert.equal(seen[1].ifRange, null, 'the .zst variant etag must not be replayed as If-Range');
    assert.deepEqual(got, payload);
  });

  test('still replays an identity etag on a resume', async () => {
    // Control for the test above: dropping the etag must be specific to encoded
    // responses, or resume validation would be silently disabled for everyone.
    const payload = makePayload(40_000);
    const seen = [];
    let call = 0;
    globalThis.fetch = async (_url, opts) => {
      if (opts?.method === 'HEAD') return new Response(null, { status: 200 });
      const h = opts?.headers || {};
      seen.push({ range: h.Range || null, ifRange: h['If-Range'] || null });
      if (call++ === 0) {
        return truncatedResponse(payload, 12_000, {
          'content-length': String(payload.length),
          'etag': '"identity-xyz"',
        });
      }
      const from = parseInt(String(h.Range).replace('bytes=', ''), 10);
      return streamingResponse(payload.subarray(from), 1024, {
        status: 206,
        headers: { 'content-range': `bytes ${from}-${payload.length - 1}/${payload.length}` },
      });
    };

    const got = await getLocalModelFile('/models', 'repo', 'encoder-model.int8.onnx', {
      asBytes: true,
      noCache: true,
    });

    assert.equal(seen[1].ifRange, '"identity-xyz"');
    assert.deepEqual(got, payload);
  });

  test('a resume that first learns the length keeps the bytes already streamed', async () => {
    // The encoded first attempt leaves the total unknown, so noCache collects
    // chunks instead of preallocating. The 206 then reveals the real size and
    // the buffer is allocated mid-download: the bytes from attempt 1 have to be
    // folded into it, or the model comes back with a prefix of zeros (which
    // ORT would reject as a corrupt graph, far from the actual cause).
    const payload = makePayload(40_000);
    let call = 0;
    globalThis.fetch = async (_url, opts) => {
      if (opts?.method === 'HEAD') return new Response(null, { status: 200 });
      if (call++ === 0) return truncatedResponse(payload, 9_000, zstdHeaders(30_000));
      const from = parseInt(String(opts.headers.Range).replace('bytes=', ''), 10);
      return streamingResponse(payload.subarray(from), 1024, {
        status: 206,
        headers: { 'content-range': `bytes ${from}-${payload.length - 1}/${payload.length}` },
      });
    };

    const got = await getLocalModelFile('/models', 'repo', 'encoder-model.onnx.data.000', {
      asBytes: true,
      noCache: true,
    });

    assert.equal(got.length, payload.length);
    assert.deepEqual(got.subarray(0, 9_000), payload.subarray(0, 9_000));
    assert.deepEqual(got, payload);
  });
});
