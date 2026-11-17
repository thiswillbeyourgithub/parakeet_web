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
const fsp = require('fs/promises');
const path = require('path');
const { WebSocketServer } = require('ws');

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

// Test-only escape hatch: when TEST_DISABLE_RATE_LIMIT=1 every rate-limit
// middleware becomes a pass-through. The integration suite (test/http/*) spins
// many rooms per file and would otherwise trip the roomCreation cap (5/min).
// Read once here (before any rateLimitMiddleware call at module-eval time, so
// it is out of the const's temporal dead zone) and never flippable by a
// request. MUST never be set in production. Mirrors WebSend's flag of the same
// name.
const TEST_DISABLE_RATE_LIMIT = process.env.TEST_DISABLE_RATE_LIMIT === '1';
if (TEST_DISABLE_RATE_LIMIT) {
    console.warn('WARNING: TEST_DISABLE_RATE_LIMIT=1 — rate limiting is OFF (test mode only)');
}

// ============ ICE Server Configuration ============
// Benchmark-report collection (POST /api/benchmark-report). Off unless the
// operator mounts a writable folder and points this at it; docker-compose then
// derives the client-side VITE_BENCHMARK_UPLOAD from the same variable, so the
// send button and this receiver appear and disappear together.
const BENCHMARK_REPORTS_DIR = process.env.BENCHMARK_REPORTS_DIR || '';
const BENCHMARK_REPORT_FORMAT = 'parakeetweb-benchmark-report/1';
// Well under the 50 KB express.json cap: a real report is ~5-10 KB, and a
// tighter route-level bound keeps a padded one from being stored.
const BENCHMARK_REPORT_MAX_BYTES = 32 * 1024;
// Disk backstop behind the per-IP rate limit: at 32 KB each, 20k reports cap
// the folder around 640 MB.
const BENCHMARK_REPORTS_MAX_FILES = parseInt(process.env.BENCHMARK_REPORTS_MAX_FILES, 10) || 20000;
// Process-wide cap behind the per-IP one (3/min). A caller rotating source
// addresses (an IPv6 /64) is bounded only by this: at the default 30/min the
// 20k file cap takes eleven hours to reach instead of minutes, and the warning
// logged on every refusal makes the flood visible long before that. Real
// visitors post about one report per several minutes each, so a single
// instance never comes near it.
const BENCHMARK_REPORTS_MAX_PER_MINUTE = parseInt(process.env.BENCHMARK_REPORTS_MAX_PER_MINUTE, 10) || 30;
// Shape of a report the client builds (lib/benchmark.js buildBenchmarkReport).
// Anything else at the top level is refused: the files land on the operator's
// machine and are read by tooling that trusts them, so a report is only stored
// when it is at least the right shape. Sections stay free-form underneath
// (the environment block mirrors whatever WebGPU reports) but every key and
// string in them is checked by validateBenchmarkReport below.
const BENCHMARK_REPORT_SHAPE = {
    format: 'string',
    reportId: 'string?',
    generatedAt: 'string?',
    app: 'object',
    settings: 'object',
    clip: 'object',
    environment: 'object',
    results: 'array',
};
// Keys that turn into prototype pollution the moment a consumer merges the
// parsed report into another object (lodash.merge, a deep Object.assign).
// JSON.parse keeps them as own properties, so they walk through untouched
// unless refused here.
const BENCHMARK_REPORT_FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Deepest nesting a real report reaches is 5 (results[].chunks[].metrics);
// JSON.stringify overflows the stack around 10k, so this is a comfortable
// margin that still refuses a nesting bomb with a 400 instead of a 500.
const BENCHMARK_REPORT_MAX_DEPTH = 12;
// Longest string a real report carries is an error message the client
// already trims to 300 characters, or a GPU adapter description.
const BENCHMARK_REPORT_MAX_STRING = 4096;
// C0 control characters other than tab / newline, plus DEL. ESC is what makes
// a string a terminal-escape injection when a consumer prints it (`jq -r`,
// console.log); a report has no business carrying any of them.
const BENCHMARK_REPORT_CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/;

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
// The same limit in bytes, parsed by `bytes` (the parser express.raw itself
// applies to RELAY_LP_FRAME_BODY_LIMIT, installed with express) so the WS
// relay and the long-poll relay refuse exactly the same frame size.
const RELAY_FRAME_MAX_BYTES = require('bytes').parse(RELAY_LP_FRAME_BODY_LIMIT);
// Byte cap on one LP slot's queue, next to the frame-count cap above. With the
// defaults, 32 frames of 256 KiB would already be 8 MiB, so this is what really
// bounds a slot whose receiver stopped polling. Real frames are at most ~94 KiB
// (500 ms of 96 kHz Int16 mono plus framing), so 32 of them (~3 MiB) still fit.
const RELAY_LP_QUEUE_MAX_BYTES = 4 * 1024 * 1024;
// A WS peer whose socket buffer passes this is not reading: it is closed
// instead of letting the relay buffer for it without bound. Same 4 MiB as the
// LP queue so both transports bound a stuck receiver alike.
const RELAY_WS_MAX_BUFFERED_BYTES = RELAY_LP_QUEUE_MAX_BYTES;
// Bytes the relay holds for receivers, LP queues and WS send buffers together.
// The per-slot caps times ROOMS_MAX x 2 slots would be ~40 GB, far over the
// container's 256 MiB: past this budget a new LP frame is refused (429 to its
// sender, who retries) and the WS receiver holding the most is dropped,
// instead of the relay being OOM-killed with every room in it.
const RELAY_QUEUE_BUDGET_BYTES = parseInt(process.env.RELAY_QUEUE_BUDGET_BYTES, 10) || 64 * 1024 * 1024;
let _relayQueuedBytes = 0;
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

