# Story 13.8: Unified Settings API and Schema-Driven Settings Page

**Epic**: Epic 13 - Settings Management
**Priority**: P1
**Status**: review
**Depends on**: Story 13.3, Story 13.5, Story 13.6, Story 13.7, Story 16.5, Story 19.4

## User Story

As a platform operator,
I want all Settings surfaces exposed through one schema-driven API,
so that backend-defined metadata can drive the Settings UI without adding new frontend forms or per-module routes.

## Scope

- Replace split settings APIs with a unified `/api/settings` surface.
- Introduce schema/catalog metadata that describes sections, entries, data source, fields, and actions.
- Support both PocketBase built-in settings and AppOS `app_settings` through one entry abstraction.
- Remove legacy compatibility routes for MVP; no compatibility aliases are kept.
- Refactor the Settings page to load schema + entry data instead of hardcoded module/group routing.

## Acceptance Criteria

- AC1: Backend exposes the following routes only under `/api/settings`:
  - `GET /api/settings/schema`
  - `GET /api/settings/entries`
  - `GET /api/settings/entries/{entryId}`
  - `PATCH /api/settings/entries/{entryId}`
  - `POST /api/settings/actions/{actionId}`
- AC2: Schema entries explicitly include UI section metadata (`system`, `workspace`) and source metadata (`pocketbase`, `app_settings`).
- AC3: Existing settings surfaces covered by Epic 13, Story 16.5, and Story 19.4 are represented as schema entries without adding module-specific routes.
- AC4: PocketBase settings continue to use native PocketBase settings read/write logic through the unified backend adapter layer; no duplicate PB settings business implementation is introduced.
- AC5: App settings entries continue to preserve current defaults, masking semantics, and validation rules for sensitive and structured fields.
- AC6: Frontend Settings page navigation and load/save behavior are driven from schema/entry metadata rather than hardcoded `System`/`Workspace` route tables.
- AC7: Legacy routes `/api/settings/workspace`, `/api/settings/workspace/{module}`, `/api/settings/secrets`, and `/api/settings/tunnel` are removed.
- AC8: Tests cover unified route behavior, schema discovery, representative PB/app_settings entry reads and writes, and frontend schema-driven rendering/load-save flow.

## Tasks / Subtasks

- [x] Task 1: Define unified settings schema registry (AC1, AC2, AC3)
  - [x] 1.1 Add backend schema/entry types for sections, sources, fields, and actions
  - [x] 1.2 Register PB settings entries and app_settings entries in one catalog
  - [x] 1.3 Add entry/action identifiers for current settings surfaces

- [x] Task 2: Replace split backend routes with unified `/api/settings` API (AC1, AC4, AC5, AC7)
  - [x] 2.1 Implement schema and entry handlers under `/api/settings`
  - [x] 2.2 Adapt PB settings through a thin adapter layer instead of duplicate business logic
  - [x] 2.3 Adapt app_settings entries, including current fallback/mask/validation semantics
  - [x] 2.4 Remove legacy workspace/secrets/tunnel route registrations and tests

- [x] Task 3: Refactor dashboard Settings page to schema-driven rendering (AC2, AC3, AC6)
  - [x] 3.1 Replace hardcoded navigation groups with schema sections
  - [x] 3.2 Replace per-module endpoint routing with entry/action helpers
  - [x] 3.3 Keep representative current settings forms functional through schema-backed adapters

- [x] Task 4: Tests and regression validation (AC8)
  - [x] 4.1 Add/update backend route tests for unified schema and entries
  - [x] 4.2 Add/update frontend settings tests for schema-driven navigation and save behavior
  - [x] 4.3 Run backend and dashboard test suites relevant to settings

## Dev Notes

- `section` is a UI/navigation concern and must not be inferred from storage source.
- `source` is an adapter concern and must remain explicit in schema metadata.
- PB settings stay on native PocketBase settings internals; unified API is an AppOS facade.
- MVP rule: no compatibility paths, no deprecated aliases.

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

