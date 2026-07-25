# syntax=docker/dockerfile:1.6
#
# OpenAI/whisper-compatible API server for the parakeet_web ONNX pipeline.
#
# Build context is the REPOSITORY ROOT (docker-compose.yml sets `context: ../..`),
# because the server imports the repo's own modules rather than duplicating them:
# app/src (the pipeline), scripts/transcribe.mjs (model/boost/ffmpeg glue), the
# vendored onnxruntime-web build, the vendored sherpa-onnx diarization engine, and
# app/ui/src/lib/speakerAssign.js. Nothing here is a copy of them.
#
# ── base image pinning ────────────────────────────────────────────────────────
# The base is pinned to an immutable digest so a rebuild can never silently pick
# up a different image. Refresh it deliberately (same recipe as docker/Dockerfile):
#
#   img=node:22-bookworm-slim
#   repo="library/${img%:*}"; tag="${img##*:}"
#   token=$(curl -fsSL "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull" | jq -r .token)
#   curl -fsSL -H "Authorization: Bearer $token" \
#     -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json" \
#     -D - -o /dev/null "https://registry-1.docker.io/v2/${repo}/manifests/${tag}" \
#     | grep -i '^docker-content-digest:' | awk '{print $2}'
#
# then paste the new sha256 below and commit.
#
# Debian (glibc), NOT alpine: onnxruntime-node ships prebuilt glibc binaries and
# has no musl build, so an alpine base would make PARAKEET_ORT=node|cuda
# impossible. The WASM backend works on either.
ARG RUNTIME_BASE=node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3

# ── Stage 1: npm dependencies ────────────────────────────────────────────────
# Only ONE dependency exists (onnxruntime-node), and only the native backends
# need it: PARAKEET_ORT=wasm runs on the vendored onnxruntime-web build with zero
# npm packages. Hence ORT_NODE_VARIANT:
#   none  no npm install at all -- wasm-only image, smallest attack surface
#   cpu   CPU execution provider only (default; ~21 MB of .so)
#   cuda  also keeps libonnxruntime_providers_cuda.so (+273 MB) for PARAKEET_ORT=cuda
FROM ${RUNTIME_BASE} AS deps
ARG ORT_NODE_VARIANT=cpu
ARG TARGETARCH
WORKDIR /build

# F-104-style lockfile guard: an integrity-less lockfile means npm cannot verify
# what it downloads, which would make every supply-chain measure below moot. A
# lockfile from a current npm always has integrity entries; their absence means
# it was hand-edited or produced by an ancient npm and must be regenerated.
COPY scripts/openai-like-server/package.json scripts/openai-like-server/package-lock.json ./
RUN if [ "$ORT_NODE_VARIANT" != "none" ] && ! grep -q '"integrity":' package-lock.json; then \
      echo "[Dockerfile] FATAL: package-lock.json has no integrity hashes; regenerate it with a current npm"; \
      exit 1; \
    fi

# Reject an unrecognised value instead of falling through to a silently different
# image (the same defensive-validation posture as docker/Dockerfile's RUN_NPM_AUDIT).
RUN case "$ORT_NODE_VARIANT" in \
      none|cpu|cuda) ;; \
      *) echo "[Dockerfile] FATAL: ORT_NODE_VARIANT must be none, cpu or cuda; got '$ORT_NODE_VARIANT'"; exit 1 ;; \
    esac

# `npm audit --audit-level=high` gates the build. Set RUN_NPM_AUDIT=false to opt
# out (e.g. a triaged CVE with no upstream fix yet).
ARG RUN_NPM_AUDIT=true
RUN if [ "$RUN_NPM_AUDIT" != "true" ] && [ "$RUN_NPM_AUDIT" != "false" ]; then \
      echo "[Dockerfile] FATAL: RUN_NPM_AUDIT must be exactly 'true' or 'false', got: '$RUN_NPM_AUDIT'"; \
      exit 1; \
    fi

# --ignore-scripts: a compromised dependency's postinstall is the standard malware
# delivery channel. It is SAFE here (unlike for many native packages) because
# onnxruntime-node ships its prebuilt binaries inside the npm tarball for every
# platform -- its postinstall script only exists to fetch the optional CUDA extras,
# which the tarball already contains. Asserted below.
RUN if [ "$ORT_NODE_VARIANT" = "none" ]; then \
      echo "[Dockerfile] ORT_NODE_VARIANT=none: skipping npm install (wasm-only image)"; \
      mkdir -p node_modules; \
    else \
      npm ci --ignore-scripts --no-audit --no-fund && \
      if [ "$RUN_NPM_AUDIT" = "true" ]; then npm audit --audit-level=high; fi && \
      arch="$(node -p 'process.arch')" && \
      bin="node_modules/onnxruntime-node/bin/napi-v6/linux/${arch}" && \
      if [ ! -f "${bin}/onnxruntime_binding.node" ]; then \
        echo "[Dockerfile] FATAL: onnxruntime-node has no prebuilt binding for linux/${arch} after npm ci"; \
        exit 1; \
      fi && \
      # Drop every platform we are not: the tarball carries win32/darwin and both
      # linux arches (~404 MB in total), none of which this image can execute.
      find node_modules/onnxruntime-node/bin/napi-v6 -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + && \
      find node_modules/onnxruntime-node/bin/napi-v6/linux -mindepth 1 -maxdepth 1 ! -name "${arch}" -exec rm -rf {} + && \
      if [ "$ORT_NODE_VARIANT" = "cpu" ]; then \
        rm -f "${bin}/libonnxruntime_providers_cuda.so" "${bin}/libonnxruntime_providers_tensorrt.so"; \
      fi && \
      du -sh node_modules/onnxruntime-node/bin; \
    fi

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM ${RUNTIME_BASE}
# Re-declared so their values are visible to this stage's RUN steps (a pre-FROM
# ARG is otherwise only in scope for the FROM lines themselves).
ARG RUNTIME_BASE
ARG ORT_NODE_VARIANT=cpu

