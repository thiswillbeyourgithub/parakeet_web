#!/usr/bin/env bash
# Build the opt-in Relaxed-SIMD ONNX Runtime WASM artifacts (PERF_PLAN #5) and
# install them under app/ui/public/ort-relaxed/.
#
# Why: the stock npm onnxruntime-web ships MLAS int8 kernels compiled for
# fixed-width WASM SIMD only. ORT's source also carries Relaxed-SIMD QGEMM
# kernels (mlas/lib/qgemm_kernel_wasmrelaxedsimd.cpp) that use e.g.
# i32x4.relaxed_dot_i8x16_i7x16_add_s, but they are only compiled in when the
# build runs with --enable_wasm_relaxed_simd, and no published binary does.
# This script produces that build from source, version-locked to the vendored
# onnxruntime-web, so the app can offer the "Relaxed-SIMD engine" toggle
# (app/ui/src/lib/ortVariant.js gates it on these artifacts being present).
#
# The build is a HEAVY one-time emscripten compile (roughly 30-60 min at full
# parallelism, ~10 GB of TRANSIENT disk for source + emsdk + objects; the tree
# is deleted after a successful install, see below). Do NOT run it while a
# benchmark is measuring transcription time on this machine; to be polite to a
# busy box, prefix with `nice -n 19` and pass a lower -j.
#
# This is the whole deployment story in one command: build from source, install
# the canonical pair under app/ui/public/ort-relaxed/, rebuild the app so
# dist/ serves it (postbuild.mjs manifests dist/ort-relaxed/), then delete the
# source tree. Operators who never run it simply ship the vendored stock
# runtime; the app's runtime gate (ortVariant.js) falls back to stock whenever
# the artifacts are absent or the browser lacks relaxed-SIMD support.
#
# Usage:
#   ./scripts/build-ort-relaxed.sh [-j N] [--src DIR] [--keep-src]
#     -j N        parallel build jobs (default: nproc)
#     --src DIR   reuse/clone the onnxruntime source tree there instead of the
#                 default .ort-src/ in the repo root. A user-supplied tree is
#                 NEVER auto-deleted (you manage it).
#     --keep-src  keep the default source tree after a successful install
#                 (for iterating on build flags; default is to delete it, the
#                 tree is ~10 GB of ephemeral build state).
#
# Cleanup contract: on SUCCESS the default .ort-src/ tree is removed (nothing
# to gitignore, nothing hoarded); on FAILURE it is kept so a rerun resumes
# incrementally and the logs stay inspectable.
#
# Requirements: git, python3, cmake, ninja (the ORT build bootstraps its own
# pinned emsdk under the source tree, so no system emscripten is needed).
#
# After it finishes, validate before trusting: load the app with the toggle
# on, confirm the "[ORT] Relaxed-SIMD runtime variant engaged" log line,
# transcribe a known clip, and compare against the stock engine's transcript.
# Then run the WER suite (scripts/wer-bench.mjs) before ever defaulting it on.
#
# Written with the help of Claude Code.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOBS="$(nproc)"
SRC_DIR="$REPO_ROOT/.ort-src"
USER_SRC=0
KEEP_SRC=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -j) JOBS="$2"; shift 2 ;;
    --src) SRC_DIR="$2"; USER_SRC=1; shift 2 ;;
    --keep-src) KEEP_SRC=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Version-lock to the vendored runtime: the .mjs/.wasm pair we produce is
# loaded by the vendored JS bundle at runtime, so the interface must match.
ORT_VERSION="$(node -p "require('$REPO_ROOT/app/ui/vendor/onnxruntime-web/package.json').version")"
echo "==> Building ONNX Runtime WASM v$ORT_VERSION with Relaxed SIMD (jobs: $JOBS)"

if [[ ! -d "$SRC_DIR/.git" ]]; then
  echo "==> Cloning onnxruntime v$ORT_VERSION into $SRC_DIR"
  git clone --depth 1 --branch "v$ORT_VERSION" --recurse-submodules --shallow-submodules \
    https://github.com/microsoft/onnxruntime.git "$SRC_DIR"
else
  echo "==> Reusing source tree at $SRC_DIR"
  CURRENT_TAG="$(git -C "$SRC_DIR" describe --tags --exact-match 2>/dev/null || echo unknown)"
  if [[ "$CURRENT_TAG" != "v$ORT_VERSION" ]]; then
    echo "ERROR: $SRC_DIR is at '$CURRENT_TAG', expected 'v$ORT_VERSION'." >&2
    echo "       Point --src elsewhere or update the checkout first." >&2
    exit 1
  fi
fi

# The onnxruntime repo has no root package.json, and this checkout usually
# lives INSIDE parakeet_web (whose root package.json says "type": "module").
# ORT's build post-processes its emitted .mjs with a CommonJS node script
# (onnxruntime/wasm/wasm_post_build.js, plain require() in a .js file), and
# Node resolves the module type by walking UP to the nearest package.json, so
# without a stop marker here the walk escapes into parakeet_web and the
# post-process dies with "require is not defined in ES module scope" at the
# very last build step. Pin the whole source tree to CommonJS.
if [[ ! -f "$SRC_DIR/package.json" ]]; then
  printf '{\n  "type": "commonjs"\n}\n' > "$SRC_DIR/package.json"
