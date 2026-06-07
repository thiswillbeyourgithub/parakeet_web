// Tier-1 unit test for buildExternalData (app/src/parakeet.js): the pure mapping
// from an external-weights source to the ORT `externalData` array mounted on a
// session. It must handle both layouts the loader supports: a single
// <model>.data sidecar (URL/buffer) and a sharded fp32 encoder
// (parakeet-tdt-0.6b-v3-smoothquant-onnx/shard-fp32.py) passed as an array of { path, data } entries, where
// each path is the shard basename baked into the graph's external_data location.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildExternalData } from '../../app/src/parakeet.js';

describe('buildExternalData: single sidecar', () => {
  test('URL source maps to one entry named <model>.data', () => {
    const r = buildExternalData('blob:abc', 'encoder-model.onnx');
    assert.deepEqual(r, [{ data: 'blob:abc', path: 'encoder-model.onnx.data' }]);
  });

  test('buffer source is passed through as data', () => {
    const buf = new Uint8Array([1, 2, 3]);
    const r = buildExternalData(buf, 'decoder_joint-model.onnx');
    assert.equal(r.length, 1);
    assert.equal(r[0].data, buf);
    assert.equal(r[0].path, 'decoder_joint-model.onnx.data');
  });

  test('a single sidecar without a model filename cannot be named -> undefined', () => {
    // The single-sidecar path needs the model filename to derive `<model>.data`;
    // missing it means we cannot mount it, so nothing is returned.
    assert.equal(buildExternalData('blob:abc', undefined), undefined);
  });
});

describe('buildExternalData: sharded form', () => {
  test('array of shard entries is passed straight through (filename ignored)', () => {
    const shards = [
      { path: 'encoder-model.onnx.data.000', data: 'blob:0' },
      { path: 'encoder-model.onnx.data.001', data: 'blob:1' },
    ];
    // Pass a filename to prove the array form ignores it (shards carry their own
    // baked-in locations and must not be renamed to <model>.data).
    const r = buildExternalData(shards, 'encoder-model.onnx');
    assert.equal(r, shards);
    assert.deepEqual(r.map((e) => e.path), [
      'encoder-model.onnx.data.000',
      'encoder-model.onnx.data.001',
    ]);
  });

  test('an empty shard array means nothing to mount -> undefined', () => {
    assert.equal(buildExternalData([], 'encoder-model.onnx'), undefined);
  });
});

describe('buildExternalData: no external weights', () => {
  test('falsy source -> undefined (int8 encoder has no sidecar)', () => {
    assert.equal(buildExternalData(null, 'encoder-model.int8.onnx'), undefined);
    assert.equal(buildExternalData(undefined, 'encoder-model.int8.onnx'), undefined);
    assert.equal(buildExternalData('', 'encoder-model.int8.onnx'), undefined);
  });
});
