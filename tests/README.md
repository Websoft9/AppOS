# Tests

## Overview

This repository uses a mix of backend Go tests, frontend Vitest tests, and end-to-end coverage under `tests/e2e`.

Common entrypoints:

- `make test backend`
- `make test web`
- `make test e2e fast`

## Backend Test Infrastructure

The heaviest backend integration tests live in `backend/domain/routes`. Those tests depend on PocketBase test apps and route-level HTTP fixtures.

### PocketBase baseline fixture for `backend/domain/routes`

The `backend/domain/routes` test package uses a package-level baseline data directory in `backend/domain/routes/resources_test.go`.

How it works:

1. On first use, the test package creates one PocketBase test app and lets it finish bootstrapping and migrations.
2. The package keeps the migrated `DataDir` as a baseline template.
3. Each individual test still creates its own isolated `tests.TestApp`, but it is cloned from the migrated baseline instead of starting from scratch.

This keeps test isolation intact while avoiding repeated migration cost for every `newTestEnv(t)` call.

### Why this exists

Before this fixture change, `backend/domain/routes` created a fresh PocketBase app for every test case, and each app reran the full migration set. That package has a large number of `newTestEnv(t)` calls, so repeated migrations became the dominant cost and eventually caused `go test ./domain/routes` and `make test backend` to time out.

The baseline-clone approach reduces initialization cost enough to keep the package testable while preserving per-test isolation.

### Guardrails

- Do not replace the baseline-clone fixture with a single shared live app instance across the whole package.
- Shared live app state makes route tests order-dependent and breaks isolation.
- If you add more `newTestEnv(t)`-style helpers in heavy backend packages, prefer the same pattern: migrate once per package, clone per test.

## When adding tests

- Keep fixtures local to the package that owns the behavior.
- Prefer isolated app/data-dir state for backend route tests.
- Reuse existing helpers before introducing a second fixture style for the same package.
- If a package repeatedly bootstraps PocketBase in many tests, measure whether a migrated baseline directory should be introduced there too.