'use strict';
// HuggingFace model relay: serves /models/<owner>/<repo>/<path> by streaming
// the file from huggingface.co, so a visitor who can reach this site but not
// the hub still gets the weights. It replaces the old on-disk fallback mirror
// (LOCAL_MODEL_PATH), which cost ~25 GB of server disk for the same purpose.
//
// Why a streaming relay rather than a cache: the server is short on disk AND
// RAM. Nothing here is buffered beyond the stream's own backpressure window,
// nothing touches the disk, and the cost is bandwidth only.
//
// The client is unchanged on purpose: it already knows how to load from a
// /models mirror (hub.js getLocalModelFile, resolveLocalModelBase,
// listLocalRepoFiles), so the relay simply speaks that mirror's protocol:
//   - GET/HEAD /models/<owner>/<repo>/<path>      the file itself
//   - GET      /models/<owner>/<repo>/model-manifest.json
//                                                 the repo listing, synthesized
//                                                 from the HF tree API
// Range / If-Range / If-None-Match are forwarded and Content-Length,
// Content-Range, Accept-Ranges and ETag come back, because the client's
// buffer preallocation, byte progress and resumable fp32 prefix cache are all
// gated on them (see under-serving-fixture notes in CLAUDE.md).
//
// Security: this must never become an open proxy.
//   - Only repos in the allowlist (HF_RELAY_REPOS, built by the entrypoint
//     from VITE_MODEL_REPO and the diarization repos) are served; anything
//     else is a 404 without contacting upstream.
//   - Every path segment must be a plain [A-Za-z0-9._-] token (no '..', no
//     encoding tricks), the same rule hub.js isSafeRepoPath applies.
//   - Redirects are followed by hand and every hop must be https on
//     huggingface.co, *.huggingface.co or *.hf.co.
//   - HF_TOKEN is sent ONLY to the upstream origin (huggingface.co), never to
//     the CDN hosts it redirects to.
//
// Also runnable as a CLI: `node hf-relay.js --check [--vocab-out FILE]`
// verifies at container start that the hub is reachable from the server for
// every allowlisted repo (and that HF_TOKEN is accepted when set), exiting
// non-zero otherwise so a relay that cannot work never boots silently.
//
// Built with Claude Code.

const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const DEFAULT_UPSTREAM = 'https://huggingface.co';
const MANIFEST_FILE = 'model-manifest.json';
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const MAX_REDIRECTS = 5;
const MAX_MANIFEST_PAGES = 20;
const MAX_MANIFEST_ENTRIES = 20000;
const HEADERS_TIMEOUT_MS = 30_000;
const MANIFEST_TTL_MS = 60_000;

// Headers copied from the upstream file response to the client.
const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];
// Headers copied from the client request to upstream.
const FORWARDED_REQUEST_HEADERS = ['range', 'if-range', 'if-none-match'];

function isSafeSegment(seg) {
    return SAFE_SEGMENT_RE.test(seg) && seg !== '.' && seg !== '..';
}

function isSafeRepoPath(p) {
    return typeof p === 'string' && p.length > 0 && p.split('/').every(isSafeSegment);
}

/** Hosts a redirect is allowed to land on. */
function isAllowedHfHost(url) {
    if (url.protocol !== 'https:') return false;
    const h = url.hostname.toLowerCase();
    return h === 'huggingface.co' || h.endsWith('.huggingface.co') || h === 'hf.co' || h.endsWith('.hf.co');
}

/**
 * Parse the allowlist: comma-separated `owner/name[@revision]` entries.
 * Throws on a malformed entry so a typo crashes the boot instead of silently
 * dropping a repo the app will then fail to load.
 *
 * @param {string} raw e.g. 'Olicorne/a@main,csukuangfj/b'
 * @returns {Map<string, string>} repoId -> revision
 */
function parseRepoAllowlist(raw) {
    const repos = new Map();
    for (const entry of String(raw || '').split(',').map((s) => s.trim()).filter(Boolean)) {
        const at = entry.indexOf('@');
        const repoId = at === -1 ? entry : entry.slice(0, at);
        const revision = at === -1 ? 'main' : entry.slice(at + 1);
        const parts = repoId.split('/');
        if (parts.length !== 2 || !parts.every(isSafeSegment)) {
            throw new Error(`HF relay: invalid repo id "${entry}" (expected owner/name[@revision])`);
        }
        if (!revision || !/^[A-Za-z0-9._/-]+$/.test(revision) || revision.split('/').some((s) => s === '..' || s === '.' || s === '')) {
            throw new Error(`HF relay: invalid revision in "${entry}"`);
        }
        repos.set(repoId, revision);
    }
    return repos;
}

