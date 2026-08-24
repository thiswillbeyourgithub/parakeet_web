// Tier-1 unit test for resolveModelQuant (app/src/hub.js): the pure decision
// that picks the encoder/decoder quantisation per backend and per what the repo
// ships. It encodes two hard rules: WASM is pinned to int8 (a single 2.4 GB
// fp32 sidecar overflows the 32-bit WASM heap and the browser's blob caps), and
// WebGPU always runs the fp32 encoder (the GPU EP has no int8 encoder kernel),
// which in turn REQUIRES the <2 GB shards on both backends.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelQuant, quantSatisfiable, parseEncoderShards, isSafeRepoPath } from '../../app/src/hub.js';

// A repo shipping only the flat, unsharded layout: int8 plus the single-file
// fp32 encoder and its 2.3 GB sidecar. With no shard set, fp32 cannot load in a
// browser on EITHER backend (this is the upstream istupakov file set).
const NO_SHARDS = ['encoder-model.int8.onnx', 'encoder-model.onnx', 'encoder-model.onnx.data', 'decoder_joint-model.int8.onnx'];
// A repo that ships the fp32 encoder as <2GB shards (parakeet-tdt-0.6b-v3-optimized-onnx/scripts/shard-fp32.py).
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
// A repo still serving the withdrawn `.optimized` filenames (that graph now
// ships under the canonical name): they are NOT a loadable fp32 layout, because
// nothing looks for them any more.
const WITH_WITHDRAWN_OPTIMIZED_NAMES_ONLY = [
  'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
  'sharded/encoder-model.optimized.onnx',
  'sharded/encoder-model.optimized.onnx.data.000', 'sharded/encoder-model.optimized.onnx.data.001',
];

describe('resolveModelQuant: WASM is pinned to int8', () => {
  for (const backend of ['wasm']) {
    test(`${backend} with int8 request -> int8/int8, not pinned-warned`, () => {
      const r = resolveModelQuant({ backend, encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: NO_SHARDS });
      assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
      assert.equal(r.pinnedToInt8, false);
    });

    test(`${backend} with fp32 request is forced to int8 and flagged`, () => {
      const r = resolveModelQuant({ backend, encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: NO_SHARDS });
      assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
      assert.equal(r.pinnedToInt8, true);
    });

    test(`${backend} with an fp32 DECODER request is forced to int8 and flagged`, () => {
      const r = resolveModelQuant({ backend, encoderQuant: 'int8', decoderQuant: 'fp32', repoFiles: NO_SHARDS });
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
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: NO_SHARDS, allowWasmFp32: true });
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

  // There is ONE fp32 shard set now, under the canonical name. A source still
  // serving the withdrawn `.optimized` shard names ships nothing this code can
  // load, so fp32 must be refused exactly as if it had no shards at all: pinned
  // to int8 on WASM, flagged needs-shards on WebGPU. Silently accepting the old
  // names would be worse than refusing, since the download loop would then ask
  // for a canonical graph the source does not have.
  test('a source serving ONLY the withdrawn .optimized shard names does not satisfy fp32', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_WITHDRAWN_OPTIMIZED_NAMES_ONLY, allowWasmFp32: true });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
    assert.equal(r.pinnedToInt8, true);
    assert.equal(quantSatisfiable({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_WITHDRAWN_OPTIMIZED_NAMES_ONLY, allowWasmFp32: true }), false);
    const g = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_WITHDRAWN_OPTIMIZED_NAMES_ONLY });
    assert.equal(g.webgpuFp32NeedsShards, true, 'the withdrawn shard names are not a loadable fp32 layout');
    assert.equal(quantSatisfiable({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_WITHDRAWN_OPTIMIZED_NAMES_ONLY }), false);
  });

  // Regression: both opt-in encoder branches return EARLY, so the decoder check
  // has to happen before them. It used to sit only on the fallthrough, which
  // meant an fp32 DECODER request paired with an encoder choice that succeeded
  // came back pinnedToInt8:false: a downgrade (there is no fp32 decoder)
  // reported as fully honoured, so no banner and no /models upgrade probe.
  test('an fp32 DECODER request pins even when the fp32 ENCODER opt-in would succeed', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'fp32', repoFiles: WITH_FP32_SHARDS, allowWasmFp32: true });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
    assert.equal(r.pinnedToInt8, true);
    assert.equal(quantSatisfiable({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'fp32', repoFiles: WITH_FP32_SHARDS, allowWasmFp32: true }), false);
  });

  test('opt-in + fp32 request + the flat sidecar but NO shard set -> int8 pin', () => {
    const flatOnly = ['encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx', 'encoder-model.onnx', 'encoder-model.onnx.data'];
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: flatOnly, allowWasmFp32: true });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
    assert.equal(r.pinnedToInt8, true);
    const g = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: flatOnly });
    assert.equal(g.webgpuFp32NeedsShards, true, 'a flat >2 GB sidecar is unloadable on either browser backend');
  });
});

