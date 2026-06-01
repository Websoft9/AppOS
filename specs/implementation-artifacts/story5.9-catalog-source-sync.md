# Story 5.9: Catalog Source Sync & Projection

**Epic**: 5 - App Store | **Priority**: P1 | **Status**: Partially Implemented | **Depends on**: Story 5.7

## Objective

Move catalog source refresh and projection rebuild behind backend-controlled admin APIs so the browser no longer owns CDN sync behavior or raw-source inspection.

This story also becomes the home for the official catalog source-packaging direction: official bundles remain file-backed, but the backend should own how seed files are packaged, materialized into runtime storage, and refreshed.

## Scope

- source sync endpoint
- source status endpoint
- projection rebuild endpoint
- raw source inspection endpoints for admin/debug use
- minimal projection freshness metadata for the catalog read API
- backend-owned runtime catalog directory for official seed files
- bootstrap path for binary deployments that do not rely on nginx or web static directories

## Acceptance Criteria

- [ ] `POST /api/ext/catalog/sources/sync` fetches current source bundles and rebuilds the normalized catalog projection.
- [x] `GET /api/catalog/admin/status` returns local runtime source status, source freshness, and current locale bundle counts.
- [x] `POST /api/catalog/admin/reindex` reloads the local runtime bundles and returns current locale bundle counts.
- [x] `GET /api/catalog/admin/apps/{key}/raw` returns raw source payload for one app for admin/debug inspection.
- [x] `GET /api/catalog/admin/categories/raw` returns raw category source payload for admin/debug inspection.
- [x] All currently implemented source/admin routes require superuser auth.
- [x] Canonical catalog read responses expose a `sourceVersion` or equivalent freshness token.
- [ ] The dashboard sync behavior can be switched to the backend sync route without direct browser CDN fetching.
- [x] Official catalog seed files can bootstrap a binary-only deployment without requiring the web static store directory or nginx runtime layout.
- [x] Runtime catalog storage design reserves a seed-version marker such as `.version`, but actual upgrade reconciliation is deferred until the release artifact pipeline is ready.

## Out of Scope

- background scheduler for automatic sync
- multi-source federation beyond current bundled + CDN source
- full historical sync audit UI
- seed-version upgrade orchestration beyond reserving the extension point

## Tasks / Subtasks

- [ ] Task 1: Add admin route group under `/api/catalog/admin`
  - [ ] 1.1 Add sync endpoint
  - [x] 1.2 Add status endpoint
  - [x] 1.3 Add reindex endpoint
  - [x] 1.4 Add raw inspection endpoints
- [x] Task 2: Implement official source runtime packaging
  - [x] 2.1 Embed official source bundles into the backend binary as seed files
  - [x] 2.2 Materialize seed files into a backend-managed runtime catalog directory on first start or explicit bootstrap
  - [x] 2.3 Keep `.version` as a reserved marker only; do not require full upgrade reconciliation yet
  - [x] 2.4 Make the runtime directory the preferred source for catalog reads
- [ ] Task 3: Implement source fetch and projection rebuild flow
  - [x] 3.1 Read runtime catalog files as the operational source
  - [ ] 3.2 Fetch CDN source on sync request
  - [ ] 3.3 Rebuild normalized category and app projection
  - [ ] 3.4 Persist or cache projection freshness metadata
- [ ] Task 4: Validation
  - [x] 4.1 Superuser auth tests
  - [ ] 4.2 Sync failure and fallback tests
  - [x] 4.3 Binary-only bootstrap tests for runtime seed extraction
  - [ ] 4.4 Dashboard sync action rewired to backend route

## Notes

- This story is intentionally operational. It should not redefine the catalog read model from Story 5.7.
- Keep raw source inspection separate from the canonical read API so product consumers do not couple themselves to source shape again.
- The runtime catalog directory is a backend-managed operational path, not a frontend source folder.
- Until the upgrade artifact library exists, seed extraction may use simple first-write or explicit overwrite rules. The `.version` file is documented now only to reserve the future extension point.

## Current Implementation Snapshot

- `backend/domain/catalog/source.go` embeds official seed files and ensures they exist under the runtime catalog directory before reads.
- `backend/domain/catalog/source_test.go` covers runtime seed bootstrap into a configured runtime path.
- Canonical read responses already expose `sourceVersion` via `backend/domain/catalog/contracts.go` and `backend/domain/catalog/service.go`.
- Local admin status/reindex/raw-inspection endpoints now exist under `/api/catalog/admin/*`.
- Remote sync is still not implemented; this story remains open for the operational control plane slice.