// Tier-1 unit test for the pure display formatters (app/ui/src/lib/format.js).
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, formatDuration, formatBytes, formatRate, formatEta, updateDownloadRate, relativeAge, formatMetricsTooltip } from '../../app/ui/src/lib/format.js';

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

describe('formatMetricsTooltip', () => {
  const LABELS = {
    encode: 'Encode',
    decode: 'Decode',
    decodePerDur: 'Decode / duration',
    encodeDecodePerDur: '(Encode + decode) / duration',
    total: 'Total',
  };

  test('lists encode/decode/total times and both ratios', () => {
    // encode 2.0 s, decode 0.5 s, total 3.0 s over a 10 s clip.
    const tip = formatMetricsTooltip(
      { encode_ms: 2000, decode_ms: 500, total_ms: 3000 }, 10, LABELS);
    assert.equal(tip, [
      'Encode: 2.00 s',
      'Decode: 0.50 s',
      'Decode / duration: 0.05',          // 0.5 / 10
      '(Encode + decode) / duration: 0.25', // 2.5 / 10
      'Total: 3.00 s',
    ].join('\n'));
  });

  test('omits the ratio lines when duration is unknown (0)', () => {
    const tip = formatMetricsTooltip(
      { encode_ms: 2000, decode_ms: 500, total_ms: 3000 }, 0, LABELS);
    assert.equal(tip, ['Encode: 2.00 s', 'Decode: 0.50 s', 'Total: 3.00 s'].join('\n'));
  });

  test('missing stage fields read as zero', () => {
    const tip = formatMetricsTooltip({ total_ms: 1000 }, 10, LABELS);
    assert.equal(tip, [
      'Encode: 0.00 s',
      'Decode: 0.00 s',
      'Decode / duration: 0.00',
      '(Encode + decode) / duration: 0.00',
      'Total: 1.00 s',
    ].join('\n'));
  });

  test('returns empty string when there are no metrics', () => {
    assert.equal(formatMetricsTooltip(null, 10, LABELS), '');
    assert.equal(formatMetricsTooltip(undefined, 10, LABELS), '');
  });
});

describe('formatRate (<size>/s)', () => {
  test('formats MB/s', () => assert.equal(formatRate(5 * 1024 * 1024), '5.0 MB/s'));
  test('formats KB/s', () => assert.equal(formatRate(2048), '2 KB/s'));
  test('zero / negative / non-finite -> empty', () => {
    assert.equal(formatRate(0), '');
    assert.equal(formatRate(-1), '');
    assert.equal(formatRate(NaN), '');
    assert.equal(formatRate(null), '');
  });
});

describe('formatEta (MM:SS)', () => {
  test('zero', () => assert.equal(formatEta(0), '00:00'));
  test('pads single digits', () => assert.equal(formatEta(65), '01:05'));
  test('rounds fractional seconds', () => assert.equal(formatEta(89.6), '01:30'));
  test('hours roll into minutes', () => assert.equal(formatEta(3725), '62:05'));
  test('negative / non-finite / null -> empty', () => {
    assert.equal(formatEta(-1), '');
    assert.equal(formatEta(NaN), '');
    assert.equal(formatEta(Infinity), '');
    assert.equal(formatEta(null), '');
  });
});

