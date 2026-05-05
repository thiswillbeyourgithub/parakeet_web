#!/bin/sh
# Entrypoint for the parakeetweb production container.
#
# - Verifies / optionally downloads the fallback model into /fallback_models.
# - Populates /var/regex with the dictation regex CSV(s).
# - Generates /run/config/config.js so the static bundle picks up runtime
#   VITE_* envs without needing a rebuild.
# - Starts the signaling Node sidecar in the background, then execs Caddy in
#   the foreground.

set -e

echo "[entrypoint] === Environment variables ==="
echo "[entrypoint] VITE_DEV_MODE=${VITE_DEV_MODE:-(not set)}"
echo "[entrypoint] VITE_ANALYTICS_URL=${VITE_ANALYTICS_URL:-(not set)}"
echo "[entrypoint] VITE_ANALYTICS_WEBSITE_ID=${VITE_ANALYTICS_WEBSITE_ID:-(not set)}"
echo "[entrypoint] VITE_DICTATION_DEVICE_SUPPORT=${VITE_DICTATION_DEVICE_SUPPORT:-(not set)}"
echo "[entrypoint] VITE_MODEL_REPO=${VITE_MODEL_REPO:-(not set)}"
echo "[entrypoint] VITE_LOCAL_MODEL_FALLBACK=${VITE_LOCAL_MODEL_FALLBACK:-(not set)}"
echo "[entrypoint] FALLBACK_MODEL_REPO=${FALLBACK_MODEL_REPO:-(not set)}"
echo "[entrypoint] FALLBACK_AUTO_DOWNLOAD=${FALLBACK_AUTO_DOWNLOAD:-0}"
echo "[entrypoint] HF_TOKEN=$([ -n "$HF_TOKEN" ] && echo '****(set)' || echo '(not set)')"
echo "[entrypoint] DICTATION_REGEX_SOURCE=${DICTATION_REGEX_SOURCE:-(not set, defaults to Murmure)}"
echo "[entrypoint] SIGNALING_PORT=${SIGNALING_PORT:-3001}"
echo "[entrypoint] =============================="

# ---------- Fallback model: ensure weights exist on the bind mount ---------
# The host bind-mounts /fallback_models. If FALLBACK_MODEL_REPO is set we
# verify vocab.txt is present under /fallback_models/<repo>/. If not:
#   - FALLBACK_AUTO_DOWNLOAD=1 : install uv into /tmp (tmpfs) and download
#     the model via huggingface-cli, confined to the bind mount.
#   - otherwise               : crash so the operator notices the gap.
if [ -z "${FALLBACK_MODEL_REPO}" ]; then
  echo "[entrypoint] FALLBACK_MODEL_REPO not set — skipping fallback model setup."
else
  MODEL_DIR="/fallback_models/${FALLBACK_MODEL_REPO}"
  if [ -f "${MODEL_DIR}/vocab.txt" ]; then
    echo "[entrypoint] Fallback model present at ${MODEL_DIR}"
  elif [ "${FALLBACK_AUTO_DOWNLOAD:-0}" = "1" ]; then
    echo "[entrypoint] Fallback model missing at ${MODEL_DIR} — auto-downloading."
    mkdir -p "${MODEL_DIR}"
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
# Caddy serves /fallback_models directly via handle_path /models/* — no
# in-container symlinks required.

# ---------- Dictation regex rules ------------------------------------------
# DICTATION_REGEX_SOURCE overrides the default Murmure URL.
# - If it starts with '/' or './', it's a local folder of CSV files.
# - Otherwise it's a GitLab repo base URL; the raw CSV is fetched from
#   /-/raw/main/regex.csv.
REGEX_DIR="/var/regex"
DEFAULT_MURMURE_URL="https://framagit.org/interhop/murmure-regex"
REGEX_SOURCE="${DICTATION_REGEX_SOURCE:-$DEFAULT_MURMURE_URL}"

_fetch() {
  if command -v wget >/dev/null 2>&1; then wget -q -O "$1" "$2"
  elif command -v curl >/dev/null 2>&1; then curl -sfL -o "$1" "$2"
  else echo "[entrypoint] WARNING: neither wget nor curl found"; return 1; fi
}

mkdir -p "$REGEX_DIR"
rm -f "$REGEX_DIR"/*.csv "$REGEX_DIR/manifest.txt" 2>/dev/null || true

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
    MURMURE_RAW="${REGEX_SOURCE}/-/raw/main/regex.csv?ref_type=heads"
    echo "[entrypoint] Downloading dictation regex rules from ${REGEX_SOURCE}..."
    if _fetch "$REGEX_DIR/regex.csv" "$MURMURE_RAW"; then
      echo "[entrypoint] Downloaded regex.csv"
    else
      echo "[entrypoint] WARNING: Failed to download regex.csv"
    fi
    ;;
esac

ls "$REGEX_DIR"/*.csv 2>/dev/null | xargs -n1 basename > "$REGEX_DIR/manifest.txt" 2>/dev/null || true
echo "[entrypoint] Dictation regex rules ready in $REGEX_DIR"

# ---------- Runtime VITE_* config injection --------------------------------
# /srv is read-only at runtime, so config.js lives on a tmpfs at /run/config
# and Caddy serves it via the matching `handle /config.js` route.
mkdir -p /run/config
cat > /run/config/config.js <<EOF
window.__CONFIG__ = {
  VITE_DEV_MODE: "${VITE_DEV_MODE:-false}",
  VITE_DICTATION_DEVICE_SUPPORT: "${VITE_DICTATION_DEVICE_SUPPORT:-true}",
  VITE_MODEL_REPO: "${VITE_MODEL_REPO:-istupakov/parakeet-tdt-0.6b-v3-onnx}",
  VITE_LOCAL_MODEL_FALLBACK: "${VITE_LOCAL_MODEL_FALLBACK:-}",
  VITE_ANALYTICS_URL: "${VITE_ANALYTICS_URL:-}",
  VITE_ANALYTICS_WEBSITE_ID: "${VITE_ANALYTICS_WEBSITE_ID:-}",
};
EOF
echo "[entrypoint] Wrote runtime config to /run/config/config.js"

# ---------- Start signaling sidecar (background) ---------------------------
if [ -f /signaling/server.js ]; then
  echo "[entrypoint] Starting signaling server on port ${SIGNALING_PORT:-3001}..."
  PORT="${SIGNALING_PORT:-3001}" node /signaling/server.js &
fi

# ---------- Caddy in foreground --------------------------------------------
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