fi

# Fail fast if the flag ever disappears from the build system.
if ! grep -q "enable_wasm_relaxed_simd" "$SRC_DIR/tools/ci_build/build.py"; then
  echo "ERROR: --enable_wasm_relaxed_simd not found in tools/ci_build/build.py" >&2
  echo "       (removed upstream? check the ORT release notes before proceeding)" >&2
  exit 1
fi

BUILD_DIR="$SRC_DIR/build/wasm-relaxed"

# Flag set mirrors ORT's own npm-packaging WASM pipeline (threads + SIMD +
# JSEP so the produced pair is the ort-wasm-simd-threaded.jsep.{mjs,wasm} the
# app's loader actually fetches), plus the relaxed switch this whole exercise
# is about. build.py bootstraps its pinned emsdk on first run.
echo "==> Running the ORT build (this is the long part)"
python3 "$SRC_DIR/tools/ci_build/build.py" \
  --build_dir "$BUILD_DIR" \
  --config Release \
  --build_wasm \
  --enable_wasm_simd \
  --enable_wasm_threads \
  --enable_wasm_relaxed_simd \
  --use_jsep \
  --parallel "$JOBS" \
  --skip_tests \
  --skip_submodule_sync

echo "==> Collecting artifacts"
# The relaxed build names its output by flavour: ort-wasm-RELAXEDSIMD-threaded.
# The vendored onnxruntime-web loader knows nothing of that name: it always
# imports <wasmPaths>ort-wasm-simd-threaded.jsep.mjs (env.wasm.simd='relaxed'
# only changes the SUPPORT PROBE, verified against dist/ort.min.mjs), and the
# app's integrity manifest likewise looks the canonical pair up by name. So the
# install step RENAMES the pair to the canonical names and patches the baked
# flavour filename inside the .mjs (emscripten resolves its .wasm by that
# literal), keeping every load path consistent: the app's verified-blob path,
# the plain wasmPaths-prefix path, and transcribe.mjs --wasm-paths under Node.
DEST="$REPO_ROOT/app/ui/public/ort-relaxed"
mkdir -p "$DEST"
SRC_MJS="$(find "$BUILD_DIR" -name 'ort-wasm-*simd-threaded.jsep.mjs' | head -n 1)"
SRC_WASM="$(find "$BUILD_DIR" -name 'ort-wasm-*simd-threaded.jsep.wasm' | head -n 1)"

if [[ -z "$SRC_MJS" || -z "$SRC_WASM" ]]; then
  echo "ERROR: jsep .mjs/.wasm pair not found under $BUILD_DIR" >&2
  echo "       (mjs='$SRC_MJS' wasm='$SRC_WASM'). The build layout may have" >&2
  echo "       changed; look for the ort-wasm-*simd-threaded* pair manually." >&2
  exit 1
fi

cp -v "$SRC_WASM" "$DEST/ort-wasm-simd-threaded.jsep.wasm"
sed 's/ort-wasm-relaxedsimd-threaded\.jsep/ort-wasm-simd-threaded.jsep/g' \
  "$SRC_MJS" > "$DEST/ort-wasm-simd-threaded.jsep.mjs"
if grep -q 'relaxedsimd' "$DEST/ort-wasm-simd-threaded.jsep.mjs"; then
  echo "ERROR: unpatched 'relaxedsimd' references remain in the installed .mjs;" >&2
  echo "       the baked filename pattern changed, update the sed above." >&2
  exit 1
fi

echo "==> Done: canonical jsep pair installed in $DEST"
echo "    (from $(basename "$SRC_MJS") / $(basename "$SRC_WASM"))"

# One-shot serve: rebuild the app so dist/ actually ships the pair
# (postbuild.mjs writes dist/ort-relaxed/manifest.json when it is present).
# The dev server serves public/ directly, so this only matters for dist.
if [[ -d "$REPO_ROOT/app/ui/node_modules" ]]; then
  echo "==> Rebuilding the app so dist/ serves the relaxed pair"
  (cd "$REPO_ROOT/app/ui" && npm run build)
else
  echo "==> app/ui/node_modules missing; run this yourself to serve it:"
  echo "    cd app/ui && npm install && npm run build"
fi

# Cleanup contract (see header): the source tree is ~10 GB of ephemeral build
# state, deleted on success unless the operator asked to keep it or owns it.
if [[ "$USER_SRC" -eq 1 ]]; then
  echo "==> Keeping $SRC_DIR (user-supplied --src is never auto-deleted)"
elif [[ "$KEEP_SRC" -eq 1 ]]; then
  echo "==> Keeping $SRC_DIR (--keep-src)"
else
  echo "==> Removing the source tree $SRC_DIR (~10 GB; pass --keep-src to keep it)"
  rm -rf "$SRC_DIR"
fi

echo "==> All done. Validate per the header comment before shipping."
