// Tier-2 integration test: the per-IP rate limiter and the TEST_DISABLE_RATE_LIMIT
// escape hatch. One server is spawned with the limiter LIVE (overriding the
// helper's test default) to prove the cap bites; another with the hatch ON to
// prove the same workload sails through. Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer } from './helpers.mjs';

async function postRoom(srv) {
  return fetch(`${srv.baseUrl}/api/rooms`, {
    method: 'POST',
    headers: { Origin: srv.origin, 'Content-Type': 'application/json' },
  });
}

describe('roomCreation cap with the limiter live', () => {
  let srv;
  // Override the helper default so the real limiter runs.
  before(async () => { srv = await startServer({ TEST_DISABLE_RATE_LIMIT: '0' }); });
  after(async () => { await stopServer(srv); });

  test('the 6th room creation in a window is 429 with Retry-After', async () => {
    // roomCreation cap is 5/min per IP.
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await postRoom(srv)).status);
    assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200], 'first five allowed');
    const sixth = statuses[5];
    assert.equal(sixth, 429, 'sixth blocked');

    const blocked = await postRoom(srv);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0, 'Retry-After header set');
  });
});

describe('the escape hatch disables the cap', () => {
  let srv;
  before(async () => { srv = await startServer({ TEST_DISABLE_RATE_LIMIT: '1' }); });
  after(async () => { await stopServer(srv); });

  test('many room creations all succeed when TEST_DISABLE_RATE_LIMIT=1', async () => {
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await postRoom(srv)).status);
    assert.ok(statuses.every((s) => s === 200), `all 200, got ${statuses.join(',')}`);
  });
});
