/**
 * Signaling server for ParakeetWeb remote microphone feature.
 * Adapted from WebSend (https://github.com/thiswillbeyourgithub/WebSend).
 * Adapted with the help of Claude Code.
 *
 * Provides room management, SDP offer/answer relay, ICE candidate trickle,
 * and TURN credential generation for WebRTC peer connections.
 * Shares the same coturn instance as WebSend via identical TURN_SECRET.
 */

const express = require('express');
const crypto = require('crypto');

const app = express();
// F-144: suppress the default `X-Powered-By: Express` header. Caddy's
// `header { -Server }` strips its own Server header but passes upstream
// headers verbatim, so without this every /api/signal/* response would
// fingerprint the backend stack to drive-by scanners. Restores the F-71
// fingerprint-reduction intent across the reverse proxy.
app.disable('x-powered-by');
const PORT = parseInt(process.env.PORT, 10) || 3001;
const DOMAIN = process.env.DOMAIN || 'localhost';
const DEV = process.env.DEV === '1';

// ============ ICE Server Configuration ============
const STUN_SERVER = process.env.STUN_SERVER || '';
const STUN_GOOGLE_FALLBACK = process.env.STUN_GOOGLE_FALLBACK !== 'false';
const TURN_SERVER = process.env.TURN_SERVER || '';
const TURN_SECRET = process.env.TURN_SECRET || '';
const TURN_CREDENTIAL_TTL = parseInt(process.env.TURN_CREDENTIAL_TTL, 10) || 3600;
const TURN_TIMEOUT = parseInt(process.env.TURN_TIMEOUT, 10) || 15;
const TURNS_PORT = process.env.TURNS_PORT || '';

// ============ HTTPS Relay Configuration ============
// Last-resort fallback for peers whose network blocks both direct WebRTC
// and TURN/TURNS (corporate proxies that strip UDP + the TURNS
// CONNECT upgrade). Ported from WebSend's relay design. Audio chunks are
// already AES-256-GCM encrypted at the application layer (remote-crypto.js)
// so the relay only ever sees opaque ciphertext.
const RELAY_ENABLE = (process.env.RELAY_ENABLE || 'true').toLowerCase() !== 'false';
// 4 GiB hard cap per relay session, matched on both transport halves so a
// hostile peer cannot pump bytes through a single direction without bound.
const RELAY_MAX_TOTAL_SESSION_BYTES = parseInt(process.env.RELAY_MAX_TOTAL_SESSION_BYTES, 10) || 4 * 1024 * 1024 * 1024;
// 16 KiB cap for non-binary frames. Real control messages (verify, ping,
// stop) are <1 KiB; anything larger over a text frame is hostile.
const RELAY_MAX_CONTROL_MSG_BYTES = parseInt(process.env.RELAY_MAX_CONTROL_MSG_BYTES, 10) || 16 * 1024;
// LP /down hold time: long enough to amortise the TCP round-trip on slow
// networks, short enough that an HTTP intermediary's idle-timeout doesn't
// kill it (most corporate proxies allow 30s).
const RELAY_LP_DOWN_TIMEOUT_MS = parseInt(process.env.RELAY_LP_DOWN_TIMEOUT_MS, 10) || 25_000;
// Per-slot incoming queue cap. Oldest is dropped on overflow so a stuck
// receiver cannot blow up the server's memory by silently buffering
// audio chunks the sender keeps pushing.
const RELAY_LP_QUEUE_MAX_FRAMES = parseInt(process.env.RELAY_LP_QUEUE_MAX_FRAMES, 10) || 32;
const RELAY_LP_FRAME_BODY_LIMIT = process.env.RELAY_LP_FRAME_BODY_LIMIT || '256kb';
// Reap an LP slot after this much silence. Slightly above the /down
// hold timeout so a slow consumer that round-trips at the maximum
// interval is still considered live.
const RELAY_LP_SLOT_IDLE_TIMEOUT_MS = parseInt(process.env.RELAY_LP_SLOT_IDLE_TIMEOUT_MS, 10) || 60_000;
const RELAY_WS_PING_INTERVAL_MS = parseInt(process.env.RELAY_WS_PING_INTERVAL_MS, 10) || 20_000;
// 16-byte slot token, distinct from the 16-byte room secret. Compromising
// one slot of a session does not compromise the other; both are scoped
// to room.relay and torn down with the room.
const RELAY_LP_SLOT_TOKEN_BYTES = 16;

/**
 * Debug logging helper - only logs when DEV=1
 */
function debugLog(context, message, data = null) {
    if (!DEV) return;
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    console.log(`[${timestamp}] [DEBUG:${context}] ${message}${dataStr}`);
}

/**
 * Sanitize an attacker-controlled string before interpolating it into
 * a log line. Strips C0/C1 control characters (which include ESC and
 * the ANSI CSI introducer), DEL, and the Unicode bidi-override codepoints
 * so a hostile header value cannot inject terminal control sequences,
 * forge log lines, or reorder displayed text in operator terminal tails.
 * Length-caps to keep log volume bounded.
 */
// U+202A..U+202E: bidi embedding/override (LRE/RLE/PDF/LRO/RLO).
// U+2066..U+2069: bidi isolate marks (LRI/RLI/FSI/PDI).
const BIDI_OVERRIDES = /[‪-‮⁦-⁩]/g;
function sanitizeForLog(s, maxLen = 200) {
    if (typeof s !== 'string') s = String(s ?? '');
    return s
        .replace(/[\x00-\x1F\x7F-\x9F]/g, '?')
        .replace(BIDI_OVERRIDES, '?')
        .slice(0, maxLen);
}

