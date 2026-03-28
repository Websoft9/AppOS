# Story 19.4: Secrets Policy Settings

**Epic**: Epic 19 - Secrets Management
**Priority**: P3
**Status**: review
**Depends on**: Story 13.4, Epic 19 (Secrets)

## User Story

As an administrator,
I want a global secrets policy in Settings,
so that I can enforce reveal restrictions and default behaviors across all secrets.

## Settings Schema

```json
// module: "secrets", key: "policy"
{
  "revealDisabled": false,
  "defaultAccessMode": "use_only",
  "clipboardClearSeconds": 0
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `revealDisabled` | bool | `false` | Global kill-switch: reject all reveal requests regardless of per-secret `access_mode` |
| `defaultAccessMode` | string | `"use_only"` | Default `access_mode` for newly created secrets (`use_only` / `reveal_once` / `reveal_allowed`) |
| `clipboardClearSeconds` | int | `0` | Auto-clear clipboard N seconds after copy in RevealOverlay; `0` = disabled |

## Acceptance Criteria

- AC1: Unified settings catalog includes entry `secrets-policy`; seed migration inserts the default row.
- AC2: `GET /api/settings/entries/secrets-policy` returns the normalized policy entry.
- AC3: `PATCH /api/settings/entries/secrets-policy` validates: `defaultAccessMode` must be one of the three values; `clipboardClearSeconds ≥ 0`.
- AC4: `GET /api/secrets/:id/reveal` returns `403` with message when `revealDisabled == true`, regardless of per-secret `access_mode`.
- AC5: Secret creation applies `defaultAccessMode` from policy when client omits `access_mode`.
- AC6: Frontend hides Reveal button when `revealDisabled == true`.
- AC7: RevealOverlay auto-clears clipboard after `clipboardClearSeconds` (if > 0).

## Tasks / Subtasks

- [x] Task 1: Backend — settings plumbing
  - [x] 1.1 Register unified settings entry `secrets-policy`
  - [x] 1.2 Add `defaultSecretsPolicy` code-level fallback
  - [x] 1.3 Add validation in unified PATCH handler
  - [x] 1.4 Seed migration `1741200005_seed_secrets_policy.go`

- [x] Task 2: Backend — enforce revealDisabled
  - [x] 2.1 In `secrets.go` reveal handler, read `secrets/policy` and reject if `revealDisabled`
  - [x] 2.2 Return `403 { "message": "Secret reveal is disabled by administrator" }`

- [x] Task 3: Backend — default access_mode on create
  - [x] 3.1 In secrets hook `beforeCreate`, if `access_mode` empty, read policy and apply `defaultAccessMode`

- [x] Task 4: Frontend — Settings UI
  - [x] 4.1 Add Secrets section to Settings page with toggle + select + number input

- [x] Task 5: Frontend — Reveal behavior
  - [x] 5.1 Fetch `secrets/policy` and hide Reveal button when `revealDisabled`
  - [x] 5.2 Implement clipboard auto-clear timer in RevealOverlay

## Dev Notes

- Migration timestamp `1741200005` — after existing seeds.
- `clipboardClearSeconds` is frontend-only; backend stores the value but doesn't enforce it.
- `revealDisabled` is backend-enforced (defense in depth) + frontend hides UI.

## Dev Agent Record

### Agent Model Used
- GPT-5.4

### Debug Log References
- `cd /data/dev/appos/backend && go test ./internal/secrets -run 'TestApplyDefaultAccessMode' && go test ./internal/migrations -run 'TestSecretsPolicySeedExists' && go test ./internal/routes -run 'Test(SettingsSecretsPolicy|SecretsRevealDisabledByPolicy)'`
- `cd /data/dev/appos/dashboard && npm run typecheck && npm run test -- --run src/lib/secrets-policy.test.ts src/components/secrets/RevealOverlay.test.tsx`
- `cd /data/dev/appos/dashboard && npm run lint && npm run test`
- `cd /data/dev/appos/backend && go test ./...`

### Completion Notes List
- Added `secrets/policy` settings allowlist entry, fallback defaults, PATCH validation, and seed migration `1741200005`.
- Enforced `revealDisabled` in the reveal API before per-secret access-mode checks and returned the administrator-disabled message.
- Applied `defaultAccessMode` in the secrets create hook when `access_mode` is omitted; updated quick secret-create flows to omit `access_mode` so policy defaults take effect.
- Added a Secrets section in superuser Settings, wired Secrets page policy fetch/hide behavior, and implemented clipboard auto-clear in `RevealOverlay`.
- Added backend tests for settings/reveal/hook behavior and frontend tests for secrets policy helpers plus clipboard auto-clear.
- Story-specific tests pass. Full repo suites still include unrelated pre-existing failures: `dashboard/src/pages/components/ComponentsPage.test.tsx` expects the old grid class, and backend full `go test ./...` exits non-zero because of existing route-suite failures observed during validation.

### File List
- `backend/internal/migrations/1741200005_seed_secrets_policy.go`
- `backend/internal/migrations/migrations_test.go`
- `backend/internal/routes/secrets.go`
- `backend/internal/routes/settings.go`
- `backend/internal/routes/settings_test.go`
- `backend/internal/secrets/hooks.go`
- `backend/internal/secrets/hooks_test.go`
- `dashboard/src/components/secrets/RevealOverlay.test.tsx`
- `dashboard/src/components/secrets/RevealOverlay.tsx`
- `dashboard/src/lib/secrets-policy.test.ts`
- `dashboard/src/lib/secrets-policy.ts`
- `dashboard/src/routes/_app/_auth/_superuser/settings.tsx`
- `dashboard/src/routes/_app/_auth/certificates.tsx`
- `dashboard/src/routes/_app/_auth/resources/servers.tsx`
- `dashboard/src/routes/_app/_auth/secrets.tsx`
- `dashboard/src/routes/_app/_auth/shared-envs.tsx`