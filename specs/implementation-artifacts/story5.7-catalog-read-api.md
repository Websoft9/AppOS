# Story 5.7: Catalog Read API

**Epic**: 5 - App Store | **Priority**: P1 | **Status**: Proposed

## Objective

Introduce a canonical backend read API for App Catalog so the dashboard no longer parses raw catalog JSON structure or merges official and custom app summaries client-side.

## Scope

- normalized category tree endpoint
- normalized app list endpoint
- normalized app detail endpoint
- deploy handoff endpoint for one app
- shared response schema for official and visible custom apps

## Acceptance Criteria

- [ ] `GET /api/catalog/categories` returns a normalized primary/secondary category tree with counts.
- [ ] `GET /api/catalog/apps` returns a paginated normalized app summary list.
- [ ] `GET /api/catalog/apps` supports `primaryCategory`, `secondaryCategory`, `q`, `source`, `visibility`, `favorite`, `limit`, and `offset` filters.
- [ ] `GET /api/catalog/apps/{key}` returns a normalized app detail payload independent of source JSON nesting.
- [ ] `GET /api/catalog/apps/{key}/deploy-source` returns a lightweight deploy handoff payload for official and custom apps.
- [ ] Official apps and visible custom apps share a stable summary shape in list responses.
- [ ] Current caller personalization state is embedded in list/detail responses without requiring extra frontend joins.
- [ ] Frontend no longer depends on `catalogCollection.items[*].catalogCollection.items[0].key` parsing once this story is consumed.

## Out of Scope

- custom app create/update/delete mutations
- source sync and projection rebuild jobs
- template versioning or template publishing workflows
- frontend route migration beyond the minimum consumer changes needed to adopt the new read API

## Implementation Tasks

- [ ] Task 1: Add catalog route group and read handlers under `/api/catalog`
  - [ ] 1.1 Register category routes
  - [ ] 1.2 Register app list/detail routes
  - [ ] 1.3 Register deploy-source route
- [ ] Task 2: Add source-loading boundary
  - [ ] 2.1 Introduce a catalog source loader for local bundled JSON
  - [ ] 2.2 Add optional CDN-backed source refresh hook behind an internal interface
  - [ ] 2.3 Keep raw source parsing outside route handlers
- [ ] Task 3: Build normalized projection layer
  - [ ] 3.1 Normalize category hierarchy from source bundles
  - [ ] 3.2 Normalize official app summaries and details
  - [ ] 3.3 Merge visible custom apps into the same projection shape
  - [ ] 3.4 Merge caller personalization into summary/detail payloads
  - [ ] 3.5 Normalize template reference and deploy-source summary fields
- [ ] Task 4: Add query contract handling
  - [ ] 4.1 Parse and validate category filters
  - [ ] 4.2 Parse and validate search query
  - [ ] 4.3 Parse and validate source and visibility filters
  - [ ] 4.4 Parse and validate pagination inputs
  - [ ] 4.5 Parse and validate favorite filter
- [ ] Task 5: Add response contract layer
  - [ ] 5.1 Return category tree schema from ADR
  - [ ] 5.2 Return app summary list schema from ADR
  - [ ] 5.3 Return app detail schema from ADR
  - [ ] 5.4 Return deploy-source payload schema from ADR
- [ ] Task 6: Validation
  - [ ] 6.1 Backend auth and route tests for category and app list/detail contracts
  - [ ] 6.2 Contract tests for deploy-source payload
  - [ ] 6.3 Projection tests for category normalization and custom-app merge behavior
  - [ ] 6.4 Dashboard consumer updated to use the new read API behind existing store surface

## Dependencies

- Story 5.5 (custom app persistence and template linkage)
- `specs/adr/app-catalog-api-surface.md`

## Notes

- Keep source bundles as an implementation detail. This story defines the product-facing read contract, not the permanent storage mechanism.
- If a projection cache is needed, it may live in memory or local file cache in this story; persistent materialization can remain a later optimization.

## Suggested File Layout

- `backend/domain/routes/catalog.go` — route registration and thin handlers
- `backend/domain/catalog/` — source loading, normalization, filter application, response mapping
- `backend/domain/catalog/source.go` — source loader boundary for bundled JSON and later sync hooks
- `backend/domain/catalog/projector.go` — normalized category/app projection builder
- `backend/domain/catalog/contracts.go` — response DTOs for category tree, app summary, app detail, deploy source
- `backend/domain/routes/catalog_test.go` — route auth and contract tests

Keep route handlers thin. Parsing source JSON, applying merge rules, and mapping response DTOs should not live directly in `backend/domain/routes`.