// Tier-1 unit test for the remote-mic E2E crypto (app/ui/src/lib/remote-crypto.js).
// Exercises the real Web Crypto API exposed on Node 22's globalThis (crypto.subtle,
// btoa/atob, TextEncoder), so no browser stub is needed.
//
// Covers the full ECDH -> HKDF -> AES-GCM round trip between two peers, the
// public-key export/import validation guards, and the v4 key schedule: the QR
// secret K mixed into the master key (replacing the v3 fingerprint check) and
// the per-direction, per-epoch keys. Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair, exportPublicKey, importPublicKey, deriveSessionKeys,
  deriveMasterKey, deriveDirectionKey, DIRECTION_PHONE_TO_DESKTOP,
  generateQrSecret, isQrSecret, decodeQrSecret, QR_SECRET_BYTES,
  encrypt, decrypt,
} from '../../app/ui/src/lib/remote-crypto.js';

const enc = (s) => new TextEncoder().encode(s).buffer;

// Session keys for two fresh peers (a = desktop receiver, b = phone sender).
// aKey/bKey are the phone-to-desktop key as each side derives it.
async function pair({ qrA, qrB } = {}) {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const k = generateQrSecret();
  const base = { receiverPub: a.publicKey, senderPub: b.publicKey };
  const desk = await deriveSessionKeys(a.privateKey, b.publicKey, { ...base, qrSecret: qrA ?? k });
  const phone = await deriveSessionKeys(b.privateKey, a.publicKey, { ...base, qrSecret: qrB ?? k });
  return { a, b, k, desk, phone, aKey: desk.phoneToDesktop, bKey: phone.phoneToDesktop };
}

describe('QR secret K', () => {
  test('generated secrets are 22-char base64url, 16 bytes, and unique', () => {
    const k = generateQrSecret();
    assert.ok(isQrSecret(k), k);
    assert.equal(decodeQrSecret(k).length, QR_SECRET_BYTES);
    assert.notEqual(generateQrSecret(), k);
  });

  test('malformed secrets are refused', () => {
    for (const bad of ['', 'short', 'x'.repeat(23), 'a+b/'.repeat(5) + 'ab', null, 42]) {
      assert.equal(isQrSecret(bad), false, String(bad));
    }
    assert.throws(() => decodeQrSecret('nope'), /malformed/);
  });
});

describe('v4 key schedule', () => {
  test('both sides agree per direction, directions never cross', async () => {
    const { desk, phone } = await pair();
    const down = await encrypt(enc('{"type":"stop"}'), desk.desktopToPhone);
    assert.equal(new TextDecoder().decode(await decrypt(down, phone.desktopToPhone)), '{"type":"stop"}');
    // A frame reflected back to its sender does not decrypt there.
    await assert.rejects(() => decrypt(down, desk.phoneToDesktop));
  });

  test('a different K on one side (relay swapped keys, cannot know K) breaks agreement', async () => {
    const { aKey, bKey } = await pair({ qrB: generateQrSecret() });
    { const pkt = await encrypt(enc('x'), bKey); await assert.rejects(() => decrypt(pkt, aKey)); }
  });

  test('swapped receiver/sender order yields a different key', async () => {
    const { a, b, k, aKey } = await pair();
    const swapped = await deriveSessionKeys(b.privateKey, a.publicKey,
      { receiverPub: b.publicKey, senderPub: a.publicKey, qrSecret: k });
    { const pkt = await encrypt(enc('x'), aKey); await assert.rejects(() => decrypt(pkt, swapped.phoneToDesktop)); }
  });

  test('epochs: same epoch agrees, another epoch cannot decrypt', async () => {
    const { desk, phone } = await pair();
    const d1 = await deriveDirectionKey(desk.master, DIRECTION_PHONE_TO_DESKTOP, 1);
    const p1 = await deriveDirectionKey(phone.master, DIRECTION_PHONE_TO_DESKTOP, 1);
    const pkt = await encrypt(enc('epoch1'), p1);
    assert.equal(new TextDecoder().decode(await decrypt(pkt, d1)), 'epoch1');
    await assert.rejects(() => decrypt(pkt, desk.phoneToDesktop));
  });

  test('the pair and a well-formed K are required', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    await assert.rejects(() => deriveMasterKey(a.privateKey, b.publicKey), /required/);
    await assert.rejects(() => deriveMasterKey(a.privateKey, b.publicKey,
      { receiverPub: a.publicKey, senderPub: b.publicKey }), /malformed QR secret/);
  });
});

describe('ECDH key agreement + AES-GCM round trip', () => {
  test('both peers derive the same key (encrypt on A, decrypt on B)', async () => {
    const { aKey, bKey } = await pair();
    const plaintext = new TextEncoder().encode('hello from the phone');
    const packet = await encrypt(plaintext.buffer, aKey);
    const out = new Uint8Array(await decrypt(packet, bKey));
    assert.deepEqual(Array.from(out), Array.from(plaintext));
  });

  test('packet layout is [12-byte IV][ciphertext+tag] and IV is random per call', async () => {
    const { aKey } = await pair();
    const data = new Uint8Array([1, 2, 3, 4]).buffer;
    const p1 = new Uint8Array(await encrypt(data, aKey));
    const p2 = new Uint8Array(await encrypt(data, aKey));
    // 12-byte IV + 4-byte plaintext + 16-byte GCM tag = 32 bytes.
    assert.equal(p1.byteLength, 12 + 4 + 16);
    const iv1 = p1.slice(0, 12), iv2 = p2.slice(0, 12);
    assert.notDeepEqual(Array.from(iv1), Array.from(iv2), 'IVs must differ');
  });

  test('a tampered ciphertext fails the GCM auth tag', async () => {
    const { aKey, bKey } = await pair();
    const packet = new Uint8Array(await encrypt(new Uint8Array([9, 9, 9]).buffer, aKey));
    packet[packet.length - 1] ^= 0xff; // flip a tag byte
    await assert.rejects(() => decrypt(packet.buffer, bKey));
  });

  test('a different key cannot decrypt', async () => {
    const { aKey } = await pair();
    const { bKey: strangerKey } = await pair();
    const packet = await encrypt(new TextEncoder().encode('secret').buffer, aKey);
    await assert.rejects(() => decrypt(packet, strangerKey));
  });
});

describe('public key export / import', () => {
  test('export then import round-trips to a usable ECDH key', async () => {
    const { publicKey } = await generateKeyPair();
    const b64 = await exportPublicKey(publicKey);
    // Raw uncompressed P-256 is 65 bytes -> 88 base64 chars incl. padding.
    assert.equal(b64.length, 88);
    const imported = await importPublicKey(b64);
    const reExported = await exportPublicKey(imported);
    assert.equal(reExported, b64);
  });

  test('rejects oversized input before allocating', async () => {
    await assert.rejects(() => importPublicKey('A'.repeat(201)), /too long/);
  });
  test('rejects non-base64 input', async () => {
    await assert.rejects(() => importPublicKey('not valid base64!!'), /not valid base64/);
  });
  test('rejects a valid-base64 payload of the wrong length', async () => {
    await assert.rejects(() => importPublicKey(btoa('too short')), /expected 65-byte/);
  });
});
