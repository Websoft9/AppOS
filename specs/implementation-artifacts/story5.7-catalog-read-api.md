# Story 5.7: Catalog Read API

**Epic**: 5 - App Store | **Priority**: P1 | **Status**: Implemented

## Objective

Introduce a canonical backend read API for App Catalog so the dashboard no longer parses raw catalog JSON structure or merges official and custom app summaries client-side.

## Scope

- normalized category tree endpoint
- normalized app list endpoint
- normalized app detail endpoint
- deploy handoff endpoint for one app
- shared response schema for official and visible custom apps

## Acceptance Criteria

- [x] `GET /api/catalog/categories` returns a normalized primary/secondary category tree with counts.
- [x] `GET /api/catalog/apps` returns a paginated normalized app summary list.
- [x] `GET /api/catalog/apps` supports `primaryCategory`, `secondaryCategory`, `q`, `source`, `visibility`, `favorite`, `limit`, and `offset` filters.
- [x] `GET /api/catalog/apps/{key}` returns a normalized app detail payload independent of source JSON nesting.
- [x] `GET /api/catalog/apps/{key}/deploy-source` returns a lightweight deploy handoff payload for official and custom apps.
- [x] Official apps and visible custom apps share a stable summary shape in list responses.
- [x] Current caller personalization state is embedded in list/detail responses without requiring extra frontend joins.
- [x] Frontend no longer depends on `catalogCollection.items[*].catalogCollection.items[0].key` parsing once this story is consumed.

## Out of Scope

- custom app create/update/delete mutations
- source sync and projection rebuild jobs
- template versioning or template publishing workflows
- frontend route migration beyond the minimum consumer changes needed to adopt the new read API

## Implementation Tasks

- [x] Task 1: Add catalog route group and read handlers under `/api/catalog`
  - [x] 1.1 Register category routes
  - [x] 1.2 Register app list/detail routes
  - [x] 1.3 Register deploy-source route
- [x] Task 2: Add source-loading boundary
  - [x] 2.1 Introduce a catalog source loader for backend-owned official seed files
  - [ ] 2.2 Add optional CDN-backed source refresh hook behind an internal interface
  - [x] 2.3 Keep raw source parsing outside route handlers
- [x] Task 3: Build normalized projection layer
  - [x] 3.1 Normalize category hierarchy from source bundles
  - [x] 3.2 Normalize official app summaries and details
  - [x] 3.3 Merge visible custom apps into the same projection shape
  - [x] 3.4 Merge caller personalization into summary/detail payloads
  - [x] 3.5 Normalize template reference and deploy-source summary fields
- [x] Task 4: Add query contract handling
  - [x] 4.1 Parse and validate category filters
  - [x] 4.2 Parse and validate search query
  - [x] 4.3 Parse and validate source and visibility filters
  - [x] 4.4 Parse and validate pagination inputs
  - [x] 4.5 Parse and validate favorite filter
- [x] Task 5: Add response contract layer
  - [x] 5.1 Return category tree schema from ADR
  - [x] 5.2 Return app summary list schema from ADR
  - [x] 5.3 Return app detail schema from ADR
  - [x] 5.4 Return deploy-source payload schema from ADR
- [x] Task 6: Validation
  - [x] 6.1 Backend auth and route tests for category and app list/detail contracts
  - [x] 6.2 Contract tests for deploy-source payload
  - [x] 6.3 Projection tests for category normalization and custom-app merge behavior
  - [x] 6.4 Dashboard consumer updated to use the new read API behind existing store surface

## Dependencies

- Story 5.5 (custom app persistence and template linkage)
- `specs/adr/app-catalog-api-surface.md`

## Notes

- Keep source bundles as an implementation detail. This story defines the product-facing read contract, not the permanent storage mechanism.
- Initial implementation now uses backend-owned seed packaging plus runtime extraction into a backend-managed catalog directory.
- If a projection cache is needed, it may live in memory or local file cache in this story; persistent materialization can remain a later optimization.

## Current Implementation Snapshot

- Canonical read handlers live in `backend/domain/routes/catalog.go`.
- Normalization, filtering, personalization merge, and deploy-source shaping live in `backend/domain/catalog/service.go`.
- Shared response DTOs live in `backend/domain/catalog/contracts.go`.
- Official catalog source loading and runtime seed bootstrap live in `backend/domain/catalog/source.go`.
- The optional admin/source-refresh hook remains a later operational slice, not part of the current shipped read surface.

## Suggested File Layout

- `backend/domain/routes/catalog.go` — route registration and thin handlers
- `backend/domain/catalog/` — source loading, normalization, filter application, response mapping
- `backend/domain/catalog/source.go` — source loader boundary for bundled JSON and later sync hooks
- `backend/domain/catalog/projector.go` — normalized category/app projection builder
- `backend/domain/catalog/contracts.go` — response DTOs for category tree, app summary, app detail, deploy source
- `backend/domain/routes/catalog_test.go` — route auth and contract tests

Keep route handlers thin. Parsing source JSON, applying merge rules, and mapping response DTOs should not live directly in `backend/domain/routes`.