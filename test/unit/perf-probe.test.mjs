// Unit tests for the first-load performance probe's pure policy
// (app/ui/src/lib/perfProbe.js): the backend decision, the stored-verdict
// validity rules and the auto-run gate.
//
// The decision is safety-critical in one direction only: recommending WebGPU
// wrongly costs the visitor a 2.4 GB download and (historically) a 15x
// slowdown, while staying on WASM only ever leaves speed on the table. Every
// degenerate-input case below therefore pins 'wasm'.
//
// Written with the help of Claude Code.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  pickBackendFromProbe,
  verdictStillValid,
  shouldAutoProbe,
  buildVerdict,
  planTimedRuns,
  median,
  PROBE_MARGIN,
  PROBE_VERDICT_MAX_AGE_MS,
  PROBE_TIMED_RUNS,
  PROBE_MIN_TIMED_RUNS,
  PROBE_SLOW_RUN_MS,
} from '../../app/ui/src/lib/perfProbe.js';

describe('median', () => {
  test('odd and even lengths, ignoring non-finite samples', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(median([2, NaN, 4]), 3);
    assert.ok(Number.isNaN(median([])));
  });
});

describe('planTimedRuns: keep the probe near a second on any machine', () => {
  test('fast hardware takes the full sample count', () => {
    assert.equal(planTimedRuns(20), PROBE_TIMED_RUNS);
    assert.equal(planTimedRuns(PROBE_SLOW_RUN_MS), PROBE_TIMED_RUNS);
  });

  test('slow hardware takes fewer samples rather than waiting longer', () => {
    assert.equal(planTimedRuns(PROBE_SLOW_RUN_MS + 1), PROBE_MIN_TIMED_RUNS);
    assert.equal(planTimedRuns(5000), PROBE_MIN_TIMED_RUNS);
  });

  test('an unusable warmup timing falls back to the full count', () => {
    assert.equal(planTimedRuns(NaN), PROBE_TIMED_RUNS);
    assert.equal(planTimedRuns(0), PROBE_TIMED_RUNS);
    assert.equal(planTimedRuns(undefined), PROBE_TIMED_RUNS);
  });
});

describe('pickBackendFromProbe: backend decision', () => {
  test('a decisive GPU win switches the backend', () => {
    // The reference box's ground truth: WASM int8 ~102 s vs WebGPU fp32 ~19 s
    // end to end on a 390 s clip (2026-08-20), i.e. ~5.4x.
    const out = pickBackendFromProbe({ wasmMs: 54, gpuMs: 10 });
    assert.equal(out.backend, 'webgpu-hybrid');
    assert.equal(out.reason, null);
    assert.equal(out.speedup, 5.4);
  });

  test('a GPU that only edges ahead is not worth the bigger download', () => {
    const out = pickBackendFromProbe({ wasmMs: 30, gpuMs: 20 });
    assert.equal(out.backend, 'wasm');
    assert.equal(out.reason, 'below-margin');
    assert.equal(out.speedup, 1.5);
  });

  test('exactly at the margin counts as a win (>=, not >)', () => {
    const out = pickBackendFromProbe({ wasmMs: 2 * PROBE_MARGIN, gpuMs: 2 });
    assert.equal(out.backend, 'webgpu-hybrid');
  });

  test('a slower GPU keeps WASM', () => {
    // This is the case the app shipped an app-wide WebGPU disable for in July
    // 2026; the probe must reach the same verdict on such a machine by itself.
    const out = pickBackendFromProbe({ wasmMs: 10, gpuMs: 150 });
    assert.equal(out.backend, 'wasm');
    assert.equal(out.reason, 'below-margin');
  });

  test('a failed or skipped GPU arm passes its reason through and stays on WASM', () => {
    for (const reason of ['no-adapter', 'session-failed', 'disabled', 'worker-error']) {
      const out = pickBackendFromProbe({ wasmMs: 50, gpuMs: NaN, gpuReason: reason });
      assert.equal(out.backend, 'wasm');
      assert.equal(out.reason, reason);
      assert.equal(out.speedup, null);
    }
  });

  test('degenerate timings never recommend the GPU', () => {
    const bad = [
      { wasmMs: NaN, gpuMs: 5 },
      { wasmMs: 50, gpuMs: NaN },
      { wasmMs: 0, gpuMs: 5 },
      { wasmMs: 50, gpuMs: 0 },
      { wasmMs: -1, gpuMs: 5 },
      {},
    ];
    for (const args of bad) {
      const out = pickBackendFromProbe(args);
      assert.equal(out.backend, 'wasm', `expected wasm for ${JSON.stringify(args)}`);
      assert.equal(out.reason, 'bad-timings');
    }
  });

  test('the margin is overridable for tuning without touching the rule', () => {
    assert.equal(pickBackendFromProbe({ wasmMs: 30, gpuMs: 20, margin: 1.2 }).backend, 'webgpu-hybrid');
  });
});

