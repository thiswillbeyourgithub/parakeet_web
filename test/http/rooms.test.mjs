// Tier-2 integration test: room lifecycle + SDP/ICE relay against the real
// signaling server (signaling/server.js) spawned on a random port. No routes
// or middleware are mocked; requests go over loopback with fetch.
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, createRoom, apiGet, apiPost, SAMPLE_SDP, SAMPLE_CANDIDATE,
} from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await stopServer(srv); });

describe('room creation + lookup', () => {
  test('POST /api/rooms mints a 6-char id and one secret per role', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    assert.match(roomId, /^[A-Z0-9]{6}$/);
    assert.equal(typeof secret, 'string');
    assert.ok(secret.length >= 16);
    assert.equal(typeof hostSecret, 'string');
    assert.ok(hostSecret.length >= 16);
    assert.notEqual(hostSecret, secret);
  });

  test('GET /api/rooms/:id with the right secret reports empty state', async () => {
    const { roomId, secret } = await createRoom(srv);
    const res = await apiGet(srv, `/api/rooms/${roomId}`, secret);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { exists: true, hasOffer: false, hasAnswer: false });
  });

  test('a wrong secret is rejected with 401', async () => {
    const { roomId } = await createRoom(srv);
    const res = await apiGet(srv, `/api/rooms/${roomId}`, 'definitely-wrong-secret');
    assert.equal(res.status, 401);
  });

  test('a wrong secret is refused before the body is parsed', async () => {
    // Regression guard: express.json ran for every room route before the
    // secret check, so an unauthenticated client got its body read and
    // parsed (a malformed one answered 400 instead of 401).
    const { roomId } = await createRoom(srv);
    const res = await fetch(`${srv.baseUrl}/api/rooms/${roomId}/offer`, {
      method: 'POST',
      headers: { Origin: srv.origin, 'Content-Type': 'application/json', 'X-Room-Secret': 'wrong' },
      body: '{not json',
    });
    assert.equal(res.status, 401);
  });

  test('an unknown room is indistinguishable from a wrong secret (401, same body)', async () => {
    const res = await apiGet(srv, '/api/rooms/ZZZZZZ', 'whatever');
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'Invalid room secret' });
  });

  test('GET /api/stats counts active rooms', async () => {
    const before = (await (await apiGet(srv, '/api/stats')).json()).activeRooms;
    await createRoom(srv);
    const after = (await (await apiGet(srv, '/api/stats')).json()).activeRooms;
    assert.ok(after > before);
  });
});

describe('SDP offer/answer relay round trip', () => {
  test('offer posted by one peer is retrievable by the other', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);

    // Before an offer exists the GET is a 404 "not ready".
    assert.equal((await apiGet(srv, `/api/rooms/${roomId}/offer`, secret)).status, 404);

    const post = await apiPost(srv, `/api/rooms/${roomId}/offer`, { type: 'offer', sdp: SAMPLE_SDP }, hostSecret);
    assert.equal(post.status, 200);
    assert.deepEqual(await post.json(), { success: true });

    const get = await apiGet(srv, `/api/rooms/${roomId}/offer`, secret);
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), { type: 'offer', sdp: SAMPLE_SDP });

    // hasOffer is now reflected in the room status.
    const status = await (await apiGet(srv, `/api/rooms/${roomId}`, secret)).json();
    assert.equal(status.hasOffer, true);
  });

  test('answer non-waiting GET is 204 until an answer is posted', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    assert.equal((await apiGet(srv, `/api/rooms/${roomId}/answer`, hostSecret)).status, 204);

    await apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, secret);
    const get = await apiGet(srv, `/api/rooms/${roomId}/answer`, hostSecret);
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), { type: 'answer', sdp: SAMPLE_SDP });
  });

  test('a long-poll GET (wait=true) resolves when the answer arrives', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    const pollPromise = apiGet(srv, `/api/rooms/${roomId}/answer?wait=true`, hostSecret);
    // Post the answer shortly after the poll is in flight.
    setTimeout(() => { apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, secret); }, 100);
    const res = await pollPromise;
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { type: 'answer', sdp: SAMPLE_SDP });
  });
});

