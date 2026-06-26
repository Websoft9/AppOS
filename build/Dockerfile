FROM alpine:3.24

ARG VICTORIAMETRICS_VERSION=v1.146.0
ARG TRAEFIK_VERSION=v3.7.5
ARG TARGETARCH

LABEL maintainer="Websoft9<help@websoft9.com>" \
      org.opencontainers.image.title="AppOS" \
      org.opencontainers.image.description="All-in-One container: pre-built AppOS + Redis + VictoriaMetrics + Traefik" \
      org.opencontainers.image.vendor="Websoft9" \
      org.opencontainers.image.url="https://www.websoft9.com" \
      org.opencontainers.image.source="https://github.com/websoft9/websoft9"

# Install runtime dependencies.
RUN apk add --no-cache \
		ca-certificates \
		curl \
		redis \
		runit \
		tzdata

# Download external binaries from GitHub releases (bypasses registry mirrors).
RUN set -eux; \
        arch="$TARGETARCH"; \
        case "$arch" in \
                amd64|arm64) ;; \
                *) echo "unsupported TARGETARCH: $arch" >&2; exit 1 ;; \
        esac; \
        curl -fsSL --retry 3 --retry-delay 5 --connect-timeout 30 --max-time 600 \
            "https://github.com/VictoriaMetrics/VictoriaMetrics/releases/download/${VICTORIAMETRICS_VERSION}/victoria-metrics-linux-${arch}-${VICTORIAMETRICS_VERSION}.tar.gz" \
            | tar xz -C /tmp; \
        mv /tmp/victoria-metrics-prod /usr/local/bin/victoria-metrics-prod; \
        curl -fsSL --retry 3 --retry-delay 5 --connect-timeout 30 --max-time 600 \
            "https://github.com/traefik/traefik/releases/download/${TRAEFIK_VERSION}/traefik_${TRAEFIK_VERSION}_linux_${arch}.tar.gz" \
            | tar xz -C /tmp; \
        mv /tmp/traefik /usr/local/bin/traefik; \
        chmod 755 /usr/local/bin/victoria-metrics-prod /usr/local/bin/traefik

# Copy build artifacts
COPY backend/appos /usr/local/bin/appos
COPY web/dist /appos/web
COPY templates/apps /appos/data/templates/apps

# Copy configuration files and set up runit services
COPY --chmod=755 build/runit/appos/run /etc/sv/appos/run
COPY --chmod=755 build/runit/redis/run /etc/sv/redis/run
COPY --chmod=755 build/runit/victoriametrics/run /etc/sv/victoriametrics/run
COPY --chmod=755 build/runit/traefik/run /etc/sv/traefik/run
COPY build/runit/traefik/down /etc/sv/traefik/down
COPY build/traefik.yml /etc/traefik/traefik.yml
COPY build/traefik-dashboard.yml /etc/traefik/dynamic/dashboard.yml
COPY --chmod=755 build/entrypoint.sh /entrypoint.sh

RUN mkdir -p \
    /etc/service \
    /etc/sv \
    /etc/traefik/dynamic \
    && ln -s /etc/sv/appos /etc/service/appos \
    && ln -s /etc/sv/redis /etc/service/redis \
    && ln -s /etc/sv/victoriametrics /etc/service/victoriametrics \
    && ln -s /etc/sv/traefik /etc/service/traefik

# Verify critical files
RUN set -eux; \
    test -x /usr/local/bin/appos || { echo "ERROR: appos binary not found"; exit 1; }; \
    test -x /usr/local/bin/victoria-metrics-prod || { echo "ERROR: victoria-metrics-prod binary not found"; exit 1; }; \
    test -x /usr/local/bin/traefik || { echo "ERROR: traefik binary not found"; exit 1; }; \
	command -v runsvdir >/dev/null 2>&1 || { echo "ERROR: runsvdir binary not found"; exit 1; }; \
	command -v sv >/dev/null 2>&1 || { echo "ERROR: sv binary not found"; exit 1; }; \
	command -v redis-server >/dev/null 2>&1 || { echo "ERROR: redis-server binary not found"; exit 1; }; \
    test -x /entrypoint.sh || { echo "ERROR: entrypoint.sh not executable"; exit 1; }; \
    traefik version >/dev/null 2>&1 || { echo "ERROR: traefik binary invalid"; exit 1; }

ENV DISABLE_TELEMETRY=1 \
    DO_NOT_TRACK=1

# Expose ports for Proxy Gateway(Traefik http/https), AppOS Console and SSH Tunnel
EXPOSE 8081 8443 9000 2222

VOLUME ["/appos/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:9000/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["runsvdir", "-P", "/etc/service"]
