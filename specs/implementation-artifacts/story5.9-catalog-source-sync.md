# Story 5.9: Catalog Source Sync & Projection

**Epic**: 5 - App Store | **Priority**: P1 | **Status**: Proposed | **Depends on**: Story 5.7

## Objective

Move catalog source refresh and projection rebuild behind backend-controlled admin APIs so the browser no longer owns CDN sync behavior or raw-source inspection.

## Scope

- source sync endpoint
- source status endpoint
- projection rebuild endpoint
- raw source inspection endpoints for admin/debug use
- minimal projection freshness metadata for the catalog read API

## Acceptance Criteria

- [ ] `POST /api/ext/catalog/sources/sync` fetches current source bundles and rebuilds the normalized catalog projection.
- [ ] `GET /api/ext/catalog/sources/status` returns last sync status, source freshness, and last successful projection version.
- [ ] `POST /api/ext/catalog/sources/reindex` rebuilds the normalized projection from already available source data.
- [ ] `GET /api/ext/catalog/admin/apps/{key}/raw` returns raw source payload for one app for admin/debug inspection.
- [ ] `GET /api/ext/catalog/admin/categories/raw` returns raw category source payload for admin/debug inspection.
- [ ] All source and admin routes require superuser auth.
- [ ] Canonical catalog read responses expose a `sourceVersion` or equivalent freshness token.
- [ ] The dashboard "Sync Latest" behavior can be switched to the backend sync route without direct browser CDN fetching.

## Out of Scope

- background scheduler for automatic sync
- multi-source federation beyond current bundled + CDN source
- full historical sync audit UI

## Tasks / Subtasks

- [ ] Task 1: Add admin route group under `/api/ext/catalog`
  - [ ] 1.1 Add sync endpoint
  - [ ] 1.2 Add status endpoint
  - [ ] 1.3 Add reindex endpoint
  - [ ] 1.4 Add raw inspection endpoints
- [ ] Task 2: Implement source fetch and projection rebuild flow
  - [ ] 2.1 Read local bundled source as fallback
  - [ ] 2.2 Fetch CDN source on sync request
  - [ ] 2.3 Rebuild normalized category and app projection
  - [ ] 2.4 Persist or cache projection version metadata
- [ ] Task 3: Validation
  - [ ] 3.1 Superuser auth tests
  - [ ] 3.2 Sync failure and fallback tests
  - [ ] 3.3 Dashboard sync action rewired to backend route

## Notes

- This story is intentionally operational. It should not redefine the catalog read model from Story 5.7.
- Keep raw source inspection separate from the canonical read API so product consumers do not couple themselves to source shape again.