// Tier-2 integration test: the relay announces {"type":"peer-joined"} to BOTH
// halves once a room's relay pair is complete, and never before. Frames sent
// before the partner holds a slot are dropped, so without this the desktop's
// first public-key was lost whenever its relay socket opened first and the
// phone sat waiting for a key that never came.
//
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, createRoom, apiPost } from './helpers.mjs';

const PEER_JOINED = '{"type":"peer-joined"}';
let srv;

before(async () => { srv = await startServer(); });
after(async () => { await stopServer(srv); });

function openWs(roomId, secret) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/api/rooms/${roomId}/relay?secret=${encodeURIComponent(secret)}`);
    ws.texts = [];
    ws.onmessage = (e) => { if (typeof e.data === 'string') ws.texts.push(e.data); };
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

async function lpHandshake(roomId, secret) {
  const res = await apiPost(srv, `/api/rooms/${roomId}/relay/handshake`, {}, secret);
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

async function lpDown(roomId, secret, token) {
  const res = await fetch(`${srv.baseUrl}/api/rooms/${roomId}/relay/down`, {
    headers: { Origin: srv.origin, 'X-Room-Secret': secret, 'X-Slot-Token': token },
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  return res.text();
}

const settle = () => new Promise((r) => setTimeout(r, 150));

describe('relay peer-joined announcement', () => {
  test('WS + WS: nothing while alone, both halves told once paired', async () => {
    const room = await createRoom(srv);
    const host = await openWs(room.roomId, room.hostSecret);
    await settle();
    assert.deepEqual(host.texts, [], 'no announcement before the partner arrives');
    const phone = await openWs(room.roomId, room.secret);
    await settle();
    assert.deepEqual(host.texts, [PEER_JOINED]);
    assert.deepEqual(phone.texts, [PEER_JOINED]);
    host.close(); phone.close();
  });

  test('LP + LP: both queues receive it as a text frame', async () => {
    const room = await createRoom(srv);
    const hostToken = await lpHandshake(room.roomId, room.hostSecret);
    const phoneToken = await lpHandshake(room.roomId, room.secret);
    assert.equal(await lpDown(room.roomId, room.hostSecret, hostToken), PEER_JOINED);
    assert.equal(await lpDown(room.roomId, room.secret, phoneToken), PEER_JOINED);
  });

  test('WS + LP mixed pair: both halves told', async () => {
    const room = await createRoom(srv);
    const host = await openWs(room.roomId, room.hostSecret);
    const phoneToken = await lpHandshake(room.roomId, room.secret);
    assert.equal(await lpDown(room.roomId, room.secret, phoneToken), PEER_JOINED);
    await settle();
    assert.deepEqual(host.texts, [PEER_JOINED]);
    host.close();
  });
});