// ============ CORS / Origin Validation ============
// ALLOWED_ORIGINS must be a comma-separated list of full origins, each
// prefixed with http:// or https://. We refuse to guess the scheme — a
// silent http:// default could let a network attacker downgrade the QR
// link and intercept the signaling exchange.
if (!process.env.ALLOWED_ORIGINS) {
    throw new Error('ALLOWED_ORIGINS env var is required (comma-separated, each entry must start with http:// or https://)');
}
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
for (const origin of ALLOWED_ORIGINS) {
    if (!/^https?:\/\//.test(origin)) {
        throw new Error(`ALLOWED_ORIGINS entry "${origin}" must start with http:// or https://`);
    }
}

// Trust proxy headers only from loopback (Caddy/Vite proxy on same host)
app.set('trust proxy', 'loopback');

// CORS middleware, needed because Vite proxy forwards requests.
// The Origin header is non-secret (the browser sets it), so a plain
// String#includes() match is fine, no timing-safe comparison needed.
//
// F-119: CORS runs BEFORE express.json so that OPTIONS preflights
// return 204 without parsing a body. Body parsing is intentionally
// the LAST middleware before per-route handlers so an attacker who
// fails the origin or rate-limit check never pays the JSON.parse
// cost or the 50 KB Buffer allocation.
app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-Room-Secret');
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        // F-150: cache preflight for 10 min so the browser does not refire
        // OPTIONS before every signaling POST (offer / answer / candidate
        // / verify exchanges happen in quick succession). Reduces both
        // round-trip latency on the phone-pair handshake and the volume of
        // requests that would otherwise be counted against the preflight
        // rate limit, without weakening the per-request Origin check that
        // runs on every real call.
        res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
        return res.status(204).send();
    }
    next();
});

/**
 * Middleware to validate Origin header against allowed origins.
 */
function validateOrigin(req, res, next) {
    const origin = req.headers.origin;
    if (origin) {
        if (ALLOWED_ORIGINS.includes(origin)) return next();
        console.warn(`Blocked request from unauthorized origin: ${sanitizeForLog(origin)} (allowed: ${ALLOWED_ORIGINS.join(', ')})`);
        return res.status(403).json({ error: 'Forbidden', message: 'Request origin not allowed' });
    }
    // Browsers omit Origin on same-origin GETs (the long-poll for /answer,
    // the room-existence check on join, etc.), so we can't require it without
    // breaking those flows. Sec-Fetch-Site is browser-set and forbidden to
    // JavaScript-in-a-page, so a malicious cross-origin page CANNOT spoof it
    // (the same-origin gate against malicious sites loaded by the user's
    // browser).
    //
    // F-115: HOWEVER any non-browser client (curl, python requests, a
    // compromised phone with native code, a malicious browser extension
    // running with extended privileges) trivially sets
    // `Sec-Fetch-Site: same-origin` verbatim. So this fallback does NOT
    // gate non-browser callers from the open internet; it only gates
    // browser-CSRF. The defense-in-depth chain is:
    //   - rate limits (F-44/F-117) cap volume per IP + globally
    //   - validateRoomSecret protects every /api/rooms/:id/* route
    //   - F-116 will move /api/config behind validateRoomSecret too,
    //     making `/api/stats` the only Sec-Fetch-Site-bypassable
    //     endpoint with no room-secret gate (low-value: it returns an
    //     active-rooms count, no peer state).
    // We KEEP the fallback because removing it would break legitimate
    // same-origin GETs (validateRoomSecret on room routes still gates
    // the actual auth). The comment above the fallback used to claim
    // "curl can't spoof it"; that was wrong and is corrected here.
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite === 'same-origin') return next();

    console.warn(`Blocked request with no Origin header and sec-fetch-site=${sanitizeForLog(fetchSite || 'absent')}: ${sanitizeForLog(req.method, 16)} ${sanitizeForLog(req.originalUrl, 256)}`);
    return res.status(403).json({ error: 'Forbidden', message: 'Origin header required' });
}

// F-118: apply a coarse per-IP rate limit BEFORE validateOrigin so
// unauthorized requests (no Origin, bad Origin) are also rate-capped.
// Without this an attacker with no valid Origin gets unbounded 403s
// at line-rate, each one costing a log line, an Express trip, and a
// socket write. The cap is well above legitimate peak (a fresh
// browser session triggers <10 /api/* requests in the first minute)
// so real users never hit it.
app.use('/api', rateLimitMiddleware('preflight'));
app.use('/api', validateOrigin);

// F-119: parse JSON bodies AFTER validateOrigin + preflight rate
// limit so an attacker without a valid Origin never reaches the
// body parser. Otherwise express.json reads up to 50 KB and runs
// synchronous JSON.parse for every rejected request, a CPU
// amplification path that the rate limiter alone cannot fully close.
app.use(express.json({ limit: '50kb' }));

// ============ In-memory Room Storage ============
const rooms = new Map();
const ROOM_TTL = 10 * 60 * 1000; // 10 minutes

// ============ Rate Limiting ============
const rateLimiters = new Map();

