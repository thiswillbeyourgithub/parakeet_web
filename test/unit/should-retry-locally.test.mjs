// Tier-1 unit test for shouldRetryLocally (app/src/hub.js): the pure policy that
// decides whether a failed HuggingFace model load should silently retry against
// the locally-served /models weights instead of crashing. The default 'hf'
// source must recover when local weights are actually present (probe ok), the
// operator-configured local/both source must retry unconditionally, and neither
// may loop after a local attempt already failed.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRetryLocally } from '../../app/src/hub.js';

describe('shouldRetryLocally', () => {
  test('default hf source + HF error + local files present -> retry (the new "do not crash" behaviour)', () => {
    assert.equal(shouldRetryLocally({ isHubError: true, alreadyLocal: false, localConfigured: false, localReachable: true }), true);
  });

  test('default hf source + HF error + NO local files -> do not retry (surface the real HF error)', () => {
    assert.equal(shouldRetryLocally({ isHubError: true, alreadyLocal: false, localConfigured: false, localReachable: false }), false);
  });

  test('operator-configured local fallback retries unconditionally (no probe needed)', () => {
    assert.equal(shouldRetryLocally({ isHubError: true, alreadyLocal: false, localConfigured: true, localReachable: false }), true);
  });

  test('a local attempt that already failed never loops back to local', () => {
    assert.equal(shouldRetryLocally({ isHubError: true, alreadyLocal: true, localConfigured: true, localReachable: true }), false);
  });

  test('a non-HF error is never redirected to local (real bug should surface)', () => {
    assert.equal(shouldRetryLocally({ isHubError: false, alreadyLocal: false, localConfigured: true, localReachable: true }), false);
  });
});
