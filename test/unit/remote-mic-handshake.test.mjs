// Unit coverage for the remote-mic fingerprint decision helpers
// (app/ui/src/lib/remote-mic-handshake.js). Regression guards:
//  - the local Confirm/Deny used to wait forever, keeping a pending pairing
//    alive on an unattended screen; it now times out as a deny.
//  - verify-ok used to be a bare boolean signal; it now names the fingerprint
//    it approves, and only a matching one counts.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    waitForDecision, verifyOkMessage, approvedFingerprint, VERIFY_TTL_MS,
} from '../../app/ui/src/lib/remote-mic-handshake.js';

describe('waitForDecision', () => {
    test('resolves with the registered decision', async () => {
        let resolver;
        const p = waitForDecision((r) => { resolver = r; }, 1000);
        resolver('1A2B-3C4D');
        assert.equal(await p, '1A2B-3C4D');
    });

    test('a synchronous decision (buffered early message) resolves immediately', async () => {
        assert.equal(await waitForDecision((r) => r(true), 1000), true);
    });

    test('times out as false, and a late decision is ignored', async () => {
        let resolver;
        const p = waitForDecision((r) => { resolver = r; }, 10);
        assert.equal(await p, false);
        resolver(true); // must not throw nor change anything
    });

    test('the default TTL is about a minute', () => {
        assert.equal(VERIFY_TTL_MS, 60000);
    });
});

describe('verify-ok binds the fingerprint', () => {
    test('round trip', () => {
        const fp = '1A2B-3C4D-5E6F-7A8B';
        assert.equal(approvedFingerprint(verifyOkMessage(fp)), fp);
    });

    test('a bare or malformed verify-ok approves nothing', () => {
        assert.equal(approvedFingerprint({ type: 'verify-ok' }), '');
        assert.equal(approvedFingerprint({ type: 'verify-ok', fp: 42 }), '');
        assert.equal(approvedFingerprint(null), '');
    });
});
