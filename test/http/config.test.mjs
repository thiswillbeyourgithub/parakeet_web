// Tier-2 integration test: /api/config ICE-server assembly and how it reflects
// env-var configuration (STUN / TURN). Spawns separate server instances with
// different env so we exercise real config propagation, not mocks.
// Built with Claude Code.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, apiGet } from './helpers.mjs';

describe('/api/config with no ICE servers configured', () => {
  let srv;
  before(async () => { srv = await startServer({ STUN_GOOGLE_FALLBACK: 'false' }); });
  after(async () => { await stopServer(srv); });

  test('returns an empty iceServers list plus dev/turnTimeout', async () => {
    const res = await apiGet(srv, '/api/config');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.iceServers, []);
    assert.equal(body.dev, false);
    assert.equal(typeof body.turnTimeout, 'number');
  });
});

describe('/api/config honours STUN env vars', () => {
  let srv;
  before(async () => {
    srv = await startServer({ STUN_SERVER: 'stun.example.org:3478', STUN_GOOGLE_FALLBACK: 'true' });
  });
  after(async () => { await stopServer(srv); });

  test('includes the self-hosted STUN server and the Google fallback', async () => {
    const body = await (await apiGet(srv, '/api/config')).json();
    const urls = body.iceServers.map((s) => s.urls);
    assert.ok(urls.includes('stun:stun.example.org:3478'), 'self-hosted STUN present');
    assert.ok(urls.includes('stun:stun.l.google.com:19302'), 'google fallback present');
  });
});

describe('/api/config mints TURN credentials when TURN is configured', () => {
  let srv;
  before(async () => {
    srv = await startServer({
      TURN_SERVER: 'turn.example.org:3478',
      TURN_SECRET: 'test-shared-secret',
      STUN_GOOGLE_FALLBACK: 'false',
    });
  });
  after(async () => { await stopServer(srv); });

  test('returns a TURN entry with time-limited username + credential', async () => {
    const body = await (await apiGet(srv, '/api/config')).json();
    const turn = body.iceServers.find((s) => Array.isArray(s.urls) && s.urls.some((u) => u.startsWith('turn:')));
    assert.ok(turn, 'a TURN ice server is present');
    // coturn REST API: username is "<expiry-unix-ts>:<name>", credential is base64 HMAC.
    assert.match(turn.username, /^\d+:/);
    assert.equal(typeof turn.credential, 'string');
    assert.ok(turn.credential.length > 0);
  });
});

describe('DEV flag propagation', () => {
  let srv;
  before(async () => { srv = await startServer({ DEV: '1', STUN_GOOGLE_FALLBACK: 'false' }); });
  after(async () => { await stopServer(srv); });

  test('config reports dev: true when DEV=1', async () => {
    const body = await (await apiGet(srv, '/api/config')).json();
    assert.equal(body.dev, true);
  });
});
