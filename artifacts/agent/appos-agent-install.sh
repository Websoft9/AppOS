#!/bin/bash

PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/local/bin:/usr/local/sbin:~/bin
export PATH

set -eu
set -o pipefail

SCRIPT_NAME="appos-agent-install"
SCRIPT_VERSION="2026-04-29"
APPOS_AGENT_AMD64_URL="https://artifact.websoft9.com/stable/appos/agent/appos-agent-linux-amd64"
APPOS_AGENT_ARM64_URL="https://artifact.websoft9.com/stable/appos/agent/appos-agent-linux-arm64"
INSTALL_PATH="/usr/local/bin/appos-agent"
CONFIG_PATH="/etc/appos-agent.yaml"
SERVICE_NAME="appos-agent.service"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}"
TMP_DIR="$(mktemp -d -t appos-agent-install.XXXXXX)"
APPOS_AGENT_CONFIG_YAML="${APPOS_AGENT_CONFIG_YAML:-}"
APPOS_AGENT_SYSTEMD_UNIT="${APPOS_AGENT_SYSTEMD_UNIT:-}"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

print_usage() {
  cat <<'EOF'
Usage:
  appos-agent-install.sh [--upgrade] [--uninstall] [--help]

Options:
  --upgrade    Replace the installed binary and restart the service.
  --uninstall  Stop the service and remove the AppOS agent binary and unit.
  --help       Show this help text and exit.

Notes:
  - Install and upgrade can bootstrap /etc/appos-agent.yaml and the systemd unit
    from APPOS_AGENT_CONFIG_YAML and APPOS_AGENT_SYSTEMD_UNIT when provided.
  - Without those environment variables, install and upgrade require an existing
    /etc/appos-agent.yaml.
EOF
}

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log() {
  local level="$1"
  local stage="$2"
  shift 2
  printf '%s [%s] [%s] %s\n' "$(timestamp)" "$level" "$stage" "$*"
}

log_info() {
  log "INFO" "$1" "$2"
}

log_error() {
  log "ERROR" "$1" "$2"
}

require_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    log_error preflight "this installer must run as root"
    exit 1
  fi
}

require_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    log_error preflight "systemctl is required"
    exit 1
  fi
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)
      echo "amd64"
      ;;
    aarch64|arm64)
      echo "arm64"
      ;;
    *)
      log_error preflight "unsupported architecture: $(uname -m)"
      exit 1
      ;;
  esac
}

download_file() {
  local url="$1"
  local output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
    return
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$output" "$url"
    return
  fi
  log_error download "curl or wget is required"
  exit 1
}

binary_url_for_arch() {
  local arch="$1"
  case "$arch" in
    amd64)
      echo "$APPOS_AGENT_AMD64_URL"
      ;;
    arm64)
      echo "$APPOS_AGENT_ARM64_URL"
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_config_exists() {
  if [ ! -s "$CONFIG_PATH" ]; then
    log_error preflight "missing $CONFIG_PATH and APPOS_AGENT_CONFIG_YAML is empty"
    exit 1
  fi
}

write_config_from_env() {
  if [ -n "$APPOS_AGENT_CONFIG_YAML" ]; then
    install -d "$(dirname "$CONFIG_PATH")"
    printf '%s\n' "$APPOS_AGENT_CONFIG_YAML" > "$CONFIG_PATH"
  fi
}

write_systemd_unit() {
  if [ -n "$APPOS_AGENT_SYSTEMD_UNIT" ]; then
    cat > "$SERVICE_PATH" <<EOF
$APPOS_AGENT_SYSTEMD_UNIT
EOF
    return
  fi
  cat > "$SERVICE_PATH" <<'EOF'
[Unit]
Description=AppOS Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/appos-agent --config /etc/appos-agent.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}

install_binary() {
  local arch="$1"
  local download_url
  local download_path="$TMP_DIR/appos-agent"
  download_url="$(binary_url_for_arch "$arch")"
  log_info download "downloading ${arch} binary from ${download_url}"
  download_file "$download_url" "$download_path"
  install -d "$(dirname "$INSTALL_PATH")"
  install -m 0755 "$download_path" "$INSTALL_PATH"
}

enable_and_restart_service() {
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  systemctl --no-pager --full status "$SERVICE_NAME" >/dev/null
}

stop_and_disable_service() {
  if systemctl list-unit-files "$SERVICE_NAME" >/dev/null 2>&1; then
    systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi
}

ACTION="install"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --upgrade)
      ACTION="upgrade"
      ;;
    --uninstall)
      ACTION="uninstall"
      ;;
    --help)
      print_usage
      exit 0
      ;;
    *)
      log_error args "unknown argument: $1"
      print_usage
      exit 1
      ;;
  esac
  shift
done

require_root
require_systemd

case "$ACTION" in
  uninstall)
    log_info uninstall "removing AppOS agent service and binary"
    stop_and_disable_service
    rm -f "$SERVICE_PATH"
    systemctl daemon-reload
    rm -f "$INSTALL_PATH"
    log_info uninstall "completed"
    ;;
  install|upgrade)
    write_config_from_env
    ensure_config_exists
    arch="$(detect_arch)"
    install_binary "$arch"
    write_systemd_unit
    enable_and_restart_service
    log_info "$ACTION" "completed for ${arch}"
    ;;
esac