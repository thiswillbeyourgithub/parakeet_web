#!/bin/sh
# Entrypoint for the parakeet-web container.
#
# If a fallback model was baked into the image (under /fallback_models/),
# this script creates a symlink so Vite serves the files at /models/<repoId>.
# Because docker-compose mounts the host's app/ui over the image's /app/ui,
# any files placed there during `docker build` would be hidden.  The symlink
# bridges the gap: the actual weights live outside the mounted volume, but
# Vite still finds them in public/models/.

set -e

# Print detected environment variables so operators can verify configuration
# at a glance in the container logs.
echo "[entrypoint] === Environment variables ==="
echo "[entrypoint] VITE_ALLOWED_HOST=${VITE_ALLOWED_HOST:-(not set)}"
echo "[entrypoint] VITE_USE_POLLING=${VITE_USE_POLLING:-(not set)}"
echo "[entrypoint] VITE_ANALYTICS_URL=${VITE_ANALYTICS_URL:-(not set)}"
echo "[entrypoint] VITE_ANALYTICS_WEBSITE_ID=${VITE_ANALYTICS_WEBSITE_ID:-(not set)}"
echo "[entrypoint] VITE_DICTATION_DEVICE_SUPPORT=${VITE_DICTATION_DEVICE_SUPPORT:-(not set)}"
echo "[entrypoint] VITE_MODEL_REPO=${VITE_MODEL_REPO:-(not set)}"
echo "[entrypoint] VITE_LOCAL_MODEL_FALLBACK=${VITE_LOCAL_MODEL_FALLBACK:-(not set)}"
echo "[entrypoint] FALLBACK_MODEL_REPO=${FALLBACK_MODEL_REPO:-(not set)}"
echo "[entrypoint] FALLBACK_AUTO_DOWNLOAD=${FALLBACK_AUTO_DOWNLOAD:-0}"
echo "[entrypoint] HF_TOKEN=$([ -n "$HF_TOKEN" ] && echo '****(set)' || echo '(not set)')"
echo "[entrypoint] DICTATION_REGEX_SOURCE=${DICTATION_REGEX_SOURCE:-(not set, defaults to Murmure)}"
echo "[entrypoint] =============================="

# ---------- Fallback model: ensure weights exist on the bind mount ---------
# The host bind-mounts /fallback_models. If FALLBACK_MODEL_REPO is set we
# verify vocab.txt is present under /fallback_models/<repo>/. If not:
#   - FALLBACK_AUTO_DOWNLOAD=1 : install uv into /tmp (tmpfs) and download
#     the model via huggingface-cli, confined to the bind mount.
#   - otherwise               : crash so the operator notices the gap.
# uv/uvx are only fetched when auto-download is on, to keep supply-chain
# surface zero on normal runs.
if [ -z "${FALLBACK_MODEL_REPO}" ]; then
  echo "[entrypoint] FALLBACK_MODEL_REPO not set — skipping fallback model setup."
else
  MODEL_DIR="/fallback_models/${FALLBACK_MODEL_REPO}"
  if [ -f "${MODEL_DIR}/vocab.txt" ]; then
    echo "[entrypoint] Fallback model present at ${MODEL_DIR}"
  elif [ "${FALLBACK_AUTO_DOWNLOAD:-0}" = "1" ]; then
    echo "[entrypoint] Fallback model missing at ${MODEL_DIR} — auto-downloading."
    mkdir -p "${MODEL_DIR}"
    # Confine uv to writable tmpfs so a read-only root FS is fine.
    export UV_INSTALL_DIR=/tmp/uv-bin
    export UV_CACHE_DIR=/tmp/uv-cache
    export UV_PYTHON_INSTALL_DIR=/tmp/uv-python
    export PATH="${UV_INSTALL_DIR}:${PATH}"
    if ! command -v uv >/dev/null 2>&1; then
      echo "[entrypoint] Installing uv into ${UV_INSTALL_DIR}..."
      mkdir -p "${UV_INSTALL_DIR}"
      if command -v wget >/dev/null 2>&1; then
        wget -qO- https://astral.sh/uv/install.sh | sh
      elif command -v curl >/dev/null 2>&1; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
      else
        echo "[entrypoint] ERROR: neither wget nor curl available to fetch uv"
        exit 1
      fi
    fi
    echo "[entrypoint] Downloading ${FALLBACK_MODEL_REPO} from HuggingFace..."
    uvx --from huggingface_hub huggingface-cli download \
      "${FALLBACK_MODEL_REPO}" --local-dir "${MODEL_DIR}"
    if [ ! -f "${MODEL_DIR}/vocab.txt" ]; then
      echo "[entrypoint] ERROR: download completed but vocab.txt is still missing in ${MODEL_DIR}"
      exit 1
    fi
    echo "[entrypoint] Fallback model downloaded to ${MODEL_DIR}"
  else
    echo "[entrypoint] ERROR: fallback model missing at ${MODEL_DIR} and FALLBACK_AUTO_DOWNLOAD!=1."
    echo "[entrypoint] Either populate the bind-mounted folder manually or set FALLBACK_AUTO_DOWNLOAD=1."
    exit 1
  fi
