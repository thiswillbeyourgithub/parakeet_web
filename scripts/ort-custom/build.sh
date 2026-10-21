#!/usr/bin/env bash
# Reproducible custom ONNX Runtime WASM build (CPU, threads + relaxed SIMD) for parakeet_web.
#
# What it produces: two CPU runtimes (non-JSEP, non-JSPI) built from the same patched source,
# version-locked to the vendored onnxruntime-web JS bundle:
#   - ort-wasm-relaxedsimd-threaded.{mjs,wasm}: relaxed SIMD (Chromium, Firefox).
#   - ort-wasm-simd-threaded.{mjs,wasm}: plain SIMD128, for browsers without relaxed SIMD (Safari).
# A browser rejects a whole module that contains one unsupported instruction, so the two cannot be
# one file; the loader feature-detects and fetches one. Both contain:
#   - wasm-qnbitgemm.patch: an MLAS SQNBIT_CompInt8 dispatch for MatMulNBits on WASM (8, 4 and
#     2 bit). Stock ORT dequantizes MatMulNBits to fp32 + SGEMM on WASM; this keeps B integer,
#     with i32x4.relaxed_dot_i8x16_i7x16_add_s in relaxed-SIMD builds and i16 dots in plain SIMD
#     builds (same integer results). It engages only on nodes with accuracy_level 4. The patch
#     also fixes an upstream guard in matmul_nbits.cc that dropped the raw 4-bit scales on
#     non-x86, non-ARM64 targets (latent upstream, WASM had no 4-bit CompInt8 kernel before),
#     which made every 4-bit output zero.
#   - optionally (--ops CONFIG) a reduced operator set, see make-ops-config.py.
#
# Reproducibility: the ORT tag AND its commit are pinned, emsdk is pinned by build.py, and source
# paths are remapped with -ffile-prefix-map so the output does not depend on (nor leak) where the
# checkout lives: ORT_ENFORCE embeds __FILE__, which put 549 absolute home-directory paths into an
# unmapped build. BUILD-INFO records every input hash and the output hashes; two builds from the
# same inputs should produce identical SHA256SUMS (compare with --expect-sums).
#
# --install copies the pairs into the app (app/ui/public/ort/*.custom.{mjs,wasm}, which
# backend.js loads for WASM-only contexts) and records their provenance in
# app/ui/vendor/ort-custom/ (BUILD-INFO, SHA256SUMS of the installed names), which
# test/unit/ort-custom-runtime.test.mjs checks against the vendored ORT version and the patch.
#
# Usage:
#   scripts/ort-custom/build.sh --src DIR --out DIR [-j N] [--ops CONFIG] [--expect-sums FILE] [--install]
#   scripts/ort-custom/build.sh --out DIR --install   (install an existing build, no rebuild)
#     --src DIR    onnxruntime checkout (cloned at the pinned tag if absent). ~10 GB of build
#                  state; put it in a folder whose name contains ignore_backups.
#     --out DIR    where the runtime pairs, BUILD-INFO and SHA256SUMS are written.
#     -j N         parallel jobs (default: nproc). Each variant takes ~35 min at -j8.
#     --variants LIST  comma-separated subset of relaxedsimd,simd (default: both).
#     --ops CONFIG reduced operator build (e.g. scripts/ort-custom/ops.config). Without it every
#                  operator is compiled in, like the npm runtime.
#     --expect-sums FILE  fail unless the produced SHA256SUMS match FILE.
#     --install    install both variants into the app (see above). Refuses a build whose
#                  BUILD-INFO does not match the pinned version and the current patch.
#
# Requirements: git, uv, cmake, make, node (build.py bootstraps its pinned emsdk).
#
# Written with the help of Claude Code.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$HERE/../.." && pwd -P)"
PATCH="$HERE/wasm-qnbitgemm.patch"

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
VARIANTS="relaxedsimd,simd"
INSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --src) SRC="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    -j) JOBS="$2"; shift 2 ;;
    --ops) OPS="$(realpath "$2")"; shift 2 ;;
    --expect-sums) EXPECT="$(realpath "$2")"; shift 2 ;;
    --variants) VARIANTS="$2"; shift 2 ;;
    --install) INSTALL=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$OUT" && ( -n "$SRC" || "$INSTALL" == 1 ) ]] || { sed -n '2,46p' "$0" >&2; exit 2; }

