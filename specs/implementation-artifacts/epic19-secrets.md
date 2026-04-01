# Epic 19: Secrets Management

**Module**: Security Foundation | **Status**: done | **Priority**: P0 | **Depends on**: Epic 12, Epic 13 Settings Module

## Navigation

```
Admin
└── Credentials
    ├── Secrets              ← this epic
    └── Environment Variables
```

`Credentials` is the top-level menu entry. Clicking it lands on the Secrets sub-page by default (or shows both sub-menu items). Environment Variables is a sibling sub-menu, managed by a separate epic.

## Objective

Provide a centralized, minimal, and secure secrets module for AppOS so all sensitive values are stored and consumed through `secretRef` instead of plain settings.

## Session Delta (2026-03-20)

- Added `created_source` to distinguish system-created and user-created credentials.
- `tunnel_token` is system-managed: fixed `template_id = single_value`, not user-editable/deletable via common secret paths.
- Secrets list defaults to user-created records only; system credentials are hidden by default.

## Requirements

1. Support CRUD for secrets metadata and encrypted payload in a single `secrets` table.
2. Support configurable `access_mode` per secret (default: `use_only`).
3. Support secret reference (`secretRef`) usage from other modules (for example Epic 13 settings entries, AI providers, and deploy flows).
4. Reuse Epic 12 audit pipeline for secret lifecycle events (no dedicated secrets audit table).
5. Use file-based credential templates to drive form fields and backend validation.

## Acceptance Criteria

- Sensitive values never stored in plaintext; all payloads encrypted with AES-256-GCM using `APPOS_SECRET_KEY`.
- Modules consume secrets via `secretRef` at runtime without reading plaintext directly.
- `access_mode: use_only` (default) — plaintext never returned via any API.
- `access_mode: reveal_once` — plaintext returned exactly once via reveal API, then auto-resets to `use_only`.
- `access_mode: reveal_allowed` — superuser can retrieve plaintext on demand via reveal API.
- `scope: user_private` secrets accessible only by `created_by` user or superuser.
- UI list page shows metadata only (name, scope, template_id, access_mode, last_used_at, consumer summary).
- Secret lifecycle events emit audit records via existing Epic 12 pipeline.
- Create/edit forms rendered dynamically from file-based template definitions.
- `last_used_at` and `last_used_by` updated synchronously on each resolve event.

## Out of Scope

- External KMS/Vault integration.
- Full RBAC redesign.
- Multi-server secret synchronization.
- Any additional tables beyond `secrets`.

## Encryption Scheme

| Item | Value |
|------|-------|
| Algorithm | AES-256-GCM |
| Key source | Env var `APPOS_SECRET_KEY` (32-byte, base64-encoded) |
| Key rotation | Out of scope (MVP) |
| Storage | `payload_encrypted` — ciphertext + nonce as base64 JSON blob |

Missing `APPOS_SECRET_KEY` at startup → fatal error, process exits.

## Data Model (Single Table: `secrets`)

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | PB auto |
| `name` | string | unique display name |
| `template_id` | string | e.g. `single_value`, `basic_auth` |
| `scope` | enum | `global` \| `user_private` |
| `access_mode` | enum | `use_only` (default) \| `reveal_once` \| `reveal_allowed` |
| `payload_encrypted` | string | AES-256-GCM ciphertext blob |
| `payload_meta` | JSON | non-sensitive hints for list/filter only |
| `status` | enum | `active` \| `revoked` |
| `version` | int | increments on each rotate |
| `created_source` | enum | `user` \| `system` |
| `last_used_at` | datetime | updated on each resolve |
| `last_used_by` | string | `module:id` of most recent consumer |
| `created_by` | string | user id |
| `created` / `updated` | datetime | PB auto |

`payload_meta` example: `{"username_hint":"ad***","has_password":true}`

## Access Mode Behavior

| `access_mode` | Backend resolve (secretRef) | Reveal API | Notes |
|---------------|-----------------------------|------------|-------|
| `use_only` | ✅ plaintext to backend only | ❌ | Default |
| `reveal_once` | ✅ | ✅ once, then auto-resets to `use_only` | One-time copy workflows |
| `reveal_allowed` | ✅ | ✅ superuser only | Managed credentials |

## Scope Behavior

| `scope` | Who can read/use |
|---------|-----------------|
| `global` | Any authenticated module or superuser |
| `user_private` | Only `created_by` user + superuser |

## Permission Rules

| Operation | Who |
|-----------|-----|
| Read (list/detail) | Any authenticated user |
| Create | Any authenticated user |
| Update metadata | `created_by` + superuser (system-managed denied) |
| Update payload (`PUT /payload`) | `created_by` + superuser (system-managed denied) |
| Revoke (`PATCH status=revoked`) | Superuser only |
| Delete | Superuser only (system-managed denied) |
| Reveal | `created_by` + superuser (subject to `access_mode`) |
| Resolve (internal) | Internal header only — no user context |

Read is intentionally open to all authenticated users: the list view only exposes non-sensitive metadata (`name`, `template_id`, `scope`, `access_mode`, `status`). No raw secret value is ever returned from list/detail.

## Template Source (File-Based)

