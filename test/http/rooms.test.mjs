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
  test('POST /api/rooms mints a 6-char id and a secret', async () => {
    const { roomId, secret } = await createRoom(srv);
    assert.match(roomId, /^[A-Z0-9]{6}$/);
    assert.equal(typeof secret, 'string');
    assert.ok(secret.length >= 16);
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
    const { roomId, secret } = await createRoom(srv);

    // Before an offer exists the GET is a 404 "not ready".
    assert.equal((await apiGet(srv, `/api/rooms/${roomId}/offer`, secret)).status, 404);

    const post = await apiPost(srv, `/api/rooms/${roomId}/offer`, { type: 'offer', sdp: SAMPLE_SDP }, secret);
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
    const { roomId, secret } = await createRoom(srv);
    assert.equal((await apiGet(srv, `/api/rooms/${roomId}/answer`, secret)).status, 204);

    await apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, secret);
    const get = await apiGet(srv, `/api/rooms/${roomId}/answer`, secret);
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), { type: 'answer', sdp: SAMPLE_SDP });
  });

  test('a long-poll GET (wait=true) resolves when the answer arrives', async () => {
    const { roomId, secret } = await createRoom(srv);
    const pollPromise = apiGet(srv, `/api/rooms/${roomId}/answer?wait=true`, secret);
    // Post the answer shortly after the poll is in flight.
    setTimeout(() => { apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, secret); }, 100);
    const res = await pollPromise;
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { type: 'answer', sdp: SAMPLE_SDP });
  });
});

describe('room re-arm for reconnection', () => {
  test('rearm clears offer/answer/ICE but keeps the room and secret valid', async () => {
    const { roomId, secret } = await createRoom(srv);

    // First handshake: offer, answer, and ICE on both sides.
    await apiPost(srv, `/api/rooms/${roomId}/offer`, { type: 'offer', sdp: SAMPLE_SDP }, secret);
    await apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, secret);
    await apiPost(srv, `/api/rooms/${roomId}/ice/offer`, { candidate: SAMPLE_CANDIDATE }, secret);
    await apiPost(srv, `/api/rooms/${roomId}/ice/answer`, { candidate: SAMPLE_CANDIDATE }, secret);

    let status = await (await apiGet(srv, `/api/rooms/${roomId}`, secret)).json();
    assert.deepEqual(status, { exists: true, hasOffer: true, hasAnswer: true });

    // Re-arm.
    const rearm = await apiPost(srv, `/api/rooms/${roomId}/rearm`, {}, secret);
    assert.equal(rearm.status, 200);
    assert.deepEqual(await rearm.json(), { success: true });

    // Signaling slot is back to the just-created state, room still alive.
    status = await (await apiGet(srv, `/api/rooms/${roomId}`, secret)).json();
    assert.deepEqual(status, { exists: true, hasOffer: false, hasAnswer: false });
    assert.equal((await apiGet(srv, `/api/rooms/${roomId}/offer`, secret)).status, 404);
    assert.equal((await apiGet(srv, `/api/rooms/${roomId}/answer`, secret)).status, 204);
    const offerIce = await (await apiGet(srv, `/api/rooms/${roomId}/ice/offer`, secret)).json();
    const answerIce = await (await apiGet(srv, `/api/rooms/${roomId}/ice/answer`, secret)).json();
    assert.deepEqual(offerIce.candidates, []);
    assert.deepEqual(answerIce.candidates, []);

    // A second handshake works on the same room/secret.
    await apiPost(srv, `/api/rooms/${roomId}/offer`, { type: 'offer', sdp: SAMPLE_SDP }, secret);
    const get = await apiGet(srv, `/api/rooms/${roomId}/offer`, secret);
    assert.equal(get.status, 200);
  });

  test('rearm wakes a pending answer long-poll so it does not return the stale answer', async () => {
    const { roomId, secret } = await createRoom(srv);
    await apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, secret);
    await apiPost(srv, `/api/rooms/${roomId}/rearm`, {}, secret);

    // After rearm there is no answer, so a waiting long-poll must block then
    // 204 at the timeout boundary rather than returning the cleared answer.
    const pollPromise = apiGet(srv, `/api/rooms/${roomId}/answer?wait=true`, secret);
    // A fresh answer posted after rearm is what it should ultimately resolve to.
    setTimeout(() => { apiPost(srv, `/api/rooms/${roomId}/answer`, { type: 'answer', sdp: SAMPLE_SDP }, secret); }, 100);
    const res = await pollPromise;
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { type: 'answer', sdp: SAMPLE_SDP });
  });

  test('rearm requires the room secret', async () => {
    const { roomId } = await createRoom(srv);
    const res = await apiPost(srv, `/api/rooms/${roomId}/rearm`, {}, 'wrong-secret');
    assert.equal(res.status, 401);
  });
});

describe('ICE candidate trickle relay', () => {
  test('candidates posted to the offer side are listed back', async () => {
    const { roomId, secret } = await createRoom(srv);
    const empty = await (await apiGet(srv, `/api/rooms/${roomId}/ice/offer`, secret)).json();
    assert.deepEqual(empty.candidates, []);

    const post = await apiPost(
      srv, `/api/rooms/${roomId}/ice/offer`,
      { candidate: SAMPLE_CANDIDATE, sdpMid: '0', sdpMLineIndex: 0 }, secret,
    );
    assert.equal(post.status, 200);

    const listed = await (await apiGet(srv, `/api/rooms/${roomId}/ice/offer`, secret)).json();
    assert.equal(listed.candidates.length, 1);
    assert.equal(listed.candidates[0].candidate, SAMPLE_CANDIDATE);
    assert.equal(listed.candidates[0].sdpMid, '0');
  });

  test('offer-side and answer-side candidate lists are independent', async () => {
    const { roomId, secret } = await createRoom(srv);
    await apiPost(srv, `/api/rooms/${roomId}/ice/answer`, { candidate: SAMPLE_CANDIDATE }, secret);
    const offerSide = await (await apiGet(srv, `/api/rooms/${roomId}/ice/offer`, secret)).json();
    const answerSide = await (await apiGet(srv, `/api/rooms/${roomId}/ice/answer`, secret)).json();
    assert.equal(offerSide.candidates.length, 0);
    assert.equal(answerSide.candidates.length, 1);
  });
});
