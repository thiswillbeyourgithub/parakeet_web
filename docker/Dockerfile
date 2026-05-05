# syntax=docker/dockerfile:1.6

# ── Stage 1: build the static UI bundle and install signaling deps ──────────
FROM node:20-alpine AS builder
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

# Optionally fail the build on high-severity npm vulnerabilities.
ARG RUN_NPM_AUDIT=false
RUN if [ "$RUN_NPM_AUDIT" = "true" ]; then \
      set -e; \
      cd app && npm audit --audit-level=high && \
      cd ../ui && npm audit --audit-level=high && \
      cd ../../signaling && npm audit --audit-level=high; \
    fi

# Now copy sources and build
COPY app/src ./app/src
COPY app/ui ./app/ui
COPY signaling ./signaling

RUN cd app/ui && npm run build

# ── Stage 2: runtime image — Caddy serves dist/, Node runs signaling ───────
FROM caddy:2-alpine

RUN apk add --no-cache nodejs

# Built static assets
COPY --from=builder /build/app/ui/dist /srv

# Signaling server source + its production node_modules
COPY --from=builder /build/signaling /signaling

COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5173
ENTRYPOINT ["/entrypoint.sh"]
