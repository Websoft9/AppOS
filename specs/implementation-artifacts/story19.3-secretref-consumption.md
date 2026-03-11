# Story 19.3: SecretRef Consumption

**Epic**: Epic 19 - Secrets Management
**Priority**: P0
**Status**: complete
**Depends on**: Story 19.1

## User Story

As a module developer, I want to bind a `secretRef` to any sensitive config field and have it resolved to plaintext at runtime, so that no module ever stores sensitive values directly.

## Acceptance Criteria

- [x] AC1: A shared `secretRef` resolver is available to all backend modules via `backend/internal/secrets/resolver.go`.
- [x] AC2: When a module saves a config field with `secretRef: <id>`, the resolver validates at bind time that the current user has read access to the referenced secret (scope/ownership check).
- [x] AC3: At runtime, `resolver.Resolve(id)` calls the internal decrypt function directly (not via HTTP self-call); returns decrypted plaintext as `map[string]any` to the caller.
- [x] AC4: Revoked or missing secret returns a structured error; caller receives a clear message, not a blank value.
- [x] AC5: Plaintext value from resolve is never persisted by the consuming module.
- [x] AC6: A minimal reference integration is delivered for Settings `llm/providers` (or covered by an integration test if Settings changes are scheduled separately).

## Tasks / Subtasks

- [x] Task 1: Create `backend/internal/secrets/resolver.go`
  - [x] 1.1 `Resolve(app, secretID, callerContext) (map[string]any, error)` — fetches record from DB, decrypts `payload_encrypted` using shared crypto helper from Story 19.1, returns plaintext map
  - [x] 1.2 Record `last_used_at`, `last_used_by`, emit `secret.use` audit event after successful resolve
  - [x] 1.3 Return structured error with `secret_id` and reason on failure
- [x] Task 2: Bind-time validation helper
  - [x] 2.1 `ValidateRef(app, secretID, userID) error` — checks scope/ownership before saving `secretRef`
  - [x] 2.2 Integrate into Settings create/update flows for `secretRef` fields
- [x] Task 3: Reference integrations — Settings `llm/providers` and Server credentials
  - [x] 3.1 `llm/providers` API key field accepts `secretRef:<id>` format; before-save: call `ValidateRef`
  - [x] 3.2 Server credential resolve: refactor `resolveServerConfig` in `routes/server.go` to call
        `secrets.Resolve(app, credID, userID)` instead of `crypto.Decrypt(secretRec.Get("value"))`;
        supports both new `payload_encrypted` format and legacy `value` field (backward compat until 19.4)
  - [x] 3.3 Extract `firstStringFromMap(payload, keys...)` helper in `routes/server.go` to pick credential
        value from payload map based on `auth_type` (password → `"password"`, key → `"private_key"`)

## Integration Notes

- Uses Story 19.1 shared crypto helper (`backend/internal/secrets/crypto.go`) and audit pipeline (Epic 12).
- Reference integrations: Settings `llm/providers` (secretRef bind-time validation) and Server credentials
  (full Resolve-at-runtime replacing legacy `crypto.Decrypt` call in `resolveServerConfig`).
- AI/Deploy integrations follow the same `secretRef` contract in subsequent stories.

## Dev Notes

- `secretRef` is a plain string convention: `"secretRef:<uuid>"`. No special DB type needed.
- Consuming modules detect `secretRef:` prefix at runtime and route through resolver.
- `resolver.Resolve()` is synchronous; no caching in MVP (caching deferred).
- The `secrets` package already has `crypto.go` with `EncryptPayload`/`DecryptPayload` (AES-256-GCM, base64 JSON blob).
  Legacy connector secrets used `internal/crypto` package (AES-256-GCM, hex-encoded). Resolver handles both formats.
- The HTTP `POST /api/secrets/resolve` route (Story 19.1) should also call this same resolver internally, not duplicate decrypt logic.
- `last_used_at` / `last_used_by` fields already exist in secrets collection (added by migration 1762300000).
- `resolveServerConfig` is shared by shell, files, ops, containers, systemd routes — all benefit from the single change.

## File List

- `backend/internal/secrets/crypto.go` — existing (shared encrypt/decrypt helper)
- `backend/internal/secrets/resolver.go` — new
- `backend/internal/routes/settings.go` — modified (secretRef ValidateRef in llm/providers PATCH)
- `backend/internal/routes/server.go` — modified (resolveServerConfig uses secrets.Resolve)

## Change Log

| Date | Change |
|------|--------|
| 2026-03-11 | Story created |
| 2026-03-11 | Added Task 3.2/3.3 — Server credential resolve as second reference integration; added Server.go to File List |
| 2026-03-11 | Implementation complete — all tasks done, all tests passing |

## Dev Agent Record

### Implemented
- `backend/internal/secrets/resolver.go` (new): `Resolve()`, `ValidateRef()`, `IsSecretRef()`, `ExtractSecretID()`, `FirstStringFromPayload()`, `ResolveError` structured error type.
- `backend/internal/routes/server.go` (modified): `resolveServerConfig` now calls `secrets.Resolve()` instead of `crypto.Decrypt()`. Supports new `payload_encrypted` (Epic 19) and legacy `value` (pre-Epic 19) formats. `FirstStringFromPayload` picks credential value by `auth_type`.
- `backend/internal/routes/settings.go` (modified): Added `secrets` import; `maskValue` preserves `secretRef:<id>` values (not masked to `***`); `validateLLMProvidersSecretRefs` calls `ValidateRef` for each provider item with a `secretRef:` apiKey before PATCH saves.

### Tests Created
- `backend/internal/secrets/resolver_test.go`: Unit tests for `IsSecretRef`, `ExtractSecretID`, `FirstStringFromPayload`, `ResolveError` (pure, no DB).
- `backend/internal/routes/resolver_integration_test.go`: Integration tests using full PocketBase test app — `TestResolve_NotFound`, `TestResolve_Revoked`, `TestResolve_NewFormat`, `TestResolve_NoPayload`, `TestResolve_RecordsLastUsed`, `TestValidateRef_NotFound`, `TestValidateRef_Revoked`, `TestValidateRef_PrivateOtherUser`, `TestValidateRef_PrivateOwnUser`, `TestValidateRef_GlobalAnyUser`.

### All tests: ✅ PASS (full suite `go test ./...`)
