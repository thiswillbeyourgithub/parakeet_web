// Tier-1 unit test pinning the single, backend-independent long-audio chunk
// window (app/src/models.js). The app used to special-case the WASM/int8 path to
// a shorter window because the stock int8 encoder dropped long-range content past
// ~20 s within a chunk. The SmoothQuant int8 encoder this app ships holds quality
// on long audio, so that special case was removed and every backend/precision now
// shares DEFAULT_CHUNK_DURATION_SEC. This guards against silently re-introducing a
// per-backend window. See the long-audio-chunking e2e for the integration side.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as models from '../../app/src/models.js';

describe('default chunk window', () => {
  test('is a single 60 s default for every backend/precision', () => {
    assert.equal(models.DEFAULT_CHUNK_DURATION_SEC, 60);
  });

  test('the removed int8 special-case window stays removed', () => {
    assert.equal(models.INT8_SAFE_CHUNK_DURATION_SEC, undefined,
      'INT8_SAFE_CHUNK_DURATION_SEC must not come back');
    assert.equal(models.defaultChunkDurationForBackend, undefined,
      'defaultChunkDurationForBackend (the backend-aware window) must not come back');
  });
});
