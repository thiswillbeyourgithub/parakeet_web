// Tier-1 unit test for app/ui/src/lib/ortRuntimeSwitch.js: when a model load
// reloads the page to change the main thread's ORT runtime, and the loop guard
// that stops it reloading forever.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ORT_RELOAD_KEY,
  planOrtRuntimeSwitch,
  readPendingOrtReload,
  writePendingOrtReload,
  clearPendingOrtReload,
} from '../../app/ui/src/lib/ortRuntimeSwitch.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

describe('planOrtRuntimeSwitch', () => {
  test('the live runtime serves the backend: just load', () => {
    assert.deepEqual(planOrtRuntimeSwitch({ serves: true, backend: 'wasm', pending: null }), { action: 'load' });
    // A stale marker for the same backend changes nothing when it serves.
    assert.deepEqual(planOrtRuntimeSwitch({ serves: true, backend: 'wasm', pending: { backend: 'wasm' } }), { action: 'load' });
  });

  test('a mismatch reloads', () => {
    assert.deepEqual(planOrtRuntimeSwitch({ serves: false, backend: 'wasm', pending: null }), { action: 'reload' });
    // A marker for ANOTHER backend is an earlier switch, not this one.
    assert.deepEqual(planOrtRuntimeSwitch({ serves: false, backend: 'wasm', pending: { backend: 'webgpu-hybrid' } }),
      { action: 'reload' });
  });

  test('a mismatch right after reloading for the same backend loads anyway (no reload loop)', () => {
    assert.deepEqual(planOrtRuntimeSwitch({ serves: false, backend: 'wasm', pending: { backend: 'wasm' } }),
      { action: 'load', loopGuard: true });
  });
});

describe('pending-reload marker', () => {
  test('round-trips and clears', () => {
    const s = memStorage();
    assert.equal(readPendingOrtReload(s), null);
    writePendingOrtReload(s, 'webgpu-hybrid');
    assert.deepEqual(readPendingOrtReload(s), { backend: 'webgpu-hybrid' });
    clearPendingOrtReload(s);
    assert.equal(readPendingOrtReload(s), null);
  });

  test('garbage, missing storage and throwing storage all read as no marker', () => {
    const s = memStorage();
    s.setItem(ORT_RELOAD_KEY, '{not json');
    assert.equal(readPendingOrtReload(s), null);
    s.setItem(ORT_RELOAD_KEY, '{"backend":3}');
    assert.equal(readPendingOrtReload(s), null);
    assert.equal(readPendingOrtReload(undefined), null);
    const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
    assert.equal(readPendingOrtReload(throwing), null);
    writePendingOrtReload(throwing, 'wasm');
    clearPendingOrtReload(throwing);
  });
});