const RATE_LIMIT_CONFIG = {
    // F-118: coarse per-IP cap applied to /api/* BEFORE any other
    // middleware (including validateOrigin), so unauthorized
    // requests cost an attacker against the same budget as
    // authorized ones. 200/min is two orders of magnitude above a
    // fresh session's peak (~10 /api/* requests in the first
    // minute), so legitimate users never hit it.
    preflight: { windowMs: 60 * 1000, maxRequests: 200 },
    roomCreation: { windowMs: 60 * 1000, maxRequests: 5 },
    roomLookup: { windowMs: 60 * 1000, maxRequests: 30 },
    general: { windowMs: 60 * 1000, maxRequests: 100 },
    // iceConfig gates /api/config which mints time-limited TURN credentials
    // valid against the shared coturn instance for TURN_CREDENTIAL_TTL.
    // A legitimate handshake only fetches once per session, so a tight cap
    // here stops a same-origin script (or a compromised phone after
    // handshake) from harvesting credentials in a loop and turning the
    // operator's TURN server into an open relay. The cap is intentionally
    // well below roomCreation to make harvesting visibly noisier than
    // legitimate use.
    iceConfig: { windowMs: 60 * 1000, maxRequests: 10 }
};

function getClientIp(req) {
    return req.ip || 'unknown';
}

// Global cap on the rateLimiters Map. Each entry is ~200 B, so 10k
// entries cap the bookkeeping memory at ~2 MB even under aggressive
// IPv6 source rotation. When the cap is hit we evict the oldest-
// activity entry on insert so legitimate traffic cannot starve, but
// an attacker rotating /64s can no longer grow the map without
// bound between sweeps.
const RATE_LIMITERS_MAX_ENTRIES = 10_000;

function evictOldestRateLimiter() {
    let oldestKey = null;
    let oldestActivity = Infinity;
    for (const [key, limiter] of rateLimiters.entries()) {
        // blocked entries are kept; they protect against the slot
        // simply being recycled by the same attacker.
        if (limiter.blockedUntil && Date.now() < limiter.blockedUntil) continue;
        const last = limiter.timestamps.length ? limiter.timestamps[limiter.timestamps.length - 1] : 0;
        if (last < oldestActivity) {
            oldestActivity = last;
            oldestKey = key;
        }
    }
    // F-117: when every slot is blocked, the loop above finds no
    // candidate and the function silently no-ops, letting the map
    // grow past RATE_LIMITERS_MAX_ENTRIES (an attacker rotating
    // IPv6 /64s plus a quick burst can saturate all 10k slots with
    // blocked entries, then keep inserting fresh ones until OOM).
    // Fall back to evicting the SINGLE blocked entry with the
    // earliest blockedUntil: it expires soonest anyway, and yielding
    // its slot prevents the cap from being defeated. The
    // recycle-protection rationale only matters per-attacker; the
    // cap is a stronger global invariant.
    if (oldestKey === null) {
        let earliestExpiry = Infinity;
        for (const [key, limiter] of rateLimiters.entries()) {
            if (limiter.blockedUntil && limiter.blockedUntil < earliestExpiry) {
                earliestExpiry = limiter.blockedUntil;
                oldestKey = key;
            }
        }
    }
    if (oldestKey !== null) rateLimiters.delete(oldestKey);
}

function checkRateLimit(ip, limitType) {
    const config = RATE_LIMIT_CONFIG[limitType];
    const now = Date.now();
    const key = `${ip}:${limitType}`;

    if (!rateLimiters.has(key)) {
        if (rateLimiters.size >= RATE_LIMITERS_MAX_ENTRIES) evictOldestRateLimiter();
        rateLimiters.set(key, { timestamps: [], blockedUntil: null });
    }

    const limiter = rateLimiters.get(key);

    if (limiter.blockedUntil && now < limiter.blockedUntil) {
        const retryAfter = Math.ceil((limiter.blockedUntil - now) / 1000);
        return { allowed: false, retryAfter };
    }

    if (limiter.blockedUntil && now >= limiter.blockedUntil) {
        limiter.blockedUntil = null;
        limiter.timestamps = [];
    }

    const windowStart = now - config.windowMs;
    limiter.timestamps = limiter.timestamps.filter(ts => ts > windowStart);

    if (limiter.timestamps.length >= config.maxRequests) {
        limiter.blockedUntil = now + config.windowMs;
        const retryAfter = Math.ceil(config.windowMs / 1000);
        return { allowed: false, retryAfter };
    }

    limiter.timestamps.push(now);
    return { allowed: true, retryAfter: 0 };
}

function rateLimitMiddleware(limitType) {
    return (req, res, next) => {
        const ip = getClientIp(req);
        const result = checkRateLimit(ip, limitType);
        if (!result.allowed) {
            res.set('Retry-After', result.retryAfter);
            return res.status(429).json({ error: 'Too many requests', retryAfter: result.retryAfter });
        }
        next();
    };
}

// Retention is tighter than the longest rate window (60s) so a stale
// limiter is reaped within ~2 minutes of last activity. The sweep
// runs every minute so an IPv6-rotating attacker cannot accumulate
// more than ~60 s × (insert rate) entries between sweeps, which
// together with RATE_LIMITERS_MAX_ENTRIES bounds total memory.
const RATE_LIMITER_MAX_AGE = 2 * 60 * 1000;
const RATE_LIMITER_SWEEP_INTERVAL = 60 * 1000;

function cleanupRateLimiters() {
    const now = Date.now();
    for (const [key, limiter] of rateLimiters.entries()) {
        const hasRecentActivity = limiter.timestamps.some(ts => now - ts < RATE_LIMITER_MAX_AGE);
        const isBlocked = limiter.blockedUntil && now < limiter.blockedUntil;
        if (!hasRecentActivity && !isBlocked) {
            rateLimiters.delete(key);
        }
    }
}

