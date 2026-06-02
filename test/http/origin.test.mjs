// Tier-2 integration test: the Origin / Sec-Fetch-Site gate on /api/* and the
// CORS preflight, against the real signaling server. Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer } from './helpers.mjs';

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await stopServer(srv); });

describe('Origin validation on /api', () => {
  test('allowed Origin passes (200)', async () => {
    const res = await fetch(`${srv.baseUrl}/api/stats`, { headers: { Origin: srv.origin } });
    assert.equal(res.status, 200);
  });

  test('a disallowed Origin is blocked with 403', async () => {
    const res = await fetch(`${srv.baseUrl}/api/stats`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'Forbidden', message: 'Request origin not allowed' });
  });

  test('no Origin + no Sec-Fetch-Site is blocked (403)', async () => {
    const res = await fetch(`${srv.baseUrl}/api/stats`);
    assert.equal(res.status, 403);
  });

  test('no Origin but Sec-Fetch-Site: same-origin is allowed (same-origin GET path)', async () => {
    const res = await fetch(`${srv.baseUrl}/api/stats`, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(res.status, 200);
  });
});

describe('CORS preflight', () => {
  test('OPTIONS from the allowed origin returns 204 with CORS headers', async () => {
    const res = await fetch(`${srv.baseUrl}/api/rooms`, {
      method: 'OPTIONS',
      headers: { Origin: srv.origin, 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), srv.origin);
    assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
  });
});

describe('backend fingerprinting', () => {
  test('the X-Powered-By: Express header is suppressed', async () => {
    const res = await fetch(`${srv.baseUrl}/api/stats`, { headers: { Origin: srv.origin } });
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});
