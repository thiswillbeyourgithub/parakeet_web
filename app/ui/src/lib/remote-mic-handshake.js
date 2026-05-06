/**
 * Shared remote-mic handshake helpers used by both the desktop receiver
 * (App.jsx) and the phone sender (remote-mic-entry.jsx).
 *
 * Built with the help of Claude Code.
 *
 * Centralising this logic ensures:
 *  - Both sides feed the SAME byte order to the fingerprint hash
 *    (receiver-pub first, sender-pub second). The MITM defence is
 *    only useful if both sides agree on this — diverging here would
 *    silently break verification.
 *  - The adaptive fingerprint-length stats fetch can't hang the UI;
 *    a single AbortController + fallback path lives here, not on each
 *    side independently.
 */

import { getPairFingerprint, computeFingerprintLength } from './remote-crypto.js';

const STATS_TIMEOUT_MS = 2000;
const DEFAULT_HEX_LEN = 6;

/**
 * Fetch /api/signal/stats and convert the active-room count into an
 * adaptive hex fingerprint length. Falls back silently to a sensible
 * default on timeout, network error or non-OK response — verification
 * still works, only the length heuristic is approximate.
 *
 * @param {string} [statsUrl='/api/signal/stats']
 * @param {number} [timeoutMs=STATS_TIMEOUT_MS]
 * @returns {Promise<number>} hex length suitable for getPairFingerprint
 */
export async function getAdaptiveFingerprintLength(statsUrl = '/api/signal/stats', timeoutMs = STATS_TIMEOUT_MS) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(statsUrl, { signal: controller.signal });
        if (!resp.ok) return DEFAULT_HEX_LEN;
        const { activeRooms } = await resp.json();
        return computeFingerprintLength(activeRooms || 0);
    } catch {
        return DEFAULT_HEX_LEN;
    } finally {
        clearTimeout(t);
    }
}

/**
 * Compute the verification fingerprint with a fixed receiver-first order
 * regardless of which side the caller is.
 *
 * @param {'receiver'|'sender'} role - 'receiver' = computer, 'sender' = phone
 * @param {CryptoKey} ownPub - the local side's ECDH public key
 * @param {CryptoKey} theirPub - the remote side's ECDH public key
 * @param {number} hexLen
 * @returns {Promise<string>}
 */
export async function computePairFingerprintForRole(role, ownPub, theirPub, hexLen) {
    if (role !== 'receiver' && role !== 'sender') {
        throw new Error(`computePairFingerprintForRole: invalid role ${role}`);
    }
    const receiverPub = role === 'receiver' ? ownPub : theirPub;
    const senderPub = role === 'receiver' ? theirPub : ownPub;
    return getPairFingerprint(receiverPub, senderPub, hexLen);
}
