// Unit coverage for app/ui/src/lib/remote-mic-limits.js. Regression guard: the
// phone used to read and decode a picked file before any size check, so a
// multi-GB file was pulled into memory (twice, raw then decoded PCM).
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FILE_MAX_BYTES, REMOTE_MIC_MAX_SAMPLES, fileTooLargeToDecode,
    REMOTE_MIC_GAIN_MIN, REMOTE_MIC_GAIN_MAX, clampRemoteMicGain, isAcceptedRemoteMicGain,
} from '../../app/ui/src/lib/remote-mic-limits.js';

test('files up to the cap are read, larger ones refused before decoding', () => {
    assert.equal(fileTooLargeToDecode({ size: 5 * 1024 * 1024 }), false);
    assert.equal(fileTooLargeToDecode({ size: FILE_MAX_BYTES }), false);
    assert.equal(fileTooLargeToDecode({ size: FILE_MAX_BYTES + 1 }), true);
    assert.equal(fileTooLargeToDecode({ size: 4 * 1024 ** 3 }), true);
});

test('a missing or bogus size is refused', () => {
    assert.equal(fileTooLargeToDecode(null), true);
    assert.equal(fileTooLargeToDecode({ size: NaN }), true);
});

// Regression guard: the phone used to accept any finite gain >= 0 from an
// audio-settings message (e.g. 1e6, turning the capture into clipped noise).
test('the phone accepts gains from 0 up to the desktop maximum only', () => {
    assert.equal(isAcceptedRemoteMicGain(0), true);
    assert.equal(isAcceptedRemoteMicGain(2), true);
    assert.equal(isAcceptedRemoteMicGain(REMOTE_MIC_GAIN_MAX), true);
    assert.equal(isAcceptedRemoteMicGain(REMOTE_MIC_GAIN_MAX + 0.01), false);
    assert.equal(isAcceptedRemoteMicGain(1e6), false);
    assert.equal(isAcceptedRemoteMicGain(-1), false);
    assert.equal(isAcceptedRemoteMicGain(Infinity), false);
    assert.equal(isAcceptedRemoteMicGain('3'), false);
});

test('the desktop clamps every gain it sends into the accepted range', () => {
    assert.equal(clampRemoteMicGain(0.1), REMOTE_MIC_GAIN_MIN);
    assert.equal(clampRemoteMicGain(9), REMOTE_MIC_GAIN_MAX);
    assert.equal(clampRemoteMicGain(2.5), 2.5);
    assert.equal(isAcceptedRemoteMicGain(clampRemoteMicGain(9)), true);
});

test('the sample cap is the shared 57.6M-sample memory guard', () => {
    assert.equal(REMOTE_MIC_MAX_SAMPLES, 57_600_000);
});