setInterval(cleanupRateLimiters, RATE_LIMITER_SWEEP_INTERVAL);

// ============ Room Helpers ============

function generateRoomId() {
    // 32-char alphabet: pull a random byte, mask to 5 bits (0..31). Each byte
    // maps cleanly to one alphabet index — no modulo bias from 256 % 32.
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const randomBytes = crypto.randomBytes(6);
    let id = '';
    for (let i = 0; i < 6; i++) {
        id += chars[randomBytes[i] & 0x1f];
    }
    return id;
}

function generateRoomSecret() {
    return crypto.randomBytes(16).toString('base64url');
}

function secureCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    // Compare byte lengths, not String#length: a 22-char UTF-16 input
    // can encode to a different number of UTF-8 bytes than the 22-byte
    // base64url secret, which would either bypass the length pre-check
    // and throw RangeError inside crypto.timingSafeEqual, or pass it
    // and run the timing-safe path on differently-sized buffers.
    // Both paths leak timing distinguishable from a same-length wrong
    // secret; the throw also surfaces as a 500 to the caller and
    // pollutes logs.
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

// Dummy secret used to keep the compare path identical when the room
// does not exist. The base64url alphabet matches what generateRoomSecret
// emits so a wrong-alphabet header (F-45) still trips the same branch.
const DUMMY_ROOM_SECRET = crypto.randomBytes(16).toString('base64url');

function validateRoomSecret(req, res, next) {
    // Always return the same shape for "room missing" and "secret wrong"
    // so an unauthenticated client cannot distinguish the two and use
    // the response code as an enumeration oracle over the 30-bit room
    // ID space. Run secureCompare against a dummy secret on the
    // missing-room branch so a timing observer sees the same work.
    const room = rooms.get(req.params.id);
    const providedSecret = req.headers['x-room-secret'];

    if (!room) {
        secureCompare(typeof providedSecret === 'string' ? providedSecret : '', DUMMY_ROOM_SECRET);
        return res.status(401).json({ error: 'Invalid room secret' });
    }

    if (!providedSecret) return res.status(401).json({ error: 'Invalid room secret' });
    if (!secureCompare(providedSecret, room.secret)) return res.status(401).json({ error: 'Invalid room secret' });

    req.room = room;
    next();
}

// ============ Body Validation ============
//
// The signaling server is a dumb relay, but it still hands raw SDP and
// ICE candidate data to peers' WebRTC stacks. Untrusted clients holding a
// valid room secret could otherwise post arbitrarily-shaped JSON, which
// either crashes the receiver's RTCPeerConnection on parse, or silently
// inflates per-room storage with junk. Reject anything that doesn't match
// the minimal expected shape.

const MAX_SDP_BYTES = 16 * 1024;          // real SDPs are ~2-4 kB
const MAX_SDP_LINES = 200;                 // legitimate SDPs are ~30-80 lines
const MAX_SDP_LINE_BYTES = 1024;
const MAX_CANDIDATE_BYTES = 2 * 1024;
const MAX_ICE_CANDIDATES_PER_ROOM = 64;

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// RFC 4566: every SDP line is "<type>=<value>" where <type> is a single
// case-sensitive letter. We accept the letters that real WebRTC SDP
// actually uses (a, b, c, e, i, k, m, o, p, r, s, t, u, v, z). Anything
// outside this alphabet is malformed by spec and refused, both to
// shield the peer's parser from line-kind confusion and to prevent
// future SDP attribute injection from working through this relay.
const SDP_LINE_RE = /^[abceikmoprstuvz]=.*$/;

// ICE candidate top line per RFC 5245 section 15.1:
//   candidate:<foundation> <component> <transport> <priority> <connaddr> <port> typ <type>[ ...]
// Empty string is the end-of-candidates sentinel that browsers send to
// flush trickle ICE, and must be allowed.
const ICE_CANDIDATE_RE = /^candidate:[A-Za-z0-9+/=._-]{1,64} \d{1,3} (udp|tcp|UDP|TCP) \d{1,10} [A-Za-z0-9.:_-]{1,128} \d{1,5} typ (host|srflx|prflx|relay)( .*)?$/;

function validateSdp(body) {
    if (!isPlainObject(body)) return 'body must be a JSON object';
    if (body.type !== 'offer' && body.type !== 'answer') return 'invalid type';
    if (typeof body.sdp !== 'string' || !body.sdp.length) return 'missing sdp';
    if (Buffer.byteLength(body.sdp, 'utf8') > MAX_SDP_BYTES) return 'sdp too large';

    // Structural pass: line-by-line shape check before this string is
    // ever fed to a peer's RTCPeerConnection. Cheap defense in depth
    // against (a) oversized fmtp/rtpmap floods that trip O(n²) parsers,
    // (b) non-SDP attribute-shaped lines, (c) bare-LF separator tricks.
    // Strip a single trailing \r\n so legitimately well-formed SDPs
    // don't trip the "empty trailing line" check; real WebRTC SDPs
    // typically end with one. Disallow embedded NUL bytes which some
    // parsers handle inconsistently.
    if (body.sdp.indexOf('\0') !== -1) return 'sdp contains NUL';
    const lines = body.sdp.replace(/\r\n$/, '').split(/\r\n|\n/);
    if (lines.length > MAX_SDP_LINES) return 'too many sdp lines';
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (Buffer.byteLength(line, 'utf8') > MAX_SDP_LINE_BYTES) return `sdp line ${i} too long`;
        if (!SDP_LINE_RE.test(line)) return `invalid sdp line ${i}`;
    }
    // Required prelude: v=, o=, s=, t= at the top per RFC 4566. Order is
    // fixed; checking the first lines catches most malformed-prelude
    // attempts without re-implementing the whole grammar.
    if (!lines[0]?.startsWith('v=')) return 'missing v= line';
    if (!lines[1]?.startsWith('o=')) return 'missing o= line';
    if (!lines[2]?.startsWith('s=')) return 'missing s= line';

    return null;
}

