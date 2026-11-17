// Tier-2 integration test: limits on relay HTTP requests held open at once.
// Regression guards: the only bounds on /relay/up and /relay/down used to be a
// per-minute rate limit, the 35 s server.requestTimeout and the long-poll
// waiter caps, so one client could keep any number of requests open, many
// clients could keep any number of 256 KiB bodies half-read, and a body could
// trickle in for the whole 35 s.
//
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startServer, stopServer, createRoom, apiPost } from './helpers.mjs';

async function lpHandshake(srv, roomId, secret) {
  const res = await apiPost(srv, `/api/rooms/${roomId}/relay/handshake`, {}, secret);
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

function lpHeaders(srv, secret, token, extra = {}) {
  return { Origin: srv.origin, 'X-Room-Secret': secret, 'X-Slot-Token': token, ...extra };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST /relay/up headers announcing `contentLength` bytes, then `sent` bytes
// of body and nothing more. Resolves with the socket; `response` collects
// whatever the server answers.
function openSlowUpload(srv, roomId, secret, contentLength, sent = 0) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(srv.port, '127.0.0.1');
    sock.response = '';
    sock.on('data', (d) => { sock.response += d.toString(); });
    sock.on('error', () => {});
    sock.on('connect', () => {
      sock.write([
        `POST /api/rooms/${roomId}/relay/up HTTP/1.1`,
        `Host: 127.0.0.1:${srv.port}`,
        `Origin: ${srv.origin}`,
        `X-Room-Secret: ${secret}`,
        'Content-Type: application/octet-stream',
        `Content-Length: ${contentLength}`,
        '', '',
      ].join('\r\n'));
      if (sent > 0) sock.write(Buffer.alloc(sent));
      resolve(sock);
    });
    sock.once('error', reject);
  });
}

describe('per-client relay requests in flight', () => {
  let srv;
  // Limiter live; one room per client makes the in-flight cap 4.
  before(async () => { srv = await startServer({ TEST_DISABLE_RATE_LIMIT: '0', ROOMS_MAX_PER_CLIENT: '1' }); });
  after(async () => { await stopServer(srv); });

  test('the 5th open relay request is 429 with Retry-After, and a finished one frees its place', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    const hostToken = await lpHandshake(srv, roomId, hostSecret);
    const phoneToken = await lpHandshake(srv, roomId, secret);
    const downUrl = `${srv.baseUrl}/api/rooms/${roomId}/relay/down?wait=true`;
    const polls = [];
    const openPoll = (sec, token) => {
      const ac = new AbortController();
      const p = fetch(downUrl, { headers: lpHeaders(srv, sec, token), signal: ac.signal }).catch(() => null);
      polls.push({ ac, p });
      return ac;
    };
    // Two held polls per slot: under the per-slot waiter cap of 4.
    const first = openPoll(hostSecret, hostToken);
    openPoll(hostSecret, hostToken);
    openPoll(secret, phoneToken);
    openPoll(secret, phoneToken);
    await sleep(200);
    try {
      const res = await fetch(downUrl, { headers: lpHeaders(srv, hostSecret, hostToken), signal: AbortSignal.timeout(3000) });
      assert.equal(res.status, 429);
      assert.ok(res.headers.get('retry-after'), 'Retry-After is set');
      assert.match((await res.json()).error, /in flight/);

      first.abort();
      await sleep(200);
      const up = await fetch(`${srv.baseUrl}/api/rooms/${roomId}/relay/up`, {
        method: 'POST',
        headers: lpHeaders(srv, secret, phoneToken, { 'Content-Type': 'application/octet-stream' }),
        body: new Uint8Array(16),
      });
      assert.equal(up.status, 204, 'the aborted poll released its place');
    } finally {
      for (const { ac } of polls) ac.abort();
      await Promise.all(polls.map(({ p }) => p));
    }
  });
});

describe('relay body budget and read timer', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(async () => { await stopServer(srv); });

  test('uploads past the 32 MiB global body budget get 503, and closing them frees it', async () => {
    const { roomId, secret } = await createRoom(srv);
    const upUrl = `${srv.baseUrl}/api/rooms/${roomId}/relay/up`;
    const probe = async () => {
      const res = await fetch(upUrl, {
        method: 'POST',
        headers: { Origin: srv.origin, 'X-Room-Secret': secret, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(16),
      });
      await res.arrayBuffer();
      return res;
    };
    // 128 half-read 256 KiB bodies reserve the whole 32 MiB.
    const socks = [];
    for (let i = 0; i < 128; i++) socks.push(await openSlowUpload(srv, roomId, secret, 256 * 1024));
    try {
      let res;
      for (let i = 0; i < 30; i++) {
        res = await probe();
        if (res.status === 503) break;
        await sleep(100);
      }
      assert.equal(res.status, 503);
      assert.ok(res.headers.get('retry-after'), 'Retry-After is set');
    } finally {
      for (const s of socks) s.destroy();
    }
    let status;
    for (let i = 0; i < 30; i++) {
      status = (await probe()).status;
      if (status !== 503) break;
      await sleep(100);
    }
    // No slot token: the request now gets past the budget to the token check.
    assert.equal(status, 409);
  });

  test('a body that stalls is answered 408 after ~10 s, not at the 35 s request timeout', async () => {
    const { roomId, secret } = await createRoom(srv);
    const start = Date.now();
    const sock = await openSlowUpload(srv, roomId, secret, 1000, 10);
    try {
      while (!sock.response.startsWith('HTTP/1.1') && Date.now() - start < 15_000) await sleep(100);
      const elapsed = Date.now() - start;
      assert.match(sock.response, /^HTTP\/1\.1 408/, `got: ${sock.response.slice(0, 40) || 'nothing within 15 s'}`);
      assert.ok(elapsed >= 9_000, `answered after ${elapsed} ms, before the read timer`);
    } finally {
      sock.destroy();
    }
  });
});
