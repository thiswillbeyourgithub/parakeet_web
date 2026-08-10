// Unit tests for the relaxed-SIMD auto-pick micro-bench (app/ui/src/lib/
// relaxedAutoPick.js): the hand-assembled wasm kernels must be valid modules
// that actually execute, the pure pick rule must default to the auditable
// stock runtime on ties/garbage, and the end-to-end bench must produce a
// well-formed result on this engine (Node 22's V8 ships relaxed SIMD, the
// same codegen family as Chromium, so the real path is exercisable in CI).
// Written with the help of Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  plainKernelBytes,
  relaxedKernelBytes,
  pickFromTimings,
  benchRelaxedAutoPick,
  AUTO_PICK_MARGIN,
} from '../../app/ui/src/lib/relaxedAutoPick.js';
import { wasmRelaxedSimdSupported } from '../../app/ui/src/lib/supportReport.js';

test('both kernels are valid wasm modules', () => {
  assert.equal(WebAssembly.validate(plainKernelBytes()), true);
  // The relaxed kernel's validity must agree with the app's support probe:
  // ortVariant gates on that probe, so the two must never diverge on an engine.
  assert.equal(WebAssembly.validate(relaxedKernelBytes()), wasmRelaxedSimdSupported());
});

test('kernels execute and return an i32 (zero memory dots to zero)', () => {
  for (const bytes of [plainKernelBytes(), relaxedKernelBytes()]) {
    const run = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports.run;
    assert.equal(run(0), 0); // iters=0 takes the early-exit branch
    assert.equal(run(1), 0);
    assert.equal(run(37), 0);
  }
});

test('pickFromTimings needs a clear relaxed win, everything else is stock', () => {
  // 2x faster: clear win.
  assert.equal(pickFromTimings(4.0, 2.0), 'relaxed');
  // Exactly at the margin counts as a win (>=).
  assert.equal(pickFromTimings(1.1, 1.0), 'relaxed');
  // Inside the margin, equal, and slower all resolve to stock.
  assert.equal(pickFromTimings(1.05, 1.0), 'stock');
  assert.equal(pickFromTimings(1.0, 1.0), 'stock');
  assert.equal(pickFromTimings(1.0, 1.2), 'stock');
  // Custom margin is honored.
  assert.equal(pickFromTimings(1.06, 1.0, 1.05), 'relaxed');
  // Degenerate timings can never pick the non-auditable runtime.
  assert.equal(pickFromTimings(0, 1.0), 'stock');
  assert.equal(pickFromTimings(1.0, 0), 'stock');
  assert.equal(pickFromTimings(NaN, 1.0), 'stock');
  assert.equal(pickFromTimings(1.0, undefined), 'stock');
  assert.equal(AUTO_PICK_MARGIN > 1, true);
});

test('benchRelaxedAutoPick returns a well-formed verdict on this engine', () => {
  const res = benchRelaxedAutoPick({ targetMs: 1, samples: 3 });
  assert.ok(res.pick === 'relaxed' || res.pick === 'stock');
  assert.equal(res.reason, null);
  assert.ok(Number.isFinite(res.plainMs) && res.plainMs > 0);
  assert.ok(Number.isFinite(res.relaxedMs) && res.relaxedMs > 0);
  assert.ok(res.iters >= 64);
});

test('benchRelaxedAutoPick never throws without WebAssembly-level failures surfacing', () => {
  // A hostile clock must not escape as an exception; the bench downgrades to
  // stock instead (stock is always safe to run).
  const res = benchRelaxedAutoPick({ now: () => { throw new Error('boom'); } });
  assert.equal(res.pick, 'stock');
  assert.equal(res.reason, 'bench-failed');
});
