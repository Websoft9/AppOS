# Story 13.8: Secrets Policy Settings

**Epic**: Epic 13 - Settings Management
**Priority**: P3
**Status**: not-started
**Depends on**: Story 13.1, Epic 19 (Secrets)

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

- AC1: `secrets/policy` added to allowlist; seed migration inserts default row.
- AC2: `GET /api/settings/workspace/secrets` returns `policy` group.
- AC3: `PATCH /api/settings/workspace/secrets` validates: `defaultAccessMode` must be one of the three values; `clipboardClearSeconds ≥ 0`.
- AC4: `GET /api/secrets/:id/reveal` returns `403` with message when `revealDisabled == true`, regardless of per-secret `access_mode`.
- AC5: Secret creation applies `defaultAccessMode` from policy when client omits `access_mode`.
- AC6: Frontend hides Reveal button when `revealDisabled == true`.
- AC7: RevealOverlay auto-clears clipboard after `clipboardClearSeconds` (if > 0).

## Tasks / Subtasks

- [ ] Task 1: Backend — settings plumbing
  - [ ] 1.1 Add `"secrets": {"policy"}` to `allowedModuleKeys` in `routes/settings.go`
  - [ ] 1.2 Add `defaultSecretsPolicy` code-level fallback
  - [ ] 1.3 Add validation in PATCH handler
  - [ ] 1.4 Seed migration `1741200005_seed_secrets_policy.go`

- [ ] Task 2: Backend — enforce revealDisabled
  - [ ] 2.1 In `secrets.go` reveal handler, read `secrets/policy` and reject if `revealDisabled`
  - [ ] 2.2 Return `403 { "message": "Secret reveal is disabled by administrator" }`

- [ ] Task 3: Backend — default access_mode on create
  - [ ] 3.1 In secrets hook `beforeCreate`, if `access_mode` empty, read policy and apply `defaultAccessMode`

- [ ] Task 4: Frontend — Settings UI
  - [ ] 4.1 Add Secrets section to Settings page with toggle + select + number input

- [ ] Task 5: Frontend — Reveal behavior
  - [ ] 5.1 Fetch `secrets/policy` and hide Reveal button when `revealDisabled`
  - [ ] 5.2 Implement clipboard auto-clear timer in RevealOverlay

## Dev Notes

- Migration timestamp `1741200005` — after existing seeds.
- `clipboardClearSeconds` is frontend-only; backend stores the value but doesn't enforce it.
- `revealDisabled` is backend-enforced (defense in depth) + frontend hides UI.

## Dev Agent Record

### Agent Model Used
### Debug Log References
### Completion Notes List
### File List
