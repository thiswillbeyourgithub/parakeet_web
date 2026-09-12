// The load-failure ladder (app/ui/src/lib/loadFailure.js).
//
// Every branch here used to be reachable only by building the deployment that
// produces it: a mirror that 404s the GPU shards, a repo with no fp32 shards, a
// HuggingFace that looks unreachable but is not. Those are tier-3 specs that
// load real weights, and several combinations had no spec at all, so the
// interesting part (which retry is spent, and what happens when they all are)
// was effectively untested.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { planLoadFailure, shouldProbeLocalMirror } from '../../app/ui/src/lib/loadFailure.js';

const GIVE_UP = {
  retry: null,
  reason: null,
  switchBackendToWasm: false,
  markGpuQuantUnservable: false,
  gpuFallbackBanner: false,
  loadErrorBanner: null,
  fatal: false,
};

describe('shouldProbeLocalMirror', () => {
  test('a hub failure on a hub attempt probes the mirror', () => {
    assert.equal(shouldProbeLocalMirror({
      isHubError: true, useLocalFallback: false, localFallbackEnabled: false,
    }), true);
  });

  test('no probe when the operator already enabled local fallback: the retry '
    + 'happens either way, so the request would buy nothing', () => {
    assert.equal(shouldProbeLocalMirror({
      isHubError: true, useLocalFallback: false, localFallbackEnabled: true,
    }), false);
  });

  test('no probe when the attempt already used the mirror', () => {
    assert.equal(shouldProbeLocalMirror({
      isHubError: true, useLocalFallback: true, localFallbackEnabled: false,
    }), false);
  });

  test('no probe for a failure that is not a hub download error', () => {
    assert.equal(shouldProbeLocalMirror({
      isHubError: false, useLocalFallback: false, localFallbackEnabled: false,
    }), false);
  });
});

describe('planLoadFailure: the local-first rescue', () => {
  const base = {
    isHubError: true, useLocalFallback: true, forceLocalFallback: false,
    localFirst: true, hubRetryTried: false,
  };

  test('a load sent local-first by the reachability preflight, whose mirror '
    + 'cannot serve it, goes back to HuggingFace once', () => {
    const plan = planLoadFailure(base);
    assert.deepEqual(plan.retry, { useLocalFallback: false, hubRetryTried: true });
    assert.equal(plan.reason, 'hub-after-local-first');
  });

  test('the rescue is spent after one go, so a genuinely dead HuggingFace '
    + 'cannot ping-pong the load forever', () => {
    assert.equal(planLoadFailure({ ...base, hubRetryTried: true }).retry, null);
  });

  test('a user who PINNED local weights is not silently sent to HuggingFace', () => {
    assert.equal(planLoadFailure({ ...base, forceLocalFallback: true }).retry, null);
  });

  test('a load that chose the mirror for any other reason than the preflight '
    + 'does not get the rescue', () => {
    assert.equal(planLoadFailure({ ...base, localFirst: false }).retry, null);
  });
});

describe('planLoadFailure: retrying against the local mirror', () => {
  test('a hub failure retries locally when the operator configured fallback, '
    + 'without a probe having been made', () => {
    const plan = planLoadFailure({
      isHubError: true, useLocalFallback: false,
      localFallbackEnabled: true, localReachable: false,
    });
    assert.deepEqual(plan.retry, { useLocalFallback: true });
  });

  test('on the default hf source it retries only when a probe found the files, '
    + 'so a clear HF error is never swapped for "local folder missing"', () => {
    const cfg = { isHubError: true, useLocalFallback: false, localFallbackEnabled: false };
    assert.deepEqual(planLoadFailure({ ...cfg, localReachable: true }).retry, { useLocalFallback: true });
    assert.equal(planLoadFailure({ ...cfg, localReachable: false }).retry, null);
  });

  test('an attempt that already used the mirror never retries the mirror', () => {
    assert.equal(planLoadFailure({
      isHubError: true, useLocalFallback: true, localFallbackEnabled: true,
    }).retry, null);
  });
});

