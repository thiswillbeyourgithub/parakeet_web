// Tier-1 unit test: the relay transports (app/ui/src/lib/remote-relay-transport.js)
// cap what they read from the server. Regression guard: the LP down-poll used
// to call response.arrayBuffer() / response.text() on whatever the relay sent,
// and the WS handler passed any frame on, so a hostile or broken relay could
// make the desktop (or the phone) buffer a body of any size.
//
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RelayHttpTransport, RelayWsTransport, relayWsFrameTooLarge } from '../../app/ui/src/lib/remote-relay-transport.js';
import { RELAY_FRAME_MAX_BYTES, RELAY_CONTROL_MAX_BYTES } from '../../app/ui/src/lib/remote-mic-limits.js';

const realFetch = globalThis.fetch;
const realWebSocket = globalThis.WebSocket;
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realWebSocket;
});

// Serve `frames` (each a Response) to successive down-polls, then 410 so the
// loop ends.
function stubDownPolls(frames) {
  let i = 0;
  globalThis.fetch = async () => (i < frames.length ? frames[i++] : new Response(null, { status: 410 }));
}

// A streamed body that never declares its length, so only the streaming cap
// can catch it.
function streamedResponse(bytes, contentType) {
  const stream = new ReadableStream({
    start(c) { c.enqueue(bytes); c.close(); },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': contentType } });
}

async function runDownLoop(frames) {
  stubDownPolls(frames);
  const t = new RelayHttpTransport({ baseUrl: 'http://relay.invalid/api/signal', roomId: 'R', roomSecret: 'S' });
  t.connected = true;
  t.token = 'tok';
  const got = [];
  const failures = [];
  t.onMessage = (m) => got.push(m);
  const realFail = t._fail.bind(t);
  t._fail = (reason) => { failures.push(reason); realFail(reason); };
  await t._downLoop();
  return { got, failures };
}

describe('RelayHttpTransport down-poll cap', () => {
  test('frames within the caps are delivered as ArrayBuffer and string', async () => {
    const { got, failures } = await runDownLoop([
      streamedResponse(new Uint8Array(RELAY_FRAME_MAX_BYTES), 'application/octet-stream'),
      streamedResponse(new TextEncoder().encode('{"type":"ping"}'), 'text/plain; charset=utf-8'),
    ]);
    assert.equal(got.length, 2);
    assert.ok(got[0] instanceof ArrayBuffer);
    assert.equal(got[0].byteLength, RELAY_FRAME_MAX_BYTES);
    assert.equal(got[1], '{"type":"ping"}');
    assert.deepEqual(failures, ['slot closed']);
  });

  test('a binary frame over the cap fails the transport and is not delivered', async () => {
    const { got, failures } = await runDownLoop([
      streamedResponse(new Uint8Array(RELAY_FRAME_MAX_BYTES + 1), 'application/octet-stream'),
    ]);
    assert.equal(got.length, 0);
    assert.deepEqual(failures, ['oversized frame']);
  });

  test('a text frame over the control cap fails the transport and is not delivered', async () => {
    const { got, failures } = await runDownLoop([
      streamedResponse(new Uint8Array(RELAY_CONTROL_MAX_BYTES + 1).fill(0x61), 'text/plain'),
    ]);
    assert.equal(got.length, 0);
    assert.deepEqual(failures, ['oversized frame']);
  });
});

describe('RelayWsTransport frame cap', () => {
  test('relayWsFrameTooLarge measures binary length and text UTF-8 bytes', () => {
    assert.equal(relayWsFrameTooLarge(new ArrayBuffer(RELAY_FRAME_MAX_BYTES)), false);
    assert.equal(relayWsFrameTooLarge(new ArrayBuffer(RELAY_FRAME_MAX_BYTES + 1)), true);
    assert.equal(relayWsFrameTooLarge('a'.repeat(RELAY_CONTROL_MAX_BYTES)), false);
    // Half as many characters, but 2 UTF-8 bytes each: over the cap.
    assert.equal(relayWsFrameTooLarge('é'.repeat(RELAY_CONTROL_MAX_BYTES / 2 + 1)), true);
    assert.equal(relayWsFrameTooLarge(new Uint8Array(4)), true, 'not an ArrayBuffer');
  });

  test('an oversized WS message is dropped, a normal one passes', async () => {
    let fake;
    globalThis.WebSocket = class {
      static OPEN = 1;
      constructor() { fake = this; setTimeout(() => this.onopen(), 0); }
      close() {}
    };
    const t = new RelayWsTransport({ baseUrl: 'http://relay.invalid/api/signal', roomId: 'R', roomSecret: 'S' });
    const got = [];
    t.onMessage = (m) => got.push(m);
    assert.equal(await t.connect(), true);
    fake.onmessage({ data: new ArrayBuffer(RELAY_FRAME_MAX_BYTES + 1) });
    fake.onmessage({ data: 'x'.repeat(RELAY_CONTROL_MAX_BYTES + 1) });
    fake.onmessage({ data: '{"type":"ping"}' });
    assert.deepEqual(got, ['{"type":"ping"}']);
  });
});
