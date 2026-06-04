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

# ---------- Helper functions ------------------------------------------------
# F-98: every helper used by this script MUST be defined before the first
# call site. POSIX /bin/sh (dash, busybox ash) does NOT hoist function
# definitions: a forward reference returns 127 ("command not found"),
# and inside an `if ! cmd; then ... fi` that 127 inverts to true and
# fires the error branch. The previous layout placed _validate_regex_source
# below its caller, so the container exited 1 on every startup with no
# diagnostic. Same issue would have struck _validate_csp_hosts. Keep
# every helper inside this block.

# Refuse non-HTTPS, refuse redirects. Without this, a framagit-side
# redirect to e.g. http://169.254.169.254/... (cloud instance metadata)
# or an operator typo of file://... would be silently followed and the
# result served same-origin under /dictation-regex/.
_fetch() {
  if command -v wget >/dev/null 2>&1; then
    wget -q --max-redirect=0 -O "$1" "$2"
  elif command -v curl >/dev/null 2>&1; then
    curl -sf --proto '=https' --max-redirs 0 -o "$1" "$2"
  else
    echo "[entrypoint] WARNING: neither wget nor curl found"
    return 1
  fi
}

# F-102: byte-level DoS protection. The dictation CSV (and the boost
# phrase lists) are fetched at container start from a third-party Git
# host or an operator folder. A poisoned upstream (account takeover,
# one-shot MITM during container boot, malicious fork in a misconfigured
# DICTATION_REGEX_SOURCE / BOOST_PHRASES_SOURCE) can serve a multi-GB
# body; Caddy then file_servers that body to every visitor, who calls
# .text() on the response with no cap and OOMs the tab. Legitimate
# Murmure CSV is ~30 KB; the cap below is two orders of magnitude
# headroom. Refuse to start with a missing file rather than a giant
# one so the operator notices.
_SERVED_MAX_BYTES=5242880
_enforce_size_cap() {
  # $1: file path, $2: max bytes
  [ -f "$1" ] || return 0
  sz=$(stat -c%s "$1" 2>/dev/null || wc -c <"$1")
  if [ "$sz" -gt "$2" ]; then
    echo "[entrypoint] WARNING: $1 exceeds size cap ($sz > $2 bytes); deleting"
    rm -f "$1"
    return 1
  fi
  return 0
}

