// Tier-1 unit test for the corrupt-cached-model recovery primitives in
// app/src/hub.js:
//   - isModelDeserializeError: classifies an InferenceSession.create error as
//     "the cached bytes are corrupt" (re-download) vs a transient/environmental
//     failure (don't).
//   - modelFileCacheKeys: the exact IndexedDB record keys (blob + meta +
//     partial) that hold one cached file, so evictModelFiles drops the right
//     ones.
//   - evictModelFiles: no-ops cleanly when IndexedDB is absent (Node) or the
//     input is empty, and never throws.
// The in-browser deletion path runs against IndexedDB (absent in Node, so inert
// here, same as the other hub cache branches); the logic worth guarding is the
// pure key derivation and the error classifier, both covered below.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isModelDeserializeError, modelFileCacheKeys, evictModelFiles } from '../../app/src/hub.js';

describe('isModelDeserializeError: corrupt-model messages -> true', () => {
  // Real ORT phrasings (varies by version/build) plus an Error-object form.
  const corrupt = [
    'Failed to load model because protobuf parsing failed.',
    'Deserialize tensor encoder.weight failed.',
    "Can't create a session. Error: ...",
    'Cannot create a session from the given model.',
    'Load model from <blob> failed: ModelProto does not have a graph.',
    'ORT_INVALID_PROTOBUF : tensor proto malformed',
    'No graph was found in the model.',
    'The model file appears to be corrupt.',
  ];
  for (const m of corrupt) {
    test(JSON.stringify(m.slice(0, 40)), () => {
      assert.equal(isModelDeserializeError(new Error(m)), true);
      // Bare strings (some ORT/WASM rejections are non-Error) must match too.
      assert.equal(isModelDeserializeError(m), true);
    });
  }
});

describe('isModelDeserializeError: non-corruption failures -> false', () => {
  const benign = [
    new Error('TypeError: Failed to fetch'),
    new Error('NetworkError when attempting to fetch resource.'),
    new Error('bad_alloc'),
    new Error('Out of memory'),
    new Error('WebGPU is not available on this device'),
    new Error('graph capture is not supported for this backend'),
    null,
    undefined,
  ];
  for (const e of benign) {
    test(String(e && e.message || e), () => {
      assert.equal(isModelDeserializeError(e), false);
    });
  }
});

describe('modelFileCacheKeys: derives the three record keys per file', () => {
  test('default revision/subfolder', () => {
    const k = modelFileCacheKeys('istupakov/parakeet', 'encoder-model.int8.onnx');
    assert.equal(k.blob, 'hf-istupakov/parakeet-main--encoder-model.int8.onnx');
    assert.equal(k.meta, 'meta-' + k.blob);
    assert.equal(k.partial, 'partial-' + k.blob);
  });

  test('explicit revision threads into every key', () => {
    const k = modelFileCacheKeys('repo/x', 'decoder_joint-model.onnx.data', { revision: 'v2' });
    assert.equal(k.blob, 'hf-repo/x-v2--decoder_joint-model.onnx.data');
    assert.equal(k.meta, 'meta-hf-repo/x-v2--decoder_joint-model.onnx.data');
    assert.equal(k.partial, 'partial-hf-repo/x-v2--decoder_joint-model.onnx.data');
  });

  test('meta and partial are prefixes of the blob key (so evict hits the same file)', () => {
    const k = modelFileCacheKeys('r', 'f');
    assert.ok(k.meta.endsWith(k.blob));
    assert.ok(k.partial.endsWith(k.blob));
  });
});

describe('evictModelFiles: safe no-ops', () => {
  test('returns [] and does not throw when IndexedDB is absent (Node)', async () => {
    assert.equal(typeof indexedDB, 'undefined'); // sanity: Node really has none
    const r = await evictModelFiles({ repoId: 'r', filenames: ['encoder-model.onnx'] });
    assert.deepEqual(r, []);
  });

  test('returns [] for empty filenames / missing repoId', async () => {
    assert.deepEqual(await evictModelFiles({ repoId: 'r', filenames: [] }), []);
    assert.deepEqual(await evictModelFiles({ filenames: ['x'] }), []);
    assert.deepEqual(await evictModelFiles({}), []);
  });
});
