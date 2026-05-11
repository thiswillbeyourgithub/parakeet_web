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

# Reproducibility: SOURCE_DATE_EPOCH is the standard env that
# vite/rollup/esbuild and most modern toolchains honour for any embedded
# timestamp (so two builds of the same source produce the same bytes).
# Operators should pass it via docker-compose or `docker build --build-arg
# SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)`. Default is 0 (unix epoch)
# so the Dockerfile stays operable without git; that default already
# produces deterministic output, just not "matches commit X" metadata.
ARG SOURCE_DATE_EPOCH=0
ENV SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH

# Each `npm ci` runs with --ignore-scripts so a compromised dep's
# postinstall (the standard malware delivery channel) cannot execute
# arbitrary code during build. The single legitimate exception is
# esbuild (vite's bundler), which needs its install.js to fetch the
# platform-specific binary; we explicitly `npm rebuild esbuild` to
# allowlist exactly that one package.
#
# `npm ci` (not `npm install`) refuses to mutate the lockfile, so the
# install set is exactly what's recorded in the committed
# package-lock.json: same bytes on every build, same audit surface
# in code review.

# Top-level app package (provides parakeet.js core via vite alias to ../src/).
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci --ignore-scripts --no-audit --no-fund

# UI app
COPY app/ui/package.json app/ui/package-lock.json ./app/ui/
RUN cd app/ui && npm ci --ignore-scripts --no-audit --no-fund \
    && npm rebuild esbuild

# Signaling server
COPY signaling/package.json signaling/package-lock.json ./signaling/
RUN cd signaling && npm ci --ignore-scripts --no-audit --no-fund --omit=dev

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

# Emit a manifest of every shipped file's sha256 so operators can rebuild
# from the same source and verify they got the same bytes the server is
# serving. Sorted listing so the manifest is deterministic regardless of
# filesystem walk order. Stored under /.well-known/ so it's discoverable
# without a config change (Caddy auto-serves any file under /srv).
RUN cd app/ui/dist && mkdir -p .well-known && \
    find . -type f ! -path './.well-known/*' | LC_ALL=C sort | \
    while IFS= read -r f; do sha256sum "$f"; done > .well-known/build-sums.txt

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
