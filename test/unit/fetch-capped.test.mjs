// Tier-1 unit test for fetchTextCapped (app/ui/src/lib/fetchCapped.js), the
// byte cap on anything read out of the operator's static content directory
// (dictation-regex CSVs, boost-phrase TXTs). F-102: a poisoned upstream feeding
// the entrypoint a huge body would otherwise OOM the tab.
//
// The bug it pins: the no-streaming-body fallback capped on `text.length`,
// which counts UTF-16 code units, not bytes. A boost-phrase list of non-ASCII
// text (French, the app's second UI language) is up to 2 bytes per unit in
// UTF-8 and 4 for anything outside the BMP, so a body well over the byte cap
// passed the check.
//
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTextCapped, SERVED_FILE_MAX_BYTES } from '../../app/ui/src/lib/fetchCapped.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// `stream:false` models an engine (or a mock) whose Response exposes no
// readable body, which is the branch the cap was wrong in.
function stubFetch({ text = '', status = 200, contentLength = null, stream = true }) {
  const bytes = new TextEncoder().encode(text);
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h === 'content-length' && contentLength != null ? String(contentLength) : null) },
    text: async () => text,
    body: stream ? {
      cancel() {},
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true };
            sent = true;
            return { done: false, value: bytes };
          },
          cancel() {},
        };
      },
    } : undefined,
  });
}

describe('fetchTextCapped', () => {
  test('returns the body when it fits', async () => {
    stubFetch({ text: 'hello' });
    assert.deepEqual(await fetchTextCapped('/x.txt', 100), { ok: true, text: 'hello' });
  });

  test('reports a non-2xx without reading anything', async () => {
    stubFetch({ status: 404 });
    assert.deepEqual(await fetchTextCapped('/x.txt'), { ok: false, status: 404 });
  });

  test('refuses on a declared content-length over the cap, before streaming', async () => {
    stubFetch({ text: 'short', contentLength: 10_000_000 });
    assert.deepEqual(await fetchTextCapped('/x.txt', 100), { ok: false, oversize: true, declared: 10_000_000 });
  });

  test('refuses a streamed body that exceeds the cap', async () => {
    stubFetch({ text: 'x'.repeat(200) });
    const out = await fetchTextCapped('/x.txt', 100);
    assert.equal(out.ok, false);
    assert.equal(out.oversize, true);
    assert.equal(out.declared, 200);
  });

  test('without a streaming body, the cap is measured in BYTES not UTF-16 units', async () => {
    // 60 accented characters: 60 UTF-16 code units, 120 UTF-8 bytes. Under a
    // 100-byte cap this used to pass the length check and be handed on.
    const text = 'é'.repeat(60);
    assert.equal(text.length, 60);
    stubFetch({ text, stream: false });
    const out = await fetchTextCapped('/x.txt', 100);
    assert.equal(out.ok, false, 'a 120-byte body must not pass a 100-byte cap');
    assert.equal(out.declared, 120, 'and the reported size is the byte count');
  });

  test('without a streaming body, ASCII under the cap still passes', async () => {
    stubFetch({ text: 'x'.repeat(60), stream: false });
    assert.deepEqual(await fetchTextCapped('/x.txt', 100), { ok: true, text: 'x'.repeat(60) });
  });

  test('the exported default cap is 5 MB', () => {
    assert.equal(SERVED_FILE_MAX_BYTES, 5 * 1024 * 1024);
  });
});
