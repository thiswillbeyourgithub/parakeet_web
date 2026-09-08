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

// Probing nested-first only protects the repos a mount HAS a subfolder for. A
// mirror carrying a single repo flat and nothing else still answers the flat
// probe for every other repo in the picker, so the repo the mount lacks loads
// the one it has, under the wrong name. Both offered repos share an
// architecture, a vocab size and a mel-bin count here (see app/src/models.js),
// so the swap produces a fluent transcript and raises nothing. A flat tree
// carries no repo identity, so it is only attributable when there is exactly
// one candidate: that is what allowFlatFallback encodes.
describe('resolveLocalModelBase allowFlatFallback', () => {
  const OTHER = 'Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx';

  test('refuses an unattributed flat mirror for a repo it has no subfolder for', async () => {
    mockUrls(['/models/vocab.txt']);
    assert.equal(await resolveLocalModelBase('/models', OTHER, { allowFlatFallback: false }), null);
  });

  test('still resolves that repo when the mount DOES carry its subfolder', async () => {
    // The refusal is about attribution, not about nesting: a named subfolder is
    // proof of identity, so it answers regardless of the flag.
    mockUrls([`/models/${OTHER}/vocab.txt`]);
    assert.equal(await resolveLocalModelBase('/models', OTHER, { allowFlatFallback: false }), `/models/${OTHER}`);
  });

  test('refusing does not depend on the flat tree being absent', async () => {
    // Both layouts present, but only for the OTHER repo. The flat tree is
    // reachable and would have answered; the point is that it must not.
    mockUrls(['/models/vocab.txt', `/models/${REPO}/vocab.txt`]);
    assert.equal(await resolveLocalModelBase('/models', OTHER, { allowFlatFallback: false }), null);
    // ...and the repo that IS mounted nested still resolves, so disabling the
    // fallback costs a multi-repo deployment nothing it should have had.
    assert.equal(await resolveLocalModelBase('/models', REPO, { allowFlatFallback: false }), `/models/${REPO}`);
  });

  test('never probes the flat base at all when the fallback is off', async () => {
    // Not just "ignores the answer": the HEAD request is not made, so a mount
    // that is slow or hostile at the flat path costs a multi-repo load nothing.
    const probed = [];
    globalThis.fetch = async (url) => { probed.push(String(url)); return { ok: true }; };
    await resolveLocalModelBase('/models', OTHER, { allowFlatFallback: false });
    assert.deepEqual(probed, [`/models/${OTHER}/vocab.txt`]);
  });

  test('with no repoId the flag is inert (nothing to mis-attribute)', async () => {
    // No repo was named, so the flat base cannot be served under the wrong id.
    // Callers that pass no repoId (older API shape) keep the old behaviour.
    mockUrls(['/models/vocab.txt']);
    assert.equal(await resolveLocalModelBase('/models', undefined, { allowFlatFallback: false }), '/models');
  });

  test('defaults to allowing the flat fallback (single-repo contract intact)', async () => {
    // Explicitly pinned: the guard is opt-in, so every existing single-repo
    // deployment and every caller that passes no options behaves as before.
    mockUrls(['/models/vocab.txt']);
    assert.equal(await resolveLocalModelBase('/models', OTHER), '/models');
    assert.equal(await resolveLocalModelBase('/models', OTHER, {}), '/models');
  });
});

// The canary is the file the probe asks for. It defaults to vocab.txt because
// every ASR repo keeps one at its root in every layout modelLayout.js supports,
// but that made the probe unusable for a repo that has no vocab.txt -- which is
// both diarization repos (one ONNX each, their own repos entirely). Without a
// canary they could only be addressed by bare basename at the mirror root, so a
// mount serving several repos in subfolders still had to keep those two files
// loose at the top. Probing for the wanted file instead needs no new convention:
// a layout that serves the file is by definition the layout to read it from.
describe('resolveLocalModelBase canary', () => {
  const SEG_REPO = 'csukuangfj/sherpa-onnx-pyannote-segmentation-3-0';
  const SEG_FILE = 'model.onnx';

  test('finds a repo that has no vocab.txt, via its own file', async () => {
    mockUrls([`/models/${SEG_REPO}/${SEG_FILE}`]);
    assert.equal(await resolveLocalModelBase('/models', SEG_REPO, { canary: SEG_FILE }), `/models/${SEG_REPO}`);
  });

  test('still falls back to the flat mirror, which is where these files live today', async () => {
    // The single-repo LOCAL_MODEL_PATH contract and the CI mirror both put this
    // file at the root. Nesting is the new option, not a new requirement.
    mockUrls([`/models/${SEG_FILE}`]);
    assert.equal(await resolveLocalModelBase('/models', SEG_REPO, { canary: SEG_FILE }), '/models');
  });

  test('prefers the nested copy when a mirror carries both', async () => {
    mockUrls([`/models/${SEG_FILE}`, `/models/${SEG_REPO}/${SEG_FILE}`]);
    assert.equal(await resolveLocalModelBase('/models', SEG_REPO, { canary: SEG_FILE }), `/models/${SEG_REPO}`);
  });

  test('the default canary is unchanged when none is passed', async () => {
    // Pinned because every existing caller relies on it: a probe that silently
    // started asking for something else would resolve every ASR mirror to null.
    const probed = [];
    globalThis.fetch = async (url) => { probed.push(String(url)); return { ok: false }; };
    await resolveLocalModelBase('/models', REPO);
    assert.deepEqual(probed, [`/models/${REPO}/vocab.txt`, '/models/vocab.txt']);
  });

  test('a repo present under neither layout returns null, not a guess', async () => {
    // The caller (diarizationModels.js) turns this into "use the flat base and
    // let the fetch report the real error", so the null must be reachable.
    mockUrls([]);
    assert.equal(await resolveLocalModelBase('/models', SEG_REPO, { canary: SEG_FILE }), null);
  });
});