# ffmpeg decodes every upload to 16 kHz mono (any container/codec). Installed
# from the distro rather than a downloaded static build so it is signed by
# Debian's apt keys and patched by the base image's own updates. The exact
# resolved versions are recorded in /etc/parakeet-api-build.txt so an operator can
# audit what a given image was built from:
#   docker run --rm parakeet-openai-api cat /etc/parakeet-api-build.txt
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/* && \
    { echo "base: ${RUNTIME_BASE:-node:22-bookworm-slim}"; \
      echo "node: $(node --version)"; \
      echo "ort-node-variant: ${ORT_NODE_VARIANT}"; \
      dpkg-query -W -f='${Package}=${Version}\n' | LC_ALL=C sort; } > /etc/parakeet-api-build.txt

# Non-root runtime user. UID 1000 matches the default host user on most Linux
# distros, so a bind-mounted model directory is readable without a chown, and
# docker-compose.yml pins user: "1000:1000".
RUN groupadd -g 1000 -r parakeet && useradd -u 1000 -r -g parakeet -s /usr/sbin/nologin parakeet && \
    # Both mount points exist even when nothing is bind-mounted over them: the
    # rootfs is read-only at runtime, so they cannot be created later. An empty
    # /wordlists simply means "no wordlists"; a missing /models is a fatal boot
    # error with a download hint, which is the intended behaviour.
    mkdir -p /models /wordlists && chown parakeet:parakeet /models /wordlists

WORKDIR /opt/parakeet

# The pipeline and the shared helpers. Layout matters: the server's imports are
# relative (../../app/src/..., ../transcribe.mjs), so the repo's directory
# structure has to be preserved inside the image.
COPY --chown=parakeet:parakeet app/src ./app/src
# Pure, DOM-free helper that maps diarization segments onto words. Shared with the
# browser app so both label speakers identically.
COPY --chown=parakeet:parakeet app/ui/src/lib/speakerAssign.js ./app/ui/src/lib/speakerAssign.js
# Vendored onnxruntime-web (Node build): the default PARAKEET_ORT=wasm backend.
COPY --chown=parakeet:parakeet app/ui/vendor/onnxruntime-web/dist ./app/ui/vendor/onnxruntime-web/dist
# BPE merges, needed to encode phrase-boost text into token ids.
COPY --chown=parakeet:parakeet app/ui/public/tokenizer/bpe-merges.json ./app/ui/public/tokenizer/bpe-merges.json
# Vendored sherpa-onnx speaker-diarization engine (~11 MB wasm), used only when a
# request asks for diarize=true.
COPY --chown=parakeet:parakeet app/ui/public/sherpa-onnx ./app/ui/public/sherpa-onnx
# The CLI harness whose exported helpers do the model loading, phrase-boost trie
# building and ffmpeg decoding for the server (see lib/engine.mjs).
COPY --chown=parakeet:parakeet scripts/transcribe.mjs ./scripts/transcribe.mjs
COPY --chown=parakeet:parakeet scripts/openai-like-server ./scripts/openai-like-server
# node_modules goes at the IMAGE ROOT, not next to the server's package.json.
# `onnxruntime-node` is imported by scripts/transcribe.mjs (getOrt), and Node
# resolves a bare specifier by walking UP from the IMPORTING file: from
# /opt/parakeet/scripts/ it would check /opt/parakeet/scripts/node_modules then
# /opt/parakeet/node_modules, and never look inside
# scripts/openai-like-server/node_modules. Installing it there gives
# ERR_MODULE_NOT_FOUND the moment PARAKEET_ORT=node|cuda is used (verified).
# /opt/parakeet is an ancestor of both importers, so this resolves for each.
COPY --from=deps --chown=parakeet:parakeet /build/node_modules ./node_modules

# Defaults that make the container work as shipped. PARAKEET_HOST must be
# 0.0.0.0: a published port cannot reach a process bound to the container's own
# loopback. docker-compose.yml publishes it to 127.0.0.1 on the host, and the
# server refuses to run keyless on 0.0.0.0 unless
# PARAKEET_ALLOW_KEYLESS_NON_LOOPBACK acknowledges exactly that arrangement.
ENV PARAKEET_HOST=0.0.0.0 \
    PARAKEET_PORT=8002 \
    PARAKEET_MODEL_DIR=/models \
    PARAKEET_WORDLIST_DIR=/wordlists \
    NODE_ENV=production

USER parakeet
EXPOSE 8002

# Liveness only (/health needs no auth so a probe never holds the secret). It
# honours PARAKEET_REQUEST_PATH so a prefixed deployment still gets probed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "const p=process.env.PARAKEET_REQUEST_PATH||'';fetch(`http://127.0.0.1:${process.env.PARAKEET_PORT||8002}${p}/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, no shell: nothing to inject into, and signals reach node directly
# (it installs SIGTERM/SIGINT handlers for a graceful drain).
ENTRYPOINT ["node", "/opt/parakeet/scripts/openai-like-server/server.mjs"]
