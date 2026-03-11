# Story 19.1: Secrets Backend Core

**Epic**: Epic 19 - Secrets Management
**Priority**: P0
**Status**: done
**Depends on**: Epic 12

## User Story

As a developer, I want a secure secrets backend with encrypted storage, lifecycle API, and audit integration, so that all modules can store and consume sensitive values safely.

## Acceptance Criteria

- [x] AC1: `secrets` PB collection created with all fields defined in Epic 19 Data Model; `payload_encrypted` excluded from all list/detail API responses via field visibility rule.
- [x] AC2: Application startup fails with fatal log if `APPOS_SECRET_KEY` env var is missing or not 32-byte base64.
- [x] AC3: Before-create hook generates masked `payload_meta` from plaintext, encrypts to `payload_encrypted` (AES-256-GCM), and removes plaintext `payload` from record before save.
- [x] AC4: Before-update hook rejects direct writes to `payload_encrypted`; payload updates must go through `PUT /api/secrets/:id/payload`.
- [x] AC5: PB collection access rules enforce base permission table: read/create = any auth user; update metadata = `created_by` or superuser; DELETE = superuser only.
- [x] AC6: `GET /api/secrets/templates` returns all templates from `backend/internal/secrets/templates.json`.
- [x] AC7: `PUT /api/secrets/:id/payload` re-encrypts with new plaintext, rebuilds `payload_meta`, increments `version`, emits `secret.payload_update` audit event.
- [x] AC8: `POST /api/secrets/resolve` returns plaintext only with `X-Appos-Internal: 1` header; returns 403 if header missing or `status=revoked`; updates `last_used_at` and `last_used_by` synchronously.
- [x] AC9: `GET /api/secrets/:id/reveal` returns plaintext only if `access_mode ≠ use_only` and caller is `created_by` or superuser; `reveal_once` atomically resets `access_mode` to `use_only` after first call.
- [x] AC10: PATCH `status=revoked` enforced to superuser only via update guard (PB rule + before-update hook); status transition emits `secret.revoke` audit event.
- [x] AC11: Audit events emitted via Epic 12 pipeline for: `secret.create`, `secret.update`, `secret.payload_update`, `secret.revoke`, `secret.use`, `secret.reveal`.

## Tasks / Subtasks

- [x] Task 1: Startup guard for `APPOS_SECRET_KEY`
  - [x] 1.1 Load and validate key in `backend/internal/secrets/config.go` at app init
  - [x] 1.2 Fatal log + exit if missing or invalid length
- [x] Task 2: Create `secrets` PB collection migration
  - [x] 2.1 All fields per Epic 19 data model
  - [x] 2.2 Field visibility: hide `payload_encrypted` from list/view rules
  - [x] 2.3 Access rules per Permission Rules table
- [x] Task 3: PB collection hooks in `backend/internal/secrets/hooks.go`
  - [x] 3.1 Before-create: extract plaintext `payload`, generate `payload_meta`, encrypt to `payload_encrypted`, remove plaintext
  - [x] 3.2 Before-update: reject direct `payload_encrypted` writes
  - [x] 3.3 After-create / after-delete: emit audit events
  - [x] 3.4 Before-update on `status` transition to `revoked`: superuser guard + audit emit
- [x] Task 4: Template loader in `backend/internal/secrets/templates.go`
  - [x] 4.1 Load `templates.json` at startup, fail fast if malformed
  - [x] 4.2 Expose `GET /api/secrets/templates` route
- [x] Task 5: Custom routes in `backend/internal/routes/secrets.go`
  - [x] 5.1 `PUT /api/secrets/:id/payload` — re-encrypt + rebuild meta + version + audit
  - [x] 5.2 `POST /api/secrets/resolve` — internal header guard + decrypt + update last_used_* + audit
  - [x] 5.3 `GET /api/secrets/:id/reveal` — access_mode check + atomic reveal_once reset + audit
  - [x] 5.4 Register secrets routes via centralized `routes.Register(se)` flow (`backend/internal/routes/routes.go`)

## Integration Notes

- Reuses Epic 12 audit writer and event schema; no new audit collection/table is introduced.
- Exposes APIs consumed by Story 19.2 (UI) and Story 19.3 (SecretRef Consumption).
- Follows custom route ownership baseline: all `/api/secrets/*` routes live under `backend/internal/routes/`.

## Dev Notes

- Encryption: AES-256-GCM; store `{nonce, ciphertext}` as base64 JSON in `payload_encrypted`.
- `payload` is a **virtual field**: it exists only in the create/update request body and is never persisted to the DB. The before-create hook reads it from the event record, processes it, then deletes it before save.
- `payload_meta` generation: for each field in the template with `sensitive: true`, mask value (e.g. `ad***`); for `sensitive: false` fields (e.g. endpoint URLs), store plaintext in meta directly.
- `resolve` is backend-to-backend only; never expose to frontend or OpenAPI docs.
- `reveal_once` reset must be atomic (update `access_mode` and return plaintext in the same DB transaction or with optimistic lock retry).

## File List

- `backend/internal/migrations/XXXXXXXXXX_create_secrets.go` — new
- `backend/internal/secrets/config.go` — new
- `backend/internal/secrets/crypto.go` — new (AES-256-GCM encrypt/decrypt; shared with Story 19.3)
- `backend/internal/secrets/hooks.go` — new
- `backend/internal/secrets/templates.go` — new
- `backend/internal/secrets/templates.json` — new
- `backend/internal/routes/secrets.go` — new
- `backend/cmd/appos/main.go` — updated (secrets bootstrap)
- `backend/internal/hooks/hooks.go` — updated (register secrets hooks)
- `backend/internal/routes/routes.go` — updated (register secrets routes)
- `backend/internal/routes/resources.go` — updated (legacy compatibility defaults)
- `backend/internal/routes/secrets_test.go` — new
- `backend/internal/migrations/1762300000_upgrade_secrets_for_epic19.go` — new
- `backend/internal/migrations/migrations_test.go` — updated

## Change Log

| Date | Change |
|------|--------|
| 2026-03-11 | Story created |
| 2026-03-11 | Implemented backend secrets core (migration/config/hooks/routes/templates) and added route/migration regression tests |

## Dev Agent Record

### Debug Log

- Implemented new `internal/secrets` package for key validation, AES-256-GCM payload crypto, template loading, and PB hooks.
- Added `/api/secrets/*` routes and wired startup initialization in `cmd/appos/main.go`.
- Added schema migration to upgrade existing `secrets` collection without breaking legacy consumers.

### Completion Notes

- Validation executed:
  - `cd backend && go test ./internal/migrations ./internal/routes`
  - `cd backend && go test ./...`
- All backend tests passed after migration/schema and route coverage fixes.
