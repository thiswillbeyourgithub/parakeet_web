// Tier-2 integration test: long-poll queues share one relay-wide byte budget
// (64 MiB), so many rooms each filling their 4 MiB slot cannot push the relay
// container into an OOM kill. Past the budget /up answers 429 with
// Retry-After, and draining a queue gives its bytes back.
//
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, createRoom, apiPost } from './helpers.mjs';

const KiB = 1024;

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await stopServer(srv); });

async function lpHandshake(roomId, secret) {
  const res = await apiPost(srv, `/api/rooms/${roomId}/relay/handshake`, {}, secret);
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

function lpHeaders(secret, token, extra = {}) {
  return { Origin: srv.origin, 'X-Room-Secret': secret, 'X-Slot-Token': token, ...extra };
}

function up(room, body) {
  return fetch(`${srv.baseUrl}/api/rooms/${room.roomId}/relay/up`, {
    method: 'POST',
    headers: lpHeaders(room.secret, room.phoneToken, { 'Content-Type': 'application/octet-stream' }),
    body,
  });
}

describe('relay-wide LP queue budget', () => {
  test('past 64 MiB queued, /up gets 429 until a queue is drained', async () => {
    const frame = new Uint8Array(200 * KiB);
    const rooms = [];
    let refused = null;
    // 20 x 200 KiB = 4000 KiB per room, under the 4 MiB slot cap:
    // the 17th room crosses 64 MiB.
    for (let r = 0; r < 17 && !refused; r++) {
      const room = await createRoom(srv);
      room.hostToken = await lpHandshake(room.roomId, room.hostSecret);
      room.phoneToken = await lpHandshake(room.roomId, room.secret);
      rooms.push(room);
      for (let i = 0; i < 20; i++) {
        const res = await up(room, frame);
        if (res.status === 429) { refused = res; break; }
        assert.equal(res.status, 204);
      }
    }
    assert.ok(refused, 'the relay kept queueing past its budget');
    assert.equal(refused.headers.get('retry-after'), '1');

    const first = rooms[0];
    for (;;) {
      const res = await fetch(`${srv.baseUrl}/api/rooms/${first.roomId}/relay/down`, { headers: lpHeaders(first.hostSecret, first.hostToken) });
      if (res.status === 204) break;
      assert.equal(res.status, 200);
      await res.arrayBuffer();
    }
    assert.equal((await up(rooms.at(-1), frame)).status, 204);
  });
});

// WS send buffers count in the same budget. A small budget, mostly taken by
// one LP queue, makes the next WS frame overflow it deterministically
// (no dependence on how much the kernel socket buffers absorb).
describe('WS frames share the relay-wide budget', () => {
  let small;
  before(async () => { small = await startServer({ RELAY_QUEUE_BUDGET_BYTES: String(1024 * KiB) }); });
  after(async () => { await stopServer(small); });

  function openWs(roomId, secret) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${small.port}/api/rooms/${roomId}/relay?secret=${encodeURIComponent(secret)}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => resolve(ws);
      ws.onerror = () => reject(new Error('ws failed to open'));
    });
  }
  const nextEvent = (ws) => new Promise((resolve) => {
    ws.addEventListener('message', (ev) => resolve({ type: 'message', size: ev.data.byteLength }), { once: true });
    ws.addEventListener('close', () => resolve({ type: 'close' }), { once: true });
  });

  test('a WS receiver is dropped when LP queues hold the budget, and served once they drain', async () => {
    const lpRoom = await createRoom(small);
    const hs = async (secret) => (await (await apiPost(small, `/api/rooms/${lpRoom.roomId}/relay/handshake`, {}, secret)).json()).token;
    const hostToken = await hs(lpRoom.hostSecret);
    const phoneToken = await hs(lpRoom.secret);
    const hdr = (secret, token, extra = {}) => ({ Origin: small.origin, 'X-Room-Secret': secret, 'X-Slot-Token': token, ...extra });
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${small.baseUrl}/api/rooms/${lpRoom.roomId}/relay/up`, {
        method: 'POST', headers: hdr(lpRoom.secret, phoneToken, { 'Content-Type': 'application/octet-stream' }), body: new Uint8Array(200 * KiB),
      });
      assert.equal(res.status, 204);
    }

    const wsRoom = await createRoom(small);
    const phone = await openWs(wsRoom.roomId, wsRoom.secret);
    const host = await openWs(wsRoom.roomId, wsRoom.hostSecret);
    const got = nextEvent(phone);
    host.send(new Uint8Array(200 * KiB));
    assert.equal((await got).type, 'close', '1000 KiB queued + 200 KiB must overflow 1 MiB');

    for (;;) {
      const res = await fetch(`${small.baseUrl}/api/rooms/${lpRoom.roomId}/relay/down`, { headers: hdr(lpRoom.hostSecret, hostToken) });
      if (res.status === 204) break;
      await res.arrayBuffer();
    }
    // Sent and handed to the kernel: those bytes must be given back, or the
    // budget would leak until every frame is refused.
    const room2 = await createRoom(small);
    const phone2 = await openWs(room2.roomId, room2.secret);
    const host2 = await openWs(room2.roomId, room2.hostSecret);
    for (let i = 0; i < 12; i++) {
      const next = nextEvent(phone2);
      host2.send(new Uint8Array(200 * KiB));
      assert.deepEqual(await next, { type: 'message', size: 200 * KiB });
    }
    host2.close(); phone2.close();
  });
});
