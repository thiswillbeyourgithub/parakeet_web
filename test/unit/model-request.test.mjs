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
    assert.equal(build({ backend: 'webgpu-hybrid' }).opts.encoderQuant, 'fp16');
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

  test('the decoder is int8 on every backend', () => {
    assert.equal(build().opts.decoderQuant, 'int8');
    assert.equal(build({ backend: 'webgpu-hybrid' }).opts.decoderQuant, 'int8');
  });

  test('the backend itself travels with the request', () => {
    assert.equal(build({ backend: 'webgpu-hybrid' }).opts.backend, 'webgpu-hybrid');
  });
});

describe('buildDownloadOpts: no silent rewriting of the GPU request', () => {
  // The rule that matters: the app substitutes nothing on the GPU side. An
  // unhonourable fp16 must reach hub.js as fp16 so it can be REFUSED (which is
  // what raises the banner / triggers the GPU-to-WASM flip), not degraded here
  // into a 2.35 GB fp32 download nobody asked for.
  test('fp16 stays fp16 even without shader-f16', () => {
    const { opts } = build({ backend: 'webgpu-hybrid', webgpuEncoderQuant: 'fp16', webgpuShaderF16: false });
    assert.equal(opts.encoderQuant, 'fp16');
    assert.equal(opts.shaderF16, false);
  });

  test('shaderF16 is forwarded as a strict boolean', () => {
    assert.equal(build({ webgpuShaderF16: true }).opts.shaderF16, true);
    assert.equal(build({ webgpuShaderF16: undefined }).opts.shaderF16, false);
    assert.equal(build({ webgpuShaderF16: 'yes' }).opts.shaderF16, false);
  });

  test('a hand-picked GPU quant passes through untouched', () => {
    for (const q of ['fp32', 'w4a8', 'fp16']) {
      assert.equal(build({ backend: 'webgpu-hybrid', webgpuEncoderQuant: q }).opts.encoderQuant, q);
    }
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

  test('int8lite and w4a8 pass straight through, NOT collapsed to int8', () => {
    // Collapsing them would make "this repo ships no such build" indistinguishable
    // from "the user is on the default", which is the whole no-silent-downgrade
    // signal hub.js needs to raise quantUnavailable.
    for (const q of ['int8lite', 'w4a8']) {
      assert.equal(build({ wasmEncoderQuant: q }).opts.encoderQuant, q, q);
    }
  });

  test('anything else falls back to int8', () => {
    for (const q of ['int8', 'fp16', 'nonsense', undefined, '']) {
      assert.equal(build({ wasmEncoderQuant: q }).opts.encoderQuant, 'int8', String(q));
    }
  });

  test('allowWasmFp32 is set only for the fp32 request', () => {
    for (const q of ['int8', 'int8lite', 'w4a8']) {
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
    assert.equal(eligible({ wasmEncoderQuant: 'int8lite' }), true);
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