/**
 * Split a request path (already stripped of the /models prefix) into repo id
 * and file path. Returns null for anything that is not <owner>/<name>/<path>
 * made only of safe segments.
 *
 * @param {string} p e.g. '/Olicorne/x/int8/encoder.onnx'
 * @returns {{repoId: string, file: string}|null}
 */
function parseRelayPath(p) {
    if (typeof p !== 'string' || !p.startsWith('/')) return null;
    const segs = p.slice(1).split('/');
    if (segs.length < 3 || !segs.every(isSafeSegment)) return null;
    return { repoId: `${segs[0]}/${segs[1]}`, file: segs.slice(2).join('/') };
}

/** Extract the rel="next" URL from an RFC 8288 Link header. */
function nextLinkUrl(link) {
    if (!link) return null;
    for (const part of link.split(',')) {
        const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
        if (m) return m[1];
    }
    return null;
}

/**
 * Build the relay.
 *
 * @param {object} opts
 * @param {Map<string,string>} opts.repos Allowlist from parseRepoAllowlist.
 * @param {string} [opts.token] HF token, sent only to the upstream origin.
 * @param {string} [opts.upstream] Upstream origin (tests point it at a fake).
 * @param {(url: URL) => boolean} [opts.isAllowedHost] Redirect host policy (tests widen it).
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.maxStreams=16] Concurrent file bodies across all clients.
 * @param {number} [opts.maxStreamsPerClient=8] Concurrent file bodies per client IP.
 * @param {number} [opts.manifestTtlMs]
 * @param {(msg: string) => void} [opts.log]
 */