// The lite int8 encoder is the same SmoothQuant recipe with 11 fp32 MatMuls
// kept instead of 18: one extra file, no sidecar and no shards, so the only
// question is whether the source ships it. Only the model repo builds it, and
// the crucial rule is that a source WITHOUT it must not quietly serve the
// heavier default int8: it pins (which routes through the /models upgrade probe
// and then QuantUnavailableError), exactly like a missing fp32 shard set.
describe('resolveModelQuant: WASM lite-int8 opt-in', () => {
  const WITH_LITE = [
    'encoder-model.int8.onnx', 'encoder-model.int8.lite.onnx', 'decoder_joint-model.int8.onnx',
  ];
  const WITH_LITE_SUBFOLDER = [
    'encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx',
    'sub/encoder-model.int8.lite.onnx',
  ];

  test('int8lite request + the lite encoder shipped -> lite encoder, int8 decoder, not pinned', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'int8lite', decoderQuant: 'int8', repoFiles: WITH_LITE });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8lite', 'int8']);
    assert.equal(r.pinnedToInt8, false);
    assert.equal(quantSatisfiable({ backend: 'wasm', encoderQuant: 'int8lite', decoderQuant: 'int8', repoFiles: WITH_LITE }), true);
  });

  test('int8lite request but NO lite encoder -> int8 pin, never a silent downgrade', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'int8lite', decoderQuant: 'int8', repoFiles: NO_SHARDS });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
    assert.equal(r.pinnedToInt8, true, 'a source with no lite build must surface, not swap in the heavier int8');
    assert.equal(quantSatisfiable({ backend: 'wasm', encoderQuant: 'int8lite', decoderQuant: 'int8', repoFiles: NO_SHARDS }), false);
  });

  test('the lite encoder is found under a subfolder too (HF tree API returns full paths)', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'int8lite', decoderQuant: 'int8', repoFiles: WITH_LITE_SUBFOLDER });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8lite', 'int8']);
    assert.equal(r.pinnedToInt8, false);
  });

  // A near-miss name must not be mistaken for the lite build: the download loop
  // would then ask for a file the source does not have.
  test('a lookalike filename does not count as the lite encoder', () => {
    const lookalike = ['encoder-model.int8.onnx', 'decoder_joint-model.int8.onnx', 'encoder-model.int8.lite.onnx.bak', 'xencoder-model.int8.lite.onnx'];
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'int8lite', decoderQuant: 'int8', repoFiles: lookalike });
    assert.equal(r.pinnedToInt8, true);
  });

  test('an int8lite request never drags in the fp32 shards, and fp32 never picks up lite', () => {
    const both = [...WITH_FP32_SHARDS, 'encoder-model.int8.lite.onnx'];
    const lite = resolveModelQuant({ backend: 'wasm', encoderQuant: 'int8lite', decoderQuant: 'int8', repoFiles: both, allowWasmFp32: true });
    assert.deepEqual([lite.encoderQ, lite.decoderQ], ['int8lite', 'int8']);
    const fp32 = resolveModelQuant({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: both, allowWasmFp32: true });
    assert.deepEqual([fp32.encoderQ, fp32.decoderQ], ['fp32', 'int8']);
  });

  test('an fp32 DECODER request still pins, even with the lite encoder present', () => {
    const r = resolveModelQuant({ backend: 'wasm', encoderQuant: 'int8lite', decoderQuant: 'fp32', repoFiles: WITH_LITE });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['int8', 'int8']);
    assert.equal(r.pinnedToInt8, true);
  });

  // The GPU EP has no int8 encoder kernel at all, so the lite build is as
  // unrunnable there as the default int8: both must resolve to fp32.
  for (const backend of ['webgpu', 'webgpu-hybrid']) {
    test(`${backend} resolves an int8lite request to fp32, exactly like int8`, () => {
      const r = resolveModelQuant({ backend, encoderQuant: 'int8lite', decoderQuant: 'int8', repoFiles: [...WITH_FP32_SHARDS, 'encoder-model.int8.lite.onnx'] });
      assert.deepEqual([r.encoderQ, r.decoderQ], ['fp32', 'int8']);
      assert.equal(r.pinnedToInt8, false);
      assert.equal(r.webgpuFp32NeedsShards, false);
    });

    test(`${backend} still demands the shards for an int8lite request`, () => {
      const r = resolveModelQuant({ backend, encoderQuant: 'int8lite', decoderQuant: 'int8', repoFiles: WITH_LITE });
      assert.equal(r.encoderQ, 'fp32');
      assert.equal(r.webgpuFp32NeedsShards, true, 'shipping a lite int8 encoder does nothing for the GPU path');
      assert.equal(quantSatisfiable({ backend, encoderQuant: 'int8lite', decoderQuant: 'int8', repoFiles: WITH_LITE }), false);
    });
  }
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
    const { shards, subdir } = parseEncoderShards(NO_SHARDS);
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

