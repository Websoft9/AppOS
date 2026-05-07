# E2E Tests

This directory is reserved for tests that require a real AppOS container runtime.

## Scope

- Container startup validation
- Image/install smoke tests
- Full end-to-end flows that need Nginx + frontend + backend + worker running together
- System tests that require a real containerized runtime

## Current Entry Point

- `make test` (strict mode includes `make test e2e fast` after backend + web tests)
- `make test e2e` (full E2E entrypoint; currently runs the smoke suite until broader scenarios are added)
- `make test e2e fast` (smoke E2E suite)
- `tests/e2e/container-smoke.sh`
- `tests/e2e/setup-status.sh`

The smoke suite builds the local AppOS image, starts a real container, and waits for `/api/health` to become reachable.

The setup-status scenario reuses the same real container startup path and verifies that `/api/ext/setup/status` is publicly reachable and returns the expected fresh-install contract (`needsSetup: true`, `initMode: auto`).

## Audit Of Existing Tests

The following existing tests were reviewed and intentionally left in the regular unit/integration suites because they mock container or Docker behavior instead of requiring a real runtime:

- `backend/domain/worker/lifecycle_operations_test.go`
- `backend/domain/lifecycle/runtime/node_executor_test.go`
- `backend/domain/routes/server_test.go`
- `backend/cmd/appos-agent/main_test.go`
- `web/src/routes/_app/_auth/resources/-servers.test.tsx`

These tests exercise Docker-aware logic, but they do not need the AppOS container itself and therefore do not belong in E2E.

## Planned Layering

- `make test e2e fast`: smoke coverage for container boot and critical public/health flows.
- `make test e2e`: the full E2E entrypoint. It currently delegates to smoke and is intended to grow as broader runtime scenarios are added.