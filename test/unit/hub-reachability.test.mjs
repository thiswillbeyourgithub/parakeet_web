// Tier-1 unit test for the background HuggingFace preflight
// (app/ui/src/lib/hubReachability.js): the check that lets a locked-down machine
// skip a doomed HF attempt instead of waiting out the browser's connect timeout.
//
// Both halves are pinned, and the SECOND matters more. The probe must never
// throw, because it runs unattended on every page load and an escaping rejection
// would surface as console noise on a path that is supposed to be invisible. And
// `preferLocalFirst` must refuse to reorder anything unless it is certain: this
// is an optimisation layered over a fallback that already works, so every
// uncertain case has to resolve to "behave exactly as before". Getting that
// backwards would trade a slow success for a fast failure.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  HUB_API_ORIGIN,
  HUB_PROBE_TIMEOUT_MS,
  hubProbeUrl,
  probeHubReachable,
  preferLocalFirst,
} from '../../app/ui/src/lib/hubReachability.js';

describe('probeHubReachable: can this machine reach HuggingFace at all', () => {
  test('a completed request means reachable', async () => {
    assert.equal(await probeHubReachable({ fetchImpl: async () => ({ ok: false, status: 0 }) }), true);
  });

  test('an error status still counts as reachable', async () => {
    // Completing IS the signal. A 401 or a renamed repo's 404 both prove the
    // machine reached HuggingFace, so inspecting `ok` here would report a
    // healthy network as blocked and send the visitor local-first for nothing.
    assert.equal(await probeHubReachable({ fetchImpl: async () => ({ ok: false, status: 404 }) }), true);
  });

  test('a network error means unreachable, and does not throw', async () => {
    assert.equal(await probeHubReachable({
      fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
    }), false);
  });

  test('a hung request is abandoned at the timeout rather than waited out', async () => {
    // The exact failure this whole module exists for: a blackholed network never
    // answers, so the probe has to give up on its own schedule.
    const started = Date.now();
    const reachable = await probeHubReachable({
      timeoutMs: 30,
      fetchImpl: (url, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    });
    assert.equal(reachable, false);
    assert.ok(Date.now() - started < 2000, 'probe should abort promptly, not hang');
  });

  test('asks the HF API in CORS mode with a cache-defeating HEAD', async () => {
    let seen = null;
    await probeHubReachable({ fetchImpl: async (url, init) => { seen = { url, init }; return {}; } });
    assert.equal(seen.url, hubProbeUrl());
    assert.equal(seen.init.method, 'HEAD');
    // The one that is NOT a style choice. This app sends COEP: require-corp, so
    // a cross-origin `no-cors` response without a CORP header is blocked by the
    // browser; huggingface.co sends no CORP on its static assets, so a no-cors
    // probe would report EVERY visitor's network as blocked. A CORS-mode request
    // that passes the CORS check satisfies COEP, and the HF API echoes the
    // Origin. Regressing this to 'no-cors' breaks the feature for everyone,
    // silently and in the expensive direction.
    assert.equal(seen.init.mode, 'cors');
    // Without no-store a cached answer would report a currently-blocked network
    // as reachable, which is the one wrong answer that costs the visitor time.
    assert.equal(seen.init.cache, 'no-store');
  });

  test('the probed URL is the HF API, scoped to the repo when one is known', () => {
    // Repo-scoped so the probe exercises the very endpoint a load will use,
    // rather than a CDN asset that can be up while the API is not.
    assert.equal(hubProbeUrl('Olicorne/parakeet'), `${HUB_API_ORIGIN}/api/models/Olicorne/parakeet`);
    assert.equal(hubProbeUrl(), `${HUB_API_ORIGIN}/api/models`);
    assert.equal(hubProbeUrl(undefined), `${HUB_API_ORIGIN}/api/models`);
  });

  test('a repoId reaches the request as a repo-scoped URL', async () => {
    let seen = null;
    await probeHubReachable({ repoId: 'org/model', fetchImpl: async (url) => { seen = url; return {}; } });
    assert.equal(seen, hubProbeUrl('org/model'));
  });

  test('the default timeout is well under a browser connect timeout', async () => {
    assert.ok(HUB_PROBE_TIMEOUT_MS > 0 && HUB_PROBE_TIMEOUT_MS <= 10000);
  });
});

describe('preferLocalFirst: when it is safe to skip HuggingFace entirely', () => {
  test('a definite negative reorders the sources', () => {
    assert.equal(preferLocalFirst({ modelSource: 'hf', hubReachable: false }), true);
    assert.equal(preferLocalFirst({ modelSource: 'both', hubReachable: false }), true);
  });

  test('it does NOT also require a verified local mirror', () => {
    // This used to demand proof that /models held the repo, and that condition
    // is what kept the feature from ever firing on the deployment it was built
    // for. It cannot be reinstated on the old reasoning ("do not trade a slow
    // success for a fast failure"), because once the probe says HuggingFace is
    // unreachable there is no success on that side to trade away: both orders
    // fail, and this one fails against a same-origin 404 in milliseconds
    // instead of waiting out a connect timeout. What makes it safe is that the
    // caller retries HuggingFace when the local attempt fails.
    assert.equal(preferLocalFirst({ modelSource: 'hf', hubReachable: false, localReachable: false }), true);
    assert.equal(preferLocalFirst({ modelSource: 'hf', hubReachable: false, localReachable: null }), true);
  });

  test('an unanswered or successful probe changes nothing', () => {
    // The probe never GATES a load: only a definite negative reorders anything.
    for (const hubReachable of [null, undefined, true]) {
      assert.equal(preferLocalFirst({ modelSource: 'hf', hubReachable }), false, String(hubReachable));
    }
  });

  test('a local-only instance is left alone', () => {
    // It already skips HF; answering true would only obscure why.
    assert.equal(preferLocalFirst({ modelSource: 'local', hubReachable: false }), false);
  });

  test('no arguments at all is not a reason to reorder', () => {
    assert.equal(preferLocalFirst(), false);
    assert.equal(preferLocalFirst({}), false);
  });
});
