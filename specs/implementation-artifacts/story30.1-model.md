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

## Acceptance Criteria

1. The story defines one canonical `Asset` model with the minimum fields `id`, `name`, `kind`, `storage_kind`, `source_kind`, `path`, and `entrypoint`.
2. The story freezes the initial enum values as `script` and `skill` for `kind`, `file` and `folder` for `storage_kind`, and `local` and `reference` for `source_kind`.
3. The story defines `Assets` as a shared-definition domain only and explicitly excludes execution, scheduling, orchestration, terminal sessions, AI chat behavior, and app store deployment templates.
4. The story names `backend/domain/assets` as the canonical backend package boundary for the domain.
5. The story documents the phase-1 storage decision clearly enough that later API and UI stories can implement against it without reopening the model.

## Out of Scope

- execution runtime
- scheduling
- version history
- remote sync
- prompt and runbook support beyond future placeholders