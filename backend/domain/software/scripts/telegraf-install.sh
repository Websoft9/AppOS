#!/usr/bin/env bash
set -euo pipefail

SCRIPT_VERSION="2026-05-21"
TELEGRAF_VERSION="${APPOS_TELEGRAF_VERSION:-1.38.4}"
TELEGRAF_ARCHIVE_URL="${APPOS_TELEGRAF_ARCHIVE_URL:-}"
INSTALL_ROOT="${APPOS_TELEGRAF_INSTALL_ROOT:-/opt/appos/telegraf}"
ACTIVE_LINK="${APPOS_TELEGRAF_ACTIVE_LINK:-/usr/local/bin/telegraf}"
CONFIG_DIR="${APPOS_TELEGRAF_CONFIG_DIR:-/etc/telegraf}"
CONFIG_PATH="${APPOS_TELEGRAF_CONFIG_PATH:-$CONFIG_DIR/telegraf.conf}"
SERVICE_NAME="${APPOS_TELEGRAF_SERVICE_NAME:-${APPOS_SERVICE:-appos-monitor.service}}"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"
DATA_DIR="${APPOS_TELEGRAF_DATA_DIR:-/var/lib/telegraf}"
LOG_DIR="${APPOS_TELEGRAF_LOG_DIR:-/var/log/telegraf}"
LEGACY_SERVICE_NAMES_RAW="${APPOS_LEGACY_SERVICE_NAMES:-}"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log() {
  local level="$1"
  shift
  printf '%s [%s] %s\n' "$(timestamp)" "$level" "$*"
}

log_info() {
  log INFO "$@"
}

log_warn() {
  log WARN "$@"
}

log_error() {
  log ERROR "$@" >&2
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command_exists sudo; then
    sudo "$@"
  else
    log_error "root privileges are required to run: $*"
    exit 1
  fi
}

detect_arch() {
  local machine
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64)
      printf 'amd64\n'
      ;;
    aarch64|arm64)
      printf 'arm64\n'
      ;;
    armv7l|armv7)
      printf 'armhf\n'
      ;;
    armv6l|armv6)
      printf 'armel\n'
      ;;
    *)
      log_error "unsupported architecture: $machine"
      exit 1
      ;;
  esac
}

resolve_archive_url() {
  if [[ -n "$TELEGRAF_ARCHIVE_URL" ]]; then
    printf '%s\n' "$TELEGRAF_ARCHIVE_URL"
    return 0
  fi

  local arch
  arch="$(detect_arch)"
  printf 'https://dl.influxdata.com/telegraf/releases/telegraf-%s_linux_%s.tar.gz\n' "$TELEGRAF_VERSION" "$arch"
}

default_config() {
  cat <<'EOF'
[agent]
  interval = "10s"
  round_interval = true
  metric_batch_size = 1000
  metric_buffer_limit = 5000
  collection_jitter = "1s"
  flush_interval = "10s"
  flush_jitter = "1s"
  precision = "1s"
  omit_hostname = false

[[inputs.cpu]]
  percpu = false
  totalcpu = true
  collect_cpu_time = true
  report_active = true

[[inputs.mem]]

[[inputs.system]]

[[inputs.disk]]
  ignore_fs = ["tmpfs", "devtmpfs", "devfs", "iso9660", "overlay", "aufs", "squashfs"]

[[inputs.diskio]]

[[inputs.net]]

[[inputs.docker]]
  endpoint = "unix:///var/run/docker.sock"
  gather_services = false

[[outputs.file]]
  files = ["stdout"]
  data_format = "influx"
EOF
}

write_config() {
  local tmp_config
  tmp_config="$(mktemp)"
  if [[ -n "${APPOS_TELEGRAF_CONFIG_B64:-}" ]]; then
    printf '%s' "$APPOS_TELEGRAF_CONFIG_B64" | base64 -d > "$tmp_config"
  else
    default_config > "$tmp_config"
  fi

  run_root install -d -m 0755 "$CONFIG_DIR"
  run_root install -m 0644 "$tmp_config" "$CONFIG_PATH"
  rm -f "$tmp_config"
}

write_service() {
  local tmp_service
  tmp_service="$(mktemp)"
  cat > "$tmp_service" <<EOF
[Unit]
Description=Native Telegraf agent for AppOS metrics collector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$ACTIVE_LINK --config $CONFIG_PATH
Restart=on-failure
RestartSec=5
WorkingDirectory=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

  run_root install -m 0644 "$tmp_service" "$SERVICE_PATH"
  rm -f "$tmp_service"
  run_root systemctl daemon-reload
}

