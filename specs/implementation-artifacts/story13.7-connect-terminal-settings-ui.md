# Story 13.7: Connect Terminal Settings UI

**Epic**: Epic 13 - Settings Management
**Priority**: P2
**Status**: complete
**Depends on**: Story 13.1, Story 13.6

## User Story

As a superuser,
I want to configure Connect terminal behavior in Settings,
so that session policy is centrally managed and not scattered in feature pages.

## Scope

Add Connect settings card under App Settings:

- `Terminal 空闲连接时间` (`idleTimeoutSeconds`)
- `最大连接数量` (`maxConnections`)

## Acceptance Criteria

- AC1: Settings page shows a new `Connect` card with terminal group fields `idleTimeoutSeconds` and `maxConnections`.
- AC2: Data loads from `GET /api/settings/workspace/connect` with fallback defaults when group not found.
- AC3: Save uses `PATCH /api/settings/workspace/connect` with group payload `{ terminal: { idleTimeoutSeconds, maxConnections } }`.
- AC4: `maxConnections` default is `0` (unlimited).
- AC5: `idleTimeoutSeconds` validates as integer and must be `>= 60`.
- AC6: Save success shows toast and persists after page refresh.
- AC7: API validation errors (`400`, `422`) are shown inline.

## Tasks / Subtasks

- [x] Task 1: Backend settings group contract
  - [x] 1.1 Define/confirm `connect.terminal` schema in ext settings seed/default path
  - [x] 1.2 Ensure fallback default: `{ idleTimeoutSeconds: 1800, maxConnections: 0 }`

- [x] Task 2: Settings UI card
  - [x] 2.1 Add card and form fields in settings page
  - [x] 2.2 Add client-side validation for idle timeout
  - [x] 2.3 Submit and error handling

- [x] Task 3: Connect page integration
  - [x] 3.1 Read `maxConnections` to gate multi-tab behavior in Connect page (`0` = unlimited)
  - [x] 3.2 Read `idleTimeoutSeconds` for idle behavior display/logic hook

## Notes

- Functional implementation for multi-connection tabs remains in Epic 15.
- Settings ownership and persistence are in Epic 13.

## Proposed Follow-up Enhancements (Post-Review)

To support Epic 15 session continuity UX, consider extending connect settings with optional `session` group:

- `resumeTTLSeconds`: controls how long “resume last session” remains valid.
- `panelCacheMaxServers`: upper bound for retained per-server side-panel cache instances.
- `rememberSplitRatio`: enables persistence of Shell/Files(Docker) split ratio preference.

These items are backlog only and should not block current Story 13.7 completion.

## Dev Agent Record

### Completion Notes

- Added Connect Terminal settings card in superuser Settings page with fields `idleTimeoutSeconds` and `maxConnections`.
- Added client-side validation (`idleTimeoutSeconds >= 60`, `maxConnections >= 0`, integer semantics).
- Added save handler via `PATCH /api/settings/workspace/connect` and load fallback behavior.
- Integrated `maxConnections` runtime gate into Connect multi-tab connection flow (`0` means unlimited).
- Added backend settings contract support for `connect/terminal` (allowlist + fallback defaults + migration seed).
- Integrated `idleTimeoutSeconds` runtime idle-close hook in Connect page with fixed safe-exit flow.
- Added backend validation for `connect/terminal` and mapped `400/422` responses to inline field errors in Settings UI.

### File List

- `dashboard/src/routes/_app/_auth/_superuser/settings.tsx` (modified)
- `dashboard/src/lib/connect-api.ts` (modified)
- `dashboard/src/pages/connect/ConnectServerPage.tsx` (modified)
- `backend/internal/routes/settings.go` (modified)
- `backend/internal/migrations/1741700000_seed_connect_terminal_settings.go` (added)

### Change Log

- 2026-03-02: Implemented Story 13.7 Task 2 and Task 3.1.
- 2026-03-02: Completed Task 1 and Task 3.2; moved story to review.
- 2026-03-02: Completed AC7 with backend validation + inline API error display.
