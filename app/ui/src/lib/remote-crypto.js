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
    if (typeof base64Key !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Key)) {
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
 * Derive a shared AES-256 key from ECDH key agreement + HKDF.
 * @param {CryptoKey} privateKey - Our ECDH private key
 * @param {CryptoKey} theirPublicKey - Their ECDH public key
 * @returns {Promise<CryptoKey>} AES-GCM-256 key
 */
export async function deriveSharedKey(privateKey, theirPublicKey) {
    const sharedSecret = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: theirPublicKey },
        privateKey,
        256
    );

    const hkdfKey = await crypto.subtle.importKey(
        'raw', sharedSecret, 'HKDF', false, ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            // Domain-separated from WebSend to avoid key reuse across apps
            salt: new TextEncoder().encode('ParakeetWeb-RemoteMic-v1'),
            info: new TextEncoder().encode('AES-GCM-256-key')
        },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt data with AES-GCM. Each call uses a fresh random IV.
 * @param {ArrayBuffer} data - Data to encrypt
 * @param {CryptoKey} sharedKey - AES key from deriveSharedKey
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
 * @param {CryptoKey} sharedKey - AES key from deriveSharedKey
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

/**
 * Compute a short SHA-256 fingerprint over a deterministic concatenation of
 * both peers' raw ECDH public keys. Both sides feed bytes in the same order
 * (receiver-pub first, sender-pub second) so the resulting code is identical
 * on both screens — letting users compare verbally and detect a malicious
 * signaling server that has swapped keys for a MITM.
 *
 * Adapted from WebSend's getKeyFingerprint (https://github.com/thiswillbeyourgithub/WebSend).
 *
 * @param {CryptoKey} receiverPub - Receiver/computer ECDH public key
 * @param {CryptoKey} senderPub - Sender/phone ECDH public key
 * @param {number} [hexLength=16] - Number of hex characters (clamped to [16, 64])
 * @returns {Promise<string>} Hex fingerprint grouped as XXXX-XXXX-...
 *
 * F-80: the clamp ceiling used to be 12 hex (48 bits), which silently
 * defeated the F-65 fix that raised callers to 16. A signaling-MITM
 * attacker grinding ECDH+SHA-256 second-preimages can hit 48 bits in
 * seconds on a laptop. The clamp now floors at 16 (matching the
 * computeFingerprintLength return and SAFE_FALLBACK_HEX_LEN in
 * remote-mic-handshake.js) and ceilings at 64 (full SHA-256 output).
 */
export async function getPairFingerprint(receiverPub, senderPub, hexLength = 16) {
    const len = Math.max(16, Math.min(64, Math.floor(hexLength)));
    const aBytes = new Uint8Array(await crypto.subtle.exportKey('raw', receiverPub));
    const bBytes = new Uint8Array(await crypto.subtle.exportKey('raw', senderPub));
    const combined = new Uint8Array(aBytes.length + bBytes.length);
    combined.set(aBytes, 0);
    combined.set(bBytes, aBytes.length);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));
    const bytesNeeded = Math.ceil(len / 2);
    const hex = Array.from(hash.slice(0, bytesNeeded))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()
        .slice(0, len);
    const groups = [];
    for (let i = 0; i < hex.length; i += 4) groups.push(hex.slice(i, i + 4));
    return groups.join('-');
}

/**
 * Adaptive fingerprint length based on active room count (birthday-bound).
 * Verbatim from WebSend.
 * - 1-10 rooms:    3 hex chars
 * - 11-100 rooms:  6 hex chars
 * - 101-1000:      9 hex chars
 * - 1000+:        12 hex chars
 *
 * NOTE: The adaptive length is now floored at 16 hex (64 bits)
 * regardless of activeRooms. Birthday-bound reasoning assumes random
 * peer pairings, but a signaling-MITM attacker is doing a TARGETED
 * second-preimage search against the specific fingerprint they want
 * the user to see. At ~10^6 ECDH+SHA-256 ops per second on commodity
 * hardware, anything below ~48 bits is laptop-trivial; the adaptive
 * floor used to be 3 hex (12 bits = 4096 outcomes) which is sub-
 * second to brute-force. 16 hex (64 bits) is the recognised floor for
 * verbal-comparison fingerprints (Signal uses 60-digit decimal, OTR
 * uses 40-hex / 160 bits). The activeRooms input is kept in the
 * signature for compatibility but no longer influences the result.
 *
 * @param {number} _activeRooms unused; kept for API stability
 * @returns {number}
 */
export function computeFingerprintLength(_activeRooms) {
    return 16;
}
