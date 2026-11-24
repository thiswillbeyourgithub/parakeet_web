// Tier-3 check of the remote-mic Opus path (app/ui/src/lib/remote-mic-opus.js)
// against Chromium's REAL WebCodecs, which the Node unit test can only fake.
// A 1 s 440 Hz tone at 48 kHz goes through createOpusEncoder ->
// packet grouping -> createOpusDecoder, and the test pins the gotchas the
// module documents: decoded length is the input plus a little (pre-skip /
// padding), never less; the decoder returns the announced rate; the tone
// survives (correlation with the source after the priming offset).
// Needs no model: the module and a blank page are routed onto the served
// origin (WebCodecs only exists in a secure context, about:blank is not one). Built with Claude Code.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../../app/ui/src/lib/remote-mic-opus.js', import.meta.url)), 'utf8');

test('opus round trip through real WebCodecs keeps length and signal', async ({ page }) => {
    await page.route('**/__opus_test__.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>opus</title>' }));
    await page.route('**/__opus_module__.js', (route) => route.fulfill({ contentType: 'text/javascript', body: src }));
    await page.goto('/__opus_test__.html');
    const r = await page.evaluate(async () => {
        const m = await import('/__opus_module__.js');
        const support = await m.probeOpusSupport().ready;
        if (!support.encode[48000] || !support.decode[48000]) return { skip: true };
        const rate = 48000;
        const input = new Float32Array(rate);
        for (let i = 0; i < input.length; i++) input[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / rate);
        const groups = [];
        const enc = m.createOpusEncoder(rate, (p) => groups.push(p), (e) => { throw e; });
        for (let i = 0; i < input.length; i += 128) enc.encode(input.subarray(i, i + 128));
        await enc.flush();
        enc.close();
        const out = [];
        const errors = [];
        const dec = m.createOpusDecoder(rate, (pcm) => out.push(pcm), (e) => errors.push(e.message));
        for (const g of groups) dec.decode(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength));
        await dec.flush();
        dec.close();
        const pcm = new Float32Array(out.reduce((n, a) => n + a.length, 0));
        let o = 0;
        for (const a of out) { pcm.set(a, o); o += a.length; }
        // Best correlation over a small lag window (the priming offset).
        let best = 0;
        for (let lag = 0; lag < 2000; lag++) {
            let xy = 0, xx = 0, yy = 0;
            for (let i = 4800; i < 43200; i++) { const x = input[i], y = pcm[i + lag]; xy += x * y; xx += x * x; yy += y * y; }
            best = Math.max(best, xy / Math.sqrt(xx * yy));
        }
        const bytes = groups.reduce((n, g) => n + g.byteLength, 0);
        const packets = groups.reduce((n, g) => n + m.unpackPackets(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength)).length, 0);
        return { packets, groups: groups.length, decoded: pcm.length, errors, best, bytes };
    });
    test.skip(r.skip === true, 'this Chromium has no Opus WebCodecs');
    expect(r.errors).toEqual([]);
    // 1 s = 50 frames of 20 ms; the encoder delay (pre-skip) pushes the tail
    // into one or two extra packets, flushed as a last partial group.
    expect(r.packets).toBeGreaterThanOrEqual(50);
    expect(r.packets).toBeLessThanOrEqual(52);
    expect(r.groups).toBe(Math.ceil(r.packets / 25));
    expect(r.decoded).toBeGreaterThanOrEqual(48000);
    expect(r.decoded).toBeLessThan(48000 + 2 * 960 + 1000);
    expect(r.best).toBeGreaterThan(0.95);
    expect(r.bytes).toBeLessThan(48000 * 2 / 4); // far under the pcm-s16 size
});
