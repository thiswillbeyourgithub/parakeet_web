// Tier-1 unit test for restoreChunkDuration() (app/ui/src/lib/chunkDuration.js):
// the pure policy App.jsx uses to restore the persisted long-audio chunk
// window. The regression this pins: usePersistedSetting writes every default
// back on first boot, so every install predating the 20 s -> 60 s default bump
// (commit 8bdfc30) holds a persisted chunkDuration=20 and would silently keep
// the worse window forever. The one-time migration rescues exactly that value
// to the current default, and the migrated flag guarantees a user who
// deliberately re-picks 20 s afterwards keeps it (same contract as the
// cpuThreads legacy-default rescue). Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { restoreChunkDuration, LEGACY_DEFAULT_CHUNK_DURATION_SEC } from '../../app/ui/src/lib/chunkDuration.js';
import { DEFAULT_CHUNK_DURATION_SEC, MIN_CHUNK_DURATION_SEC, MAX_CHUNK_DURATION_SEC } from '../../app/src/models.js';

describe('restoreChunkDuration: persisted chunk-window restore + legacy-default migration', () => {
  test('rescues the legacy 20 s default to the current default exactly once', () => {
    const r = restoreChunkDuration({ stored: LEGACY_DEFAULT_CHUNK_DURATION_SEC, migrated: false });
    assert.equal(r.duration, DEFAULT_CHUNK_DURATION_SEC);
    assert.equal(r.migrationApplied, true);
  });

  test('a deliberate post-migration 20 s choice is honoured', () => {
    const r = restoreChunkDuration({ stored: LEGACY_DEFAULT_CHUNK_DURATION_SEC, migrated: true });
    assert.equal(r.duration, LEGACY_DEFAULT_CHUNK_DURATION_SEC);
    assert.equal(r.migrationApplied, false);
  });

  test('any non-legacy stored value is kept as-is (no migration), pre- or post-flag', () => {
    for (const migrated of [false, true]) {
      const r = restoreChunkDuration({ stored: 30, migrated });
      assert.equal(r.duration, 30);
      assert.equal(r.migrationApplied, false);
    }
  });

  test('stored values are clamped to the allowed range', () => {
    assert.equal(restoreChunkDuration({ stored: 5, migrated: true }).duration, MIN_CHUNK_DURATION_SEC);
    assert.equal(restoreChunkDuration({ stored: 500, migrated: true }).duration, MAX_CHUNK_DURATION_SEC);
  });

  test('never-set and garbage values restore nothing (caller keeps its initial default)', () => {
    for (const stored of [null, undefined, NaN, Infinity, 'twenty']) {
      const r = restoreChunkDuration({ stored, migrated: false });
      assert.equal(r.duration, null, `stored=${String(stored)}`);
      assert.equal(r.migrationApplied, false);
    }
  });

  test('the legacy constant is the old default, distinct from the current one', () => {
    // If someone ever changes DEFAULT_CHUNK_DURATION_SEC back to 20 the
    // migration would become a no-op loop; this canary makes that explicit.
    assert.equal(LEGACY_DEFAULT_CHUNK_DURATION_SEC, 20);
    assert.notEqual(LEGACY_DEFAULT_CHUNK_DURATION_SEC, DEFAULT_CHUNK_DURATION_SEC);
  });
});
