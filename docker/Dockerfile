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
# esbuild (vite's bundler), which needs its install.js to expose its
# platform-specific binary; we explicitly `npm rebuild esbuild` to
# allowlist exactly that one package.
#
# F-105: esbuild's install.js, when invoked, first probes
# `require.resolve('@esbuild/<platform>/bin/esbuild')` and only falls
# through to `downloadDirectlyFromNPM` (an unverified `https.get` to
# `registry.npmjs.org`) if the optional dep is not on disk. With the
# F-104 lockfile fix the `@esbuild/linux-x64` optional dep is now
# integrity-verified at `npm ci` time, so the on-disk path is taken
# and the unverified download branch is unreachable. We pin
# ESBUILD_BINARY_PATH below as belt-and-braces so a future lockfile
# regeneration that drops the optional dep cannot silently reintroduce
# the download path: install.js will exit cleanly when the env-var
# points at an extant binary, and fail loudly if it does not.
#
# `npm ci` (not `npm install`) refuses to mutate the lockfile, so the
# install set is exactly what's recorded in the committed
# package-lock.json: same bytes on every build, same audit surface
# in code review.

# F-104: refuse to build if any lockfile is missing the per-package
# `integrity` field. Without it `npm ci` falls back to range resolution
# against the (untrusted) registry, so a compromised mirror can ship
# attacker-controlled bytes of the bundler itself (vite/esbuild/rollup).
# The bundler then sees every source file and emits the JS browsers run,
# so every supply-chain hardening downstream is moot. Each lockfile
# legitimately ships >0 integrity entries; absence means the lockfile
# was hand-edited or generated with an ancient npm and must be regen'd.
COPY app/package-lock.json /tmp/lock-app.json
COPY app/ui/package-lock.json /tmp/lock-ui.json
COPY signaling/package-lock.json /tmp/lock-signaling.json
RUN for f in /tmp/lock-app.json /tmp/lock-ui.json /tmp/lock-signaling.json; do \
      if ! grep -q '"integrity":' "$f"; then \
        echo "[Dockerfile] FATAL: $f has no integrity hashes; regenerate with a current npm"; \
        exit 1; \
      fi; \
    done && rm /tmp/lock-app.json /tmp/lock-ui.json /tmp/lock-signaling.json

# Top-level app package (provides parakeet.js core via vite alias to ../src/).
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci --ignore-scripts --no-audit --no-fund

# UI app
COPY app/ui/package.json app/ui/package-lock.json ./app/ui/
RUN cd app/ui && npm ci --ignore-scripts --no-audit --no-fund && \
    if [ ! -x /build/app/ui/node_modules/@esbuild/linux-x64/bin/esbuild ]; then \
      echo "[Dockerfile] FATAL: @esbuild/linux-x64 optional dep missing after npm ci; refusing to fall through to install.js downloadDirectlyFromNPM (unverified https.get)"; \
      exit 1; \
    fi && \
    ESBUILD_BINARY_PATH=/build/app/ui/node_modules/@esbuild/linux-x64/bin/esbuild \
      npm rebuild esbuild
ENV ESBUILD_BINARY_PATH=/build/app/ui/node_modules/@esbuild/linux-x64/bin/esbuild

# Signaling server
COPY signaling/package.json signaling/package-lock.json ./signaling/
RUN cd signaling && npm ci --ignore-scripts --no-audit --no-fund --omit=dev

# Fail the build on high-severity npm vulnerabilities by default. Direct
# `docker build` invocations (CI, manual rebuild bypassing compose) used
# to default to false here, silently disabling the audit gate; compose
# already overrode this to true via build args but nothing else did. Flip
# the Dockerfile-level default so the gate is on unless explicitly waived.
#
# F-108: enforce strict 'true'/'false' values. Any other value (typo
# like 'True', '1', 'yes', trailing whitespace) used to silently
# disable the audit because the string comparison fell through. Now
# the build refuses to start with an unrecognised value, matching the
# defensive validation posture of F-26/F-91/F-98/F-101.
ARG RUN_NPM_AUDIT=true
RUN if [ "$RUN_NPM_AUDIT" != "true" ] && [ "$RUN_NPM_AUDIT" != "false" ]; then \
      echo "[Dockerfile] FATAL: RUN_NPM_AUDIT must be exactly 'true' or 'false', got: '$RUN_NPM_AUDIT'"; \
      exit 1; \
    fi && \
    if [ "$RUN_NPM_AUDIT" = "true" ]; then \
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
#
# F-111: exclude ONLY build-sums.txt from itself (it cannot list its
# own future hash without a fixed point). The previous glob
# `! -path './.well-known/*'` was over-broad and dropped the F-38b
# trust anchor `asset-integrity.json` from the manifest entirely, so
# the operator's deploy-verification recipe could not detect tampering
# with the worklet pin. Asset-integrity.json must be enumerated.
RUN cd app/ui/dist && mkdir -p .well-known && \
    find . -type f ! -path './.well-known/build-sums.txt' | LC_ALL=C sort | \
    while IFS= read -r f; do sha256sum "$f"; done > .well-known/build-sums.txt

# ── Stage 2: runtime image — Caddy serves dist/, Node runs signaling ───────
FROM caddy:2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d

# F-107: the nodejs binary runs both the signaling server (which
# untrusted phones connect to) and the entrypoint's config-generator
# (which emits /run/config/config.js, served as JS to every visitor).
# Bare `apk add --no-cache nodejs` fetches whatever Alpine ships at
# rebuild time from dl-cdn.alpinelinux.org with no record of the
# rotation. Pin a major version so a future Alpine major bump is a
# build-time failure (visible) rather than a silent runtime swap, and
# record the resolved exact version into /etc/parakeet-build.txt so an
# operator running `docker run --rm parakeetweb cat /etc/parakeet-
# build.txt` can audit the runtime versions against build-sums.txt.
# libcap is needed once for setcap; we keep it transient via virtual.
RUN apk add --no-cache 'nodejs=~20' && \
    apk add --no-cache --virtual .build-deps libcap && \
    # Strip file caps from caddy: the official image sets cap_net_bind_service
    # so it can bind low ports, but combined with no-new-privileges this makes
    # exec fail. We bind 5173 (unprivileged), so no caps are needed.
    setcap -r /usr/sbin/caddy 2>/dev/null || setcap -r /usr/bin/caddy 2>/dev/null || true && \
    apk del .build-deps && \
    # Snapshot the resolved versions of every runtime-installed package so
    # an operator can correlate a deployed container with the exact byte
    # set it was built from.
    apk info -v | LC_ALL=C sort > /etc/parakeet-build.txt && \
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
