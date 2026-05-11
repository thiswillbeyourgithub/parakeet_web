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

// Parse JSON bodies
app.use(express.json({ limit: '50kb' }));

// CORS middleware — needed because Vite proxy forwards requests.
// The Origin header is non-secret (the browser sets it), so a plain
// String#includes() match is fine — no timing-safe comparison needed.
app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-Room-Secret');
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    // JavaScript, so curl/server-to-server callers (the SSRF/credential-leak
    // concern) can't spoof it: same-origin in that header is a reliable
    // browser-issued same-origin signal.
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite === 'same-origin') return next();

    console.warn(`Blocked request with no Origin header and sec-fetch-site=${sanitizeForLog(fetchSite || 'absent')}: ${sanitizeForLog(req.method, 16)} ${sanitizeForLog(req.originalUrl, 256)}`);
    return res.status(403).json({ error: 'Forbidden', message: 'Origin header required' });
}

app.use('/api', validateOrigin);

// ============ In-memory Room Storage ============
const rooms = new Map();
const ROOM_TTL = 10 * 60 * 1000; // 10 minutes

// ============ Rate Limiting ============
const rateLimiters = new Map();

const RATE_LIMIT_CONFIG = {
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
            rooms.delete(id);
            console.log(`Room ${id} expired and removed`);
        }
    }
}

setInterval(cleanupRooms, 60 * 1000);

// ============ TURN Credential Generation ============

/**
 * Generate time-based TURN credentials using HMAC-SHA1.
 * Same algorithm as WebSend — both apps share the same coturn instance.
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
        answerWaiters: new Set()
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
app.listen(PORT, '0.0.0.0', () => {
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
