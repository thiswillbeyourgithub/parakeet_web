// Tier-1 unit test for resolveMaxEncoderBatch() (app/src/parakeet.js): the
// WebGPU encoder batch size must auto-adapt to the GPU (adapter memory limits +
// encoder weight footprint), stay pinned to 1 on WASM, be guarded against a
// missing navigator.gpu, and never exceed the safe ceiling. No model needed:
// we stub navigator.gpu with fake adapter limits.
//
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaxEncoderBatch, encoderWeightBytesFromName } from '../../app/src/parakeet.js';

const CEIL = 4;

// Node 22 exposes a read-only `navigator` global, so override it with a
// configurable property and restore it afterwards.
const originalNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}
// Install a fake navigator.gpu whose adapter reports a given maxBufferSize.
function stubGpu(maxBufferSize) {
  setNavigator({
    gpu: {
      requestAdapter: async () => (maxBufferSize == null ? null : { limits: { maxBufferSize } }),
    },
  });
}

afterEach(() => {
  if (originalNavigatorDesc) Object.defineProperty(globalThis, 'navigator', originalNavigatorDesc);
  else { setNavigator(undefined); delete globalThis.navigator; }
});

describe('resolveMaxEncoderBatch', () => {
  test('WASM is always 1 (byte-identical path), never probes the GPU', async () => {
    stubGpu(8e9); // even with a huge GPU present
    assert.equal(await resolveMaxEncoderBatch({ backend: 'wasm', encoderFilename: 'encoder-model.int8.onnx' }), 1);
  });

  test('WebGPU with no navigator.gpu falls back to the floor of 2', async () => {
    // no stub installed
    assert.equal(await resolveMaxEncoderBatch({ backend: 'webgpu-hybrid', encoderFilename: 'encoder-model.int8.onnx' }), 2);
  });

  test('WebGPU with a null adapter falls back to 2', async () => {
    stubGpu(null);
    assert.equal(await resolveMaxEncoderBatch({ backend: 'webgpu-strict', encoderFilename: 'encoder-model.int8.onnx' }), 2);
  });

  test('small GPU (256 MB max buffer) stays at the floor of 2', async () => {
    stubGpu(256 * 1024 * 1024); // < int8 weights, headroom negative -> floor
    assert.equal(await resolveMaxEncoderBatch({ backend: 'webgpu-hybrid', encoderFilename: 'encoder-model.int8.onnx' }), 2);
  });

  test('big GPU + int8 weights scales up toward the ceiling', async () => {
    stubGpu(4e9); // 4 GB max buffer, int8 weights ~0.6 GB
    const b = await resolveMaxEncoderBatch({ backend: 'webgpu-hybrid', encoderFilename: 'encoder-model.int8.onnx' });
    assert.ok(b > 2 && b <= CEIL, `expected 3..${CEIL}, got ${b}`);
  });

  test('never exceeds the ceiling even on an enormous GPU', async () => {
    stubGpu(64e9);
    assert.equal(await resolveMaxEncoderBatch({ backend: 'webgpu-hybrid', encoderFilename: 'encoder-model.int8.onnx' }), CEIL);
  });

  test('heavier fp32 weights batch less than int8 on the same GPU', async () => {
    stubGpu(6e9);
    const int8 = await resolveMaxEncoderBatch({ backend: 'webgpu-hybrid', encoderFilename: 'encoder-model.int8.onnx' });
    const fp32 = await resolveMaxEncoderBatch({ backend: 'webgpu-hybrid', encoderFilename: 'encoder-model.onnx' });
    assert.ok(fp32 <= int8, `fp32 (${fp32}) should batch <= int8 (${int8})`);
  });

  test('a throwing requestAdapter is swallowed -> floor of 2', async () => {
    setNavigator({ gpu: { requestAdapter: async () => { throw new Error('boom'); } } });
    assert.equal(await resolveMaxEncoderBatch({ backend: 'webgpu-hybrid', encoderFilename: 'encoder-model.int8.onnx' }), 2);
  });
});

describe('encoderWeightBytesFromName', () => {
  test('maps quant substrings (and plain name = fp32) to weight footprints', () => {
    assert.equal(encoderWeightBytesFromName('encoder-model.int8.onnx'), 0.6e9);
    assert.equal(encoderWeightBytesFromName('encoder-model.int8.smoothquant.onnx'), 0.6e9);
    assert.equal(encoderWeightBytesFromName('encoder-model.fp16.onnx'), 1.2e9);
    assert.equal(encoderWeightBytesFromName('encoder-model.onnx'), 2.4e9); // plain == fp32
    assert.equal(encoderWeightBytesFromName('encoder-model.fp32.onnx'), 2.4e9);
    assert.equal(encoderWeightBytesFromName(undefined), 2.4e9); // unknown = conservative
  });
});
