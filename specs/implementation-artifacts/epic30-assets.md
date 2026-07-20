# Epic 30: Assets

**Module**: Assets | **Status**: Proposed | **Priority**: P2 | **Depends on**: Epic 3

## Overview

Give cross-domain technical assets a stable home before AppOS builds full automation.

`Assets` owns reusable technical asset definitions that may be consumed by multiple domains such as Terminal, AI Chat, future Automation, and other runtime workflows.

Current examples:

- scripts
- skills

Phase 1 is intentionally narrow:

- supported asset types: `script`, `skill`, `prompt`
- future candidates, not phase-1 commitments: `runbook`

## Definition

`Assets` is a shared-definition domain, not an execution domain.

It owns:

- asset identity and metadata
- asset type classification
- asset storage shape
- asset content and references
- cross-domain lookup and reuse contracts

It does not own:

- execution, scheduling, or orchestration
- terminal sessions
- AI chat behavior
- app store deployment templates
- secrets, connectors, or servers

## Boundary

Use `Assets` when the object is a reusable technical definition that is not owned by one product domain.

Do not use `Assets` as a catch-all file store.

## Phase 1 Decisions

- Epic 30 does not deliver execution, scheduling, or automation orchestration.
- Epic 30 does not include a platform-wide file-service refactor as a delivery goal.
- Epic 30 phase 1 supports `script`, `skill`, and `prompt` as committed asset types.
- Asset metadata belongs in the application database.
- Asset content belongs in the filesystem.
- Filesystem content is stored under `/appos/data/assets/{assetName}-{assetId}/...`.
- Assets are platform-shared objects, not owner-first personal files.
- Script assets do not split into `local` vs `reference` types.
- Script assets require metadata plus either inline `content` or a `reference`; both may exist, but consumers use `content` first.
- Script assets must define `language`; phase-1 priority is `shell` and `python`.
- Script file paths are derived by the system as `{script-name}-{asset-id}.{ext}`; operators do not author script paths manually.
- Script assets do not define an entrypoint because phase-1 scripts are always single-file assets.
- Skill assets are folder-first assets.
- Skill assets keep `entrypoint` because consumers need one canonical file inside the folder package.
- Skill assets may originate from a GitHub project reference or from an uploaded local folder.
- Skill edit mode is file-oriented and works on a folder snapshot, not a single textarea payload.
- Epic 30 phase 1 does not support multi-version script management.
- Phase 1 may reuse existing IaC-style file mechanisms or shared helpers, but `Assets` does not become an IaC subdomain.
- Current user-first `Space` is not the storage owner for shared assets.

## Package Naming Decision

The Go package for this domain should be `backend/domain/assets`.

## Initial Model

- User-facing model:
	- Asset
	- Type
	- File or Folder

- Internal model:
	- `Asset`
	- `kind`
	- `storage_kind`
	- optional reference metadata

Recommended initial values:

- `kind`: `script`, `skill`, `prompt`, `runbook`
- `storage_kind`: `file`, `folder`

Phase-1 supported values:

- `kind`: `script`, `skill`, `prompt`

Minimal fields:

- `id`
- `name`
- `kind`
- `storage_kind`
- `path`

Skill-specific field:

- `entrypoint`

Skill-specific content direction:

- `contents` is a folder tree rather than a single text payload
- `reference` may point to a GitHub project

Script-specific metadata additions:

- `language`
- `content` or `reference` must exist
- `path` is system-derived from name, id, and language

Phase-1 ownership:

- platform-shared

Phase-1 storage path convention:

- `/appos/data/assets/{assetName}-{assetId}/...`

## Consumer Rule

Consumer domains may reference assets, but they keep ownership of their own execution logic and UX.

## Story Breakdown

### Story 30.1: Assets Model

Define the canonical `Assets` domain model, storage contract, and first supported types.

Output:

- `backend/domain/assets` package boundary
- canonical `Asset` fields and enums
- initial persistence decision for metadata and file content
- explicit scope for `script` and `skill` as phase-1 supported types
- explicit phase-1 boundary that future file-service evolution is not part of this epic's delivery scope

### Story 30.2: Assets API

Expose the minimal backend API for asset CRUD and content retrieval.

Output:

- create/read/update/delete contract for assets
- file or folder storage handling
- script `content` vs `reference` handling
- skill folder snapshot vs GitHub reference handling
- validation for `kind`, `storage_kind`, skill `entrypoint`, script `language`, and the `content/reference` requirement
- script reference pull endpoint for operator-assisted authoring
- concrete collection, DTO, and endpoint shape

### Story 30.3: Assets UI

Deliver the first operator-facing Assets surface with basic management flows.

Output:

- Assets list page
- create/edit form
- content preview
- file or folder presentation
- type-aware display for `script` and `skill`
- script language field and content/reference authoring
- script create/edit form split into `Metadata`, `Content`, and collapsed `Advanced`
- script `Reference URL + Pull` and `Script Content + Upload` helpers
- skill create/edit flow built around folder contents, GitHub import, folder upload, and file-tree editing

### Story 30.4: AI System Prompt

Add `kind=prompt` asset type with built-in templates and Copilot handoff.

Output:

- `KindPrompt` constant and validation rules
- `is_system`, `is_template`, and `template_key` metadata for prompt assets
- reuse existing API endpoints for prompt CRUD
- seed 1 protected meta prompt plus 5–8 prompt templates
- prompt create/edit flow with template starter selection
- `Send to AI Copilot` handoff instead of embedded AI rewrite