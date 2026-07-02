// Tier-1 unit test for resolveModelQuant (app/src/hub.js): the pure decision
// that picks the encoder/decoder quantisation per backend and per what the repo
// ships. It encodes two hard rules: WASM is pinned to int8 (fp16/fp32 overflow
// the 32-bit WASM heap), and WebGPU prefers fp16 when shipped (near-lossless,
// half the fp32 download, lighter to serve) but falls back to fp32 so a repo
// without fp16 files (e.g. the upstream istupakov repo) keeps working.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelQuant, quantSatisfiable, parseEncoderShards, isSafeRepoPath } from '../../app/src/hub.js';

const WITH_FP16 = ['encoder-model.fp16.onnx', 'decoder_joint-model.fp16.onnx', 'encoder-model.int8.onnx', 'encoder-model.onnx'];
const NO_FP16 = ['encoder-model.int8.onnx', 'encoder-model.onnx', 'encoder-model.onnx.data', 'decoder_joint-model.int8.onnx'];
// A repo that ships the fp32 encoder as <2GB shards (parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/shard-fp32.py).
const WITH_FP32_SHARDS = ['encoder-model.int8.onnx', 'encoder-model.onnx', 'encoder-model.onnx.data.000', 'encoder-model.onnx.data.001', 'decoder_joint-model.int8.onnx'];
// The SAME shards as the model repo actually ships them: under a `sharded/`
// subfolder (scripts/shard-fp32.py's default output), which is exactly how the HF
// tree API lists them (`sharded/encoder-model.onnx.data.NNN`). The flat single-
// file fp32 encoder (encoder-model.onnx[.data]) sits at the root for WebGPU.
const WITH_FP32_SHARDS_SUBFOLDER = [
  'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
  'encoder-model.onnx', 'encoder-model.onnx.data',
  'sharded/encoder-model.onnx', 'sharded/encoder-model.onnx.data.000', 'sharded/encoder-model.onnx.data.001',
];
// A repo that ALSO ships the lighter int8 encoder (encoder-model.int8.lite.onnx).
const WITH_LITE = ['encoder-model.int8.onnx', 'encoder-model.int8.lite.onnx', 'encoder-model.onnx', 'decoder_joint-model.int8.onnx'];

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

  // Regression: the model repo ships the shards under `sharded/`, and the HF tree
  // API lists them with that prefix. The old flat-only regex missed them, so WASM
  // fp32 was wrongly pinned (surfacing as "the instance is not serving fp32")
  // even though the shards were right there. They must now be recognised.
  test('opt-in + fp32 request + shards under a sharded/ subfolder -> fp32 (not pinned)', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS_SUBFOLDER, allowWasmFp32: true });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp32', 'int8']);
    assert.equal(r.pinnedToInt8, false);
    assert.equal(quantSatisfiable({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS_SUBFOLDER, allowWasmFp32: true }), true);
  });
});

describe('isSafeRepoPath: allows the sharded/ subfolder, still blocks traversal', () => {
  test('accepts flat names and a single safe subfolder', () => {
    for (const ok of [
      'encoder-model.onnx',
      'vocab.txt',
      'sharded/encoder-model.onnx',
      'sharded/encoder-model.onnx.data.000',
      'a/b/c.onnx',
    ]) assert.equal(isSafeRepoPath(ok), true, `${ok} should be accepted`);
  });

  test('rejects traversal, absolute/empty segments, and unsafe characters', () => {
    for (const bad of [
      '', '..', '.', '../etc/passwd', 'sharded/../secret',
      '/abs/path', 'trailing/', 'a//b', './rel',
      'a\\b', 'file?x=1', 'has space.onnx', 'name#frag', 'x/..',
    ]) assert.equal(isSafeRepoPath(bad), false, `${bad} should be rejected`);
  });
});

