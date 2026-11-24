// Unit coverage for the remote-mic v4 handshake helpers
// (app/ui/src/lib/remote-mic-handshake.js). Regression guards:
// - a key confirmation that never arrives must time out as a failure rather
//   than keep a pending pairing alive forever;
// - key-confirm must only ever be accepted encrypted (a plaintext one would
//   prove nothing about the key).
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  waitForDecision, KEY_CONFIRM, KEY_CONFIRM_TTL_MS, mustBeEncrypted,
  peerProtocolMatches, REMOTE_MIC_PROTOCOL,
} from '../../app/ui/src/lib/remote-mic-handshake.js';

describe('waitForDecision', () => {
  test('resolves the registered decision', async () => {
    let resolver;
    const p = waitForDecision((r) => { resolver = r; }, 1000);
    resolver(true);
    assert.equal(await p, true);
  });

  test('a synchronous decision resolves immediately', async () => {
    assert.equal(await waitForDecision((r) => r(true), 1000), true);
  });

  test('times out to false, a late decision is ignored', async () => {
    let resolver;
    const p = waitForDecision((r) => { resolver = r; }, 10);
    assert.equal(await p, false);
    resolver(true);
    assert.equal(await p, false);
  });

  test('the key-confirm TTL is bounded', () => {
    assert.equal(KEY_CONFIRM_TTL_MS, 15000);
  });
});

describe('key confirmation and plaintext policy', () => {
  test('KEY_CONFIRM is a frozen key-confirm message', () => {
    assert.deepEqual(KEY_CONFIRM, { type: 'key-confirm' });
    assert.ok(Object.isFrozen(KEY_CONFIRM));
  });

  test('control messages, key-confirm included, must be encrypted', () => {
    for (const type of ['key-confirm', 'stop-recording', 'audio-settings', 'audio-config', 'audio-end']) {
      assert.equal(mustBeEncrypted({ type }), true, type);
    }
  });

  test('handshake messages stay plaintext', () => {
    for (const type of ['public-key', 'sender-public-key', 'verify-deny']) {
      assert.equal(mustBeEncrypted({ type }), false, type);
    }
    assert.equal(mustBeEncrypted(null), false);
  });
});

// A page left open across a deploy must refuse a peer on another protocol.
describe('peerProtocolMatches', () => {
  test('only the current version matches', () => {
    assert.equal(REMOTE_MIC_PROTOCOL, 4);
    assert.equal(peerProtocolMatches({ type: 'public-key', v: REMOTE_MIC_PROTOCOL }), true);
    assert.equal(peerProtocolMatches({ type: 'public-key' }), false);
    assert.equal(peerProtocolMatches({ type: 'public-key', v: REMOTE_MIC_PROTOCOL - 1 }), false);
    assert.equal(peerProtocolMatches({ type: 'public-key', v: String(REMOTE_MIC_PROTOCOL) }), false);
    assert.equal(peerProtocolMatches(null), false);
  });
});
