FROM node:20-alpine

# Optional: bake a HuggingFace model into the image so the container can serve
# weights locally when HuggingFace is unreachable.  When set, the build will
# fail immediately if the download fails — no silent missing-model surprises.
# Example: FALLBACK_MODEL_REPO=istupakov/parakeet-tdt-0.6b-v3-onnx
ARG FALLBACK_MODEL_REPO=""

# Download the model at build time (runs as root so we can install pip).
# The entire python3/pip layer is removed afterwards to keep the image lean.
# Files land in /fallback_models/<org>/<repo>/ mirroring the repo ID path the
# frontend expects under /models/.
RUN if [ -n "$FALLBACK_MODEL_REPO" ]; then \
      set -e; \
      apk add --no-cache python3 py3-pip; \
      pip install --break-system-packages huggingface-hub; \
      # Convert "org/repo" → directory path and download
      mkdir -p "/fallback_models/${FALLBACK_MODEL_REPO}"; \
      huggingface-cli download "$FALLBACK_MODEL_REPO" \
        --local-dir "/fallback_models/${FALLBACK_MODEL_REPO}"; \
      # Sanity check: vocab.txt must exist (same file the UI checks at startup)
      test -f "/fallback_models/${FALLBACK_MODEL_REPO}/vocab.txt" \
        || { echo "ERROR: vocab.txt not found after download — model may be invalid"; exit 1; }; \
      # Clean up python to save image space
      pip uninstall -y huggingface-hub; \
      apk del python3 py3-pip; \
      rm -rf /root/.cache /tmp/*; \
    fi

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
