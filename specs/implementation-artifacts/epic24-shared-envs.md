# Epic 24: Shared Envs

## Overview

**Shared reusable environment variables for apps and workflows** — named sets of key-value pairs (optionally referencing secrets) that can be attached to applications and workflow definitions. Shared Envs are the optional shared layer of env management, not the only source of env values.

**Status**: In Progress | **Priority**: P1 | **Depends on**: Epic 1, Epic 3, Epic 19 (Secrets)

## Definition

`Shared Envs` is the product/module name used in UI, menus, and pages.

It owns only the shared reusable env layer:
- reusable non-sensitive values
- reusable secret references
- attachment of env sets to consumer objects (apps, workflows; scripts and server tasks are natural future consumers)

It does not own:
- platform default variables
- app-owned env vars
- app-owned credentials
- compose `.env` files as long-term source of truth

## Minimal Runtime Model

AppOS uses four distinct variable layers:

| Layer | Purpose | Editable here? |
|-------|---------|----------------|
| Platform var layer | Platform-wide default runtime variables; visible to users, mostly derived from Settings or system-computed values | No for Settings-derived/computed values |
| Shared Envs | Optional shared reusable sets attached to apps and workflow definitions | Yes |
| App env vars | App-owned editable non-sensitive variables; default place for compose form-edited env | No (managed on the App side) |
| App credentials | App-owned sensitive values such as install passwords, internal DB passwords, app secrets | No (managed on the App side) |

Notes:
- The platform var layer is a logical layer, not a Shared Envs group.
- Settings-derived vars should be changed in Settings, not in Shared Envs.
- A compose `.env` file is a deployment output, not the long-term source of truth.
- App credentials are app-scoped secrets, distinct from platform-shared `secrets` records.

## Resolution Rules

Env values are resolved per target into one `effective env` map before injection. For app deployment and compose rendering, the minimal precedence is:

1. Platform var layer
2. Attached env sets (in attachment order; when the same key appears in multiple sets, the later-attached set wins)
3. App env vars
4. Deployment-time overrides

Additional rules:
- Resolution does not mutate upstream layers; only the resolved result is injected.
- Compose `.env` is generated from the resolved result when needed; it should not be treated as the canonical storage model.
- Resolution and injection policy (what gets injected into which target) is owned by the deploy resolver (Epic 17). Shared Envs only provides the reusable source layer.

## Consumption Model

Consumer objects (apps, workflows) attach env sets by reference — they store an ordered list of env set IDs, not copies of the variable content. The current content of each attached set is fetched and merged at resolve time.

- Attach order is significant and must be visible in the UI (explicit order field or drag-to-reorder).
- Workflow attachment is deferred to the workflow epic.

## Migration and Compatibility Policy

Epic 24 follows an MVP destructive-change policy and is intended for new-install path only.

- Old `env_groups` / `env_group_vars` are deprecated and removed.
- Historical data migration from old collections to new collections is out of scope in MVP.
- Existing deployments that rely on old env groups are not automatically upgraded by Epic 24.
- Release notes must explicitly mark this as a breaking change.

## Deletion Policy

Deletion behavior is defined as a single strategy:

- Deleting one `env_sets` record must cascade-delete all child `env_set_vars` records via PocketBase relation cascade.
- Frontend should call only parent delete API for env set deletion, and must not implement best-effort child cleanup logic.

## Secret Exposure Contract

When reading `env_set_vars` with `expand=secret`, only non-sensitive secret metadata may be visible in response.

- Allowed fields: `id`, `name`, `template_id`.
- Forbidden field: `payload_encrypted` (and any future encrypted payload field).
- This contract must be covered by backend automated tests.

## Scope

Shared Envs owns only the shared reusable layer:

- `env_sets` / `env_set_vars` store reusable non-sensitive values and secret references
- `apps.env_vars` stores app-owned editable non-sensitive values
- `apps.credentials` stores app-owned sensitive values
- platform var layer provides default runtime values derived from Settings and system-computed context

