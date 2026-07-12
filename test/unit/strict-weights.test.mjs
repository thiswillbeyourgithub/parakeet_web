// Tier-1 unit tests for the e2e strict-weights gate (test/e2e/strict-weights.mjs).
// Pure logic: no Playwright, no model. Covers the env precedence (explicit
// override vs the CI default) and that requireWeightsOrSkip fails-vs-skips
// accordingly. This is the regression guard for the behaviour change that made
// a missing OPTIONAL weight (fp32 shards, int8-lite, diarization models) a
// FAILURE locally while staying a SKIP in CI.
//
// Built with Claude Code.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { strictWeights, requireWeightsOrSkip } from '../e2e/strict-weights.mjs';

test('strictWeights: explicit override wins over CI', () => {
  // Truthy overrides -> strict, even inside CI.
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', 'strict']) {
    assert.equal(strictWeights({ PARAKEET_E2E_STRICT_WEIGHTS: v, CI: '1' }), true, `"${v}" should be strict`);
  }
  // Falsey overrides -> lenient, even outside CI.
  for (const v of ['0', 'false', 'False', 'no', 'off', ' 0 ']) {
    assert.equal(strictWeights({ PARAKEET_E2E_STRICT_WEIGHTS: v }), false, `"${v}" should be lenient`);
  }
});

test('strictWeights: no override -> strict locally, lenient in CI', () => {
  assert.equal(strictWeights({}), true, 'local (no CI) defaults to strict');
  assert.equal(strictWeights({ CI: '' }), true, 'empty CI is treated as unset -> strict');
  assert.equal(strictWeights({ CI: 'true' }), false, 'CI set -> lenient');
  // An empty override string means "not set" -> fall through to the CI default.
  assert.equal(strictWeights({ PARAKEET_E2E_STRICT_WEIGHTS: '', CI: 'true' }), false);
  assert.equal(strictWeights({ PARAKEET_E2E_STRICT_WEIGHTS: '' }), true);
});

test('requireWeightsOrSkip: present weights are a no-op', () => {
  const calls = [];
  const fakeTest = { skip: (...a) => calls.push(a) };
  assert.doesNotThrow(() => requireWeightsOrSkip(fakeTest, false, 'msg', {}));
  assert.equal(calls.length, 0, 'no skip recorded when nothing is missing');
});

test('requireWeightsOrSkip: missing weight FAILS in strict mode', () => {
  const calls = [];
  const fakeTest = { skip: (...a) => calls.push(a) };
  assert.throws(
    () => requireWeightsOrSkip(fakeTest, true, 'no fp32 shards', { PARAKEET_E2E_STRICT_WEIGHTS: '1' }),
    /no fp32 shards[\s\S]*strict-weights/,
    'strict mode throws with the message + hint',
  );
  assert.equal(calls.length, 0, 'strict mode does not record a skip');
});

test('requireWeightsOrSkip: missing weight SKIPS in lenient mode', () => {
  const calls = [];
  const fakeTest = { skip: (...a) => calls.push(a) };
  assert.doesNotThrow(
    () => requireWeightsOrSkip(fakeTest, true, 'no fp32 shards', { CI: '1' }),
    'lenient mode (CI) does not throw',
  );
  assert.deepEqual(calls, [[true, 'no fp32 shards']], 'lenient mode records a Playwright skip');
});
