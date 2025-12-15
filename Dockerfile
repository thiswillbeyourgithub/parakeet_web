FROM node:20-alpine

# Run as non-root user
USER node

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
# These will be overridden by volume mounts in docker-compose for development
COPY --chown=node:node package*.json ./
COPY --chown=node:node ui/package*.json ./ui/

# Install dependencies
RUN npm install && \
    cd ui && \
    npm install

# Expose Vite dev server port
EXPOSE 5173

# Default command to run dev server
CMD ["sh", "-c", "npm install && cd ui && npm install && npm run dev -- --host 0.0.0.0"]
