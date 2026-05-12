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
# Docker CLI Provider
# ===========================
FROM docker:28-cli AS docker-cli-provider

# ===========================
# VictoriaMetrics Binary
# ===========================
FROM victoriametrics/victoria-metrics:v1.124.0 AS victoriametrics-bin

# ===========================
# Stage 2: Build Backend (PocketBase Framework)
# ===========================
FROM golang:1.26.2-alpine AS backend-builder

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
FROM netdata/netdata:stable

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
    org.opencontainers.image.description="All-in-One container: Web app + PocketBase Framework (AppOS) + Redis + VictoriaMetrics + optional Netdata" \
      org.opencontainers.image.vendor="Websoft9" \
      org.opencontainers.image.url="https://www.websoft9.com" \
      org.opencontainers.image.source="https://github.com/websoft9/websoft9"

# Install runtime dependencies on top of the official Netdata runtime.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        supervisor \
        redis-server \
        unzip \
        ca-certificates \
        tzdata \
        bash \
        nginx \
    && rm -rf /var/lib/apt/lists/*

# Copy Node.js 24 from node-provider
COPY --from=node-provider /usr/local/bin/node /usr/local/bin/node
COPY --from=node-provider /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=docker-cli-provider /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli-provider /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

RUN npm install -g @mariozechner/pi-coding-agent \
    && npm cache clean --force \
    && rm -rf /root/.npm

# Copy build artifacts
COPY --from=web-builder /build/dist /usr/share/nginx/html/web
COPY --from=backend-builder /build/appos /usr/local/bin/appos
COPY --from=victoriametrics-bin /victoria-metrics-prod /usr/local/bin/victoria-metrics-prod

# Download Store Library plugin at build time
ARG WEBSOFT9_ARTIFACT="https://artifact.websoft9.com/release/websoft9"
RUN set -eux; \
    curl -fsSL --retry 3 -o /tmp/library.zip ${WEBSOFT9_ARTIFACT}/plugin/library/library-latest.zip; \
    mkdir -p /appos; \
    unzip -q /tmp/library.zip -d /appos; \
    rm /tmp/library.zip

RUN rm -f \
    /usr/libexec/netdata/plugins.d/otel-plugin \
    /usr/libexec/netdata/plugins.d/otel-signal-viewer-plugin \
    /usr/libexec/netdata/plugins.d/network-viewer.plugin \
    /usr/libexec/netdata/plugins.d/systemd-journal.plugin \
    /usr/libexec/netdata/plugins.d/systemd-units.plugin \
    /usr/libexec/netdata/plugins.d/freeipmi.plugin \
    /usr/libexec/netdata/plugins.d/perf.plugin \
    /usr/libexec/netdata/plugins.d/slabinfo.plugin \
    /usr/libexec/netdata/plugins.d/python.d.plugin \
    /usr/libexec/netdata/plugins.d/charts.d.plugin \
    /usr/libexec/netdata/plugins.d/ioping.plugin \
    /usr/libexec/netdata/plugins.d/local-listeners

# Create data directories
RUN mkdir -p \
    /appos/data/pb/pb_data \
    /appos/data/pb/pb_migrations \
    /appos/data/redis \
    /appos/data/apps \
    /appos/data/pi \
    /appos/data/netdata \
    /appos/data/victoriametrics \
    /appos/data/workflows \
    /appos/data/templates/apps \
    /appos/data/templates/workflows \
    /appos/data/templates/custom \
    /var/log/supervisor \
    /var/log/netdata \
    /var/log/nginx \
    /usr/local/libexec/docker/cli-plugins \
    /etc/nginx/conf.d \
    /run/nginx

RUN touch /etc/netdata/.opt-out-from-anonymous-statistics

# Copy configuration files
COPY build/supervisord.conf /etc/supervisor/supervisord.conf
COPY build/nginx.conf /etc/nginx/nginx.conf
COPY build/netdata/netdata.conf /etc/netdata/netdata.conf
COPY build/netdata/exporting.conf /etc/netdata/exporting.conf
COPY --chmod=755 build/entrypoint.sh /entrypoint.sh

RUN mkdir -p /usr/local/share/appos/netdata-defaults \
    && cp -a /etc/netdata/. /usr/local/share/appos/netdata-defaults/

# Verify critical files
RUN set -eux; \
    test -x /usr/local/bin/appos || { echo "ERROR: appos binary not found"; exit 1; }; \
    test -x /usr/local/bin/victoria-metrics-prod || { echo "ERROR: victoria-metrics-prod binary not found"; exit 1; }; \
    test -x /usr/local/bin/pi || { echo "ERROR: pi binary not found"; exit 1; }; \
    test -x /entrypoint.sh || { echo "ERROR: entrypoint.sh not executable"; exit 1; }; \
    nginx -t || { echo "ERROR: nginx config invalid"; exit 1; }

ENV PI_CODING_AGENT_DIR=/appos/data/pi \
    TSDB_ADDR=http://127.0.0.1:8428 \
    DISABLE_TELEMETRY=1 \
    DO_NOT_TRACK=1

EXPOSE 80

VOLUME ["/appos/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
