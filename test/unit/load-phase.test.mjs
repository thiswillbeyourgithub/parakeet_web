// Tier-1 cover for the model-load phase set and its timing line.
//
// Both halves exist because "Loading model" used to mean three different
// things. The set is what keeps the six App.jsx gates that ask "is a load in
// flight?" from having to learn about a new phase one by one; the formatter is
// what makes a slow load diagnosable without a rerun, which it stops being the
// moment a cache hit and an unknown transfer print the same way.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { MODEL_LOAD_STATUSES, isModelLoading, formatLoadTiming } from '../../app/ui/src/lib/loadPhase.js';

describe('isModelLoading', () => {
  test('every declared phase counts as loading', () => {
    for (const s of MODEL_LOAD_STATUSES) assert.equal(isModelLoading(s), true, s);
  });

  test('the three phases are the download-aware set, in phase order', () => {
    assert.deepEqual(MODEL_LOAD_STATUSES, ['loadingModel', 'downloadingModel', 'creatingSessions']);
  });

  test('a settled or absent status is not loading', () => {
    for (const s of ['idle', 'modelReady', 'failed', 'transcriptionFailed', '', undefined, null]) {
      assert.equal(isModelLoading(s), false, String(s));
    }
  });
});

describe('formatLoadTiming', () => {
  test('a cold multi-minute load names the bytes and both phases', () => {
    assert.equal(
      formatLoadTiming({ totalMs: 552000, fetchMs: 544000, sessionMs: 8100, bytes: 2331e6 }),
      '[Load] ready in 9m12s: fetch 9m04s (2331 MB), sessions 8.1s',
    );
  });

  test('zero bytes reads as cached, not as a 0 MB download', () => {
    assert.match(formatLoadTiming({ totalMs: 4200, fetchMs: 300, sessionMs: 3900, bytes: 0 }), /\(cached\)/);
  });

  test('unknown transfer is distinct from cached', () => {
    // The dangerous confusion: a driver that reports nothing must not be read
    // as having proved the load was warm.
    const unknown = formatLoadTiming({ totalMs: 4200, fetchMs: 300, sessionMs: 3900 });
    assert.match(unknown, /transfer unknown/);
    assert.doesNotMatch(unknown, /cached/);
  });

  test('under a minute keeps a decimal, over a minute switches to m/ss', () => {
    assert.match(formatLoadTiming({ totalMs: 59900, fetchMs: 0, sessionMs: 0, bytes: 0 }), /ready in 59\.9s/);
    assert.match(formatLoadTiming({ totalMs: 60000, fetchMs: 0, sessionMs: 0, bytes: 0 }), /ready in 1m00s/);
    assert.match(formatLoadTiming({ totalMs: 3600000, fetchMs: 0, sessionMs: 0, bytes: 0 }), /ready in 60m00s/);
  });

  test('missing or negative durations degrade to ? rather than NaN', () => {
    const out = formatLoadTiming({ bytes: 0 });
    assert.match(out, /ready in \?/);
    assert.doesNotMatch(out, /NaN/);
    assert.match(formatLoadTiming({ totalMs: -1, fetchMs: 0, sessionMs: 0, bytes: 0 }), /ready in \?/);
  });
});
