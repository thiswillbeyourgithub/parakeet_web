// Tier-1 unit test for resolveLocalModelBase (app/src/hub.js): the canary probe
// that lets a locally-served /models mirror be either flat (vocab.txt directly
// under the base) or HF-style nested (vocab.txt under <base>/<repoId>/), so an
// operator who bind-mounts a parent folder of one or more repos doesn't 404
// every model fetch. Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocalModelBase } from '../../app/src/hub.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const REPO = 'istupakov/parakeet-tdt-0.6b-v3-onnx';

// Install a fake fetch that 200s for exactly the full URLs in `present`, 404s
// otherwise. Keyed on the WHOLE url (not just the trailing segment) so flat vs
// nested vocab.txt are distinguishable.
function mockUrls(present) {
  const set = new Set(present);
  globalThis.fetch = async (url) => ({ ok: set.has(String(url)) });
}

describe('resolveLocalModelBase', () => {
  test('returns the flat base when vocab.txt is served directly under it', async () => {
    mockUrls(['/models/vocab.txt']);
    assert.equal(await resolveLocalModelBase('/models', REPO), '/models');
  });

  test('falls back to the nested <base>/<repoId> base when only that serves vocab.txt', async () => {
    mockUrls([`/models/${REPO}/vocab.txt`]);
    assert.equal(await resolveLocalModelBase('/models', REPO), `/models/${REPO}`);
  });

  test('prefers the flat layout when BOTH layouts serve vocab.txt', async () => {
    mockUrls(['/models/vocab.txt', `/models/${REPO}/vocab.txt`]);
    assert.equal(await resolveLocalModelBase('/models', REPO), '/models');
  });

  test('returns null when neither layout serves vocab.txt', async () => {
    mockUrls([]);
    assert.equal(await resolveLocalModelBase('/models', REPO), null);
  });

  test('only probes the flat base when no repoId is given (back-compat)', async () => {
    const probed = [];
    globalThis.fetch = async (url) => { probed.push(String(url)); return { ok: false }; };
    const out = await resolveLocalModelBase('/models');
    assert.equal(out, null);
    assert.deepEqual(probed, ['/models/vocab.txt']);
  });

  test('a probe that throws is treated as "absent", not fatal', async () => {
    globalThis.fetch = async (url) => {
      if (String(url) === `/models/${REPO}/vocab.txt`) return { ok: true };
      throw new Error('network down');
    };
    assert.equal(await resolveLocalModelBase('/models', REPO), `/models/${REPO}`);
  });
});
