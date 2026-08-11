// Tier-1 unit test for executionProvidersFor() (app/src/parakeet.js), the
// single source of the ORT executionProviders shape shared by fromUrls and
// encoderOnlyFromUrls, plus encoderOnlyFromUrls' backend guard. The helper
// exists so the WebGPU encode worker's encoder-only session can never drift
// from the main-thread session's EP list; these tests pin that shape.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ParakeetModel, executionProvidersFor } from '../../app/src/parakeet.js';

const WEBGPU_EP = { name: 'webgpu', deviceType: 'gpu', powerPreference: 'high-performance' };

describe('executionProvidersFor', () => {
  test('webgpu-hybrid is the webgpu EP with a wasm fallback', () => {
    assert.deepEqual(executionProvidersFor('webgpu-hybrid'), [WEBGPU_EP, 'wasm']);
  });

  test('webgpu-strict is the webgpu EP alone', () => {
    assert.deepEqual(executionProvidersFor('webgpu-strict'), [WEBGPU_EP]);
  });

  test('wasm is the plain wasm EP', () => {
    assert.deepEqual(executionProvidersFor('wasm'), ['wasm']);
  });

  test('unknown backends yield an empty list (callers must treat it as unsupported)', () => {
    for (const bad of ['cuda', 'webgpu', '', undefined, null]) {
      assert.deepEqual(executionProvidersFor(bad), [], `backend ${String(bad)}`);
    }
  });
});

describe('encoderOnlyFromUrls backend guard', () => {
  // Both guards fire before any ORT init, so no ONNX runtime is needed here.
  test('rejects an unsupported backend before touching ORT', async () => {
    await assert.rejects(
      ParakeetModel.encoderOnlyFromUrls({ encoderUrl: 'blob:fake', backend: 'cuda' }),
      /unsupported backend 'cuda'/,
    );
  });

  test('rejects a missing encoderUrl', async () => {
    await assert.rejects(
      ParakeetModel.encoderOnlyFromUrls({ backend: 'wasm' }),
      /requires encoderUrl/,
    );
  });
});
