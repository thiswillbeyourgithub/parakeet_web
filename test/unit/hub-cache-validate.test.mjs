// Tier-1 unit test for decideCacheAction (app/src/hub.js): the pure decision
// that gates whether a cached model file is reused or re-downloaded. The rule
// is deliberately conservative (default to reusing the cache) so a flaky
// network or a blocked HuggingFace never forces a needless multi-GB download.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideCacheAction } from '../../app/src/hub.js';

describe('decideCacheAction integrity (size)', () => {
  test('size matches recorded size -> use', () => {
    assert.equal(decideCacheAction({ cachedSize: 100, meta: { size: 100 }, head: null }), 'use');
  });

  test('size differs from recorded size -> redownload (truncated/corrupt)', () => {
    assert.equal(decideCacheAction({ cachedSize: 90, meta: { size: 100 }, head: null }), 'redownload');
  });

  test('no recorded size -> integrity check skipped -> use', () => {
    assert.equal(decideCacheAction({ cachedSize: 90, meta: {}, head: null }), 'use');
  });

  test('recorded size of 0 is ignored -> use', () => {
    assert.equal(decideCacheAction({ cachedSize: 90, meta: { size: 0 }, head: null }), 'use');
  });

  test('no metadata at all (legacy cache) -> use', () => {
    assert.equal(decideCacheAction({ cachedSize: 90, meta: null, head: null }), 'use');
  });
});

describe('decideCacheAction freshness (etag)', () => {
  test('etags differ on a successful HEAD -> redownload', () => {
    assert.equal(
      decideCacheAction({ cachedSize: 100, meta: { size: 100, etag: 'aaa' }, head: { ok: true, etag: 'bbb' } }),
      'redownload'
    );
  });

  test('etags match -> use', () => {
    assert.equal(
      decideCacheAction({ cachedSize: 100, meta: { size: 100, etag: 'aaa' }, head: { ok: true, etag: 'aaa' } }),
      'use'
    );
  });

  test('HEAD failed (ok=false) -> use (trust cache)', () => {
    assert.equal(
      decideCacheAction({ cachedSize: 100, meta: { size: 100, etag: 'aaa' }, head: { ok: false, etag: null } }),
      'use'
    );
  });

  test('HEAD skipped (null, e.g. offline) -> use', () => {
    assert.equal(
      decideCacheAction({ cachedSize: 100, meta: { size: 100, etag: 'aaa' }, head: null }),
      'use'
    );
  });

  test('no recorded etag -> cannot compare -> use', () => {
    assert.equal(
      decideCacheAction({ cachedSize: 100, meta: { size: 100 }, head: { ok: true, etag: 'bbb' } }),
      'use'
    );
  });

  test('HEAD returned no etag -> cannot compare -> use', () => {
    assert.equal(
      decideCacheAction({ cachedSize: 100, meta: { size: 100, etag: 'aaa' }, head: { ok: true, etag: null } }),
      'use'
    );
  });
});

describe('decideCacheAction precedence', () => {
  test('size mismatch forces redownload even when etags match', () => {
    assert.equal(
      decideCacheAction({ cachedSize: 90, meta: { size: 100, etag: 'aaa' }, head: { ok: true, etag: 'aaa' } }),
      'redownload'
    );
  });
});
