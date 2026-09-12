// Covers the two pure helpers in lib/boostConfig.js. Both were inline in
// App.jsx until the usePhraseBoost extraction, i.e. reachable only through the
// UI, so this is their first direct coverage.
//
// normalizeBoostName decides what a ?phrase_boost= link or a
// VITE_PHRASE_BOOST_DEFAULT env value means, and boostBuildKey is the identity
// waitForBoostReady() compares against to decide whether a transcription may
// start; a silent change in either is a wrong-transcript bug, not a cosmetic
// one.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBoostName,
  boostBuildKey,
  BOOST_SOURCE_CUSTOM,
  BOOST_SOURCE_DISABLED,
  BOOST_MINP_DEFAULT,
  BOOST_STRENGTH_DEFAULT,
  BOOST_COLLAPSE_MIN_LINES,
  BOOST_CUSTOM_COLLAPSE_MIN_LINES,
} from '../../app/ui/src/lib/boostConfig.js';

describe('normalizeBoostName', () => {
  test('a bare name gains the .txt the manifest entries all carry', () => {
    assert.equal(normalizeBoostName('medical'), 'medical.txt');
    assert.equal(normalizeBoostName('french_medical'), 'french_medical.txt');
  });

  test('a name that already ends in .txt is left alone', () => {
    assert.equal(normalizeBoostName('medical.txt'), 'medical.txt');
  });

  test('surrounding whitespace is trimmed before the extension check', () => {
    assert.equal(normalizeBoostName('  medical  '), 'medical.txt');
    assert.equal(normalizeBoostName('\tmedical.txt\n'), 'medical.txt');
  });

  test('both sentinels pass through untouched, so ?phrase_boost=__custom__ '
    + 'forces manual entry instead of asking for a "__custom__.txt" file', () => {
    assert.equal(normalizeBoostName(BOOST_SOURCE_CUSTOM), BOOST_SOURCE_CUSTOM);
    assert.equal(normalizeBoostName(BOOST_SOURCE_DISABLED), BOOST_SOURCE_DISABLED);
  });

  test('an empty, blank or non-string value is null (no opinion), never a '
    + 'name: null is what lets a saved choice stand', () => {
    assert.equal(normalizeBoostName(''), null);
    assert.equal(normalizeBoostName('   '), null);
    assert.equal(normalizeBoostName(null), null);
    assert.equal(normalizeBoostName(undefined), null);
    assert.equal(normalizeBoostName(42), null);
  });
});

describe('boostBuildKey', () => {
  test('every input that forces a rebuild changes the key', () => {
    const base = boostBuildKey('venlafaxine', 1, 'sig-a');
    assert.notEqual(base, boostBuildKey('venlafaxin', 1, 'sig-a'));
    assert.notEqual(base, boostBuildKey('venlafaxine', 2, 'sig-a'));
    assert.notEqual(base, boostBuildKey('venlafaxine', 1, 'sig-b'));
  });

  test('the same config is the same key, so a waiter can compare by value', () => {
    assert.equal(boostBuildKey('a\nb', 1.5, 'sig'), boostBuildKey('a\nb', 1.5, 'sig'));
  });

  test('a missing vocab signature is a distinct, stable value rather than '
    + 'undefined: the no-model parse-only pass stamps a key too', () => {
    assert.equal(boostBuildKey('a', 1, null), boostBuildKey('a', 1, undefined));
    assert.match(boostBuildKey('a', 1, null), /^no-vocab\|/);
    assert.notEqual(boostBuildKey('a', 1, null), boostBuildKey('a', 1, 'no-vocab-really'));
  });

  test('the phrase text goes last, so a text containing the separator cannot '
    + 'forge the key of another vocab or depth scaling', () => {
    assert.notEqual(boostBuildKey('x', 1, 'sigA'), boostBuildKey('1|x', 1, 'sigA'));
    assert.equal(boostBuildKey('a|b', 1, 'sig'), 'sig|1|a|b');
  });
});

describe('boost defaults and thresholds', () => {
  test('the min-p default sits strictly inside [0, 1], where 1 would disable '
    + 'boosting outright and 0 would gate nothing', () => {
    assert.ok(BOOST_MINP_DEFAULT > 0 && BOOST_MINP_DEFAULT < 1);
  });

  test('the strength default applies each phrase weight as written (1), not 0 '
    + 'which disables boosting', () => {
    assert.equal(BOOST_STRENGTH_DEFAULT, 1);
  });

  test("the Custom collapse threshold is well above the curated one, so an "
    + "ordinary hand-written list is never hidden", () => {
    assert.ok(BOOST_CUSTOM_COLLAPSE_MIN_LINES >= 10 * BOOST_COLLAPSE_MIN_LINES);
  });

  test('the two source sentinels are distinct and neither is a manifest entry', () => {
    assert.notEqual(BOOST_SOURCE_CUSTOM, BOOST_SOURCE_DISABLED);
    assert.ok(!BOOST_SOURCE_CUSTOM.endsWith('.txt'));
    assert.ok(!BOOST_SOURCE_DISABLED.endsWith('.txt'));
  });
});
