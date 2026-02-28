# Story 13.6: Ext Infra Settings — UI (Proxy / Docker / LLM)

**Epic**: Epic 13 - Settings Management
**Priority**: P2
**Status**: done
**Depends on**: Story 13.5 (backend seed + mask), Story 13.4 (settings page route + pattern)

## User Story

As a superuser,
I want Proxy, Docker, and LLM configuration cards on the Settings page,
so that I can configure infrastructure credentials without SSH access or code changes.

## Acceptance Criteria

- AC1: Three new cards appear in the "App Settings" section below Space Quota: "Proxy", "Docker", "LLM Providers".
- AC2: Each card loads current values from its respective `GET /api/ext/settings/{module}` on page mount.
- AC3: Password / API key fields display as `type="password"` and are pre-filled with `"***"` when a value is stored; submitting unchanged `"***"` preserves the existing secret.
- AC4: Docker Registries and LLM Providers show an editable list — each item as a row with delete button; "Add" button appends a new empty row; Save sends the entire list.
- AC5: Save calls `PATCH /api/ext/settings/{module}` with the full group object; success shows toast.
- AC6: API errors (`400`, `422`) shown as specific inline messages.

## Tasks / Subtasks

- [x] Task 1: Proxy card (AC1–AC3, AC5)
  - [x] 1.1 All fields implemented (httpProxy, httpsProxy, noProxy, username, password)
  - [x] 1.2 Password field pre-filled with `***` placeholder when stored value is masked
  - [x] 1.3 Save: PATCH /api/ext/settings/proxy

- [x] Task 2: Docker card (AC1–AC5)
  - [x] 2.1 Mirror sub-section with comma-separated inputs for mirrors and insecureRegistries
  - [x] 2.2 Registries list with Add/Delete buttons and password fields
  - [x] 2.3 Save both sub-sections as one PATCH

- [x] Task 3: LLM Providers card (AC1–AC5)
  - [x] 3.1 List of {name, endpoint, apiKey} rows with Add/Delete buttons
  - [x] 3.2 Save: PATCH /api/ext/settings/llm

## Dev Notes

### Masked field pattern (React)
Applies to all password/apiKey fields across Tasks 1–3. On load: pre-fill with `"***"`; on change: clear and track dirty state; on save: send `"***"` for untouched fields.

### Array list pattern
Use a `useFieldArray` from react-hook-form for registries and providers lists. Each row is an object in the array; Add appends `{}`, Delete removes by index.

### Docker mirror input
Comma-separated → array conversion:
```ts
// display: mirrors.join(', ')
// save:    mirrors: input.split(',').map(s => s.trim()).filter(Boolean)
```

### References
- Settings page file: [dashboard/src/routes/_app/_auth/_superuser/settings.tsx](dashboard/src/routes/_app/_auth/_superuser/settings.tsx)
- Ext UI pattern: [specs/implementation-artifacts/story13.4-ext-settings-ui.md](specs/implementation-artifacts/story13.4-ext-settings-ui.md)
- Backend mask/preserve: [specs/implementation-artifacts/story13.5-ext-infra-backend.md](specs/implementation-artifacts/story13.5-ext-infra-backend.md)
- Epic layout: [specs/implementation-artifacts/epic13-settings.md](specs/implementation-artifacts/epic13-settings.md) §Dashboard UI

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented in same file as Stories 13.3/13.4: settings.tsx
- Array list pattern uses useState (no useFieldArray — react-hook-form not installed)
- `tsc --noEmit` passes with 0 errors

### File List

- `dashboard/src/routes/_app/_auth/_superuser/settings.tsx` (modified)
