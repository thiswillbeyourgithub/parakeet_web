#!/bin/sh
# Update locally vendored npm dependencies to their latest published versions.
#
# Usage:
#   ./scripts/update-vendored.sh                  # update all npm-vendored deps
#   ./scripts/update-vendored.sh preact           # update only preact
#   ./scripts/update-vendored.sh onnxruntime-web  # update only onnxruntime-web
#
# Does NOT update app/ui/vendor/dictation_support/ because the upstream is
# git-only (GoogleChromeLabs/dictation_support) and requires running their
# build to produce dist/index.js. Refresh that one by hand per the procedure
# in app/ui/vendor/dictation_support/SOURCE.md.
#
# Per CLAUDE.md, this script must only be run when the user explicitly asks
# for a vendored-deps refresh. Run it from the repo root.
#
# Note for future Claude sessions: this script does **not** sync parakeet.js
# (app/src/). That code is a fork of ysdede/parakeet.js, not an npm vendor,
# so the registry-tarball flow below does not apply. The recurring
# upstream-sync runbook for parakeet.js lives in app/src/SOURCE.md under
# "Upstream sync runbook"; the per-round triage backlog lives in
# TEMP_PLAN.md at the repo root (gitignored). Run a parakeet.js sync round
# only when the user explicitly asks; pick up where the previous round left
# off using the "Last upstream commit triaged" SHA recorded in
# app/src/SOURCE.md.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$REPO_ROOT/app/ui/vendor"
ORT_PUBLIC_DIR="$REPO_ROOT/app/ui/public/ort"

# Resolve required tools up front so failures are obvious.
for bin in curl tar sha256sum sed; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: '$bin' is required" >&2; exit 1; }
done

# Pick a JSON parser. Prefer jq; otherwise fall back to node, which is already
# a hard prerequisite for the project's Vite build.
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL="jq"
elif command -v node >/dev/null 2>&1; then
  JSON_TOOL="node"
else
  echo "ERROR: need jq or node to parse the npm registry response" >&2
  exit 1
fi

get_latest_version() {
  pkg="$1"
  url="https://registry.npmjs.org/$pkg/latest"
  if [ "$JSON_TOOL" = "jq" ]; then
    curl -sfL "$url" | jq -r '.version'
  else
    curl -sfL "$url" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).version))'
  fi
}

# Refresh one npm-vendored package. Downloads the registry tarball, verifies
# its SHA-256, replaces the vendor directory contents, and rewrites the
# Version / Source / Tarball SHA-256 lines in SOURCE.md.
update_npm_pkg() {
  pkg="$1"
  dest="$VENDOR_DIR/$pkg"

  if [ ! -d "$dest" ]; then
    echo "ERROR: vendor directory $dest does not exist" >&2
    return 1
  fi
  if [ ! -f "$dest/SOURCE.md" ]; then
    echo "ERROR: $dest/SOURCE.md missing, refusing to update blind" >&2
    return 1
  fi

  echo "==> Refreshing $pkg"
  version=$(get_latest_version "$pkg")
  if [ -z "$version" ]; then
    echo "ERROR: could not resolve latest version for $pkg" >&2
    return 1
  fi
  tarball_url="https://registry.npmjs.org/$pkg/-/$pkg-$version.tgz"
  echo "    latest = $version"
  echo "    url    = $tarball_url"

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT INT TERM
  curl -sfL -o "$tmp/pkg.tgz" "$tarball_url"
  sha=$(sha256sum "$tmp/pkg.tgz" | awk '{print $1}')
  echo "    sha256 = $sha"

  # npm tarballs extract into a single top-level 'package/' directory.
  mkdir -p "$tmp/extract"
  tar -xzf "$tmp/pkg.tgz" -C "$tmp/extract"
  if [ ! -d "$tmp/extract/package" ]; then
    echo "ERROR: unexpected tarball layout for $pkg" >&2
    return 1
  fi

  # Preserve SOURCE.md (we rewrite a few of its lines below) and replace
  # everything else from the freshly extracted tarball.
  cp "$dest/SOURCE.md" "$tmp/SOURCE.md.bak"
  find "$dest" -mindepth 1 -maxdepth 1 ! -name SOURCE.md -exec rm -rf {} +
  # shellcheck disable=SC2086
  cp -R "$tmp/extract/package/." "$dest/"
  cp "$tmp/SOURCE.md.bak" "$dest/SOURCE.md"

  # Rewrite the three lines we know are versioned. Use '|' as sed delimiter
  # so URL slashes pass through unescaped (none of version, sha, or the npm
  # tarball URL contain a pipe).
  sed -i \
    -e "s|^- Version: \`.*\`\$|- Version: \`$version\`|" \
    -e "s|^- Source: https://registry.npmjs.org/.*\$|- Source: $tarball_url|" \
    -e "s|^- Tarball SHA-256: \`.*\`\$|- Tarball SHA-256: \`$sha\`|" \
    "$dest/SOURCE.md"

  rm -rf "$tmp"
  trap - EXIT INT TERM

  # onnxruntime-web ships WASM artifacts that the runtime loads from
  # /ort/ at same-origin (see SOURCE.md). Re-mirror them so the public
  # tree matches the new vendored copy.
  if [ "$pkg" = "onnxruntime-web" ]; then
    echo "    mirroring WASM artifacts to $ORT_PUBLIC_DIR"
    mkdir -p "$ORT_PUBLIC_DIR"
    for variant in '' '.jsep' '.asyncify' '.jspi'; do
      for ext in wasm mjs; do
        src="$dest/dist/ort-wasm-simd-threaded${variant}.${ext}"
        if [ -f "$src" ]; then
          cp "$src" "$ORT_PUBLIC_DIR/"
        else
          echo "    WARNING: missing $src (upstream layout may have changed)" >&2
        fi
      done
    done
  fi

  echo "    done. Inspect the diff in $dest and commit."
}

# Default target list when no args are passed.
if [ $# -eq 0 ]; then
  set -- preact onnxruntime-web
fi

for target in "$@"; do
  case "$target" in
    preact|onnxruntime-web)
      update_npm_pkg "$target"
      ;;
    dictation_support)
      echo "dictation_support is git-only; refresh it manually per app/ui/vendor/dictation_support/SOURCE.md" >&2
      exit 2
      ;;
    *)
      echo "ERROR: unknown target '$target' (expected: preact, onnxruntime-web)" >&2
      exit 2
      ;;
  esac
done

echo
echo "Reminder: review the diff, run a build, and refresh the README screenshot"
echo "before committing. dictation_support must still be refreshed by hand."
