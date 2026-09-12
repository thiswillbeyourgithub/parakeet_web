// Tier-1 unit test for the CAM++ embedding session cache
// (app/ui/src/lib/speakerEmbedding.js). No ORT is needed: the loader is
// injected, so the cases are about the CACHE, which is where the bugs were.
//
// Two of them. (1) The memo held the resolved session, but the builder is
// async, so two embedding passes in flight at once (a diarization finishing
// while the user re-segments) both saw a null cache, both built a ~28 MB
// session, and one was overwritten and leaked. (2) Nothing ever released the
// session a new key replaced, so its weights stayed resident for the life of
// the tab.
//
// Built with Claude Code.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { _getEmbeddingSession as getSession, _resetEmbeddingSession } from '../../app/ui/src/lib/speakerEmbedding.js';

// A loader that records every session it builds and lets a test control when
// the build completes.
function makeLoader({ fail = false } = {}) {
  const built = [];
  const gates = [];
  const loadOrt = async () => ({
    InferenceSession: {
      create: (bytes, opts) => {
        if (fail) return Promise.reject(new Error('session build failed'));
        const session = { bytes, opts, released: 0, release() { this.released += 1; } };
        built.push(session);
        return new Promise((resolve) => gates.push(() => resolve(session)));
      },
    },
  });
  return { loadOrt, built, gates, releaseAll: () => { while (gates.length) gates.shift()(); } };
}

const bytesOf = (n) => new Uint8Array(n);

beforeEach(() => _resetEmbeddingSession());

describe('embedding session cache', () => {
  test('two concurrent callers share ONE session', async () => {
    const { loadOrt, built, releaseAll } = makeLoader();
    const a = getSession(bytesOf(64), loadOrt);
    const b = getSession(bytesOf(64), loadOrt);
    await new Promise((r) => setTimeout(r, 0));
    releaseAll();
    assert.equal(await a, await b);
    assert.equal(built.length, 1, 'the second caller must not build a second session');
  });

  test('a later caller reuses the built session', async () => {
    const { loadOrt, built, releaseAll } = makeLoader();
    const first = getSession(bytesOf(64), loadOrt);
    await new Promise((r) => setTimeout(r, 0));
    releaseAll();
    await first;
    assert.equal(await getSession(bytesOf(64), loadOrt), await first);
    assert.equal(built.length, 1);
  });

  test('a different model releases the one it replaces', async () => {
    const { loadOrt, built, releaseAll } = makeLoader();
    const first = getSession(bytesOf(64), loadOrt);
    await new Promise((r) => setTimeout(r, 0));
    releaseAll();
    const old = await first;
    assert.equal(old.released, 0);
    const second = getSession(bytesOf(128), loadOrt);
    await new Promise((r) => setTimeout(r, 0));
    releaseAll();
    await second;
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(built.length, 2);
    assert.equal(old.released, 1, 'the superseded session must be freed');
  });

  test('a failed build is not memoised, so the next caller retries', async () => {
    const bad = makeLoader({ fail: true });
    await assert.rejects(getSession(bytesOf(64), bad.loadOrt), /session build failed/);
    const good = makeLoader();
    const retry = getSession(bytesOf(64), good.loadOrt);
    await new Promise((r) => setTimeout(r, 0));
    good.releaseAll();
    assert.ok(await retry, 'the rejection must not have poisoned the cache');
  });

  test('the session is built on the WASM EP', async () => {
    const { loadOrt, built, releaseAll } = makeLoader();
    const p = getSession(bytesOf(64), loadOrt);
    await new Promise((r) => setTimeout(r, 0));
    releaseAll();
    await p;
    assert.deepEqual(built[0].opts, { executionProviders: ['wasm'] });
  });
});
