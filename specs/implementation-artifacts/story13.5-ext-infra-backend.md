# Story 13.5: Ext Infra Settings — Backend (Proxy / Docker / LLM)

**Epic**: Epic 13 - Settings Management
**Priority**: P2
**Status**: done
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

- [x] Task 1: Seed migration (AC1)
  - [x] 1.1 File: `backend/internal/migrations/1741200002_seed_infra_settings.go`
  - [x] 1.2 Insert-if-not-exists pattern for all 4 rows
  - [x] 1.3 Default values as specified
  - [x] 1.4 `down()` is a no-op

- [x] Task 2: Expand allowlist in `routes/settings.go` (AC6)
  - [x] 2.1 `allowedModuleKeys` pre-populated with proxy/docker/llm at initial creation

- [x] Task 3: Mask for nested array items (AC3, AC4, AC5)
  - [x] 3.1 `maskItems` helper walks `value["items"]` arrays and masks sensitive fields in each item
  - [x] 3.2 `preserveItemsSensitive` handles positional "***" preservation in array groups

- [x] Task 4: Code-level defaults (AC1 fallback)
  - [x] 4.1 `defaultProxyNetwork`, `defaultDockerMirror`, `defaultDockerRegistries`, `defaultLLMProviders` defined in `routes/settings.go`:
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

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- allowedModuleKeys, mask, and preserve logic all implemented in Story 13.1's settings.go (pre-populated)
- `go build ./...` passes with 0 errors

### File List

- `backend/internal/migrations/1741200002_seed_infra_settings.go` (new)
- `backend/internal/routes/settings.go` (modified: allowlist, mask, preserve all complete from 13.1)
