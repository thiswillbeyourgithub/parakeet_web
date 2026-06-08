// Tier-1 unit test for the backpressure drain() added to the relay transports
// (app/ui/src/lib/remote-relay-transport.js). drain() is what lets the
// saved-file pump pace itself to the link instead of overrunning sendBinary's
// drop path; RemoteMicRTC.drain()'s data-channel branch is the same
// bufferedAmount loop as RelayWsTransport.drain(), so covering the WS variant
// covers that algorithm too. The HTTP variant is queue-depth based and gets
// its own cases. No network is touched: we feed fake ws/queue state. Built
// with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RelayWsTransport, RelayHttpTransport } from '../../app/ui/src/lib/remote-relay-transport.js';

const OPEN = (typeof WebSocket !== 'undefined' && WebSocket.OPEN !== undefined) ? WebSocket.OPEN : 1;

describe('RelayWsTransport.drain', () => {
  test('returns true immediately when the socket is not open', async () => {
    const t = new RelayWsTransport({ baseUrl: '/api/signal', roomId: 'R', roomSecret: 'S' });
    t.ws = null;
    assert.equal(await t.drain(256 * 1024, 1000), true);
    t.ws = { readyState: 3 /* CLOSED */, bufferedAmount: 10 * 1024 * 1024 };
    assert.equal(await t.drain(256 * 1024, 1000), true);
  });

  test('resolves true once bufferedAmount falls below the threshold', async () => {
    const t = new RelayWsTransport({ baseUrl: '/api/signal', roomId: 'R', roomSecret: 'S' });
    t.ws = { readyState: OPEN, bufferedAmount: 1024 * 1024 };
    // Drain the buffer shortly after drain() starts waiting.
    setTimeout(() => { t.ws.bufferedAmount = 1000; }, 30);
    const ok = await t.drain(256 * 1024, 2000);
    assert.equal(ok, true);
  });

  test('returns false when the buffer never drains before the deadline', async () => {
    const t = new RelayWsTransport({ baseUrl: '/api/signal', roomId: 'R', roomSecret: 'S' });
    t.ws = { readyState: OPEN, bufferedAmount: 5 * 1024 * 1024 }; // stays high
    const start = Date.now();
    const ok = await t.drain(256 * 1024, 150);
    assert.equal(ok, false);
    assert.ok(Date.now() - start >= 150, 'should wait out the full deadline');
  });

  test('returns true without waiting when already below the threshold', async () => {
    const t = new RelayWsTransport({ baseUrl: '/api/signal', roomId: 'R', roomSecret: 'S' });
    t.ws = { readyState: OPEN, bufferedAmount: 0 };
    const start = Date.now();
    assert.equal(await t.drain(256 * 1024, 5000), true);
    assert.ok(Date.now() - start < 100, 'should not block');
  });
});

describe('RelayHttpTransport.drain', () => {
  test('returns true immediately when not connected or closed', async () => {
    const t = new RelayHttpTransport({ baseUrl: '/api/signal', roomId: 'R', roomSecret: 'S' });
    // Fresh instance: connected=false.
    assert.equal(await t.drain(256 * 1024, 1000), true);
    t.connected = true;
    t.closed = true;
    assert.equal(await t.drain(256 * 1024, 1000), true);
  });

  test('resolves true once the binary queue depth falls to the frame budget', async () => {
    const t = new RelayHttpTransport({ baseUrl: '/api/signal', roomId: 'R', roomSecret: 'S' });
    t.connected = true;
    t.closed = false;
    // Above the 1/8-of-cap budget (200/8 = 25).
    t._sendQueueBinaryCount = 200;
    setTimeout(() => { t._sendQueueBinaryCount = 10; }, 40);
    const ok = await t.drain(256 * 1024, 2000);
    assert.equal(ok, true);
  });

  test('returns false when the queue stays full past the deadline', async () => {
    const t = new RelayHttpTransport({ baseUrl: '/api/signal', roomId: 'R', roomSecret: 'S' });
    t.connected = true;
    t.closed = false;
    t._sendQueueBinaryCount = t._SEND_QUEUE_MAX_BINARY_FRAMES; // never drops
    const ok = await t.drain(256 * 1024, 150);
    assert.equal(ok, false);
  });

  test('stops waiting (returns true) if the transport closes mid-drain', async () => {
    const t = new RelayHttpTransport({ baseUrl: '/api/signal', roomId: 'R', roomSecret: 'S' });
    t.connected = true;
    t.closed = false;
    t._sendQueueBinaryCount = t._SEND_QUEUE_MAX_BINARY_FRAMES;
    setTimeout(() => { t.closed = true; }, 40);
    const ok = await t.drain(256 * 1024, 5000);
    assert.equal(ok, true);
  });
});
