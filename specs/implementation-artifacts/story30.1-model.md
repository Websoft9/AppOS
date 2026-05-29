# Story 30.1: Assets Model

**Epic**: Epic 30 - Assets
**Status**: Proposed | **Priority**: P2 | **Depends on**: Epic 3

## Objective

Define one durable `Assets` domain model that gives cross-domain technical assets a stable backend home before AppOS builds execution features.

## Scope

- create the canonical `Asset` vocabulary and package boundary under `backend/domain/assets`
- freeze the phase-1 meanings of `kind` and `storage_kind`
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
- Script assets do not split into `local` vs `reference` types.
- Script assets are modeled as metadata plus inline `content` and optional `reference`.
- Script assets must have at least one of `content` or `reference`.
- When both exist, consumers use `content` first.
- Script metadata includes `language`; phase-1 priority is `shell` and `python`.
- Script storage path is derived by the system as `{script-name}-{asset-id}.{ext}` using language-specific extensions.
- Script assets do not define an entrypoint in phase 1.
- Skill assets remain folder assets with one canonical `entrypoint` file.
- Skill assets are modeled as metadata plus a folder snapshot and optional GitHub reference metadata.
- Skill consumers resolve the stored folder snapshot first; GitHub reference remains source metadata, not a live runtime dependency.
- Skill authoring supports folder upload and GitHub import as the two phase-1 source flows.
- Phase 1 does not support multi-version script management.
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

1. The story defines one canonical `Asset` model with the minimum shared fields `id`, `name`, `kind`, `storage_kind`, and `path`, with `entrypoint` reserved for folder-oriented assets such as `skill`.
2. The story freezes the initial enum values as `script` and `skill` for `kind`, and `file` and `folder` for `storage_kind`.
3. The story defines `Assets` as a shared-definition domain only and explicitly excludes execution, scheduling, orchestration, terminal sessions, AI chat behavior, and app store deployment templates.
4. The story names `backend/domain/assets` as the canonical backend package boundary for the domain.
5. The story documents that phase 1 supports only `script` and `skill` as committed asset types.
6. The story documents a mixed persistence model where metadata lives in the application database and content lives in the filesystem.
7. The story states that single-file assets do not store their primary content inline in the database.
8. The story defines the filesystem path convention as `/appos/data/assets/{assetName}-{assetId}/...`.
9. The story states that assets are platform-shared objects rather than owner-first personal files.
10. The story states that script assets do not split into `local` and `reference` types, and instead require `content` or `reference`.
11. The story states that script consumers use `content` first when both `content` and `reference` exist.
12. The story states that script metadata includes `language`, with phase-1 priority on `shell` and `python`.
13. The story states that script paths are system-derived and not operator-authored.
14. The story states that script assets do not define an entrypoint in phase 1.
15. The story states that skill assets are folder-first assets and keep an explicit `entrypoint`.
16. The story states that skill assets support GitHub reference metadata and uploaded folder snapshots as phase-1 source flows.
17. The story states that skill editing operates on a folder snapshot rather than a single text body.
18. The story states that multi-version script management is out of scope for phase 1.
19. The story states that phase 1 may reuse IaC-style file helpers but does not make `Assets` an IaC subdomain.
20. The story states that a generalized platform file service is a future evolution path, not a delivery requirement for Epic 30.

## Out of Scope

- execution runtime
- scheduling
- version history
- remote sync
- multi-version script management
- prompt and runbook support beyond future placeholders
- generalized platform file-service delivery