fi

# Wire up fallback model files via symlink if they exist.
if [ -d /fallback_models ] && [ "$(ls -A /fallback_models 2>/dev/null)" ]; then
  echo "[entrypoint] Fallback model detected in /fallback_models — creating symlinks..."

  # Walk the org/repo structure inside /fallback_models and mirror it
  # into Vite's public/models/ directory.
  for org_dir in /fallback_models/*/; do
    org=$(basename "$org_dir")
    mkdir -p "/app/ui/public/models/${org}"
    for repo_dir in "$org_dir"*/; do
      repo=$(basename "$repo_dir")
      target="/app/ui/public/models/${org}/${repo}"
      if [ ! -e "$target" ]; then
        ln -s "$repo_dir" "$target"
        echo "[entrypoint] Linked $target -> $repo_dir"
      fi
    done
  done
fi

# Download dictation regex rules from Murmure (framagit.org/interhop/murmure-regex)
# A single CSV file defines all speech-to-text post-processing rules for French dictation.
#
# DICTATION_REGEX_SOURCE overrides the default Murmure URL.
# - If it starts with '/' or './', it is treated as a local folder containing CSV files.
# - Otherwise it is treated as a GitLab repo base URL (the raw CSV is fetched from /-/raw/main/regex.csv).
REGEX_DIR="/app/ui/public/dictation-regex"
DEFAULT_MURMURE_URL="https://framagit.org/interhop/murmure-regex"
REGEX_SOURCE="${DICTATION_REGEX_SOURCE:-$DEFAULT_MURMURE_URL}"

echo "[entrypoint] DICTATION_REGEX_SOURCE=${DICTATION_REGEX_SOURCE:-(not set, using default Murmure)}"

# pick whichever HTTP client is available
_fetch() {
  if command -v wget >/dev/null 2>&1; then wget -q -O "$1" "$2"
  elif command -v curl >/dev/null 2>&1; then curl -sfL -o "$1" "$2"
  else echo "[entrypoint] WARNING: neither wget nor curl found"; return 1; fi
}

mkdir -p "$REGEX_DIR"

# Always refresh CSV files so a new DICTATION_REGEX_SOURCE is picked up on restart.
# Remove stale CSVs from any previous run before copying/downloading fresh ones.
rm -f "$REGEX_DIR"/*.csv "$REGEX_DIR/manifest.txt" 2>/dev/null || true

# Check if the source is a local folder path
case "$REGEX_SOURCE" in
  /*|./*)
    echo "[entrypoint] Using local regex folder: $REGEX_SOURCE"
    if [ -d "$REGEX_SOURCE" ]; then
      cp "$REGEX_SOURCE"/*.csv "$REGEX_DIR/" 2>/dev/null || true
    else
      echo "[entrypoint] WARNING: Local regex folder not found: $REGEX_SOURCE"
    fi
    ;;
  *)
    # Download the single combined regex CSV from the repo
    MURMURE_RAW="${REGEX_SOURCE}/-/raw/main/regex.csv?ref_type=heads"

    echo "[entrypoint] Downloading dictation regex rules from ${REGEX_SOURCE}..."

    if _fetch "$REGEX_DIR/regex.csv" "$MURMURE_RAW"; then
      echo "[entrypoint] Downloaded regex.csv"
    else
      echo "[entrypoint] WARNING: Failed to download regex.csv"
    fi
    ;;
esac

# Write a manifest so the frontend knows which files are available
ls "$REGEX_DIR"/*.csv 2>/dev/null | xargs -n1 basename > "$REGEX_DIR/manifest.txt" 2>/dev/null || true
echo "[entrypoint] Dictation regex rules ready in $REGEX_DIR"

# Start the signaling server in the background.
# Dependencies were installed at build time into /signaling-deps; NODE_PATH
# tells Node where to find them since /signaling is read-only at runtime.
if [ -f /signaling/server.js ]; then
  echo "[entrypoint] Starting signaling server on port ${SIGNALING_PORT:-3001}..."
  NODE_PATH=/signaling-deps/node_modules PORT="${SIGNALING_PORT:-3001}" node /signaling/server.js &
fi

# Run npm install (picks up any new deps) then start the Vite dev server.
# The CMD from Dockerfile/docker-compose is passed as arguments to this script.
exec sh -c "$* && cd ui && npm install && npm run dev -- --host 0.0.0.0"
