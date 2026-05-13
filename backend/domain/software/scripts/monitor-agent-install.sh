#!/usr/bin/env bash
set -euo pipefail

KICKSTART_URL="https://get.netdata.cloud/kickstart.sh"
EXPORTING_PATH="/etc/netdata/exporting.conf"
SERVICE_NAME="netdata.service"

log() {
  printf '%s\n' "$*"
}

have_arg() {
  local want="$1"
  shift || true
  for arg in "$@"; do
    if [[ "$arg" == "$want" ]]; then
      return 0
    fi
  done
  return 1
}

run_privileged() {
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo -n "$@"
  else
    "$@"
  fi
}

if have_arg "--uninstall" "$@"; then
  log "Stopping Netdata monitor agent."
  run_privileged systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  if [[ -x /usr/libexec/netdata/netdata-uninstaller.sh ]]; then
    run_privileged /usr/libexec/netdata/netdata-uninstaller.sh --yes || true
  elif command -v apt-get >/dev/null 2>&1; then
    run_privileged apt-get remove -y 'netdata*' || true
  fi
  log "Netdata monitor agent uninstall requested."
  exit 0
fi

: "${APPOS_MONITOR_EXPORTING_CONFIG_B64:?APPOS_MONITOR_EXPORTING_CONFIG_B64 is required}"

tmp_script="$(mktemp)"
tmp_config="$(mktemp)"
cleanup() {
  rm -f "$tmp_script" "$tmp_config"
}
trap cleanup EXIT

log "Downloading Netdata kickstart installer."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$KICKSTART_URL" -o "$tmp_script"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$tmp_script" "$KICKSTART_URL"
else
  echo "curl or wget is required to install Netdata" >&2
  exit 1
fi
chmod +x "$tmp_script"

install_args=(--non-interactive --native-only --release-channel stable)
if have_arg "--upgrade" "$@" || have_arg "--reinstall" "$@"; then
  install_args+=(--reinstall)
fi

log "Installing Netdata monitor agent."
run_privileged env DISABLE_TELEMETRY=1 sh "$tmp_script" "${install_args[@]}"

printf '%s' "$APPOS_MONITOR_EXPORTING_CONFIG_B64" | base64 -d > "$tmp_config"

log "Writing AppOS remote-write configuration."
if getent group netdata >/dev/null 2>&1; then
  run_privileged install -D -m 0640 -o root -g netdata "$tmp_config" "$EXPORTING_PATH"
else
  run_privileged install -D -m 0600 "$tmp_config" "$EXPORTING_PATH"
fi

log "Restarting Netdata monitor agent."
run_privileged systemctl enable --now "$SERVICE_NAME"
run_privileged systemctl restart "$SERVICE_NAME"

log "Netdata monitor agent configured for AppOS remote write."
