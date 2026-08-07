// Tier-1 unit test for the auto-coupled beam width policy
// (app/ui/src/lib/beamWidth.js): restoreBeamWidthAuto decides whether the
// width is still coupled to the boost state (including the legacy-install
// inference for profiles that predate the beamWidthAuto flag), and
// resolveAutoBeamWidth maps boost state -> width. The behavioural rationale
// (beam helps WITH a phrase list, hurts without) comes from the 2026-08
// French-medical grid sweep. Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { restoreBeamWidthAuto, resolveAutoBeamWidth } from '../../app/ui/src/lib/beamWidth.js';

describe('restoreBeamWidthAuto', () => {
  test('fresh install (nothing saved) is auto', () => {
    assert.equal(restoreBeamWidthAuto({ savedAuto: null, savedBeamWidth: null, deviceDefault: 5 }), true);
  });

  test('explicit flag wins over any saved width', () => {
    // User chose a width (auto off), even one equal to the device default.
    assert.equal(restoreBeamWidthAuto({ savedAuto: false, savedBeamWidth: 5, deviceDefault: 5 }), false);
    // Auto stayed on even though a width value was persisted alongside it
    // (usePersistedSetting writes the resolved value back on every boot).
    assert.equal(restoreBeamWidthAuto({ savedAuto: true, savedBeamWidth: 1, deviceDefault: 5 }), true);
  });

  test('legacy install: width equal to the device default = never chosen = auto', () => {
    assert.equal(restoreBeamWidthAuto({ savedAuto: null, savedBeamWidth: 5, deviceDefault: 5 }), true);
    assert.equal(restoreBeamWidthAuto({ savedAuto: null, savedBeamWidth: 2, deviceDefault: 2 }), true);
  });

  test('legacy install: any other width was picked on purpose and is honoured', () => {
    assert.equal(restoreBeamWidthAuto({ savedAuto: null, savedBeamWidth: 8, deviceDefault: 5 }), false);
    assert.equal(restoreBeamWidthAuto({ savedAuto: null, savedBeamWidth: 1, deviceDefault: 5 }), false);
  });

  test('garbage saved values fall back to auto', () => {
    assert.equal(restoreBeamWidthAuto({ savedAuto: 'yes', savedBeamWidth: 'wide', deviceDefault: 5 }), true);
    assert.equal(restoreBeamWidthAuto({ savedAuto: undefined, savedBeamWidth: NaN, deviceDefault: 5 }), true);
  });
});

describe('resolveAutoBeamWidth', () => {
  test('no active boost decodes greedy', () => {
    assert.equal(resolveAutoBeamWidth(false, 5), 1);
    assert.equal(resolveAutoBeamWidth(false, 1), 1);
  });

  test('active boost uses the device-tier default', () => {
    assert.equal(resolveAutoBeamWidth(true, 5), 5);
    assert.equal(resolveAutoBeamWidth(true, 2), 2);
    assert.equal(resolveAutoBeamWidth(true, 1), 1); // phones stay greedy
  });

  test('a broken device default never yields an invalid width', () => {
    assert.equal(resolveAutoBeamWidth(true, 0), 1);
    assert.equal(resolveAutoBeamWidth(true, NaN), 1);
    assert.equal(resolveAutoBeamWidth(true, undefined), 1);
  });
});