describe('verdictStillValid: when a stored verdict must be re-measured', () => {
  const base = {
    backend: 'webgpu-hybrid', speedup: 5.4, reason: null,
    wasmMs: 54, gpuMs: 10, appVersion: '9.9.0', adapter: 'nvidia ampere', at: 1_000_000,
  };
  const env = { appVersion: '9.9.0', adapter: 'nvidia ampere', at: 1_000_000 + 1000 };

  test('a fresh matching verdict is reused', () => {
    assert.equal(verdictStillValid(base, env), true);
  });

  test('an app update re-probes (new ORT/kernels can move the arms)', () => {
    assert.equal(verdictStillValid(base, { ...env, appVersion: '9.10.0' }), false);
  });

  test('a different GPU re-probes', () => {
    assert.equal(verdictStillValid(base, { ...env, adapter: 'intel xe' }), false);
    // Losing the adapter entirely (GPU gone / WebGPU switched off) also counts.
    assert.equal(verdictStillValid(base, { ...env, adapter: null }), false);
  });

  test('a WASM verdict recorded with no adapter stays valid on the same machine', () => {
    const wasmVerdict = { ...base, backend: 'wasm', adapter: null };
    assert.equal(verdictStillValid(wasmVerdict, { ...env, adapter: null }), true);
  });

  test('a stale verdict expires (driver updates change GPU speed silently)', () => {
    assert.equal(verdictStillValid(base, { ...env, at: base.at + PROBE_VERDICT_MAX_AGE_MS + 1 }), false);
  });

  test('malformed or missing verdicts are never trusted', () => {
    for (const bad of [null, undefined, 'wasm', {}, { backend: 'cuda', at: 1 }, { backend: 'wasm' }]) {
      assert.equal(verdictStillValid(bad, env), false);
    }
  });
});

describe('shouldAutoProbe: when the probe runs by itself', () => {
  const yes = {
    settingsLoaded: true, userPickedBackend: false,
    webgpuSelectable: true, hasValidVerdict: false, running: false,
  };

  test('runs on a first load with WebGPU selectable and no stored verdict', () => {
    assert.equal(shouldAutoProbe(yes), true);
  });

  test('a hand-picked backend is never overridden', () => {
    assert.equal(shouldAutoProbe({ ...yes, userPickedBackend: true }), false);
  });

  test('nothing to decide when WebGPU cannot be selected in this build', () => {
    assert.equal(shouldAutoProbe({ ...yes, webgpuSelectable: false }), false);
  });

  test('probe once per machine, not once per click', () => {
    assert.equal(shouldAutoProbe({ ...yes, hasValidVerdict: true }), false);
  });

  test('never re-entrant, never before settings are restored', () => {
    assert.equal(shouldAutoProbe({ ...yes, running: true }), false);
    assert.equal(shouldAutoProbe({ ...yes, settingsLoaded: false }), false);
    assert.equal(shouldAutoProbe({}), false);
  });
});

describe('buildVerdict', () => {
  test('carries the decision plus the evidence needed to invalidate it later', () => {
    const pick = pickBackendFromProbe({ wasmMs: 54, gpuMs: 10 });
    const v = buildVerdict({
      pick, wasmMs: 54, gpuMs: 10, appVersion: '9.9.0',
      adapter: 'nvidia ampere', at: 42, trigger: 'load',
    });
    assert.deepEqual(v, {
      backend: 'webgpu-hybrid', speedup: 5.4, reason: null,
      wasmMs: 54, gpuMs: 10, appVersion: '9.9.0',
      adapter: 'nvidia ampere', at: 42, trigger: 'load',
    });
    assert.equal(verdictStillValid(v, { appVersion: '9.9.0', adapter: 'nvidia ampere', at: 43 }), true);
  });

  test('non-finite timings are stored as null, not NaN (JSON round-trip safety)', () => {
    const pick = pickBackendFromProbe({ wasmMs: 50, gpuMs: NaN, gpuReason: 'no-adapter' });
    const v = buildVerdict({ pick, wasmMs: 50, gpuMs: NaN, appVersion: '9.9.0', adapter: null, at: 7 });
    assert.equal(v.gpuMs, null);
    assert.equal(v.wasmMs, 50);
    assert.deepEqual(JSON.parse(JSON.stringify(v)), v);
  });
});
