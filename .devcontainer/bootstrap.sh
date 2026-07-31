#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${ROOT_DIR}/.cache/dev-bootstrap"

mkdir -p "${STATE_DIR}"

hash_file() {
  local input_file="$1"
  sha256sum "${input_file}" | awk '{print $1}'
}

sync_node_workspace() {
  local workspace_dir="$1"
  local lock_file="$2"
  local state_name="$3"
  local state_file="${STATE_DIR}/${state_name}.sha256"
  local current_hash
  local previous_hash=""

  if [ ! -f "${lock_file}" ]; then
    return 0
  fi

  current_hash="$(hash_file "${lock_file}")"
  if [ -f "${state_file}" ]; then
    previous_hash="$(cat "${state_file}")"
  fi

  if [ ! -d "${workspace_dir}/node_modules" ] || [ "${current_hash}" != "${previous_hash}" ]; then
    echo "→ Installing npm dependencies in ${workspace_dir}..."
    (cd "${workspace_dir}" && npm ci)
    printf '%s' "${current_hash}" > "${state_file}"
  else
    echo "✓ npm dependencies up to date in ${workspace_dir}"
  fi
}

sync_playwright_chromium() {
  local lock_file="${ROOT_DIR}/tests/package-lock.json"
  local state_file="${STATE_DIR}/playwright-chromium.sha256"
  local current_hash
  local previous_hash=""
  local browser_root="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"

  if [ ! -f "${lock_file}" ]; then
    return 0
  fi

  current_hash="$(hash_file "${lock_file}")"
  if [ -f "${state_file}" ]; then
    previous_hash="$(cat "${state_file}")"
  fi

  if [ ! -d "${browser_root}" ] || [ -z "$(ls -A "${browser_root}" 2>/dev/null)" ] || [ "${current_hash}" != "${previous_hash}" ]; then
    echo "→ Installing Playwright Chromium..."
    (cd "${ROOT_DIR}/tests" && npx playwright install chromium)
    printf '%s' "${current_hash}" > "${state_file}"
  else
    echo "✓ Playwright Chromium up to date"
  fi
}

echo "Checking development workspace..."

if command -v npm >/dev/null 2>&1; then
  npm_registry="${NPM_CONFIG_REGISTRY:-https://registry.npmjs.org/}"
  npm config set -g registry "${npm_registry}" >/dev/null 2>&1 || true
  if ! command -v opencode >/dev/null 2>&1; then
    echo "→ Installing opencode..."
    npm install -g opencode-ai@1.17.18
  else
    echo "✓ opencode already installed"
  fi
  if ! command -v qodo >/dev/null 2>&1; then
    echo "→ Installing qodo..."
    npm install -g @qodo/command
  else
    echo "✓ qodo already installed"
  fi
fi

echo "→ Go modules..."
(cd "${ROOT_DIR}/backend" && go mod download)
echo "✓ Go modules ready"

sync_node_workspace "${ROOT_DIR}/web" "${ROOT_DIR}/web/package-lock.json" "web-package-lock"
sync_node_workspace "${ROOT_DIR}/tests" "${ROOT_DIR}/tests/package-lock.json" "tests-package-lock"
sync_playwright_chromium

echo "✓ Development workspace ready"
