// Tier-2 integration test: the HTTPS relay must not let one peer grow relay
// memory. Regression guards for three paths that used to be unbounded or
// loosely bounded:
//   - a WS frame was accepted up to the ws default of 100 MiB (no maxPayload),
//   - an LP slot queue was capped by frame count only (32 x 256 KiB = 8 MiB),
//   - a WS peer that never reads had every frame buffered for it by the relay.
//
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { startServer, stopServer, createRoom, apiPost } from './helpers.mjs';

const KiB = 1024;
const MiB = 1024 * KiB;

let srv;
// A long heartbeat so the ping sweep cannot be what closes a stuck socket.
before(async () => { srv = await startServer({ RELAY_WS_PING_INTERVAL_MS: '600000' }); });
after(async () => { await stopServer(srv); });

function wsUrl(roomId, secret) {
  return `ws://127.0.0.1:${srv.port}/api/rooms/${roomId}/relay?secret=${encodeURIComponent(secret)}`;
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error('ws failed to open'));
  });
}

function closeCode(ws, timeoutMs) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    ws.addEventListener('close', (ev) => { clearTimeout(t); resolve(ev.code); });
  });
}

// A WS client that completes the upgrade and then never reads a byte.
function openStuckWs(roomId, secret) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(srv.port, '127.0.0.1');
    sock.on('error', reject);
    sock.on('connect', () => {
      sock.write([
        `GET /api/rooms/${roomId}/relay?secret=${encodeURIComponent(secret)} HTTP/1.1`,
        `Host: 127.0.0.1:${srv.port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}`,
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'));
    });
    sock.once('data', (d) => {
      if (!d.toString().startsWith('HTTP/1.1 101')) return reject(new Error(`upgrade refused: ${d}`));
      sock.pause();
      resolve(sock);
    });
  });
}

async function lpHandshake(roomId, secret) {
  const res = await apiPost(srv, `/api/rooms/${roomId}/relay/handshake`, {}, secret);
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

function lpHeaders(secret, token, extra = {}) {
  return { Origin: srv.origin, 'X-Room-Secret': secret, 'X-Slot-Token': token, ...extra };
}

describe('relay memory bounds', () => {
  test('a WS frame larger than the LP frame limit closes the socket with 1009', async () => {
    const { roomId, hostSecret } = await createRoom(srv);
    const ws = await openWs(wsUrl(roomId, hostSecret));
    const closed = closeCode(ws, 5000);
    ws.send(new Uint8Array(300 * KiB));
    assert.equal(await closed, 1009);
  });

  test('an LP slot queue holds at most 4 MiB when its receiver does not poll', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    const hostToken = await lpHandshake(roomId, hostSecret);
    const phoneToken = await lpHandshake(roomId, secret);
    // 30 frames of 200 KiB: under the 32-frame cap, 6000 KiB in total.
    for (let i = 0; i < 30; i++) {
      const res = await fetch(`${srv.baseUrl}/api/rooms/${roomId}/relay/up`, {
        method: 'POST',
        headers: lpHeaders(secret, phoneToken, { 'Content-Type': 'application/octet-stream' }),
        body: new Uint8Array(200 * KiB),
      });
      assert.equal(res.status, 204);
    }
    let queued = 0;
    for (;;) {
      const res = await fetch(`${srv.baseUrl}/api/rooms/${roomId}/relay/down`, { headers: lpHeaders(hostSecret, hostToken) });
      if (res.status === 204) break;
      assert.equal(res.status, 200);
      queued += (await res.arrayBuffer()).byteLength;
    }
    assert.ok(queued > 0, 'the newest frames are kept');
    assert.ok(queued <= 4 * MiB, `queued ${queued} bytes, over the 4 MiB cap`);
  });

  test('a WS peer that never reads is dropped instead of buffered for', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    const stuck = await openStuckWs(roomId, secret);
    const host = await openWs(wsUrl(roomId, hostSecret));
    const closed = closeCode(host, 10_000);
    // 30 MiB: far past what loopback socket buffers absorb, so the relay's
    // own buffer for the stuck phone has to grow past its cap.
    const frame = new Uint8Array(250 * KiB);
    for (let i = 0; i < 120 && host.readyState === WebSocket.OPEN; i++) host.send(frame);
    const code = await closed;
    stuck.destroy();
    assert.notEqual(code, null, 'the sender was never disconnected: the relay kept buffering');
  });
});