function validateIceCandidate(body) {
    if (!isPlainObject(body)) return 'body must be a JSON object';
    // RTCIceCandidate.toJSON() always has a string 'candidate' field
    // (possibly empty for end-of-candidates), and optional sdpMid / sdpMLineIndex.
    if (typeof body.candidate !== 'string') return 'missing candidate';
    if (Buffer.byteLength(body.candidate, 'utf8') > MAX_CANDIDATE_BYTES) return 'candidate too large';
    if (body.candidate.indexOf('\0') !== -1) return 'candidate contains NUL';
    if (/[\r\n]/.test(body.candidate)) return 'candidate contains line break';
    // Empty string is the trickle-ICE end-of-candidates sentinel.
    if (body.candidate !== '' && !ICE_CANDIDATE_RE.test(body.candidate)) {
        return 'invalid candidate format';
    }
    if (body.sdpMid != null) {
        if (typeof body.sdpMid !== 'string') return 'invalid sdpMid';
        if (body.sdpMid.length > 32) return 'sdpMid too long';
        if (!/^[A-Za-z0-9._-]*$/.test(body.sdpMid)) return 'invalid sdpMid charset';
    }
    if (body.sdpMLineIndex != null) {
        if (typeof body.sdpMLineIndex !== 'number') return 'invalid sdpMLineIndex';
        if (!Number.isInteger(body.sdpMLineIndex) || body.sdpMLineIndex < 0 || body.sdpMLineIndex > 32) {
            return 'invalid sdpMLineIndex range';
        }
    }
    return null;
}

function cleanupRooms() {
    const now = Date.now();
    for (const [id, room] of rooms.entries()) {
        if (now - room.created > ROOM_TTL) {
            // Wake any pending long-pollers so they stop holding refs to the room.
            if (room.answerWaiters) {
                for (const wake of room.answerWaiters) wake();
                room.answerWaiters.clear();
            }
            // Tear down any open relay slots so dangling WS or LP peers
            // do not outlive the room entry they reference.
            if (room.relay) {
                for (const slotName of ['a', 'b']) {
                    const s = room.relay[slotName];
                    if (!s) continue;
                    if (s.kind === 'lp') {
                        closeLpSlot(s, 'Room expired');
                    } else if (s.readyState !== s.CLOSED) {
                        try { s.close(1001, 'Room expired'); } catch (_) { /* ignore */ }
                    }
                }
                room.relay = null;
            }
            rooms.delete(id);
            console.log(`Room ${id} expired and removed`);
        }
    }
}

setInterval(cleanupRooms, 60 * 1000);

// ============ Relay Slot Helpers ============
// Two slot kinds share the same room.relay[a|b] structure:
//   - LP slot: { kind: 'lp', token, slotName, queue, waiters, closed,
//                idleTimer, roomRef }
//   - WS slot: the raw WebSocket object, augmented with kind='ws',
//                isAlive (heartbeat), and slotName.
// Helpers operate on either kind via the `kind` discriminator so the
// pairing logic in /up, /down, and the WS upgrade handler stays uniform.

// Global LP waiter caps. Mirrored from WebSend so a peer holding a valid
// secret cannot pin many concurrent 25s polls (per-slot cap caps the
// hostile peer, global cap caps the whole process).
const RELAY_MAX_WAITERS_PER_SLOT = 4;
const RELAY_MAX_TOTAL_WAITERS = 10_000;
let _relayTotalWaiters = 0;

// Set of live WS relay sockets that participate in the heartbeat sweep.
// Populated by attachRelay, drained by close and the heartbeat itself.
const _relayWsLive = new Set();

function armLpIdleTimer(slot) {
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = setTimeout(() => {
        const room = slot.roomRef && slot.roomRef.deref && slot.roomRef.deref();
        closeLpSlot(slot, 'idle');
        if (room && room.relay && room.relay[slot.slotName] === slot) {
            room.relay[slot.slotName] = null;
            const peer = slot.slotName === 'a' ? room.relay.b : room.relay.a;
            teardownPeer(peer, 'Peer idle');
        }
    }, RELAY_LP_SLOT_IDLE_TIMEOUT_MS);
    // unref so a half-open slot does not keep the process alive at shutdown.
    if (slot.idleTimer.unref) slot.idleTimer.unref();
}

function closeLpSlot(slot, reason) {
    if (slot.closed) return;
    slot.closed = true;
    if (slot.idleTimer) { clearTimeout(slot.idleTimer); slot.idleTimer = null; }
    // Drain pending waiters with a 410 Gone signal so the client knows
    // the slot is dead and can stop polling.
    const waiters = slot.waiters.splice(0);
    for (const w of waiters) w.gone(reason);
}

