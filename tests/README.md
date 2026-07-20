# Tests

## Overview

This repository uses four test layers:

- backend Go tests
- frontend Vitest tests
- browser automation tests
- runtime/container E2E tests

The `tests/` directory is the root for integration-style and E2E coverage.

- `tests/e2e/*.spec.ts` — Playwright browser flows
- `tests/e2e/*.sh` — runtime/container smoke flows
- `tests/package.json` — browser automation toolchain root

Common entrypoints:

- `make test backend`
- `make test backend TARGET=./domain/iac/...`
- `make test backend TARGET=./domain/routes RUN=TestIACRoutes`
- `make test web`
- `make test-env up`
- `make test-env down`
- `make test e2e runtime`
- `make test e2e smoke ENV=tests/e2e/remote.env.example`
- `make test e2e ENV=tests/e2e/remote.env.example`
- `cd tests && npm ci`
- `cd tests && npx playwright install --with-deps`
- `cd tests && npx playwright test -c playwright.config.ts`
- `cd tests && npx playwright test -c playwright.config.ts --project=chromium`
- `cd tests && cp e2e/remote.env.example .env.local` (optional local remote-smoke bootstrap)

## Layer Responsibilities

### Backend Go tests

Use for:

- workflow/domain logic
- validation
- persistence
- route contracts
- worker behavior
- state transitions
- executor logic

Prefer this as the default home for business logic.

### Frontend Vitest tests

Use for:

- page rendering
- dialog behavior
- form interactions
- loading/error/empty states
- client-side page composition

Prefer this before adding browser automation for the same logic.

### Browser automation tests

Primary framework: **Playwright**

Use for:

- authenticated flows
- route guards
- critical UI journeys
- real browser regressions that lower test levels cannot catch

Browser automation should stay intentionally small and high-value.

Recommended fixture roots:

- `tests/e2e/fixtures/appos.ts` — auth + API helpers
- extend with server/secret/asset/workflow helpers before adding more UI coverage

### Runtime / container E2E tests

Use for:

- real container boot
- setup/health/public endpoint smoke
- full runtime wiring checks

This is the highest-cost layer and should remain narrow.

## Backend Test Infrastructure

The heaviest backend integration tests live in `backend/domain/routes`. Those tests depend on PocketBase test apps and route-level HTTP fixtures.

For narrow backend runs, prefer the same package patterns that `go test` already uses instead of maintaining separate named Make targets.

Examples:

- `make test backend TARGET=./domain/iac/...`
- `make test backend TARGET=./domain/routes RUN=TestIACRoutes`
- `make test backend TARGET='./domain/software/catalog ./domain/software/executor'`

This keeps the Make interface aligned with `go test` and avoids stale subsystem-specific aliases.

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

## Browser Test Direction

Use Playwright for official browser automation.

Keep browser suites focused on a few critical paths such as:

- login
- key superuser pages
- workflow create/run/approve flows

Do not use browser tests as the primary place to validate backend logic.

Favor API seeding and cleanup helpers over creating all test data through the UI.

Playwright-related files live under `tests/`, not the repository root.

Current browser tags:

- `@smoke` — login, key system pages, workflow page reachability, create drawer
- `@acceptance` — workflow create/run/detail/approve/reject flows

## Local External Test Environment

Use `make test-env up` to start the full local dependency set used by higher-value acceptance flows.

Current services:

- SSH target on `127.0.0.1:2222`
- MySQL target on `127.0.0.1:3306`
- PostgreSQL target on `127.0.0.1:5432`
- Mailpit SMTP target on `127.0.0.1:1025` with UI on `127.0.0.1:8025`

Use `make test-env down` to destroy them.

Recommended local flow:

1. `make test-env up`
2. `make test e2e smoke` or `make test e2e`
3. `make test-env down`
