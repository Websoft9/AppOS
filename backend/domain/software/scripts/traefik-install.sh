#!/bin/bash
PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/local/bin:/usr/local/sbin
export PATH

set -euo pipefail

APP_ROOT="/opt/websoft9/traefik"
CONFIG_DIR="/etc/traefik"
DYNAMIC_DIR="/etc/traefik/dynamic"
COMPOSE_FILE="$APP_ROOT/docker-compose.yml"
STATIC_FILE="$CONFIG_DIR/traefik.yml"
SYSTEMD_UNIT="/etc/systemd/system/traefik.service"
IMAGE="traefik:v3.4.1"
CONTAINER_NAME="appos-traefik"

MODE="install"
if [[ "${1:-}" == "--upgrade" ]]; then
  MODE="upgrade"
elif [[ "${1:-}" == "--uninstall" ]]; then
  MODE="uninstall"
fi

log() {
  printf '[traefik-install] %s\n' "$*"
}

require_root() {
  if [[ "$(id -u)" != "0" ]]; then
    echo "this script must run as root" >&2
    exit 1
  fi
}

require_docker() {
  command -v docker >/dev/null 2>&1 || {
    echo "docker is required before installing Traefik" >&2
    exit 1
  }
  docker compose version >/dev/null 2>&1 || {
    echo "docker compose plugin is required before installing Traefik" >&2
    exit 1
  }
}

write_static_config() {
  mkdir -p "$CONFIG_DIR" "$DYNAMIC_DIR"
  cat > "$STATIC_FILE" <<'EOF'
global:
  checkNewVersion: false
  sendAnonymousUsage: false

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true

api:
  dashboard: false

ping: {}

log:
  level: INFO
EOF
}

write_compose_file() {
  mkdir -p "$APP_ROOT"
  cat > "$COMPOSE_FILE" <<EOF
services:
  traefik:
    image: $IMAGE
    container_name: $CONTAINER_NAME
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - $STATIC_FILE:/etc/traefik/traefik.yml:ro
      - $DYNAMIC_DIR:/etc/traefik/dynamic
EOF
}

write_systemd_unit() {
  cat > "$SYSTEMD_UNIT" <<EOF
[Unit]
Description=Traefik reverse proxy (Docker Compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_ROOT
ExecStart=/bin/sh -lc 'docker compose -f $COMPOSE_FILE up -d --remove-orphans'
ExecStop=/bin/sh -lc 'docker compose -f $COMPOSE_FILE down'
ExecReload=/bin/sh -lc 'docker compose -f $COMPOSE_FILE up -d --remove-orphans'
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
}

enable_and_start() {
  systemctl daemon-reload
  systemctl enable --now traefik.service
}

upgrade_stack() {
  docker compose -f "$COMPOSE_FILE" pull
  systemctl restart traefik.service
}

uninstall_stack() {
  if [[ -f "$SYSTEMD_UNIT" ]]; then
    systemctl disable --now traefik.service >/dev/null 2>&1 || true
    rm -f "$SYSTEMD_UNIT"
    systemctl daemon-reload
  fi
  if [[ -f "$COMPOSE_FILE" ]]; then
    docker compose -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$APP_ROOT"
  rm -f "$STATIC_FILE"
  rm -rf "$DYNAMIC_DIR"
}

install_stack() {
  write_static_config
  write_compose_file
  write_systemd_unit
  docker pull "$IMAGE"
  enable_and_start
}

require_root

case "$MODE" in
  install)
    require_docker
    log "installing Traefik Docker stack"
    install_stack
    ;;
  upgrade)
    require_docker
    log "upgrading Traefik Docker stack"
    write_static_config
    write_compose_file
    write_systemd_unit
    if [[ ! -f "$SYSTEMD_UNIT" ]]; then
      echo "traefik service is not installed" >&2
      exit 1
    fi
    upgrade_stack
    ;;
  uninstall)
    log "uninstalling Traefik Docker stack"
    uninstall_stack
    ;;
  *)
    echo "unsupported mode: $MODE" >&2
    exit 1
    ;;
esac