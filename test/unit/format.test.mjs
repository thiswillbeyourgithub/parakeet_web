// Tier-1 unit test for the pure display formatters (app/ui/src/lib/format.js).
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatDuration, formatBytes } from '../../app/ui/src/lib/format.js';

describe('formatTime (m:ss)', () => {
  test('zero', () => assert.equal(formatTime(0), '0:00'));
  test('pads single-digit seconds', () => assert.equal(formatTime(65), '1:05'));
  test('exact minute', () => assert.equal(formatTime(60), '1:00'));
  test('keeps two-digit seconds', () => assert.equal(formatTime(119), '1:59'));
});

describe('formatDuration', () => {
  test('sub-minute keeps one decimal', () => assert.equal(formatDuration(0.5), '0.5s'));
  test('30s -> 30.0s', () => assert.equal(formatDuration(30), '30.0s'));
  test('90s -> 1m30s', () => assert.equal(formatDuration(90), '1m30s'));
  test('3725s -> 1h2m5s', () => assert.equal(formatDuration(3725), '1h2m5s'));
  test('exact hour keeps zero sub-units', () => assert.equal(formatDuration(3600), '1h0m0s'));
  test('negative / non-finite -> 0s', () => {
    assert.equal(formatDuration(-1), '0s');
    assert.equal(formatDuration(NaN), '0s');
    assert.equal(formatDuration(Infinity), '0s');
  });
});

describe('formatBytes (base 1024)', () => {
  test('bytes below 1 KiB', () => assert.equal(formatBytes(512), '512 B'));
  test('KB rounds to integer', () => assert.equal(formatBytes(2048), '2 KB'));
  test('MB keeps one decimal', () => assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB'));
  test('GB keeps two decimals', () => assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.00 GB'));
  test('negative / non-finite -> 0 B', () => {
    assert.equal(formatBytes(-1), '0 B');
    assert.equal(formatBytes(NaN), '0 B');
  });
});