# Shared finalizer for a served directory of operator-supplied files
# (dictation-regex CSVs, boost-phrase TXTs). Enforces the byte cap on
# every matching file (a local-folder typo could still point at /etc or
# a giant log) and (re)writes the manifest.txt that the browser fetches
# to discover which files exist. Centralised here so the regex and boost
# paths cannot drift apart.
_finalize_served_dir() {
  # $1: directory, $2: file extension without dot (e.g. csv, txt)
  for f in "$1"/*."$2"; do
    [ -f "$f" ] || continue
    _enforce_size_cap "$f" "$_SERVED_MAX_BYTES" || true
  done
  ls "$1"/*."$2" 2>/dev/null | xargs -n1 basename > "$1/manifest.txt" 2>/dev/null || true
}

# F-26: Validate DICTATION_REGEX_SOURCE / BOOST_PHRASES_SOURCE early.
# Accept only:
#   - absolute or ./relative local folder path
#   - https://<host>/<path> URL (no leading whitespace, no scheme other
#     than https). file://, http://, gopher://, etc. would otherwise be
#     interpolated straight into the wget/curl invocation.
_validate_source() {
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

# Extract https://host[:port] from a full URL. Stdout on success, exit 1
# on failure. Strict: refuses anything that isn't https://, refuses hosts
# with characters outside the CSP-token allowlist used by
# _validate_csp_hosts. Used to derive a CSP origin from VITE_ANALYTICS_URL.
_extract_origin() {
  _u="${1%%#*}"
  _u="${_u%%\?*}"
  case "$_u" in
    https://*) ;;
    *) return 1 ;;
  esac
  _rest="${_u#https://}"
  _host="${_rest%%/*}"
  case "$_host" in
    '') return 1 ;;
    *[!A-Za-z0-9.:-]*) return 1 ;;
  esac
  printf 'https://%s' "$_host"
}

# F-91: Validate operator-supplied CSP allowlists before they are
# interpolated into Caddy's CSP header. Caddy substitutes the env-var
# value as a literal string; a typo like
#   VITE_CSP_SCRIPT_HOSTS="'unsafe-inline'"
#   VITE_CSP_CONNECT_HOSTS="*"
#   VITE_CSP_CONNECT_HOSTS="https://a.com; default-src *"
# is accepted verbatim and silently widens (or fully disables) the
# policy with no error and no log line. Refuse to start if either
# var contains characters that have CSP-directive semantics or that
# build well-known bypass keywords.
_validate_csp_hosts() {
  # Empty is the documented default, accept it.
  [ -z "$1" ] && return 0
  # Forbid known bypass tokens regardless of casing. The shell glob is
  # case-sensitive; we lowercase via tr first.
  lower=$(printf '%s' "$1" | tr 'A-Z' 'a-z')
  case "$lower" in
    *unsafe-*|*data:*|*blob:*|*"*"*) return 1 ;;
  esac
  # Each space-separated token must look like https://<host>[:port][/path]
  # AND only contain RFC-3986-safe characters. We can't put ASCII space
  # inside a `case` glob bracket in dash (parser bug: `[. -]*)` confuses
  # the `)` lookahead), so we split on whitespace and validate each
  # token's chars separately.
  for token in $1; do
    case "$token" in
      https://*) ;;
      *) return 1 ;;
    esac
    # Per-token char allowlist: letters, digits, : / . - (no space, no
    # quotes, no ; * $ ` etc). Same set as the existing
    # _validate_regex_source token char check.
    case "$token" in
      *[!A-Za-z0-9:/.-]*) return 1 ;;
    esac
  done
  return 0
}

# F-101: Validate VITE_MODEL_REPO and VITE_MODEL_REVISION before they
# reach the browser bundle. Both are concatenated verbatim into the
# HuggingFace URL path AND into the IndexedDB cache key. An operator
# typo with `..` (e.g. revision='main/../../other-owner/other-repo/
# resolve/main') resolves under the URL parser to a different repo
# while staying on huggingface.co, and the bad value gets cached
# forever because it is part of the cache key. Defensive validation
# matches the posture taken by F-26 / F-91 for every other
# operator-supplied env var.
_validate_model_repo() {
  # Empty is fine: the bundle falls back to the default repo.
  [ -z "$1" ] && return 0
  # Forbid ".." substring (parent-dir traversal) and any character
  # outside the HuggingFace repo-id alphabet (letters, digits, _ - . /).
  case "$1" in
    *..*) return 1 ;;
    *[!A-Za-z0-9._/-]*) return 1 ;;
  esac
  # Must look exactly like 'owner/name', no leading/trailing slash, no
  # extra path segments.
  case "$1" in
    */*/*) return 1 ;;
    /*|*/) return 1 ;;
    */*) return 0 ;;
    *) return 1 ;;
  esac
}
_validate_model_revision() {
  # Empty means "use models.js per-model pin", which is the documented
  # default.
  [ -z "$1" ] && return 0
  case "$1" in
    *..*) return 1 ;;
    *[!A-Za-z0-9._-]*) return 1 ;;
  esac
  return 0
}

# Accept only 'hf', 'local', 'both', or empty (defaults to hf in the bundle).
_validate_model_source() {
  case "$1" in
    ''|hf|local|both) return 0 ;;
    *) return 1 ;;
  esac
}

if ! _validate_model_repo "${VITE_MODEL_REPO:-}"; then
  echo "[entrypoint] ERROR: VITE_MODEL_REPO has an unsupported shape: ${VITE_MODEL_REPO}"
  echo "[entrypoint] Expected: owner/name (letters, digits, _ - . only)."
  exit 1
fi
if ! _validate_model_revision "${VITE_MODEL_REVISION:-}"; then
  echo "[entrypoint] ERROR: VITE_MODEL_REVISION has an unsupported shape: ${VITE_MODEL_REVISION}"
  echo "[entrypoint] Expected: commit SHA or branch name (letters, digits, _ - . only)."
  exit 1
fi
if ! _validate_model_source "${VITE_MODEL_SOURCE:-}"; then
  echo "[entrypoint] ERROR: VITE_MODEL_SOURCE has an unsupported value: ${VITE_MODEL_SOURCE}"
  echo "[entrypoint] Expected one of: hf, local, both (or empty for default 'hf')."
  exit 1
fi

echo "[entrypoint] === Environment variables ==="
echo "[entrypoint] VITE_DEV_MODE=${VITE_DEV_MODE:-(not set)}"
echo "[entrypoint] VITE_ANALYTICS_URL=${VITE_ANALYTICS_URL:-(not set)}"
echo "[entrypoint] VITE_ANALYTICS_WEBSITE_ID=${VITE_ANALYTICS_WEBSITE_ID:-(not set)}"
echo "[entrypoint] VITE_DICTATION_DEVICE_SUPPORT=${VITE_DICTATION_DEVICE_SUPPORT:-(not set)}"
echo "[entrypoint] VITE_MODEL_REPO=${VITE_MODEL_REPO:-(not set)}"
echo "[entrypoint] VITE_MODEL_REVISION=${VITE_MODEL_REVISION:-(not set, uses models.js per-model pin)}"
echo "[entrypoint] VITE_MODEL_SOURCE=${VITE_MODEL_SOURCE:-(not set, defaults to 'hf')}"
echo "[entrypoint] LOCAL_MODEL_PATH=${LOCAL_MODEL_PATH:-(not set)}"
echo "[entrypoint] DICTATION_REGEX_SOURCE=${DICTATION_REGEX_SOURCE:-(not set, defaults to Murmure)}"
echo "[entrypoint] BOOST_PHRASES_SOURCE=${BOOST_PHRASES_SOURCE:-(not set, no boost lists served)}"
echo "[entrypoint] SIGNALING_PORT=${SIGNALING_PORT:-3001}"
echo "[entrypoint] RELAY_ENABLE=${RELAY_ENABLE:-(not set, signaling server defaults to enabled)}"
echo "[entrypoint] VITE_RELAY_ENABLE=${VITE_RELAY_ENABLE:-(not set, client defaults to enabled)}"
echo "[entrypoint] VITE_PHRASE_BOOST_DEFAULT=${VITE_PHRASE_BOOST_DEFAULT:-(not set, no default curated list)}"
# F-142: surface the resolved HSTS / CSP override values so operators can
# confirm at startup that their docker/.env overrides are actually in the
# container. Empty values mean the Caddyfile's baked-in defaults apply.
echo "[entrypoint] VITE_HSTS_MAX_AGE=${VITE_HSTS_MAX_AGE:-(not set, Caddy default applies)}"
echo "[entrypoint] VITE_HSTS_SUFFIX=${VITE_HSTS_SUFFIX:-(not set, no includeSubDomains/preload)}"
echo "[entrypoint] VITE_CSP_SCRIPT_HOSTS=${VITE_CSP_SCRIPT_HOSTS:-(not set, baked-in script hosts only)}"
echo "[entrypoint] VITE_CSP_CONNECT_HOSTS=${VITE_CSP_CONNECT_HOSTS:-(not set, baked-in connect hosts only)}"
echo "[entrypoint] =============================="

# ---------- Fallback model: ensure weights exist on the bind mount ---------
# When LOCAL_MODEL_PATH is set, the operator has bind-mounted a folder of
# ONNX files into the container. We verify vocab.txt is present and let
# Caddy serve that folder under /models/ (see Caddyfile).
if [ -z "${LOCAL_MODEL_PATH}" ]; then
  echo "[entrypoint] LOCAL_MODEL_PATH not set — skipping fallback model setup."
else
  # Accept either layout: a flat folder (vocab.txt + .onnx directly inside) or a
  # HuggingFace-style nested tree (files under <repoId>/, e.g. what `hf download`
  # leaves when the operator mounts a parent of one or more repos). When only the
  # nested layout is present, descend into it so Caddy (/models/*), the boost
  # prebuild, and the app's flat probe all see the files directly.
  _LOCAL_REPO="${VITE_MODEL_REPO:-istupakov/parakeet-tdt-0.6b-v3-onnx}"
  if [ ! -f "${LOCAL_MODEL_PATH}/vocab.txt" ] && [ -f "${LOCAL_MODEL_PATH}/${_LOCAL_REPO}/vocab.txt" ]; then
    echo "[entrypoint] Fallback model found nested under ${_LOCAL_REPO}/; using ${LOCAL_MODEL_PATH}/${_LOCAL_REPO}"
    LOCAL_MODEL_PATH="${LOCAL_MODEL_PATH}/${_LOCAL_REPO}"
    export LOCAL_MODEL_PATH
  fi
  if [ -f "${LOCAL_MODEL_PATH}/vocab.txt" ]; then
    echo "[entrypoint] Fallback model present at ${LOCAL_MODEL_PATH}"
  else
    echo "[entrypoint] ERROR: fallback model missing at ${LOCAL_MODEL_PATH}."
    echo "[entrypoint] Bind-mount a folder of ONNX files into the container at"
    echo "[entrypoint] ${LOCAL_MODEL_PATH} (flat layout, vocab.txt and the .onnx"
    echo "[entrypoint] files directly inside, or nested under ${_LOCAL_REPO}/)."
    echo "[entrypoint] Pre-populate the host folder with e.g.:"
    echo "[entrypoint]   hf download ${_LOCAL_REPO} \\"
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

if ! _validate_source "$REGEX_SOURCE"; then
  echo "[entrypoint] ERROR: DICTATION_REGEX_SOURCE has an unsupported shape: $REGEX_SOURCE"
  echo "[entrypoint] Allowed values: '/abs/path', './rel/path', or 'https://host/path'."
  echo "[entrypoint] Refusing to start so an operator typo cannot silently leak"
  echo "[entrypoint] container files or follow a redirect to internal endpoints."
  exit 1
fi

if ! _validate_csp_hosts "${VITE_CSP_SCRIPT_HOSTS:-}"; then
  echo "[entrypoint] ERROR: VITE_CSP_SCRIPT_HOSTS contains forbidden characters or tokens"
  echo "[entrypoint] Allowed: space-separated https:// origins only. No quotes, no"
  echo "[entrypoint] semicolons, no wildcards, no unsafe-* keywords, no data:/blob:"
  echo "[entrypoint] Got: ${VITE_CSP_SCRIPT_HOSTS}"
  echo "[entrypoint] Refusing to start so an operator typo cannot silently widen CSP."
  exit 1
fi
if ! _validate_csp_hosts "${VITE_CSP_CONNECT_HOSTS:-}"; then
  echo "[entrypoint] ERROR: VITE_CSP_CONNECT_HOSTS contains forbidden characters or tokens"
  echo "[entrypoint] Allowed: space-separated https:// origins only. No quotes, no"
  echo "[entrypoint] semicolons, no wildcards, no unsafe-* keywords, no data:/blob:"
  echo "[entrypoint] Got: ${VITE_CSP_CONNECT_HOSTS}"
  echo "[entrypoint] Refusing to start so an operator typo cannot silently widen CSP."
  exit 1
fi

# Auto-derive CSP allowlist entries so operators don't have to repeat values
# that are already declared via sibling env vars.
#
# 1. HuggingFace connect-src list: the explicit subdomains HF currently
#    redirects model files through. Default ON, but cleared entirely when
#    VITE_MODEL_SOURCE=local, since the app never reaches HF in that mode
#    and there is no reason to advertise those origins.
# 2. Analytics origin: derived from VITE_ANALYTICS_URL (if set). Appended
#    to both VITE_CSP_SCRIPT_HOSTS (umami script-src) and
#    VITE_CSP_CONNECT_HOSTS (umami beacon connect-src), so the operator
#    only has to set the URL once. The values that flow into Caddy are
#    only ever the operator-validated VITE_CSP_*_HOSTS plus an origin
#    extracted by _extract_origin (which enforces the same character
#    allowlist as _validate_csp_hosts), so no unvalidated input reaches
#    the CSP header.
_HF_HOSTS_DEFAULT="https://huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co https://cdn-lfs-eu-1.huggingface.co https://cas-bridge.xethub.hf.co"
if [ "${VITE_MODEL_SOURCE:-}" = "local" ]; then
  _CSP_HF_HOSTS=""
  echo "[entrypoint] VITE_MODEL_SOURCE=local: dropping HF origins from CSP."
else
  _CSP_HF_HOSTS="$_HF_HOSTS_DEFAULT"
fi
export _CSP_HF_HOSTS

if [ -n "${VITE_ANALYTICS_URL:-}" ]; then
  if _analytics_origin=$(_extract_origin "$VITE_ANALYTICS_URL"); then
    case " ${VITE_CSP_SCRIPT_HOSTS:-} " in
      *" $_analytics_origin "*) ;;
      *) VITE_CSP_SCRIPT_HOSTS="${VITE_CSP_SCRIPT_HOSTS:+$VITE_CSP_SCRIPT_HOSTS }$_analytics_origin" ;;
    esac
    case " ${VITE_CSP_CONNECT_HOSTS:-} " in
      *" $_analytics_origin "*) ;;
      *) VITE_CSP_CONNECT_HOSTS="${VITE_CSP_CONNECT_HOSTS:+$VITE_CSP_CONNECT_HOSTS }$_analytics_origin" ;;
    esac
    export VITE_CSP_SCRIPT_HOSTS VITE_CSP_CONNECT_HOSTS
    echo "[entrypoint] Auto-allowlisted ${_analytics_origin} in CSP script-src and connect-src (derived from VITE_ANALYTICS_URL)."
  else
    echo "[entrypoint] WARNING: VITE_ANALYTICS_URL is not an https:// URL or has unsupported characters; CSP not auto-extended."
    echo "[entrypoint] Got: ${VITE_ANALYTICS_URL}"
  fi
fi

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
      if _enforce_size_cap "$REGEX_DIR/regex.csv" "$_SERVED_MAX_BYTES"; then
        echo "[entrypoint] Downloaded regex.csv"
      else
        echo "[entrypoint] WARNING: regex.csv exceeded size cap, dropped"
      fi
    else
      echo "[entrypoint] WARNING: Failed to download regex.csv"
    fi
    ;;
esac

# Enforce the byte cap on every CSV (even local-folder ones, F-102) and
# write the manifest the browser reads.
_finalize_served_dir "$REGEX_DIR" csv
echo "[entrypoint] Dictation regex rules ready in $REGEX_DIR"

# ---------- Phrase-boosting lists ------------------------------------------
# BOOST_PHRASES_SOURCE (optional) supplies one or more phrase lists used to
# pre-fill the in-app phrase-boosting box. Unlike the dictation regex it has
# NO default: when unset, no manifest is written and the UI shows no file
# selector (the user just types their own phrases as before).
# - If it starts with '/' or './', it's a local folder of .txt files; every
#   .txt is served at /boost-phrases/<name>.txt.
# - Otherwise it's an https:// URL to a single .txt file.
# Each file is one phrase per line (optionally "phrase:WEIGHT"), exactly the
# format the boost textarea accepts.
# Larger byte cap for a precompiled .pwc than for served text: a .pwc is the
# token-id encoding of a list (gzip-compressed JSON), which for a 100k-phrase
# list can still outweigh its .txt. It is read by the boot prebuild (not served
# to browsers), so the cap only guards this container's node process against a
# poisoned giant file; it bounds the on-disk (compressed) size, not the inflated
# JSON. Matches the browser's BOOST_PREBUILT_MAX_BYTES (App.jsx).
_PWC_MAX_BYTES=67108864
BOOST_DIR="/var/boost"
mkdir -p "$BOOST_DIR"
# Clean every per-boot artifact, not just .txt: stale .json/.pwc from a previous
# start (or a list since removed from the source) must not linger and be served.
rm -f "$BOOST_DIR"/*.txt "$BOOST_DIR"/*.pwc "$BOOST_DIR"/*.json "$BOOST_DIR/manifest.txt" 2>/dev/null || true

if [ -n "${BOOST_PHRASES_SOURCE:-}" ]; then
  if ! _validate_source "$BOOST_PHRASES_SOURCE"; then
    echo "[entrypoint] ERROR: BOOST_PHRASES_SOURCE has an unsupported shape: $BOOST_PHRASES_SOURCE"
    echo "[entrypoint] Allowed values: '/abs/path', './rel/path', or 'https://host/path'."
    echo "[entrypoint] Refusing to start so an operator typo cannot silently leak"
    echo "[entrypoint] container files or follow a redirect to internal endpoints."
    exit 1
  fi
  case "$BOOST_PHRASES_SOURCE" in
    /*|./*)
      echo "[entrypoint] Using local boost-phrases folder: $BOOST_PHRASES_SOURCE"
      if [ -d "$BOOST_PHRASES_SOURCE" ]; then
        cp "$BOOST_PHRASES_SOURCE"/*.txt "$BOOST_DIR/" 2>/dev/null || true
        # Precompiled .pwc caches (from scripts/compile-boost.mjs) shipped next
        # to the .txt: copy them in so the prebuild can reuse them and skip the
        # encode. Only the local-folder case carries .pwc; the URL case fetches a
        # single .txt and always encodes. Cap each one (defense in depth).
        cp "$BOOST_PHRASES_SOURCE"/*.pwc "$BOOST_DIR/" 2>/dev/null || true
        for f in "$BOOST_DIR"/*.pwc; do
          [ -f "$f" ] || continue
          _enforce_size_cap "$f" "$_PWC_MAX_BYTES" || true
        done
      else
        echo "[entrypoint] WARNING: Local boost-phrases folder not found: $BOOST_PHRASES_SOURCE"
      fi
      ;;
    *)
      echo "[entrypoint] Downloading boost phrases from ${BOOST_PHRASES_SOURCE}..."
      if _fetch "$BOOST_DIR/boost.txt" "$BOOST_PHRASES_SOURCE"; then
        if _enforce_size_cap "$BOOST_DIR/boost.txt" "$_SERVED_MAX_BYTES"; then
          echo "[entrypoint] Downloaded boost.txt"
        else
          echo "[entrypoint] WARNING: boost.txt exceeded size cap, dropped"
        fi
      else
        echo "[entrypoint] WARNING: Failed to download boost.txt"
      fi
      ;;
  esac
  _finalize_served_dir "$BOOST_DIR" txt
  echo "[entrypoint] Boost phrase lists ready in $BOOST_DIR"

  # Pre-encode each list to token ids using the local model vocab + the bundled
  # BPE merges, so the browser builds the trie without re-encoding (the heavy
  # part for 10k-100k lists). No-op without a local vocab (pure-HF deploy): the
  # browser then encodes the .txt itself, as before. Failure is non-fatal.
  _MERGES="/srv/tokenizer/bpe-merges.json"
  if [ -n "${LOCAL_MODEL_PATH:-}" ] && [ -f "${LOCAL_MODEL_PATH}/vocab.txt" ]; then
    echo "[entrypoint] Pre-encoding boost lists with local vocab (${LOCAL_MODEL_PATH}/vocab.txt)..."
    node /opt/parakeet/docker/prebuild-boost.mjs "$BOOST_DIR" "${LOCAL_MODEL_PATH}/vocab.txt" "$_MERGES" \
      || echo "[entrypoint] WARNING: boost prebuild failed; browser will encode lists itself."
  else
    echo "[entrypoint] No local vocab — skipping boost prebuild (browser will encode lists)."
  fi
else
  echo "[entrypoint] BOOST_PHRASES_SOURCE not set — no boost phrase lists served."
fi

# VITE_PHRASE_BOOST_DEFAULT (optional) names the curated list the UI pre-selects
# for a fresh visitor. It must name a list this container is actually serving,
# otherwise the link silently falls back to manual entry and the operator never
# notices the typo. So validate it at boot and refuse to start on a mismatch.
# The browser normalises a bare name to "<name>.txt"; mirror that here, and
# require a safe leaf filename (no path separators / traversal) since the value
# is also echoed into the served config and used to build a fetch URL.
if [ -n "${VITE_PHRASE_BOOST_DEFAULT:-}" ]; then
  _BOOST_DEFAULT="$VITE_PHRASE_BOOST_DEFAULT"
  case "$_BOOST_DEFAULT" in
    *.txt) ;;
    *) _BOOST_DEFAULT="${_BOOST_DEFAULT}.txt" ;;
  esac
  case "$_BOOST_DEFAULT" in
    */*|*..*|*[!A-Za-z0-9._-]*)
      echo "[entrypoint] ERROR: VITE_PHRASE_BOOST_DEFAULT must be a bare list name"
      echo "[entrypoint] (letters, digits, '.', '_', '-'); got: $VITE_PHRASE_BOOST_DEFAULT"
      exit 1
      ;;
  esac
  if [ ! -f "$BOOST_DIR/$_BOOST_DEFAULT" ]; then
    echo "[entrypoint] ERROR: VITE_PHRASE_BOOST_DEFAULT=\"$VITE_PHRASE_BOOST_DEFAULT\" names a boost"
    echo "[entrypoint] list this container is not serving ($BOOST_DIR/$_BOOST_DEFAULT missing)."
    echo "[entrypoint] Set BOOST_PHRASES_SOURCE to a folder/URL that provides it, or unset"
    echo "[entrypoint] VITE_PHRASE_BOOST_DEFAULT. Refusing to start so the typo is not silent."
    exit 1
  fi
  echo "[entrypoint] Default curated boost list: $_BOOST_DEFAULT"
