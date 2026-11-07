// Tier-2 test for the HuggingFace model relay (signaling/hf-relay.js).
//
// A fake "hub" and a fake "CDN" run as real HTTP servers on loopback; the relay
// is mounted in a real Express app pointed at the fake hub, and the tests talk
// to it over fetch. Nothing in the relay is mocked: redirects, Range, headers
// and streaming all cross real sockets.
//
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { startServer, stopServer } from './helpers.mjs';

const require = createRequire(import.meta.url);
const express = require('../../signaling/node_modules/express');
const { createHfRelay, parseRepoAllowlist, parseRelayPath, isAllowedHfHost, nextLinkUrl, runCheck } = require('../../signaling/hf-relay.js');

const REPO = 'Owner/model-onnx';
const BLOB = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const VOCAB = Buffer.from('a\nb\nc\n');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

// Fake CDN: serves BLOB with Range support, records request headers.
function makeCdn() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers, method: req.method });
    if (req.url.startsWith('/slow')) return; // never answers
    const etag = '"blob-etag"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const ifRangeOk = !req.headers['if-range'] || req.headers['if-range'] === etag;
    if (m && ifRangeOk) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : BLOB.length - 1;
      res.writeHead(206, {
        'content-type': 'application/octet-stream',
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${BLOB.length}`,
        'accept-ranges': 'bytes',
        etag,
      });
      return res.end(BLOB.subarray(start, end + 1));
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': BLOB.length, 'accept-ranges': 'bytes', etag });
    res.end(BLOB);
  });
  return { server, seen };
}

// Fake hub: resolve endpoint redirects big files to the CDN, serves small
// ones directly, tree API paginates over two pages.
function makeHub(cdnBaseRef, { evilRedirect = '' } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers, method: req.method });
    const base = `http://${req.headers.host}`;
    if (req.url === `/api/models/${REPO}/tree/main?recursive=1`) {
      res.writeHead(200, { 'content-type': 'application/json', link: `<${base}/api/models/${REPO}/tree/main?recursive=1&cursor=2>; rel="next"` });
      return res.end(JSON.stringify([
        { type: 'file', path: 'vocab.txt' },
        { type: 'directory', path: 'int8' },
        { type: 'file', path: 'int8/encoder-model.int8.onnx' },
      ]));
    }
    if (req.url === `/api/models/${REPO}/tree/main?recursive=1&cursor=2`) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify([
        { type: 'file', path: 'decoder_joint-model.onnx' },
        { type: 'file', path: '../evil' },
      ]));
    }
    if (req.url === '/api/whoami-v2') {
      if (req.headers.authorization === 'Bearer good') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"name":"tester"}'); }
      res.writeHead(401); return res.end();
    }
    if (req.url === `/${REPO}/resolve/main/vocab.txt`) {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': VOCAB.length, etag: '"v"' });
      return res.end(req.method === 'HEAD' ? undefined : VOCAB);
    }
    if (req.url === `/${REPO}/resolve/main/int8/encoder-model.int8.onnx`) {
      res.writeHead(302, {
        location: evilRedirect || `${cdnBaseRef.url}/blob`,
        'x-linked-size': String(BLOB.length),
        'x-linked-etag': '"blob-etag"',
      });
      return res.end();
    }
    if (req.url === `/${REPO}/resolve/main/slow.onnx`) {
      res.writeHead(302, { location: `${cdnBaseRef.url}/slow` });
      return res.end();
    }
    res.writeHead(404); res.end();
  });
  return { server, seen };
}

async function startRelay(hubUrl, opts = {}) {
  const app = express();
  app.set('trust proxy', 'loopback');
  const relay = createHfRelay({
    repos: parseRepoAllowlist(`${REPO}`),
    upstream: hubUrl,
    // The fake CDN is plain http on loopback; production requires https hf hosts.
    isAllowedHost: (u) => u.hostname === '127.0.0.1',
    log: () => {},
    ...opts,
  });
  app.use('/models', relay.handler);
  const server = http.createServer(app);
  const url = await listen(server);
  return { server, url, relay };
}

