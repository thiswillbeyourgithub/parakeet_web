// Tier-1 unit test for the remote-mic 10-minute rekey ratchet
// (app/ui/src/lib/remote-mic-rekey.js), on Node 22's real Web Crypto.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, deriveSessionKeys, decrypt, generateQrSecret, DIRECTION_PHONE_TO_DESKTOP as P2D } from '../../app/ui/src/lib/remote-crypto.js';
import { createSendRatchet, createRecvRatchet, REKEY_INTERVAL_MS } from '../../app/ui/src/lib/remote-mic-rekey.js';

async function session() {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    return deriveSessionKeys(a.privateKey, b.publicKey, { receiverPub: a.publicKey, senderPub: b.publicKey, qrSecret: generateQrSecret() });
}
const bytes = (n) => new Uint8Array([n, n + 1, n + 2]).buffer;
const read = (buf) => [...new Uint8Array(buf)];

describe('rekey ratchet', () => {
    test('interval is 10 minutes', () => assert.equal(REKEY_INTERVAL_MS, 600000));

    test('epoch 0 is the deriveSessionKeys key', async () => {
        const keys = await session();
        const tx = createSendRatchet(keys.master, P2D, { now: () => 0 });
        assert.deepEqual(read(await decrypt(await tx.encrypt(bytes(1)), keys.phoneToDesktop)), [1, 2, 3]);
    });

    test('sender rotates once per frame after the interval, receiver follows without loss', async () => {
        const keys = await session();
        let t = 0;
        const tx = createSendRatchet(keys.master, P2D, { intervalMs: 1000, now: () => t });
        const rx = createRecvRatchet(keys.master, P2D);
        const out = [];
        for (let i = 0; i < 6; i++) {
            if (i === 2) t = 1000;      // switch to epoch 1
            if (i === 4) t = 99999;     // long idle: still only ONE epoch ahead
            out.push(read(await rx.decrypt(await tx.encrypt(bytes(i)))));
        }
        assert.deepEqual(out.map((x) => x[0]), [0, 1, 2, 3, 4, 5]);
        assert.equal(await tx.epoch(), 2);
        assert.equal(await rx.epoch(), 2);
    });

    test('old epoch keys no longer decrypt after the switch (forward secrecy)', async () => {
        const keys = await session();
        let t = 0;
        const tx = createSendRatchet(keys.master, P2D, { intervalMs: 1000, now: () => t });
        const rx = createRecvRatchet(keys.master, P2D);
        const old = await tx.encrypt(bytes(7));
        await rx.decrypt(old);
        t = 1000;
        await rx.decrypt(await tx.encrypt(bytes(8)));
        await assert.rejects(rx.decrypt(old));
        await assert.rejects(decrypt(await tx.encrypt(bytes(9)), keys.phoneToDesktop));
    });

    test('a forged frame does not advance the receiver', async () => {
        const keys = await session();
        const other = await session();
        const tx = createSendRatchet(keys.master, P2D, { now: () => 0 });
        const forger = createSendRatchet(other.master, P2D, { now: () => 0 });
        const rx = createRecvRatchet(keys.master, P2D);
        await assert.rejects(rx.decrypt(await forger.encrypt(bytes(1))));
        assert.equal(await rx.epoch(), 0);
        assert.deepEqual(read(await rx.decrypt(await tx.encrypt(bytes(2)))), [2, 3, 4]);
    });

    test('the two directions use different chains', async () => {
        const keys = await session();
        const tx = createSendRatchet(keys.master, P2D, { now: () => 0 });
        const rx = createRecvRatchet(keys.master, 'desktop-to-phone');
        await assert.rejects(rx.decrypt(await tx.encrypt(bytes(1))));
    });
});
