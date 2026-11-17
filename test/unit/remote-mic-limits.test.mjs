// Unit coverage for app/ui/src/lib/remote-mic-limits.js. Regression guard: the
// phone used to read and decode a picked file before any size check, so a
// multi-GB file was pulled into memory (twice, raw then decoded PCM).
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FILE_MAX_BYTES, REMOTE_MIC_MAX_SAMPLES, fileTooLargeToDecode,
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

test('the sample cap is the shared 57.6M-sample memory guard', () => {
    assert.equal(REMOTE_MIC_MAX_SAMPLES, 57_600_000);
});
