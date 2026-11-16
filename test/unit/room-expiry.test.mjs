// Unit coverage for the signaling room lifetime (signaling/room-expiry.js).
// Regression guard: a relay session in use must not be cut 10 minutes after
// the room was created, but every room still dies after 60 minutes.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ROOM_IDLE_TTL, ROOM_MAX_LIFETIME, sweepRoom } = require('../../signaling/room-expiry.js');

const MIN = 60 * 1000;
const lp = (closed = false) => ({ kind: 'lp', closed });
const ws = (readyState) => ({ readyState, OPEN: 1 });
const room = (relay = null) => ({ created: 0, relay });

describe('room expiry', () => {
    test('an unused room expires after the idle TTL', () => {
        const r = room();
        assert.equal(sweepRoom(r, ROOM_IDLE_TTL), false);
        assert.equal(sweepRoom(r, ROOM_IDLE_TTL + 1), true);
    });

    test('a room with a single relay peer is not in use', () => {
        const r = room({ a: lp(), b: null });
        assert.equal(sweepRoom(r, ROOM_IDLE_TTL + 1), true);
    });

    test('a relay session in use survives past the idle TTL', () => {
        const r = room({ a: lp(), b: ws(1) });
        for (let t = MIN; t <= 30 * MIN; t += MIN) assert.equal(sweepRoom(r, t), false);
        // The phone leaves: the room lives on for the idle TTL after last use
        r.relay.b = null;
        assert.equal(sweepRoom(r, 30 * MIN + ROOM_IDLE_TTL), false);
        assert.equal(sweepRoom(r, 30 * MIN + ROOM_IDLE_TTL + 1), true);
    });

    test('closed slots do not count as use', () => {
        assert.equal(sweepRoom(room({ a: lp(), b: lp(true) }), ROOM_IDLE_TTL + 1), true);
        assert.equal(sweepRoom(room({ a: lp(), b: ws(3) }), ROOM_IDLE_TTL + 1), true);
    });

    test('every room dies after the hard cap, even in use', () => {
        const r = room({ a: lp(), b: lp() });
        assert.equal(sweepRoom(r, ROOM_MAX_LIFETIME), false);
        assert.equal(sweepRoom(r, ROOM_MAX_LIFETIME + 1), true);
    });
});
