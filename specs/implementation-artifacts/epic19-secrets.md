# Epic 19: Secrets Management

**Module**: Security Foundation | **Status**: backlog | **Priority**: P0 | **Depends on**: Epic 12, Epic 13

## Objective

Provide a centralized, minimal, and secure secrets module for AppOS so all sensitive values are stored and consumed through `secretRef` instead of plain settings.

## Requirements

1. Support CRUD for secrets metadata and encrypted payload in a single `secrets` table.
2. Support configurable `access_mode` per secret (default: `use_only`).
3. Support secret reference (`secretRef`) usage from other modules (e.g. settings/AI/deploy).
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
- Consumer summary fields (`used_by_count`, `last_used_by`) updated synchronously on each use event.
- Existing `resources > secrets` data migrated to new module without regression (Story 19.5).

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
| `last_used_at` | datetime | updated on each resolve |
| `used_by_count` | int | total resolve count, incremented synchronously |
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

## Template Source (File-Based)

- Location: `backend/internal/secrets/templates.json`
- Loaded at startup; `template_id` validated on create/update.
- Frontend fetches via `GET /api/ext/secrets/templates`.
- No template table introduced.

```json
[
  {
    "id": "single_value",
    "label": "Single Value",
    "fields": [{ "key": "value", "label": "Secret Value", "type": "password", "required": true }]
  },
  {
    "id": "basic_auth",
    "label": "Basic Auth",
    "fields": [
      { "key": "username", "label": "Username", "type": "text", "required": true },
      { "key": "password", "label": "Password", "type": "password", "required": true }
    ]
  }
]
```

## API

### PocketBase Collection API (standard CRUD)

Base: `/api/collections/secrets/records`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/collections/secrets/records` | List — `payload_encrypted` excluded via PB field visibility rule |
| POST | `/api/collections/secrets/records` | Create — before-create hook encrypts payload, strips plaintext |
| PATCH | `/api/collections/secrets/records/:id` | Update metadata only; payload changes go through rotate endpoint |
| DELETE | `/api/collections/secrets/records/:id` | Superuser only |

PB collection hooks:
- **Before Create**: encrypt `payload` → `payload_encrypted`, remove plaintext from record.
- **Before Update**: reject direct writes to `payload_encrypted`; use rotate endpoint instead.
- **After Create / Delete**: emit audit event.

### Custom Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/ext/secrets/templates` | any | List available credential templates |
| POST | `/api/ext/secrets/:id/rotate` | superuser | Re-encrypt with new payload; increment `version` |
| POST | `/api/ext/secrets/:id/revoke` | superuser | Set `status=revoked`; emit audit |
| POST | `/api/ext/secrets/resolve` | internal only | Resolve `secretRef` → return plaintext (backend-to-backend, not exposed to UI) |
| GET | `/api/ext/secrets/:id/reveal` | superuser | Return plaintext if `access_mode` allows; auto-reset `reveal_once` |

`resolve` guards: requires internal header `X-Appos-Internal: 1`; returns 403 if `status=revoked` or scope/ownership check fails.

## Stories

### Story 19.1 Secrets Data Model

Create `secrets` PB collection with all fields, before-create/update hooks for encryption, and `APPOS_SECRET_KEY` startup guard.

**AC:**
- Collection created with all fields per data model above.
- Missing `APPOS_SECRET_KEY` → fatal log + process exit.
- `payload_encrypted` excluded from all list/view API responses.
- `scope: user_private` enforced by PB collection access rule.

### Story 19.2 Secrets API

Implement 5 custom routes (templates, rotate, revoke, resolve, reveal). Standard CRUD via PB collection API.

**AC:**
- All custom endpoints respond correctly per `access_mode` and `scope` rules.
- `resolve` endpoint not reachable without internal header.
- `reveal_once` auto-resets `access_mode` to `use_only` after first call.

### Story 19.3 SecretRef Consumption

Enable modules (settings/AI/deploy) to reference secrets via `secretRef: <id>` and resolve at runtime.

**AC:**
- `secretRef` in module configs resolved at runtime before use.
- Plaintext never persisted in consuming module's storage.
- Revoked or missing secret returns clear error to caller.

### Story 19.4 Audit Integration

Emit audit events for secret lifecycle via existing Epic 12 pipeline.

**AC:**
- Events: `secret.create`, `secret.update`, `secret.rotate`, `secret.revoke`, `secret.use`, `secret.reveal`.
- Each event includes: `secret_id`, `name`, `actor`, `timestamp`, `result`.
- `used_by_count` and `last_used_by` updated synchronously on `secret.use`.

### Story 19.5 Migration from Resources Secrets

Migrate existing `resources > secrets` records and module references to the new `secrets` module.

**AC:**
- All existing secrets migrated with field mapping documented.
- All consuming module references updated from old ID to new `secretRef`.
- Count check: old record count == new record count.
- No functionality regression after migration.
- Rollback reversible within 1 sprint.

**Migration Steps:**
1. **Inventory** — list all `resources > secrets` records and all modules referencing them.
2. **Migrate data** — insert into `secrets` table with `template_id` mapping; re-encrypt with `APPOS_SECRET_KEY`.
3. **Update references** — replace old IDs with `secretRef: <new_id>` in all consuming records.
4. **Verify & rollback** — count check, smoke test resolve endpoint, document rollback procedure.

### Story 19.6 Secrets UI

Implement secrets list page and create/edit form in dashboard.

**AC:**
- List page shows: name, template_id, scope, access_mode, status, last_used_at, consumer summary.
- Create/edit form fields rendered dynamically from template API response.
- Reveal button visible only when `access_mode ≠ use_only`; confirm dialog required.
- Delete disabled for active secrets (show revoke instead); revoked secrets can be deleted.

## Story Status

| Story | Status |
|-------|--------|
| 19.1 Secrets Data Model | backlog |
| 19.2 Secrets API | backlog |
| 19.3 SecretRef Consumption | backlog |
| 19.4 Audit Integration | backlog |
| 19.5 Migration from Resources Secrets | backlog |
| 19.6 Secrets UI | backlog |