function createHfRelay({
    repos,
    token = '',
    upstream = DEFAULT_UPSTREAM,
    isAllowedHost = isAllowedHfHost,
    fetchImpl = fetch,
    maxStreams = 16,
    maxStreamsPerClient = 8,
    manifestTtlMs = MANIFEST_TTL_MS,
    log = (msg) => console.log(msg),
} = {}) {
    const upstreamOrigin = new URL(upstream).origin;
    const manifestCache = new Map(); // key -> {expires, promise}
    let activeStreams = 0;
    const perClient = new Map();

    function upstreamHeaders(url, extra = {}) {
        const headers = { 'user-agent': 'parakeet-web-hf-relay', 'accept-encoding': 'identity', ...extra };
        if (token && url.origin === upstreamOrigin) headers.authorization = `Bearer ${token}`;
        return headers;
    }

    // Fetch with manual redirect following and per-hop host validation.
    // Resolves to the final non-redirect Response.
    async function fetchFollowing(startUrl, { method = 'GET', headers = {}, signal } = {}) {
        let url = new URL(startUrl);
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            const res = await fetchImpl(url, { method, headers: upstreamHeaders(url, headers), redirect: 'manual', signal });
            if (res.status < 300 || res.status >= 400 || res.status === 304) return res;
            const loc = res.headers.get('location');
            // Drain the redirect body so the connection can be reused.
            try { await res.body?.cancel(); } catch { /* ignore */ }
            if (!loc) throw Object.assign(new Error(`redirect without Location from ${url.host}`), { status: 502 });
            const next = new URL(loc, url);
            if (next.origin !== upstreamOrigin && !isAllowedHost(next)) {
                throw Object.assign(new Error(`refusing redirect to ${next.host}`), { status: 502 });
            }
            url = next;
        }
        throw Object.assign(new Error('too many redirects'), { status: 502 });
    }

    function resolveUrl(repoId, file) {
        return `${upstream}/${repoId}/resolve/${encodeURIComponent(repos.get(repoId))}/${file}`;
    }

    async function listRepo(repoId) {
        const revision = repos.get(repoId);
        const key = `${repoId}@${revision}`;
        const hit = manifestCache.get(key);
        if (hit && hit.expires > Date.now()) return hit.promise;
        const promise = (async () => {
            const files = [];
            let url = `${upstream}/api/models/${repoId}/tree/${encodeURIComponent(revision)}?recursive=1`;
            for (let page = 0; url && page < MAX_MANIFEST_PAGES; page++) {
                const parsed = new URL(url);
                if (parsed.origin !== upstreamOrigin) throw new Error(`tree pagination left ${upstreamOrigin}`);
                const res = await fetchFollowing(parsed, { signal: AbortSignal.timeout(HEADERS_TIMEOUT_MS) });
                if (!res.ok) throw Object.assign(new Error(`tree listing for ${key} returned HTTP ${res.status}`), { upstreamStatus: res.status });
                const json = await res.json();
                if (!Array.isArray(json)) throw new Error(`tree listing for ${key} is not an array`);
                for (const entry of json) {
                    if (entry?.type === 'file' && isSafeRepoPath(entry.path)) files.push(entry.path);
                }
                if (files.length > MAX_MANIFEST_ENTRIES) throw new Error(`tree listing for ${key} exceeds ${MAX_MANIFEST_ENTRIES} entries`);
                url = nextLinkUrl(res.headers.get('link'));
            }
            if (url) throw new Error(`tree listing for ${key} exceeds ${MAX_MANIFEST_PAGES} pages`);
            return files;
        })();
        manifestCache.set(key, { expires: Date.now() + manifestTtlMs, promise });
        // A failed listing must not be cached for the whole TTL.
        promise.catch(() => manifestCache.delete(key));
        return promise;
    }

    function clientKey(req) {
        return req.ip || req.socket?.remoteAddress || 'unknown';
    }

    async function serveManifest(req, res, repoId) {
        try {
            const files = await listRepo(repoId);
            res.set('Cache-Control', 'no-cache');
            res.type('application/json');
            if (req.method === 'HEAD') return res.status(200).end();
            return res.status(200).send(JSON.stringify(files));
        } catch (err) {
            log(`[hf-relay] manifest ${repoId}: ${err.message}`);
            return res.status(err.upstreamStatus === 404 ? 404 : 502).end();
        }
    }

    async function serveHead(res, repoId, file) {
        // HEAD stops at the hub: the resolve response already carries the
        // real size and ETag of an LFS file (X-Linked-Size / X-Linked-Etag),
        // which is what huggingface_hub itself reads, so there is no need to
        // touch the CDN for a presence probe.
        const url = new URL(resolveUrl(repoId, file));
        const r = await fetchImpl(url, { method: 'HEAD', headers: upstreamHeaders(url), redirect: 'manual', signal: AbortSignal.timeout(HEADERS_TIMEOUT_MS) });
        if (r.status === 404) return res.status(404).end();
        if (r.status >= 400) return res.status(502).end();
        const size = r.headers.get('x-linked-size') || r.headers.get('content-length');
        const etag = r.headers.get('x-linked-etag') || r.headers.get('etag');
        if (size) res.set('Content-Length', size);
        if (etag) res.set('ETag', etag);
        res.set('Accept-Ranges', 'bytes');
        res.set('Cache-Control', 'no-cache');
        const type = r.status < 300 ? r.headers.get('content-type') : null;
        res.set('Content-Type', type || 'application/octet-stream');
        return res.status(200).end();
    }

    async function serveFile(req, res, repoId, file) {
        const ip = clientKey(req);
        const mine = perClient.get(ip) || 0;
        if (activeStreams >= maxStreams || mine >= maxStreamsPerClient) {
            res.set('Retry-After', '5');
            return res.status(503).end();
        }
        activeStreams++;
        perClient.set(ip, mine + 1);
        const controller = new AbortController();
        const onClose = () => controller.abort();
        res.on('close', onClose);
        const headersTimer = setTimeout(() => controller.abort(), HEADERS_TIMEOUT_MS);
        try {
            const fwd = {};
            for (const h of FORWARDED_REQUEST_HEADERS) {
                if (req.headers[h]) fwd[h] = req.headers[h];
            }
            const r = await fetchFollowing(resolveUrl(repoId, file), { headers: fwd, signal: controller.signal });
            clearTimeout(headersTimer);
            if (r.status === 404) { await r.body?.cancel(); return res.status(404).end(); }
            if (![200, 206, 304, 416].includes(r.status)) {
                log(`[hf-relay] ${repoId}/${file}: upstream HTTP ${r.status}`);
                await r.body?.cancel();
                return res.status(502).end();
            }
            for (const h of PASSTHROUGH_HEADERS) {
                const v = r.headers.get(h);
                if (v) res.set(h, v);
            }
            // fetch decodes a content-encoded body, so the upstream length
            // and range no longer describe the bytes we forward.
            if (r.headers.get('content-encoding')) {
                res.removeHeader('content-length');
                res.removeHeader('content-range');
            }
            res.set('Cache-Control', 'no-cache');
            res.status(r.status);
            if (!r.body || r.status === 304) return res.end();
            await pipeline(Readable.fromWeb(r.body), res);
        } catch (err) {
            if (controller.signal.aborted && res.destroyed) return; // client went away
            log(`[hf-relay] ${repoId}/${file}: ${err.message}`);
            if (!res.headersSent) res.status(err.status || 502).end();
            else res.destroy();
        } finally {
            clearTimeout(headersTimer);
            res.off('close', onClose);
            activeStreams--;
            const n = (perClient.get(ip) || 1) - 1;
            if (n > 0) perClient.set(ip, n); else perClient.delete(ip);
        }
    }

    /** Express handler, mount with app.use('/models', relay.handler). */
    async function handler(req, res) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.set('Allow', 'GET, HEAD');
            return res.status(405).end();
        }
        const parsed = parseRelayPath(req.path);
        if (!parsed || !repos.has(parsed.repoId)) return res.status(404).end();
        const { repoId, file } = parsed;
        if (file === MANIFEST_FILE) return serveManifest(req, res, repoId);
        if (req.method === 'HEAD') {
            try { return await serveHead(res, repoId, file); } catch (err) {
                log(`[hf-relay] HEAD ${repoId}/${file}: ${err.message}`);
                return res.status(502).end();
            }
        }
        return serveFile(req, res, repoId, file);
    }

    return { handler, listRepo, fetchFollowing, resolveUrl, stats: () => ({ activeStreams }) };
}