- Location: `backend/domain/secrets/templates.json`
- Loaded at startup; `template_id` validated on create/update.
- Frontend fetches via `GET /api/secrets/templates`.
- No template table introduced.

5 built-in templates: `single_value`, `basic_auth`, `api_key`, `database`, `ssh_key`.

Field types: `text`, `password`, `textarea`. Fields may include `upload: true` for file-based input (e.g. SSH private key).

```json
[
  { "id": "single_value", "fields": [{ "key": "value", "type": "password" }] },
  { "id": "basic_auth", "fields": [{ "key": "username", "type": "text" }, { "key": "password", "type": "password" }] },
  { "id": "api_key", "fields": [{ "key": "api_key", "type": "password" }] },
  { "id": "database", "fields": [{ "key": "host" }, { "key": "port" }, { "key": "username" }, { "key": "password", "type": "password" }, { "key": "database" }] },
  { "id": "ssh_key", "fields": [{ "key": "username" }, { "key": "private_key", "type": "textarea", "upload": true }, { "key": "passphrase", "type": "password" }] }
]
```

## API

### PocketBase Collection API (standard CRUD)

Base: `/api/collections/secrets/records`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/collections/secrets/records` | List — `payload_encrypted` excluded via PB field visibility rule |
| POST | `/api/collections/secrets/records` | Create — before-create hook processes payload |
| PATCH | `/api/collections/secrets/records/:id` | Update metadata only; payload changes go through payload endpoint |
| DELETE | `/api/collections/secrets/records/:id` | Superuser only |

PB collection hooks:
- **Before Create**: backend extracts `payload` to generate masked `payload_meta`, encrypts `payload` to `payload_encrypted`, and removes plaintext `payload` from record.
- **Before Update**: reject direct writes to `payload_encrypted`; deny updates for system-managed secrets; use payload custom route instead.
- **Before Delete**: deny deletes for system-managed secrets.
- **After Create / Delete**: emit audit event.

### Custom Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/secrets/templates` | any | List available credential templates |
| PUT | `/api/secrets/:id/payload` | superuser / owner | Update secret values, re-encrypt, rebuild `payload_meta`, increment `version`, emit audit |
| POST | `/api/secrets/resolve` | internal only | Resolve `secretRef` → return plaintext |
| GET | `/api/secrets/:id/reveal` | superuser / owner | Return plaintext if `access_mode` allows; auto-reset `reveal_once` to `use_only` |

**Revoke** is handled via standard PB PATCH (`status=revoked`) with a before-update hook: enforces superuser access rule, emits `secret.revoke` audit event on status transition. No custom route needed.

`resolve` guards: requires internal header `X-Appos-Internal: 1`. Consuming modules must validate user access rules (scope) during the initial binding of `secretRef`, as `resolve` assumes the runtime has authorization. Returns 403 if `status=revoked`.

## Stories

### Story 19.1 Backend Core — **done**

Create `secrets` PB collection, before-create/update hooks for encryption, 4 custom routes, and Epic 12 audit integration.

**AC:**
- Collection created with all fields; `payload_encrypted` excluded from all list/detail responses.
- Missing `APPOS_SECRET_KEY` at startup → fatal log + process exit.
- Before-create hook: generate `payload_meta` from plaintext, encrypt to `payload_encrypted`, remove virtual `payload` field.
- Permission rules: read/create = any auth user; update metadata = created_by or superuser; revoke/delete = superuser only.
- `resolve` returns 403 without `X-Appos-Internal: 1` header or if `status=revoked`.
- `reveal` respects `access_mode`; `reveal_once` auto-resets to `use_only` atomically.
- PATCH `status=revoked`: superuser only; before-update hook emits `secret.revoke` audit event.
- Audit events emitted for: `secret.create`, `secret.update`, `secret.payload_update`, `secret.revoke`, `secret.use`, `secret.reveal`.

### Story 19.2 Secrets UI — **done**

Implement Secrets page under Admin → Credentials → Secrets. Client-side search, column sorting, exclude-based filtering, and pagination.

**AC:**
- `Credentials` appears in Admin menu group; expands two sub-items: `Secrets` and `Environment Variables`.
- Secrets list page shows: name, template_id, scope, access_mode, status, last_used_at, last_used_by.
- Create/edit form fields rendered dynamically from `GET /api/secrets/templates`.
- Reveal button shown only when `access_mode ≠ use_only`; confirm dialog required.
- Active secrets show Revoke action (not Delete); revoked secrets can be deleted.

### Story 19.3 SecretRef Consumption — **done**

Enable modules (for example Epic 13 settings entries, AI providers, and deploy flows) to bind and resolve secrets via `secretRef: <id>` at runtime.

**AC:**
- Shared crypto helper extracted so resolver and HTTP route share identical decrypt logic.
- Binding a `secretRef` validates user has read access to the target secret at bind time.
- Runtime `resolver.Resolve()` calls internal decrypt directly (no HTTP self-call); updates `last_used_at`/`last_used_by` and emits audit.
- Revoked or missing secret returns clear structured error to caller.

## Story Status

| Story | Status |
|-------|--------|
| 19.1 Backend Core | done |
| 19.2 Secrets UI | done |
| 19.3 SecretRef Consumption | done |