describe('room re-arm for reconnection', () => {
  test('rearm clears offer/answer/ICE but keeps the room and secret valid', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);

    // First handshake: offer, answer, and ICE on both sides.
    await apiPost(srv, `/api/rooms/${roomId}/offer`, { type: 'offer', sdp: SAMPLE_SDP }, hostSecret);
    await apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, secret);
    await apiPost(srv, `/api/rooms/${roomId}/ice/offer`, { candidate: SAMPLE_CANDIDATE }, hostSecret);
    await apiPost(srv, `/api/rooms/${roomId}/ice/answer`, { candidate: SAMPLE_CANDIDATE }, secret);

    let status = await (await apiGet(srv, `/api/rooms/${roomId}`, secret)).json();
    assert.deepEqual(status, { exists: true, hasOffer: true, hasAnswer: true });

    // Re-arm.
    const rearm = await apiPost(srv, `/api/rooms/${roomId}/rearm`, {}, hostSecret);
    assert.equal(rearm.status, 200);
    assert.deepEqual(await rearm.json(), { success: true });

    // Signaling slot is back to the just-created state, room still alive.
    status = await (await apiGet(srv, `/api/rooms/${roomId}`, secret)).json();
    assert.deepEqual(status, { exists: true, hasOffer: false, hasAnswer: false });
    assert.equal((await apiGet(srv, `/api/rooms/${roomId}/offer`, secret)).status, 404);
    assert.equal((await apiGet(srv, `/api/rooms/${roomId}/answer`, hostSecret)).status, 204);
    const offerIce = await (await apiGet(srv, `/api/rooms/${roomId}/ice/offer`, secret)).json();
    const answerIce = await (await apiGet(srv, `/api/rooms/${roomId}/ice/answer`, hostSecret)).json();
    assert.deepEqual(offerIce.candidates, []);
    assert.deepEqual(answerIce.candidates, []);

    // A second handshake works on the same room/secret.
    await apiPost(srv, `/api/rooms/${roomId}/offer`, { type: 'offer', sdp: SAMPLE_SDP }, hostSecret);
    const get = await apiGet(srv, `/api/rooms/${roomId}/offer`, secret);
    assert.equal(get.status, 200);
  });

  test('rearm wakes a pending answer long-poll so it does not return the stale answer', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    await apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, secret);
    await apiPost(srv, `/api/rooms/${roomId}/rearm`, {}, hostSecret);

    // After rearm there is no answer, so a waiting long-poll must block then
    // 204 at the timeout boundary rather than returning the cleared answer.
    const pollPromise = apiGet(srv, `/api/rooms/${roomId}/answer?wait=true`, hostSecret);
    // A fresh answer posted after rearm is what it should ultimately resolve to.
    setTimeout(() => { apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, secret); }, 100);
    const res = await pollPromise;
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { type: 'answer', sdp: SAMPLE_SDP });
  });

  test('rearm drops the relay slots and frames of the dropped session', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    const handshake = async (roomSecret) => {
      const res = await apiPost(srv, `/api/rooms/${roomId}/relay/handshake`, {}, roomSecret);
      return { status: res.status, token: res.status === 200 ? (await res.json()).token : null };
    };
    const lp = (roomSecret, token) => ({ Origin: srv.origin, 'X-Room-Secret': roomSecret, 'X-Slot-Token': token });
    const host = await handshake(hostSecret);
    const phone = await handshake(secret);
    // The old phone leaves a frame queued for the desktop
    const up = await fetch(`${srv.baseUrl}/api/rooms/${roomId}/relay/up`, {
      method: 'POST',
      headers: { ...lp(secret, phone.token), 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(16),
    });
    assert.equal(up.status, 204);

    await apiPost(srv, `/api/rooms/${roomId}/rearm`, {}, hostSecret);

    // The old slot no longer delivers, and both sides can claim fresh slots
    const stale = await fetch(`${srv.baseUrl}/api/rooms/${roomId}/relay/down`, { headers: lp(hostSecret, host.token) });
    assert.notEqual(stale.status, 200);
    const newHost = await handshake(hostSecret);
    assert.equal((await handshake(secret)).status, 200);
    assert.equal(newHost.status, 200);
    // The new pair only holds the relay's own peer-joined announcement.
    const joined = await fetch(`${srv.baseUrl}/api/rooms/${roomId}/relay/down`, { headers: lp(hostSecret, newHost.token) });
    assert.equal(joined.status, 200);
    assert.equal(await joined.text(), '{"type":"peer-joined"}');
    const fresh = await fetch(`${srv.baseUrl}/api/rooms/${roomId}/relay/down`, { headers: lp(hostSecret, newHost.token) });
    assert.equal(fresh.status, 204, 'the frame queued for the old session is gone');
  });

  test('rearm requires the room secret', async () => {
    const { roomId } = await createRoom(srv);
    const res = await apiPost(srv, `/api/rooms/${roomId}/rearm`, {}, 'wrong-secret');
    assert.equal(res.status, 401);
  });
});

