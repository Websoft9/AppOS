# Story 30.1: Assets Model

**Epic**: Epic 30 - Assets
**Status**: Proposed | **Priority**: P2 | **Depends on**: Epic 3

## Objective

Define one durable `Assets` domain model that gives cross-domain technical assets a stable backend home before AppOS builds execution features.

## Scope

- create the canonical `Asset` vocabulary and package boundary under `backend/domain/assets`
- freeze the phase-1 meanings of `kind`, `storage_kind`, and `source_kind`
- define the minimal required fields for an asset record
- decide how metadata and file content are stored in phase 1
- declare the first supported asset types: `script` and `skill`
- define what stays outside the domain in phase 1

## Phase 1 Product Decisions

- Epic 30 phase 1 supports only `script` and `skill` as committed asset types.
- `prompt` and `runbook` remain future extensions, not phase-1 delivery commitments.
- Asset metadata is stored in the application database.
- Asset content is stored in the filesystem.
- Single-file assets and folder assets follow the same filesystem-first storage direction.
- Filesystem content is stored under `/appos/data/assets/{assetName}-{assetId}/...`.
- Assets are platform-shared objects, not owner-first user files.
- `source_kind=reference` may be created in phase 1, but reference content is not resolved or imported in phase 1.
- Phase 1 may reuse existing IaC-style file mechanics or shared file helpers, but `Assets` is not an IaC subdomain.
- Phase 1 does not deliver a generalized platform file service; that remains a future evolution path.
- Current owner-first `Space` is not the storage owner for shared assets.

## Storage Decision

Phase 1 uses a mixed persistence model:

- database for asset metadata and lookup
- filesystem for asset content

Filesystem path convention:

- `/appos/data/assets/{assetName}-{assetId}/...`

The storage decision is durable for both storage shapes:

- `file` assets do not store their primary content inline in the database
- `folder` assets do not use a separate persistence model from `file` assets

The implementation may reuse existing AppOS file-workspace helpers, but the Assets domain keeps its own API and ownership semantics.

## Acceptance Criteria

1. The story defines one canonical `Asset` model with the minimum fields `id`, `name`, `kind`, `storage_kind`, `source_kind`, `path`, and `entrypoint`.
2. The story freezes the initial enum values as `script` and `skill` for `kind`, `file` and `folder` for `storage_kind`, and `local` and `reference` for `source_kind`.
3. The story defines `Assets` as a shared-definition domain only and explicitly excludes execution, scheduling, orchestration, terminal sessions, AI chat behavior, and app store deployment templates.
4. The story names `backend/domain/assets` as the canonical backend package boundary for the domain.
5. The story documents that phase 1 supports only `script` and `skill` as committed asset types.
6. The story documents a mixed persistence model where metadata lives in the application database and content lives in the filesystem.
7. The story states that single-file assets do not store their primary content inline in the database.
8. The story defines the filesystem path convention as `/appos/data/assets/{assetName}-{assetId}/...`.
9. The story states that assets are platform-shared objects rather than owner-first personal files.
10. The story states that `source_kind=reference` may be created in phase 1 but is not resolved or imported.
11. The story states that phase 1 may reuse IaC-style file helpers but does not make `Assets` an IaC subdomain.
12. The story states that a generalized platform file service is a future evolution path, not a delivery requirement for Epic 30.

## Out of Scope

- execution runtime
- scheduling
- version history
- remote sync
- prompt and runbook support beyond future placeholders
- generalized platform file-service delivery