#!/usr/bin/env bash
# Reproducible custom ONNX Runtime WASM build (CPU, threads + relaxed SIMD) for parakeet_web.
#
# What it produces: ort-wasm-relaxedsimd-threaded.{mjs,wasm}, a plain (non-JSEP, non-JSPI) CPU
# runtime, version-locked to the vendored onnxruntime-web JS bundle, with:
#   - wasm-relaxed-qnbitgemm.patch: an MLAS SQNBIT_CompInt8 dispatch for MatMulNBits on WASM
#     (8-bit and 4-bit). Stock ORT dequantizes MatMulNBits to fp32 + SGEMM on WASM; this keeps
#     B integer and uses i32x4.relaxed_dot_i8x16_i7x16_add_s. It engages only on nodes with
#     accuracy_level 4. The patch also fixes an upstream guard in matmul_nbits.cc that dropped
#     the raw 4-bit scales on non-x86, non-ARM64 targets (latent upstream, WASM had no 4-bit
#     CompInt8 kernel before), which made every 4-bit output zero.
#   - optionally (--ops CONFIG) a reduced operator set, see make-ops-config.py.
#
# Reproducibility: the ORT tag AND its commit are pinned, emsdk is pinned by build.py, and source
# paths are remapped with -ffile-prefix-map so the output does not depend on (nor leak) where the
# checkout lives: ORT_ENFORCE embeds __FILE__, which put 549 absolute home-directory paths into an
# unmapped build. BUILD-INFO records every input hash and the output hashes; two builds from the
# same inputs should produce identical SHA256SUMS (compare with --expect-sums).
#
# Nothing here wires the runtime into the app: that is a separate, owner-approved decision.
#
# Usage:
#   scripts/ort-custom/build.sh --src DIR --out DIR [-j N] [--ops CONFIG] [--expect-sums FILE]
#     --src DIR    onnxruntime checkout (cloned at the pinned tag if absent). ~10 GB of build
#                  state; put it in a folder whose name contains ignore_backups.
#     --out DIR    where the runtime pair, BUILD-INFO and SHA256SUMS are written.
#     -j N         parallel jobs (default: nproc). The build takes ~35 min at -j8.
#     --ops CONFIG reduced operator build (e.g. scripts/ort-custom/ops.config). Without it every
#                  operator is compiled in, like the npm runtime.
#     --expect-sums FILE  fail unless the produced SHA256SUMS match FILE.
#
# Requirements: git, uv, cmake, make, node (build.py bootstraps its pinned emsdk).
#
# Written with the help of Claude Code.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/../.." && pwd -P)"
PATCH="$HERE/wasm-relaxed-qnbitgemm.patch"

# Pinned upstream. Bump both together with the vendored onnxruntime-web, then re-validate the
# patch (exactness tests, WER gate) before trusting the new pair.
ORT_VERSION="1.30.0"
ORT_COMMIT="f2c39fe2f838cf35ce7da92824f5a5e3ee6e88a7"
EMSDK_VERSION="4.0.23"

SRC=""
OUT=""
JOBS="$(nproc)"
OPS=""
EXPECT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --src) SRC="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -j) JOBS="$2"; shift 2 ;;
    --ops) OPS="$(realpath "$2")"; shift 2 ;;
    --expect-sums) EXPECT="$(realpath "$2")"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$SRC" && -n "$OUT" ]] || { sed -n '2,33p' "$0" >&2; exit 2; }

VENDORED="$(node -p "require('$REPO_ROOT/app/ui/vendor/onnxruntime-web/package.json').version")"
if [[ "$VENDORED" != "$ORT_VERSION" ]]; then
  echo "ERROR: vendored onnxruntime-web is $VENDORED but this build is pinned to $ORT_VERSION." >&2
  echo "       The .mjs/.wasm pair is only loadable by the matching JS bundle." >&2
  exit 1
fi