function teardownPeer(peer, reason) {
    if (!peer) return;
    if (peer.kind === 'lp') {
        closeLpSlot(peer, reason);
        // Also null out the LP slot's room.relay reference so a fresh
        // /relay/handshake can reclaim it immediately. Without this the
        // closed LP slot lingers in room.relay until the idle timer
        // fires, which makes the room appear "slots full" (409) and
        // rejects up/down with 410 for up to a minute after a cross-kind
        // disconnect (e.g. a WS half closing while its LP peer is still
        // nominally present).
        const room = peer.roomRef && peer.roomRef.deref && peer.roomRef.deref();
        if (room && room.relay && peer.slotName && room.relay[peer.slotName] === peer) {
            room.relay[peer.slotName] = null;
        }
    } else if (peer.readyState !== peer.CLOSED) {
        try { peer.close(1000, reason); } catch (_) { /* ignore */ }
    }
}

function deliverToPeer(peerSlot, data, isBinary) {
    if (!peerSlot) return;
    if (peerSlot.kind === 'lp') {
        if (peerSlot.closed) return;
        if (peerSlot.queue.length >= RELAY_LP_QUEUE_MAX_FRAMES) {
            // Drop oldest under overflow so a stuck consumer cannot pin
            // unbounded memory on the server. The protocol is interactive
            // and dropped audio frames result in a perceptible glitch on
            // the receiver, not a stuck session.
            peerSlot.queue.shift();
        }
        peerSlot.queue.push({ data, isBinary });
        const w = peerSlot.waiters.shift();
        if (w) {
            const next = peerSlot.queue.shift();
            w.send(next);
        }
        return;
    }
    // WS slot: forward verbatim. ws.send is async but errors propagate
    // via the 'error' event handler attached in attachRelay.
    if (peerSlot.readyState === peerSlot.OPEN) {
        try { peerSlot.send(data, { binary: isBinary }); } catch (_) { /* ignore */ }
    }
}

// ============ TURN Credential Generation ============

/**
 * Generate time-based TURN credentials using HMAC-SHA1.
 * Same algorithm as WebSend, both apps share the same coturn instance.
 */
function generateTurnCredentials() {
    const expiryTime = Math.floor(Date.now() / 1000) + TURN_CREDENTIAL_TTL;
    const randomId = crypto.randomBytes(4).toString('hex');
    const username = `${expiryTime}:${randomId}`;
    const credential = crypto
        .createHmac('sha1', TURN_SECRET)
        .update(username)
        .digest('base64');
    return { username, credential };
}

// F-116: global cap on TURN credential issuance, irrespective of source
// IP. The per-IP iceConfig limiter caps a single source to 10/min but
// an attacker rotating IPv6 /64s (2^64 source addresses) trivially
// escapes that bucket and harvests credentials without bound, turning
// the operator's coturn into an open relay (and bleeding bandwidth of
// the shared-with-WebSend coturn). 200/min total is two orders of
// magnitude above legitimate peak (1 credential per session start), so
// real users are never throttled but a flood is rate-capped at the
// equivalent of ~3 fresh credential sets per second. Each credential
// is valid for TURN_CREDENTIAL_TTL (3600 s by default), so the
// steady-state attacker harvest rate is bounded.
//
// Architectural fix (option b from the F-116 mitigation note) is to
// mint credentials at room creation and stop exposing /api/config
// unauthenticated; that is a non-trivial client refactor left for a
// future iteration. This global bucket is the bounded-blast-radius
// surgical fix.
const TURN_GLOBAL_WINDOW_MS = 60 * 1000;
const TURN_GLOBAL_MAX_PER_WINDOW = 200;
const _turnIssueTimestamps = [];
function tryConsumeTurnGlobalQuota() {
    const now = Date.now();
    const windowStart = now - TURN_GLOBAL_WINDOW_MS;
    while (_turnIssueTimestamps.length && _turnIssueTimestamps[0] < windowStart) {
        _turnIssueTimestamps.shift();
    }
    if (_turnIssueTimestamps.length >= TURN_GLOBAL_MAX_PER_WINDOW) {
        return false;
    }
    _turnIssueTimestamps.push(now);
    return true;
}

// ============ API Endpoints ============

app.get('/api/config', rateLimitMiddleware('iceConfig'), (req, res) => {
    const iceServers = [];

    if (STUN_SERVER) {
        iceServers.push({ urls: `stun:${STUN_SERVER}` });
        debugLog('CONFIG', `Using self-hosted STUN: ${STUN_SERVER}`);
    }

    if (STUN_GOOGLE_FALLBACK) {
        iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
    }

    if (TURN_SERVER && TURN_SECRET) {
        // F-116: do not mint credentials when the global per-minute
        // quota is exhausted. Returning STUN-only iceServers is a
        // soft-fail: legitimate users on the same minute will still
        // get a working WebRTC session when the peer is reachable
        // directly, and only fail when a relay is genuinely required.
        // A loud server-side log makes the rate-cap visible to the
        // operator.
        if (!tryConsumeTurnGlobalQuota()) {
            console.warn(`[TURN] global issuance quota exhausted (${TURN_GLOBAL_MAX_PER_WINDOW}/min); returning STUN-only iceServers for ip=${sanitizeForLog(getClientIp(req))}`);
        } else {
            const { username, credential } = generateTurnCredentials();
            iceServers.push({
                urls: [
                    `turn:${TURN_SERVER}?transport=udp`,
                    `turn:${TURN_SERVER}?transport=tcp`,
                    ...(TURNS_PORT ? [`turns:${TURN_SERVER.replace(/:\d+$/, ':' + TURNS_PORT)}?transport=tcp`] : [])
                ],
                username,
                credential
            });
            debugLog('CONFIG', `Using TURN server: ${TURN_SERVER}${TURNS_PORT ? ` (TURNS on port ${TURNS_PORT})` : ''}`);
        }
    } else if (TURN_SERVER && !TURN_SECRET) {
        console.warn('TURN_SERVER is set but TURN_SECRET is missing. TURN will not be available.');
    }

    if (iceServers.length === 0) {
        console.warn('No ICE servers configured! WebRTC connections will likely fail.');
    }

    res.json({
        iceServers,
        dev: DEV,
        turnTimeout: TURN_TIMEOUT
    });
});