/**
 * Startup check: every allowlisted repo lists, the token (if any) is
 * accepted, and a real weight file is reachable through the CDN redirect.
 * Optionally saves the first repo's vocab.txt (the boost prebuild needs it).
 *
 * @returns {Promise<string[]>} Human-readable failure messages (empty = OK).
 */
async function runCheck({ repos, token, upstream = DEFAULT_UPSTREAM, fetchImpl = fetch, vocabOut = '', log = console.log } = {}) {
    const relay = createHfRelay({ repos, token, upstream, fetchImpl, log });
    const failures = [];
    if (token) {
        try {
            const url = new URL(`${upstream}/api/whoami-v2`);
            const r = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(HEADERS_TIMEOUT_MS) });
            if (r.status === 401 || r.status === 403) failures.push(`HF_TOKEN was rejected by ${upstream} (HTTP ${r.status})`);
            else if (!r.ok) failures.push(`could not validate HF_TOKEN: ${upstream}/api/whoami-v2 returned HTTP ${r.status}`);
            else {
                const who = await r.json().catch(() => ({}));
                log(`[hf-relay] HF_TOKEN accepted (user: ${who?.name || 'unknown'})`);
            }
        } catch (err) {
            failures.push(`could not reach ${upstream} to validate HF_TOKEN: ${err.message}`);
        }
    }
    let first = true;
    for (const [repoId, revision] of repos) {
        let files;
        try {
            files = await relay.listRepo(repoId);
            if (!files.length) throw new Error('listing is empty');
        } catch (err) {
            const denied = err.upstreamStatus === 401 || err.upstreamStatus === 403;
            failures.push(`cannot list ${repoId}@${revision} on ${upstream}: ${err.message}`
                + (denied ? ` (the repo is private, gated or does not exist: ${token ? 'HF_TOKEN has no access to it' : 'set HF_TOKEN to a token with access'}, or point the matching VITE_* repo variable at a public repo)` : ''));
            first = false;
            continue;
        }
        // Prove the CDN leg too: the hub API answering says nothing about the
        // redirect target (cas-bridge.xethub.hf.co, cdn-lfs...) being reachable.
        const weight = files.find((f) => f.endsWith('.onnx') || f.endsWith('.onnx.data')) || files[0];
        try {
            const r = await relay.fetchFollowing(relay.resolveUrl(repoId, weight), { headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(HEADERS_TIMEOUT_MS) });
            await r.body?.cancel();
            if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`);
        } catch (err) {
            failures.push(`cannot download ${repoId}/${weight} through the hub CDN: ${err.message}`);
        }
        if (first && vocabOut && files.includes('vocab.txt')) {
            try {
                const r = await relay.fetchFollowing(relay.resolveUrl(repoId, 'vocab.txt'), { signal: AbortSignal.timeout(HEADERS_TIMEOUT_MS) });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                require('fs').writeFileSync(vocabOut, Buffer.from(await r.arrayBuffer()));
            } catch (err) {
                failures.push(`cannot download ${repoId}/vocab.txt: ${err.message}`);
            }
        }
        first = false;
        log(`[hf-relay] ${repoId}@${revision}: ${files.length} files, CDN reachable`);
    }
    return failures;
}

module.exports = { MANIFEST_FILE, createHfRelay, parseRepoAllowlist, parseRelayPath, isAllowedHfHost, nextLinkUrl, runCheck };

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args[0] !== '--check') {
        console.error('usage: node hf-relay.js --check [--vocab-out FILE]');
        process.exit(2);
    }
    const vi = args.indexOf('--vocab-out');
    const vocabOut = vi !== -1 ? args[vi + 1] : '';
    (async () => {
        const repos = parseRepoAllowlist(process.env.HF_RELAY_REPOS);
        if (!repos.size) throw new Error('HF_RELAY_REPOS is empty');
        const failures = await runCheck({ repos, token: process.env.HF_TOKEN || '', vocabOut });
        if (failures.length) {
            for (const f of failures) console.error(`[hf-relay] ERROR: ${f}`);
            process.exit(1);
        }
    })().catch((err) => { console.error(`[hf-relay] ERROR: ${err.message}`); process.exit(1); });
}
