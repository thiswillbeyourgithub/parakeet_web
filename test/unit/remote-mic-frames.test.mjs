// Unit coverage for the remote-mic integrity framing (app/ui/src/lib/remote-mic-frames.js).
// Regression guard: frames used to be bare ciphertext, so a frame dropped by the
// 5 s backpressure timeout, the relay's queue overflow, or a malicious relay
// produced a truncated recording that was transcribed as if it were whole.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    FRAME_AUDIO, FRAME_END, FRAME_HEADER_BYTES,
    packFrame, packEndFrame, unpackFrame, createFrameSender, createFrameVerifier,
} from '../../app/ui/src/lib/remote-mic-frames.js';

// Simulate the phone: returns the list of decrypted frames the desktop would see.
function record(sender, chunkSizes) {
    sender.beginRecording();
    const frames = chunkSizes.map((n) => {
        const seq = sender.nextAudio(n);
        return unpackFrame(packFrame(FRAME_AUDIO, seq, new Int16Array(n)));
    });
    const { seq, totals } = sender.nextEnd();
    frames.push(unpackFrame(packEndFrame(seq, totals)));
    return frames;
}

function verify(verifier, frames) {
    verifier.beginRecording();
    for (const f of frames) verifier.accept(f, f.payload.byteLength / 2);
    return verifier.finish({ requireEnd: true });
}

describe('remote-mic frames', () => {
    test('round trip keeps kind, seq and payload', () => {
        const pcm = new Int16Array([1, -2, 3]);
        const f = unpackFrame(packFrame(FRAME_AUDIO, 7, pcm));
        assert.equal(f.kind, FRAME_AUDIO);
        assert.equal(f.seq, 7);
        assert.deepEqual(Array.from(new Int16Array(f.payload)), [1, -2, 3]);
        const e = unpackFrame(packEndFrame(8, { chunks: 2, samples: 300 }));
        assert.equal(e.kind, FRAME_END);
        assert.deepEqual(e.end, { chunks: 2, samples: 300 });
    });

    test('a whole recording verifies', () => {
        assert.deepEqual(verify(createFrameVerifier(), record(createFrameSender(), [800, 800, 400])), { ok: true });
    });

    test('a dropped frame is reported as a seq gap', () => {
        const frames = record(createFrameSender(), [800, 800, 800]);
        frames.splice(1, 1);
        const v = verify(createFrameVerifier(), frames);
        assert.equal(v.ok, false);
        assert.match(v.reason, /expected seq 1, got 2/);
    });

    test('reordered frames are refused', () => {
        const frames = record(createFrameSender(), [800, 800, 800]);
        [frames[0], frames[1]] = [frames[1], frames[0]];
        assert.equal(verify(createFrameVerifier(), frames).ok, false);
    });

    test('END totals that disagree with what arrived are refused', () => {
        const sender = createFrameSender();
        sender.beginRecording();
        const a = unpackFrame(packFrame(FRAME_AUDIO, sender.nextAudio(800), new Int16Array(800)));
        const { seq } = sender.nextEnd();
        const end = unpackFrame(packEndFrame(seq, { chunks: 1, samples: 9999 }));
        const v = verify(createFrameVerifier(), [a, end]);
        assert.equal(v.ok, false);
        assert.match(v.reason, /END says/);
    });

    test('missing END fails only when END is required', () => {
        const frames = record(createFrameSender(), [800]).slice(0, -1);
        const verifier = createFrameVerifier();
        assert.equal(verify(verifier, frames).ok, false);
        assert.deepEqual(verifier.finish({ requireEnd: false }), { ok: true });
    });

    test('audio after END is refused', () => {
        const sender = createFrameSender();
        const frames = record(sender, [800]);
        frames.push(unpackFrame(packFrame(FRAME_AUDIO, sender.nextAudio(800), new Int16Array(800))));
        assert.equal(verify(createFrameVerifier(), frames).ok, false);
    });

    test('a gap in one recording does not poison the next one', () => {
        const sender = createFrameSender();
        const verifier = createFrameVerifier();
        const first = record(sender, [800, 800]);
        first.splice(0, 1);
        assert.equal(verify(verifier, first).ok, false);
        assert.deepEqual(verify(verifier, record(sender, [800, 800])), { ok: true });
    });

    test('malformed frames throw', () => {
        assert.throws(() => unpackFrame(new ArrayBuffer(FRAME_HEADER_BYTES - 1)), /shorter/);
        const bad = new Uint8Array(FRAME_HEADER_BYTES);
        bad[0] = 9;
        assert.throws(() => unpackFrame(bad.buffer), /unknown frame kind/);
        assert.throws(() => unpackFrame(packFrame(FRAME_END, 0, new Uint8Array(3))), /bad payload size/);
    });
});