describe('updateDownloadRate (EMA speed + ETA)', () => {
  const MB = 1024 * 1024;

  test('first sample anchors with no rate yet', () => {
    const r = updateDownloadRate(null, { file: 'a', loaded: 0, total: 10 * MB, now: 0 });
    assert.equal(r.rate, null);
    assert.equal(r.eta, null);
    assert.equal(r.state.file, 'a');
    assert.equal(r.state.anchorLoaded, 0);
  });

  test('measures rate once minInterval elapses and computes ETA', () => {
    let s = updateDownloadRate(null, { file: 'a', loaded: 0, total: 10 * MB, now: 0 }).state;
    // 1 MB over 1000 ms -> 1 MB/s, 9 MB left -> 9 s ETA.
    const r = updateDownloadRate(s, { file: 'a', loaded: 1 * MB, total: 10 * MB, now: 1000 });
    assert.equal(r.rate, MB);
    assert.equal(r.eta, 9);
  });

  test('holds last rate but reticks ETA between samples (dt < minInterval)', () => {
    let s = updateDownloadRate(null, { file: 'a', loaded: 0, total: 10 * MB, now: 0 }).state;
    s = updateDownloadRate(s, { file: 'a', loaded: 1 * MB, total: 10 * MB, now: 1000 }).state;
    // 50 ms later, more bytes but under the 300 ms window: rate unchanged,
    // ETA recomputed against the new position.
    const r = updateDownloadRate(s, { file: 'a', loaded: 2 * MB, total: 10 * MB, now: 1050 });
    assert.equal(r.rate, MB);
    assert.equal(r.eta, 8);
    assert.equal(r.state.anchorLoaded, MB); // anchor not advanced
  });

  test('re-anchors on a new file (no negative delta)', () => {
    let s = updateDownloadRate(null, { file: 'a', loaded: 0, total: 10 * MB, now: 0 }).state;
    s = updateDownloadRate(s, { file: 'a', loaded: 5 * MB, total: 10 * MB, now: 1000 }).state;
    const r = updateDownloadRate(s, { file: 'b', loaded: 0, total: 4 * MB, now: 1100 });
    assert.equal(r.rate, null);
    assert.equal(r.eta, null);
    assert.equal(r.state.file, 'b');
  });

  test('re-anchors when loaded goes backwards (resume/retry)', () => {
    let s = updateDownloadRate(null, { file: 'a', loaded: 3 * MB, total: 10 * MB, now: 0 }).state;
    const r = updateDownloadRate(s, { file: 'a', loaded: 1 * MB, total: 10 * MB, now: 1000 });
    assert.equal(r.rate, null);
    assert.equal(r.state.anchorLoaded, MB);
  });

  test('EMA smooths a rate change instead of jumping', () => {
    let s = updateDownloadRate(null, { file: 'a', loaded: 0, total: 100 * MB, now: 0 }).state;
    // First window: 1 MB/s.
    let r = updateDownloadRate(s, { file: 'a', loaded: 1 * MB, total: 100 * MB, now: 1000 });
    assert.equal(r.rate, MB);
    // Second window: instantaneous 3 MB/s; EMA (alpha 0.3) -> 0.3*3 + 0.7*1 = 1.6 MB/s.
    r = updateDownloadRate(r.state, { file: 'a', loaded: 4 * MB, total: 100 * MB, now: 2000 });
    assert.ok(Math.abs(r.rate - 1.6 * MB) < 1);
  });

  test('no ETA once the file is complete', () => {
    let s = updateDownloadRate(null, { file: 'a', loaded: 0, total: 10 * MB, now: 0 }).state;
    const r = updateDownloadRate(s, { file: 'a', loaded: 10 * MB, total: 10 * MB, now: 1000 });
    assert.equal(r.eta, null);
  });
});

describe('relativeAge (coarse "n units ago")', () => {
  const now = Date.parse('2026-06-02T12:00:00Z');
  const ago = (sec) => new Date(now - sec * 1000).toISOString();

  test('under a minute -> justNow (value 0)', () => {
    assert.deepEqual(relativeAge(ago(0), now), { value: 0, unit: 'justNow' });
    assert.deepEqual(relativeAge(ago(59), now), { value: 0, unit: 'justNow' });
  });
  test('minutes between 1 and 59', () => {
    assert.deepEqual(relativeAge(ago(60), now), { value: 1, unit: 'minute' });
    assert.deepEqual(relativeAge(ago(120), now), { value: 2, unit: 'minute' });
    assert.deepEqual(relativeAge(ago(59 * 60), now), { value: 59, unit: 'minute' });
  });
  test('hours between 1 and 23', () => {
    assert.deepEqual(relativeAge(ago(3600), now), { value: 1, unit: 'hour' });
    assert.deepEqual(relativeAge(ago(3 * 3600), now), { value: 3, unit: 'hour' });
    assert.deepEqual(relativeAge(ago(23 * 3600), now), { value: 23, unit: 'hour' });
  });
  test('days at 24h and beyond', () => {
    assert.deepEqual(relativeAge(ago(24 * 3600), now), { value: 1, unit: 'day' });
    assert.deepEqual(relativeAge(ago(3 * 24 * 3600), now), { value: 3, unit: 'day' });
  });
  test('future / clock skew clamps to justNow', () => {
    assert.deepEqual(relativeAge(ago(-100), now), { value: 0, unit: 'justNow' });
  });
  test('unparseable input -> null', () => {
    assert.equal(relativeAge('garbage', now), null);
    assert.equal(relativeAge(undefined, now), null);
    assert.equal(relativeAge('', now), null);
  });
});
