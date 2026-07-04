// Tier-1 unit test for buildRecordingRateCandidates (app/ui/src/lib/audio.js).
// Guards the Firefox "slowed-down download" regression: when the browser does
// not report the mic's sample rate (Firefox), the recording AudioContext must
// prefer the browser DEFAULT (== native mic rate) BEFORE the SpeechMike low
// rates. Forcing a 16 kHz context on a native-48 kHz Firefox mic made Firefox
// silently relabel the downsampled stream, so the exported WAV declared 16 kHz
// while carrying 48 kHz-worth of samples and played back ~3x slowed down.
// See mdn/browser-compat-data #16213.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordingRateCandidates, pickRemoteMicCaptureRate } from '../../app/ui/src/lib/audio.js';

describe('buildRecordingRateCandidates', () => {
  test('Firefox (no reported rate) tries browser default BEFORE 16 kHz', () => {
    // undefined === "browser default (no sampleRate option)" === native mic rate.
    const order = buildRecordingRateCandidates(undefined);
    assert.equal(order[0], undefined, 'browser default must be the first attempt');
    const idxDefault = order.indexOf(undefined);
    const idx16k = order.indexOf(16000);
    assert.ok(
      idxDefault < idx16k,
      `browser default (${idxDefault}) must come before 16000 (${idx16k}) so a native-rate Firefox mic is not forced into a 16 kHz context`,
    );
  });

  test('Chromium (reports 48 kHz) captures at the native rate first', () => {
    const order = buildRecordingRateCandidates(48000);
    assert.equal(order[0], 48000, 'the mic\'s reported native rate must be tried first');
  });

  test('a SpeechMike reporting 16 kHz is honored at its native rate first', () => {
    const order = buildRecordingRateCandidates(16000);
    assert.equal(order[0], 16000);
  });

  test('SpeechMike fallback rates are still present after the native/default attempts', () => {
    const order = buildRecordingRateCandidates(undefined);
    for (const r of [16000, 22050, 44100, 48000]) {
      assert.ok(order.includes(r), `expected SpeechMike fallback ${r} to remain in the list`);
    }
  });

  test('browser default is always present exactly once', () => {
    for (const reported of [undefined, 0, 48000, 44100, 16000]) {
      const order = buildRecordingRateCandidates(reported);
      const defaults = order.filter((r) => r === undefined);
      assert.equal(defaults.length, 1, `browser default must appear exactly once for reported=${reported}`);
    }
  });

  test('no duplicate rates', () => {
    for (const reported of [undefined, 48000, 44100, 16000, 22050]) {
      const order = buildRecordingRateCandidates(reported);
      const seen = new Set();
      for (const r of order) {
        assert.ok(!seen.has(r), `duplicate rate ${r} for reported=${reported}`);
        seen.add(r);
      }
    }
  });

  test('falsy reported rate (0) is treated as unknown, not tried literally', () => {
    const order = buildRecordingRateCandidates(0);
    assert.ok(!order.includes(0), '0 Hz must never be an attempted rate');
    assert.equal(order[0], undefined, 'falls back to browser default first');
  });
});

describe('pickRemoteMicCaptureRate (phone capture over WebRTC)', () => {
  test('Firefox (no reported rate) captures at native, not a forced 16 kHz', () => {
    // undefined return === open a native-rate AudioContext (no sampleRate opt),
    // so the context matches the mic and Firefox does not mislabel/slow it.
    assert.equal(pickRemoteMicCaptureRate(undefined), undefined);
  });

  test('Chrome/Safari (reports the mic rate) forces 16 kHz to keep the wire small', () => {
    assert.equal(pickRemoteMicCaptureRate(48000), 16000);
    assert.equal(pickRemoteMicCaptureRate(44100), 16000);
    assert.equal(pickRemoteMicCaptureRate(16000), 16000);
  });

  test('falsy reported rate (0) is treated as unknown -> native capture', () => {
    assert.equal(pickRemoteMicCaptureRate(0), undefined);
  });
});
