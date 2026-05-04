FROM node:20-alpine

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

# Optionally fail the build on high-severity npm vulnerabilities.
ARG RUN_NPM_AUDIT=false
RUN if [ "$RUN_NPM_AUDIT" = "true" ]; then \
      set -e; \
      npm audit --audit-level=high && \
      cd ui && npm audit --audit-level=high; \
    fi

# Install signaling server dependencies into a fixed, image-owned location.
# /signaling is bind-mounted read-only at runtime, so node_modules cannot live
# there. We install into /signaling-deps and the entrypoint sets NODE_PATH.
COPY --chown=node:node signaling/package*.json /signaling-deps/
RUN cd /signaling-deps && npm install --production && \
    if [ "$RUN_NPM_AUDIT" = "true" ]; then npm audit --audit-level=high; fi

# Copy the entrypoint script that sets up model symlinks before starting Vite
COPY --chown=node:node docker/entrypoint.sh /entrypoint.sh

# Expose Vite dev server port
EXPOSE 5173

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "install"]
