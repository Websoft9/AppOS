# E2E Tests

This directory is reserved for tests that require a real AppOS container runtime.

## Scope

- Container startup validation
- Image/install smoke tests
- Full end-to-end flows that need Nginx + frontend + backend + worker running together
- System tests that require a real containerized runtime

## Current Entry Point

- `make e2e`
- `tests/e2e/container-smoke.sh`

The smoke test builds the local AppOS image, starts a real container, and waits for `/api/health` to become reachable.

## Audit Of Existing Tests

The following existing tests were reviewed and intentionally left in the regular unit/integration suites because they mock container or Docker behavior instead of requiring a real runtime:

- `backend/domain/worker/lifecycle_operations_test.go`
- `backend/domain/lifecycle/runtime/node_executor_test.go`
- `backend/domain/routes/server_test.go`
- `backend/cmd/appos-agent/main_test.go`
- `web/src/routes/_app/_auth/resources/-servers.test.tsx`

These tests exercise Docker-aware logic, but they do not need the AppOS container itself and therefore do not belong in E2E.