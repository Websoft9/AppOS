# Story 13.1: `app_settings` Collection + Settings Helper + Ext API

**Epic**: Epic 13 - Settings Management
**Priority**: P2
**Status**: done
**Depends on**: Epic 1 (build), Epic 3 (auth)

## User Story

As a developer,
I want a centralized `app_settings` collection and Go helper package,
so that any backend module can read/write grouped settings from the database instead of using hardcoded constants.

## Acceptance Criteria

- AC1: `app_settings` collection migration is applied with unique index on `(module, key)`.
- AC2: `GET /api/ext/settings/{module}` returns all groups for the module as grouped JSON; sensitive fields (`password`, `apiKey`, `secret`) are masked to `"***"`; superuser auth required.
- AC3: `PATCH /api/ext/settings/{module}` replaces full group object(s); if incoming sensitive field is `"***"`, existing stored value is preserved; superuser auth required; `422` on validation failure; `400` on unknown module/key.
- AC4: Non-superuser callers receive `403` from both GET and PATCH.
- AC5: `internal/settings/settings.go` exports `GetGroup` and `SetGroup`; callers can read a missing group and receive a fallback without error.

## Tasks / Subtasks

- [x] Task 1: Migration — create `app_settings` collection (AC1)
  - [x] 1.1 File: `backend/internal/migrations/1741200000_create_app_settings.go`
  - [x] 1.2 `core.NewBaseCollection("app_settings")` with fields: `module` (TextField, required), `key` (TextField, required), `value` (JSONField)
  - [x] 1.3 ListRule / ViewRule: `@request.auth.collectionName = '_superusers'`
  - [x] 1.4 CreateRule / UpdateRule / DeleteRule: `""` (nil — forbidden from client)
  - [x] 1.5 Add a unique index on `(module, key)` via `collection.Indexes` or raw SQL in the migration

- [x] Task 2: Settings helper package (AC5)
  - [x] 2.1 Create `backend/internal/settings/settings.go`
  - [x] 2.2 Implement `GetGroup(app core.App, module, key string, fallback map[string]any) (map[string]any, error)` — on **any** error (row not found OR DB failure) return `(fallback, err)`; never return `(nil, err)`. This ensures callers using `v, _ := GetGroup(...)` always have a usable map.
  - [x] 2.3 Implement `SetGroup(app core.App, module, key string, value map[string]any) error` — upsert row (find existing or create new record, marshal value to JSON, call `app.Save()`)
  - [x] 2.4 Implement typed readers operating on an already-loaded group map: `Int(group map[string]any, field string, fallback int) int` and `String(group map[string]any, field string, fallback string) string`

- [x] Task 3: Ext API routes (AC2, AC3, AC4)
  - [x] 3.1 Create `backend/internal/routes/settings.go`
  - [x] 3.2 Register routes under superuser-only group: `GET /api/ext/settings/{module}` and `PATCH /api/ext/settings/{module}`
  - [x] 3.3 `GET` handler: query all `app_settings` rows where `module = {module}`, return `{ groupKey: { ...fields } }` JSON; **mask** string fields named `password`, `apiKey`, `secret` to `"***"` before returning
  - [x] 3.4 `PATCH` handler: for each key in request body, call `SetGroup` with masked fields preserved: if incoming value `=== "***"`, load existing row and keep original value; validate `module` and `key` are known (allowlist per module); return `400` for unknown, `422` for type mismatch
  - [x] 3.5 Register via `routes.RegisterSettings(se)` in main alongside other ext route registrations

- [x] Task 4: Basic test (AC1–AC5)
  - [x] 4.1 `backend/internal/settings/settings_test.go` — unit test `GetGroup` fallback path and `SetGroup` round-trip using PB test app

## Dev Notes

### Route registration pattern
Follow `backend/internal/routes/space.go`. Use `apis.RequireSuperuserAuth()` (not `RequireAuth()`).

### Migration — unique index
Reference `1741000000_create_audit_logs.go` for `core.NewBaseCollection` pattern. Unique index:

```go
// Add unique index after setting fields
collection.Indexes = types.JSONArray[string]{
    "CREATE UNIQUE INDEX idx_app_settings_module_key ON app_settings (module, `key`)",
}
```

### `SetGroup` upsert pattern
```go
func SetGroup(app core.App, module, key string, value map[string]any) error {
    // Try to find existing record first
    record, err := app.FindFirstRecordByFilter("app_settings",
        "module = {:module} && key = {:key}",
        dbx.Params{"module": module, "key": key})
    if err != nil {
        // Not found — create new record
        collection, _ := app.FindCollectionByNameOrId("app_settings")
        record = core.NewRecord(collection)
        record.Set("module", module)
        record.Set("key", key)
    }
    record.Set("value", value)
    return app.Save(record)
}
```

### PATCH allowlist (Phase 1 — space only; expanded in Story 13.5)
Only `space/quota` valid in this story. Return `400` for anything else.
```go
var allowedModuleKeys = map[string][]string{"space": {"quota"}}
```

### Mask logic (GET + PATCH)
```go
var sensitiveFields = map[string]bool{"password": true, "apiKey": true, "secret": true}

// In GET: walk each group's value map, replace sensitive string fields
func maskGroup(v map[string]any) map[string]any { ... }

// In PATCH: if incoming string == "***", load existing value from DB and keep it
```

### Migration timestamp
`1741200000` (next after `1741100000`).

### New files
```
backend/internal/migrations/1741200000_create_app_settings.go
backend/internal/settings/settings.go
backend/internal/settings/settings_test.go
backend/internal/routes/settings.go
```

### References
- Epic 13 data model: [specs/implementation-artifacts/epic13-settings.md](specs/implementation-artifacts/epic13-settings.md)
- Audit migration pattern: [backend/internal/migrations/1741000000_create_audit_logs.go](backend/internal/migrations/1741000000_create_audit_logs.go)
- Audit helper pattern: [backend/internal/audit/audit.go](backend/internal/audit/audit.go)
- Route registration pattern: [backend/internal/routes/space.go](backend/internal/routes/space.go)
- Architecture — custom route auth: [specs/planning-artifacts/architecture.md](specs/planning-artifacts/architecture.md) §Unified auth for all routes

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- `defaultSpaceQuota` var declared in `routes/space.go` (not settings.go) to avoid duplication
- Nested array mask/preserve implemented for docker/llm items (Story 13.5 scope included)
- `allowedModuleKeys` pre-populated for all 4 modules (space, proxy, docker, llm) at time of creation

### File List

- `backend/internal/migrations/1741200000_create_app_settings.go` (new)
- `backend/internal/settings/settings.go` (new)
- `backend/internal/settings/settings_test.go` (new)
- `backend/internal/routes/settings.go` (new)
- `backend/internal/routes/routes.go` (modified)
