# ===========================
# Stage 1: Build Dashboard
# ===========================
FROM node:20-alpine AS dashboard-builder

WORKDIR /build
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci --silent
COPY dashboard/ .
RUN npm run build

# ===========================
# Stage 2: Build Backend (PocketBase Framework)
# ===========================
FROM golang:1.26-alpine AS backend-builder

WORKDIR /build
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o appos ./cmd/appos

# ===========================
# Stage 3: Runtime
# ===========================
FROM alpine:3.19

LABEL maintainer="Websoft9<help@websoft9.com>" \
      org.opencontainers.image.title="AppOS" \
      org.opencontainers.image.description="All-in-One container: Dashboard + PocketBase Framework (AppOS) + Redis" \
      org.opencontainers.image.vendor="Websoft9" \
      org.opencontainers.image.url="https://www.websoft9.com" \
      org.opencontainers.image.source="https://github.com/websoft9/websoft9"

# Install runtime dependencies
RUN apk add --no-cache \
    nginx \
    supervisor \
    redis \
    curl \
    unzip \
    ca-certificates \
    tzdata \
    bash \
    docker-cli \
    docker-cli-compose \
    && rm -rf /var/cache/apk/*

# Copy build artifacts
COPY --from=dashboard-builder /build/dist /usr/share/nginx/html/dashboard
COPY --from=backend-builder /build/appos /usr/local/bin/appos

# Download Store Library plugin at build time
ARG WEBSOFT9_ARTIFACT="https://artifact.websoft9.com/release/websoft9"
RUN set -eux; \
    curl -fsSL --retry 3 -o /tmp/library.zip ${WEBSOFT9_ARTIFACT}/plugin/library/library-latest.zip; \
    mkdir -p /appos; \
    unzip -q /tmp/library.zip -d /appos; \
    rm /tmp/library.zip

# Create data directories
RUN mkdir -p \
    /appos/data/pb/pb_data \
    /appos/data/pb/pb_migrations \
    /appos/data/redis \
    /appos/data/apps \
    /appos/data/workflows \
    /appos/data/templates/apps \
    /appos/data/templates/workflows \
    /appos/data/templates/custom \
    /var/log/supervisor \
    /var/log/nginx \
    /etc/nginx/conf.d \
    /run/nginx

# Copy configuration files
COPY build/supervisord.conf /etc/supervisor/supervisord.conf
COPY build/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=755 build/entrypoint.sh /entrypoint.sh

# Verify critical files
RUN set -eux; \
    test -x /usr/local/bin/appos || { echo "ERROR: appos binary not found"; exit 1; }; \
    test -x /entrypoint.sh || { echo "ERROR: entrypoint.sh not executable"; exit 1; }; \
    nginx -t || { echo "ERROR: nginx config invalid"; exit 1; }

EXPOSE 80

VOLUME ["/appos/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
