/**
 * Crypto module for ParakeetWeb remote microphone.
 * Adapted from WebSend's crypto.js (https://github.com/thiswillbeyourgithub/WebSend).
 * Adapted with the help of Claude Code.
 *
 * Implements ECDH key exchange with AES-GCM encryption for E2E encrypted
 * audio streaming over WebRTC data channels.
 *
 * Uses Web Crypto API for all cryptographic operations.
 */

/**
 * Generate an ECDH key pair using P-256 curve.
 * @returns {Promise<{publicKey: CryptoKey, privateKey: CryptoKey}>}
 */
export async function generateKeyPair() {
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits']
    );
    return keyPair;
}

/**
 * Export public key to base64 for transmission over data channel.
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>} Base64-encoded public key
 */
export async function exportPublicKey(publicKey) {
    const exported = await crypto.subtle.exportKey('raw', publicKey);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

/**
 * Import a public key from base64.
 * @param {string} base64Key
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(base64Key) {
    // Reject anything that isn't a plausible raw P-256 public key before
    // handing bytes to WebCrypto. Raw uncompressed P-256 is exactly 65 bytes
    // (0x04 || X || Y); the base64 form is therefore 88 chars including
    // padding. This guards against a malicious peer (or compromised
    // signaling relay) sending oversized / malformed input.
    // Length-cap BEFORE running regex / atob so a hostile peer cannot force a
    // ~48 KB allocation by sending a 64 KB SCTP message. Padded base64 of a
    // 65-byte payload is 88 chars; 200 is a comfortable ceiling.
    if (typeof base64Key !== 'string' || base64Key.length > 200) {
        throw new Error('importPublicKey: input too long or not a string');
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Key)) {
        throw new Error('importPublicKey: input is not valid base64');
    }
    let binaryString;
    try {
        binaryString = atob(base64Key);
    } catch {
        throw new Error('importPublicKey: base64 decode failed');
    }
    if (binaryString.length !== 65 || binaryString.charCodeAt(0) !== 0x04) {
        throw new Error(`importPublicKey: expected 65-byte uncompressed P-256 key, got ${binaryString.length} bytes`);
    }
    const bytes = new Uint8Array(65);
    for (let i = 0; i < 65; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return crypto.subtle.importKey(
        'raw', bytes,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
    );
}

/**
 * receiverPub || senderPub as raw bytes, the one canonical byte order both
 * the HKDF info uses.
 * @param {CryptoKey} receiverPub
 * @param {CryptoKey} senderPub
 * @returns {Promise<Uint8Array>}
 */
async function concatPairPublicKeys(receiverPub, senderPub) {
    const aBytes = new Uint8Array(await crypto.subtle.exportKey('raw', receiverPub));
    const bBytes = new Uint8Array(await crypto.subtle.exportKey('raw', senderPub));
    const combined = new Uint8Array(aBytes.length + bBytes.length);
    combined.set(aBytes, 0);
    combined.set(bBytes, aBytes.length);
    return combined;
}

/** Phone audio and phone control messages to the desktop. */
export const DIRECTION_PHONE_TO_DESKTOP = 'phone-to-desktop';
/** Desktop control messages (stop, pause, audio-settings...) to the phone. */
export const DIRECTION_DESKTOP_TO_PHONE = 'desktop-to-phone';

/** Bytes of the QR secret K (128 bits, 22 base64url chars). */
export const QR_SECRET_BYTES = 16;
const QR_SECRET_RE = /^[A-Za-z0-9_-]{22}$/;

function toBase64Url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Fresh QR secret K, carried only in the QR URL fragment (`#ROOM:SECRET:K`).
 * The fragment never reaches the server, so the signaling relay cannot know
 * K, and K is mixed into every session key: a relay that swaps the public
 * keys ends up with keys that cannot decrypt anything. It is distinct from
 * SECRET because SECRET is sent to the server (X-Room-Secret).
 * Example: 'q3V0d2l0aC1jbGF1ZGUtY2'
 * @returns {string}
 */
export function generateQrSecret() {
    return toBase64Url(crypto.getRandomValues(new Uint8Array(QR_SECRET_BYTES)));
}

/** Whether a string is a well-formed QR secret. */
export function isQrSecret(s) {
    return typeof s === 'string' && QR_SECRET_RE.test(s);
}

/** Decode a QR secret to its 16 bytes; throws on a malformed one. */
export function decodeQrSecret(s) {
    if (!isQrSecret(s)) throw new Error('malformed QR secret');
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==');
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const KDF_LABEL = 'ParakeetWeb-RemoteMic-v4';

function concatBytes(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
}

/**
 * Session master secret, as a non-extractable HKDF key:
 *   HKDF-SHA256(ikm = ECDH(priv, theirPub),
 *               salt = utf8('ParakeetWeb-RemoteMic-v4') || K,
 *               info = utf8('ParakeetWeb-RemoteMic-v4|master|') || receiverPub || senderPub)
 * Binding both public keys (receiver first, on BOTH sides) and K means the
 * two ends only agree when nobody swapped a key and both read the same QR.
 *
 * @param {CryptoKey} privateKey - Our ECDH private key
 * @param {CryptoKey} theirPublicKey - Their ECDH public key
 * @param {{receiverPub: CryptoKey, senderPub: CryptoKey, qrSecret: string}} pair
 * @returns {Promise<CryptoKey>}
 */
export async function deriveMasterKey(privateKey, theirPublicKey, pair) {
    if (!pair || !pair.receiverPub || !pair.senderPub) {
        throw new Error('deriveMasterKey: receiverPub and senderPub are required');
    }
    const k = decodeQrSecret(pair.qrSecret);
    const enc = new TextEncoder();
    const ikm = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirPublicKey }, privateKey, 256);
    const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const info = concatBytes(enc.encode(`${KDF_LABEL}|master|`), await concatPairPublicKeys(pair.receiverPub, pair.senderPub));
    const master = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: concatBytes(enc.encode(KDF_LABEL), k), info },
        ikmKey, 256,
    );
    return crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey', 'deriveBits']);
}