describe('resolveModelQuant: WebGPU always resolves the encoder to fp32', () => {
  // The GPU EP has no int8 encoder kernel, and the fp16 build the model repo
  // shipped until 2026-08-23 was withdrawn (its WGSL kernels need the adapter's
  // `shader-f16` feature, unavailable on the GPU box, so it could never be
  // exercised end to end). fp32 is therefore the only encoder precision left on
  // WebGPU, which makes the shard requirement below the whole decision.
  test('int8 request -> fp32 encoder, int8 decoder', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp32', 'int8']);
  });

  test('webgpu-hybrid is treated as WebGPU', () => {
    const r = resolveModelQuant({ backend: 'webgpu-hybrid', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp32', 'int8']);
  });

  test('explicit fp32 request -> fp32 encoder, int8 decoder', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS });
    assert.deepEqual([r.encoderQ, r.decoderQ], ['fp32', 'int8']);
  });

  // The decoder is int8 on every path: on this model the int8 joiner is as
  // accurate as fp32 (measured) while being smaller and faster, and the GPU EP
  // runs it fine. An fp32 decoder request must NOT drag the tiny decoder up.
  test('an fp32 DECODER request is ignored; the decoder stays int8', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'fp32', repoFiles: WITH_FP32_SHARDS });
    assert.equal(r.decoderQ, 'int8');
  });

  // WebGPU never pins to int8: pinnedToInt8 is the WASM-only signal, and a GPU
  // load that cannot proceed is reported through webgpuFp32NeedsShards instead.
  test('pinnedToInt8 is never set on WebGPU, even with no shards', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: NO_SHARDS });
    assert.equal(r.pinnedToInt8, false);
    assert.equal(r.webgpuFp32NeedsShards, true);
  });
});

