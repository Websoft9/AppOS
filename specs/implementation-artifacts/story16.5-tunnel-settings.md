# Story 16.5: Tunnel Settings

**Epic**: Epic 16 – SSH Tunnel: Local Server Management
**Status**: done | **Priority**: P1 | **Depends on**: Story 13.4, Story 16.1

---

## User Story

As a superuser, I can configure Tunnel settings in Settings, so that port-pool behavior is centrally managed instead of hidden in code defaults.

This story owns the Tunnel setting semantics, while delivery happens through the Epic 13 Settings Module.

---

## Acceptance Criteria

1. Tunnel settings are exposed as unified entry `tunnel-port-range` under `/api/settings/entries/tunnel-port-range`.
2. `/api/settings/schema` includes the Tunnel entry under the `workspace` section.
3. `tunnel/port_range` remains readable and writable with fallback defaults `start = 40000` and `end = 49999`.
4. Backend validation returns field errors when values are non-integers, outside TCP port bounds, `start >= end`, or include the Tunnel SSH listen port `2222`.
5. Dashboard Settings includes a minimal `Tunnel` section with `start` and `end`, save feedback, and inline validation errors via the shared schema-driven page.
6. UI copy states that changes affect future startup/allocation behavior only; no hot reload, no active session mutation.
7. Existing tunnel bootstrap remains the runtime consumer of these settings; this story does not change `tunnel_services`, desired forwards, or session lifecycle semantics.
8. Tests cover backend validation and frontend load/save behavior.

---

## Tasks / Subtasks

- [x] Backend
  - [x] Register `tunnel-port-range` in the unified settings catalog with `workspace` section metadata
  - [x] Keep fallback defaults and validation for `tunnel/port_range`, including rejection of port `2222`
  - [x] Reuse the existing `custom_settings` row and current tunnel startup read path

- [x] Frontend
  - [x] Extend shared settings helpers/types to include `tunnel-port-range`
  - [x] Add a minimal `Tunnel` section in the schema-driven Settings page
  - [x] Use unified entry load/save helpers for `tunnel-port-range`
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

- Registered unified settings entry `tunnel-port-range` and wired Tunnel configuration through the shared `/api/settings` surface.
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