// ============ HuggingFace model relay ============
// Streams allowlisted model repos from huggingface.co under /models for
// visitors who can reach this site but not the hub (see hf-relay.js).
// Disabled (every /models request 404s) when HF_RELAY_REPOS is empty, which
// is the case whenever the entrypoint was told HF_MODEL_RELAY=false.
const { createHfRelay, parseRepoAllowlist } = require('./hf-relay');
const HF_RELAY_REPOS = parseRepoAllowlist(process.env.HF_RELAY_REPOS || '');
const HF_RELAY_MAX_STREAMS = parseInt(process.env.HF_RELAY_MAX_STREAMS, 10) || 16;
if (HF_RELAY_REPOS.size) {
    const hfRelay = createHfRelay({ repos: HF_RELAY_REPOS, token: process.env.HF_TOKEN || '', maxStreams: HF_RELAY_MAX_STREAMS });
    app.use('/models', hfRelay.handler);
} else {
    app.use('/models', (req, res) => res.status(404).end());
}

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
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-Room-Secret, X-Slot-Token');
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
//
// The relay data plane (/relay/up, /relay/down) carries one HTTP
// request per ~8 ms audio frame and would saturate the tight preflight
// cap within the first second of a fallback session, dropping audio
// chunks and the audio-end control message alike. Route those paths to
// the dedicated relayData bucket instead so legitimate audio traffic
// is not rate-killed; non-data /relay endpoints (handshake, close)
// stay on the tight preflight cap.
const _PREFLIGHT_RELAY_DATA_RE = /^\/rooms\/[A-Z0-9]{6}\/relay\/(up|down)$/;
const _preflightDefault = rateLimitMiddleware('preflight');
const _preflightRelayData = rateLimitMiddleware('relayData');
app.use('/api', (req, res, next) => {
    if (_PREFLIGHT_RELAY_DATA_RE.test(req.path)) {
        return _preflightRelayData(req, res, next);
    }
    return _preflightDefault(req, res, next);
});
app.use('/api', validateOrigin);

// F-119: parse JSON bodies AFTER validateOrigin + preflight rate
// limit so an attacker without a valid Origin never reaches the
// body parser. Otherwise express.json reads up to 50 KB and runs
// synchronous JSON.parse for every rejected request, a CPU
// amplification path that the rate limiter alone cannot fully close.
// Mounted per route, AFTER the room-secret check on room routes, so a
// request without the right secret is refused before its body is read
// either. Only the routes that read req.body get it.
const jsonBody = express.json({ limit: '50kb' });

// ============ In-memory Room Storage ============
const rooms = new Map();
// Expiry policy (idle TTL, hard cap) lives in room-expiry.js
const { sweepRoom } = require('./room-expiry.js');
const { clientIpKey } = require('./client-ip.js');

// Live-room caps. Rooms only leave memory through the expiry sweep (up to
// ROOM_MAX_LIFETIME), so the 5/min creation rate alone still let one client
// park 300 rooms an hour, and a client rotating addresses park any number.
// ROOMS_MAX bounds the whole instance (503 when full), ROOMS_MAX_PER_CLIENT
// bounds one client key (an IPv4 or an IPv6 /64, 429 when reached). A real
// user holds one room per open desktop tab; 100 leaves room for a hospital
// whose desktops all share one NAT address.
const ROOMS_MAX = parseInt(process.env.ROOMS_MAX, 10) || 5000;
const ROOMS_MAX_PER_CLIENT = parseInt(process.env.ROOMS_MAX_PER_CLIENT, 10) || 100;

function liveRoomsOf(clientKey) {
    let n = 0;
    for (const room of rooms.values()) {
        if (room.creator === clientKey) n += 1;
    }
    return n;
}

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
    iceConfig: { windowMs: 60 * 1000, maxRequests: 10 },
    // A benchmark run takes minutes, so a legitimate visitor posts at most one
    // report every few minutes. 3/min leaves room for a retry after a network
    // blip while keeping a scripted client from filling the report folder.
    benchmarkReport: { windowMs: 60 * 1000, maxRequests: 3 },
    // relayData covers /relay/up and /relay/down, which carry the
    // audio stream when WebRTC and the WebSocket relay both fail.
    // The PCM worklet emits one frame per render quantum (128 samples
    // at 16 kHz = ~125 frames/sec), so each direction needs a budget
    // well above the per-IP audio rate. 15000/min (~250/sec) is 2x
    // the steady-state rate, leaves headroom for the down-poll's
    // re-poll burst when a queued frame is drained, and is still
    // small relative to what a single keep-alive HTTPS connection
    // sustains. The session-byte cap (4 GiB) and per-frame body
    // limit (256 KiB) remain the meaningful upper bounds on abuse;
    // this bucket only exists so a legitimate audio stream is not
    // rate-killed by buckets sized for control-plane traffic.
    relayData: { windowMs: 60 * 1000, maxRequests: 15000 }
};

