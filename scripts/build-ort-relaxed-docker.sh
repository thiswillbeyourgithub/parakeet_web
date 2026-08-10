#!/usr/bin/env bash
# Dockerized driver for scripts/build-ort-relaxed.sh: builds the opt-in
# Relaxed-SIMD ONNX Runtime WASM pair inside a pinned, hermetic toolchain
# (docker/ort-relaxed-builder/Dockerfile) instead of against whatever the host
# happens to have installed.
#
# Written with the help of Claude Code.
#
# Why docker: the artifacts this produces get COMMITTED and then served to
# every visitor, so "it built on my machine" is not good enough. The host
# builder inherits the box's glibc, cmake, ninja, python and Node, and any of
# those can change the emitted bytes. The image pins the base by digest, Node
# by version + tarball SHA-256, the ORT source by the tag derived from the
# vendored onnxruntime-web, and emscripten by ORT's own bootstrapped emsdk.
# What it cannot pin is emscripten's determinism, which is why --repro-check
# below is empirical rather than assumed.
#
# Why a separate image from docker/Dockerfile (the deploy image): this is a
# 30-60 min compile needing ~10 GB of scratch, for output that only changes on
# an ORT version bump. Deploy builds stay fast and just serve whatever pair is
# already in app/ui/public/ort-relaxed/.
#
# No duplicated build logic: the container bind-mounts this repo at /repo and
# execs /repo/scripts/build-ort-relaxed.sh. The only thing this wrapper adds is
# the container, the reproducibility check, and the provenance files.
#
# Usage:
#   ./scripts/build-ort-relaxed-docker.sh [-j N] [--repro-check] [--dry-run]
#                                         [--tag NAME] [--nice N]
#     -j N            parallelism forwarded to the inner builder
#                     (default: the container's nproc)
#     --repro-check   build TWICE into two throwaway directories, in two fresh
#                     containers, and diff the SHA-256 of the produced pair.
#                     PASS => install the pair and write the provenance files
#                     (see below). FAIL => print both hash sets and exit 1,
#                     installing nothing.
#     --dry-run       print the docker commands instead of running them
#     --tag NAME      image tag to build/run (default: parakeet-ort-relaxed-builder)
#     --nice N        niceness inside the container (default: 19, be polite:
#                     this box usually has a benchmark running)
#
# Side effects on the bind-mounted repo (the container writes through the
# mount, as the invoking user, not root):
#   - app/ui/public/ort-relaxed/{.mjs,.wasm}  the installed runtime pair
#   - app/ui/dist/                            rebuilt by the inner script so
#                                             dist/ actually serves the pair
#                                             (skipped when app/ui/node_modules
#                                             is absent, same as on the host)
# npm's cache stays inside the container (npm_config_cache is set in the
# image), so the host's ~/.npm is never touched.
#
# Provenance files written on a --repro-check PASS, under
# app/ui/public/ort-relaxed/:
#   SHA256SUMS   hashes of the installed pair
#   BUILD-INFO   ORT tag, base image digest, Node version, emsdk version,
#                build date, docker image id
# These are what make a committed binary auditable: anyone can re-run this
# script and compare.
#
# Requirements: docker (invoked as `sudo docker` on this box), node on the host
# (only to read the vendored onnxruntime-web version), coreutils.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILDER_DIR="$REPO_ROOT/docker/ort-relaxed-builder"
DEST="$REPO_ROOT/app/ui/public/ort-relaxed"
PAIR_WASM="ort-wasm-simd-threaded.jsep.wasm"
PAIR_MJS="ort-wasm-simd-threaded.jsep.mjs"

IMAGE="parakeet-ort-relaxed-builder"
JOBS=""
NICE_LEVEL=19
REPRO_CHECK=0
DRY_RUN=0

# Docker needs root on this box (see CLAUDE.md). Overridable for hosts where
# the invoking user is already in the docker group: DOCKER_CMD="docker".
read -r -a DOCKER <<< "${DOCKER_CMD:-sudo docker}"

usage() {
  sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//; $d'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -j) JOBS="$2"; shift 2 ;;
    --repro-check) REPRO_CHECK=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --tag) IMAGE="$2"; shift 2 ;;
    --nice) NICE_LEVEL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -f "$BUILDER_DIR/Dockerfile" ]] || {
  echo "ERROR: $BUILDER_DIR/Dockerfile not found" >&2; exit 1; }
