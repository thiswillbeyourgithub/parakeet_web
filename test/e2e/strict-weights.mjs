// Shared gate for the tier-3 specs that need OPTIONAL model weights which
// upstream does not ship: the sharded fp32 encoder, the int8-lite encoder, and
// the speaker-diarization models. Historically each such spec self-SKIPPED when
// its weights were not served, so a weightless run stayed green. The problem:
// on a box that is SUPPOSED to have the full model set (a maintainer's local
// checkout), a silent skip hides "I thought I tested fp32 but actually tested
// nothing" behind a passing run.
//
// So: a missing weight is a FAILURE locally (where the full set is expected) and
// a SKIP in CI (which only fetches the int8 ASR + diarization set, never the
// fp32 shards or the lite encoder -- see scripts/fetch-e2e-models.mjs).
//
// strict resolution (strictWeights):
//   - PARAKEET_E2E_STRICT_WEIGHTS explicitly set -> honour it
//     ('0' / 'false' / 'no' / 'off' => lenient; anything else => strict)
//   - otherwise                                  -> strict when NOT in CI
//     (process.env.CI is unset), lenient in CI.
//
// This module imports NOTHING from Playwright so it stays a pure, tier-1-unit-
// testable helper; the spec passes its own `test` object into
// requireWeightsOrSkip so we can still emit a real Playwright skip.
//
// Built with Claude Code.

const FALSEY = new Set(['0', 'false', 'no', 'off', '']);

export function strictWeights(env = process.env) {
  const v = env.PARAKEET_E2E_STRICT_WEIGHTS;
  if (v != null && v !== undefined && String(v).length > 0) {
    return !FALSEY.has(String(v).trim().toLowerCase());
  }
  // No explicit override: strict everywhere EXCEPT CI.
  return !env.CI;
}

// Call at the top of a test body. `missing` is true when the required weights
// are absent (e.g. `!head || !head.ok()` from a HEAD probe). In strict mode a
// missing weight throws (fails the test) with `message` plus a fix-it hint;
// otherwise it records a normal Playwright skip, exactly as before. `test` is
// the spec's imported Playwright `test` object.
export function requireWeightsOrSkip(test, missing, message, env = process.env) {
  if (!missing) return;
  if (strictWeights(env)) {
    throw new Error(
      `${message}\n[strict-weights] Treated as a FAILURE, not a skip, because ` +
      `strict-weights is on (default: on locally, off in CI). Serve the missing ` +
      `weights (\`npm run e2e:models\`, and for fp32 run ` +
      `parakeet-tdt-0.6b-v3-smoothquant-onnx/scripts/shard-fp32.py), or set ` +
      `PARAKEET_E2E_STRICT_WEIGHTS=0 to skip instead.`,
    );
  }
  test.skip(true, message);
}
