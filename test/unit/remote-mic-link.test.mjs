// Tier-1 unit test for the scanned-QR link parser/validator
// (app/ui/src/lib/remote-mic-link.js). This is the trust boundary for the
// in-page camera re-scan: it must accept only well-formed, same-origin
// remote-mic links and reject everything else.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteMicLink } from '../../app/ui/src/lib/remote-mic-link.js';

const ORIGIN = 'https://parakeet.example.org';

describe('parseRemoteMicLink — valid links', () => {
  test('extracts roomId and secret from a same-origin link', () => {
    assert.deepEqual(
      parseRemoteMicLink(`${ORIGIN}/remote-mic.html#ABC123:s3cr3t-token`, ORIGIN),
      { roomId: 'ABC123', secret: 's3cr3t-token' },
    );
  });

  test('keeps everything after the first colon as the secret', () => {
    // The secret alphabet could one day include ':'; splitting at the first
    // separator must not truncate the tail.
    assert.deepEqual(
      parseRemoteMicLink(`${ORIGIN}/remote-mic.html#ROOM:a:b:c`, ORIGIN),
      { roomId: 'ROOM', secret: 'a:b:c' },
    );
  });

  test('trims surrounding whitespace from the scanned text', () => {
    assert.deepEqual(
      parseRemoteMicLink(`  ${ORIGIN}/remote-mic.html#R:S  `, ORIGIN),
      { roomId: 'R', secret: 'S' },
    );
  });

  test('matches on a sub-path deployment', () => {
    assert.deepEqual(
      parseRemoteMicLink(`${ORIGIN}/app/remote-mic.html#R:S`, ORIGIN),
      { roomId: 'R', secret: 'S' },
    );
  });

  test('skips the origin check when currentOrigin is falsy', () => {
    assert.deepEqual(
      parseRemoteMicLink('https://other.example/remote-mic.html#R:S', ''),
      { roomId: 'R', secret: 'S' },
    );
  });
});

describe('parseRemoteMicLink — rejected links', () => {
  test('rejects a different origin', () => {
    assert.equal(parseRemoteMicLink('https://evil.example/remote-mic.html#R:S', ORIGIN), null);
  });

  test('rejects a non remote-mic path', () => {
    assert.equal(parseRemoteMicLink(`${ORIGIN}/index.html#R:S`, ORIGIN), null);
  });

  test('rejects a look-alike path suffix', () => {
    assert.equal(parseRemoteMicLink(`${ORIGIN}/evil-remote-mic.html#R:S`, ORIGIN), null);
  });

  test('rejects a missing hash', () => {
    assert.equal(parseRemoteMicLink(`${ORIGIN}/remote-mic.html`, ORIGIN), null);
  });

  test('rejects a hash with no separator', () => {
    assert.equal(parseRemoteMicLink(`${ORIGIN}/remote-mic.html#justroom`, ORIGIN), null);
  });

  test('rejects an empty roomId or secret', () => {
    assert.equal(parseRemoteMicLink(`${ORIGIN}/remote-mic.html#:secret`, ORIGIN), null);
    assert.equal(parseRemoteMicLink(`${ORIGIN}/remote-mic.html#room:`, ORIGIN), null);
  });

  test('rejects non-URL and non-string input', () => {
    assert.equal(parseRemoteMicLink('not a url', ORIGIN), null);
    assert.equal(parseRemoteMicLink('', ORIGIN), null);
    assert.equal(parseRemoteMicLink(null, ORIGIN), null);
    assert.equal(parseRemoteMicLink(undefined, ORIGIN), null);
    assert.equal(parseRemoteMicLink(42, ORIGIN), null);
  });

  test('rejects an absurdly long payload', () => {
    const huge = `${ORIGIN}/remote-mic.html#R:${'x'.repeat(4096)}`;
    assert.equal(parseRemoteMicLink(huge, ORIGIN), null);
  });
});
