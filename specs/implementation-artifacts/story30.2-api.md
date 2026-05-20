# Story 30.2: Assets API

**Epic**: Epic 30 - Assets
**Status**: Proposed | **Priority**: P2 | **Depends on**: Story 30.1

## Objective

Expose one minimal backend API for creating, reading, updating, and deleting assets, plus retrieving their content.

## Scope

- define the phase-1 Assets API surface
- support CRUD for asset metadata
- support content retrieval for local file and folder assets
- validate `kind`, `storage_kind`, `source_kind`, and `entrypoint`
- keep API behavior generic enough for both `script` and `skill`

## Acceptance Criteria

1. The story defines one canonical API contract for listing, creating, reading, updating, and deleting assets.
2. The API supports both `file` and `folder` storage shapes without introducing execution behavior.
3. The API validates phase-1 enum values for `kind`, `storage_kind`, and `source_kind`, and rejects unsupported combinations.
4. The API supports local assets in phase 1 and defines how `reference` assets are represented even if reference resolution is limited initially.
5. The API returns enough metadata for the UI to render type, shape, path, and entrypoint without domain-specific branching.
6. Backend tests cover successful CRUD behavior, validation failures, and at least one `file` asset plus one `folder` asset path.

## Out of Scope

- execution endpoints
- schedule endpoints
- diff or version endpoints
- external repository sync