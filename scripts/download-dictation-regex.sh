#!/bin/sh
# Download dictation regex rules from Murmure for local development (non-Docker).
# Usage: ./scripts/download-dictation-regex.sh
# The rules are placed in app/ui/public/dictation-regex/ so Vite serves them.
# Uses the GitLab API to discover all CSV files dynamically.

set -e

REGEX_DIR="$(dirname "$0")/../app/ui/public/dictation-regex"
DEFAULT_MURMURE_URL="https://framagit.org/interhop/murmure"
REGEX_SOURCE="${DICTATION_REGEX_SOURCE:-$DEFAULT_MURMURE_URL}"

mkdir -p "$REGEX_DIR"

# Check if the source is a local folder path
case "$REGEX_SOURCE" in
  /*|./*)
    echo "Using local regex folder: $REGEX_SOURCE"
    if [ -d "$REGEX_SOURCE" ]; then
      cp "$REGEX_SOURCE"/*.csv "$REGEX_DIR/" 2>/dev/null || { echo "ERROR: no CSV files found in $REGEX_SOURCE"; exit 1; }
    else
      echo "ERROR: Local regex folder not found: $REGEX_SOURCE"; exit 1
    fi
    ;;
  *)
    # URL mode: derive API and raw URLs from the base repo URL
    REPO_HOST=$(echo "$REGEX_SOURCE" | sed 's|^\(https\?://[^/]*\)/.*|\1|')
    REPO_PATH=$(echo "$REGEX_SOURCE" | sed 's|https\?://[^/]*/||')
    ENCODED_PATH=$(echo "$REPO_PATH" | sed 's|/|%2F|g')
    MURMURE_API="${REPO_HOST}/api/v4/projects/${ENCODED_PATH}/repository/tree?path=regex&per_page=100"
    MURMURE_RAW="${REGEX_SOURCE}/-/raw/main/regex"

    # Discover CSV files via GitLab API
    echo "Listing CSV files from ${REGEX_SOURCE} regex/ folder..."
    if command -v curl >/dev/null 2>&1; then
      API_RESPONSE=$(curl -sfL "$MURMURE_API")
    elif command -v wget >/dev/null 2>&1; then
      API_RESPONSE=$(wget -q -O- "$MURMURE_API")
    else
      echo "ERROR: neither curl nor wget found"; exit 1
    fi

    # Extract .csv filenames (lightweight, no jq dependency)
    CSV_FILES=$(echo "$API_RESPONSE" | sed 's/},{/}\n{/g' | grep '"name"' | sed 's/.*"name":"\([^"]*\.csv\)".*/\1/' | grep '\.csv$')

    if [ -z "$CSV_FILES" ]; then
      echo "WARNING: API listing failed, falling back to known file list"
      CSV_FILES="ponctuation.csv constante.csv controle.csv medicament.csv vocabulaire_medical.csv"
    fi

    for f in $CSV_FILES; do
      echo "Downloading $f..."
      if command -v curl >/dev/null 2>&1; then
        curl -sfL -o "$REGEX_DIR/$f" "$MURMURE_RAW/$f"
      else
        wget -q -O "$REGEX_DIR/$f" "$MURMURE_RAW/$f"
      fi
    done
    ;;
esac

# Write manifest
ls "$REGEX_DIR"/*.csv | xargs -n1 basename > "$REGEX_DIR/manifest.txt"
echo "Done. ${REGEX_DIR} now contains:"
ls -la "$REGEX_DIR"