describe('resolveModelQuant: WebGPU fp32 REQUIRES the shards', () => {
  // A single-file 2.3 GB fp32 encoder cannot load on WebGPU either: it exceeds
  // both Chromium's ~2 GB IndexedDB Blob-readback wall and V8's ArrayBuffer cap
  // (verified on a real GPU box). So the shard requirement is not a WASM
  // peculiarity, it applies to the GPU path identically.
  test('no shards -> webgpuFp32NeedsShards, and not satisfiable', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: NO_SHARDS });
    assert.equal(r.encoderQ, 'fp32');
    assert.equal(r.webgpuFp32NeedsShards, true);
    assert.equal(quantSatisfiable({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: NO_SHARDS }), false);
  });

  test('shards present -> loadable, and satisfiable', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS });
    assert.equal(r.webgpuFp32NeedsShards, false);
    assert.equal(quantSatisfiable({ backend: 'webgpu', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS }), true);
  });

  test('shards under a sharded/ subfolder (how the model repo ships them) also clear it', () => {
    const r = resolveModelQuant({ backend: 'webgpu', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS_SUBFOLDER });
    assert.equal(r.webgpuFp32NeedsShards, false);
  });

  // An int8 request is the common case since it is the app's default: the
  // visitor never asked for fp32, so a shard-less source must still be reported
  // as unservable rather than silently attempting a load that dies inside ORT.
  test('an int8 request on a shard-less source is also flagged (the probe never asked for fp32)', () => {
    assert.equal(quantSatisfiable({ backend: 'webgpu', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: NO_SHARDS }), false);
  });
});

// quantSatisfiable(fileSet) = "this source can deliver the requested quant with
// NO downgrade". The UI calls it on a local /models mirror to decide whether to
// reload from there when HuggingFace could not serve the requested precision.
describe('quantSatisfiable: can a file set deliver the requested quant?', () => {
  test('WASM fp32 opt-in is satisfiable iff the source ships the shards', () => {
    const args = { backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', allowWasmFp32: true };
    assert.equal(quantSatisfiable({ ...args, repoFiles: WITH_FP32_SHARDS }), true);
    assert.equal(quantSatisfiable({ ...args, repoFiles: NO_SHARDS }), false, 'single 2.4 GB sidecar cannot load on WASM');
  });

  test('WASM int8 is always satisfiable', () => {
    assert.equal(quantSatisfiable({ backend: 'wasm', encoderQuant: 'int8', decoderQuant: 'int8', repoFiles: NO_SHARDS }), true);
  });

  test('WASM fp32 without the opt-in is NOT satisfiable even with shards (stays pinned)', () => {
    assert.equal(quantSatisfiable({ backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', repoFiles: WITH_FP32_SHARDS }), false);
  });

  test('WebGPU is satisfiable iff the source ships an fp32 shard set', () => {
    const args = { backend: 'webgpu', encoderQuant: 'int8', decoderQuant: 'int8' };
    assert.equal(quantSatisfiable({ ...args, repoFiles: WITH_FP32_SHARDS }), true);
    assert.equal(quantSatisfiable({ ...args, repoFiles: NO_SHARDS }), false, 'a flat 2.3 GB fp32 encoder cannot load on WebGPU either');
  });
});

// The UI's "requested quant not on HF but the local mirror has it" decision is
// exactly: HF downgraded AND the local file set is quantSatisfiable. These pin
// the two real cases the feature exists for.
describe('local /models fallback decision (HF downgraded + local can satisfy)', () => {
  test('WASM fp32: HF (no shards) pins to int8, local (shards) satisfies -> prefer local', () => {
    const req = { backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', allowWasmFp32: true };
    const hf = resolveModelQuant({ ...req, repoFiles: NO_SHARDS });
    assert.equal(hf.pinnedToInt8, true, 'HF could not satisfy fp32');
    assert.equal(quantSatisfiable({ ...req, repoFiles: WITH_FP32_SHARDS }), true, 'local can');
  });

  test('WebGPU: HF (no shards) cannot load, local (shards) satisfies -> prefer local', () => {
    const req = { backend: 'webgpu', encoderQuant: 'int8', decoderQuant: 'int8' };
    const hf = resolveModelQuant({ ...req, repoFiles: NO_SHARDS });
    assert.equal(hf.webgpuFp32NeedsShards, true, 'HF ships no loadable fp32 layout');
    assert.equal(quantSatisfiable({ ...req, repoFiles: WITH_FP32_SHARDS }), true, 'local can');
  });

  test('no local upgrade when local also lacks the files (no needless reload)', () => {
    const req = { backend: 'wasm', encoderQuant: 'fp32', decoderQuant: 'int8', allowWasmFp32: true };
    assert.equal(quantSatisfiable({ ...req, repoFiles: NO_SHARDS }), false, 'local without shards cannot satisfy either');
  });
});
