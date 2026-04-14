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
    const binaryString = atob(base64Key);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
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