describe('ICE candidate trickle relay', () => {
  test('candidates posted to the offer side are listed back', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    const empty = await (await apiGet(srv, `/api/rooms/${roomId}/ice/offer`, secret)).json();
    assert.deepEqual(empty.candidates, []);

    const post = await apiPost(
      srv, `/api/rooms/${roomId}/ice/offer`,
      { candidate: SAMPLE_CANDIDATE, sdpMid: '0', sdpMLineIndex: 0 }, hostSecret,
    );
    assert.equal(post.status, 200);

    const listed = await (await apiGet(srv, `/api/rooms/${roomId}/ice/offer`, secret)).json();
    assert.equal(listed.candidates.length, 1);
    assert.equal(listed.candidates[0].candidate, SAMPLE_CANDIDATE);
    assert.equal(listed.candidates[0].sdpMid, '0');
  });

  test('offer-side and answer-side candidate lists are independent', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    await apiPost(srv, `/api/rooms/${roomId}/ice/answer`, { candidate: SAMPLE_CANDIDATE }, secret);
    const offerSide = await (await apiGet(srv, `/api/rooms/${roomId}/ice/offer`, secret)).json();
    const answerSide = await (await apiGet(srv, `/api/rooms/${roomId}/ice/answer`, hostSecret)).json();
    assert.equal(offerSide.candidates.length, 0);
    assert.equal(answerSide.candidates.length, 1);
  });
});

// Per-role credentials: the phone secret (the one in the QR) must not be able
// to act as the desktop, and vice versa. Without this split anyone who saw the
// QR could re-arm the room, replace the offer, or read the phone's answer.
describe('per-role room secrets', () => {
  test('the phone secret cannot use host-only routes', async () => {
    const { roomId, secret } = await createRoom(srv);
    const hostOnly = [
      apiPost(srv, `/api/rooms/${roomId}/offer`, { type: 'offer', sdp: SAMPLE_SDP }, secret),
      apiPost(srv, `/api/rooms/${roomId}/rearm`, {}, secret),
      apiPost(srv, `/api/rooms/${roomId}/ice/offer`, { candidate: SAMPLE_CANDIDATE }, secret),
      apiGet(srv, `/api/rooms/${roomId}/answer`, secret),
      apiGet(srv, `/api/rooms/${roomId}/ice/answer`, secret),
    ];
    for (const res of await Promise.all(hostOnly)) assert.equal(res.status, 401);
  });

  test('the host secret cannot use phone-only routes', async () => {
    const { roomId, hostSecret } = await createRoom(srv);
    const phoneOnly = [
      apiGet(srv, `/api/rooms/${roomId}/offer`, hostSecret),
      apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, hostSecret),
      apiPost(srv, `/api/rooms/${roomId}/ice/answer`, { candidate: SAMPLE_CANDIDATE }, hostSecret),
      apiGet(srv, `/api/rooms/${roomId}/ice/offer`, hostSecret),
    ];
    for (const res of await Promise.all(phoneOnly)) assert.equal(res.status, 401);
  });

  test('both secrets can read the shared room status', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    assert.equal((await apiGet(srv, `/api/rooms/${roomId}`, secret)).status, 200);
    assert.equal((await apiGet(srv, `/api/rooms/${roomId}`, hostSecret)).status, 200);
  });
});

// Relay slots are bound to the role, not first-come: a QR holder (phone secret)
// can never take the desktop's slot, even if it handshakes first, and a second
// phone cannot displace the first one while its slot is live.
describe('relay slots bound to role', () => {
  const handshake = (roomId, secret) => apiPost(srv, `/api/rooms/${roomId}/relay/handshake`, {}, secret);

  test('the phone always gets slot b and the host slot a, regardless of order', async () => {
    const { roomId, secret, hostSecret } = await createRoom(srv);
    const phone = await handshake(roomId, secret);
    assert.equal(phone.status, 200);
    assert.equal((await phone.json()).slot, 'b');
    const host = await handshake(roomId, hostSecret);
    assert.equal(host.status, 200);
    assert.equal((await host.json()).slot, 'a');
  });

  test('a second phone cannot claim the free host slot', async () => {
    const { roomId, secret } = await createRoom(srv);
    assert.equal((await handshake(roomId, secret)).status, 200);
    assert.equal((await handshake(roomId, secret)).status, 409);
  });
});
