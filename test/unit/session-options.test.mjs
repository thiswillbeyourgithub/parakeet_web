// Tier-1 unit test for baseSessionOptions() / withExternalData() (app/src/parakeet.js),
// the single source of the ORT session-option contract shared by fromUrls,
// decoderOnlyFromUrls and encoderOnlyFromUrls.
//
// Why this test exists: the three factories used to spell the same option
// object out three times. encode.worker.js's own contract is that a pooled
// chunk "must run the exact same binaries as an in-thread chunk, or one clip
// could mix numerics", and three hand-maintained copies is exactly how that
// guarantee breaks: an option added to fromUrls alone would leave the two
// worker factories on the old config silently, with a healthy-looking
// transcript. These assertions pin the shape so a drift fails here first.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { baseSessionOptions, withExternalData, executionProvidersFor } from '../../app/src/parakeet.js';

describe('baseSessionOptions', () => {
  test('is the full option contract, with profiling and graph capture off by default', () => {
    assert.deepEqual(baseSessionOptions({ executionProviders: ['wasm'] }), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      executionMode: 'parallel',
      enableCpuMemArena: true,
      enableMemPattern: true,
      enableProfiling: false,
      enableGraphCapture: false,
      logSeverityLevel: 2,
    });
  });

  test('verbose only moves logSeverityLevel to 0', () => {
    const quiet = baseSessionOptions({ executionProviders: ['wasm'] });
    const loud = baseSessionOptions({ executionProviders: ['wasm'], verbose: true });
    assert.equal(quiet.logSeverityLevel, 2);
    assert.equal(loud.logSeverityLevel, 0);
    assert.deepEqual({ ...quiet, logSeverityLevel: 0 }, loud);
  });

  test('profiling and graph capture are pass-through flags', () => {
    const opts = baseSessionOptions({
      executionProviders: ['wasm'], enableProfiling: true, enableGraphCapture: true,
    });
    assert.equal(opts.enableProfiling, true);
    assert.equal(opts.enableGraphCapture, true);
  });

  test('every backend gets the SAME options but the EP list', () => {
    // This is the drift the helper exists to prevent: the three factories
    // differ only in which EPs they run on, never in the rest of the contract.
    const wasm = baseSessionOptions({ executionProviders: executionProvidersFor('wasm') });
    const gpu = baseSessionOptions({ executionProviders: executionProvidersFor('webgpu-hybrid') });
    assert.deepEqual({ ...wasm, executionProviders: null }, { ...gpu, executionProviders: null });
  });

  test('returns a fresh object every call (callers copy and mutate)', () => {
    const a = baseSessionOptions({ executionProviders: ['wasm'] });
    const b = baseSessionOptions({ executionProviders: ['wasm'] });
    assert.notEqual(a, b);
  });
});

describe('withExternalData', () => {
  const base = Object.freeze(baseSessionOptions({ executionProviders: ['wasm'] }));

  test('attaches a single-sidecar entry without mutating the input', () => {
    const out = withExternalData(base, 'https://example.invalid/enc.onnx.data', 'encoder-model.onnx');
    assert.deepEqual(out.externalData, [
      { data: 'https://example.invalid/enc.onnx.data', path: 'encoder-model.onnx.data' },
    ]);
    assert.equal(base.externalData, undefined);
    assert.deepEqual({ ...out, externalData: undefined }, { ...base, externalData: undefined });
  });

  test('passes shard entries straight through', () => {
    const shards = [
      { path: 'encoder-model.onnx.data.000', data: new Uint8Array([1]) },
      { path: 'encoder-model.onnx.data.001', data: new Uint8Array([2]) },
    ];
    assert.deepEqual(withExternalData(base, shards, 'encoder-model.onnx').externalData, shards);
  });

  test('omits externalData entirely when there is nothing to mount', () => {
    for (const source of [null, undefined, '', []]) {
      const out = withExternalData(base, source, 'encoder-model.onnx');
      assert.equal('externalData' in out, false, `source ${JSON.stringify(source)}`);
    }
  });

  test('still copies when there is no external data, so callers never share one object', () => {
    const out = withExternalData(base, null, 'encoder-model.onnx');
    assert.notEqual(out, base);
    assert.deepEqual(out, base);
  });
});
