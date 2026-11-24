// Tier-1 unit test for the scanned-QR link parser/validator
// (app/ui/src/lib/remote-mic-link.js). This is the trust boundary for the
// in-page camera re-scan: it must accept only well-formed, same-origin
// remote-mic links and reject everything else.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteMicLink, parseRemoteMicHash } from '../../app/ui/src/lib/remote-mic-link.js';

const ORIGIN = 'https://parakeet.example.org';
const K = 'q3V0d2l0aC1jbGF1ZGUtY2';

describe('parseRemoteMicLink — valid links', () => {
  test('extracts roomId and secret from a same-origin link', () => {
    assert.deepEqual(
      parseRemoteMicLink(`${ORIGIN}/remote-mic.html#ABC123:s3cr3t-token:${K}`, ORIGIN),
      { roomId: 'ABC123', secret: 's3cr3t-token', qrSecret: K },
    );
  });

  test('keeps everything between the first and last colon as the secret', () => {
    // The secret alphabet could one day include ':'; K is after the last one.
    assert.deepEqual(
      parseRemoteMicLink(`${ORIGIN}/remote-mic.html#ROOM:a:b:c:${K}`, ORIGIN),
      { roomId: 'ROOM', secret: 'a:b:c', qrSecret: K },
    );
  });

  test('trims surrounding whitespace from the scanned text', () => {
    assert.deepEqual(
      parseRemoteMicLink(`  ${ORIGIN}/remote-mic.html#R:S:${K}  `, ORIGIN),
      { roomId: 'R', secret: 'S', qrSecret: K },
    );
  });

  test('matches on a sub-path deployment', () => {
    assert.deepEqual(
      parseRemoteMicLink(`${ORIGIN}/app/remote-mic.html#R:S:${K}`, ORIGIN),
      { roomId: 'R', secret: 'S', qrSecret: K },
    );
  });

  test('skips the origin check when currentOrigin is falsy', () => {
    assert.deepEqual(
      parseRemoteMicLink('https://other.example/remote-mic.html#R:S:'+K, ''),
      { roomId: 'R', secret: 'S', qrSecret: K },
    );
  });
});

describe('parseRemoteMicLink — rejected links', () => {
  test('rejects a different origin', () => {
    assert.equal(parseRemoteMicLink('https://evil.example/remote-mic.html#R:S:'+K, ORIGIN), null);
  });

  test('rejects a non remote-mic path', () => {
    assert.equal(parseRemoteMicLink(`${ORIGIN}/index.html#R:S:${K}`, ORIGIN), null);
  });

  test('rejects a look-alike path suffix', () => {
    assert.equal(parseRemoteMicLink(`${ORIGIN}/evil-remote-mic.html#R:S:${K}`, ORIGIN), null);
  });

  test('rejects a missing hash', () => {
    assert.equal(parseRemoteMicLink(`${ORIGIN}/remote-mic.html`, ORIGIN), null);
  });

  test('rejects a hash with no separator', () => {
    assert.equal(parseRemoteMicLink(`${ORIGIN}/remote-mic.html#justroom`, ORIGIN), null);
  });

  test('rejects an empty roomId or secret', () => {
    assert.equal(parseRemoteMicLink(`${ORIGIN}/remote-mic.html#:secret:${K}`, ORIGIN), null);
    assert.equal(parseRemoteMicLink(`${ORIGIN}/remote-mic.html#room::${K}`, ORIGIN), null);
  });

  test('rejects non-URL and non-string input', () => {
    assert.equal(parseRemoteMicLink('not a url', ORIGIN), null);
    assert.equal(parseRemoteMicLink('', ORIGIN), null);
    assert.equal(parseRemoteMicLink(null, ORIGIN), null);
    assert.equal(parseRemoteMicLink(undefined, ORIGIN), null);
    assert.equal(parseRemoteMicLink(42, ORIGIN), null);
  });

  test('rejects an absurdly long payload', () => {
    const huge = `${ORIGIN}/remote-mic.html#R:${'x'.repeat(4096)}:${K}`;
    assert.equal(parseRemoteMicLink(huge, ORIGIN), null);
  });
});

describe('parseRemoteMicHash: QR secret K', () => {
  test('a v3 link without K is refused (v4 key derivation needs it)', () => {
    assert.equal(parseRemoteMicHash('#ROOM:SECRET'), null);
    assert.equal(parseRemoteMicLink(`${ORIGIN}/remote-mic.html#ROOM:SECRET`, ORIGIN), null);
  });

  test('a malformed K is refused', () => {
    assert.equal(parseRemoteMicHash('#R:S:tooshort'), null);
    assert.equal(parseRemoteMicHash(`#R:S:${K}x`), null);
    assert.equal(parseRemoteMicHash('#R:S:' + 'a+b/'.repeat(5) + 'ab'), null);
  });

  test('the leading # is optional', () => {
    assert.deepEqual(parseRemoteMicHash(`R:S:${K}`), { roomId: 'R', secret: 'S', qrSecret: K });
    assert.equal(parseRemoteMicHash(null), null);
  });
});
