#!/usr/bin/env bash
# Generate the zstd sidecars Caddy's `file_server { precompressed zstd }` serves
# for the locally hosted model files, and prune any that went stale.
#
# Why this exists. The model weights are served as application/octet-stream, and
# Caddy's `encode` directive deliberately skips that content type, so today the
# full 841 MB int8 encoder goes over the wire uncompressed on every first load.
# Measured on that file: zstd -9 brings it to 643 MB (27% off, ~240 MB saved),
# and the browser decompresses it natively at ~3 s. Nothing in the app changes,
# because a Content-Encoding response is decoded before `fetch` hands over the
# body.
#
# Compressing on the fly instead (a content-type match on `encode`) would cost
# 6-11 s of server CPU per download per visitor, which is why the bytes are
# prepared once here rather than per request.
#
# Staleness is the one real hazard: a sidecar that is older than its source
# would be served to every zstd-capable browser while the plain file is correct,
# which is silent and affects only some visitors. So this script never leaves an
# out-of-date sidecar behind: it regenerates the ones it can and DELETES any it
# cannot, since serving the uncompressed file is exactly today's behaviour and
# always safe.
#
# Usage:
#   ./scripts/precompress-models.sh [MODEL_DIR] [--level N] [--jobs N] [--prune-only]
#
# MODEL_DIR defaults to $LOCAL_MODEL_PATH, then ./fallback_models.
# Idempotent: an up-to-date sidecar is left alone, so re-running is nearly free.
#
# Built with Claude Code.

set -euo pipefail

LEVEL=9          # -9 measured 643 MB vs -3's 665 MB on the int8 encoder, and
                 # compression happens once, so the extra 5 s is free.
JOBS=0           # 0 => zstd -T0, one thread per core
PRUNE_ONLY=0
DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --*=*)       set -- "${1%%=*}" "${1#*=}" "${@:2}";;
    --level)     LEVEL="$2"; shift 2;;
    --jobs)      JOBS="$2"; shift 2;;
    --prune-only) PRUNE_ONLY=1; shift;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0;;
    -*)          echo "unknown option: $1" >&2; exit 2;;
    *)           DIR="$1"; shift;;
  esac
done

DIR="${DIR:-${LOCAL_MODEL_PATH:-./fallback_models}}"

if [[ ! -d "$DIR" ]]; then
  echo "[precompress] no model dir at $DIR, nothing to do" >&2
  exit 0
fi

if ! command -v zstd >/dev/null 2>&1; then
  echo "[precompress] zstd not installed; skipping (Caddy will serve the plain files)" >&2
  exit 0
fi

# Only the big ones are worth a sidecar. vocab.txt and config.json are text, so
# Caddy's on-the-fly `encode` already covers them at negligible CPU cost.
mapfile -t SOURCES < <(find -L "$DIR" -type f \
  \( -name '*.onnx' -o -name '*.onnx.data' -o -name '*.onnx.data.[0-9][0-9][0-9]' \) \
  ! -name '*.zst' | sort)

