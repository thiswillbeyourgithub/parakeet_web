// Unit tests for the pure ORT runtime-variant gate (app/ui/src/lib/
// ortVariant.js): the opt-in Relaxed-SIMD build may only engage when the user
// opted in AND the engine supports the feature AND the deployment actually
// ships /ort-relaxed/ AND the backend is pure WASM; every other combination
// must resolve to the stock runtime with a reason, never a throw. Also pins
// the consistency between wasmRelaxedSimdSupported (the App-side gate) and
// the support report's relaxedSimd probe, since ortVariant trusts the former.
// Written with the help of Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOrtVariant, ORT_STOCK_BASE, ORT_RELAXED_BASE } from '../../app/ui/src/lib/ortVariant.js';
import { wasmRelaxedSimdSupported, collectEnvironment } from '../../app/ui/src/lib/supportReport.js';

const ALL_ON = { relaxedSetting: true, probeSupported: true, artifactsPresent: true, backend: 'wasm' };

test('engages only when every gate passes', () => {
  const v = resolveOrtVariant(ALL_ON);
  assert.deepEqual(v, { wasmPaths: ORT_RELAXED_BASE, wasmSimd: 'relaxed', engaged: true, reason: null });
});

test('each failing gate resolves to stock with its reason', () => {
  const cases = [
    [{ ...ALL_ON, relaxedSetting: false }, 'off'],
    [{ ...ALL_ON, backend: 'webgpu-hybrid' }, 'backend'],
    [{ ...ALL_ON, backend: 'webgpu' }, 'backend'],
    [{ ...ALL_ON, probeSupported: false }, 'unsupported'],
    [{ ...ALL_ON, artifactsPresent: false }, 'unavailable'],
  ];
  for (const [facts, reason] of cases) {
    const v = resolveOrtVariant(facts);
    assert.deepEqual(v, { wasmPaths: ORT_STOCK_BASE, wasmSimd: undefined, engaged: false, reason },
      `facts: ${JSON.stringify(facts)}`);
  }
});

test('gate precedence: the toggle wins over everything else', () => {
  // Off + unsupported + unavailable still reports 'off': the report should
  // reflect the user's choice, not scold about capabilities they never asked
  // to use.
  const v = resolveOrtVariant({ relaxedSetting: false, probeSupported: false, artifactsPresent: false, backend: 'webgpu' });
  assert.equal(v.reason, 'off');
});

test('operator kill-switch forces stock only on explicit false', () => {
  // VITE_ORT_RELAXED_ENABLE='false': the deployment backs the binary out for
  // everyone, overriding an opted-in user, with its own reason.
  const killed = resolveOrtVariant({ ...ALL_ON, operatorEnabled: false });
  assert.deepEqual(killed, { wasmPaths: ORT_STOCK_BASE, wasmSimd: undefined, engaged: false, reason: 'operator' });
  // Explicit true and undefined (older callers, tests, non-docker deploys)
  // both leave the gate to the other facts.
  assert.equal(resolveOrtVariant({ ...ALL_ON, operatorEnabled: true }).engaged, true);
  assert.equal(resolveOrtVariant(ALL_ON).engaged, true);
  // The user's own off still reports as 'off' (their choice, not the
  // operator's) even when the operator also disabled it.
  assert.equal(resolveOrtVariant({ ...ALL_ON, relaxedSetting: false, operatorEnabled: false }).reason, 'off');
});

test('empty and missing facts default to stock, never throw', () => {
  assert.equal(resolveOrtVariant().engaged, false);
  assert.equal(resolveOrtVariant({}).engaged, false);
  assert.equal(resolveOrtVariant({ relaxedSetting: true }).engaged, false);
});

test('wasmRelaxedSimdSupported is a boolean and matches the support report probe', async () => {
  const supported = wasmRelaxedSimdSupported();
  assert.equal(typeof supported, 'boolean');
  const env = await collectEnvironment(null, null, {});
  assert.equal(supported, env.capabilities.wasm.relaxedSimd);
});