// Create a new room
app.post('/api/rooms', rateLimitMiddleware('roomCreation'), (req, res) => {
    let roomId;
    do {
        roomId = generateRoomId();
    } while (rooms.has(roomId));

    const secret = generateRoomSecret();

    rooms.set(roomId, {
        created: Date.now(),
        secret,
        offer: null,
        answer: null,
        iceCandidatesOffer: [],
        iceCandidatesAnswer: [],
        // Pending long-poll responses waiting for an answer; cleared when
        // an answer arrives or the room is cleaned up.
        answerWaiters: new Set(),
        // Lazy-initialised relay state. When either peer claims a slot
        // (LP handshake or WS upgrade) this becomes
        //   { a: <slot|null>, b: <slot|null>, sessionBytes: <number> }
        // sessionBytes is the running total of forwarded payload bytes,
        // capped at RELAY_MAX_TOTAL_SESSION_BYTES.
        relay: null
    });

    console.log(`Room ${roomId} created`);
    debugLog('ROOM', 'Room created', { roomId, clientIp: getClientIp(req) });
    res.json({ roomId, secret });
});

// Store SDP offer
app.post('/api/rooms/:id/offer', rateLimitMiddleware('general'), validateRoomSecret, (req, res) => {
    const err = validateSdp(req.body);
    if (err) return res.status(400).json({ error: err });
    req.room.offer = { type: req.body.type, sdp: req.body.sdp };
    debugLog('SIGNALING', `Offer stored for room ${req.params.id}`);
    res.json({ success: true });
});

// Get SDP offer
app.get('/api/rooms/:id/offer', rateLimitMiddleware('roomLookup'), validateRoomSecret, (req, res) => {
    if (!req.room.offer) return res.status(404).json({ error: 'Offer not ready yet' });
    res.json(req.room.offer);
});

// Store SDP answer
app.post('/api/rooms/:id/answer', rateLimitMiddleware('general'), validateRoomSecret, (req, res) => {
    const err = validateSdp(req.body);
    if (err) return res.status(400).json({ error: err });
    req.room.answer = { type: req.body.type, sdp: req.body.sdp };
    // Wake up any pending long-pollers immediately so their timers stop.
    if (req.room.answerWaiters) {
        for (const wake of req.room.answerWaiters) wake();
        req.room.answerWaiters.clear();
    }
    debugLog('SIGNALING', `Answer stored for room ${req.params.id}`);
    res.json({ success: true });
});

// Get SDP answer (long-polling). Rate-limited so a peer holding a valid room
// secret cannot pin many concurrent 30s polls and exhaust file descriptors.
app.get('/api/rooms/:id/answer', rateLimitMiddleware('roomLookup'), validateRoomSecret, async (req, res) => {
    if (req.room.answer) return res.json(req.room.answer);

    if (req.query.wait === 'true') {
        const timeout = 30000;
        const roomId = req.params.id;
        const room = req.room;
        let pendingTimer = null;
        let finished = false;

        const finish = (fn) => {
            if (finished) return;
            finished = true;
            if (pendingTimer) clearTimeout(pendingTimer);
            room.answerWaiters?.delete(wake);
            fn();
        };

        // Notification path: POST /answer flushes the waiter set, calling
        // wake() which resolves immediately instead of waiting for the next tick.
        const wake = () => finish(() => {
            const currentRoom = rooms.get(roomId);
            if (!currentRoom) return res.status(404).json({ error: 'Room not found' });
            if (currentRoom.answer) return res.json(currentRoom.answer);
            return res.status(204).send();
        });

        room.answerWaiters?.add(wake);

        // Backstop timeout — also covers the case where the room is GC'd.
        pendingTimer = setTimeout(() => finish(() => {
            const currentRoom = rooms.get(roomId);
            if (!currentRoom) return res.status(404).json({ error: 'Room not found' });
            if (currentRoom.answer) return res.json(currentRoom.answer);
            return res.status(204).send();
        }), timeout);

        // If the client disconnects, drop the waiter so we don't leak refs.
        req.on('close', () => finish(() => {}));
    } else {
        res.status(204).send();
    }
});

// ICE candidates for offer side
app.post('/api/rooms/:id/ice/offer', rateLimitMiddleware('general'), validateRoomSecret, (req, res) => {
    const err = validateIceCandidate(req.body);
    if (err) return res.status(400).json({ error: err });
    if (req.room.iceCandidatesOffer.length >= MAX_ICE_CANDIDATES_PER_ROOM) {
        return res.status(429).json({ error: 'too many ICE candidates' });
    }
    req.room.iceCandidatesOffer.push({
        candidate: req.body.candidate,
        sdpMid: req.body.sdpMid ?? null,
        sdpMLineIndex: req.body.sdpMLineIndex ?? null,
    });
    debugLog('ICE', `Offer ICE candidate added for room ${req.params.id}`);
    res.json({ success: true });
});

