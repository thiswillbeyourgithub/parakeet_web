// Tier-2 integration test: body validation and request-size limits on the relay
// routes, against the real signaling server. Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, createRoom, apiPost, SAMPLE_SDP } from './helpers.mjs';

let srv;
let room;
before(async () => { srv = await startServer(); room = await createRoom(srv); });
after(async () => { await stopServer(srv); });

const offerPath = () => `/api/rooms/${room.roomId}/offer`;
const icePath = () => `/api/rooms/${room.roomId}/ice/offer`;

describe('SDP validation', () => {
  test('a well-formed offer is accepted', async () => {
    const res = await apiPost(srv, offerPath(), { type: 'offer', sdp: SAMPLE_SDP }, room.secret);
    assert.equal(res.status, 200);
  });
  test('a wrong type is rejected (400)', async () => {
    const res = await apiPost(srv, offerPath(), { type: 'banana', sdp: SAMPLE_SDP }, room.secret);
    assert.equal(res.status, 400);
  });
  test('a missing sdp is rejected (400)', async () => {
    const res = await apiPost(srv, offerPath(), { type: 'offer' }, room.secret);
    assert.equal(res.status, 400);
  });
  test('an SDP line outside the RFC-4566 alphabet is rejected (400)', async () => {
    const bad = SAMPLE_SDP + '\r\nx=not-a-valid-line-type';
    const res = await apiPost(srv, offerPath(), { type: 'offer', sdp: bad }, room.secret);
    assert.equal(res.status, 400);
  });
  test('an embedded NUL byte is rejected (400)', async () => {
    const res = await apiPost(srv, offerPath(), { type: 'offer', sdp: 'v=0\0' }, room.secret);
    assert.equal(res.status, 400);
  });
});

describe('ICE candidate validation', () => {
  test('a malformed candidate string is rejected (400)', async () => {
    const res = await apiPost(srv, icePath(), { candidate: 'not a candidate' }, room.secret);
    assert.equal(res.status, 400);
  });
});

describe('request-size + auth ordering', () => {
  test('a body over the 50 KB JSON limit is rejected (413)', async () => {
    // Oversized but still valid JSON shape; the body parser caps at 50kb.
    const huge = 'a'.repeat(60 * 1024);
    const res = await apiPost(srv, offerPath(), { type: 'offer', sdp: huge }, room.secret);
    assert.equal(res.status, 413);
  });

  test('a missing room secret is rejected before the body is honoured (401)', async () => {
    const res = await apiPost(srv, offerPath(), { type: 'offer', sdp: SAMPLE_SDP }, undefined);
    assert.equal(res.status, 401);
  });
});
