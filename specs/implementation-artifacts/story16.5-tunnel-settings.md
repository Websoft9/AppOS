# Story 16.5: Tunnel Settings

**Epic**: Epic 16 – SSH Tunnel: Local Server Management
**Status**: done | **Priority**: P1 | **Depends on**: Story 13.5, Story 13.6, Story 16.1

---

## User Story

As a superuser, I can configure Tunnel settings in Settings, so that port-pool behavior is centrally managed instead of hidden in code defaults.

---

## Acceptance Criteria

1. Tunnel settings are exposed through `/api/settings/tunnel`; do not add a workspace Tunnel settings path.
2. `tunnel/port_range` is readable and writable with fallback defaults `start = 40000` and `end = 49999`.
3. Backend validation returns field errors when values are non-integers, outside TCP port bounds, `start >= end`, or include the Tunnel SSH listen port `2222`.
4. Dashboard Settings includes a minimal `Tunnel` section with `start` and `end`, save feedback, and inline validation errors.
5. UI copy states that changes affect future startup/allocation behavior only; no hot reload, no active session mutation.
6. Existing tunnel bootstrap remains the runtime consumer of these settings; this story does not change `tunnel_services`, desired forwards, or session lifecycle semantics.
7. Tests cover backend validation and frontend load/save behavior.

---

## Tasks / Subtasks

- [x] Backend
  - [x] Add `tunnel/port_range` to the settings allowlist and fallback map in `backend/internal/routes/settings.go`
  - [x] Validate `start` and `end`, including rejection of port `2222`
  - [x] Reuse the existing `app_settings` row and current tunnel startup read path

- [x] Frontend
  - [x] Extend shared settings helpers/types to include `tunnel`
  - [x] Add a minimal `Tunnel` section in `dashboard/src/routes/_app/_auth/_superuser/settings.tsx`
  - [x] Use `GET/PATCH /api/settings/tunnel` with payload `{ port_range: { start, end } }`
  - [x] Show “future startup/allocation only” wording

- [x] Tests
  - [x] Add route tests for valid and invalid `tunnel/port_range`
  - [x] Add frontend tests for load/save path usage and validation handling

---

## Dev Notes

- Reuse existing seed: `backend/internal/migrations/1741500001_seed_tunnel_settings.go`
- Reuse existing runtime consumer: `backend/internal/routes/tunnel.go`
- Default constants remain in `backend/internal/tunnel/config.go`
- Scope is settings only; no hot reload, no forward-rule work, no session mutation

---

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

- `cd /data/dev/appos/backend && go test ./internal/routes -run 'TestSettings(Tunnel|Discover)|TestSecretsRevealDisabledByPolicy|TestSettingsSecretsPolicy'`
- `cd /data/dev/appos/dashboard && npm test -- --run src/routes/_app/_auth/_superuser/settings.test.tsx`

### Completion Notes List

- Added direct settings route `GET/PATCH /api/settings/tunnel` and wired discover output to return the direct URL.
- Added backend validation and fallback handling for `tunnel/port_range`, including rejection of ranges containing port `2222`.
- Added a minimal Tunnel section in the Settings page with inline validation and future-startup-only operator guidance.
- Added targeted backend and frontend tests, and synchronized checked-in OpenAPI docs.

### File List

- `backend/internal/routes/settings.go`
- `backend/internal/routes/settings_test.go`
- `dashboard/src/lib/settings-api.ts`
- `dashboard/src/routes/_app/_auth/_superuser/settings.tsx`
- `dashboard/src/routes/_app/_auth/_superuser/settings.test.tsx`
- `backend/docs/openapi/ext-api.yaml`
- `backend/docs/openapi/api.yaml`
- `backend/docs/openapi/group-matrix.yaml`
- `specs/implementation-artifacts/story16.5-tunnel-settings.md`