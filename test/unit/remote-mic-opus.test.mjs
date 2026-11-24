// Tier-1 unit test for remote-mic Opus negotiation, grouping and the
// encoder/decoder wrappers (app/ui/src/lib/remote-mic-opus.js). Node has no
// WebCodecs, so a fake codec pair stands in: the "encoder" turns every
// 20 ms of input into one packet holding the sample count, the "decoder"
// expands it back. Real Opus quality is a browser concern. Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    OPUS_RATES, GROUP_PACKETS, probeOpusSupport, shouldSendOpus, advertisedCodecs,
    packPackets, unpackPackets, createOpusEncoder, createOpusDecoder,
} from '../../app/ui/src/lib/remote-mic-opus.js';

function fakeScope({ encodeRates = OPUS_RATES, decodeRates = OPUS_RATES, decodeRate = null } = {}) {
    class AudioData {
        constructor(init) { Object.assign(this, init); }
        copyTo(dst) { dst.set(this.data); }
    }
    class AudioEncoder {
        static async isConfigSupported(c) { return { supported: c.codec === 'opus' && encodeRates.includes(c.sampleRate) }; }
        constructor({ output }) { this.output = output; this.buf = 0; }
        configure(c) { this.frame = c.sampleRate * c.opus.frameDuration / 1e6; }
        emit(n) { const b = new Uint8Array([n & 0xff, n >> 8]); this.output({ byteLength: 2, copyTo: (d) => d.set(b) }); }
        encode(d) { this.buf += d.numberOfFrames; while (this.buf >= this.frame) { this.emit(this.frame); this.buf -= this.frame; } }
        async flush() { if (this.buf) { this.emit(this.buf); this.buf = 0; } }
        close() {}
    }
    class EncodedAudioChunk { constructor(init) { Object.assign(this, init); } }
    class AudioDecoder {
        static async isConfigSupported(c) { return { supported: decodeRates.includes(c.sampleRate) }; }
        constructor({ output }) { this.output = output; this.t = 0; }
        configure(c) { this.rate = decodeRate ?? c.sampleRate; }
        decode(chunk) {
            // Sample i of the whole stream has value i, so tests can check
            // exactly which samples survive decimation.
            const n = chunk.data[0] | (chunk.data[1] << 8);
            const data = Float32Array.from({ length: n }, () => this.t++);
            this.output(new AudioData({ sampleRate: this.rate, numberOfFrames: n, data }));
        }
        async flush() {}
        close() {}
    }
    return { AudioData, AudioEncoder, AudioDecoder, EncodedAudioChunk };
}

describe('negotiation', () => {
    test('probe reports per-rate support; no WebCodecs means none', async () => {
        const s = await probeOpusSupport(fakeScope({ encodeRates: [48000], decodeRates: [16000] })).ready;
        assert.equal(s.encode[48000], true);
        assert.equal(s.encode[16000], false);
        assert.equal(s.decode[16000], true);
        const none = await probeOpusSupport({}).ready;
        assert.deepEqual(advertisedCodecs(none), []);
        assert.deepEqual(advertisedCodecs(s), ['opus']);
    });

    test('opus only when the peer advertised it, the rate is native and encodable', () => {
        const support = { encode: { 48000: true, 16000: false } };
        assert.equal(shouldSendOpus({ peerCodecs: ['opus'], sampleRate: 48000, support }), true);
        assert.equal(shouldSendOpus({ peerCodecs: [], sampleRate: 48000, support }), false);
        assert.equal(shouldSendOpus({ peerCodecs: ['opus'], sampleRate: 44100, support: { encode: { 44100: true } } }), false);
        assert.equal(shouldSendOpus({ peerCodecs: ['opus'], sampleRate: 16000, support }), false);
        assert.equal(shouldSendOpus({ peerCodecs: 'opus', sampleRate: 48000, support }), false);
    });
});

describe('packet grouping', () => {
    test('round trip', () => {
        const pk = [new Uint8Array([1, 2, 3]), new Uint8Array([9])];
        assert.deepEqual(unpackPackets(packPackets(pk).buffer).map((p) => [...p]), [[1, 2, 3], [9]]);
    });
    test('truncated, zero-length and empty payloads are refused', () => {
        const ok = packPackets([new Uint8Array([1, 2, 3])]);
        assert.throws(() => unpackPackets(ok.slice(0, 4).buffer));
        assert.throws(() => unpackPackets(new Uint8Array([0, 0]).buffer));
        assert.throws(() => unpackPackets(new ArrayBuffer(0)));
        assert.throws(() => unpackPackets(new Uint8Array([3]).buffer));
    });
});

describe('encoder + decoder', () => {
    test('groups of 25 packets, trailing partial group on flush, decoded in order', async () => {
        const scope = fakeScope();
        const groups = [];
        const enc = createOpusEncoder(16000, (p) => groups.push(p), assert.fail, scope);
        // 1.3 s at 16 kHz = 20800 samples = 65 packets of 320 -> groups 25, 25, 15
        for (let i = 0; i < 20800; i += 128) enc.encode(new Float32Array(Math.min(128, 20800 - i)));
        assert.equal(groups.length, 2);
        await enc.flush();
        assert.deepEqual(groups.map((g) => unpackPackets(g.buffer).length), [GROUP_PACKETS, GROUP_PACKETS, 15]);
        let samples = 0;
        const dec = createOpusDecoder(16000, (pcm) => { samples += pcm.length; }, assert.fail, scope);
        for (const g of groups) dec.decode(g.buffer);
        await dec.flush();
        assert.equal(samples, 20800);
    });

    test('decoded audio at an unannounced rate is refused, not appended', () => {
        const scope = fakeScope({ decodeRate: 44100 });
        const errors = [];
        let got = 0;
        const dec = createOpusDecoder(48000, () => { got++; }, (e) => errors.push(e.message), scope);
        dec.decode(packPackets([new Uint8Array([0xc0, 0x03])]).buffer);
        assert.equal(got, 0);
        assert.match(errors[0], /44100/);
    });

    test('Chromium-style 48 kHz output for a 16 kHz stream is decimated, phase kept across buffers', () => {
        // Real bug: Chromium decodes Opus at 48 kHz whatever rate was configured.
        const scope = fakeScope({ decodeRate: 48000 });
        const out = [];
        const errors = [];
        const dec = createOpusDecoder(16000, (pcm) => out.push(...pcm), (e) => errors.push(e.message), scope);
        // Buffers of 1000 and 500 samples: neither is a multiple of 3.
        dec.decode(packPackets([new Uint8Array([1000 & 0xff, 1000 >> 8]), new Uint8Array([500 & 0xff, 500 >> 8])]).buffer);
        assert.deepEqual(errors, []);
        assert.equal(out.length, 500);
        assert.deepEqual(out.slice(0, 4), [0, 3, 6, 9]);
        assert.ok(out.every((v, i) => v === i * 3));
    });
});
