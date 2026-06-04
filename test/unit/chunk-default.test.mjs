// Tier-1 unit test for the backend-aware default chunk window
// (app/src/models.js). The WASM backend runs the int8 encoder, which drops
// long-range content past ~20 s within a chunk, so its default window must be
// the shorter int8-safe value; every other (WebGPU/fp32) backend keeps the full
// 60 s window. This pins that mapping so a future edit can't silently re-expose
// the int8 long-audio drop. See the long-audio-chunking e2e for the integration side.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultChunkDurationForBackend,
  DEFAULT_CHUNK_DURATION_SEC,
  INT8_SAFE_CHUNK_DURATION_SEC,
} from '../../app/src/models.js';

describe('defaultChunkDurationForBackend', () => {
  test('the WASM (int8) backend gets the shorter int8-safe window', () => {
    assert.equal(defaultChunkDurationForBackend('wasm'), INT8_SAFE_CHUNK_DURATION_SEC);
    assert.ok(INT8_SAFE_CHUNK_DURATION_SEC < DEFAULT_CHUNK_DURATION_SEC,
      'the int8-safe window must be shorter than the full default');
  });

  test('WebGPU (fp32) backends keep the full default window', () => {
    for (const b of ['webgpu', 'webgpu-hybrid', 'webgpu-fp16']) {
      assert.equal(defaultChunkDurationForBackend(b), DEFAULT_CHUNK_DURATION_SEC, `backend ${b}`);
    }
  });

  test('unknown/undefined backends fall back to the full default (not the int8 cap)', () => {
    assert.equal(defaultChunkDurationForBackend(undefined), DEFAULT_CHUNK_DURATION_SEC);
    assert.equal(defaultChunkDurationForBackend('something-else'), DEFAULT_CHUNK_DURATION_SEC);
  });

  test('the short window keys off the quant, not the backend: WASM-fp32 keeps the full window', () => {
    // The sharded fp32 encoder on WASM has no >20 s chunk loss, so it must get
    // the full window even though the backend is wasm.
    assert.equal(defaultChunkDurationForBackend('wasm', 'fp32'), DEFAULT_CHUNK_DURATION_SEC);
    // int8 on WASM still gets the short window (explicit and default-arg forms).
    assert.equal(defaultChunkDurationForBackend('wasm', 'int8'), INT8_SAFE_CHUNK_DURATION_SEC);
    assert.equal(defaultChunkDurationForBackend('wasm'), INT8_SAFE_CHUNK_DURATION_SEC);
  });
});
