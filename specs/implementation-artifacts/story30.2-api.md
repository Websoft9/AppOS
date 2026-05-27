# Story 30.2: Assets API

**Epic**: Epic 30 - Assets
**Status**: Proposed | **Priority**: P2 | **Depends on**: Story 30.1

## Objective

Expose one minimal backend API for creating, reading, updating, and deleting assets, plus retrieving their content.

## Scope

- define the phase-1 Assets API surface
- define the phase-1 Assets collection and DTO shape
- support CRUD for asset metadata
- support content retrieval for local file and folder assets
- validate `kind`, `storage_kind`, `source_kind`, and `entrypoint`
- keep API behavior generic enough for both `script` and `skill`

## Phase 1 API Contract

Collection:

- `assets`

Core DTO fields:

- `id`
- `name`
- `kind`
- `storage_kind`
- `source_kind`
- `path`
- `entrypoint`

Phase-1 endpoints:

- `GET /api/assets`
- `POST /api/assets`
- `GET /api/assets/{id}`
- `PUT /api/assets/{id}`
- `DELETE /api/assets/{id}`
- `GET /api/assets/{id}/content`

Phase-1 source rules:

- `local`: create and read supported
- `reference`: create and read metadata supported; reference resolution not supported

## Acceptance Criteria

1. The story defines one canonical API contract for listing, creating, reading, updating, and deleting assets.
2. The API supports both `file` and `folder` storage shapes without introducing execution behavior.
3. The API validates phase-1 enum values for `kind`, `storage_kind`, and `source_kind`, and rejects unsupported combinations.
4. The story defines `assets` as the canonical collection name and freezes the phase-1 DTO fields `id`, `name`, `kind`, `storage_kind`, `source_kind`, `path`, and `entrypoint`.
5. The story defines the phase-1 endpoint surface as `GET/POST /api/assets`, `GET/PUT/DELETE /api/assets/{id}`, and `GET /api/assets/{id}/content`.
6. The API supports local assets in phase 1 and allows `reference` assets to be created and read as metadata-only records without resolving content.
7. The API returns enough metadata for the UI to render type, shape, path, and entrypoint without domain-specific branching.
8. Backend tests cover successful CRUD behavior, validation failures, and at least one `file` asset plus one `folder` asset path.

## Out of Scope

- execution endpoints
- schedule endpoints
- diff or version endpoints
- external repository sync