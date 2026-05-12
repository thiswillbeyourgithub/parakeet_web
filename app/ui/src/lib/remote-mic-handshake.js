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
// Fail-safe fingerprint length used whenever the stats response is missing,
// malformed, late, or otherwise untrustworthy. We pick the longest length the
// crypto layer supports so a misbehaving (or compromised) stats endpoint can
// never silently shrink the verification code: the worst case is "user reads
// a slightly longer code", never "the fingerprint is too short to detect a
// MITM swap." Defense in depth even though signaling is currently trusted.
// 16 hex = 64 bits; matches the computeFingerprintLength floor in
// remote-crypto.js. Anything shorter is brute-forceable in seconds by
// a signaling-MITM attacker who runs ECDH-and-hash in a loop until
// they find a public key whose pair-fingerprint matches what they
// need the user to see (F-65).
const SAFE_FALLBACK_HEX_LEN = 16;

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
        if (!resp.ok) return SAFE_FALLBACK_HEX_LEN;
        const data = await resp.json();
        // Only widen the fingerprint down when activeRooms is an explicit
        // non-negative integer; missing or non-numeric -> longest length.
        if (!data || !Number.isInteger(data.activeRooms) || data.activeRooms < 0) {
            return SAFE_FALLBACK_HEX_LEN;
        }
        return computeFingerprintLength(data.activeRooms);
    } catch {
        return SAFE_FALLBACK_HEX_LEN;
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