describe('parseEncoderShards: normalises flat and sharded/ layouts', () => {
  test('flat basenames (local mirror layout) -> basenames, no subdir', () => {
    const { shards, subdir } = parseEncoderShards(WITH_FP32_SHARDS);
    assert.deepEqual(shards, ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001']);
    assert.equal(subdir, '');
  });

  test('sharded/ subfolder (HF tree layout) -> basenames + sharded/ subdir', () => {
    const { shards, subdir } = parseEncoderShards(WITH_FP32_SHARDS_SUBFOLDER);
    assert.deepEqual(shards, ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001']);
    assert.equal(subdir, 'sharded/');
  });

  test('no shards -> empty list, empty subdir (single sidecar is not a shard)', () => {
    const { shards, subdir } = parseEncoderShards(NO_FP16);
    assert.deepEqual(shards, []);
    assert.equal(subdir, '');
  });

  test('shards are returned sorted by index regardless of listing order', () => {
    const { shards } = parseEncoderShards([
      'sharded/encoder-model.onnx.data.002',
      'sharded/encoder-model.onnx.data.000',
      'sharded/encoder-model.onnx.data.001',
    ]);
    assert.deepEqual(shards, ['encoder-model.onnx.data.000', 'encoder-model.onnx.data.001', 'encoder-model.onnx.data.002']);
  });
});

describe('resolveModelQuant: WASM int8-lite opt-in', () => {
  test('int8-lite request + lite shipped -> int8-lite encoder, int8 decoder, not pinned', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'int8-lite', decoderQuant: 'int8', repoFiles: WITH_LITE });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8-lite', 'int8']);
    assert.equal(r.pinnedToInt8, false);
  });

  test('int8-lite request but NO lite file shipped -> int8 pin (no silent downgrade)', () => {
    // Like a missing fp32 shard set, an absent lite build pins so getParakeetModel
    // throws QuantUnavailableError rather than quietly loading the default int8.
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'int8-lite', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
    assert.equal(r.pinnedToInt8, true);
  });

  test('quantSatisfiable: int8-lite is satisfiable iff the source ships the lite file', () => {
    const args = { backend: 'wasm', encoderQuant: 'int8-lite', decoderQuant: 'int8' };
    assert.equal(quantSatisfiable({ ...args, repoFiles: WITH_LITE }), true);
    assert.equal(quantSatisfiable({ ...args, repoFiles: WITH_FP32_SHARDS }), false, 'no lite file -> not satisfiable');
  });

  test('int8-lite on WebGPU is treated like int8 (no GPU lite kernel) -> fp16 when shipped', () => {
    // The per-backend picker never sends int8-lite to WebGPU, but defend in depth:
    // it must NOT pass through as a (non-existent) lite GPU file.
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'int8-lite', decoderQuant: 'int8', repoFiles: WITH_FP16 });
    assert.equal(r.encoderQ, 'fp16');
    const noFp16 = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'int8-lite', decoderQuant: 'int8', repoFiles: NO_FP16 });
    assert.equal(noFp16.encoderQ, 'fp32');
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

describe('resolveModelQuant: WebGPU without shader-f16 falls back to fp32', () => {
  // Some GPU/driver/Chromium combos expose a WebGPU adapter but NOT the
  // `shader-f16` feature (verified on an RTX 3090 Ti box). fp16 kernels then
  // build but their WGSL `f16` shaders fail to compile and the transcript comes
  // back empty, so resolveModelQuant must resolve fp16 to fp32 instead.
  test('fp16 request + fp16 in repo but no shader-f16 -> fp32 encoder, int8 decoder', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: WITH_FP16, shaderF16: false });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp32', 'int8']);
  });

  test('no shader-f16 fall-back is NOT flagged for the local-mirror probe (no mirror can help)', () => {
    // canF16=false means fp32 is the best the GPU can do; flagging it would trip
    // a pointless local-upgrade probe for an fp16 file that could never run here.
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: WITH_FP16, shaderF16: false });
    assert.equal(r.encoderFellBackToFp32, false);
  });

  test('legacy int8 request without shader-f16 -> fp32 encoder', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: WITH_FP16, shaderF16: false });
    assert.equal(r.encoderQ, 'fp32');
  });

  test('explicit fp32 request without shader-f16 -> fp32 (fp32 needs no shader-f16)', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP16, shaderF16: false });
    assert.equal(r.encoderQ, 'fp32');
    assert.equal(r.encoderFellBackToFp32, false);
  });

  test('shader-f16 unknown (omitted/null) assumes supported -> fp16 when shipped (historical behaviour)', () => {
    const omitted = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: WITH_FP16 });
    assert.equal(omitted.encoderQ, 'fp16');
    const nullish = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: WITH_FP16, shaderF16: null });
    assert.equal(nullish.encoderQ, 'fp16');
  });

  test('shader-f16 present -> fp16 when shipped (unchanged)', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: WITH_FP16, shaderF16: true });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp16', 'fp16']);
  });

  test('quantSatisfiable: no fp16->fp32 downgrade to chase on a no-shader-f16 GPU', () => {
    // The mirror ships fp16 but the GPU cannot run it; fp32 is the resolved and
    // correct result, so the request is "satisfied" (no downgrade) and the UI
    // must not needlessly switch sources hunting an fp16 file it can't use.
    assert.equal(quantSatisfiable({ backend: 'webgpu', encoderQuant: 'fp16', decoderQuant: 'fp16', repoFiles: WITH_FP16, shaderF16: false }), true);
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
