// Unit coverage for the energy-based VAD behind the phone's hands-free mode
// (app/ui/src/lib/vad.js). Synthetic signals only: digital silence and sine
// bursts at 16 kHz, so a 20 ms frame is exactly 320 samples and every
// boundary below can be computed by hand.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createVad, rmsDb, VAD_DEFAULTS } from '../../app/ui/src/lib/vad.js';

const SR = 16000;
const FRAME = 320; // 20 ms at 16 kHz
const ms = (n) => Math.round(SR * n / 1000);

const silence = (durMs) => new Float32Array(ms(durMs));
// Amplitude 0.1 sine: RMS ~0.0707, about -23 dBFS, far above every threshold.
function tone(durMs, amp = 0.1, freq = 440) {
    const out = new Float32Array(ms(durMs));
    for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin(2 * Math.PI * freq * i / SR);
    return out;
}
function concat(...parts) {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}

// Feed `signal` in worklet-sized chunks; return every event in order.
function run(signal, { chunk = 128, ...opts } = {}) {
    const vad = createVad({ sampleRate: SR, ...opts });
    const events = [];
    for (let i = 0; i < signal.length; i += chunk) {
        events.push(...vad.push(signal.subarray(i, Math.min(i + chunk, signal.length))));
    }
    return { vad, events };
}

const types = (events) => events.map((e) => e.type).filter((t) => t !== 'audio');

// Samples of each started utterance (preroll + audio), one entry per 'start'.
function utteranceLengths(events) {
    const lens = [];
    for (const e of events) {
        if (e.type === 'start') lens.push(e.preroll.length);
        else if (e.type === 'audio') lens[lens.length - 1] += e.samples.length;
    }
    return lens;
}

describe('rmsDb', () => {
    test('full-scale square wave is 0 dBFS, silence is clamped', () => {
        assert.equal(rmsDb(new Float32Array([1, -1, 1, -1])), 0);
        assert.equal(rmsDb(new Float32Array(320)), -120);
    });
    test('0.1 sine is about -23 dBFS', () => {
        assert.ok(Math.abs(rmsDb(tone(20)) - -23.01) < 0.1);
    });
});

