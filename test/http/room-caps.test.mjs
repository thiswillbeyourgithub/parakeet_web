// Tier-2 integration test: the live-room caps on POST /api/rooms. Regression
// guard: rooms only leave memory through the expiry sweep, and nothing bounded
// how many one client (or all clients together) could hold at once.
//
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer } from './helpers.mjs';

async function postRoomStatus(srv) {
  const res = await fetch(`${srv.baseUrl}/api/rooms`, {
    method: 'POST',
    headers: { Origin: srv.origin },
  });
  await res.arrayBuffer();
  return res.status;
}

async function createRooms(srv, n) {
  const statuses = [];
  for (let i = 0; i < n; i++) statuses.push(await postRoomStatus(srv));
  return statuses;
}

describe('per-client live-room cap', () => {
  let srv;
  // Limiter live (the cap shares the per-IP escape hatch), cap below the
  // 5/min creation rate so it is the cap that bites, not the rate.
  before(async () => { srv = await startServer({ TEST_DISABLE_RATE_LIMIT: '0', ROOMS_MAX_PER_CLIENT: '3' }); });
  after(async () => { await stopServer(srv); });

  test('the 4th live room of one client is 429', async () => {
    assert.deepEqual(await createRooms(srv, 4), [200, 200, 200, 429]);
  });
});

describe('instance-wide live-room cap', () => {
  let srv;
  before(async () => { srv = await startServer({ ROOMS_MAX: '2' }); });
  after(async () => { await stopServer(srv); });

  test('room creation is 503 once the instance holds ROOMS_MAX rooms', async () => {
    assert.deepEqual(await createRooms(srv, 3), [200, 200, 503]);
  });
});