describe('hf-relay pure helpers', () => {
  test('parseRepoAllowlist accepts owner/name[@rev] and rejects junk', () => {
    const m = parseRepoAllowlist(' a/b , c/d@v1.2 ,');
    assert.deepEqual([...m], [['a/b', 'main'], ['c/d', 'v1.2']]);
    for (const bad of ['a', 'a/b/c', '../b', 'a/..', 'a/b@', 'a/b@../x', 'a/b c']) {
      assert.throws(() => parseRepoAllowlist(bad), /invalid/, bad);
    }
  });

  test('parseRelayPath only yields safe owner/name/file splits', () => {
    assert.deepEqual(parseRelayPath('/a/b/int8/x.onnx'), { repoId: 'a/b', file: 'int8/x.onnx' });
    for (const bad of ['/a/b', '/a/b/', '/a/b/../x', '/a/b/%2e%2e/x', '/a//b/x', 'a/b/x', '/a/b/x?y']) {
      assert.equal(parseRelayPath(bad), null, bad);
    }
  });

  test('isAllowedHfHost: https hub and CDN hosts only', () => {
    for (const ok of ['https://huggingface.co/x', 'https://cdn-lfs.huggingface.co/x', 'https://cas-bridge.xethub.hf.co/x', 'https://us.aws.cdn.hf.co/x']) {
      assert.ok(isAllowedHfHost(new URL(ok)), ok);
    }
    for (const bad of ['http://huggingface.co/x', 'https://evilhuggingface.co/x', 'https://huggingface.co.evil.com/x', 'https://evil.com/x', 'https://notahf.co/x']) {
      assert.ok(!isAllowedHfHost(new URL(bad)), bad);
    }
  });

  test('nextLinkUrl parses rel=next', () => {
    assert.equal(nextLinkUrl('<https://h/x?c=2>; rel="next"'), 'https://h/x?c=2');
    assert.equal(nextLinkUrl('<https://h/x>; rel="prev"'), null);
    assert.equal(nextLinkUrl(null), null);
  });
});

