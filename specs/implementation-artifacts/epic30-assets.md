# Epic 30: Assets

**Module**: Assets | **Status**: Proposed | **Priority**: P2 | **Depends on**: Epic 3

## Overview

Give cross-domain technical assets a stable home before AppOS builds full automation.

`Assets` owns reusable technical asset definitions that may be consumed by multiple domains such as Terminal, AI Chat, future Automation, and other runtime workflows.

Current examples:

- scripts
- skills
- future prompt bundles or runbook fragments

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
	- `source_kind`

Recommended initial values:

- `kind`: `script`, `skill`, `prompt`, `runbook`
- `storage_kind`: `file`, `folder`
- `source_kind`: `local`, `reference`

Minimal fields:

- `id`
- `name`
- `kind`
- `storage_kind`
- `source_kind`
- `path`
- `entrypoint`

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

### Story 30.2: Assets API

Expose the minimal backend API for asset CRUD and content retrieval.

Output:

- create/read/update/delete contract for assets
- file or folder storage handling
- local vs reference source handling
- validation for `kind`, `storage_kind`, `source_kind`, and `entrypoint`

### Story 30.3: Assets UI

Deliver the first operator-facing Assets surface with basic management flows.

Output:

- Assets list page
- create/edit form
- file or folder presentation
- type-aware display for `script` and `skill`