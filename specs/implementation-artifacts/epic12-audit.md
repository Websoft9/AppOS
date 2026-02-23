# Epic 12: Operation Audit Log

## Overview

Record all user operations on key resources (app deploy/start/stop, backup, user management, etc.) and provide a queryable audit history.

**Status**: Done | **Priority**: P2 | **Depends on**: Epic 1, Epic 3, Epic 4

---

## Design: Direct Write to `audit_logs` Collection

Does not reuse PB built-in `_logs` (superuser-only, no business semantics, no Asynq coverage).

A custom `audit_logs` BaseCollection is created; all writes go through `audit.Write()` in handlers and Asynq workers.

```
Custom Route Handler  → audit.Write() → audit_logs
Asynq Worker (async)  → audit.Write() → audit_logs
OnRecord* Hook        → audit.Write() → audit_logs  (可选，覆盖 PB CRUD)
```

Frontend queries via `pb.collection('audit_logs').getList()` — no extra backend endpoints needed.

---

## Data Model

### `audit_logs` (BaseCollection, no UpdateRule/CreateRule)

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | text | Actor ID (`system` for Asynq/Cron) |
| `user_email` | text | Redundant — readable after resource deletion |
| `action` | text | e.g. `app.deploy` `app.restart` `app.stop` `app.delete` `backup.create` `user.create` |
| `resource_type` | text | `app` `service` `backup` `user` `file` |
| `resource_id` | text | Target resource ID |
| `resource_name` | text | Redundant human-readable name |
| `status` | select | `pending` / `success` / `failed` |
| `ip` | text | Source IP (empty for async workers) |
| `detail` | json | Min keys: `errorCode`, `errorMessage`, `taskId`, `user_agent` (nullable) |
| `created` | autodate | |

**Access rules**:
- `ListRule` / `ViewRule`: `user_id = @request.auth.id || @request.auth.collectionName = '_superusers'`
- `CreateRule` / `UpdateRule` / `DeleteRule`: `""` (禁止客户端写入)

`user_id = "system"` records are visible to superusers only.

All writes go through the backend `audit.Write()` function, bypassing PB access rules via `app.Save()`.

---

## Audit Helper

```go
// internal/audit/audit.go
package audit

func Write(app core.App, userID, userEmail, action, resourceType, resourceID, resourceName, status string, detail map[string]any)
```

Write timing: only after the result is determined — sync operations before handler returns; async operations when the worker finishes.

---

## Action Naming Convention

Format: `{resource_type}.{verb}`

| Action | Trigger |
|--------|---------|
| `app.deploy` | Deploy app (Asynq) |
| `app.start` | Start app |
| `app.restart` | Restart app |
| `app.stop` | Stop app |
| `app.delete` | Delete app (Asynq) |
| `app.rebuild` | Rebuild app (Asynq) |
| `app.env_update` | Update env vars |
| `service.restart` | Restart system service |
| `backup.create` | Create backup (Asynq) |
| `backup.restore` | Restore backup |
| `user.create` | Create user |
| `user.update` | Update user |
| `user.delete` | Delete user |
| `user.reset_password` | Reset password |
| `login.success` | Successful login |
| `login.failed` | Failed login attempt |

Rule: published actions must not be renamed; new actions are append-only to preserve queryability of historical records.

---

## Design Decisions

- **Coupling**: Audit writes are intentionally inline in handlers (not middleware). Middleware cannot capture async results, resource names, or business-level success/failure.
- **`audit.Entry` struct**: Named struct (not variadic params) for readability and forward compatibility.
- **IP field**: Top-level column for queryability; User-Agent stored in `detail` JSON (not a column).
- **Login audit**: Uses PocketBase `OnRecordAuthWithPasswordRequest` hook; `Identity` field gives the attempted email even on failure.
- **Superuser audit**: Both `users` and `_superusers` collections are tracked symmetrically.

## Stories

Epic holds scope and constraints only; implementation details are in the story files:

- [Story 12.1](story12.1-audit-foundation.md) — Collection migration + `audit.Write()` helper
- [Story 12.2](story12.2-audit-sync-async.md) — Sync handler integration + Asynq pending/complete audit
- [Story 12.3](story12.3-audit-viewer.md) — Dashboard audit log viewer

Execution order: 12.1 → 12.2 → 12.3

---

## Out of Scope

- Audit log export (CSV/Excel)
- Audit alerts and notifications
- Exposing or processing PB built-in `_logs`
- Per-file operation auditing (upload/download)