[[ -x "$REPO_ROOT/scripts/build-ort-relaxed.sh" ]] || {
  echo "ERROR: scripts/build-ort-relaxed.sh not found or not executable" >&2; exit 1; }

# Echo-or-execute, so --dry-run exercises the exact argv the real run uses.
run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

# One build. $1 = host directory to bind over the inner script's install
# destination, or "" to install straight into the repo. Every invocation is a
# fresh `--rm` container, which is what makes the second --repro-check pass an
# honest independent build rather than a warm rerun.
docker_build_run() {
  local out_dir="$1"
  local -a args=(
    run --rm
    -u "$(id -u):$(id -g)"
    -e "HOME=/home/builder"
    -e "BUILD_NICE=$NICE_LEVEL"
    -v "$REPO_ROOT:/repo"
  )
  if [[ -n "$out_dir" ]]; then
    args+=(-v "$out_dir:/repo/app/ui/public/ort-relaxed")
  fi
  args+=("$IMAGE")
  if [[ -n "$JOBS" ]]; then
    args+=(-j "$JOBS")
  fi
  run "${DOCKER[@]}" "${args[@]}"
}

# sha256sum lines for the pair, relative to $1 so two directories that hold
# identical bytes produce byte-identical output.
hash_pair() {
  local dir="$1"
  if [[ ! -f "$dir/$PAIR_WASM" || ! -f "$dir/$PAIR_MJS" ]]; then
    echo "ERROR: expected pair not found in $dir" >&2
    return 1
  fi
  ( cd "$dir" && sha256sum "$PAIR_WASM" "$PAIR_MJS" )
}

echo "==> Building the builder image ($IMAGE)"
run "${DOCKER[@]}" build -t "$IMAGE" -f "$BUILDER_DIR/Dockerfile" "$BUILDER_DIR"

# The inner script derives the ORT tag the same way; read it here too so the
# provenance file records it without having to parse the build log.
ORT_VERSION="unknown"
if command -v node >/dev/null 2>&1; then
  ORT_VERSION="$(node -p "require('$REPO_ROOT/app/ui/vendor/onnxruntime-web/package.json').version" 2>/dev/null || echo unknown)"
fi
BASE_DIGEST="$(grep -m1 -oE '^FROM ubuntu:[^@]+@sha256:[0-9a-f]+' "$BUILDER_DIR/Dockerfile" | sed 's/^FROM //')"
NODE_VERSION="$(grep -m1 -E '^ARG NODE_VERSION=' "$BUILDER_DIR/Dockerfile" | cut -d= -f2)"

if [[ "$REPRO_CHECK" -eq 0 ]]; then
  echo "==> Running the containerised build (installs into $DEST)"
  # Pre-create the bind target as the invoking user; letting docker create a
  # missing mount destination would leave a root-owned directory behind.
  # (Under --dry-run nothing is mounted, so touch nothing.)
  [[ "$DRY_RUN" -eq 1 ]] || mkdir -p "$DEST"
  docker_build_run ""
  if [[ "$DRY_RUN" -eq 0 ]]; then
    echo
    echo "==> Installed pair:"
    hash_pair "$DEST"
    echo
    echo "Re-run with --repro-check to prove the build is bit-reproducible and"
    echo "to write the SHA256SUMS/BUILD-INFO provenance files."
  fi
  exit 0
fi

# ── --repro-check ─────────────────────────────────────────────────────────
# Two full builds into throwaway directories, so a FAIL never leaves a
# half-trusted binary sitting in the repo. Only a PASS installs anything.
echo "==> Reproducibility check: two full builds (this is 2x 30-60 min)"

OUT_A=""
OUT_B=""
cleanup() {
  [[ -n "$OUT_A" && -d "$OUT_A" ]] && rm -rf "$OUT_A"
  [[ -n "$OUT_B" && -d "$OUT_B" ]] && rm -rf "$OUT_B"
  return 0
}
trap cleanup EXIT

if [[ "$DRY_RUN" -eq 1 ]]; then
  OUT_A="<tmp-a>"
  OUT_B="<tmp-b>"
