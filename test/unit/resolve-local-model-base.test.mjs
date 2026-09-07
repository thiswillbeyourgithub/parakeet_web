// Tier-1 unit test for resolveLocalModelBase (app/src/hub.js): the canary probe
// that lets a locally-served /models mirror be either flat (vocab.txt directly
// under the base) or HF-style nested (vocab.txt under <base>/<repoId>/), so an
// operator who bind-mounts a parent folder of one or more repos doesn't 404
// every model fetch. Nested is probed FIRST: see the both-layouts test for why
// the opposite order silently serves the wrong model. Built with Claude Code.

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

  test('uses the nested <base>/<repoId> base when only that serves vocab.txt', async () => {
    mockUrls([`/models/${REPO}/vocab.txt`]);
    assert.equal(await resolveLocalModelBase('/models', REPO), `/models/${REPO}`);
  });

  // The picker (VITE_MODEL_REPO as a comma-separated list) makes this the
  // decisive case: a mirror that serves ONE repo flat and others nested must
  // not answer the flat probe for a repo the caller named. Flat-first did, so
  // selecting the second repo loaded the first one's weights under the second
  // one's name -- a plausible transcript, no error, nothing to notice.
  test('prefers the nested layout when BOTH layouts serve vocab.txt', async () => {
    mockUrls(['/models/vocab.txt', `/models/${REPO}/vocab.txt`]);
    assert.equal(await resolveLocalModelBase('/models', REPO), `/models/${REPO}`);
  });

  test('a repo with no subfolder still falls back to the flat mirror', async () => {
    // The documented single-repo contract: one repo, served flat, no subfolder
    // anywhere. Nested is probed first, misses, and flat answers as before.
    mockUrls(['/models/vocab.txt']);
    assert.equal(await resolveLocalModelBase('/models', 'Olicorne/some-other-repo'), '/models');
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
