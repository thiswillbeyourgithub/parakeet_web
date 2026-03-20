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
REGEX_DIR="/app/ui/public/dictation-regex"
MURMURE_BASE="https://framagit.org/interhop/murmure/-/raw/main/regex"
REGEX_FILES="ponctuation.csv constante.csv controle.csv medicament.csv vocabulaire_medical.csv"

if [ ! -d "$REGEX_DIR" ] || [ -z "$(ls -A "$REGEX_DIR" 2>/dev/null)" ]; then
  echo "[entrypoint] Downloading dictation regex rules from Murmure..."
  mkdir -p "$REGEX_DIR"
  for f in $REGEX_FILES; do
    if wget -q -O "$REGEX_DIR/$f" "$MURMURE_BASE/$f" 2>/dev/null || \
       curl -sfL -o "$REGEX_DIR/$f" "$MURMURE_BASE/$f" 2>/dev/null; then
      echo "[entrypoint] Downloaded $f"
    else
      echo "[entrypoint] WARNING: Failed to download $f"
    fi
  done
  # Write a manifest so the frontend knows which files are available
  ls "$REGEX_DIR"/*.csv 2>/dev/null | xargs -n1 basename > "$REGEX_DIR/manifest.txt" 2>/dev/null || true
  echo "[entrypoint] Dictation regex rules ready in $REGEX_DIR"
else
  echo "[entrypoint] Dictation regex rules already present in $REGEX_DIR"
fi

# Run npm install (picks up any new deps) then start the Vite dev server.
# The CMD from Dockerfile/docker-compose is passed as arguments to this script.
exec sh -c "$* && cd ui && npm install && npm run dev -- --host 0.0.0.0"
