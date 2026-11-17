/**
 * fetch() for requests to the signaling server that carry a room secret.
 *
 * Redirects are refused (`redirect: 'error'`). A browser re-sends custom
 * headers such as X-Room-Secret, and the body, when it follows a redirect,
 * so a 307 from a misconfigured or hostile proxy in front of the signaling
 * server (example: 307 Location: https://elsewhere.example/collect) would
 * hand the room secret and the SDP/relay payload to another origin. The
 * signaling API never redirects, so failing loudly costs nothing.
 *
 * Built with Claude Code.
 *
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<Response>}
 */
export function signalingFetch(url, opts = {}) {
    return fetch(url, { ...opts, redirect: 'error' });
}
