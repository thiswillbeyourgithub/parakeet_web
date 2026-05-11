#!/bin/sh
# Entrypoint for the parakeetweb production container.
#
# - Verifies the fallback model is present at LOCAL_MODEL_PATH (operator
#   bind-mounts a host folder containing the ONNX files into the container).
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
echo "[entrypoint] VITE_MODEL_REVISION=${VITE_MODEL_REVISION:-(not set, uses models.js per-model pin)}"
echo "[entrypoint] VITE_LOCAL_MODEL_FALLBACK=${VITE_LOCAL_MODEL_FALLBACK:-(not set)}"
echo "[entrypoint] VITE_FORCE_LOCAL_MODEL_FALLBACK=${VITE_FORCE_LOCAL_MODEL_FALLBACK:-(not set)}"
echo "[entrypoint] LOCAL_MODEL_PATH=${LOCAL_MODEL_PATH:-(not set)}"
echo "[entrypoint] DICTATION_REGEX_SOURCE=${DICTATION_REGEX_SOURCE:-(not set, defaults to Murmure)}"
echo "[entrypoint] SIGNALING_PORT=${SIGNALING_PORT:-3001}"
echo "[entrypoint] =============================="

# ---------- Fallback model: ensure weights exist on the bind mount ---------
# When LOCAL_MODEL_PATH is set, the operator has bind-mounted a folder of
# ONNX files into the container. We verify vocab.txt is present and let
# Caddy serve that folder under /models/ (see Caddyfile).
if [ -z "${LOCAL_MODEL_PATH}" ]; then
  echo "[entrypoint] LOCAL_MODEL_PATH not set — skipping fallback model setup."
else
  if [ -f "${LOCAL_MODEL_PATH}/vocab.txt" ]; then
    echo "[entrypoint] Fallback model present at ${LOCAL_MODEL_PATH}"
  else
    echo "[entrypoint] ERROR: fallback model missing at ${LOCAL_MODEL_PATH}."
    echo "[entrypoint] Bind-mount a folder of ONNX files into the container at"
    echo "[entrypoint] ${LOCAL_MODEL_PATH} (flat layout — vocab.txt and the .onnx"
    echo "[entrypoint] files directly inside). Pre-populate the host folder with e.g.:"
    echo "[entrypoint]   hf download istupakov/parakeet-tdt-0.6b-v3-onnx \\"
    echo "[entrypoint]     --local-dir /some/host/path"
    exit 1
  fi
fi

# ---------- Dictation regex rules ------------------------------------------
# DICTATION_REGEX_SOURCE overrides the default Murmure URL.
# - If it starts with '/' or './', it's a local folder of CSV files.
# - Otherwise it's a GitLab repo base URL; the raw CSV is fetched from
#   /-/raw/main/regex.csv.
REGEX_DIR="/var/regex"
DEFAULT_MURMURE_URL="https://framagit.org/interhop/murmure-regex"
REGEX_SOURCE="${DICTATION_REGEX_SOURCE:-$DEFAULT_MURMURE_URL}"

if ! _validate_regex_source "$REGEX_SOURCE"; then
  echo "[entrypoint] ERROR: DICTATION_REGEX_SOURCE has an unsupported shape: $REGEX_SOURCE"
  echo "[entrypoint] Allowed values: '/abs/path', './rel/path', or 'https://host/path'."
  echo "[entrypoint] Refusing to start so an operator typo cannot silently leak"
  echo "[entrypoint] container files or follow a redirect to internal endpoints."
  exit 1
fi

_fetch() {
  # Refuse non-HTTPS, refuse redirects. Without this, a framagit-side
  # redirect to e.g. http://169.254.169.254/... (cloud instance metadata)
  # or an operator typo of file://... would be silently followed and the
  # result served same-origin under /dictation-regex/.
  if command -v wget >/dev/null 2>&1; then
    wget -q --max-redirect=0 -O "$1" "$2"
  elif command -v curl >/dev/null 2>&1; then
    curl -sf --proto '=https' --max-redirs 0 -o "$1" "$2"
  else
    echo "[entrypoint] WARNING: neither wget nor curl found"
    return 1
  fi
}

# Validate DICTATION_REGEX_SOURCE early. Accept only:
#   - absolute or ./relative local folder path
#   - https://<host>/<path> URL (no leading whitespace, no scheme other
#     than https). file://, http://, gopher://, etc. would otherwise be
#     interpolated straight into the wget/curl invocation.
_validate_regex_source() {
  # Allowlist of characters acceptable in either a local path or an https
  # URL. POSIX `case` glob, so portable across busybox ash / dash / bash.
  # Rejects whitespace, $, `, ;, &, |, <, >, quotes, etc., any of which
  # would let an operator typo turn into a fetch with redirect, command
  # substitution, or non-https scheme.
  case "$1" in
    *[!A-Za-z0-9:/._?=\&%-]*) return 1 ;;
  esac
  case "$1" in
    /*|./*|https://*) return 0 ;;
    *) return 1 ;;
  esac
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
#
# IMPORTANT INVARIANT: the generated file is served as an EXTERNAL
# <script src="/config.js"> in index.html and remote-mic.html.
# JSON.stringify does not escape "</script>", U+2028, or U+2029, so
# inlining the config into HTML would turn an operator-set value such
# as VITE_ANALYTICS_URL=...</script><script>alert(1)// into XSS for
# every visitor. We still post-process the output (defense in depth)
# so that even if a future refactor inlines the config, it stays safe.
VITE_DEV_MODE="${VITE_DEV_MODE:-false}" \
VITE_DICTATION_DEVICE_SUPPORT="${VITE_DICTATION_DEVICE_SUPPORT:-true}" \
VITE_MODEL_REPO="${VITE_MODEL_REPO:-istupakov/parakeet-tdt-0.6b-v3-onnx}" \
VITE_MODEL_REVISION="${VITE_MODEL_REVISION:-}" \
VITE_LOCAL_MODEL_FALLBACK="${VITE_LOCAL_MODEL_FALLBACK:-}" \
VITE_FORCE_LOCAL_MODEL_FALLBACK="${VITE_FORCE_LOCAL_MODEL_FALLBACK:-}" \
VITE_ANALYTICS_URL="${VITE_ANALYTICS_URL:-}" \
VITE_ANALYTICS_WEBSITE_ID="${VITE_ANALYTICS_WEBSITE_ID:-}" \
VITE_ANALYTICS_SRI="${VITE_ANALYTICS_SRI:-}" \
node -e '
  const keys = [
    "VITE_DEV_MODE",
    "VITE_DICTATION_DEVICE_SUPPORT",
    "VITE_MODEL_REPO",
    "VITE_MODEL_REVISION",
    "VITE_LOCAL_MODEL_FALLBACK",
    "VITE_FORCE_LOCAL_MODEL_FALLBACK",
    "VITE_ANALYTICS_URL",
    "VITE_ANALYTICS_WEBSITE_ID",
    "VITE_ANALYTICS_SRI",
  ];
  const obj = {};
  for (const k of keys) obj[k] = process.env[k] ?? "";
  const safe = JSON.stringify(obj, null, 2)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  process.stdout.write("window.__CONFIG__ = " + safe + ";\n");
' > /run/config/config.js
echo "[entrypoint] Wrote runtime config to /run/config/config.js"

# ---------- Start signaling sidecar (background) ---------------------------
if [ -f /signaling/server.js ]; then
  echo "[entrypoint] Starting signaling server on port ${SIGNALING_PORT:-3001}..."
  PORT="${SIGNALING_PORT:-3001}" node /signaling/server.js &
fi

# ---------- Caddy in foreground --------------------------------------------
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