fi

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
VITE_MODEL_SOURCE="${VITE_MODEL_SOURCE:-}" \
VITE_ANALYTICS_URL="${VITE_ANALYTICS_URL:-}" \
VITE_ANALYTICS_WEBSITE_ID="${VITE_ANALYTICS_WEBSITE_ID:-}" \
VITE_ANALYTICS_SRI="${VITE_ANALYTICS_SRI:-}" \
VITE_RELAY_ENABLE="${VITE_RELAY_ENABLE:-}" \
VITE_PHRASE_BOOST_DEFAULT="${VITE_PHRASE_BOOST_DEFAULT:-}" \
node -e '
  const keys = [
    "VITE_DEV_MODE",
    "VITE_DICTATION_DEVICE_SUPPORT",
    "VITE_MODEL_REPO",
    "VITE_MODEL_REVISION",
    "VITE_MODEL_SOURCE",
    "VITE_ANALYTICS_URL",
    "VITE_ANALYTICS_WEBSITE_ID",
    "VITE_ANALYTICS_SRI",
    "VITE_RELAY_ENABLE",
    "VITE_PHRASE_BOOST_DEFAULT",
  ];
  const obj = {};
  for (const k of keys) obj[k] = process.env[k] ?? "";
  // Stamp the container start time (not operator-settable) so the dev-mode
  // banner can show "restarted N hours ago". Generated here, on every boot.
  obj.CONTAINER_STARTED_AT = new Date().toISOString();
  const safe = JSON.stringify(obj, null, 2)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  process.stdout.write("window.__CONFIG__ = " + safe + ";\n");
