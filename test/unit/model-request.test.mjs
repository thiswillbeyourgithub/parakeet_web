// buildDownloadOpts decides what precision, and from which source, a model load
// asks for. Every assertion here is a rule that used to live inline in
// loadModel, where it could only be checked by downloading gigabytes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDownloadOpts } from '../../app/ui/src/lib/modelRequest.js';

const base = { backend: 'wasm', wasmEncoderQuant: 'int8', webgpuEncoderQuant: 'fp16' };
const build = (over = {}) => buildDownloadOpts({ ...base, ...over });

describe('buildDownloadOpts: backend split', () => {
  test('WASM takes the wasm radio, WebGPU takes the webgpu radio', () => {
    assert.equal(build().opts.encoderQuant, 'int8');
    assert.equal(build({ backend: 'webgpu-hybrid', webgpuShaderF16: true }).opts.encoderQuant, 'fp16');
  });

  test('any webgpu-prefixed backend counts as GPU', () => {
    for (const backend of ['webgpu', 'webgpu-hybrid', 'webgpu-anything']) {
      assert.equal(build({ backend }).wantWebgpu, true, backend);
    }
    assert.equal(build({ backend: 'wasm' }).wantWebgpu, false);
  });

  test('a missing backend is treated as not-GPU rather than throwing', () => {
    assert.equal(build({ backend: undefined }).wantWebgpu, false);
  });

  test('the decoder is fp32 on every backend', () => {
    assert.equal(build().opts.decoderQuant, 'fp32');
    assert.equal(build({ backend: 'webgpu-hybrid' }).opts.decoderQuant, 'fp32');
  });

  test('the backend itself travels with the request', () => {
    assert.equal(build({ backend: 'webgpu-hybrid' }).opts.backend, 'webgpu-hybrid');
  });
});

describe('buildDownloadOpts: the one GPU rewrite, and no other', () => {
  // The single substitution on the GPU side (owner decision 2026-10-22): an
  // adapter without shader-f16 cannot compile fp16, so the fp16 default is
  // requested as the GPU's int8 (649 MB), never as fp32 (a 2.35 GB download
  // nobody asked for) and never sent to be refused into a WASM flip.
  test('fp16 without shader-f16 is requested as GPU int8, not fp32', () => {
    const { opts, wantWebgpu } = build({ backend: 'webgpu-hybrid', webgpuEncoderQuant: 'fp16', webgpuShaderF16: false });
    assert.equal(wantWebgpu, true);
    assert.equal(opts.encoderQuant, 'int8');
    assert.equal(opts.shaderF16, false);
  });

  test('an adapter still being probed counts as no shader-f16', () => {
    // null is "not answered yet": an fp16 session on an adapter that turns out
    // to lack the feature builds and then transcribes silence, while int8 runs
    // on every adapter.
    for (const f16 of [null, undefined]) {
      assert.equal(build({ backend: 'webgpu-hybrid', webgpuShaderF16: f16 }).opts.encoderQuant, 'int8');
    }
  });

  test('the rewrite is GPU-only: WASM never sees the webgpu radio', () => {
    assert.equal(build({ backend: 'wasm', webgpuShaderF16: false }).opts.encoderQuant, 'int8');
    assert.equal(build({ backend: 'wasm', wasmEncoderQuant: 'w4a8', webgpuShaderF16: false }).opts.encoderQuant, 'w4a8');
  });

  test('shaderF16 is forwarded as a strict boolean', () => {
    assert.equal(build({ webgpuShaderF16: true }).opts.shaderF16, true);
    assert.equal(build({ webgpuShaderF16: undefined }).opts.shaderF16, false);
    assert.equal(build({ webgpuShaderF16: 'yes' }).opts.shaderF16, false);
  });

  test('a hand-picked GPU quant passes through untouched, with or without shader-f16', () => {
    // Only the fp16 the adapter cannot run is rewritten; a deliberate pick of
    // anything it CAN run is honoured as-is, on both kinds of adapter.
    for (const f16 of [true, false]) {
      for (const q of ['fp32', 'w4a8', 'int8']) {
        assert.equal(build({ backend: 'webgpu-hybrid', webgpuEncoderQuant: q, webgpuShaderF16: f16 }).opts.encoderQuant, q);
      }
    }
    assert.equal(build({ backend: 'webgpu-hybrid', webgpuEncoderQuant: 'fp16', webgpuShaderF16: true }).opts.encoderQuant, 'fp16');
  });

  test('allowWasmFp32 is never set on a GPU load', () => {
    assert.equal(build({ backend: 'webgpu-hybrid', webgpuEncoderQuant: 'fp32', wasmEncoderQuant: 'fp32' }).opts.allowWasmFp32, false);
  });
});