// Keyed by clientIpKey: an IPv6 client counts as its whole /64.
function getClientIp(req) {
    return clientIpKey(req.ip);
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

// Process-wide sliding-window quota, independent of the caller's IP. A
// per-IP limit alone is only as strong as the number of addresses the caller
// can source from (an IPv6 /64 is 2^64 of them), so a bucket that counts
// EVERY caller is what actually bounds the blast radius of an endpoint that
// spends a shared resource (TURN credentials, benchmark-report disk).
// Returns a function that consumes one unit when the quota allows it.
function makeGlobalWindowQuota(maxPerWindow, windowMs) {
    const timestamps = [];
    return function tryConsume() {
        const now = Date.now();
        const windowStart = now - windowMs;
        while (timestamps.length && timestamps[0] < windowStart) timestamps.shift();
        if (timestamps.length >= maxPerWindow) return false;
        timestamps.push(now);
        return true;
    };
}

function rateLimitMiddleware(limitType) {
    if (TEST_DISABLE_RATE_LIMIT) {
        return (req, res, next) => next();
    }
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

// Each room has TWO credentials, one per role, so the secret printed in the
// QR code (the phone's) cannot be used to impersonate the desktop:
//   - room.hostSecret: returned only to the desktop that created the room;
//     required to store the offer, re-arm, post offer-side ICE, and read the
//     answer + answer-side ICE.
//   - room.secret: the phone's credential, carried in the QR fragment; it can
//     only read the offer + offer-side ICE and post the answer + answer ICE.
// A phone-secret holder (anyone who saw the QR) therefore cannot re-arm the
// room, replace the offer, or read the answer meant for the desktop.
//
// Returns 'host', 'phone', or null. Both comparisons always run (against a
// dummy when the room is missing) so the timing does not reveal which branch
// matched or whether the room exists.
function roomRoleForSecret(room, providedSecret) {
    const provided = typeof providedSecret === 'string' ? providedSecret : '';
    const isHost = secureCompare(provided, room ? room.hostSecret : DUMMY_ROOM_SECRET);
    const isPhone = secureCompare(provided, room ? room.secret : DUMMY_ROOM_SECRET);
    if (!room || !provided) return null;
    if (isHost) return 'host';
    if (isPhone) return 'phone';
    return null;
}

// Middleware factory: admit the request only if X-Room-Secret matches one of
// the given roles. Always return the same shape for "room missing", "secret
// wrong" and "wrong role" so an unauthenticated client cannot use the response
// code as an enumeration oracle over the 30-bit room ID space.
function requireRoomRole(...roles) {
    return (req, res, next) => {
        const room = rooms.get(req.params.id);
        const role = roomRoleForSecret(room, req.headers['x-room-secret']);
        if (!role || !roles.includes(role)) return res.status(401).json({ error: 'Invalid room secret' });
        req.room = room;
        req.roomRole = role;
        next();
    };
}

const validateRoomSecret = requireRoomRole('host', 'phone');
const requireHost = requireRoomRole('host');
const requirePhone = requireRoomRole('phone');

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

// Closes both relay slots of `room` (LP: queued frames dropped, pollers get
// 410; WS: closed with `code`) and forgets the relay session, so the next
// handshake starts from an empty relay.
function closeRelay(room, code, reason) {
    if (!room.relay) return;
    for (const slotName of ['a', 'b']) {
        const s = room.relay[slotName];
        if (!s) continue;
        if (s.kind === 'lp') {
            closeLpSlot(s, reason);
        } else if (s.readyState !== s.CLOSED) {
            try { s.close(code, reason); } catch (_) { /* ignore */ }
        }
    }
    room.relay = null;
}

function cleanupRooms() {
    const now = Date.now();
    for (const [id, room] of rooms.entries()) {
        if (sweepRoom(room, now)) {
            // Wake any pending long-pollers so they stop holding refs to the room.
            if (room.answerWaiters) {
                for (const wake of room.answerWaiters) wake();
                room.answerWaiters.clear();
            }
            // Tear down any open relay slots so dangling WS or LP peers
            // do not outlive the room entry they reference.
            closeRelay(room, 1001, 'Room expired');
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
    // Nobody will poll it again: give its bytes back to the relay budget
    while (slot.queue.length > 0) lpDequeue(slot);
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

// WebSocket relay infrastructure. The single WebSocketServer instance is
// fed by the http.Server-level 'upgrade' listener at the bottom of this
// file; we use { noServer: true } so we control auth/origin/rate-limit
// BEFORE handshakeUpgrade allocates a socket per request.
// maxPayload: ws defaults to 100 MiB per message, which a peer could send in
// one frame; refuse anything the LP /up route would refuse (close 1009).
const _relayWss = new WebSocketServer({ noServer: true, maxPayload: RELAY_FRAME_MAX_BYTES });

function attachRelay(room, ws, slotName) {
    if (!room.relay) {
        room.relay = { a: null, b: null, sessionBytes: 0 };
    }
    const r = room.relay;
    ws.kind = 'ws';
    ws.slotName = slotName;
    r[slotName] = ws;
    _relayWsLive.add(ws);
    ws.pendingBytes = 0;
    ws.pendingReleased = false;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data, isBinary) => {
        const len = frameBytes(data);
        if (!isBinary && len > RELAY_MAX_CONTROL_MSG_BYTES) {
            // Hostile peer pumping multi-MB text frames: close this half.
            // Peer is left intact so it observes the disconnect.
            try { ws.close(4413, 'Control message too large'); } catch (_) { /* ignore */ }
            return;
        }
        r.sessionBytes += len;
        if (r.sessionBytes > RELAY_MAX_TOTAL_SESSION_BYTES) {
            // Tear down both halves so the cap is end-to-end.
            const peer = slotName === 'a' ? r.b : r.a;
            try { ws.close(4413, 'Session byte cap exceeded'); } catch (_) { /* ignore */ }
            teardownPeer(peer, 'Session byte cap exceeded');
            return;
        }
        const peer = slotName === 'a' ? r.b : r.a;
        deliverToPeer(peer, data, isBinary);
        // Pre-handshake frames (peer hasn't joined yet) are dropped on
        // the floor. The protocol is interactive: the receiver
        // renegotiates on its own when the peer arrives.
    });

    ws.on('close', () => {
        _relayWsLive.delete(ws);
        wsReleaseCounted(ws);
        if (room.relay) {
            if (room.relay[slotName] === ws) room.relay[slotName] = null;
            // Symmetric pair: once one half is gone the session is dead.
            // The receiver re-pairs via a fresh /relay/handshake if it
            // still wants to try.
            const peer = slotName === 'a' ? room.relay.b : room.relay.a;
            teardownPeer(peer, 'Peer disconnected');
        }
    });

    ws.on('error', () => {
        try { ws.close(1011, 'Server error'); } catch (_) { /* ignore */ }
    });
}

// Heartbeat: any WS that fails to pong within one interval is treated as
// dead and force-closed. Without this a proxy that silently drops the
// underlying TCP socket leaves the peer holding an open ws for the room
// TTL, blocking re-pair on the same slot.
setInterval(() => {
    for (const ws of _relayWsLive) {
        if (ws.isAlive === false) {
            try { ws.terminate(); } catch (_) { /* ignore */ }
            _relayWsLive.delete(ws);
            continue;
        }
        ws.isAlive = false;
        try { ws.ping(); } catch (_) { /* ignore */ }
    }
}, RELAY_WS_PING_INTERVAL_MS).unref();

function frameBytes(data) {
    return Buffer.isBuffer(data) ? data.length : (data && data.byteLength) || 0;
}

// The LP queue goes through these two so queueBytes always matches queue.
// They also keep _relayQueuedBytes, the sum over all slots, in step.
function lpEnqueue(slot, frame) {
    const n = frameBytes(frame.data);
    slot.queue.push(frame);
    slot.queueBytes += n;
    _relayQueuedBytes += n;
}

function lpDequeue(slot) {
    const frame = slot.queue.shift();
    if (frame) {
        const n = frameBytes(frame.data);
        slot.queueBytes -= n;
        _relayQueuedBytes -= n;
    }
    return frame;
}

// Returns false only when the relay-wide queue budget refused the frame.
function deliverToPeer(peerSlot, data, isBinary) {
    if (!peerSlot) return true;
    if (peerSlot.kind === 'lp') {
        if (peerSlot.closed) return true;
        // Drop oldest under overflow (frame count or bytes) so a stuck
        // consumer cannot pin unbounded memory on the server. The protocol
        // is interactive and dropped audio frames result in a perceptible
        // glitch on the receiver, not a stuck session.
        const len = frameBytes(data);
        while (peerSlot.queue.length > 0
            && (peerSlot.queue.length >= RELAY_LP_QUEUE_MAX_FRAMES
                || peerSlot.queueBytes + len > RELAY_LP_QUEUE_MAX_BYTES)) {
            lpDequeue(peerSlot);
        }
        if (_relayQueuedBytes + len > RELAY_QUEUE_BUDGET_BYTES) return false;
        lpEnqueue(peerSlot, { data, isBinary });
        const w = peerSlot.waiters.shift();
        if (w) w.send(lpDequeue(peerSlot));
        return true;
    }
    // WS slot: forward verbatim. ws.send is async but errors propagate
    // via the 'error' event handler attached in attachRelay.
    if (peerSlot.readyState === peerSlot.OPEN) {
        // terminate() (not close(), whose close frame would queue behind the
        // backlog) fires 'close', which tears the sending half down too.
        if (peerSlot.bufferedAmount > RELAY_WS_MAX_BUFFERED_BYTES) {
            // The peer stopped reading: ws would keep every further frame
            // in relay memory.
            try { peerSlot.terminate(); } catch (_) { /* ignore */ }
            return true;
        }
        const len = frameBytes(data);
        if (_relayQueuedBytes + len > RELAY_QUEUE_BUDGET_BYTES) dropFullestWs();
        if (_relayQueuedBytes + len > RELAY_QUEUE_BUDGET_BYTES) {
            try { peerSlot.terminate(); } catch (_) { /* ignore */ }
            return true;
        }
        wsSendCounted(peerSlot, data, isBinary, len);
    }
    return true;
}

// ws.send with its bytes counted in _relayQueuedBytes until ws hands them to
// the kernel (the send callback) or the socket closes (wsReleaseCounted).
function wsSendCounted(ws, data, isBinary, len) {
    ws.pendingBytes += len;
    _relayQueuedBytes += len;
    const release = () => {
        if (ws.pendingReleased) return;
        ws.pendingBytes -= len;
        _relayQueuedBytes -= len;
    };
    try { ws.send(data, { binary: isBinary }, release); } catch (_) { release(); }
}

function wsReleaseCounted(ws) {
    if (ws.pendingReleased) return;
    ws.pendingReleased = true;
    _relayQueuedBytes -= ws.pendingBytes;
    ws.pendingBytes = 0;
}

// Over the budget: drop the WS receiver holding the most unsent bytes, the
// one most likely to have stopped reading.
function dropFullestWs() {
    let fullest = null;
    for (const ws of _relayWsLive) {
        if (!fullest || ws.pendingBytes > fullest.pendingBytes) fullest = ws;
    }
    if (!fullest || fullest.pendingBytes === 0) return;
    wsReleaseCounted(fullest);
    try { fullest.terminate(); } catch (_) { /* ignore */ }
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
const tryConsumeTurnGlobalQuota = makeGlobalWindowQuota(TURN_GLOBAL_MAX_PER_WINDOW, TURN_GLOBAL_WINDOW_MS);

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
    if (rooms.size >= ROOMS_MAX) {
        console.warn(`[rooms] refusing room creation: instance-wide cap of ${ROOMS_MAX} live rooms reached`);
        res.set('Retry-After', '60');
        return res.status(503).json({ error: 'Too many rooms', message: 'The server is busy, try again in a minute' });
    }
    const creator = getClientIp(req);
    // Bypassed with the other per-IP limits by the test escape hatch: every
    // tier-2 test runs from loopback, so they would all share one budget.
    if (!TEST_DISABLE_RATE_LIMIT && liveRoomsOf(creator) >= ROOMS_MAX_PER_CLIENT) {
        res.set('Retry-After', '60');
        return res.status(429).json({ error: 'Too many rooms for this client', retryAfter: 60 });
    }
    let roomId;
    do {
        roomId = generateRoomId();
    } while (rooms.has(roomId));

    const secret = generateRoomSecret();
    const hostSecret = generateRoomSecret();
    rooms.set(roomId, {
        created: Date.now(),
        // Client key of the creator, for ROOMS_MAX_PER_CLIENT.
        creator,
        secret,
        hostSecret,
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
    debugLog('ROOM', 'Room created', { roomId, clientIp: creator });
    res.json({ roomId, secret, hostSecret });
});

// Store SDP offer
app.post('/api/rooms/:id/offer', rateLimitMiddleware('general'), requireHost, jsonBody, (req, res) => {
    const err = validateSdp(req.body);
    if (err) return res.status(400).json({ error: err });
    req.room.offer = { type: req.body.type, sdp: req.body.sdp };
    debugLog('SIGNALING', `Offer stored for room ${req.params.id}`);
    res.json({ success: true });
});

// Get SDP offer
app.get('/api/rooms/:id/offer', rateLimitMiddleware('roomLookup'), requirePhone, (req, res) => {
    if (!req.room.offer) return res.status(404).json({ error: 'Offer not ready yet' });
    res.json(req.room.offer);
});

// Store SDP answer
app.post('/api/rooms/:id/answer', rateLimitMiddleware('general'), requirePhone, jsonBody, (req, res) => {
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
app.get('/api/rooms/:id/answer', rateLimitMiddleware('roomLookup'), requireHost, async (req, res) => {
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

// Re-arm a room for a SECOND handshake without minting a new room/secret.
// When a phone drops, the desktop keeps the same QR on screen and waits for
// the phone to come back. But the old session's SDP answer and the
// append-only ICE candidate lists are still stored: a fresh offer alone is
// not enough because GET /answer would immediately return the STALE answer
// (and the new RTCPeerConnection would replay dead ICE). This resets the
// signaling slot (offer/answer/ICE) to its just-created state, keeping the
// room id, secret, and relay state alive, so the desktop can store a fresh
// offer and long-poll for the returning phone's new answer. Any waiter
// currently long-polling /answer is woken so it re-evaluates (and 204s)
// against the now-empty answer instead of hanging on the prior one.
// The relay slots of the dropped session are closed too: the desktop opens a
// fresh transport after a re-arm, and a stale slot would keep the room "full"
// (409 on the returning phone's handshake) and hand the new session frames
// queued for the old one.
app.post('/api/rooms/:id/rearm', rateLimitMiddleware('general'), requireHost, (req, res) => {
    closeRelay(req.room, 1000, 'Room re-armed');
    req.room.offer = null;
    req.room.answer = null;
    req.room.iceCandidatesOffer = [];
    req.room.iceCandidatesAnswer = [];
    if (req.room.answerWaiters) {
        for (const wake of req.room.answerWaiters) wake();
        req.room.answerWaiters.clear();
    }
    debugLog('SIGNALING', `Room ${req.params.id} re-armed for reconnection`);
    res.json({ success: true });
});

// ICE candidates for offer side
app.post('/api/rooms/:id/ice/offer', rateLimitMiddleware('general'), requireHost, jsonBody, (req, res) => {
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

// Polled at ~1 Hz by remote-webrtc.js during ICE negotiation. The
// `roomLookup` bucket (30/min) is too tight for that cadence,
// especially when the phone and desktop share a NAT IP and both
// peers consume the same per-IP counter — a single connect attempt
// can saturate it within 15 s and 429-block any retry for a full
// minute. The sibling POST already uses `general` (100/min); the GET
// is also gated by validateRoomSecret so it is not an enumeration
// oracle, and matching its limit keeps the trickle-ICE round-trip
// inside one consistent bucket.
app.get('/api/rooms/:id/ice/offer', rateLimitMiddleware('general'), requirePhone, (req, res) => {
    res.json({ candidates: req.room.iceCandidatesOffer });
});

// ICE candidates for answer side
app.post('/api/rooms/:id/ice/answer', rateLimitMiddleware('general'), requirePhone, jsonBody, (req, res) => {
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

// Same rationale as /ice/offer above: moved to `general` to match
// the 1 Hz client polling and avoid 429 storms under shared-NAT.
app.get('/api/rooms/:id/ice/answer', rateLimitMiddleware('general'), requireHost, (req, res) => {
    res.json({ candidates: req.room.iceCandidatesAnswer });
});

// ============ HTTPS Relay (long-poll fallback) ============
//
// Two peers (slot 'a', slot 'b') claim opposite ends of an ephemeral
// channel scoped to the room. Frames sent to /relay/up are forwarded to
// the peer slot; /relay/down long-polls for incoming frames. The relay
// never inspects the bytes: audio chunks are AES-256-GCM ciphertext from
// the application layer (remote-crypto.js).

// Each role owns one fixed slot: the desktop (host secret) is always 'a', the
// phone (QR secret) always 'b'. It used to be first-come, so a second phone
// holding the QR could grab the slot meant for the desktop (or squat it before
// the desktop's relay race fired) and receive the real phone's traffic. With
// fixed slots a QR holder can only ever compete for the phone's own slot.
const RELAY_SLOT_FOR_ROLE = { host: 'a', phone: 'b' };

// Claim the caller's role slot; 409 if it is already held.
app.post('/api/rooms/:id/relay/handshake', rateLimitMiddleware('general'), validateRoomSecret, (req, res) => {
    if (!RELAY_ENABLE) return res.status(404).json({ error: 'Relay disabled' });
    const room = req.room;
    const r = room.relay || (room.relay = { a: null, b: null, sessionBytes: 0 });
    const slotName = RELAY_SLOT_FOR_ROLE[req.roomRole];
    if (r[slotName]) return res.status(409).json({ error: 'Room relay slot taken' });

    const token = crypto.randomBytes(RELAY_LP_SLOT_TOKEN_BYTES).toString('hex');
    const slot = {
        kind: 'lp',
        token,
        slotName,
        queue: [],
        queueBytes: 0,
        waiters: [],
        closed: false,
        idleTimer: null,
        // WeakRef so a GC'd room (already-deleted entry) does not pin a
        // strong reference back into the rooms Map via the idle timer
        // closure. Older Node fallbacks to a strong-ref shim.
        roomRef: typeof WeakRef === 'function' ? new WeakRef(room) : { deref: () => room },
    };
    r[slotName] = slot;
    armLpIdleTimer(slot);
    debugLog('RELAY', `LP slot ${slotName} claimed for room ${req.params.id}`);
    res.json({ slot: slotName, token });
});

// Resolve a request's LP slot by constant-time-comparing X-Slot-Token
// against both slots. Returns { slot, slotName } or null.
function _findLpSlotByToken(r, providedToken) {
    if (typeof providedToken !== 'string' || !providedToken.length) return null;
    for (const name of ['a', 'b']) {
        const s = r[name];
        if (s && s.kind === 'lp' && secureCompare(providedToken, s.token)) {
            return { slot: s, slotName: name };
        }
    }
    return null;
}

// Run fn once when the response is sent or the connection drops.
function onResponseDone(res, fn) {
    let done = false;
    const once = () => {
        if (done) return;
        done = true;
        fn();
    };
    res.on('finish', once);
    res.on('close', once);
}

// Per-client cap on relay HTTP requests in flight (/up and /down), keyed like
// the rate limiter (an IPv4 address or an IPv6 /64). The rate limit counts
// requests per minute, not how many are open at once, so without this one
// client could hold thousands of 25 s long-polls and 256 KiB uploads. An
// honest session keeps one /down and at most one /up open per side, so a room
// whose desktop and phone share a NAT holds 4. A client key cannot own more
// than ROOMS_MAX_PER_CLIENT rooms, so 4 per room (400 by default) covers a
// hospital NAT running that many sessions at once.
const RELAY_IN_FLIGHT_PER_ROOM = 4;
const RELAY_IN_FLIGHT_PER_CLIENT = ROOMS_MAX_PER_CLIENT * RELAY_IN_FLIGHT_PER_ROOM;
const _relayInFlight = new Map();

function relayInFlightLimit(req, res, next) {
    if (TEST_DISABLE_RATE_LIMIT) return next();
    const key = getClientIp(req);
    const n = _relayInFlight.get(key) || 0;
    if (n >= RELAY_IN_FLIGHT_PER_CLIENT) {
        res.set('Retry-After', '5');
        return res.status(429).json({ error: 'Too many relay requests in flight' });
    }
    _relayInFlight.set(key, n + 1);
    onResponseDone(res, () => {
        const left = _relayInFlight.get(key) - 1;
        if (left > 0) _relayInFlight.set(key, left);
        else _relayInFlight.delete(key);
    });
    next();
}

// Process-wide budget of /up body bytes being read at once. Each request
// reserves its Content-Length (or the frame limit when it has none) before
// express.raw buffers anything, so many slow uploads from many client keys
// cannot together pin unbounded memory. 32 MiB is 128 full-size frames being
// read at the same moment; real frames are under 100 KiB and read in
// milliseconds.
const RELAY_BODY_BUDGET_BYTES = 32 * 1024 * 1024;
// Time allowed to read one /up body. server.requestTimeout (35 s) covers the
// whole request and is sized for the long-polls; a 256 KiB body has no reason
// to take more than a few seconds even on a poor link.
const RELAY_BODY_READ_TIMEOUT_MS = 10_000;
let _relayBodyBytesReserved = 0;

function relayBodyGuard(req, res, next) {
    const declared = Number(req.headers['content-length']);
    const reserve = Number.isFinite(declared) && declared >= 0
        ? Math.min(declared, RELAY_FRAME_MAX_BYTES)
        : RELAY_FRAME_MAX_BYTES;
    if (_relayBodyBytesReserved + reserve > RELAY_BODY_BUDGET_BYTES) {
        res.set('Retry-After', '5');
        return res.status(503).json({ error: 'Server temporarily overloaded' });
    }
    _relayBodyBytesReserved += reserve;
    const timer = setTimeout(() => {
        if (res.headersSent) return;
        res.set('Connection', 'close');
        res.status(408).json({ error: 'Request body too slow' });
        // express.raw is still waiting on the socket: drop it once the 408 is
        // out, which also makes express.raw give up.
        res.on('finish', () => req.destroy());
    }, RELAY_BODY_READ_TIMEOUT_MS);
    req.relayBodyTimer = timer;
    onResponseDone(res, () => {
        clearTimeout(timer);
        _relayBodyBytesReserved -= reserve;
    });
    next();
}

// Placed right after express.raw: the body is in, stop the read timer.
function relayBodyRead(req, res, next) {
    clearTimeout(req.relayBodyTimer);
    if (res.headersSent) return;
    next();
}

// Send a frame to the peer slot.
app.post(
    '/api/rooms/:id/relay/up',
    rateLimitMiddleware('relayData'),
    relayInFlightLimit,
    validateRoomSecret,
    relayBodyGuard,
    express.raw({ type: '*/*', limit: RELAY_LP_FRAME_BODY_LIMIT }),
    relayBodyRead,
    (req, res) => {
        if (!RELAY_ENABLE) return res.status(404).json({ error: 'Relay disabled' });
        const room = req.room;
        const r = room.relay;
        if (!r) return res.status(409).json({ error: 'No relay session' });
        const found = _findLpSlotByToken(r, req.headers['x-slot-token'] || '');
        if (!found) return res.status(401).json({ error: 'Invalid slot token' });
        const { slot, slotName } = found;
        if (slot.closed) return res.status(410).json({ error: 'Slot closed' });

        const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        const isBinary = (req.headers['content-type'] || '').toLowerCase()
            .includes('application/octet-stream');
        const len = data.length;
        if (!isBinary && len > RELAY_MAX_CONTROL_MSG_BYTES) {
            // Hostile peer pumping multi-MB JSON: tear down this slot
            // and refuse the frame. The peer is left intact so it can
            // observe the disconnect and renegotiate.
            closeLpSlot(slot, 'Control message too large');
            r[slotName] = null;
            return res.status(413).json({ error: 'Control message too large' });
        }
        r.sessionBytes += len;
        if (r.sessionBytes > RELAY_MAX_TOTAL_SESSION_BYTES) {
            // 4 GiB session cap: tear down BOTH sides so the cap is an
            // end-to-end invariant, not just a one-sided rejection.
            closeLpSlot(slot, 'Session byte cap exceeded');
            r[slotName] = null;
            const peer = slotName === 'a' ? r.b : r.a;
            teardownPeer(peer, 'Session byte cap exceeded');
            return res.status(413).json({ error: 'Session byte cap exceeded' });
        }
        armLpIdleTimer(slot);
        const peer = slotName === 'a' ? r.b : r.a;
        if (!deliverToPeer(peer, data, isBinary)) {
            res.set('Retry-After', '1');
            return res.status(429).json({ error: 'Relay queue full' });
        }
        res.status(204).send();
    }
);

// Long-poll for incoming frames.
app.get('/api/rooms/:id/relay/down', rateLimitMiddleware('relayData'), relayInFlightLimit, validateRoomSecret, (req, res) => {
    if (!RELAY_ENABLE) return res.status(404).json({ error: 'Relay disabled' });
    const room = req.room;
    const r = room.relay;
    if (!r) return res.status(409).json({ error: 'No relay session' });
    const found = _findLpSlotByToken(r, req.headers['x-slot-token'] || '');
    if (!found) return res.status(401).json({ error: 'Invalid slot token' });
    const { slot } = found;
    if (slot.closed) return res.status(410).json({ error: 'Slot closed' });

    armLpIdleTimer(slot);

    const sendFrame = (frame) => {
        if (frame.isBinary) {
            res.set('Content-Type', 'application/octet-stream');
            res.status(200).send(Buffer.isBuffer(frame.data) ? frame.data : Buffer.from(frame.data));
        } else {
            const body = Buffer.isBuffer(frame.data) ? frame.data.toString('utf8') : String(frame.data);
            // Control frames are forwarded verbatim - they are not
            // necessarily JSON (the protocol layer decides what string
            // payload means). Use text/plain so an intermediary cache
            // does not try to JSON-parse it.
            res.set('Content-Type', 'text/plain; charset=utf-8');
            res.status(200).send(body);
        }
    };

    if (slot.queue.length > 0) {
        return sendFrame(lpDequeue(slot));
    }
    if (req.query.wait !== 'true') return res.status(204).send();

    if (slot.waiters.length >= RELAY_MAX_WAITERS_PER_SLOT) {
        res.set('Retry-After', '5');
        return res.status(429).json({ error: 'Too many concurrent down-polls on this slot' });
    }
    if (_relayTotalWaiters >= RELAY_MAX_TOTAL_WAITERS) {
        res.set('Retry-After', '5');
        return res.status(503).json({ error: 'Server temporarily overloaded' });
    }

    let settled = false;
    let waiter;
    const settle = (fn) => {
        if (settled) return;
        settled = true;
        const idx = slot.waiters.indexOf(waiter);
        if (idx !== -1) slot.waiters.splice(idx, 1);
        if (waiter.timer) clearTimeout(waiter.timer);
        _relayTotalWaiters--;
        fn();
    };
    waiter = {
        timer: null,
        send: (frame) => settle(() => sendFrame(frame)),
        timeout: () => settle(() => res.status(204).send()),
        gone: (reason) => settle(() => res.status(410).json({ error: reason || 'Slot closed' })),
    };
    waiter.timer = setTimeout(waiter.timeout, RELAY_LP_DOWN_TIMEOUT_MS);
    slot.waiters.push(waiter);
    _relayTotalWaiters++;
    req.on('close', () => settle(() => { /* client gone; nothing to send */ }));
});

// Explicit close signal. Idempotent; safe to call from a beforeunload
// handler on either peer.
app.post('/api/rooms/:id/relay/close', rateLimitMiddleware('general'), validateRoomSecret, (req, res) => {
    if (!RELAY_ENABLE) return res.status(404).json({ error: 'Relay disabled' });
    const r = req.room.relay;
    if (!r) return res.status(204).send();
    const found = _findLpSlotByToken(r, req.headers['x-slot-token'] || '');
    if (found) {
        closeLpSlot(found.slot, 'Client closed');
        r[found.slotName] = null;
        const peer = found.slotName === 'a' ? r.b : r.a;
        teardownPeer(peer, 'Peer closed');
    }
    res.status(204).send();
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

// ============ Benchmark reports ============
//
// Receives the anonymised performance reports produced by the sidebar
// Benchmark section, so an operator can find out where the time goes on
// hardware they do not own. Disabled unless BENCHMARK_REPORTS_DIR points at a
// writable folder; the entrypoint derives VITE_BENCHMARK_UPLOAD from the same
// variable, so with it unset the client never even shows a send button and
// this route answers 503.
//
// Deliberate properties:
//  - ONE FILE PER REPORT, named entirely by this server (UTC stamp + random
//    suffix). Nothing from the request reaches a path, and immutable files are
//    what makes the operator's add-only two-way sync (benchmark_reports/sync.sh)
//    safe.
//  - No IP, no Origin, no user agent and no timestamp beyond the receive time
//    is written next to the payload: the report is anonymous by design and
//    logging the sender here would quietly undo that.
//  - The body is re-serialised from the parsed JSON, so whatever is stored is
//    valid JSON of a bounded size, never raw attacker bytes.
//  - The shape is checked (validateBenchmarkReport): known top-level fields
//    only, no prototype-polluting keys anywhere, bounded depth and string
//    length, no control characters. The stored file is then safe to feed to
//    a merge helper or print to a terminal, which the size cap alone did not
//    guarantee.
//  - A directory-wide file cap keeps an abusive client from filling the disk;
//    the per-IP rate limit (3/min) is the first line, the instance-wide
//    quota (BENCHMARK_REPORTS_MAX_PER_MINUTE) the second, this is the backstop.
function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Walk a parsed report and return the reason it is unacceptable, or null.
// Type-only checks on purpose: the goal is a file the operator's tooling can
// parse and print without surprises, not a schema that breaks every time the
// client adds a metric.
function validateBenchmarkReport(body) {
    for (const key of Object.keys(body)) {
        if (!(key in BENCHMARK_REPORT_SHAPE)) return `unexpected field "${key.slice(0, 64)}"`;
    }
    for (const [key, kind] of Object.entries(BENCHMARK_REPORT_SHAPE)) {
        const v = body[key];
        if (kind === 'string?' && (v === null || v === undefined)) continue;
        if (kind === 'array' ? !Array.isArray(v)
            : kind === 'object' ? !isPlainObject(v)
                : typeof v !== 'string') return `field "${key}" has the wrong type`;
    }
    if (!body.results.every(isPlainObject)) return 'results must be an array of objects';

    // Iterative walk (an explicit stack) so a nesting bomb costs O(size) and
    // never touches the call stack before the depth cap refuses it.
    const stack = [{ node: body, depth: 0 }];
    while (stack.length) {
        const { node, depth } = stack.pop();
        if (typeof node === 'string') {
            if (node.length > BENCHMARK_REPORT_MAX_STRING) return 'a string exceeds the length limit';
            if (BENCHMARK_REPORT_CONTROL_CHARS.test(node)) return 'a string contains control characters';
            continue;
        }
        if (node === null || typeof node !== 'object') continue;
        if (depth >= BENCHMARK_REPORT_MAX_DEPTH) return 'report is nested too deeply';
        if (Array.isArray(node)) {
            for (const child of node) stack.push({ node: child, depth: depth + 1 });
            continue;
        }
        for (const [key, child] of Object.entries(node)) {
            if (BENCHMARK_REPORT_FORBIDDEN_KEYS.has(key)) return `forbidden key "${key}"`;
            if (key.length > BENCHMARK_REPORT_MAX_STRING || BENCHMARK_REPORT_CONTROL_CHARS.test(key)) {
                return 'a key is malformed';
            }
            stack.push({ node: child, depth: depth + 1 });
        }
    }
    return null;
}

const tryConsumeBenchmarkGlobalQuota = makeGlobalWindowQuota(BENCHMARK_REPORTS_MAX_PER_MINUTE, 60 * 1000);

app.post('/api/benchmark-report', rateLimitMiddleware('benchmarkReport'), jsonBody, async (req, res) => {
    if (!BENCHMARK_REPORTS_DIR) {
        return res.status(503).json({ error: 'Unavailable', message: 'Benchmark report collection is not enabled' });
    }
    // Checked before the body is looked at, so a flood pays nothing past the
    // JSON parse. Deliberately NOT bypassed by TEST_DISABLE_RATE_LIMIT (that
    // flag exists so tier-2 tests can hammer one IP), the tests size it down
    // through the env var instead.
    if (!tryConsumeBenchmarkGlobalQuota()) {
        console.warn(`[benchmark] refusing report: instance-wide cap of ${BENCHMARK_REPORTS_MAX_PER_MINUTE}/min reached`);
        res.set('Retry-After', '60');
        return res.status(429).json({ error: 'Too Many Requests', message: 'Report collection is busy, try again in a minute' });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Bad Request', message: 'Expected a JSON object' });
    }
    if (body.format !== BENCHMARK_REPORT_FORMAT) {
        return res.status(400).json({ error: 'Bad Request', message: 'Unsupported report format' });
    }
    let payload;
    try {
        payload = JSON.stringify(body);
    } catch {
        return res.status(400).json({ error: 'Bad Request', message: 'Report is not serialisable' });
    }
    if (payload.length > BENCHMARK_REPORT_MAX_BYTES) {
        return res.status(413).json({ error: 'Payload Too Large', message: 'Report exceeds the size limit' });
    }
    const reason = validateBenchmarkReport(body);
    if (reason) {
        return res.status(400).json({ error: 'Bad Request', message: `Malformed report: ${reason}` });
    }

    try {
        await fsp.mkdir(BENCHMARK_REPORTS_DIR, { recursive: true });
        const existing = (await fsp.readdir(BENCHMARK_REPORTS_DIR)).filter((f) => f.endsWith('.json'));
        if (existing.length >= BENCHMARK_REPORTS_MAX_FILES) {
            console.warn(`[benchmark] refusing report: ${existing.length} files already stored`);
            return res.status(507).json({ error: 'Insufficient Storage', message: 'Report store is full' });
        }
        // Server-generated name only: no request-controlled component can ever
        // reach the filesystem. `wx` refuses to overwrite, so a name collision
        // fails loudly instead of destroying an earlier report.
        // Rounded to the top of the UTC hour, matching the client's own
        // `generatedAt` (app/ui/src/lib/benchmark.js coarseTimestamp): a report
        // arrives within a minute of being generated, so a second-precision
        // filename would hand back exactly the precision the client removed for
        // privacy. The random suffix, not the stamp, is what keeps names unique.
        const stampAt = new Date();
        stampAt.setUTCMinutes(0, 0, 0);
        const stamp = stampAt.toISOString().replace(/[:.]/g, '-');
        const name = `report-${stamp}-${crypto.randomBytes(4).toString('hex')}.json`;
        await fsp.writeFile(path.join(BENCHMARK_REPORTS_DIR, name), payload, { flag: 'wx' });
        console.log(`[benchmark] stored ${name} (${payload.length} bytes)`);
        return res.status(204).send();
    } catch (err) {
        console.error('[benchmark] failed to store report:', err?.message || err);
        return res.status(500).json({ error: 'Internal Server Error', message: 'Could not store the report' });
    }
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
    console.log(`  HF_RELAY_REPOS: ${HF_RELAY_REPOS.size ? [...HF_RELAY_REPOS].map(([r, v]) => `${r}@${v}`).join(', ') : '(none, model relay disabled)'}`);
    if (HF_RELAY_REPOS.size) console.log(`  HF_RELAY_MAX_STREAMS: ${HF_RELAY_MAX_STREAMS}`);
    console.log(`  HF_TOKEN: ${process.env.HF_TOKEN ? '(set)' : '(not set)'}`);
    console.log(`  BENCHMARK_REPORTS_DIR: ${BENCHMARK_REPORTS_DIR || '(not set, report collection disabled)'}`);
    if (BENCHMARK_REPORTS_DIR) {
        console.log(`  BENCHMARK_REPORTS_MAX_FILES: ${BENCHMARK_REPORTS_MAX_FILES}`);
        console.log(`  BENCHMARK_REPORTS_MAX_PER_MINUTE: ${BENCHMARK_REPORTS_MAX_PER_MINUTE}`);
    }
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

// ============ WebSocket Relay Upgrade Handler ============
//
// The Express app handles regular HTTP routes; the WebSocket relay
// piggybacks on the same TCP listener via http.Server's 'upgrade'
// event. Auth, origin, and rate-limit checks run BEFORE
// handshakeUpgrade() so an unauthenticated peer never reaches the
// ws library's parser.

// Path: /api/rooms/<6 chars>/relay  (signaling-server view; Caddy
// strips the /api/signal prefix before reverse-proxying).
const RELAY_WS_PATH_RE = /^\/api\/rooms\/([A-Z0-9]{6})\/relay$/;

// Mirror Express trust-proxy=loopback: when the immediate TCP peer is
// loopback (Caddy on the same host), trust Caddy's X-Forwarded-For
// since Caddy has already stripped any client-supplied value. For
// non-loopback peers (no Caddy in front, e.g. dev), use the socket
// address directly.
function _getUpgradeClientIp(req) {
    const peer = req.socket.remoteAddress;
    if (peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1') {
        const xff = req.headers['x-forwarded-for'];
        if (typeof xff === 'string' && xff.length) {
            const first = xff.split(',')[0].trim();
            if (first) return clientIpKey(first);
        }
    }
    return clientIpKey(peer);
}

server.on('upgrade', (req, socket, head) => {
    // Deny early: closing the socket is cheaper than running the ws
    // accept handshake just to immediately reject.
    const denyAndClose = (statusLine, extra = '') => {
        try { socket.write(`HTTP/1.1 ${statusLine}\r\n${extra}\r\n`); } catch (_) { /* ignore */ }
        try { socket.destroy(); } catch (_) { /* ignore */ }
    };

    if (!RELAY_ENABLE) return denyAndClose('404 Not Found');

    let url;
    try {
        url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch (_) {
        return denyAndClose('400 Bad Request');
    }

    const match = RELAY_WS_PATH_RE.exec(url.pathname);
    if (!match) return denyAndClose('404 Not Found');

    // Origin check mirrors validateOrigin: if Origin is present it must
    // be in the allow-list; if absent we accept (legitimate non-browser
    // tooling and proxies that strip Origin on upgrade). The room secret
    // gates the actual authorisation; Origin is browser-CSRF defence.
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        console.warn(`[RELAY-WS] Blocked upgrade from unauthorized origin: ${sanitizeForLog(origin)}`);
        return denyAndClose('403 Forbidden');
    }

    const ip = _getUpgradeClientIp(req);
    // Use the 'general' bucket - same bucket that LP /up and /down hit -
    // so a per-IP cap is shared across all relay transport variants.
    const rl = checkRateLimit(ip, 'general');
    if (!rl.allowed) {
        return denyAndClose(`429 Too Many Requests`, `Retry-After: ${rl.retryAfter}\r\n`);
    }

    const roomId = match[1];
    const room = rooms.get(roomId);
    const providedSecret = url.searchParams.get('secret') || '';
    // Compare against DUMMY_ROOM_SECRET on missing-room branch so a
    // timing observer cannot distinguish "wrong room id" from "wrong
    // secret" (same enumeration-oracle concern as validateRoomSecret).
    const role = roomRoleForSecret(room, providedSecret);
    if (!role) return denyAndClose('401 Unauthorized');

    const r = room.relay || { a: null, b: null, sessionBytes: 0 };
    const slotName = RELAY_SLOT_FOR_ROLE[role];
    if (r[slotName]) return denyAndClose('409 Conflict');

    _relayWss.handleUpgrade(req, socket, head, (ws) => {
        attachRelay(room, ws, slotName);
        debugLog('RELAY', `WS slot ${slotName} attached for room ${roomId}`);
    });
});