# Copy a finished build into the app. Installed names carry '.custom' so they can never be
# mistaken for (or overwritten by) the npm runtimes update-vendored.sh mirrors next to them.
install_runtimes() {
  local info="$OUT/BUILD-INFO"
  local dest_pub="$REPO_ROOT/app/ui/public/ort" dest_meta="$REPO_ROOT/app/ui/vendor/ort-custom"
  [[ -f "$info" ]] || { echo "ERROR: no BUILD-INFO in $OUT" >&2; exit 1; }
  grep -qx "ort_version=$ORT_VERSION" "$info" || { echo "ERROR: $OUT was not built for ORT $ORT_VERSION" >&2; exit 1; }
  grep -qx "patch_sha256=$(sha256sum "$PATCH" | cut -d' ' -f1)" "$info" \
    || { echo "ERROR: $OUT was built from another wasm-qnbitgemm.patch; rebuild it" >&2; exit 1; }
  (cd "$OUT" && sha256sum -c --quiet SHA256SUMS)
  mkdir -p "$dest_pub" "$dest_meta"
  local installed=()
  for variant in relaxedsimd simd; do
    for ext in mjs wasm; do
      local name="ort-wasm-$variant-threaded.custom.$ext"
      cp "$OUT/ort-wasm-$variant-threaded.$ext" "$dest_pub/$name"
      installed+=("$name")
    done
  done
  cp "$info" "$dest_meta/BUILD-INFO"
  (cd "$dest_pub" && sha256sum "${installed[@]}") > "$dest_meta/SHA256SUMS"
  echo "==> installed ${installed[*]} into app/ui/public/ort/"
}

if [[ -z "$SRC" ]]; then
  install_runtimes
  exit 0
fi

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

PREFIX_MAP="-ffile-prefix-map=$SRC/=ort/"
COMMON=(
  --config Release --parallel "$JOBS" --skip_submodule_sync --skip_tests
  --build_wasm --enable_wasm_simd --enable_wasm_threads
  --enable_wasm_api_exception_catching --emsdk_version "$EMSDK_VERSION"
  --cmake_extra_defines "CMAKE_C_FLAGS=$PREFIX_MAP" "CMAKE_CXX_FLAGS=$PREFIX_MAP"
)
[[ -n "$OPS" ]] && COMMON+=(--include_ops_by_config "$OPS")

mkdir -p "$OUT"
OUTPUTS=()
IFS=, read -ra VARIANT_LIST <<< "$VARIANTS"
for variant in "${VARIANT_LIST[@]}"; do
  case "$variant" in
    relaxedsimd) EXTRA=(--enable_wasm_relaxed_simd) ;;
    simd) EXTRA=() ;;
    *) echo "unknown variant: $variant" >&2; exit 2 ;;
  esac
  BUILD_DIR="$SRC/build/wasm-custom-$variant"
  # flatbuffers: ORT's reduced-build config parser (tools/python/util) imports it.
  uv run --no-project --with flatbuffers python "$SRC/tools/ci_build/build.py" \
    --build_dir "$BUILD_DIR" "${COMMON[@]}" "${EXTRA[@]}"
  for ext in mjs wasm; do
    cp "$BUILD_DIR/Release/ort-wasm-$variant-threaded.$ext" "$OUT/"
    OUTPUTS+=("ort-wasm-$variant-threaded.$ext")
  done
done

# Leak and reproducibility guard: no absolute source or home path may survive the prefix map.
for needle in "$SRC" "$HOME"; do
  for f in "${OUTPUTS[@]}"; do
    if grep -aqF "$needle" "$OUT/$f"; then
      echo "ERROR: $f embeds the local path '$needle' (prefix map not applied)." >&2
      exit 1
    fi
  done
done

(cd "$OUT" && sha256sum "${OUTPUTS[@]}" > SHA256SUMS)
{
  echo "ort_version=$ORT_VERSION"
  echo "ort_commit=$ORT_COMMIT"
  echo "emsdk_version=$EMSDK_VERSION"
  echo "patch_sha256=$(sha256sum "$PATCH" | cut -d' ' -f1)"
  echo "ops_config=${OPS:+$(basename "$OPS")}"
  echo "ops_config_sha256=${OPS:+$(sha256sum "$OPS" | cut -d' ' -f1)}"
  echo "variants=$VARIANTS"
  ARGS_TEXT="${COMMON[*]//$SRC/<src>}"
  ARGS_TEXT="${ARGS_TEXT//$REPO_ROOT/<repo>}"
  echo "build_args=${ARGS_TEXT//$HOME/<home>}"
} > "$OUT/BUILD-INFO"
cat "$OUT/BUILD-INFO" "$OUT/SHA256SUMS"

if [[ -n "$EXPECT" ]]; then
  diff "$EXPECT" "$OUT/SHA256SUMS" && echo "==> SHA256SUMS match $EXPECT"
fi

if [[ "$INSTALL" == 1 ]]; then
  [[ "$VARIANTS" == "relaxedsimd,simd" ]] || { echo "ERROR: --install needs both variants" >&2; exit 1; }
  install_runtimes
fi