describe('buildDownloadOpts: WASM encoder request', () => {
  test('fp32 is requested with the gate that lets hub.js honour it', () => {
    const { opts, wasmEncoderRequest } = build({ wasmEncoderQuant: 'fp32' });
    assert.equal(opts.encoderQuant, 'fp32');
    assert.equal(opts.allowWasmFp32, true);
    assert.equal(wasmEncoderRequest, 'fp32');
  });

  test('w4a8 and w2a8 pass straight through, NOT collapsed to int8', () => {
    // Collapsing them would make "this repo ships no such build" indistinguishable
    // from "the user is on the default", which is the whole no-silent-downgrade
    // signal hub.js needs to raise quantUnavailable.
    for (const q of ['w4a8', 'w2a8']) {
      assert.equal(build({ wasmEncoderQuant: q }).opts.encoderQuant, q, q);
    }
  });

  test('anything else falls back to int8', () => {
    // 'int8lite' included: the retired precision must never reach hub.js.
    for (const q of ['int8', 'int8lite', 'fp16', 'nonsense', undefined, '']) {
      assert.equal(build({ wasmEncoderQuant: q }).opts.encoderQuant, 'int8', String(q));
    }
  });

  test('allowWasmFp32 is set only for the fp32 request', () => {
    for (const q of ['int8', 'w4a8', 'w2a8']) {
      assert.equal(build({ wasmEncoderQuant: q }).opts.allowWasmFp32, false, q);
    }
  });
});

describe('buildDownloadOpts: source selection', () => {
  test('a first attempt names /models as an UPGRADE base only', () => {
    const { opts } = build({ useLocalFallback: false });
    assert.equal(opts.localUpgradeBaseUrl, '/models');
    assert.equal('localFallbackBaseUrl' in opts, false);
  });

  test('a local-fallback attempt names /models as a FALLBACK base only', () => {
    const { opts } = build({ useLocalFallback: true });
    assert.equal(opts.localFallbackBaseUrl, '/models');
    assert.equal('localUpgradeBaseUrl' in opts, false);
  });

  test('the two base urls are never both present', () => {
    for (const useLocalFallback of [true, false]) {
      const { opts } = build({ useLocalFallback });
      assert.equal(Boolean(opts.localFallbackBaseUrl) && Boolean(opts.localUpgradeBaseUrl), false);
    }
  });

  test('the flat-tree allowance is forwarded to both source paths', () => {
    for (const useLocalFallback of [true, false]) {
      assert.equal(build({ useLocalFallback, allowFlatLocalFallback: true }).opts.allowFlatLocalFallback, true);
      assert.equal(build({ useLocalFallback, allowFlatLocalFallback: false }).opts.allowFlatLocalFallback, false);
    }
  });
});

describe('buildDownloadOpts: revision pin', () => {
  test('an operator override is forwarded', () => {
    assert.equal(build({ revision: 'abc123' }).opts.revision, 'abc123');
  });

  test('an absent override leaves the key off entirely', () => {
    // Not `revision: undefined`: hub.js falls back to the per-model revision in
    // models.js, and an explicit key could shadow that.
    for (const revision of [undefined, '', null]) {
      assert.equal('revision' in build({ revision }).opts, false, String(revision));
    }
  });
});

describe('buildDownloadOpts: what the caller still needs afterwards', () => {
  test('the encode pool gate (non-fp32 WASM) is derivable from the return', () => {
    const eligible = (over) => {
      const { wantWebgpu, wasmEncoderRequest } = build(over);
      return !wantWebgpu && wasmEncoderRequest !== 'fp32';
    };
    assert.equal(eligible({ wasmEncoderQuant: 'int8' }), true);
    assert.equal(eligible({ wasmEncoderQuant: 'w2a8' }), true);
    assert.equal(eligible({ wasmEncoderQuant: 'w4a8' }), true);
    assert.equal(eligible({ wasmEncoderQuant: 'fp32' }), false);
    assert.equal(eligible({ backend: 'webgpu-hybrid' }), false);
  });

  test('the preprocessor variant is passed through untouched', () => {
    assert.equal(build({ preprocessor: 'nemo80' }).opts.preprocessor, 'nemo80');
    assert.equal(build().opts.preprocessor, undefined);
  });

  test('nothing the caller attaches later is invented here', () => {
    const { opts } = build();
    assert.equal('progress' in opts, false);
    assert.equal('protectCacheKeys' in opts, false);
  });
});
