import { isQrSecret } from './remote-crypto.js';

/**
 * Parse a remote-mic URL fragment `ROOM:SECRET:K` (leading '#' optional).
 * ROOM is before the first ':', K after the last one, SECRET in between, so a
 * future SECRET alphabet containing ':' still parses. K must be a well-formed
 * QR secret: a v3 link (no K) is refused, the v4 key derivation needs it.
 * Example: 'ab12:s3cr3t:q3V0d2l0aC1jbGF1ZGUtY2' ->
 *   { roomId: 'ab12', secret: 's3cr3t', qrSecret: 'q3V0d2l0aC1jbGF1ZGUtY2' }
 *
 * @param {string} hash
 * @returns {{ roomId: string, secret: string, qrSecret: string } | null}
 */
export function parseRemoteMicHash(hash) {
    if (typeof hash !== 'string') return null;
    const h = hash.startsWith('#') ? hash.slice(1) : hash;
    const first = h.indexOf(':');
    const last = h.lastIndexOf(':');
    if (first < 0 || last === first) return null;
    const roomId = h.slice(0, first);
    const secret = h.slice(first + 1, last);
    const qrSecret = h.slice(last + 1);
    if (!roomId || !secret || !isQrSecret(qrSecret)) return null;
    return { roomId, secret, qrSecret };
}

/**
 * Parse and validate a scanned remote-mic QR payload.
 * Built with the help of Claude Code.
 *
 * The desktop's QR encodes the full phone URL:
 *   `<origin>/remote-mic.html#<roomId>:<secret>:<K>`
 * To reconnect we need the room id, secret and QR secret K, but we must not blindly
 * trust an arbitrary scanned string. A stray or hostile QR could:
 *   - point at a different origin (whose signaling API we could never reach,
 *     since it is same-origin) — reject early and clearly rather than spin;
 *   - carry a malformed or empty hash.
 * This returns { roomId, secret, qrSecret } only for a well-formed, same-origin
 * remote-mic link, and null otherwise.
 *
 * @param {string} text - Raw decoded QR text.
 * @param {string} currentOrigin - window.location.origin to match against. When
 *   falsy the origin check is skipped (only used by tests).
 * @returns {{ roomId: string, secret: string, qrSecret: string } | null}
 */
export function parseRemoteMicLink(text, currentOrigin) {
    if (typeof text !== 'string') return null;
    // A QR can hold a lot of data; cap the input so a pathological payload
    // can't push a megabyte into URL parsing / state.
    if (text.length > 2048) return null;

    let url;
    try {
        url = new URL(text.trim());
    } catch {
        return null;
    }

    // Same-origin only: the signaling API the phone talks to is same-origin,
    // so a link to any other origin could never connect. Matching also guards
    // against accidentally scanning an unrelated QR code.
    if (currentOrigin && url.origin !== currentOrigin) return null;

    // Must be the phone page. endsWith('/remote-mic.html') matches both the
    // root deployment and a sub-path one while rejecting e.g. evil-remote-mic.html.
    if (!url.pathname.endsWith('/remote-mic.html')) return null;

    return parseRemoteMicHash(url.hash);
}
