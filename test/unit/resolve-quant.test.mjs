// Tier-1 unit test for resolveModelQuant (app/src/hub.js): the pure decision
// that picks the encoder/decoder quantisation per backend and per what the repo
// ships. It encodes two hard rules: WASM is pinned to int8 (fp16/fp32 overflow
// the 32-bit WASM heap), and WebGPU prefers fp16 when shipped (near-lossless,
// half the fp32 download, no >20 s chunk loss) but falls back to fp32 so a repo
// without fp16 files (e.g. the upstream istupakov repo) keeps working.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelQuant, quantSatisfiable } from '../../app/src/hub.js';

const WITH_FP16 = ['encoder-model.fp16.onnx', 'decoder_joint-model.fp16.onnx', 'encoder-model.int8.onnx', 'encoder-model.onnx'];
const NO_FP16 = ['encoder-model.int8.onnx', 'encoder-model.onnx', 'encoder-model.onnx.data', 'decoder_joint-model.int8.onnx'];
// A repo that ships the fp32 encoder as <2GB shards (parakeet-tdt-0.6b-v3-smoothquant-onnx/shard-fp32.py).
const WITH_FP32_SHARDS = ['encoder-model.int8.onnx', 'encoder-model.onnx', 'encoder-model.onnx.data.000', 'encoder-model.onnx.data.001', 'decoder_joint-model.int8.onnx'];

describe('resolveModelQuant: WASM is pinned to int8', () => {
  for (const backend of ['wasm']) {
    test(`${backend} with int8 request -> int8/int8, not pinned-warned`, () => {
      const r = resolveModelQuant({ backend, encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: WITH_FP16 });
      assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
      assert.equal(r.pinnedToInt8, false);
    });

    test(`${backend} with fp16 request is forced to int8 and flagged`, () => {
      const r = resolveModelQuant({ backend, encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: WITH_FP16 });
      assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
      assert.equal(r.pinnedToInt8, true);
    });

    test(`${backend} with fp32 request is forced to int8 and flagged`, () => {
      const r = resolveModelQuant({ backend, encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP16 });
      assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
      assert.equal(r.pinnedToInt8, true);
    });
  }
});

describe('resolveModelQuant: WASM sharded-fp32 opt-in', () => {
  test('opt-in + fp32 request + shards shipped -> fp32 encoder, int8 decoder, not pinned', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS, allowWasmFp32: true });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp32', 'int8']);
    assert.equal(r.pinnedToInt8, false);
  });

  test('opt-in OFF (default) + fp32 request + shards shipped -> still int8 pin', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
    assert.equal(r.pinnedToInt8, true);
  });

  test('opt-in + fp32 request but NO shards shipped -> int8 pin (single 2.4GB sidecar cannot load on WASM)', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: NO_FP16, allowWasmFp32: true });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
    assert.equal(r.pinnedToInt8, true);
  });

  test('opt-in + int8 request -> int8 (opt-in never forces fp32 on an int8 request)', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS, allowWasmFp32: true });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
    assert.equal(r.pinnedToInt8, false);
  });
});

describe('resolveModelQuant: WebGPU prefers fp16 when the repo ships it', () => {
  test('fp16 request + fp16 in repo -> fp16/fp16', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: WITH_FP16 });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp16', 'fp16']);
    assert.equal(r.encoderFellBackToFp32, false);
  });

  test('webgpu-hybrid is treated as WebGPU', () => {
    const r = resolveModelQuant({ backend: 'webgpu-hybrid', encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: WITH_FP16 });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp16', 'fp16']);
  });

  test('legacy int8 request on WebGPU is bumped to fp16 when shipped', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: WITH_FP16 });
    assert.equal(r.encoderQ, 'fp16');
    // decoder only follows to fp16 when fp16 was explicitly requested
    assert.equal(r.decoderQ, 'int8');
  });
});