describe('planLoadFailure: an unservable quant on a GPU backend', () => {
  const base = {
    isQuantUnavailable: true, isWebgpu: true,
    allowQuantSubstitution: true, gpuQuantFallbackTried: false,
  };

  test('flips to WASM, records the unservable pair, warns, and retries', () => {
    const plan = planLoadFailure(base);
    assert.deepEqual(plan.retry, { useLocalFallback: false, gpuQuantFallbackTried: true });
    assert.equal(plan.reason, 'gpu-quant-to-wasm');
    assert.equal(plan.switchBackendToWasm, true);
    assert.equal(plan.markGpuQuantUnservable, true);
    assert.equal(plan.gpuFallbackBanner, true);
    assert.equal(plan.fatal, false);
  });

  test('the retry keeps the source the failed attempt used, so a load already '
    + 'on the mirror does not silently go back to HuggingFace', () => {
    assert.equal(planLoadFailure({ ...base, useLocalFallback: true }).retry.useLocalFallback, true);
  });

  test('the flip happens at most once per load', () => {
    const plan = planLoadFailure({ ...base, gpuQuantFallbackTried: true });
    assert.equal(plan.retry, null);
    assert.equal(plan.switchBackendToWasm, false);
    assert.equal(plan.loadErrorBanner, 'quantUnavailable');
  });

  test('the BENCHMARK forbids substitution, because a row labelled fp16 that '
    + 'carries int8 numbers is worse than a row saying "not served here"', () => {
    const plan = planLoadFailure({ ...base, allowQuantSubstitution: false });
    assert.equal(plan.retry, null);
    assert.equal(plan.switchBackendToWasm, false);
    assert.equal(plan.loadErrorBanner, 'quantUnavailable');
  });
});

describe('planLoadFailure: an unservable quant on WASM', () => {
  test('a hand-picked WASM precision gets the banner naming it, never the popup', () => {
    const plan = planLoadFailure({
      isQuantUnavailable: true, isWebgpu: false, wasmQuantIsDefault: false,
    });
    assert.equal(plan.loadErrorBanner, 'quantUnavailable');
    assert.equal(plan.fatal, false);
  });

  test('the default WASM precision gets the blocking popup and NO banner: '
    + 'there is no other precision, backend or source left to try', () => {
    const plan = planLoadFailure({
      isQuantUnavailable: true, isWebgpu: false, wasmQuantIsDefault: true,
    });
    assert.equal(plan.loadErrorBanner, null);
    assert.equal(plan.fatal, true);
  });
});

describe('planLoadFailure: giving up', () => {
  test('an unrecognised error on the default WASM configuration is fatal, not '
    + 'only an unservable quant', () => {
    assert.equal(planLoadFailure({ isWebgpu: false, wasmQuantIsDefault: true }).fatal, true);
  });

  test('an unrecognised error anywhere the visitor made a choice stays quiet: '
    + 'that choice is something they can go back and change', () => {
    assert.deepEqual(planLoadFailure({ isWebgpu: true }), GIVE_UP);
    assert.deepEqual(planLoadFailure({ isWebgpu: false, wasmQuantIsDefault: false }), GIVE_UP);
  });

  test('the banner and the popup are mutually exclusive across EVERY input '
    + 'combination: one says "change your pick", the other says there is '
    + 'nothing left to pick', () => {
    const bools = [false, true];
    for (const isHubError of bools)
      for (const isQuantUnavailable of bools)
        for (const useLocalFallback of bools)
          for (const forceLocalFallback of bools)
            for (const localFirst of bools)
              for (const hubRetryTried of bools)
                for (const localFallbackEnabled of bools)
                  for (const localReachable of bools)
                    for (const isWebgpu of bools)
                      for (const wasmQuantIsDefault of bools)
                        for (const allowQuantSubstitution of bools)
                          for (const gpuQuantFallbackTried of bools) {
                            const plan = planLoadFailure({
                              isHubError, isQuantUnavailable, useLocalFallback,
                              forceLocalFallback, localFirst, hubRetryTried,
                              localFallbackEnabled, localReachable, isWebgpu,
                              wasmQuantIsDefault, allowQuantSubstitution,
                              gpuQuantFallbackTried,
                            });
                            assert.ok(!(plan.loadErrorBanner && plan.fatal),
                              'banner and popup fired together');
                            // A retry means the load continues, so nothing may
                            // announce a final outcome alongside it.
                            if (plan.retry) {
                              assert.equal(plan.fatal, false, 'fatal alongside a retry');
                              assert.equal(plan.loadErrorBanner, null, 'banner alongside a retry');
                              assert.ok(plan.reason, 'a retry with no reason to log');
                            } else {
                              assert.equal(plan.reason, null, 'a reason with no retry');
                            }
                            // The GPU flip is the only thing that changes the
                            // backend, and it always retries.
                            if (plan.switchBackendToWasm) {
                              assert.ok(plan.retry, 'backend flipped without a retry');
                              assert.equal(plan.markGpuQuantUnservable, true);
                              assert.equal(plan.gpuFallbackBanner, true);
                            }
                          }
  });
});