describe('hf-relay over real sockets', () => {
  const cdnRef = {};
  let cdn; let hub; let relay;
  before(async () => {
    cdn = makeCdn();
    cdnRef.url = await listen(cdn.server);
    hub = makeHub(cdnRef);
    const hubUrl = await listen(hub.server);
    relay = await startRelay(hubUrl, { token: 'secret-token' });
  });
  after(() => { relay.server.close(); hub.server.close(); cdn.server.close(); relay.server.closeAllConnections?.(); });

  test('synthesizes the manifest from every tree page, dropping dirs and unsafe paths', async () => {
    const res = await fetch(`${relay.url}/models/${REPO}/model-manifest.json`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
    assert.deepEqual(await res.json(), ['vocab.txt', 'int8/encoder-model.int8.onnx', 'decoder_joint-model.onnx']);
  });

  test('streams a redirected file with length, etag and ranges intact', async () => {
    const res = await fetch(`${relay.url}/models/${REPO}/int8/encoder-model.int8.onnx`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(BLOB.length));
    assert.equal(res.headers.get('etag'), '"blob-etag"');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), BLOB);
  });

  test('forwards Range + If-Range and returns the 206 slice', async () => {
    const res = await fetch(`${relay.url}/models/${REPO}/int8/encoder-model.int8.onnx`, {
      headers: { range: 'bytes=900-', 'if-range': '"blob-etag"' },
    });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 900-999/${BLOB.length}`);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), BLOB.subarray(900));
  });

  test('a stale If-Range gets the whole file (200), so the client restarts cleanly', async () => {
    const res = await fetch(`${relay.url}/models/${REPO}/int8/encoder-model.int8.onnx`, {
      headers: { range: 'bytes=900-', 'if-range': '"old"' },
    });
    assert.equal(res.status, 200);
    assert.equal((await res.arrayBuffer()).byteLength, BLOB.length);
  });

  test('If-None-Match round-trips a 304', async () => {
    const res = await fetch(`${relay.url}/models/${REPO}/int8/encoder-model.int8.onnx`, { headers: { 'if-none-match': '"blob-etag"' } });
    assert.equal(res.status, 304);
  });

  test('HEAD answers from the hub redirect without touching the CDN', async () => {
    const before = cdn.seen.length;
    const res = await fetch(`${relay.url}/models/${REPO}/int8/encoder-model.int8.onnx`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(BLOB.length));
    assert.equal(res.headers.get('etag'), '"blob-etag"');
    assert.equal(cdn.seen.length, before);
  });

  test('HEAD on a small non-redirected file passes size through', async () => {
    const res = await fetch(`${relay.url}/models/${REPO}/vocab.txt`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(VOCAB.length));
  });

  test('the token reaches the hub but never the CDN', async () => {
    await (await fetch(`${relay.url}/models/${REPO}/int8/encoder-model.int8.onnx`)).arrayBuffer();
    assert.ok(hub.seen.some((r) => r.headers.authorization === 'Bearer secret-token'));
    assert.ok(cdn.seen.length > 0);
    assert.ok(cdn.seen.every((r) => !r.headers.authorization), 'Authorization leaked to the CDN');
  });

  test('a repo outside the allowlist is a 404 and never reaches upstream', async () => {
    const before = hub.seen.length;
    for (const p of ['/models/Other/repo/vocab.txt', '/models/Other/repo/model-manifest.json', '/models/vocab.txt', '/models/model-manifest.json']) {
      assert.equal((await fetch(`${relay.url}${p}`)).status, 404, p);
    }
    assert.equal(hub.seen.length, before);
  });

  test('a missing file on the hub is a 404', async () => {
    assert.equal((await fetch(`${relay.url}/models/${REPO}/nope.onnx`)).status, 404);
  });

  test('non-GET/HEAD is refused', async () => {
    assert.equal((await fetch(`${relay.url}/models/${REPO}/vocab.txt`, { method: 'POST' })).status, 405);
  });
});

describe('hf-relay refuses redirects off the hub', () => {
  let hub; let relay;
  before(async () => {
    hub = makeHub({}, { evilRedirect: 'http://127.0.0.2:1/steal' });
    const hubUrl = await listen(hub.server);
    relay = await startRelay(hubUrl, { isAllowedHost: isAllowedHfHost });
  });
  after(() => { relay.server.close(); hub.server.close(); });

  test('redirect to a non-HF host is a 502', async () => {
    assert.equal((await fetch(`${relay.url}/models/${REPO}/int8/encoder-model.int8.onnx`)).status, 502);
  });
});

describe('hf-relay concurrency cap', () => {
  const cdnRef = {};
  let cdn; let hub; let relay;
  before(async () => {
    cdn = makeCdn();
    cdnRef.url = await listen(cdn.server);
    hub = makeHub(cdnRef);
    relay = await startRelay(await listen(hub.server), { maxStreams: 1 });
  });
  after(() => {
    for (const s of [relay.server, hub.server, cdn.server]) { s.closeAllConnections?.(); s.close(); }
  });

  test('a second concurrent stream beyond the cap gets 503 + Retry-After', async () => {
    const ctrl = new AbortController();
    const hanging = fetch(`${relay.url}/models/${REPO}/slow.onnx`, { signal: ctrl.signal }).catch(() => {});
    // Wait until the slow request is parked at the CDN.
    for (let i = 0; i < 100 && !cdn.seen.some((r) => r.url === '/slow'); i++) await new Promise((r) => setTimeout(r, 20));
    const res = await fetch(`${relay.url}/models/${REPO}/vocab.txt`);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '5');
    ctrl.abort();
    await hanging;
    // The aborted client must release its slot, or the cap leaks shut.
    let status = 0;
    for (let i = 0; i < 50 && status !== 200; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const again = await fetch(`${relay.url}/models/${REPO}/vocab.txt`);
      status = again.status;
      await again.arrayBuffer();
    }
    assert.equal(status, 200);
  });
});

describe('hf-relay startup check', () => {
  const cdnRef = {};
  let cdn; let hub; let hubUrl;
  before(async () => {
    cdn = makeCdn();
    cdnRef.url = await listen(cdn.server);
    hub = makeHub(cdnRef);
    hubUrl = await listen(hub.server);
  });
  after(() => { hub.server.close(); cdn.server.close(); });

  // runCheck uses the production host policy for redirects, so give it a hub
  // whose redirect stays on the hub origin; the CDN leg is covered above.
  test('fails clearly on a rejected token and on an unknown repo', async () => {
    const failures = await runCheck({ repos: parseRepoAllowlist('Ghost/repo'), token: 'bad', upstream: hubUrl, log: () => {} });
    assert.ok(failures.some((f) => /HF_TOKEN was rejected/.test(f)), failures.join('\n'));
    assert.ok(failures.some((f) => /cannot list Ghost\/repo@main/.test(f)), failures.join('\n'));
  });

  test('passes with a good token and saves vocab.txt', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hfrelay-')), 'vocab.txt');
    // The encoder redirect goes to plain-http loopback, which the production
    // host policy refuses, so the CDN check reports it: that proves the check
    // really follows the redirect instead of trusting the hub's 302.
    const failures = await runCheck({ repos: parseRepoAllowlist(REPO), token: 'good', upstream: hubUrl, vocabOut: out, log: () => {} });
    assert.deepEqual(failures.filter((f) => !/through the hub CDN/.test(f)), []);
    assert.ok(failures.some((f) => /refusing redirect/.test(f)));
    assert.deepEqual(fs.readFileSync(out), VOCAB);
  });
});

describe('signaling server mounts the relay', () => {
  let srv;
  before(async () => { srv = await startServer({ HF_RELAY_REPOS: '' }); });
  after(async () => { await stopServer(srv); });

  test('with no allowlist every /models path is a 404', async () => {
    assert.equal((await fetch(`${srv.baseUrl}/models/${REPO}/vocab.txt`)).status, 404);
  });

  test('a malformed allowlist crashes the server at boot', async () => {
    await assert.rejects(startServer({ HF_RELAY_REPOS: 'not-a-repo' }));
  });
});