describe('resolveModelQuant: WebGPU falls back to fp32 without fp16 files', () => {
  test('fp16 request + no fp16 in repo -> fp32 encoder, int8 decoder, flagged', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: NO_FP16 });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp32', 'int8']);
    assert.equal(r.encoderFellBackToFp32, true);
  });

  test('legacy int8 request + no fp16 -> fp32 encoder (current production behaviour)', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: NO_FP16 });
    assert.equal(r.encoderQ, 'fp32');
    assert.equal(r.decoderQ, 'int8');
  });

  test('explicit fp32 request is honoured even when fp16 is available, and not flagged as fallback', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP16 });
    assert.equal(r.encoderQ, 'fp32');
    assert.equal(r.encoderFellBackToFp32, false);
  });

  test('fp16 decoder requested but only fp16 encoder shipped -> decoder stays int8', () => {
    const onlyEnc = ['encoder-model.fp16.onnx', 'encoder-model.onnx', 'decoder_joint-model.int8.onnx'];
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: onlyEnc });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp16', 'int8']);
  });
});

// quantSatisfiable(fileSet) = "this source can deliver the requested quant with
// NO downgrade". The UI calls it on a local /models mirror to decide whether to
// reload from there when HuggingFace could not serve the requested precision.
describe('quantSatisfiable: can a file set deliver the requested quant?', () => {
  test('WASM fp32 opt-in is satisfiable iff the source ships the shards', () => {
    const args = { backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', allowWasmFp32: true };
    assert.equal(quantSatisfiable({ ...args, repoFiles: WITH_FP32_SHARDS }), true);
    assert.equal(quantSatisfiable({ ...args, repoFiles: NO_FP16 }), false, 'single 2.4 GB sidecar cannot load on WASM');
  });

  test('WASM int8 is always satisfiable', () => {
    assert.equal(quantSatisfiable({ backend: 'wasm', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: NO_FP16 }), true);
  });

  test('WASM fp32 without the opt-in is NOT satisfiable even with shards (stays pinned)', () => {
    assert.equal(quantSatisfiable({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS }), false);
  });

  test('WebGPU fp16 is satisfiable iff the source ships the fp16 encoder', () => {
    const args = { backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16' };
    assert.equal(quantSatisfiable({ ...args, repoFiles: WITH_FP16 }), true);
    assert.equal(quantSatisfiable({ ...args, repoFiles: NO_FP16 }), false, 'fp16->fp32 fall-back counts as not satisfiable');
  });
});

// The UI's "requested quant not on HF but the local mirror has it" decision is
// exactly: HF downgraded AND the local file set is quantSatisfiable. These pin
// the two real cases the feature exists for.
describe('local /models fallback decision (HF downgraded + local can satisfy)', () => {
  test('WASM fp32: HF (no shards) pins to int8, local (shards) satisfies -> prefer local', () => {
    const req = { backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', allowWasmFp32: true };
    const hf = resolveModelQuant({ ...req, repoFiles: NO_FP16 });
    assert.equal(hf.pinnedToInt8, true, 'HF could not satisfy fp32');
    assert.equal(quantSatisfiable({ ...req, repoFiles: WITH_FP32_SHARDS }), true, 'local can');
  });

  test('WebGPU fp16: HF (no fp16) falls back to fp32, local (fp16) satisfies -> prefer local', () => {
    const req = { backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16' };
    const hf = resolveModelQuant({ ...req, repoFiles: NO_FP16 });
    assert.equal(hf.encoderFellBackToFp32, true, 'HF could not satisfy fp16');
    assert.equal(quantSatisfiable({ ...req, repoFiles: WITH_FP16 }), true, 'local can');
  });

  test('no local upgrade when local also lacks the files (no needless reload)', () => {
    const req = { backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', allowWasmFp32: true };
    assert.equal(quantSatisfiable({ ...req, repoFiles: NO_FP16 }), false, 'local without shards cannot satisfy either');
  });
});