if [[ ! -d "$SRC/.git" ]]; then
  git clone --depth 1 --branch "v$ORT_VERSION" --recurse-submodules --shallow-submodules \
    https://github.com/microsoft/onnxruntime.git "$SRC"
fi
SRC="$(realpath "$SRC")"
HEAD="$(git -C "$SRC" rev-parse HEAD)"
if [[ "$HEAD" != "$ORT_COMMIT" ]]; then
  echo "ERROR: $SRC is at $HEAD, expected v$ORT_VERSION = $ORT_COMMIT." >&2
  exit 1
fi

# Start from the pristine tag so a rerun never stacks the patch twice or keeps stale edits.
git -C "$SRC" checkout -q -- cmake onnxruntime
git -C "$SRC" clean -qf -- onnxruntime/core/mlas/lib
git -C "$SRC" apply --whitespace=nowarn "$PATCH"

# ORT post-processes its .mjs with a CommonJS script; stop Node's package.json walk at the
# checkout so a parent "type": "module" cannot break the last build step.
[[ -f "$SRC/package.json" ]] || printf '{\n  "type": "commonjs"\n}\n' > "$SRC/package.json"

BUILD_DIR="$SRC/build/wasm-custom"
PREFIX_MAP="-ffile-prefix-map=$SRC/=ort/"
ARGS=(
  --build_dir "$BUILD_DIR" --config Release --parallel "$JOBS" --skip_submodule_sync --skip_tests
  --build_wasm --enable_wasm_simd --enable_wasm_relaxed_simd --enable_wasm_threads
  --enable_wasm_api_exception_catching --emsdk_version "$EMSDK_VERSION"
  --cmake_extra_defines "CMAKE_C_FLAGS=$PREFIX_MAP" "CMAKE_CXX_FLAGS=$PREFIX_MAP"
)
[[ -n "$OPS" ]] && ARGS+=(--include_ops_by_config "$OPS")
# flatbuffers: ORT's reduced-build config parser (tools/python/util) imports it.
uv run --no-project --with flatbuffers python "$SRC/tools/ci_build/build.py" "${ARGS[@]}"

mkdir -p "$OUT"
for ext in mjs wasm; do
  cp "$BUILD_DIR/Release/ort-wasm-relaxedsimd-threaded.$ext" "$OUT/"
done

# Leak and reproducibility guard: no absolute source or home path may survive the prefix map.
for needle in "$SRC" "$HOME"; do
  if grep -aqF "$needle" "$OUT/ort-wasm-relaxedsimd-threaded.wasm" "$OUT/ort-wasm-relaxedsimd-threaded.mjs"; then
    echo "ERROR: the runtime embeds the local path '$needle' (prefix map not applied)." >&2
    exit 1
  fi
done

(cd "$OUT" && sha256sum ort-wasm-relaxedsimd-threaded.mjs ort-wasm-relaxedsimd-threaded.wasm > SHA256SUMS)
{
  echo "ort_version=$ORT_VERSION"
  echo "ort_commit=$ORT_COMMIT"
  echo "emsdk_version=$EMSDK_VERSION"
  echo "patch_sha256=$(sha256sum "$PATCH" | cut -d' ' -f1)"
  echo "ops_config=${OPS:+$(basename "$OPS")}"
  echo "ops_config_sha256=${OPS:+$(sha256sum "$OPS" | cut -d' ' -f1)}"
  ARGS_TEXT="${ARGS[*]//$SRC/<src>}"
  ARGS_TEXT="${ARGS_TEXT//$REPO_ROOT/<repo>}"
  echo "build_args=${ARGS_TEXT//$HOME/<home>}"
} > "$OUT/BUILD-INFO"
cat "$OUT/BUILD-INFO" "$OUT/SHA256SUMS"

if [[ -n "$EXPECT" ]]; then
  diff "$EXPECT" "$OUT/SHA256SUMS" && echo "==> SHA256SUMS match $EXPECT"
fi
