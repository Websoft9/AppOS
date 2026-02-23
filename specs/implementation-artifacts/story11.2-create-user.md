# Story 11.2: Create User (Member/Superuser)

**Epic**: Epic 11 - User Management
**Priority**: P2
**Status**: done
**Depends on**: Story 11.1

## User Story

As a superuser, I want to create new platform users (both members and superusers), so I can onboard people without needing direct database access.

## Acceptance Criteria

- [x] AC1: "Add User" button on the Users list page opens a Sheet
- [x] AC2: Sheet has a toggle/selector to choose between creating a Member or Superuser
- [x] AC3: Member form fields: email (required), name (optional), password + confirm (required)
- [x] AC4: Superuser form fields: email (required), password + confirm (required)
- [x] AC5: Duplicate email shows a field-level inline error
- [x] AC6: On success: Sheet closes, toast fires, list refreshes on the correct tab

## Tasks / Subtasks

- [x] Task 1: Create User Sheet component
  - [x] 1.1 Create `dashboard/src/components/users/CreateUserSheet.tsx`
  - [x] 1.2 Role selector (Member / Superuser) that switches the form fields shown
  - [x] 1.3 Member form: email, name (optional), password, passwordConfirm with validation
  - [x] 1.4 Superuser form: email, password, passwordConfirm with validation
  - [x] 1.5 Map PB 400 error response to field-level errors (especially duplicate email)
- [x] Task 2: Wire into Users list page
  - [x] 2.1 "Add User" button in list header + empty state CTA both open the Sheet
  - [x] 2.2 On Sheet success: close Sheet, show toast, invalidate/refetch list query for the active tab

## Dev Notes

- POST to `/api/collections/users/records` for Member; POST to `/api/collections/_superusers/records` for Superuser
- PB returns 400 with `data: { email: { code: "validation_not_unique", ... } }` on duplicate email — map this to field error
- No invitation/email flow in Phase 1 — admin sets password directly
- `verified` field: omit from form; defaults match PB collection defaults (false)
- Sheet pattern: follow `dashboard/src/components/` existing sheet components if any, or use shadcn Sheet + react-hook-form

## Dev Agent Record

### Implementation Plan
Role selector uses Tabs (Member / _superusers). PB 400 `data.data` field map handles duplicate email and other validation errors inline.

### Completion Notes
All 6 ACs implemented. Build passes (tsc + vite, 0 errors). After create success, parent increments `refreshKey` to retrigger fetch and switches tab to the created user's collection.

**Code review fixes**: Password minimum length (≥ 8) enforced client-side. Duplicate Member/Superuser form fields deduplicated into a single fields block with conditional Name field.

## File List

- `dashboard/src/components/users/CreateUserSheet.tsx` (new)
- `dashboard/src/routes/_app/_auth/_superuser/users/index.tsx` (updated — wired CreateUserSheet)

## Change Log

| Date | Change |
|---|---|
| 2026-02-23 | Story created |
| 2026-02-23 | All tasks implemented; story done |
| 2026-02-24 | Code review fixes applied |