- `cd /data/dev/appos/backend && go test ./internal/routes -run 'TestSettings'`
- `cd /data/dev/appos/backend && go test ./internal/migrations -run 'TestSecretsPolicySeedExists' -count=1`
- `cd /data/dev/appos/backend && go test ./internal/lifecycle/service -count=1`
- `cd /data/dev/appos/backend && go build ./cmd/appos`
- `cd /data/dev/appos/backend && go test ./...`
- `cd /data/dev/appos && make openapi-gen && make openapi-merge`
- `cd /data/dev/appos && make openapi-check`
- `cd /data/dev/appos/dashboard && npm run typecheck`
- `cd /data/dev/appos/dashboard && npm test -- --run src/routes/_app/_auth/_superuser/-settings.test.tsx src/lib/connect-api.test.ts src/routes/_app/_auth/-secrets.test.tsx`
- `cd /data/dev/appos/dashboard && npm test`

### Completion Notes

- Added a unified backend settings registry and API surface under `/api/settings/{schema,entries,actions}` with explicit `section` and `source` metadata.
- Kept PocketBase settings on native PB settings models via a thin clone/save adapter instead of duplicating PB settings business logic.
- Migrated app settings entries to unified entry IDs while preserving existing fallback, mask, and validation behavior for secrets, tunnel, deploy, connect, proxy, docker, llm, and space settings.
- Centralized settings schema metadata and canonical app_settings defaults in `internal/settings/catalog`, so routes, consumers, and migration seeding now use the same source of truth.
- Moved the PocketBase clone/save adapter into `internal/settings` and brought IaC file limits into the unified settings catalog so `/api/ext/iac` no longer reads an orphaned settings group outside the schema-driven API.
- Refactored the superuser Settings page to load schema and entries, drive left-nav grouping from schema metadata, and save through unified entry/action helpers.
- Migrated other settings consumers (`SecretsPage`, connect terminal settings loader) to the unified entry API so legacy custom settings paths can be removed in MVP.
- Removed obsolete legacy module-based settings handlers and regenerated OpenAPI docs/group mapping so the published custom API surface only documents the unified settings routes.
- Collapsed scattered app_settings seed/rename migrations into one MVP create-and-seed migration for the current settings model.
- Verified with backend full suite, dashboard full suite, targeted dashboard settings tests, and dashboard typecheck.

### File List

- `backend/internal/routes/settings.go`
- `backend/internal/routes/settings_unified.go`
- `backend/internal/routes/settings_test.go`
- `backend/internal/settings/catalog/catalog.go`
- `backend/internal/migrations/1741200000_create_app_settings.go`
- `backend/docs/openapi/group-matrix.yaml`
- `backend/docs/openapi/ext-api.yaml`
- `backend/docs/openapi/api.yaml`
- `dashboard/src/lib/settings-api.ts`
- `dashboard/src/lib/connect-api.ts`
- `dashboard/src/lib/connect-api.test.ts`
- `dashboard/src/routes/_app/_auth/_superuser/settings.tsx`
- `dashboard/src/routes/_app/_auth/_superuser/-settings.test.tsx`
- `dashboard/src/routes/_app/_auth/secrets.tsx`
- `dashboard/src/routes/_app/_auth/-secrets.test.tsx`
- `specs/implementation-artifacts/story13.8-unified-settings-api.md`
- `specs/implementation-artifacts/epic13-settings.md`
- `specs/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-03-27: Implemented unified settings schema/entries/actions API and migrated dashboard settings consumers to schema-driven entry paths.
- 2026-03-27: Removed leftover legacy settings handlers and regenerated OpenAPI settings docs/group mapping for the unified API surface.
- 2026-03-27: Centralized settings catalog/default definitions and replaced scattered app_settings seed migrations with a single current-state migration.
