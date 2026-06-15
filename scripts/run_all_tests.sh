#!/bin/sh
# Run the full parakeet_web test suite: all three tiers in one go.
#
# Usage:
#   ./scripts/run_all_tests.sh              # build the app, then run unit + http + e2e
#   ./scripts/run_all_tests.sh --no-build   # skip the app rebuild (faster; only safe
#                                           # if app/ui/dist is already current)
#   ./scripts/run_all_tests.sh --no-e2e     # tier-1 + tier-2 only (no Playwright build/run)
#
# Why this exists: "all the tests" spans three tiers wired through two
# package.json files, plus a build step the e2e tier silently depends on:
#   - tier 1 (unit): node --test test/unit/*.test.mjs
#   - tier 2 (http):  node --test test/http/*.test.mjs
#   - tier 3 (e2e):   playwright test  -- runs against the BUILT app/ui/dist,
#                     which is gitignored and can be stale, so we rebuild first.
# Running them by hand is easy to get subtly wrong (forgetting the rebuild
# tests an OLD UI). This wraps the canonical sequence with a fail-fast exit.
#
# Deliberately NOT run here (they are diagnostics/benchmarks, not pass/fail
# tests, and need a real GPU + WebGPU-capable Chromium that headless lacks):
#   - npm run webgpu:check / webgpu:memcheck   (WebGPU adapter probe)
#   - node scripts/wer-bench.mjs               (transcription quality WER)
# Run those by hand when you specifically need them.
#
# Run from anywhere; the script cd's to the repo root itself.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

DO_BUILD=1
DO_E2E=1
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --no-e2e)   DO_E2E=0 ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# Dependencies must be installed in both package roots.
[ -d node_modules ]        || { echo "ERROR: run 'npm install' in the repo root first" >&2; exit 1; }
[ -d app/ui/node_modules ] || { echo "ERROR: run 'npm install' in app/ui first" >&2; exit 1; }

section() { printf '\n========================================\n  %s\n========================================\n' "$1"; }

if [ "$DO_E2E" -eq 1 ] && [ "$DO_BUILD" -eq 1 ]; then
  section "Building app (app/ui/dist for tier-3 e2e)"
  ( cd app/ui && npm run build )
fi

section "Tier 1: unit tests"
npm run test:unit

section "Tier 2: http tests"
npm run test:http

if [ "$DO_E2E" -eq 1 ]; then
  # The e2e tier needs local model weights (fallback_models or PARAKEET_E2E_MODEL_DIR);
  # warn but do not abort, since the specs self-skip when weights are absent.
  if [ ! -d fallback_models ] && [ -z "${PARAKEET_E2E_MODEL_DIR:-}" ]; then
    echo "WARNING: no fallback_models/ and PARAKEET_E2E_MODEL_DIR unset; e2e specs needing weights will skip." >&2
    echo "         Fetch them with: npm run e2e:models" >&2
  fi
  section "Tier 3: end-to-end tests (Playwright)"
  npm run test:e2e
else
  echo "\nSkipping tier-3 e2e (--no-e2e)."
fi

section "All requested test tiers passed."
