// Tier-1 unit test for ortRuntimeConfig() in scripts/transcribe.mjs: the pure
// mapping from an --ort backend to (a) whether the ORT session is built from a
// file PATH (native bindings stream external .data from disk, dodging the >2 GB
// Buffer wall) and (b) its executionProviders list.
//
// The behaviour this pins: the benchmark CLIs (wer-bench.mjs,
// grid_search_benchmark.mjs) default to CPU (wasm/node) and only touch the GPU
// when explicitly asked via --cuda / --ort cuda. The 'cuda' backend must use the
// native binding (fromPath) and request the CUDA EP first, then 'cpu' for op
// coverage (ops the CUDA EP lacks run on CPU). NOTE: that trailing 'cpu' does
// NOT mask a broken GPU stack: if the CUDA provider library can't load, ORT
// throws at session creation (verified), so a real GPU run is confirmed by VRAM
// use, not by the EP list alone.
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ortRuntimeConfig, sessionOptionsFor } from '../../scripts/transcribe.mjs';

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

  test('cuda uses the native binding (fromPath) on the CUDA EP, CPU for op coverage', () => {
    const cfg = ortRuntimeConfig('cuda');
    assert.equal(cfg.fromPath, true);
    // CUDA must be FIRST (ORT tries providers in order); CPU follows for ops the
    // CUDA EP doesn't implement. (It does not rescue a failed CUDA library load.)
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

describe('sessionOptionsFor: --threads reaches the right knob per backend', () => {
  // WASM threads are a GLOBAL (ort.env.wasm.numThreads), set by the caller;
  // putting intraOpNumThreads in the session options there would be noise.
  test('wasm never gets intraOpNumThreads', () => {
    const opts = sessionOptionsFor({ executionProviders: ['wasm'], threads: 4, ortBackend: 'wasm' });
    assert.equal('intraOpNumThreads' in opts, false);
    assert.deepEqual(opts.executionProviders, ['wasm']);
  });

  // The native EPs size their pool from the HOST core count, which a container
  // CPU quota does not change: 12 threads sharing 4 CPUs is slower than 4.
  test('node/cuda bound their intra-op pool to --threads', () => {
    assert.equal(sessionOptionsFor({ executionProviders: ['cpu'], threads: 4, ortBackend: 'node' }).intraOpNumThreads, 4);
    assert.equal(sessionOptionsFor({ executionProviders: ['cuda', 'cpu'], threads: 2, ortBackend: 'cuda' }).intraOpNumThreads, 2);
  });

  test('threads 0 keeps the ORT default (right on bare metal)', () => {
    assert.equal('intraOpNumThreads' in sessionOptionsFor({ executionProviders: ['cpu'], threads: 0, ortBackend: 'node' }), false);
    assert.equal('intraOpNumThreads' in sessionOptionsFor({ executionProviders: ['cpu'], ortBackend: 'node' }), false);
  });

  test('verbose picks the noisy log severity, quiet the terse one', () => {
    assert.equal(sessionOptionsFor({ executionProviders: ['cpu'], verbose: true }).logSeverityLevel, 0);
    assert.equal(sessionOptionsFor({ executionProviders: ['cpu'] }).logSeverityLevel, 3);
  });
});
