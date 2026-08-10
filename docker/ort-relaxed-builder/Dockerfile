# Hermetic builder image for the opt-in Relaxed-SIMD ONNX Runtime WASM
# artifacts (PERF_PLAN #5). It is the containerised counterpart of the host
# builder `scripts/build-ort-relaxed.sh`, which it RUNS rather than
# reimplements: the repo is bind-mounted at /repo and the entrypoint execs
# /repo/scripts/build-ort-relaxed.sh, so there is exactly one copy of the
# build logic in this repo. Drive it through
# `scripts/build-ort-relaxed-docker.sh`.
#
# Written with the help of Claude Code.
#
# ── Why a container at all ─────────────────────────────────────────────────
# The host builder inherits whatever the developer's box happens to have:
# glibc, cmake, ninja, python, and (crucially) the compiler and Node used for
# the post-processing and the app rebuild. Two operators running the same
# command on two boxes can therefore ship different bytes into
# app/ui/public/ort-relaxed/, which is exactly the thing you cannot afford for
# a binary that gets committed and then served to every visitor. This image
# freezes the whole toolchain so the only remaining variable is the ORT source
# tag itself.
#
# ── Why it is NOT part of docker/Dockerfile (the deploy image) ─────────────
# This build is a 30-60 min emscripten compile that needs ~10 GB of transient
# scratch, and its output only changes when the vendored onnxruntime-web
# version changes. Folding it into the deploy image would make every routine
# `docker compose build` an hour long for artifacts that are byte-identical
# 99% of the time. The deploy image stays fast and simply serves whatever
# pair is present under app/ui/public/ort-relaxed/.
#
# ── What is pinned (the reproducibility chain) ────────────────────────────
#   1. This base image, by immutable content digest (below), so apt resolves
#      against a fixed snapshot of the Ubuntu 24.04 package set.
#   2. Node.js, by exact version + SHA-256 of the official dist tarball
#      (below). Ubuntu 24.04 ships Node 18, too old for the vite 8 app build,
#      and `curl | bash` NodeSource installers are unauditable, so we verify a
#      tarball hash we can read in the diff.
#   3. The ONNX Runtime source, by git tag: build-ort-relaxed.sh derives it
#      from app/ui/vendor/onnxruntime-web/package.json and refuses to build a
#      checkout that is on any other tag.
#   4. Emscripten, by ORT itself: tools/ci_build/build.py bootstraps its own
#      pinned emsdk inside the source tree, so the compiler version is a
#      function of (3) and no system emscripten is installed here on purpose.
#
# ── What is NOT guaranteed ────────────────────────────────────────────────
# Emscripten output is not bit-reproducible by construction (embedded paths,
# LLVM parallelism, and timestamps can all leak into the artifacts). Pinning
# the toolchain removes the host as a variable but does not prove determinism,
# so the actual proof is empirical: `scripts/build-ort-relaxed-docker.sh
# --repro-check` builds twice into two throwaway directories and diffs the
# SHA-256 of the produced .wasm/.mjs pair. Treat a committed binary as
# auditable only when it ships with the SHA256SUMS/BUILD-INFO that check
# writes.
#
# There is deliberately no `# syntax=` directive: nothing here needs a
# BuildKit-only feature, so the image also builds with the classic builder and
# no extra frontend image has to be fetched from the network.

# Base image pinned to an immutable content digest, same philosophy as
# docker/Dockerfile. To refresh after a legitimate upstream update:
#   repo="library/ubuntu"; tag="24.04"
#   token=$(curl -fsSL "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull" | jq -r .token)
#   curl -fsSL -H "Authorization: Bearer $token" \
#     -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" \
#     -D - -o /dev/null "https://registry-1.docker.io/v2/${repo}/manifests/${tag}" \
#     | grep -i '^docker-content-digest:' | awk '{print $2}'
# Then paste the new sha256:... value below and commit.
FROM ubuntu:24.04@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea

# Build prerequisites of ORT's WASM pipeline. Single layer, no recommends,
# apt lists dropped, so the image stays a thin function of the pinned digest.
# Note the absence of emscripten: build.py bootstraps its own pinned emsdk.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        curl \
        git \
        ninja-build \
        python3 \
        python3-venv \
        xz-utils && \
    rm -rf /var/lib/apt/lists/*

# Node.js from the official dist tarball, verified against a hash baked into
# this file (taken from https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt).
# Both Linux architectures are pinned so an arm64 host gets the same audit
# story as x64.
ARG NODE_VERSION=22.23.2
ARG NODE_SHA256_X64=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307
ARG NODE_SHA256_ARM64=fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) node_arch=x64;   node_sha="$NODE_SHA256_X64" ;; \
      arm64) node_arch=arm64; node_sha="$NODE_SHA256_ARM64" ;; \
      *) echo "[Dockerfile] FATAL: unsupported architecture '$arch'" >&2; exit 1 ;; \
    esac; \
    tarball="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"; \
    echo "${node_sha}  ${tarball}" | sha256sum -c -; \
    tar -xJf "$tarball" -C /usr/local --strip-components=1 --no-same-owner; \
    rm -f "$tarball"; \
    node --version; \
    npm --version

# Non-root build user. Ubuntu 24.04 already ships a stock `ubuntu` account at
# UID 1000, which collides with the UID the wrapper passes so the bind-mounted
# repo keeps the host's ownership; drop it and mint our own.
ARG BUILD_UID=1000
ARG BUILD_GID=1000
RUN set -eux; \
    userdel -r ubuntu 2>/dev/null || true; \
    groupadd -g "$BUILD_GID" builder; \
    useradd -u "$BUILD_UID" -g "$BUILD_GID" -m -s /bin/bash builder

# The ~10 GB transient source/emsdk/object tree lives here, in the container's
# own writable layer, NOT in the bind-mounted repo: `docker run --rm` throws it
# away, and a tmpfs or a scratch volume can be mounted over it if the operator
# would rather not spend the overlay space.
ENV ORT_SRC_DIR=/ort-src
ENV REPO_MOUNT=/repo
# Politeness default: this compile happily saturates every core, and the box
# it runs on is usually also running benchmarks. Override with -e BUILD_NICE=0.
ENV BUILD_NICE=19
# Keep npm's cache inside the container so a build never writes into the host's
# ~/.npm through the bind mount (the entrypoint's app rebuild shells out to npm).
ENV npm_config_cache=/home/builder/.npm-cache

# The wrapper runs the container as the *host* user so files landing in the
# bind mount stay owned by them; that UID is not necessarily 1000, so the two
# writable directories are opened up rather than chowned to a guess.
RUN set -eux; \
    mkdir -p "$ORT_SRC_DIR" "$REPO_MOUNT" /home/builder/.npm-cache; \
    chmod 0777 "$ORT_SRC_DIR" /home/builder /home/builder/.npm-cache; \
    # Same reason: git refuses to operate on a tree owned by another UID, and
    # the checkout under $ORT_SRC_DIR may not match whoever docker runs as.
    git config --system --add safe.directory '*'

USER builder
WORKDIR /repo

# Run the repo's own builder, unmodified. Extra `docker run` arguments are
# appended verbatim, so `docker run ... <image> -j 6` forwards -j to it. The
# --src override is what keeps the huge transient tree off the bind mount;
# build-ort-relaxed.sh never auto-deletes a user-supplied --src, which is
# exactly right here since the container itself is the thing being discarded.
ENTRYPOINT ["/bin/bash", "-c", "exec nice -n \"${BUILD_NICE:-19}\" \"$REPO_MOUNT/scripts/build-ort-relaxed.sh\" --src \"$ORT_SRC_DIR\" \"$@\"", "ort-relaxed-builder"]