' > /run/config/config.js

# F-112: lock the generated config down to read-only for everyone,
# including the parakeet user the entrypoint and signaling sidecar run
# as. An RCE in the externally-reachable signaling process (untrusted
# phone client + npm-supply-chain risk on express et al) would
# otherwise let an attacker overwrite /run/config/config.js to point
# VITE_MODEL_REPO at an attacker-controlled HF repo, etc. The
# entrypoint's startup validation of these env vars (F-101) only
# runs ONCE; the served bytes are never re-validated. chmod 0400
# means the runtime user must explicitly chmod +w before re-writing,
# which is detectable by any process trace and breaks naive RCE
# payloads. We also lock the directory to 0500 so a write attempt
# falls back to a no-op rather than silently creating a sibling file
# that Caddy might serve at /run/config/<other>.js (it won't, the
# handler is path-scoped, but defense in depth).
chmod 0400 /run/config/config.js
chmod 0500 /run/config
echo "[entrypoint] Wrote runtime config to /run/config/config.js (locked 0400)"

# ---------- Start signaling sidecar (background, auto-restart) -------------
# F-120: if the signaling Node crashes (an uncaught exception, OOM
# from limiter-Map growth, a panic on a crafted body, any future bug
# surfaced by an untrusted phone payload), Caddy continues to run as
# PID 1 and serves 502 to /api/signal/* until the operator manually
# restarts the container. compose's `restart: unless-stopped` does
# not help because the container is still running (Caddy is alive).
#
# Wrap the Node process in a supervise loop so a crash auto-restarts.
# The 1 s sleep between restarts prevents a tight crash loop from
# pegging the CPU; each restart logs a line so the operator can see
# in `docker logs` if the sidecar is flapping.
if [ -f /signaling/server.js ]; then
  echo "[entrypoint] Starting signaling server on port ${SIGNALING_PORT:-3001}..."
  (
    while true; do
      PORT="${SIGNALING_PORT:-3001}" node /signaling/server.js
      _rc=$?
      echo "[entrypoint] signaling server exited (rc=$_rc); restarting in 1 s"
      sleep 1
    done
  ) &
fi

# ---------- Caddy in foreground --------------------------------------------
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