if [[ ${#SOURCES[@]} -eq 0 ]]; then
  echo "[precompress] no model weight files under $DIR" >&2
  exit 0
fi

# The same bytes are usually reachable by more than one path. A maintainer's
# tree keeps the weights in a nested folder and links them into the root,
# because the root is the flat layout Caddy serves; `sharded` is a symlinked
# directory, so its files show up twice as well. Compressing each view would
# spend ~600 MB and several seconds per duplicate, and compressing only the
# real file would leave the served path without a sidecar (Caddy looks for
# `<requested path>.zst`, not the target's). So: compress each set of bytes
# ONCE, next to the real file, and give every other view a symlink to that
# sidecar. The link target is relative, so a deploy rsync carries it intact.
declare -A CANON=()   # resolved real path -> the path we compress
ALIASES=()            # every other path that reaches the same bytes
CANON_ORDER=()

for pass in real other; do
  for src in "${SOURCES[@]}"; do
    real=$(readlink -f "$src" 2>/dev/null) || continue
    [[ -n "$real" ]] || continue
    nosym=$(realpath -s "$src" 2>/dev/null) || continue
    is_real=0; [[ "$nosym" == "$real" ]] && is_real=1
    # First pass claims the genuine on-disk paths, so a sidecar is never
    # written through a symlink when a real path for the same bytes exists.
    if [[ $pass == real && $is_real -eq 0 ]]; then continue; fi
    if [[ -n "${CANON[$real]:-}" ]]; then
      [[ "${CANON[$real]}" == "$src" ]] || ALIASES+=("$src")
    else
      CANON[$real]="$src"
      CANON_ORDER+=("$src")
    fi
  done
done

writable=1
[[ -w "$DIR" ]] || writable=0

made=0 kept=0 pruned=0 failed=0 linked=0

for src in "${CANON_ORDER[@]}"; do
  sidecar="$src.zst"

  # Up to date: sidecar exists and is not older than its source.
  if [[ -f "$sidecar" && ! "$sidecar" -ot "$src" ]]; then
    kept=$((kept + 1))
    continue
  fi

  # Stale or missing. Either way the sidecar must not survive as it is.
  if [[ -f "$sidecar" ]]; then
    if rm -f "$sidecar" 2>/dev/null; then
      pruned=$((pruned + 1))
    else
      echo "[precompress] STALE sidecar cannot be removed: $sidecar" >&2
      echo "[precompress]   it is older than $src and would be served instead of it" >&2
      failed=$((failed + 1))
      continue
    fi
  fi

  if [[ $PRUNE_ONLY -eq 1 ]]; then
    continue
  fi

  if [[ $writable -eq 0 ]]; then
    echo "[precompress] $DIR is not writable, cannot generate $(basename "$sidecar")" >&2
    failed=$((failed + 1))
    continue
  fi

  # Write to a temp name and move into place, so an interrupted run can never
  # leave a truncated sidecar that Caddy would happily serve as a whole model.
  tmp="$sidecar.tmp$$"
  if zstd -q -"$LEVEL" -T"$JOBS" -o "$tmp" "$src" 2>/dev/null && mv -f "$tmp" "$sidecar"; then
    made=$((made + 1))
    echo "[precompress] $(basename "$src"): $(du -h "$src" | cut -f1) -> $(du -h "$sidecar" | cut -f1)"
  else
    rm -f "$tmp"
    echo "[precompress] failed to compress $src" >&2
    failed=$((failed + 1))
  fi
done

# Every other path that reaches the same bytes gets a symlink to the sidecar
# generated (or kept) above, so the flat layout is served compressed without a
# second copy on disk. A sidecar that does not exist is never linked to: a
# dangling `.zst` would make Caddy fall back to the plain file (harmless) but
# would also trip the tier-3 dangling-symlink check
# (test/e2e/dangling-links.mjs), so it must not be created.
for alias in "${ALIASES[@]}"; do
  real=$(readlink -f "$alias" 2>/dev/null) || continue
  canon="${CANON[$real]:-}"
  [[ -n "$canon" && -f "$canon.zst" ]] || continue

  # When the duplicate view comes from a symlinked DIRECTORY (`sharded` is one),
  # `$alias.zst` and `$canon.zst` name the very same file. There is nothing to
  # link, and writing here would delete the sidecar we just generated.
  if [[ "$(readlink -f "$(dirname "$alias")")" == "$(readlink -f "$(dirname "$canon")")" ]]; then
    kept=$((kept + 1))
    continue
  fi

  # -s keeps this lexical: without it realpath resolves the alias's own
  # directory back to the canonical one and computes a self-reference.
  want=$(realpath -m -s --relative-to="$(dirname "$alias")" "$canon.zst")
  link="$alias.zst"
  if [[ -L "$link" && "$(readlink "$link")" == "$want" && -e "$link" ]]; then
    kept=$((kept + 1))
    continue
  fi
  # An older run of this script wrote a full second copy here; replacing it
  # with the link is what reclaims that space.
  if [[ -e "$link" || -L "$link" ]]; then
    rm -f "$link" 2>/dev/null && pruned=$((pruned + 1))
  fi
  if ln -sfn "$want" "$link" 2>/dev/null && [[ -e "$link" ]]; then
    linked=$((linked + 1))
  else
    # Never leave a dangling sidecar behind: Caddy would just serve the plain
    # file, but the tier-3 dangling-symlink check treats a broken link in the
    # served set as a hard failure, and it would be right to.
    rm -f "$link" 2>/dev/null
    echo "[precompress] failed to link $link -> $want" >&2
    failed=$((failed + 1))
  fi
done

echo "[precompress] $made generated, $linked linked, $kept already current, $pruned stale removed, $failed failed"
# A failure here is never fatal: without a sidecar Caddy serves the plain file,
# which is what it does today.
exit 0
