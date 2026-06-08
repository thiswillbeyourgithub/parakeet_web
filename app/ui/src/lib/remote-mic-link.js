/**
 * Parse and validate a scanned remote-mic QR payload.
 * Built with the help of Claude Code.
 *
 * The desktop's QR encodes the full phone URL:
 *   `<origin>/remote-mic.html#<roomId>:<secret>`
 * To reconnect we only need the room id and secret, but we must not blindly
 * trust an arbitrary scanned string. A stray or hostile QR could:
 *   - point at a different origin (whose signaling API we could never reach,
 *     since it is same-origin) — reject early and clearly rather than spin;
 *   - carry a malformed or empty hash.
 * This returns { roomId, secret } only for a well-formed, same-origin
 * remote-mic link, and null otherwise.
 *
 * @param {string} text - Raw decoded QR text.
 * @param {string} currentOrigin - window.location.origin to match against. When
 *   falsy the origin check is skipped (only used by tests).
 * @returns {{ roomId: string, secret: string } | null}
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

    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const sep = hash.indexOf(':');
    if (sep < 0) return null;
    const roomId = hash.slice(0, sep);
    const secret = hash.slice(sep + 1);
    if (!roomId || !secret) return null;
    return { roomId, secret };
}
