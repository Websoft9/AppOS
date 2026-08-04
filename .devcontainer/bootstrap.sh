#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="/appos/data/bootstrap"

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

echo "Checking development workspace..."

sudo chown -R appos:appos /appos/data 2>/dev/null || true
npm config set -g registry "${NPM_CONFIG_REGISTRY:-https://registry.npmjs.org/}" >/dev/null 2>&1 || true

echo "→ Go modules..."
(cd "${ROOT_DIR}/backend" && go mod download)
echo "✓ Go modules ready"

sync_node_workspace "${ROOT_DIR}/web" "${ROOT_DIR}/web/package-lock.json" "web-package-lock"
sync_node_workspace "${ROOT_DIR}/tests" "${ROOT_DIR}/tests/package-lock.json" "tests-package-lock"

echo "✓ Development workspace ready"
