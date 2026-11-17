// Unit coverage for signaling/client-ip.js. Regression guard: the rate limiters
// keyed on the full client address, so an IPv6 host rotating through its /64
// got a fresh bucket per request, and ::ffff:a.b.c.d and a.b.c.d were counted
// as two different clients.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { clientIpKey } = require('../../signaling/client-ip.js');

describe('clientIpKey', () => {
    test('IPv4 is kept as is', () => {
        assert.equal(clientIpKey('203.0.113.7'), '203.0.113.7');
    });

    test('IPv4-mapped IPv6 collapses to the IPv4', () => {
        assert.equal(clientIpKey('::ffff:203.0.113.7'), '203.0.113.7');
        assert.equal(clientIpKey('::ffff:cb00:7107'), '203.0.113.7');
    });

    test('addresses of one /64 share a key', () => {
        const a = clientIpKey('2001:db8:1:2:aaaa::1');
        assert.equal(a, '2001:db8:1:2::/64');
        assert.equal(clientIpKey('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'), a);
        assert.equal(clientIpKey('2001:db8:1:2::9%eth0'), a);
    });

    test('different /64s get different keys', () => {
        assert.notEqual(clientIpKey('2001:db8:1:2::1'), clientIpKey('2001:db8:1:3::1'));
    });

    test('loopback and the unspecified address', () => {
        assert.equal(clientIpKey('::1'), '0:0:0:0::/64');
        assert.equal(clientIpKey('::'), '0:0:0:0::/64');
    });

    test('missing or non-IP input', () => {
        assert.equal(clientIpKey(undefined), 'unknown');
        assert.equal(clientIpKey(''), 'unknown');
        assert.equal(clientIpKey('not-an-ip'), 'not-an-ip');
    });
});
