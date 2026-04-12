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
echo "[entrypoint] HF_TOKEN=$([ -n "$HF_TOKEN" ] && echo '****(set)' || echo '(not set)')"
echo "[entrypoint] DICTATION_REGEX_SOURCE=${DICTATION_REGEX_SOURCE:-(not set, defaults to Murmure)}"
echo "[entrypoint] =============================="

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

# Download dictation regex rules from Murmure (framagit.org/interhop/murmure)
# These CSV files define speech-to-text post-processing rules for French dictation.
# Uses the GitLab API to discover all CSV files dynamically so new rules are picked up automatically.
#
# DICTATION_REGEX_SOURCE overrides the default Murmure URL.
# - If it starts with '/' or './', it is treated as a local folder containing CSV files.
# - Otherwise it is treated as a GitLab-compatible base URL (with /api/v4/... and /-/raw/main/regex patterns).
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

if [ ! -d "$REGEX_DIR" ] || [ -z "$(ls -A "$REGEX_DIR" 2>/dev/null)" ]; then
  mkdir -p "$REGEX_DIR"

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
      # URL mode: derive API and raw URLs from the base repo URL
      # Convert e.g. https://framagit.org/interhop/murmure to API/raw URLs
      # Extract host and project path
      REPO_HOST=$(echo "$REGEX_SOURCE" | sed 's|^\(https\?://[^/]*\)/.*|\1|')
      REPO_PATH=$(echo "$REGEX_SOURCE" | sed 's|https\?://[^/]*/||')
      ENCODED_PATH=$(echo "$REPO_PATH" | sed 's|/|%2F|g')
      MURMURE_API="${REPO_HOST}/api/v4/projects/${ENCODED_PATH}/repository/tree?path=regex&per_page=100"
      MURMURE_RAW="${REGEX_SOURCE}/-/raw/main/regex"

      echo "[entrypoint] Downloading dictation regex rules from ${REGEX_SOURCE}..."

      # List CSV files via GitLab API (JSON array of {name, type, ...})
      _tmplist=$(mktemp)
      if _fetch "$_tmplist" "$MURMURE_API"; then
        # Extract .csv filenames with lightweight sed (no jq in Alpine by default)
        CSV_FILES=$(sed 's/},{/}\n{/g' "$_tmplist" | grep '"name"' | sed 's/.*"name":"\([^"]*\.csv\)".*/\1/' | grep '\.csv$')
      fi
      rm -f "$_tmplist"

      # Fallback: if API call failed or returned nothing, try known files
      if [ -z "$CSV_FILES" ]; then
        echo "[entrypoint] API listing failed, falling back to known file list"
        CSV_FILES="ponctuation.csv constante.csv controle.csv medicament.csv vocabulaire_medical.csv"
      fi

      for f in $CSV_FILES; do
        if _fetch "$REGEX_DIR/$f" "$MURMURE_RAW/$f"; then
          echo "[entrypoint] Downloaded $f"
        else
          echo "[entrypoint] WARNING: Failed to download $f"
        fi
      done
      ;;
  esac

  # Write a manifest so the frontend knows which files are available
  ls "$REGEX_DIR"/*.csv 2>/dev/null | xargs -n1 basename > "$REGEX_DIR/manifest.txt" 2>/dev/null || true
  echo "[entrypoint] Dictation regex rules ready in $REGEX_DIR"
else
  echo "[entrypoint] Dictation regex rules already present in $REGEX_DIR"
fi

# Run npm install (picks up any new deps) then start the Vite dev server.
# The CMD from Dockerfile/docker-compose is passed as arguments to this script.
exec sh -c "$* && cd ui && npm install && npm run dev -- --host 0.0.0.0"
