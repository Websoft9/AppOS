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
- validate `kind`, `storage_kind`, and skill `entrypoint`
- keep API behavior generic enough for both `script` and `skill`

## Phase 1 API Contract

Collection:

- `assets`

Core DTO fields:

- `id`
- `name`
- `kind`
- `storage_kind`
- `path`

Skill-specific DTO field:

- `entrypoint`

Skill-specific DTO additions:

- `description`
- folder `files`
- optional GitHub `reference`

Script-specific DTO additions:

- `language`
- `content`
- `reference`

Phase-1 endpoints:

- `GET /api/assets`
- `POST /api/assets`
- `POST /api/assets/script/pull`
- `GET /api/assets/{id}`
- `PUT /api/assets/{id}`
- `DELETE /api/assets/{id}`
- `GET /api/assets/{id}/content`

Phase-1 skill rules:

- `storage_kind` is `folder`
- `entrypoint` is required
- `content` is represented as folder `files`
- `reference` may point to a GitHub project
- GitHub reference is source metadata; runtime consumers use the stored folder snapshot
- phase 1 may add a dedicated skill import endpoint for GitHub project ingestion and folder upload normalization

Phase-1 script rules:

- `content` and `reference` cannot both be empty
- consumers use `content` first when both exist
- `path` is system-derived from name, id, and language extension
- scripts do not define an `entrypoint`
- `POST /api/assets/script/pull` fetches remote text into the authoring flow without persisting it
- phase 1 does not deliver scheduled sync behavior

## Acceptance Criteria

1. The story defines one canonical API contract for listing, creating, reading, updating, and deleting assets.
2. The API supports both `file` and `folder` storage shapes without introducing execution behavior.
3. The API validates phase-1 enum values for `kind` and `storage_kind`, and rejects unsupported combinations.
4. The story defines `assets` as the canonical collection name and freezes the shared phase-1 DTO fields `id`, `name`, `kind`, `storage_kind`, and `path`, with `entrypoint` reserved for non-script assets.
5. The story defines the phase-1 endpoint surface as `GET/POST /api/assets`, `POST /api/assets/script/pull`, `GET/PUT/DELETE /api/assets/{id}`, and `GET /api/assets/{id}/content`.
6. The API requires script assets to provide `content` or `reference`, and uses `content` first when both are present.
7. The API returns enough metadata for the UI to render type, shape, derived script path, and skill entrypoint without domain-specific branching.
8. The API exposes script `language` metadata with phase-1 priority on `shell` and `python`.
9. The API supports skill folder snapshots and GitHub-source metadata without collapsing them into a single textarea-style payload.
10. Backend tests cover successful CRUD behavior, validation failures, and at least one `file` asset plus one `folder` asset path.

## Out of Scope

- execution endpoints
- schedule endpoints
- diff or version endpoints
- external repository sync
- multi-version script APIs