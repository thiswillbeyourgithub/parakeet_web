// Unit tests for the pure draw-order logic of scripts/gen-medical-val-sets.mjs:
// the iteration order IS the sampling strategy (seeded shuffle = uniform random
// draw, duration-descending = top-N-longest for the long-audio chunk-grid
// sets), so this pins both orders and their determinism.
//
// Built with Claude Code.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drawOrder } from '../../scripts/gen-medical-val-sets.mjs';
import { mulberry32 } from '../../scripts/lib/sample.mjs';

const clip = (file, duration) => ({ audio_filepath: file, duration });

describe('drawOrder: sampling strategy of gen-medical-val-sets', () => {
  test('longest mode orders by duration descending', () => {
    const entries = [clip('a', 10), clip('b', 70), clip('c', 40)];
    assert.deepEqual(drawOrder(entries, { longest: true }).map((e) => e.audio_filepath),
      ['b', 'c', 'a']);
  });

  test('longest mode breaks duration ties by path, so it is deterministic without an rng', () => {
    const entries = [clip('z', 30), clip('a', 30), clip('m', 30)];
    assert.deepEqual(drawOrder(entries, { longest: true }).map((e) => e.audio_filepath),
      ['a', 'm', 'z']);
  });

  test('longest mode treats a missing duration as 0 and never mutates its input', () => {
    const entries = [clip('a', undefined), clip('b', 5)];
    const before = entries.map((e) => e.audio_filepath);
    assert.deepEqual(drawOrder(entries, { longest: true }).map((e) => e.audio_filepath),
      ['b', 'a']);
    assert.deepEqual(entries.map((e) => e.audio_filepath), before);
  });

  test('random mode is a seed-deterministic permutation, not duration-ordered', () => {
    const entries = Array.from({ length: 32 }, (_, i) => clip(`f${i}`, i));
    const once = drawOrder(entries, { rng: mulberry32(1234) }).map((e) => e.audio_filepath);
    const twice = drawOrder(entries, { rng: mulberry32(1234) }).map((e) => e.audio_filepath);
    assert.deepEqual(once, twice);
    assert.deepEqual([...once].sort(), entries.map((e) => e.audio_filepath).sort());
    assert.notDeepEqual(once, drawOrder(entries, { longest: true }).map((e) => e.audio_filepath));
  });
});
