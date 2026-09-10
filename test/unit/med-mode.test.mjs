// Tier-1 unit test for the medical dictation preset (app/ui/src/lib/medMode.js):
// the pure policy behind `?mode=med` and the sidebar's "Mode Dictée Médical"
// button. Two things are pinned here.
//
// 1. Param recognition. The param exists for links people type from memory, so
//    it accepts several doctor-facing spellings and is case- and
//    accent-insensitive. The regression that matters is the OTHER direction: an
//    unrecognised `?mode=` must return false rather than something truthy, or a
//    visitor who arrives with an unrelated mode param gets their whole machine
//    reconfigured (sticky, persisted) for a preset they never asked for.
//
// 2. The preset values themselves. They are asserted literally because the
//    failure mode of this feature is silent: a preset that applies six of its
//    seven settings still transcribes happily, just not the way the clinician
//    was promised, and no banner or console error ever says so.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MED_MODE_ALIASES,
  MED_MODE_PRESET,
  foldModeValue,
  isMedModeValue,
  medModeRequested,
} from '../../app/ui/src/lib/medMode.js';
import { MIN_CHUNK_DURATION_SEC, MAX_CHUNK_DURATION_SEC } from '../../app/src/models.js';

describe('medModeRequested: which ?mode= values ask for medical dictation mode', () => {
  test('every documented alias is recognised', () => {
    for (const alias of MED_MODE_ALIASES) {
      assert.equal(medModeRequested(`?mode=${alias}`), true, alias);
    }
  });

  test('matching is case-insensitive', () => {
    assert.equal(medModeRequested('?mode=MED'), true);
    assert.equal(medModeRequested('?mode=Doctor'), true);
    assert.equal(medModeRequested('?mode=UltiMed'), true);
  });

  test('matching is accent-insensitive, so ?mode=médecin works', () => {
    assert.equal(medModeRequested('?mode=médecin'), true);
    assert.equal(medModeRequested('?mode=Médecin'), true);
    // The same word in DECOMPOSED form (e + U+0301 combining acute), which is
    // what some keyboards and copy-pastes actually produce. It must fold to the
    // same alias, otherwise the link works for one visitor and not the next.
    assert.equal(medModeRequested('?mode=médecin'), true);
  });

  test('surrounding whitespace is tolerated', () => {
    assert.equal(medModeRequested('?mode=%20med%20'), true);
  });

  test('the param is found among other params, in any position', () => {
    assert.equal(medModeRequested('?webgpu=0&mode=med&ortep=jsep'), true);
    assert.equal(medModeRequested('mode=med'), true);
  });

  test('an unrelated or unknown mode is NOT medical mode', () => {
    // The whole point: no opinion means the visitor keeps their own settings.
    for (const v of ['', 'kiosk', 'dark', 'med2', 'x-med', 'medic', 'medicine']) {
      assert.equal(medModeRequested(`?mode=${v}`), false, v);
    }
  });

  test('no mode param at all is not medical mode', () => {
    assert.equal(medModeRequested(''), false);
    assert.equal(medModeRequested('?model=ultimed'), false);
    assert.equal(medModeRequested(undefined), false);
    assert.equal(medModeRequested(null), false);
  });

  test('a non-string value never matches', () => {
    for (const v of [null, undefined, 0, 1, {}, [], true]) {
      assert.equal(isMedModeValue(v), false, String(v));
    }
    assert.equal(foldModeValue(42), '');
  });
});

describe('MED_MODE_PRESET: the station the preset actually configures', () => {
  test('pins the medical model query, resolved against the offered repos', () => {
    // Deliberately a QUERY for matchModelRepo, not a repo id: the preset has to
    // resolve against whatever the operator put in VITE_MODEL_REPO.
    assert.equal(MED_MODE_PRESET.modelQuery, 'ultimed');
  });

  test('pins the French medical phrase list', () => {
    assert.equal(MED_MODE_PRESET.boostSource, 'french_medical.txt');
    // The boost-source selector only ever offers manifest entries, which all
    // end in .txt; a name without it would silently fall through to Custom.
    assert.ok(MED_MODE_PRESET.boostSource.endsWith('.txt'));
  });

  test('pins 30 s chunking, within the range the app accepts', () => {
    assert.equal(MED_MODE_PRESET.enableChunking, true);
    assert.equal(MED_MODE_PRESET.chunkDurationSec, 30);
    assert.ok(MED_MODE_PRESET.chunkDurationSec >= MIN_CHUNK_DURATION_SEC);
    assert.ok(MED_MODE_PRESET.chunkDurationSec <= MAX_CHUNK_DURATION_SEC);
  });

  test('pins the dictation display and a French UI', () => {
    assert.equal(MED_MODE_PRESET.transcriptDisplayMode, 'dictation');
    assert.equal(MED_MODE_PRESET.lang, 'fr');
  });

  test('turns auto-copy ON, the one default it flips rather than restores', () => {
    // Asserted explicitly because it is the preset's only privacy-relevant
    // value: auto-copy ships OFF (the system clipboard is readable by other
    // apps), and a dictation station trades that for the dictate-then-paste
    // workflow. Flipping it back to false must be a deliberate edit here, not
    // something that can drift in unnoticed.
    assert.equal(MED_MODE_PRESET.autoCopyToClipboard, true);
  });

  test('pins one precision per backend, each runnable on that backend', () => {
    // int8 has no WebGPU kernel and fp16 has no WASM one, so these two cannot
    // be swapped: this is the pairing, not a preference.
    assert.equal(MED_MODE_PRESET.wasmEncoderQuant, 'int8');
    assert.equal(MED_MODE_PRESET.webgpuEncoderQuant, 'fp16');
  });

  test('carries no phrase-boost tuning knobs', () => {
    // Those are "the app's own defaults" and are re-asserted by the applier from
    // the constants that own them. A copy here is how the two drift apart.
    assert.equal('boostStrength' in MED_MODE_PRESET, false);
    assert.equal('boostMinp' in MED_MODE_PRESET, false);
    assert.equal('boostDepthScaling' in MED_MODE_PRESET, false);
  });

  test('is frozen, so no caller can mutate the shared preset', () => {
    assert.ok(Object.isFrozen(MED_MODE_PRESET));
    assert.ok(Object.isFrozen(MED_MODE_ALIASES));
  });
});
