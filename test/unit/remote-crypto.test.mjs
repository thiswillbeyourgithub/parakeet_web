// Tier-1 unit test for the remote-mic E2E crypto (app/ui/src/lib/remote-crypto.js).
// Exercises the real Web Crypto API exposed on Node 22's globalThis (crypto.subtle,
// btoa/atob, TextEncoder), so no browser stub is needed.
//
// Covers the full ECDH -> HKDF -> AES-GCM round trip between two peers, the
// public-key export/import validation guards, and the symmetric pair
// fingerprint both screens must agree on. Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey,
  encrypt, decrypt, getPairFingerprint, computeFingerprintLength,
} from '../../app/ui/src/lib/remote-crypto.js';

// Establish a shared key between two fresh peers (receiver + sender).
async function pair() {
  const a = await generateKeyPair();
  const b = await generateKeyPair();
  const aKey = await deriveSharedKey(a.privateKey, b.publicKey);
  const bKey = await deriveSharedKey(b.privateKey, a.publicKey);
  return { a, b, aKey, bKey };
}

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

describe('pair fingerprint', () => {
  test('both peers compute the same fingerprint from the same key order', async () => {
    const { a, b } = await pair();
    const fpReceiver = await getPairFingerprint(a.publicKey, b.publicKey);
    const fpSender = await getPairFingerprint(a.publicKey, b.publicKey);
    assert.equal(fpReceiver, fpSender);
  });

  test('swapping key order changes the fingerprint (MITM key-swap is visible)', async () => {
    const { a, b } = await pair();
    const fp1 = await getPairFingerprint(a.publicKey, b.publicKey);
    const fp2 = await getPairFingerprint(b.publicKey, a.publicKey);
    assert.notEqual(fp1, fp2);
  });

  test('default length is 16 hex grouped in 4s, clamped to [16,64]', async () => {
    const { a, b } = await pair();
    const fp = await getPairFingerprint(a.publicKey, b.publicKey);
    assert.equal(fp.replace(/-/g, '').length, 16);
    assert.match(fp, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    const clampedLow = await getPairFingerprint(a.publicKey, b.publicKey, 4);
    assert.equal(clampedLow.replace(/-/g, '').length, 16);
    const clampedHigh = await getPairFingerprint(a.publicKey, b.publicKey, 999);
    assert.equal(clampedHigh.replace(/-/g, '').length, 64);
  });

  test('computeFingerprintLength is floored at 16 regardless of room count', () => {
    assert.equal(computeFingerprintLength(1), 16);
    assert.equal(computeFingerprintLength(100000), 16);
  });
});