## Collections

All backed by PocketBase native collections. CRUD is fully served by PocketBase native Records API — no custom ext routes.

```
GET    /api/collections/env_sets/records
POST   /api/collections/env_sets/records
GET    /api/collections/env_sets/records/{id}
PATCH  /api/collections/env_sets/records/{id}
DELETE /api/collections/env_sets/records/{id}

GET    /api/collections/env_set_vars/records?filter=set='{id}'
POST   /api/collections/env_set_vars/records
PATCH  /api/collections/env_set_vars/records/{id}
DELETE /api/collections/env_set_vars/records/{id}
```

### `env_sets`
Named env sets, composable across apps and workflows.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required, unique |
| description | Text | |

### `env_set_vars`
Child records of `env_sets`. Each row is one key-value pair, optionally backed by a secret.

| Field | Type | Notes |
|-------|------|-------|
| set | Relation | → env_sets, required |
| key | Text | required; UPPER_SNAKE_CASE recommended; unique within the same set |
| value | Text | must be empty when `is_secret=true` |
| is_secret | Bool | mutually exclusive with `value` |
| secret | Relation | → secrets; required when `is_secret=true`, otherwise empty |

### `apps` collection (attachment field)
Apps reference env sets via an ordered relation field:

| Field | Type | Notes |
|-------|------|-------|
| env_sets | Relation[] | ordered list of → env_sets IDs; consumer fetches each set's vars at resolve time |

## UX

- Navigation: `Resources -> Shared Envs`
- UI: Shared Envs list page + detail form with inline `env_set_vars` rows (`key`, `value` or `secret` selector)
- App config page: `env_sets` multi-select with visible and reorderable attachment order
- App forms remain the primary place for app-owned env and credentials
- No custom backend routes — all data operations go through PocketBase native SDK calls

## Stories

### Story 24.1 — Migration

Remove old `env_groups` / `env_group_vars` collections and any related `resource_groups` attachment fields from the resource module. Create new `env_sets` and `env_set_vars` collections as standalone PocketBase native collections (not under Resource Store). Add `env_sets` ordered Relation[] field to `apps` collection.

- Delete or overwrite old migration files for `env_groups` / `env_group_vars`
- Remove `env_groups`-related fields from `apps` collection migration
- Remove `Env Groups` from Resource Store hub and sidebar
- Breaking change: old env groups are removed and not migrated in MVP

### Story 24.2 — Backend

No custom ext routes needed. PocketBase native Records API covers all CRUD for `env_sets` and `env_set_vars`. Backend work is limited to:

- PocketBase API Rules on `env_sets` and `env_set_vars` collections (auth required; superuser-only write in MVP)
- Unique index on `(set, key)` for `env_set_vars`
- Expand config on `env_set_vars`: `secret` field expand enabled
- Verify `apps.env_sets` relation field is queryable with expand
- Add automated contract test to ensure `payload_encrypted` is never returned via `expand=secret`

### Story 24.3 — Frontend

- Shared Envs list page at `Resources -> Shared Envs`
- Env set detail / create / edit form with inline `env_set_vars` row editor
- Each row: `key` text field + toggle (`literal value` / `secret ref`) + value or secret selector
- App config page: `env_sets` multi-select with reorderable attachment list
- All data via PocketBase JS SDK (`pb.collection('env_sets')`, `pb.collection('env_set_vars')`)
- Remove old `EnvGroupsPage` component and `/resources/env-groups` route

## Dependencies

- Prerequisites: Epic 1 (infra), Epic 3 (auth), Epic 19 (Secrets, for secret-backed vars)
- Consumers: Epic 17 (deploy resolver reads `apps.env_sets` at resolve time), workflow execution (future epic)

## Out of Scope

- Full variable binding model for workflow steps
- Per-variable RBAC and audit expansion
- Secret rotation for secret-backed vars (handled by Epic 19)