install_binary() {
  local archive_url tmp_dir archive_path version_dir extracted_bin
  archive_url="$(resolve_archive_url)"
  tmp_dir="$(mktemp -d)"
  archive_path="$tmp_dir/telegraf.tar.gz"
  version_dir="$INSTALL_ROOT/$TELEGRAF_VERSION"

  # Expand tmp_dir now so the RETURN trap does not depend on a local variable.
  trap "rm -rf -- '$tmp_dir'" RETURN

  log_info "downloading Telegraf $TELEGRAF_VERSION from $archive_url"
  if command_exists curl; then
    curl -fsSL "$archive_url" -o "$archive_path"
  elif command_exists wget; then
    wget -qO "$archive_path" "$archive_url"
  else
    log_error "curl or wget is required"
    exit 1
  fi

  tar -xzf "$archive_path" -C "$tmp_dir"
  extracted_bin="$(find "$tmp_dir" -type f -path '*/usr/bin/telegraf' | head -n 1)"
  if [[ -z "$extracted_bin" ]]; then
    log_error "failed to locate telegraf binary in archive"
    exit 1
  fi

  run_root install -d -m 0755 "$version_dir" "$DATA_DIR" "$LOG_DIR"
  run_root install -m 0755 "$extracted_bin" "$version_dir/telegraf"
  run_root ln -sfn "$version_dir/telegraf" "$ACTIVE_LINK"
  trap - RETURN
  rm -rf -- "$tmp_dir"
}

enable_service() {
  run_root systemctl enable --now "$SERVICE_NAME"
  run_root systemctl restart "$SERVICE_NAME"
}

stop_service() {
  run_root systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
}

cleanup_legacy_services() {
  local removed_unit=0
  local raw_name legacy_name legacy_path
  while IFS= read -r raw_name; do
    legacy_name="$(printf '%s' "$raw_name" | xargs)"
    if [[ -z "$legacy_name" || "$legacy_name" == "$SERVICE_NAME" ]]; then
      continue
    fi

    legacy_path="/etc/systemd/system/$legacy_name"
    if [[ ! -f "$legacy_path" ]]; then
      log_warn "legacy unit $legacy_name is not an AppOS-managed override in /etc/systemd/system; leaving it in place"
      continue
    fi

    if grep -q "Native Telegraf agent for AppOS metrics collector" "$legacy_path" || \
      grep -q "$ACTIVE_LINK --config $CONFIG_PATH" "$legacy_path"; then
      log_info "cleaning up legacy service $legacy_name"
      run_root systemctl disable --now "$legacy_name" >/dev/null 2>&1 || true
      run_root rm -f "$legacy_path"
      removed_unit=1
      log_info "removed legacy AppOS Telegraf unit $legacy_name"
    else
      log_warn "legacy unit $legacy_name does not look AppOS-managed; leaving unit file in place"
    fi
  done <<< "$LEGACY_SERVICE_NAMES_RAW"

  if [[ "$removed_unit" -eq 1 ]]; then
    run_root systemctl daemon-reload
  fi
}

uninstall_telegraf() {
  log_info "stopping Telegraf service"
  stop_service
  cleanup_legacy_services
  run_root rm -f "$SERVICE_PATH"
  run_root systemctl daemon-reload
  run_root rm -f "$ACTIVE_LINK"
  run_root rm -rf "$INSTALL_ROOT" "$CONFIG_DIR"
  log_info "Telegraf uninstall completed"
}

verify_dependencies() {
  if ! command_exists systemctl; then
    log_error "systemd is required"
    exit 1
  fi
  if ! command_exists tar; then
    log_error "tar is required"
    exit 1
  fi
}

main() {
  verify_dependencies

  case "${1:-}" in
    --uninstall)
      uninstall_telegraf
      ;;
    --upgrade|--reinstall)
      cleanup_legacy_services
      install_binary
      write_config
      write_service
      enable_service
      ;;
    "")
      cleanup_legacy_services
      install_binary
      write_config
      write_service
      enable_service
      ;;
    *)
      log_error "unsupported argument: $1"
      exit 1
      ;;
  esac

  log_info "Telegraf installer $SCRIPT_VERSION finished successfully"
}

main "$@"