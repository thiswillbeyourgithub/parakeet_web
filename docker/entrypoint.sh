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
echo "[entrypoint] VITE_FORCE_LOCAL_MODEL_FALLBACK=${VITE_FORCE_LOCAL_MODEL_FALLBACK:-(not set)}"
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
#     the model via the `hf` CLI, confined to the bind mount.
#   - otherwise               : crash so the operator notices the gap.
if [ -z "${FALLBACK_MODEL_REPO}" ]; then
  echo "[entrypoint] FALLBACK_MODEL_REPO not set — skipping fallback model setup."
else
  MODEL_DIR="/fallback_models/${FALLBACK_MODEL_REPO}"
  if [ -f "${MODEL_DIR}/vocab.txt" ]; then
    echo "[entrypoint] Fallback model present at ${MODEL_DIR}"
  elif [ "${FALLBACK_AUTO_DOWNLOAD:-0}" = "1" ]; then
    echo "[entrypoint] Fallback model missing at ${MODEL_DIR} — auto-downloading."
    echo "[entrypoint] WARNING: hf-xet needs more than 256M of RAM to download the model."
    echo "[entrypoint] If the next step ends with 'Killed', comment out the"
    echo "[entrypoint] 'memory: 256M' line in docker/docker-compose.yml for this first run,"
    echo "[entrypoint] then restore it once /fallback_models/<repo>/vocab.txt exists."
    echo "[entrypoint] WARNING: this path requires /tmp to be mounted with the 'exec' flag"
    echo "[entrypoint] in docker/docker-compose.yml (it already is by default). Once the"
    echo "[entrypoint] model is on disk, you can drop 'exec' from the /tmp tmpfs to shrink"
    echo "[entrypoint] the runtime attack surface."
    mkdir -p "${MODEL_DIR}"
    export UV_INSTALL_DIR=/tmp/uv-bin
    export UV_CACHE_DIR=/tmp/uv-cache
    export UV_PYTHON_INSTALL_DIR=/tmp/uv-python
    # uv writes a "receipt" under $XDG_CONFIG_HOME/uv (defaults to /config/uv,
    # which is on the read-only root fs). Redirect it to the /tmp tmpfs.
    export XDG_CONFIG_HOME=/tmp/uv-config
    export XDG_DATA_HOME=/tmp/uv-data
    mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"
    export PATH="${UV_INSTALL_DIR}:${PATH}"
    if ! command -v uv >/dev/null 2>&1; then
      # Pin the uv installer to a specific version and verify its SHA-256
      # before piping it into a shell. The previous code fetched the
      # latest install.sh straight from astral.sh and ran it unverified,
      # so a CDN compromise or MITM (or even a benign upstream rewrite)
      # could ship arbitrary code into the container.
      #
      # TODO: when bumping UV_VERSION, recompute UV_INSTALL_SHA256 with:
      #   curl -fsSL https://astral.sh/uv/${UV_VERSION}/install.sh \
      #     | sha256sum
      UV_VERSION="${UV_VERSION:-0.5.11}"
      UV_INSTALL_SHA256="${UV_INSTALL_SHA256:-TODO_SHA256_FOR_${UV_VERSION}}"
      UV_INSTALL_URL="https://astral.sh/uv/${UV_VERSION}/install.sh"
      INSTALL_SCRIPT="/tmp/uv-install.sh"
      echo "[entrypoint] Installing uv ${UV_VERSION} into ${UV_INSTALL_DIR}..."
      mkdir -p "${UV_INSTALL_DIR}"
      if command -v wget >/dev/null 2>&1; then
        wget -qO "${INSTALL_SCRIPT}" "${UV_INSTALL_URL}"
      elif command -v curl >/dev/null 2>&1; then
        curl -fsSL -o "${INSTALL_SCRIPT}" "${UV_INSTALL_URL}"
      else
        echo "[entrypoint] ERROR: neither wget nor curl available to fetch uv"
        exit 1
      fi
      ACTUAL_SHA256="$(sha256sum "${INSTALL_SCRIPT}" | awk '{print $1}')"
      if [ "${UV_INSTALL_SHA256}" = "TODO_SHA256_FOR_${UV_VERSION}" ]; then
        echo "[entrypoint] ERROR: UV_INSTALL_SHA256 is unset. Set it to:"
        echo "[entrypoint]   ${ACTUAL_SHA256}"
        echo "[entrypoint] (after verifying the script content) and rebuild."
        exit 1
      fi
      if [ "${ACTUAL_SHA256}" != "${UV_INSTALL_SHA256}" ]; then
        echo "[entrypoint] ERROR: uv installer SHA-256 mismatch."
        echo "[entrypoint]   expected: ${UV_INSTALL_SHA256}"
        echo "[entrypoint]   actual:   ${ACTUAL_SHA256}"
        exit 1
      fi
      sh "${INSTALL_SCRIPT}"
      rm -f "${INSTALL_SCRIPT}"
    fi
    echo "[entrypoint] Downloading ${FALLBACK_MODEL_REPO} from HuggingFace..."
    uvx --from huggingface_hub hf download \
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
# Build config.js by JSON-encoding each value via node. The previous
# double-quoted heredoc let any value containing a quote, backslash, or
# $(...) break out of the JS string literal — an operator setting e.g.
# VITE_MODEL_REPO='";alert(1)//' would inject JS into every served page.
# node is already in the image (signaling sidecar), so this is free.
VITE_DEV_MODE="${VITE_DEV_MODE:-false}" \
VITE_DICTATION_DEVICE_SUPPORT="${VITE_DICTATION_DEVICE_SUPPORT:-true}" \
VITE_MODEL_REPO="${VITE_MODEL_REPO:-istupakov/parakeet-tdt-0.6b-v3-onnx}" \
VITE_LOCAL_MODEL_FALLBACK="${VITE_LOCAL_MODEL_FALLBACK:-}" \
VITE_FORCE_LOCAL_MODEL_FALLBACK="${VITE_FORCE_LOCAL_MODEL_FALLBACK:-}" \
VITE_ANALYTICS_URL="${VITE_ANALYTICS_URL:-}" \
VITE_ANALYTICS_WEBSITE_ID="${VITE_ANALYTICS_WEBSITE_ID:-}" \
node -e '
  const keys = [
    "VITE_DEV_MODE",
    "VITE_DICTATION_DEVICE_SUPPORT",
    "VITE_MODEL_REPO",
    "VITE_LOCAL_MODEL_FALLBACK",
    "VITE_FORCE_LOCAL_MODEL_FALLBACK",
    "VITE_ANALYTICS_URL",
    "VITE_ANALYTICS_WEBSITE_ID",
  ];
  const obj = {};
  for (const k of keys) obj[k] = process.env[k] ?? "";
  process.stdout.write("window.__CONFIG__ = " + JSON.stringify(obj, null, 2) + ";\n");
' > /run/config/config.js
echo "[entrypoint] Wrote runtime config to /run/config/config.js"

# ---------- Start signaling sidecar (background) ---------------------------
if [ -f /signaling/server.js ]; then
  echo "[entrypoint] Starting signaling server on port ${SIGNALING_PORT:-3001}..."
  PORT="${SIGNALING_PORT:-3001}" node /signaling/server.js &
fi

# ---------- Caddy in foreground --------------------------------------------
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
