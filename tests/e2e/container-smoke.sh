#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_REF="${APPOS_E2E_IMAGE:-websoft9dev/appos:latest}"
CONTAINER_NAME="appos-e2e-${RANDOM}-$$"
HEALTH_PATH="${APPOS_E2E_HEALTH_PATH:-/api/health}"
WAIT_SECONDS="${APPOS_E2E_WAIT_SECONDS:-180}"
SECRET_KEY="${APPOS_E2E_SECRET_KEY:-MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"
SUPERVISOR_PASSWORD="${APPOS_E2E_SUPERVISOR_PASSWORD:-appos-e2e-supervisor-password}"
ENCRYPTION_KEY="${APPOS_E2E_ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef}"
EXPECT_SETUP_REQUIRED="${APPOS_E2E_EXPECT_SETUP_REQUIRED:-}"
EXPECT_INIT_MODE="${APPOS_E2E_EXPECT_INIT_MODE:-}"
ARTIFACT_DIR="${APPOS_E2E_ARTIFACT_DIR:-}"
KEEP_CONTAINER_ON_FAILURE="${APPOS_E2E_KEEP_CONTAINER_ON_FAILURE:-0}"
proxy_value="${all_proxy:-${ALL_PROXY:-${http_proxy:-${HTTP_PROXY:-}}}}"
no_proxy_value="${no_proxy:-${NO_PROXY:-}}"
host_port=""
container_started=0
test_passed=0

capture_diagnostics() {
  if [[ "${container_started}" != "1" || -z "${ARTIFACT_DIR}" ]]; then
    return
  fi

  mkdir -p "${ARTIFACT_DIR}"
  docker inspect "${CONTAINER_NAME}" >"${ARTIFACT_DIR}/docker-inspect.json" 2>/dev/null || true
  docker logs "${CONTAINER_NAME}" >"${ARTIFACT_DIR}/container.log" 2>&1 || true
  if [[ -n "${host_port}" ]]; then
    curl --noproxy '*' -fsS "http://127.0.0.1:${host_port}${HEALTH_PATH}" >"${ARTIFACT_DIR}/health-response.txt" 2>&1 || true
  fi
}

cleanup() {
  if [[ "${test_passed}" != "1" ]]; then
    capture_diagnostics
  fi

  if [[ "${test_passed}" != "1" && "${KEEP_CONTAINER_ON_FAILURE}" == "1" ]]; then
    echo "e2e: preserving ${CONTAINER_NAME} for failure inspection" >&2
    return
  fi

  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
}

trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "e2e: docker is required" >&2
  exit 1
fi

if [[ "${APPOS_E2E_SKIP_BUILD:-0}" != "1" ]]; then
  echo "e2e: building ${IMAGE_REF}"
  build_args=()
  if [[ -n "${proxy_value}" ]]; then
    host_proxy="$(printf '%s' "${proxy_value}" | sed 's/127\.0\.0\.1/host-gateway/g;s/localhost/host-gateway/g')"
    build_args+=(--add-host=host-gateway:host-gateway)
    build_args+=(--build-arg "ALL_PROXY=${host_proxy}")
    build_args+=(--build-arg "all_proxy=${host_proxy}")
    build_args+=(--build-arg "HTTP_PROXY=${host_proxy}")
    build_args+=(--build-arg "http_proxy=${host_proxy}")
    build_args+=(--build-arg "HTTPS_PROXY=${host_proxy}")
    build_args+=(--build-arg "https_proxy=${host_proxy}")
  fi
  if [[ -n "${no_proxy_value}" ]]; then
    build_args+=(--build-arg "NO_PROXY=${no_proxy_value}")
    build_args+=(--build-arg "no_proxy=${no_proxy_value}")
  fi
  docker build "${build_args[@]}" -f "${ROOT_DIR}/build/Dockerfile" -t "${IMAGE_REF}" "${ROOT_DIR}"
fi

echo "e2e: starting ${CONTAINER_NAME}"
docker run -d \
  --name "${CONTAINER_NAME}" \
  -e APPOS_SECRET_KEY="${SECRET_KEY}" \
  -e SUPERVISOR_PASSWORD="${SUPERVISOR_PASSWORD}" \
  -e APPOS_ENCRYPTION_KEY="${ENCRYPTION_KEY}" \
  -p 127.0.0.1::80 \
  "${IMAGE_REF}" >/dev/null
container_started=1

host_port="$(docker port "${CONTAINER_NAME}" 80/tcp | awk -F: 'NR==1 {print $NF}')"
if [[ -z "${host_port}" ]]; then
  echo "e2e: failed to resolve published HTTP port" >&2
  docker logs "${CONTAINER_NAME}" || true
  exit 1
fi

echo "e2e: waiting for http://127.0.0.1:${host_port}${HEALTH_PATH}"
deadline=$((SECONDS + WAIT_SECONDS))
while true; do
  state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
  if [[ "${state}" == "healthy" ]]; then
    echo "e2e: container health status is healthy"
    break
  fi

  if curl --noproxy '*' -fsS "http://127.0.0.1:${host_port}${HEALTH_PATH}" >/dev/null 2>&1; then
    echo "e2e: health endpoint is reachable"
    break
  fi

  if [[ "${state}" == "exited" || "${state}" == "dead" ]]; then
    echo "e2e: container exited before becoming healthy" >&2
    docker logs "${CONTAINER_NAME}" || true
    exit 1
  fi

  if (( SECONDS >= deadline )); then
    echo "e2e: timed out waiting for container health" >&2
    docker logs "${CONTAINER_NAME}" || true
    exit 1
  fi

  sleep 3
done

if [[ -n "${EXPECT_SETUP_REQUIRED}" || -n "${EXPECT_INIT_MODE}" ]]; then
  setup_status="$(curl --noproxy '*' -fsS "http://127.0.0.1:${host_port}/api/ext/setup/status")"

  if [[ -n "${EXPECT_SETUP_REQUIRED}" ]]; then
    actual_needs_setup="$(printf '%s' "${setup_status}" | sed -n 's/.*"needsSetup":\(true\|false\).*/\1/p')"
    if [[ "${actual_needs_setup}" != "${EXPECT_SETUP_REQUIRED}" ]]; then
      echo "e2e: expected needsSetup=${EXPECT_SETUP_REQUIRED}, got: ${setup_status}" >&2
      exit 1
    fi
  fi

  if [[ -n "${EXPECT_INIT_MODE}" ]]; then
    actual_init_mode="$(printf '%s' "${setup_status}" | sed -n 's/.*"initMode":"\([^"]*\)".*/\1/p')"
    if [[ "${actual_init_mode}" != "${EXPECT_INIT_MODE}" ]]; then
      echo "e2e: expected initMode=${EXPECT_INIT_MODE}, got: ${setup_status}" >&2
      exit 1
    fi
  fi

  echo "e2e: setup status matched expected contract"
fi

test_passed=1
echo "e2e: container smoke test passed"