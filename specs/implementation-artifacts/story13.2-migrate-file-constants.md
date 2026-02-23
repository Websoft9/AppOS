# Story 13.2: Migrate Hardcoded File Constants → Settings DB

**Epic**: Epic 13 - Settings Management
**Priority**: P2
**Status**: done
**Depends on**: Story 13.1 (app_settings collection + settings helper must exist)

## User Story

As a developer,
I want the file quota constants read from the `app_settings` database at runtime,
so that administrators can configure quotas without recompiling the binary.

This story also resolves the long-standing Story 9.5 blocker.

## Acceptance Criteria

- AC1: `routes/files.go` reads `maxSizeMB`, `maxPerUser`, `shareMaxMinutes`, `shareDefaultMinutes` from `app_settings` via `settings.GetGroup`; hardcoded `const` block is removed.
- AC2: `hooks/hooks.go` reads `maxPerUser` from `app_settings` via `settings.GetGroup`; hardcoded `hookFilesMaxPerUser` constant is removed.
- AC3: Seed migration inserts the `files/quota` default row on first boot (insert-if-not-exists); subsequent boots leave existing values untouched.
- AC4: If the `files/quota` row is missing at runtime, fallback defaults `10/100/60/30` are used (no panic, no error logged to user).
- AC5: `GET /api/ext/settings/files` response values reflect the database values, not hardcoded constants.

## Tasks / Subtasks

- [x] Task 1: Seed migration (AC3)
  - [x] 1.1 File: `backend/internal/migrations/1741200001_seed_app_settings.go`
  - [x] 1.2 In `up()`: call `settings.SetGroup` only if the row does not already exist — check with `app.FindFirstRecordByFilter("app_settings", "module='files' && key='quota'", ...)` first
  - [x] 1.3 Default value: `{"maxSizeMB":10,"maxPerUser":100,"shareMaxMinutes":60,"shareDefaultMinutes":30}`
  - [x] 1.4 `down()` is a no-op (seed data is not rolled back)

- [x] Task 2: Replace constants in `routes/files.go` (AC1, AC4, AC5)
  - [x] 2.1 Remove the `const` block (`filesMaxSizeMB`, `filesMaxPerUser`, `filesShareMaxMin`, `filesShareDefaultMin`)
  - [x] 2.2 Add package-level `defaultFilesQuota` fallback map
  - [x] 2.3 In `handleFilesQuota`: load quota with `settings.GetGroup`, then use `settings.Int` for each field
  - [x] 2.4 In `handleFileShareCreate`: same pattern — load quota then read field
  - [x] 2.5 Keep `filesReservedFolderNames`, `filesAllowedUploadFormats`, `filesEditableFormats` as constants

- [x] Task 3: Replace constants in `hooks/hooks.go` (AC2, AC4)
  - [x] 3.1 Remove `hookFilesMaxPerUser` constant
  - [x] 3.2 In `validateFileUpload`: load quota before checks
  - [x] 3.3 Keep `hookFilesAllowedFormats` constant
  - [x] 3.4 Import `settings` package in hooks.go

- [x] Task 4: Verify (AC4, AC5)
  - [x] 4.1 `go build ./...` passes with no errors

## Dev Notes

### Code-level defaults (保底)
`defaultFilesQuota` (defined in task 2.2) is the **code-level safety net**. When the DB is unavailable or the seed row is missing, `settings.GetGroup` always returns `(fallback, err)` — never `nil`. The `quota, _ := settings.GetGroup(...)` pattern is therefore safe: quota is always a valid map, and handlers never panic regardless of DB state.

### Key files to touch
```
backend/internal/migrations/1741200001_seed_app_settings.go  ← new
backend/internal/routes/files.go                             ← modify: remove const block, load from DB
backend/internal/hooks/hooks.go                              ← modify: remove const block, load from DB
```

Constants **not** migrated this story (not yet configurable): `filesReservedFolderNames`, `filesAllowedUploadFormats`, `filesEditableFormats`, `hookFilesAllowedFormats`.

### References
- Settings helper: `backend/internal/settings/settings.go` (created in Story 13.1)
- Hardcoded constants to remove: [backend/internal/routes/files.go](backend/internal/routes/files.go#L18-L27)
- Hardcoded constants to remove: [backend/internal/hooks/hooks.go](backend/internal/hooks/hooks.go#L18-L23)
- Epic 13 seed values: [specs/implementation-artifacts/epic13-settings.md](specs/implementation-artifacts/epic13-settings.md)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- `hookDefaultFilesQuota` (package-level var) used in hooks.go (mirrors `defaultFilesQuota` in files.go)
- `go build ./...` passes with 0 errors

### File List

- `backend/internal/migrations/1741200001_seed_app_settings.go` (new)
- `backend/internal/routes/files.go` (modified)
- `backend/internal/hooks/hooks.go` (modified)
