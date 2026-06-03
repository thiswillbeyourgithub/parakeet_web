// Tier-1 unit test for resolveModelQuant (app/src/hub.js): the pure decision
// that picks the encoder/decoder quantisation per backend and per what the repo
// ships. It encodes two hard rules: WASM is pinned to int8 (fp16/fp32 overflow
// the 32-bit WASM heap), and WebGPU prefers fp16 when shipped (near-lossless,
// half the fp32 download, no >20 s chunk loss) but falls back to fp32 so a repo
// without fp16 files (e.g. the upstream istupakov repo) keeps working.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelQuant } from '../../app/src/hub.js';

const WITH_FP16 = ['encoder-model.fp16.onnx', 'decoder_joint-model.fp16.onnx', 'encoder-model.int8.onnx', 'encoder-model.onnx'];
const NO_FP16 = ['encoder-model.int8.onnx', 'encoder-model.onnx', 'encoder-model.onnx.data', 'decoder_joint-model.int8.onnx'];

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
