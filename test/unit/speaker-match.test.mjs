// Unit coverage for the pure cross-recording speaker-matching logic
// (app/ui/src/lib/speakerMatch.js): cosine similarity, name-profile centroids
// derived from embeddings + user names, threshold matching, and the
// auto-naming that fills a new recording's speakers from prior recordings.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity,
  buildProfiles,
  matchProfile,
  autoNameSpeakers,
} from '../../app/ui/src/lib/speakerMatch.js';

// Small, well-separated synthetic voiceprints (the real ones are 192-dim).
const ALICE = [1, 0, 0];
const ALICE2 = [0.9, 0.1, 0]; // same voice, slightly different recording
const BOB = [0, 1, 0];
const CAROL = [0, 0, 1];

describe('cosineSimilarity', () => {
  test('identical vectors -> 1, orthogonal -> 0', () => {
    assert.ok(Math.abs(cosineSimilarity(ALICE, ALICE) - 1) < 1e-9);
    assert.ok(Math.abs(cosineSimilarity(ALICE, BOB)) < 1e-9);
  });
  test('mismatched length or empty -> 0', () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
    assert.equal(cosineSimilarity(null, ALICE), 0);
    assert.equal(cosineSimilarity([0, 0, 0], ALICE), 0);
  });
});

describe('buildProfiles', () => {
  test('groups embeddings by name into per-name centroids', () => {
    const embeddings = {
      r1: { 0: ALICE, 1: BOB },
      r2: { 0: ALICE2 },
    };
    const names = {
      r1: { 0: 'Alice', 1: 'Bob' },
      r2: { 0: 'Alice' },
    };
    const profiles = buildProfiles(embeddings, names);
    const alice = profiles.find((p) => p.name === 'Alice');
    const bob = profiles.find((p) => p.name === 'Bob');
    assert.equal(profiles.length, 2);
    assert.equal(alice.count, 2);
    assert.equal(bob.count, 1);
    // Alice centroid is the mean of ALICE and ALICE2.
    assert.ok(Math.abs(alice.centroid[0] - 0.95) < 1e-6);
    assert.ok(Math.abs(alice.centroid[1] - 0.05) < 1e-6);
  });

  test('ignores speakers with no name and trims name keys', () => {
    const embeddings = { r1: { 0: ALICE, 1: BOB } };
    const names = { r1: { 0: '  Alice  ', 1: '' } };
    const profiles = buildProfiles(embeddings, names);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].name, 'Alice');
  });

  test('excludeEntryId omits that recording', () => {
    const embeddings = { r1: { 0: ALICE }, r2: { 0: BOB } };
    const names = { r1: { 0: 'Alice' }, r2: { 0: 'Bob' } };
    const profiles = buildProfiles(embeddings, names, 'r2');
    assert.deepEqual(profiles.map((p) => p.name), ['Alice']);
  });
});

describe('matchProfile', () => {
  const profiles = [
    { name: 'Alice', centroid: ALICE },
    { name: 'Bob', centroid: BOB },
  ];
  test('returns the best match above threshold', () => {
    const m = matchProfile(ALICE2, profiles, 0.5);
    assert.equal(m.name, 'Alice');
    assert.ok(m.score > 0.9);
  });
  test('returns null when nothing clears the threshold', () => {
    assert.equal(matchProfile(CAROL, profiles, 0.5), null);
  });
  test('empty profiles or embedding -> null', () => {
    assert.equal(matchProfile(ALICE, [], 0.5), null);
    assert.equal(matchProfile([], profiles, 0.5), null);
  });
});

describe('autoNameSpeakers', () => {
  test('labels a new recording from prior recordings, only unnamed speakers', () => {
    const embeddings = {
      r1: { 0: ALICE, 1: BOB }, // named below
      r2: { 0: ALICE2, 1: CAROL }, // new recording: speaker 0 == Alice, 1 unknown
    };
    const names = {
      r1: { 0: 'Alice', 1: 'Bob' },
      r2: {},
    };
    const assigned = autoNameSpeakers('r2', embeddings, names, 0.5);
    assert.deepEqual(assigned, { 0: 'Alice' }); // speaker 1 (Carol) has no match
  });

  test('does not overwrite a name the user already set on this entry', () => {
    const embeddings = { r1: { 0: ALICE }, r2: { 0: ALICE2 } };
    const names = { r1: { 0: 'Alice' }, r2: { 0: 'Boss' } };
    const assigned = autoNameSpeakers('r2', embeddings, names, 0.5);
    assert.deepEqual(assigned, {}); // speaker 0 already named "Boss"
  });

  test('no prior profiles -> nothing assigned', () => {
    const embeddings = { r1: { 0: ALICE, 1: BOB } };
    const names = { r1: {} };
    assert.deepEqual(autoNameSpeakers('r1', embeddings, names, 0.5), {});
  });
});