else
  OUT_A="$(mktemp -d -t ort-relaxed-repro-a-XXXXXX)"
  OUT_B="$(mktemp -d -t ort-relaxed-repro-b-XXXXXX)"
  # The container runs as the invoking user, but mktemp's 0700 is fine for
  # that; only widen if a UID override is ever added.
fi

LOG_A="$OUT_A/build.log"

echo "==> Build 1/2 -> $OUT_A"
if [[ "$DRY_RUN" -eq 1 ]]; then
  docker_build_run "$OUT_A"
else
  docker_build_run "$OUT_A" 2>&1 | tee "$LOG_A"
fi

echo "==> Build 2/2 -> $OUT_B (fresh container)"
docker_build_run "$OUT_B"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would diff sha256sum of $PAIR_WASM/$PAIR_MJS between the two output dirs"
  echo "[dry-run] on PASS would install into $DEST and write SHA256SUMS + BUILD-INFO"
  exit 0
fi

HASH_A="$(hash_pair "$OUT_A")"
HASH_B="$(hash_pair "$OUT_B")"

echo
if [[ "$HASH_A" != "$HASH_B" ]]; then
  echo "==> REPRO CHECK: FAIL (the two builds are NOT bit-identical)"
  echo "--- build 1 ---"
  echo "$HASH_A"
  echo "--- build 2 ---"
  echo "$HASH_B"
  echo
  echo "Nothing was installed. Emscripten output is not bit-reproducible by"
  echo "construction, so this is a finding to investigate (embedded paths,"
  echo "timestamps, parallelism), not necessarily a broken build."
  exit 1
fi

echo "==> REPRO CHECK: PASS (both builds are bit-identical)"
echo "$HASH_A"

# Best-effort: ORT's build.py bootstraps a pinned emsdk, and the version shows
# up in the bootstrap output. The authoritative pin lives in
# tools/ci_build/build.py at the ORT tag recorded below, so "unknown" here only
# costs convenience, not auditability.
EMSDK_VERSION="unknown (pinned by ORT tools/ci_build/build.py at v$ORT_VERSION)"
if [[ -f "$LOG_A" ]]; then
  found="$(grep -oiE 'emsdk[^0-9]{0,12}([0-9]+\.[0-9]+\.[0-9]+)' "$LOG_A" \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
  [[ -n "$found" ]] && EMSDK_VERSION="$found"
fi

IMAGE_ID="$("${DOCKER[@]}" image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || echo unknown)"

echo "==> Installing the verified pair into $DEST"
mkdir -p "$DEST"
cp -v "$OUT_A/$PAIR_WASM" "$DEST/$PAIR_WASM"
cp -v "$OUT_A/$PAIR_MJS" "$DEST/$PAIR_MJS"

( cd "$DEST" && sha256sum "$PAIR_WASM" "$PAIR_MJS" > SHA256SUMS )

cat > "$DEST/BUILD-INFO" <<EOF
# Provenance for the committed Relaxed-SIMD ONNX Runtime WASM pair.
# Produced by scripts/build-ort-relaxed-docker.sh --repro-check, which built
# the pair twice in two fresh containers and confirmed the two results are
# bit-identical. Re-run that command and diff SHA256SUMS to audit these bytes.
ort_version_tag   = v$ORT_VERSION
base_image        = $BASE_DIGEST
node_version      = $NODE_VERSION
emsdk_version     = $EMSDK_VERSION
docker_image      = $IMAGE
docker_image_id   = $IMAGE_ID
build_date_utc    = $(date -u +%Y-%m-%dT%H:%M:%SZ)
repro_check       = PASS (2 independent builds, bit-identical)
EOF

echo
echo "==> Wrote $DEST/SHA256SUMS and $DEST/BUILD-INFO"
cat "$DEST/BUILD-INFO"
echo
echo "==> Note: --repro-check installs by copy, so dist/ does not yet serve the"
echo "    pair. Run \`cd app/ui && npm run build\` (or re-run this script without"
echo "    --repro-check) to have postbuild.mjs manifest dist/ort-relaxed/."
echo "==> Validate per the header of scripts/build-ort-relaxed.sh before shipping."