/**
 * Directional AES-GCM key of one key epoch:
 *   HKDF(master, salt = empty, info = utf8('ParakeetWeb-RemoteMic-v4|<direction>|<epoch>'))
 * Each side encrypts with its own direction and decrypts with the other, so a
 * frame reflected back to its sender never authenticates.
 *
 * @param {CryptoKey} master - from deriveMasterKey
 * @param {string} direction - DIRECTION_PHONE_TO_DESKTOP or DIRECTION_DESKTOP_TO_PHONE
 * @param {number} [epoch=0]
 * @returns {Promise<CryptoKey>}
 */
export function deriveDirectionKey(master, direction, epoch = 0) {
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(`${KDF_LABEL}|${direction}|${epoch}`) },
        master,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

/**
 * Both directional keys of a session (epoch 0) plus the master they came from.
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} theirPublicKey
 * @param {{receiverPub: CryptoKey, senderPub: CryptoKey, qrSecret: string}} pair
 * @returns {Promise<{master: CryptoKey, phoneToDesktop: CryptoKey, desktopToPhone: CryptoKey}>}
 */
export async function deriveSessionKeys(privateKey, theirPublicKey, pair) {
    const master = await deriveMasterKey(privateKey, theirPublicKey, pair);
    const [phoneToDesktop, desktopToPhone] = await Promise.all([
        deriveDirectionKey(master, DIRECTION_PHONE_TO_DESKTOP),
        deriveDirectionKey(master, DIRECTION_DESKTOP_TO_PHONE),
    ]);
    return { master, phoneToDesktop, desktopToPhone };
}

/**
 * Encrypt data with AES-GCM. Each call uses a fresh random IV.
 * @param {ArrayBuffer} data - Data to encrypt
 * @param {CryptoKey} sharedKey - AES direction key from deriveSessionKeys
 * @returns {Promise<ArrayBuffer>} [12 bytes IV][ciphertext + auth tag]
 */
export async function encrypt(data, sharedKey) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        sharedKey,
        data
    );
    const result = new Uint8Array(12 + encryptedData.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encryptedData), 12);
    return result.buffer;
}

/**
 * Decrypt data with AES-GCM.
 * @param {ArrayBuffer} encryptedPackage - [12 bytes IV][ciphertext + auth tag]
 * @param {CryptoKey} sharedKey - AES direction key from deriveSessionKeys
 * @returns {Promise<ArrayBuffer>} Decrypted data
 */
export async function decrypt(encryptedPackage, sharedKey) {
    const data = new Uint8Array(encryptedPackage);
    const iv = data.slice(0, 12);
    const encryptedData = data.slice(12);
    return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        sharedKey,
        encryptedData
    );
}
