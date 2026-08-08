// Pure policy for restoring the persisted long-audio chunk window (seconds).
//
// History: the default chunk window was 20 s (range clamped to [10, 25])
// under the belief that Parakeet quality degrades past ~25 s per chunk. A
// 2026-08 measured grid over long audio showed the opposite (bigger windows
// are slightly better; every stitch seam costs a little), so the default is
// now DEFAULT_CHUNK_DURATION_SEC (60 s) with a [10, 90] range (models.js).
//
// Because usePersistedSetting writes every setting's value back on first
// boot, existing installs have the OLD 20 s default persisted even though
// the user never touched the field. restoreChunkDuration therefore performs
// a ONE-TIME migration: a stored value that exactly equals the legacy
// default is rescued to the current default. The `migrated` flag (persisted
// by the caller, same pattern as lib/cpuThreads.js) makes this run only
// once, so a user who deliberately re-picks 20 s afterwards keeps it.
//
// Built with Claude Code.

import { DEFAULT_CHUNK_DURATION_SEC, MIN_CHUNK_DURATION_SEC, MAX_CHUNK_DURATION_SEC } from '../../../src/models.js';

// The pre-2026-08 default the migration rescues. Lives here, not in
// models.js: it is a persistence artifact, not part of the current model
// configuration.
export const LEGACY_DEFAULT_CHUNK_DURATION_SEC = 20;

/**
 * Decide the chunk window to restore from a persisted value.
 * @param {object} args
 * @param {number|null} args.stored Persisted seconds, or null when never set.
 * @param {boolean} args.migrated Whether the one-time legacy-default migration already ran.
 * @returns {{duration: number|null, migrationApplied: boolean}} duration null
 *   means "keep the caller's initial default" (nothing usable was stored).
 */
export function restoreChunkDuration({ stored, migrated }) {
  if (typeof stored !== 'number' || !Number.isFinite(stored)) {
    return { duration: null, migrationApplied: false };
  }
  if (!migrated && stored === LEGACY_DEFAULT_CHUNK_DURATION_SEC) {
    return { duration: DEFAULT_CHUNK_DURATION_SEC, migrationApplied: true };
  }
  const clamped = Math.max(MIN_CHUNK_DURATION_SEC, Math.min(MAX_CHUNK_DURATION_SEC, stored));
  return { duration: clamped, migrationApplied: false };
}
