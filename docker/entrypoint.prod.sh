#!/bin/sh
# Production entrypoint: serves a pre-built Vite bundle via `vite preview`.
# Unlike the dev entrypoint there are no bind mounts — everything is baked in.

set -e

echo "[entrypoint] === Production mode ==="
echo "[entrypoint] VITE_ALLOWED_HOST=${VITE_ALLOWED_HOST:-(not set)}"
echo "[entrypoint] VITE_LOCAL_MODEL_FALLBACK=${VITE_LOCAL_MODEL_FALLBACK:-(not set)}"
echo "[entrypoint] SIGNALING_PORT=${SIGNALING_PORT:-3001}"
echo "[entrypoint] ===================================="

# Wire up fallback model files into dist/ via symlink if they were baked into the image.
if [ -d /fallback_models ] && [ "$(ls -A /fallback_models 2>/dev/null)" ]; then
  echo "[entrypoint] Fallback model detected — creating symlinks into dist/..."
  for org_dir in /fallback_models/*/; do
    org=$(basename "$org_dir")
    mkdir -p "/app/ui/dist/models/${org}"
    for repo_dir in "$org_dir"*/; do
      repo=$(basename "$repo_dir")
      target="/app/ui/dist/models/${org}/${repo}"
      if [ ! -e "$target" ]; then
        ln -s "$repo_dir" "$target"
        echo "[entrypoint] Linked $target -> $repo_dir"
      fi
    done
  done
fi

# Download dictation regex rules into dist/ so vite preview can serve them.
REGEX_DIR="/app/ui/dist/dictation-regex"
DEFAULT_MURMURE_URL="https://framagit.org/interhop/murmure-regex"
REGEX_SOURCE="${DICTATION_REGEX_SOURCE:-$DEFAULT_MURMURE_URL}"

_fetch() {
  if command -v wget >/dev/null 2>&1; then wget -q -O "$1" "$2"
  elif command -v curl >/dev/null 2>&1; then curl -sfL -o "$1" "$2"
  else echo "[entrypoint] WARNING: neither wget nor curl found"; return 1; fi
}

if [ ! -d "$REGEX_DIR" ] || [ -z "$(ls -A "$REGEX_DIR" 2>/dev/null)" ]; then
  mkdir -p "$REGEX_DIR"
  case "$REGEX_SOURCE" in
    /*|./*)
      echo "[entrypoint] Using local regex folder: $REGEX_SOURCE"
      [ -d "$REGEX_SOURCE" ] && cp "$REGEX_SOURCE"/*.csv "$REGEX_DIR/" 2>/dev/null || true
      ;;
    *)
      MURMURE_RAW="${REGEX_SOURCE}/-/raw/main/regex.csv?ref_type=heads"
      echo "[entrypoint] Downloading dictation regex from ${REGEX_SOURCE}..."
      _fetch "$REGEX_DIR/regex.csv" "$MURMURE_RAW" && echo "[entrypoint] Downloaded regex.csv" \
        || echo "[entrypoint] WARNING: Failed to download regex.csv"
      ;;
  esac
  ls "$REGEX_DIR"/*.csv 2>/dev/null | xargs -n1 basename > "$REGEX_DIR/manifest.txt" 2>/dev/null || true
fi

# Start signaling server in the background.
if [ -f /signaling/server.js ]; then
  echo "[entrypoint] Starting signaling server on port ${SIGNALING_PORT:-3001}..."
  NODE_PATH=/signaling-deps/node_modules PORT="${SIGNALING_PORT:-3001}" node /signaling/server.js &
fi

# Serve the pre-built bundle via vite preview (handles COOP/COEP headers + signal proxy).
echo "[entrypoint] Starting vite preview on port 5173..."
exec sh -c "cd /app/ui && npx vite preview"
