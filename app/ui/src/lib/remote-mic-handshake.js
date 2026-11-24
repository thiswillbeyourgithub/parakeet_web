/**
 * Shared remote-mic handshake helpers used by both the desktop receiver
 * (hooks/useRemoteMic.js) and the phone sender (remote-mic-entry.jsx).
 *
 * Built with the help of Claude Code.
 *
 * Protocol v4 handshake (plaintext over the relay, then encrypted):
 *   desktop -> phone  {type:'public-key', key, v:4}
 *   phone -> desktop  {type:'sender-public-key', key, v:4}
 *   both derive the session keys from ECDH + the QR secret K (lib/remote-crypto.js)
 *   each side sends {type:'key-confirm'} as its FIRST encrypted control frame
 * A side only binds the session once the peer's key-confirm decrypts. Its
 * AES-GCM tag proves the peer derived the same key, i.e. saw the same two
 * public keys and the same K: that is the transcript MAC, and it is what
 * replaced the human fingerprint comparison of v3.
 */

/**
 * Wire protocol version, announced in the handshake ({type:'public-key', v:4}
 * and {type:'sender-public-key', v:4}). Bump it whenever the two pages stop
 * understanding each other. The phone page is a separate entry point that can
 * sit open in a tab across a deploy (and an old desktop tab can too), so each
 * side refuses a peer announcing another version instead of failing in
 * confusing ways later. 3: control messages moved inside the encryption.
 * 4: QR secret K in the key derivation, key-confirm instead of the code check.
 */
export const REMOTE_MIC_PROTOCOL = 4;

/** Whether a handshake message announces our protocol version. */
export function peerProtocolMatches(msg) {
    return msg?.v === REMOTE_MIC_PROTOCOL;
}

/** The first encrypted control message each side sends. */
export const KEY_CONFIRM = Object.freeze({ type: 'key-confirm' });

/**
 * How long either side waits for the peer's key-confirm after sending its own
 * public key. No human is in the loop any more, so this only has to cover a
 * slow relay round trip.
 */
export const KEY_CONFIRM_TTL_MS = 15000;

/**
 * Await a decision delivered through a resolver the caller registers
 * (typically into a ref read by a message handler), or `false` after
 * `timeoutMs`. Only the first decision counts.
 *
 * @template T
 * @param {(resolve: (value: T) => void) => void} register may call resolve synchronously
 * @param {number} [timeoutMs=KEY_CONFIRM_TTL_MS]
 * @returns {Promise<T|false>}
 */
export function waitForDecision(register, timeoutMs = KEY_CONFIRM_TTL_MS) {
    return new Promise((resolve) => {
        let done = false;
        const finish = (value) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        register(finish);
    });
}

/**
 * Control messages that only travel encrypted, as FRAME_CONTROL frames
 * (lib/remote-mic-frames.js). Either side drops a plaintext copy: it can only
 * come from the relay or from a peer running another protocol, e.g. a relay
 * injecting {type:'audio-settings', gain:0} or {type:'stop'}.
 */
const ENCRYPTED_ONLY_TYPES = new Set([
    'key-confirm',
    // desktop to phone
    'stop-recording', 'stop', 'pause', 'resume', 'audio-settings',
    // phone to desktop
    'audio-config', 'audio-end', 'paused', 'resumed',
]);

/** Whether a plaintext message must be dropped (its type only travels encrypted). */
export function mustBeEncrypted(msg) {
    return ENCRYPTED_ONLY_TYPES.has(msg?.type);
}
