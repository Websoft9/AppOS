# Epic 24: Environment Variable Groups

## Overview

**Platform-level reusable environment variable sets** — named groups of key-value pairs (optionally referencing secrets) that can be attached to multiple applications. Env Groups are the "shared, reusable" layer of environment variable management, distinct from app-inline `env_vars` (non-sensitive, single-app) and App Credentials (encrypted, app-scoped).

**Status**: Done | **Priority**: P1 | **Depends on**: Epic 1, Epic 3, Epic 8 (Resource Store), Epic 19 (Secrets)

## Scope Design: Where Env Vars Live

Three distinct layers handle sensitive and non-sensitive config:

**Env Vars — two separate layers**

| Layer | Location | Use case |
|-------|----------|----------|
| App inline env vars | `apps.env_vars` (JSON key-value) | App-specific, non-sensitive config |
| Resource Store Env Groups | `env_groups` collection | Shared, reusable across apps |

If an inline env var needs to be sensitive, it must instead be stored as an App Credential.

**App Credentials — App-scoped encrypted key-value**

Deployment passwords (e.g. app admin password, internal DB password) are App-specific runtime credentials. They are not shared, not reusable, and must not be placed in the Resource Store.

| Dimension | Resource Store Env Group var | App Credential |
|-----------|------------------------------|----------------|
| Scope | Platform-wide, reusable | Single App, non-shareable |
| Lifecycle | Independent | Created and deleted with the App |
| Location | `env_group_vars` + optional `secret` ref | `apps.credentials` JSON (encrypted) |
| UI | Resource Store Env Groups page | App detail page |

This means the `apps` collection carries:
- `env_vars` JSON — inline non-sensitive key-value (no encryption)
- `credentials` JSON — inline sensitive key-value (encrypted, App-scoped)
- `env_groups[]` Relation — references to Resource Store env groups

## Navigation

Env Groups live under the Resource Store sidebar:

```
Resources
  └── Env Groups    → /resources/env-groups
```

## Collections

### `env_groups`
Named sets of environment variables, composable across apps.

| Field | Type | Notes |
|-------|------|-------|
| name | Text | required |
| description | Text | |
| groups | Relation[] | → resource_groups; auto-filled with `default` on create if empty |

### `env_group_vars`
Child records of `env_groups`. Each row is one key-value pair, optionally backed by a secret.

| Field | Type | Notes |
|-------|------|-------|
| group | Relation | → env_groups, required |
| key | Text | required |
| value | Text | must be empty when `is_secret=true` |
| is_secret | Bool | mutually exclusive with `value` |
| secret | Relation | → secrets; required when `is_secret=true`, otherwise empty |

## API Routes

All under `/api/ext/resources/`. All require authentication.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/env-groups` | List env groups with vars |
| POST | `/env-groups` | Create env group |
| GET | `/env-groups/:id` | Get env group with vars |
| PUT | `/env-groups/:id` | Update env group and vars |
| DELETE | `/env-groups/:id` | Delete env group and all vars |

## Implementation Notes (Dashboard UI)

### Env Groups — custom component

Env Groups require a nested dynamic vars editor (each row: key + value or secret selector) which cannot be expressed in flat `FieldDef[]`. The route uses a standalone `EnvGroupsPage` component instead of the generic `ResourcePage`.

- Each `env_group_vars` row rendered inline within the Env Group form
- `is_secret` toggle switches the value field to a secret selector (`<select>` populated from `/api/collections/secrets/records`)
- Non-secret rows: plain text `value` field; `secret` is null
- Secret rows: `value` is empty string; `secret` ID is required
- On save: parent `env_groups` record upserted first, then child `env_group_vars` records synced (delete removed rows, create/update remaining)

### Resource Hub integration

The Env Groups card appears on the Resource Hub at `/resources`:

```
[+ Add Resource ▾]
  ...
  │  Env Group      │  → /resources/env-groups?create=1
  ...
```

The hub card shows live count of env groups.

### Groups field

The Env Groups create/edit form includes a `Groups` multi-select field (same as other resource types):
- Options sourced from `/api/ext/resources/groups`
- `default` group pre-selected on create

## Stories

- [x] 24.1: Migration — `env_groups` and `env_group_vars` collections (extracted from Epic 8 migration `8.1`)
- [x] 24.2: Backend routes — CRUD API for `/env-groups` (extracted from Epic 8 story `8.2`)
- [x] 24.3: Dashboard UI — Env Groups list/form page with nested vars editor (`EnvGroupsPage` component)
- [x] 24.4: App resource binding — `env_groups[]` relation field on `apps` collection (part of Epic 8 story `8.5`)

## Dependencies

- Prerequisites: Epic 1 (infra), Epic 3 (auth), Epic 8 (Resource Store — resource_groups, shared patterns), Epic 19 (secrets, for secret-backed vars)
- Consumers: Epic 6 (app deployment — env injection at runtime)

## Out of Scope

- Env Group variable encryption at rest (non-secret vars stored as plaintext; sensitive vars delegate to secrets)
- Per-variable RBAC (Phase 2)
- Env Group merging / override priority across multiple attached groups (Phase 2)
- Secret rotation for secret-backed vars (handled by Epic 19)
