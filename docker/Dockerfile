# Optional: bake a HuggingFace model into the image so the container can serve
# weights locally when HuggingFace is unreachable.  When set, the build will
# fail immediately if the download fails — no silent missing-model surprises.
# Example: FALLBACK_MODEL_REPO=istupakov/parakeet-tdt-0.6b-v3-onnx
ARG FALLBACK_MODEL_REPO=""
ARG HF_TOKEN=""

# ---------- Stage 1: download model (only when FALLBACK_MODEL_REPO is set) ---
# Uses a python image where huggingface-hub installs cleanly, then we copy
# only the downloaded files into the final node image — zero python bloat.
FROM python:3.12-alpine AS model-downloader
ARG FALLBACK_MODEL_REPO=""
ARG HF_TOKEN=""
ENV HF_TOKEN=${HF_TOKEN}
RUN if [ -n "$FALLBACK_MODEL_REPO" ]; then \
      set -e; \
      python3 -m ensurepip --upgrade 2>/dev/null || true; \
      python3 -m pip install --no-cache-dir huggingface-hub; \
      mkdir -p "/fallback_models/${FALLBACK_MODEL_REPO}"; \
      python3 -c "from huggingface_hub import snapshot_download; snapshot_download('${FALLBACK_MODEL_REPO}', local_dir='/fallback_models/${FALLBACK_MODEL_REPO}')"; \
      # Sanity check: vocab.txt must exist (same file the UI checks at startup) \
      if [ ! -f "/fallback_models/${FALLBACK_MODEL_REPO}/vocab.txt" ]; then \
        echo "ERROR: vocab.txt not found in /fallback_models/${FALLBACK_MODEL_REPO}/"; \
        echo "Directory contents:"; \
        ls -lhR "/fallback_models/${FALLBACK_MODEL_REPO}/" 2>&1 || echo "(directory does not exist)"; \
        exit 1; \
      fi; \
    else \
      mkdir -p /fallback_models; \
    fi

# ---------- Stage 2: development image ----------------------------------
# Source code is baked in; docker-compose bind-mounts override it for hot-reload.
FROM node:20-alpine AS development

# Copy downloaded model files (empty dir if FALLBACK_MODEL_REPO was not set)
COPY --from=model-downloader /fallback_models /fallback_models

# Run as non-root user
USER node

# Set working directory
WORKDIR /app

# Install dependencies first (layer-cached unless package*.json changes)
COPY --chown=node:node app/package*.json ./
COPY --chown=node:node app/ui/package*.json ./ui/
RUN npm install && \
    cd ui && \
    npm install

# Install signaling server dependencies into a fixed, image-owned location.
# /signaling is bind-mounted read-only at runtime, so node_modules cannot live
# there. We install into /signaling-deps and the entrypoint sets NODE_PATH.
COPY --chown=node:node signaling/package*.json /signaling-deps/
RUN cd /signaling-deps && npm install --production

# Bake the full source into the image so it runs without any bind mounts.
# docker-compose.yml still bind-mounts ../app and ../signaling for hot-reload,
# which simply shadows these layers — no functional difference.
COPY --chown=node:node app/ ./
COPY --chown=node:node signaling/ /signaling/

# Copy the entrypoint script that sets up model symlinks before starting Vite
COPY --chown=node:node docker/entrypoint.sh /entrypoint.sh

# Expose Vite dev server port
EXPOSE 5173

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "install"]

# ---------- Stage 3: production builder ---------------------------------
FROM node:20-alpine AS prod-builder

COPY --from=model-downloader /fallback_models /fallback_models

USER node
WORKDIR /app

COPY --chown=node:node app/package*.json ./
COPY --chown=node:node app/ui/package*.json ./ui/
RUN npm install && cd ui && npm install

COPY --chown=node:node app/ ./

# Wire up baked-in fallback models into public/ so they get included in the build
RUN if [ -d /fallback_models ] && [ "$(ls -A /fallback_models 2>/dev/null)" ]; then \
      for org_dir in /fallback_models/*/; do \
        org=$(basename "$org_dir"); \
        mkdir -p "ui/public/models/${org}"; \
        for repo_dir in "$org_dir"*/; do \
          repo=$(basename "$repo_dir"); \
          target="ui/public/models/${org}/${repo}"; \
          [ ! -e "$target" ] && ln -s "$repo_dir" "$target"; \
        done; \
      done; \
    fi

RUN cd ui && npm run build

# ---------- Stage 4: production image -----------------------------------
# Minimal image: built static files + vite preview (handles COOP/COEP + proxy).
FROM node:20-alpine AS production

COPY --from=model-downloader /fallback_models /fallback_models

USER node
WORKDIR /app

# Copy the built UI and the vite/node toolchain needed for `vite preview`
COPY --from=prod-builder --chown=node:node /app/ui/dist ./ui/dist
COPY --from=prod-builder --chown=node:node /app/ui/vite.config.js ./ui/vite.config.js
COPY --from=prod-builder --chown=node:node /app/ui/package*.json ./ui/
COPY --from=prod-builder --chown=node:node /app/ui/node_modules ./ui/node_modules
COPY --from=prod-builder --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-builder --chown=node:node /app/package*.json ./

# Signaling server
COPY --chown=node:node signaling/package*.json /signaling-deps/
RUN cd /signaling-deps && npm install --production
COPY --chown=node:node signaling/ /signaling/

COPY --chown=node:node docker/entrypoint.prod.sh /entrypoint.sh

EXPOSE 5173

ENTRYPOINT ["/entrypoint.sh"]
