// Tier-1 unit test guarding the production Caddy Permissions-Policy header
// (docker/Caddyfile). This is the only place that grants/denies powerful
// browser features in production; dev/preview/test servers set no policy, so a
// regression here is invisible to the e2e tier and only surfaces on the
// deployed site.
//
// Regression covered: the phone reconnect screen's "Scan QR code" re-pairing
// flow (app/ui/src/remote-mic-entry.jsx) calls
// getUserMedia({ video: { facingMode: 'environment' } }). With camera=() the
// browser blocks that at the policy layer and never prompts (silent
// NotAllowedError, reproduced in Brave). camera MUST be (self).
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const caddyfile = readFileSync(
  fileURLToPath(new URL('../../docker/Caddyfile', import.meta.url)),
  'utf8',
);

// Pull the Permissions-Policy "<value>" string out of the header block and
// parse its `feature=(allowlist)` directives into a name -> allowlist map.
function parsePermissionsPolicy(src) {
  const m = src.match(/Permissions-Policy\s+"([^"]*)"/);
  assert.ok(m, 'Permissions-Policy header not found in Caddyfile');
  const map = new Map();
  for (const directive of m[1].split(',')) {
    const dm = directive.trim().match(/^([a-z-]+)=(\(.*\))$/);
    assert.ok(dm, `unparseable Permissions-Policy directive: "${directive.trim()}"`);
    map.set(dm[1], dm[2]);
  }
  return map;
}

describe('docker/Caddyfile Permissions-Policy', () => {
  const policy = parsePermissionsPolicy(caddyfile);

  test('camera is granted to self for the remote-mic QR re-scan', () => {
    assert.equal(
      policy.get('camera'),
      '(self)',
      'camera must be (self) so getUserMedia({ video }) in the remote-mic ' +
        'reconnect QR re-scan is not blocked at the policy layer',
    );
  });

  test('microphone stays granted to self (page records audio)', () => {
    assert.equal(policy.get('microphone'), '(self)');
  });

  test('camera is the only feature beyond the known self-allowlist', () => {
    // Pin the full set of self-granted features so a future copy/paste cannot
    // silently widen the policy (e.g. accidentally enabling usb=(self)).
    const selfGranted = [...policy.entries()]
      .filter(([, allow]) => allow === '(self)')
      .map(([name]) => name)
      .sort();
    assert.deepEqual(selfGranted, [
      'camera',
      'clipboard-write',
      'hid',
      'microphone',
      'screen-wake-lock',
      'wake-lock',
    ]);
  });
});
