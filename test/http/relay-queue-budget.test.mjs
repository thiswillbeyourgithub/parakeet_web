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
