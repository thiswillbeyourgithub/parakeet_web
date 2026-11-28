// Tier-1 unit test: what a failed /models download throws, and how fast.
//
// Two bugs met here. The local-first rescue in lib/loadFailure.js ("HF looked
// unreachable, /models missed, so go back to HuggingFace once") keyed on a
// HubDownloadError that a /models download never raised, so it could not fire.
// And a 404 went through the whole backoff ladder (1+2+4+8+16+30 s) before the
// load could move on, although a missing file does not appear by asking again.
//
// Built with Claude Code.

import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { getLocalModelFile, LocalDownloadError, HubDownloadError } from '../../app/src/hub.js';

// Node loads its Response class (undici) lazily on first use, which measured
// 57 ms to 2.7 s depending on load. The fake fetch below builds the first
// Response INSIDE the 404 test's timed window, so that one-off cost alone
// could cross the 900 ms bound that detects the backoff ladder and fail the
// test with no retry at all (seen in the pre-push hook, 2 of 5 isolated runs).
// Paying it here keeps the bound measuring only hub.js.
new Response('');

let calls = 0;
const originalFetch = globalThis.fetch;
beforeEach(() => { calls = 0; });
after(() => { globalThis.fetch = originalFetch; });

// Plain status responses, then a real body on the last call when asked to.
function respondWith(statuses, body = new Uint8Array([1, 2, 3, 4])) {
  globalThis.fetch = async () => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls += 1;
    if (status === 200) {
      return new Response(body, { status, headers: { 'content-length': String(body.length) } });
    }
    return new Response('nope', { status, statusText: 'x' });
  };
}

describe('getLocalModelFile failures', () => {
  test('a 404 throws a LocalDownloadError after ONE request', async () => {
    respondWith([404]);
    const t0 = Date.now();
    const err = await getLocalModelFile('/models', 'test/repo', 'enc.onnx', { asBytes: true, noCache: true })
      .then(() => null, (e) => e);
    assert.ok(err instanceof LocalDownloadError, String(err));
    assert.ok(!(err instanceof HubDownloadError), 'a /models miss must not look like an HF one');
    assert.equal(err.filename, 'enc.onnx');
    assert.match(String(err.cause?.message), /HTTP 404/);
    assert.equal(calls, 1, 'a missing file was asked for again');
    assert.ok(Date.now() - t0 < 900, 'a 404 waited on the backoff ladder');
  });

  test('a 410 is just as final', async () => {
    respondWith([410]);
    await assert.rejects(getLocalModelFile('/models', 'test/repo', 'enc.onnx', { asBytes: true, noCache: true }),
      LocalDownloadError);
    assert.equal(calls, 1);
  });

  test('a transient 503 is still retried, and the retry can succeed', async () => {
    respondWith([503, 200]);
    const got = await getLocalModelFile('/models', 'test/repo', 'enc.onnx', { asBytes: true, noCache: true });
    assert.deepEqual([...got], [1, 2, 3, 4]);
    assert.equal(calls, 2);
  });
});
