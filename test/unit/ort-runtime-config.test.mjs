// Tier-1 unit test for ortRuntimeConfig() in scripts/transcribe.mjs: the pure
// mapping from an --ort backend to (a) whether the ORT session is built from a
// file PATH (native bindings stream external .data from disk, dodging the >2 GB
// Buffer wall) and (b) its executionProviders list.
//
// The behaviour this pins: the benchmark CLIs (wer-bench.mjs,
// grid_search_benchmark.mjs) default to CPU (wasm/node) and only touch the GPU
// when explicitly asked via --cuda / --ort cuda. The 'cuda' backend must use the
// native binding (fromPath) and request the CUDA EP with a 'cpu' fallback so a
// box without a usable CUDA/cuDNN install degrades to CPU instead of failing.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ortRuntimeConfig } from '../../scripts/transcribe.mjs';

describe('ortRuntimeConfig: ORT backend -> EP / from-path mapping', () => {
  test('wasm uses the WASM EP and loads from a Buffer (not a path)', () => {
    assert.deepEqual(ortRuntimeConfig('wasm'), {
      fromPath: false,
      executionProviders: ['wasm'],
    });
  });

  test('node uses the native binding (fromPath) on the CPU EP', () => {
    assert.deepEqual(ortRuntimeConfig('node'), {
      fromPath: true,
      executionProviders: ['cpu'],
    });
  });

  test('cuda uses the native binding (fromPath) on the CUDA EP with a CPU fallback', () => {
    const cfg = ortRuntimeConfig('cuda');
    assert.equal(cfg.fromPath, true);
    // CUDA must be FIRST (ORT tries providers in order) and CPU last so the load
    // degrades to CPU on a box without a working CUDA/cuDNN install.
    assert.deepEqual(cfg.executionProviders, ['cuda', 'cpu']);
  });

  test('an unknown backend throws and names the accepted values', () => {
    assert.throws(() => ortRuntimeConfig('rocm'), (e) => {
      assert.match(e.message, /Unknown ort backend "rocm"/);
      assert.match(e.message, /wasm, node or cuda/);
      return true;
    });
  });
});