describe('createVad', () => {
    test('rejects an invalid sample rate', () => {
        assert.throws(() => createVad({ sampleRate: 0 }));
        assert.throws(() => createVad({ sampleRate: NaN }));
    });

    test('silence produces no events', () => {
        const { events } = run(silence(5000));
        assert.deepEqual(events, []);
    });

    test('one burst: onset, start with 400 ms preroll, audio, end after 900 ms of silence', () => {
        const { events } = run(concat(silence(1000), tone(1000), silence(2000)));
        assert.deepEqual(types(events), ['onset', 'start', 'end']);
        const start = events.find((e) => e.type === 'start');
        // 20 frames (400 ms) before the onset + 13 speech frames (ceil(250/20))
        // needed to confirm it.
        assert.equal(start.preroll.length, (20 + 13) * FRAME);
        // The utterance runs from 600 ms (preroll) to 2900 ms (end of speech at
        // 2000 ms + 45 frames of hangover).
        assert.deepEqual(utteranceLengths(events), [ms(2300)]);
    });

    test('the preroll really carries the audio before the onset', () => {
        // A quiet "lead-in" that is below the speech threshold but non-zero.
        const lead = tone(400, 0.0005);
        const { events } = run(concat(silence(600), lead, tone(500), silence(1500)));
        const start = events.find((e) => e.type === 'start');
        assert.deepEqual(Array.from(start.preroll.subarray(0, lead.length)), Array.from(lead));
    });

    test('a short click is discarded and never started', () => {
        const { events } = run(concat(silence(1000), tone(100), silence(2000)));
        assert.deepEqual(types(events), ['onset', 'discard']);
        assert.equal(events.some((e) => e.type === 'audio'), false);
    });

    test('250 ms of speech is kept, 240 ms is discarded', () => {
        assert.deepEqual(types(run(concat(silence(1000), tone(260), silence(2000))).events), ['onset', 'start', 'end']);
        assert.deepEqual(types(run(concat(silence(1000), tone(240), silence(2000))).events), ['onset', 'discard']);
    });

    test('speech split by short bursts adds up toward the 250 ms minimum', () => {
        // Two 160 ms bursts 300 ms apart: neither alone qualifies, together they do.
        const sig = concat(silence(1000), tone(160), silence(300), tone(160), silence(2000));
        assert.deepEqual(types(run(sig).events), ['onset', 'start', 'end']);
    });

    test('a pause shorter than 900 ms keeps a single utterance', () => {
        const sig = concat(silence(1000), tone(800), silence(700), tone(800), silence(2000));
        assert.deepEqual(types(run(sig).events), ['onset', 'start', 'end']);
    });

    test('a pause longer than 900 ms splits into two utterances', () => {
        const sig = concat(silence(1000), tone(800), silence(1200), tone(800), silence(2000));
        assert.deepEqual(types(run(sig).events), ['onset', 'start', 'end', 'onset', 'start', 'end']);
    });

    test('quiet speech under -50 dBFS is ignored even over digital silence', () => {
        // amp 0.004 -> about -51 dBFS: above floor + 10 dB but below the absolute gate.
        const { events } = run(concat(silence(1000), tone(1000, 0.004), silence(1000)));
        assert.deepEqual(events, []);
    });

    test('the noise floor drops fast and rises slowly', () => {
        const vad = createVad({ sampleRate: SR });
        assert.equal(vad.floorDb, VAD_DEFAULTS.initialFloorDb);
        vad.push(silence(200)); // 10 frames at -120 dBFS
        assert.ok(vad.floorDb < -110, `floor should have dropped, got ${vad.floorDb}`);
        const before = vad.floorDb;
        vad.push(tone(200)); // 10 frames at -23 dBFS
        // alpha 0.005 over 10 frames moves less than 5 % of the ~97 dB gap.
        assert.ok(vad.floorDb - before < 5, `floor rose too fast: ${before} -> ${vad.floorDb}`);
        assert.ok(vad.floorDb > before);
    });

    test('a steady noise eventually becomes the floor instead of speech', () => {
        // A constant hum (no dips) is learned as background: starting from a
        // -120 dBFS floor, alpha 0.005 needs ~450 frames (~9 s) to come within
        // 10 dB of a -23 dBFS hum, then the 900 ms hangover closes it.
        const { events } = run(concat(silence(500), tone(20000), silence(500)));
        assert.deepEqual(types(events), ['onset', 'start', 'end']);
        const [len] = utteranceLengths(events);
        assert.ok(len > ms(8000) && len < ms(12000), `hum should be dropped after ~10 s, got ${len / SR}s`);
    });

    test('a long utterance is force-split at the max length, without losing audio', () => {
        // Speech-like pattern (300 ms on, 100 ms off) so the floor keeps resetting.
        const parts = [silence(1000)];
        for (let i = 0; i < 20; i++) parts.push(tone(300), silence(100));
        parts.push(silence(2000));
        const sig = concat(...parts);
        const { events } = run(sig, { maxUtteranceMs: 3000 });
        // The utterance spans 600 ms (preroll) to the last burst end (8900 ms)
        // + 900 ms hangover = 9.2 s: three forced 3 s pieces plus a 200 ms tail.
        // The third split lands inside the final hangover, which must keep
        // counting instead of restarting (the tail would otherwise be 900 ms).
        assert.deepEqual(types(events), ['onset', 'start', 'end', 'start', 'end', 'start', 'end', 'start', 'end']);
        assert.deepEqual(utteranceLengths(events), [ms(3000), ms(3000), ms(3000), ms(200)]);
        // The forced restart has no preroll: the audio continues seamlessly.
        assert.equal(events.filter((e) => e.type === 'start')[1].preroll.length, 0);
    });

    test('events and audio do not depend on the chunk size', () => {
        const sig = concat(silence(1000), tone(700), silence(1000), tone(90), silence(1500), tone(400), silence(1200));
        const a = run(sig, { chunk: 128 }).events;
        const b = run(sig, { chunk: 1777 }).events;
        assert.deepEqual(types(a), types(b));
        assert.deepEqual(utteranceLengths(a), utteranceLengths(b));
    });

    test('finish() ends an active utterance, discards a candidate, is a no-op when idle', () => {
        const active = createVad({ sampleRate: SR });
        active.push(concat(silence(500), tone(500)));
        assert.equal(active.state, 'active');
        assert.deepEqual(active.finish(), [{ type: 'end' }]);
        assert.equal(active.state, 'idle');

        const candidate = createVad({ sampleRate: SR });
        candidate.push(concat(silence(500), tone(100)));
        assert.equal(candidate.state, 'candidate');
        assert.deepEqual(candidate.finish(), [{ type: 'discard' }]);

        assert.deepEqual(createVad({ sampleRate: SR }).finish(), []);
    });
});
