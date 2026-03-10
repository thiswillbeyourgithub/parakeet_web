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

# ---------- Stage 2: final image ----------------------------------------
FROM node:20-alpine

# Copy downloaded model files (empty dir if FALLBACK_MODEL_REPO was not set)
COPY --from=model-downloader /fallback_models /fallback_models

# Run as non-root user
USER node

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
# These will be overridden by volume mounts in docker-compose for development
COPY --chown=node:node app/package*.json ./
COPY --chown=node:node app/ui/package*.json ./ui/

# Install dependencies
RUN npm install && \
    cd ui && \
    npm install

# Copy the entrypoint script that sets up model symlinks before starting Vite
COPY --chown=node:node entrypoint.sh /entrypoint.sh

# Expose Vite dev server port
EXPOSE 5173

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "install"]
