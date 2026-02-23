# Story 13.5: Ext Infra Settings — Backend (Proxy / Docker / LLM)

**Epic**: Epic 13 - Settings Management
**Priority**: P2
**Status**: ready-for-dev
**Depends on**: Story 13.1 (app_settings collection + helper + Ext API with mask)

## User Story

As a developer,
I want proxy, Docker registry, and LLM provider configuration stored in `app_settings`,
so that administrators can set these without modifying code or environment variables.

## Acceptance Criteria

- AC1: Seed migration inserts default rows for `proxy/network`, `docker/mirror`, `docker/registries`, `llm/providers` on first boot (insert-if-not-exists); existing rows untouched.
- AC2: `GET /api/ext/settings/proxy` returns `network` group with `password` masked to `"***"`.
- AC3: `GET /api/ext/settings/docker` returns `mirror` and `registries` groups; `password` in registries items masked.
- AC4: `GET /api/ext/settings/llm` returns `providers` group; `apiKey` in providers items masked.
- AC5: `PATCH` for each module correctly preserves `"***"` values (does not overwrite with literal `"***"`).
- AC6: Unknown module/key returns `400`; all new module/key combinations are added to the allowlist.

## Tasks / Subtasks

- [ ] Task 1: Seed migration (AC1)
  - [ ] 1.1 File: `backend/internal/migrations/1741200002_seed_infra_settings.go` (timestamp after `1741200001`)
  - [ ] 1.2 For each of the 4 rows, use insert-if-not-exists pattern from Story 13.2
  - [ ] 1.3 Default values:
    - `proxy/network`: `{"httpProxy":"","httpsProxy":"","noProxy":"","username":"","password":""}`
    - `docker/mirror`: `{"mirrors":[],"insecureRegistries":[]}`
    - `docker/registries`: `{"items":[]}`
    - `llm/providers`: `{"items":[]}`
  - [ ] 1.4 `down()` is a no-op

- [ ] Task 2: Expand allowlist in `routes/settings.go` (AC6)
  - [ ] 2.1 Add to `allowedModuleKeys`:
    ```go
    "proxy":  {"network"},
    "docker": {"mirror", "registries"},
    "llm":    {"providers"},
    ```

- [ ] Task 3: Mask for nested array items (AC3, AC4, AC5)
  - [ ] 3.1 Extend the `maskGroup` helper (from Story 13.1) to also walk `value["items"]` arrays and mask sensitive fields within each item
  - [ ] 3.2 Extend PATCH preserve-`"***"` logic to handle nested items: for array groups, load existing items, for each incoming item compare by position or identity (simplest: positional), preserve any `"***"` field from existing value

- [ ] Task 4: Code-level defaults (AC1 fallback)
  - [ ] 4.1 In `routes/settings.go` (or a new `settings/defaults.go`), define fallback maps used when DB unavailable:
    ```go
    var defaultProxyNetwork    = map[string]any{"httpProxy":"","httpsProxy":"","noProxy":"","username":"","password":""}
    var defaultDockerMirror    = map[string]any{"mirrors":[]any{},"insecureRegistries":[]any{}}
    var defaultDockerRegistries = map[string]any{"items":[]any{}}
    var defaultLLMProviders    = map[string]any{"items":[]any{}}
    ```

## Dev Notes

### Nested mask / preserve pattern
For flat groups (proxy/network), mask/preserve works field-by-field in the top-level map.  
For array groups (docker/registries, llm/providers), iterate `value["items"].([]any)` and apply the same field-level mask/preserve to each item map.

### Migration timestamp
`1741200002` — immediately after `1741200001_seed_app_settings.go`.

### References
- allowedModuleKeys: [backend/internal/routes/settings.go](backend/internal/routes/settings.go)
- Seed pattern: [specs/implementation-artifacts/story13.2-migrate-file-constants.md](specs/implementation-artifacts/story13.2-migrate-file-constants.md) §Task 1
- Epic data model: [specs/implementation-artifacts/epic13-settings.md](specs/implementation-artifacts/epic13-settings.md) §Ext Settings Scope

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