app.get('/api/rooms/:id/ice/offer', rateLimitMiddleware('roomLookup'), validateRoomSecret, (req, res) => {
    res.json({ candidates: req.room.iceCandidatesOffer });
});

// ICE candidates for answer side
app.post('/api/rooms/:id/ice/answer', rateLimitMiddleware('general'), validateRoomSecret, (req, res) => {
    const err = validateIceCandidate(req.body);
    if (err) return res.status(400).json({ error: err });
    if (req.room.iceCandidatesAnswer.length >= MAX_ICE_CANDIDATES_PER_ROOM) {
        return res.status(429).json({ error: 'too many ICE candidates' });
    }
    req.room.iceCandidatesAnswer.push({
        candidate: req.body.candidate,
        sdpMid: req.body.sdpMid ?? null,
        sdpMLineIndex: req.body.sdpMLineIndex ?? null,
    });
    debugLog('ICE', `Answer ICE candidate added for room ${req.params.id}`);
    res.json({ success: true });
});

app.get('/api/rooms/:id/ice/answer', rateLimitMiddleware('roomLookup'), validateRoomSecret, (req, res) => {
    res.json({ candidates: req.room.iceCandidatesAnswer });
});

// Check room exists
app.get('/api/rooms/:id', rateLimitMiddleware('roomLookup'), validateRoomSecret, (req, res) => {
    res.json({
        exists: true,
        hasOffer: !!req.room.offer,
        hasAnswer: !!req.room.answer
    });
});

// Active room count. Rate-limited (general bucket) so the counter
// cannot be polled at high frequency to enumerate room-creation
// timing or to grow rateLimiters Map entries without any per-IP cost.
app.get('/api/stats', rateLimitMiddleware('general'), (req, res) => {
    res.json({ activeRooms: rooms.size });
});

// ============ Start Server ============
//
// Slowloris-style request-body smuggling: Node's HTTP server has no
// default body-read timeout, only a 60 s headersTimeout. Without an
// overall request timeout, a peer that opens many concurrent POSTs
// and dribbles the JSON body at sub-second cadence holds open one FD
// + one rate-limiter slot per connection, exhausting the process FD
// table well before the per-IP rate cap bites. server.requestTimeout
// caps the wall-clock time the server will spend reading any single
// request; keepAliveTimeout caps idle keep-alive sockets so an
// attacker cannot just reuse them as parking spots.
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(50));
    console.log('  ParakeetWeb Signaling Server');
    console.log('='.repeat(50));
    console.log(`  PORT: ${PORT}`);
    console.log(`  DOMAIN: ${DOMAIN}`);
    console.log(`  DEV: ${DEV}`);
    console.log(`  STUN_SERVER: ${STUN_SERVER || '(none)'}`);
    console.log(`  STUN_GOOGLE_FALLBACK: ${STUN_GOOGLE_FALLBACK}`);
    console.log(`  TURN_SERVER: ${TURN_SERVER || '(none)'}`);
    console.log(`  TURN_SECRET: ${TURN_SECRET ? '(set)' : '(not set)'}`);
    console.log(`  TURN_CREDENTIAL_TTL: ${TURN_CREDENTIAL_TTL}`);
    console.log(`  TURNS_PORT: ${TURNS_PORT || '(none)'}`);
    console.log(`  ALLOWED_ORIGINS: ${ALLOWED_ORIGINS.join(', ')}`);
    console.log(`  RELAY_ENABLE: ${RELAY_ENABLE}`);
    if (RELAY_ENABLE) {
        console.log(`  RELAY_MAX_TOTAL_SESSION_BYTES: ${RELAY_MAX_TOTAL_SESSION_BYTES}`);
        console.log(`  RELAY_MAX_CONTROL_MSG_BYTES: ${RELAY_MAX_CONTROL_MSG_BYTES}`);
        console.log(`  RELAY_LP_DOWN_TIMEOUT_MS: ${RELAY_LP_DOWN_TIMEOUT_MS}`);
        console.log(`  RELAY_LP_QUEUE_MAX_FRAMES: ${RELAY_LP_QUEUE_MAX_FRAMES}`);
        console.log(`  RELAY_LP_FRAME_BODY_LIMIT: ${RELAY_LP_FRAME_BODY_LIMIT}`);
        console.log(`  RELAY_LP_SLOT_IDLE_TIMEOUT_MS: ${RELAY_LP_SLOT_IDLE_TIMEOUT_MS}`);
        console.log(`  RELAY_WS_PING_INTERVAL_MS: ${RELAY_WS_PING_INTERVAL_MS}`);
    }
    console.log('-'.repeat(50));
    console.log(`  Listening on 0.0.0.0:${PORT}`);

    if (!STUN_SERVER && !STUN_GOOGLE_FALLBACK && !TURN_SERVER) {
        console.log('  WARNING: No ICE servers configured!');
    }
    if (TURN_SERVER && !TURN_SECRET) {
        console.log('  WARNING: TURN_SERVER set but TURN_SECRET missing.');
    }
    console.log('='.repeat(50));
});

// 30 s is the long-poll budget for /api/rooms/:id/answer (the only
// legitimate endpoint that holds a request open). Use 35 s here so
// the backstop timer fires before the server-level cap. The answer
// long-poll already calls res.send() at the timer mark so it is not
// affected by this cap in practice.
server.requestTimeout = 35_000;
// Headers must arrive promptly. Node default is 60 s; tighten it.
server.headersTimeout = 10_000;
// Keep-alive idle sockets are recycled fast so an attacker cannot
// park many cheap FDs.
server.keepAliveTimeout = 5_000;
