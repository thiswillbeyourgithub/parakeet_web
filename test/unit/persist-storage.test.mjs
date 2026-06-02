// Tier-1 unit test for requestPersistentStorage (app/ui/src/lib/persistStorage.js).
// Verifies the helper degrades gracefully when the Storage API is missing,
// skips re-requesting an already-granted persistence, and never throws.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requestPersistentStorage } from '../../app/ui/src/lib/persistStorage.js';

describe('requestPersistentStorage', () => {
  test('returns null when navigator is absent', async () => {
    assert.equal(await requestPersistentStorage(undefined), null);
  });

  test('returns null when navigator.storage is absent', async () => {
    assert.equal(await requestPersistentStorage({}), null);
  });

  test('returns null when persist() is unavailable', async () => {
    assert.equal(await requestPersistentStorage({ storage: {} }), null);
  });

  test('returns true and does NOT call persist() when already persisted', async () => {
    let persistCalled = false;
    const nav = {
      storage: {
        persisted: async () => true,
        persist: async () => { persistCalled = true; return false; },
      },
    };
    assert.equal(await requestPersistentStorage(nav), true);
    assert.equal(persistCalled, false);
  });

  test('calls persist() when not yet persisted and returns its result', async () => {
    let persistCalled = false;
    const nav = {
      storage: {
        persisted: async () => false,
        persist: async () => { persistCalled = true; return true; },
      },
    };
    assert.equal(await requestPersistentStorage(nav), true);
    assert.equal(persistCalled, true);
  });

  test('works without a persisted() method (calls persist directly)', async () => {
    const nav = { storage: { persist: async () => true } };
    assert.equal(await requestPersistentStorage(nav), true);
  });

  test('returns null (not throw) when persist() rejects', async () => {
    const nav = {
      storage: {
        persisted: async () => false,
        persist: async () => { throw new Error('denied'); },
      },
    };
    assert.equal(await requestPersistentStorage(nav), null);
  });

  test('returns false when the browser declines persistence', async () => {
    const nav = {
      storage: {
        persisted: async () => false,
        persist: async () => false,
      },
    };
    assert.equal(await requestPersistentStorage(nav), false);
  });
});
