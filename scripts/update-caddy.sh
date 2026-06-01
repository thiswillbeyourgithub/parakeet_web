#!/bin/sh
# Refresh the pinned Caddy base image in docker/Dockerfile to the latest
# digest published under its tag, and report the precise semantic version.
#
# Usage:
#   ./scripts/update-caddy.sh             # refresh the digest of the tag
#                                         # currently pinned in the Dockerfile
#                                         # (a minor/patch bump within Caddy 2)
#   ./scripts/update-caddy.sh 3-alpine    # MAJOR bump: switch to a new tag and
#                                         # pin its digest (review breaking
#                                         # changes first, see CLAUDE.md)
#
# Why this exists: docker/Dockerfile pins base images to immutable content
# digests, not floating tags, so the runtime bytes are reproducible. That
# means a `docker pull` never silently picks up a new Caddy; the digest must
# be bumped on purpose. This script does the registry dance (token + manifest
# HEAD) the Dockerfile header documents by hand, then rewrites the line.
#
# It only touches the `caddy:` FROM line. The node builder image is left
# alone. Run it from the repo root. Per CLAUDE.md, review the diff and rebuild
# the image before committing.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCKERFILE="$REPO_ROOT/docker/Dockerfile"

[ -f "$DOCKERFILE" ] || { echo "ERROR: $DOCKERFILE not found" >&2; exit 1; }

# Resolve required tools up front so failures are obvious.
for bin in curl sed grep awk; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: '$bin' is required" >&2; exit 1; }
done

# Pick a JSON parser. Prefer jq; otherwise fall back to node, which is already
# a hard prerequisite for the project's Vite build.
if command -v jq >/dev/null 2>&1; then
  JSON_TOOL="jq"
elif command -v node >/dev/null 2>&1; then
  JSON_TOOL="node"
else
  echo "ERROR: need jq or node to parse registry responses" >&2
  exit 1
fi

REPO="library/caddy"

# Read the tag currently pinned in the Dockerfile, e.g. "2-alpine" out of
#   FROM caddy:2-alpine@sha256:...
CURRENT_LINE="$(grep -E '^FROM caddy:' "$DOCKERFILE" | head -n1)"
[ -n "$CURRENT_LINE" ] || { echo "ERROR: no 'FROM caddy:' line in $DOCKERFILE" >&2; exit 1; }
CURRENT_TAG="$(printf '%s' "$CURRENT_LINE" | sed -E 's/^FROM caddy:([^@ ]+).*/\1/')"
CURRENT_DIGEST="$(printf '%s' "$CURRENT_LINE" | sed -E 's/.*@(sha256:[0-9a-f]+).*/\1/')"

# Target tag: the explicit argument (a major/tag change) or the current tag.
TAG="${1:-$CURRENT_TAG}"

echo "Caddy image: caddy:$CURRENT_TAG"
echo "  pinned digest: $CURRENT_DIGEST"
[ "$TAG" != "$CURRENT_TAG" ] && echo "  switching tag -> caddy:$TAG"
echo

# --- Resolve the current digest for the target tag from the registry --------
# Anonymous pull token, then a manifest request whose Docker-Content-Digest
# response header is the multi-arch index digest we want to pin.
TOKEN="$(curl -fsSL "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${REPO}:pull" \
  | { if [ "$JSON_TOOL" = "jq" ]; then jq -r '.token'; \
      else node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).token))'; fi; })"
[ -n "$TOKEN" ] || { echo "ERROR: could not obtain a registry pull token" >&2; exit 1; }

NEW_DIGEST="$(curl -fsSL \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" \
  -D - -o /dev/null "https://registry-1.docker.io/v2/${REPO}/manifests/${TAG}" \
  | grep -i '^docker-content-digest:' | awk '{print $2}' | tr -d '\r')"

case "$NEW_DIGEST" in
  sha256:*) ;;
  *) echo "ERROR: failed to resolve a digest for caddy:$TAG (tag missing?)" >&2; exit 1 ;;
esac

# --- Best-effort: find the precise X.Y.Z version behind the floating tag -----
# Docker Hub's tags API exposes the digest per tag. We look for the most
# specific `X.Y.Z-alpine` tag whose digest matches what we just resolved, so
# the human (and the commit message) knows the actual Caddy version. This is
# informational only; failure here is non-fatal.
resolve_version() {
  page="https://hub.docker.com/v2/repositories/${REPO}/tags?page_size=100"
  body="$(curl -fsSL "$page" 2>/dev/null)" || return 0
  if [ "$JSON_TOOL" = "jq" ]; then
    printf '%s' "$body" | jq -r --arg d "$NEW_DIGEST" \
      '.results[] | select(.digest == $d) | .name' 2>/dev/null \
      | grep -E '^[0-9]+\.[0-9]+\.[0-9]+-alpine$' | head -n1
  else
    printf '%s' "$body" | node -e '
      let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{
        try{const j=JSON.parse(s);const d=process.argv[1];
          const m=(j.results||[]).filter(t=>t.digest===d).map(t=>t.name)
            .filter(n=>/^[0-9]+\.[0-9]+\.[0-9]+-alpine$/.test(n));
          if(m.length)console.log(m[0]);
        }catch(e){}
      });' "$NEW_DIGEST"
  fi
}
VERSION="$(resolve_version || true)"

if [ "$NEW_DIGEST" = "$CURRENT_DIGEST" ] && [ "$TAG" = "$CURRENT_TAG" ]; then
  echo "Already up to date: caddy:$TAG -> $NEW_DIGEST"
  [ -n "$VERSION" ] && echo "  (Caddy $VERSION)"
  exit 0
fi

# --- Rewrite the Dockerfile -------------------------------------------------
# 1. The FROM line itself.
sed -i -E "s|^FROM caddy:[^@ ]+@sha256:[0-9a-f]+|FROM caddy:${TAG}@${NEW_DIGEST}|" "$DOCKERFILE"
# 2. The header comment's refresh list, if the tag changed (keeps the
#    documented `for img in ...` loop honest).
if [ "$TAG" != "$CURRENT_TAG" ]; then
  sed -i -E "s|caddy:${CURRENT_TAG}|caddy:${TAG}|g" "$DOCKERFILE"
fi

echo "Updated docker/Dockerfile:"
echo "  caddy:$TAG"
echo "  $NEW_DIGEST"
[ -n "$VERSION" ] && echo "  (Caddy $VERSION)"
echo
echo "Next steps:"
echo "  - review the diff:  git -C \"$REPO_ROOT\" diff -- docker/Dockerfile"
echo "  - rebuild the image to confirm it still builds"
[ "$TAG" != "$CURRENT_TAG" ] && echo "  - MAJOR bump: read the Caddy upgrade notes for breaking changes before committing"

exit 0
