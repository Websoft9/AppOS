# Story 12.1: Audit Foundation (Collection + Helper)

**Epic**: Epic 12 - Operation Audit Log
**Priority**: P2
**Status**: Done
**Depends on**: Epic 1, Epic 3, Epic 4

## User Story

As a developer, I want a unified audit persistence foundation, so that all modules can write consistent audit records.

## Acceptance Criteria

- [x] AC1: Migration creates `audit_logs` collection with fields and access rules defined in Epic 12
- [x] AC2: `internal/audit/audit.go` exports `Write(...)` usable from any route handler or worker
- [x] AC3: Client cannot create/update/delete `audit_logs` via PB SDK (rules enforced)
- [x] AC4: `user_id = "system"` records are only visible to superusers

## Tasks / Subtasks

- [x] Task 1: Add migration `backend/internal/migrations/1741000000_create_audit_logs.go`
  - [x] 1.1 Create `audit_logs` BaseCollection with all fields from Epic 12 Data Model
  - [x] 1.2 Add `ip` TextField and `AutodateField` for `created` (required — not auto-included in BaseCollection)
  - [x] 1.3 `status` as `SelectField` with values `pending/success/failed`
  - [x] 1.4 Set access rules: `ListRule/ViewRule = user_id = @request.auth.id || @request.auth.collectionName = '_superusers'`
- [x] Task 2: Create `backend/internal/audit/audit.go`
  - [x] 2.1 `audit.Entry` named struct with all fields including `IP string` and `UserAgent string`
  - [x] 2.2 `Write()` saves `ip` field and merges `UserAgent` into `detail` map automatically
  - [x] 2.3 Validate status; errors logged and swallowed
- [x] Task 3: Add incremental migration `1741100000_add_audit_logs_ip.go` for existing installs

## Dev Notes

- Migration timestamp must be higher than `1740500000`; use `1741000000`
- `detail` minimum keys when used: `errorCode`, `errorMessage`, `taskId`
- Write only after result is known (except async `pending` written at enqueue time in Story 12.2)
- `app.Save()` inside `audit.Write()` bypasses PocketBase collection rules — intentional

## Dev Agent Record

### Implementation Plan
Created `1741000000_create_audit_logs.go` using `core.NewBaseCollection` with 8 fields: user_id (required), user_email, action (required), resource_type, resource_id, resource_name, status (required), detail (JSONField). ListRule/ViewRule = owner or superuser; Create/Update/Delete rules = nil (forbidden). Created `internal/audit/audit.go` with exported constants StatusPending/Success/Failed, a `validStatuses` map guard, and `Write()` which fetches the collection, builds a Record, and calls `app.Save()`. Errors are logged and swallowed to prevent audit failure from breaking callers.

### Completion Notes
All tasks complete. Backend compiles cleanly (`go build ./...`). Migration will auto-run on next server start.

## File List

- `backend/internal/migrations/1741000000_create_audit_logs.go` — new
- `backend/internal/migrations/1741100000_add_audit_logs_ip.go` — new (incremental migration for existing installs)
- `backend/internal/audit/audit.go` — new

## Change Log

| Date | Change |
|------|--------|
| 2026-02-23 | Story created |
| 2026-02-23 | Implemented — migration + audit helper complete |
| 2026-02-23 | Added `ip` TextField, `AutodateField`; `audit.Entry` named struct; `UserAgent` in detail; incremental migration 1741100000 |
