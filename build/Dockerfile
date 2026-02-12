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
# Stage 2: Build Backend
# ===========================
FROM golang:1.22-alpine AS backend-builder

# CGO required for SQLite
RUN apk add --no-cache gcc musl-dev sqlite-dev

WORKDIR /build
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=1 go build -ldflags="-w -s" -o main ./cmd/server

# ===========================
# Stage 3: Runtime
# ===========================
FROM alpine:3.19

LABEL maintainer="Websoft9<help@websoft9.com>" \
      org.opencontainers.image.title="AppOS" \
      org.opencontainers.image.description="All-in-One container: Dashboard + Backend API + Convex + Redis" \
      org.opencontainers.image.vendor="Websoft9" \
      org.opencontainers.image.url="https://www.websoft9.com" \
      org.opencontainers.image.source="https://github.com/websoft9/websoft9"

# Install runtime dependencies
RUN apk add --no-cache \
    nginx \
    supervisor \
    redis \
    curl \
    ca-certificates \
    sqlite \
    sqlite-libs \
    tzdata \
    && rm -rf /var/cache/apk/*

# Copy Convex backend binary (from official image)
COPY --from=ghcr.io/get-convex/convex-backend:latest \
    /convex/convex-local-backend /usr/local/bin/convex-backend
RUN chmod +x /usr/local/bin/convex-backend

# Copy build artifacts
COPY --from=dashboard-builder /build/dist /usr/share/nginx/html/dashboard
COPY --from=backend-builder /build/main /usr/local/bin/appos-api

# Create data directories
RUN mkdir -p \
    /appos/data/redis \
    /appos/data/convex \
    /appos/data/apps \
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
    test -x /usr/local/bin/appos-api || { echo "ERROR: appos-api binary not found"; exit 1; }; \
    test -x /usr/local/bin/convex-backend || { echo "ERROR: convex-backend not found"; exit 1; }; \
    test -x /entrypoint.sh || { echo "ERROR: entrypoint.sh not executable"; exit 1; }; \
    nginx -t || { echo "ERROR: nginx config invalid"; exit 1; }

EXPOSE 80

VOLUME ["/appos/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
