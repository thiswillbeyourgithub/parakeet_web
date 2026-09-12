// Tier-1 unit test for OnnxPreprocessor's option handling
// (app/src/preprocessor.js). No ORT session is built: the constructor is where
// the bug was.
//
// It defaulted `enableGraphCapture` by writing into the caller's own options
// object, so a caller that reuses one object across preprocessors (or reads it
// back afterwards) silently inherited a decision this constructor made from
// its own backend.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OnnxPreprocessor } from '../../app/src/preprocessor.js';

describe('OnnxPreprocessor options', () => {
  test('does not mutate the caller options object', () => {
    const opts = { backend: 'wasm' };
    new OnnxPreprocessor('/nemo128.onnx', opts);
    assert.deepEqual(opts, { backend: 'wasm' }, 'the caller must get its object back unchanged');
  });

  test('one options object reused across backends keeps each decision local', () => {
    // The reuse case the mutation broke: the wasm preprocessor stamped
    // enableGraphCapture:true into the shared object, so the webgpu one built
    // next saw it as an explicit choice and kept graph capture on.
    const shared = {};
    const wasm = new OnnxPreprocessor('/a.onnx', { ...shared, backend: 'wasm' });
    const gpu = new OnnxPreprocessor('/b.onnx', { ...shared, backend: 'webgpu' });
    assert.equal(wasm.opts.enableGraphCapture, true);
    assert.equal(gpu.opts.enableGraphCapture, false);
    assert.deepEqual(shared, {});
  });

  test('defaults graph capture on for wasm and off for anything else', () => {
    assert.equal(new OnnxPreprocessor('/x', { backend: 'wasm' }).opts.enableGraphCapture, true);
    assert.equal(new OnnxPreprocessor('/x', { backend: 'webgpu' }).opts.enableGraphCapture, false);
    assert.equal(new OnnxPreprocessor('/x').opts.enableGraphCapture, false);
  });

  test('an explicit graph-capture choice is respected', () => {
    assert.equal(
      new OnnxPreprocessor('/x', { backend: 'wasm', enableGraphCapture: false }).opts.enableGraphCapture,
      false,
    );
    assert.equal(
      new OnnxPreprocessor('/x', { backend: 'webgpu', enableGraphCapture: true }).opts.enableGraphCapture,
      true,
    );
  });
});
