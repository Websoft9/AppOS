ARG VICTORIAMETRICS_VERSION=v1.144.0

# ===========================
# Stage 1: Build Web App
# ===========================
FROM node:24-alpine AS web-builder

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG ALL_PROXY
ARG NO_PROXY
ARG http_proxy
ARG https_proxy
ARG all_proxy
ARG no_proxy
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    ALL_PROXY=${ALL_PROXY} \
    NO_PROXY=${NO_PROXY} \
    http_proxy=${http_proxy} \
    https_proxy=${https_proxy} \
    all_proxy=${all_proxy} \
    no_proxy=${no_proxy}

WORKDIR /build
COPY web/package.json web/package-lock.json* ./
RUN npm ci --silent
COPY web/ .
RUN npm run build

# ===========================
# Node.js 24 Runtime Provider
# ===========================
FROM node:24-bookworm-slim AS node-provider

# ===========================
# VictoriaMetrics Binary
# ===========================
FROM victoriametrics/victoria-metrics:${VICTORIAMETRICS_VERSION} AS victoriametrics-bin

# ===========================
# Stage 2: Build Backend (PocketBase Framework)
# ===========================
FROM golang:1.26.3-alpine AS backend-builder

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG ALL_PROXY
ARG NO_PROXY
ARG http_proxy
ARG https_proxy
ARG all_proxy
ARG no_proxy
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    ALL_PROXY=${ALL_PROXY} \
    NO_PROXY=${NO_PROXY} \
    http_proxy=${http_proxy} \
    https_proxy=${https_proxy} \
    all_proxy=${all_proxy} \
    no_proxy=${no_proxy}

WORKDIR /build
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ .
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o appos ./cmd/appos

# ===========================
# Stage 3: Runtime
# ===========================
FROM debian:bookworm-slim

ARG SUPERVISOR_VERSION=4.3.0

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG ALL_PROXY
ARG NO_PROXY
ARG http_proxy
ARG https_proxy
ARG all_proxy
ARG no_proxy
ENV HTTP_PROXY=${HTTP_PROXY} \
        HTTPS_PROXY=${HTTPS_PROXY} \
        ALL_PROXY=${ALL_PROXY} \
        NO_PROXY=${NO_PROXY} \
        http_proxy=${http_proxy} \
        https_proxy=${https_proxy} \
        all_proxy=${all_proxy} \
        no_proxy=${no_proxy}

LABEL maintainer="Websoft9<help@websoft9.com>" \
      org.opencontainers.image.title="AppOS" \
    org.opencontainers.image.description="All-in-One container: Web app + PocketBase Framework (AppOS) + Redis + VictoriaMetrics" \
      org.opencontainers.image.vendor="Websoft9" \
      org.opencontainers.image.url="https://www.websoft9.com" \
      org.opencontainers.image.source="https://github.com/websoft9/websoft9"

# Install runtime dependencies.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        redis-server \
        openssl \
        unzip \
        ca-certificates \
        tzdata \
        bash \
        curl \
        git \
        python3 \
        python3-socks \
        python3-venv \
        nginx \
    && python3 -m venv --system-site-packages /opt/supervisor \
    && /opt/supervisor/bin/pip install --no-cache-dir supervisor==${SUPERVISOR_VERSION} \
    && ln -sf /opt/supervisor/bin/supervisord /usr/local/bin/supervisord \
    && ln -sf /opt/supervisor/bin/supervisorctl /usr/local/bin/supervisorctl \
    && rm -rf /var/lib/apt/lists/*

# Copy Node.js 24 from node-provider
COPY --from=node-provider /usr/local/bin/node /usr/local/bin/node
COPY --from=node-provider /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# Copy build artifacts
COPY --from=web-builder /build/dist /usr/share/nginx/html/web
COPY --from=backend-builder /build/appos /usr/local/bin/appos
COPY templates/apps /appos/data/templates/apps
COPY --from=victoriametrics-bin /victoria-metrics-prod /usr/local/bin/victoria-metrics-prod

# Create data directories
RUN mkdir -p \
    /appos/data/pb/pb_data \
    /appos/data/pb/pb_migrations \
    /appos/data/redis \
    /appos/data/apps \
    /appos/data/victoriametrics \
    /appos/data/workflows \
    /appos/data/templates/apps \
    /appos/data/templates/workflows \
    /appos/data/templates/custom \
    /appos/data/templates/custom/apps \
    /appos/data/templates/official/apps \
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
    test -x /usr/local/bin/victoria-metrics-prod || { echo "ERROR: victoria-metrics-prod binary not found"; exit 1; }; \
    test -x /entrypoint.sh || { echo "ERROR: entrypoint.sh not executable"; exit 1; }; \
    supervisord --version | grep -Fx "${SUPERVISOR_VERSION}" || { echo "ERROR: supervisor version mismatch"; exit 1; }; \
    nginx -t || { echo "ERROR: nginx config invalid"; exit 1; }

ENV TSDB_ADDR=http://127.0.0.1:8428 \
    DISABLE_TELEMETRY=1 \
    DO_NOT_TRACK=1

EXPOSE 80

VOLUME ["/appos/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
