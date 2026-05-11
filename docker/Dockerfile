# syntax=docker/dockerfile:1.6

# Base images are pinned to immutable content digests so the runtime
# bytes are determined entirely by the Dockerfile, not by whatever
# Docker Hub serves under the moving tag today. To refresh after a
# legitimate upstream update:
#   for img in node:20-alpine caddy:2-alpine; do
#     repo="library/${img%:*}"; tag="${img##*:}"
#     token=$(curl -fsSL "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull" | jq -r .token)
#     curl -fsSL -H "Authorization: Bearer $token" \
#       -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" \
#       -D - -o /dev/null "https://registry-1.docker.io/v2/${repo}/manifests/${tag}" \
#       | grep -i '^docker-content-digest:' | awk '{print $2}'
#   done
# Then paste the new sha256:... values below and commit.

# ── Stage 1: build the static UI bundle and install signaling deps ──────────
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /build

# Top-level app package (provides parakeet.js core via vite alias to ../src/).
# Using npm install (not npm ci) because onnxruntime-web is vendored and the
# committed lockfile drifts from package.json.
COPY app/package.json app/package-lock.json* ./app/
RUN cd app && npm install --no-audit --no-fund

# UI app
COPY app/ui/package.json app/ui/package-lock.json* ./app/ui/
RUN cd app/ui && npm install --no-audit --no-fund

# Signaling server (no lockfile committed; use npm install)
COPY signaling/package.json ./signaling/
RUN cd signaling && npm install --omit=dev

# Fail the build on high-severity npm vulnerabilities by default. Direct
# `docker build` invocations (CI, manual rebuild bypassing compose) used
# to default to false here, silently disabling the audit gate; compose
# already overrode this to true via build args but nothing else did. Flip
# the Dockerfile-level default so the gate is on unless explicitly waived.
ARG RUN_NPM_AUDIT=true
RUN if [ "$RUN_NPM_AUDIT" = "true" ]; then \
      set -e; \
      cd app && npm audit --audit-level=high && \
      cd ui && npm audit --audit-level=high && \
      cd ../../signaling && npm audit --audit-level=high; \
    fi

# Now copy sources and build
COPY app/src ./app/src
COPY app/ui ./app/ui
COPY signaling ./signaling

RUN cd app/ui && npm run build

# ── Stage 2: runtime image — Caddy serves dist/, Node runs signaling ───────
FROM caddy:2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d

RUN apk add --no-cache nodejs libcap && \
    # Strip file caps from caddy: the official image sets cap_net_bind_service
    # so it can bind low ports, but combined with no-new-privileges this makes
    # exec fail. We bind 5173 (unprivileged), so no caps are needed.
    setcap -r /usr/sbin/caddy 2>/dev/null || setcap -r /usr/bin/caddy 2>/dev/null || true && \
    # Create a non-root user for the runtime processes. UID 1000 matches the
    # default host user on most Linux distros, which keeps bind-mount perms
    # simple (e.g. ./fallback_models is readable by the same UID without an
    # extra chown). docker-compose.yml pins user: "1000:1000".
    addgroup -g 1000 -S parakeet && \
    adduser -u 1000 -S -G parakeet parakeet

# Built static assets
COPY --from=builder --chown=parakeet:parakeet /build/app/ui/dist /srv

# Signaling server source + its production node_modules
COPY --from=builder --chown=parakeet:parakeet /build/signaling /signaling

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER parakeet
EXPOSE 5173
ENTRYPOINT ["/entrypoint.sh"]
