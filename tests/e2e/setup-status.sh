#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

APPOS_E2E_EXPECT_SETUP_REQUIRED="${APPOS_E2E_EXPECT_SETUP_REQUIRED:-true}"
APPOS_E2E_EXPECT_INIT_MODE="${APPOS_E2E_EXPECT_INIT_MODE:-auto}"

export APPOS_E2E_EXPECT_SETUP_REQUIRED
export APPOS_E2E_EXPECT_INIT_MODE

exec bash "${ROOT_DIR}/tests/e2e/container-smoke.sh"