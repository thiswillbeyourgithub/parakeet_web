// Tier-1 tests for the pure Sortformer file helpers: which step precision each
// backend downloads (app/ui/src/lib/diarizationFiles.js), where each precision
// lives in the repo and the checks on its config + silence files
// (app/src/sortformer.js, shared with the server).
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diarizationPrecision } from '../../app/ui/src/lib/diarizationFiles.js';
import { parseSortformerData, SORTFORMER_STEP_FILES } from '../../app/src/sortformer.js';

const enc = (obj) => new TextEncoder().encode(JSON.stringify(obj));
const CONFIG = {
  hidden_size: 4, num_mel_bins: 128, num_speakers: 8, subsampling_factor: 8,
  offline: { chunk_length: 340 }, speaker_cache: { speaker_cache_length: 188 },
};

describe('diarizationPrecision', () => {
  test('WASM (and anything not WebGPU) runs int8, whatever the adapter says', () => {
    assert.equal(diarizationPrecision('wasm', true), 'int8');
    assert.equal(diarizationPrecision(undefined, null), 'int8');
  });
  test('WebGPU runs fp16 only on an explicit shader-f16 yes', () => {
    for (const b of ['webgpu', 'webgpu-hybrid', 'webgpu-strict']) {
      assert.equal(diarizationPrecision(b, true), 'fp16');
      assert.equal(diarizationPrecision(b, false), 'fp32');
      assert.equal(diarizationPrecision(b, null), 'fp32', 'an unknown answer must not pick fp16');
    }
  });
  test('every precision it can return has a step file', () => {
    for (const p of ['int8', 'fp16', 'fp32']) assert.ok(SORTFORMER_STEP_FILES[p]);
  });
});

describe('parseSortformerData', () => {
  test('parses a valid pair, silence values intact', () => {
    const silence = new Float32Array([0.5, -1, 2, 3.25]);
    const { config, silenceEmbeds } = parseSortformerData(enc(CONFIG), new Uint8Array(silence.buffer));
    assert.equal(config.num_speakers, 8);
    assert.deepEqual([...silenceEmbeds], [0.5, -1, 2, 3.25]);
  });
  test('reads silence from an unaligned view into a larger buffer', () => {
    const big = new Uint8Array(1 + 16 + 3);
    big.set(new Uint8Array(new Float32Array([1, 2, 3, 4]).buffer), 1);
    const { silenceEmbeds } = parseSortformerData(enc(CONFIG), big.subarray(1, 17));
    assert.deepEqual([...silenceEmbeds], [1, 2, 3, 4]);
  });
  test('reads silence from a Node Buffer view, as the server passes it', () => {
    // Buffer.slice() is a view, not a copy: the first version took the whole
    // pooled ArrayBuffer and handed the model garbage silence embeddings
    const pool = Buffer.alloc(64, 0xff);
    Buffer.from(new Float32Array([1, 2, 3, 4]).buffer).copy(pool, 8);
    const { silenceEmbeds } = parseSortformerData(enc(CONFIG), pool.subarray(8, 24));
    assert.deepEqual([...silenceEmbeds], [1, 2, 3, 4]);
  });
  test('a config missing a required key throws, naming it', () => {
    const { speaker_cache: _, ...partial } = CONFIG;
    assert.throws(() => parseSortformerData(enc(partial), new Uint8Array(16)), /speaker_cache/);
  });
  test('a silence file of the wrong length throws', () => {
    assert.throws(() => parseSortformerData(enc(CONFIG), new Uint8Array(12)), /expected 16/);
  });
});
