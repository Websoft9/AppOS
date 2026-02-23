# Story 11.3: Edit User & Admin Reset Password

**Epic**: Epic 11 - User Management
**Priority**: P2
**Status**: done
**Depends on**: Story 11.1

## User Story

As a superuser, I want to edit user details and reset any user's password directly, so I can manage accounts without relying on email flows.

## Acceptance Criteria

- [x] AC1: Edit action opens an inline Sheet with editable fields: name, email, emailVisibility; avatar upload for `users`
- [x] AC2: Changes saved via `PATCH /api/collections/{collection}/records/{id}`; list updates immediately
- [x] AC3: "Reset Password" action opens an AlertDialog prompting for new password + confirm
- [x] AC4: Reset Password calls `POST /api/ext/users/{collection}/{id}/reset-password`; target user's tokens are invalidated
- [x] AC5: Cannot delete self (backend returns `cannot_delete_self`; frontend shows error toast)
- [x] AC6: Cannot delete last superuser (backend returns `cannot_delete_last_superuser`; frontend shows error toast)
- [x] AC7: Delete success: row removed from list, success toast shown

## Tasks / Subtasks

- [x] Task 1: Backend — admin reset password ext route
  - [x] 1.1 Create `backend/internal/routes/users.go` with `registerUserRoutes(g)`
  - [x] 1.2 `POST /api/ext/users/{collection}/{id}/reset-password` — validate body, find record, `SetPassword`, save; require superuser auth
  - [x] 1.3 Register route in `backend/internal/routes/routes.go`
- [x] Task 2: Backend — superuser delete hook
  - [x] 2.1 Add `OnRecordDeleteRequest` hook in `backend/internal/hooks/hooks.go` scoped to `_superusers` collection
  - [x] 2.2 Guard 1: if `e.Auth.Id == e.Record.Id` → abort with `apis.NewBadRequestError("cannot_delete_self", nil)`
  - [x] 2.3 Guard 2: count remaining `_superusers` records; if count == 1 → abort with `apis.NewBadRequestError("cannot_delete_last_superuser", nil)`
- [x] Task 3: Frontend — Edit Sheet
  - [x] 3.1 Create `dashboard/src/components/users/EditUserSheet.tsx`
  - [x] 3.2 Fields: name (users only), email, emailVisibility toggle; avatar upload (users only)
  - [x] 3.3 PATCH on save; close Sheet and refetch list on success
- [x] Task 4: Frontend — Reset Password AlertDialog
  - [x] 4.1 Create `dashboard/src/components/users/ResetPasswordDialog.tsx`
  - [x] 4.2 Fields: password + confirm; calls ext route on confirm
  - [x] 4.3 Success toast on 200; error toast on 400/403
- [x] Task 5: Frontend — Delete with guard error handling
  - [x] 5.1 Existing delete button triggers AlertDialog confirm
  - [x] 5.2 On 400 response with `cannot_delete_self` or `cannot_delete_last_superuser` → error toast with readable message

## Dev Notes

- Backend route file: `backend/internal/routes/users.go`; register as `registerUserRoutes(g)` with `g.Bind(apis.RequireSuperuserAuth())`
- `app.FindRecordById(collection, id)` works for both `users` and `_superusers`; collection comes from path param
- Hook registration: add to `backend/internal/hooks/hooks.go` `Register()` function; hook fires before delete completes
- PB hook abort: `return e.Error(400, "cannot_delete_last_superuser", nil)` — maps to PB error envelope `{ code: 400, message: "...", data: {} }`
- For superuser count: use `app.CountRecords("_superusers")` (not `FindAllRecords` — avoids loading all records)
- Frontend: `pb.send(...)` for ext route; `pb.collection(...).delete(id)` for native delete

## Dev Agent Record

### Completion Notes
All backend and frontend tasks complete. Used `OnRecordDeleteRequest` (not `OnRecordDelete`) for the superuser guard hook since only request events carry `.Auth`. Frontend wires EditUserSheet and ResetPasswordDialog as inline state-driven overlays inside UsersTable. Build passes with 0 errors.

**Code review fixes**: Superuser count guard uses `CountRecords()` instead of `FindAllRecords()` for performance. ResetPasswordDialog enforces password ≥ 8 chars client-side. EditUserSheet always sends `name` for members (allows clearing). `AuthRecord` imported from shared `auth-types.ts`.

## File List

- `backend/internal/routes/users.go` — new: admin reset password ext route
- `backend/internal/routes/routes.go` — modified: registered `registerUserRoutes(g)`
- `backend/internal/hooks/hooks.go` — modified: added superuser delete guard hooks
- `dashboard/src/components/users/EditUserSheet.tsx` — new: edit user Sheet component
- `dashboard/src/components/users/ResetPasswordDialog.tsx` — new: reset password Dialog component
- `dashboard/src/routes/_app/_auth/_superuser/users/index.tsx` — modified: wired Edit/Reset buttons and overlay components

## Change Log

| Date | Change |
|---|---|
| 2026-02-23 | Story created |
| 2026-02-23 | All tasks implemented; story done |
| 2026-02-24 | Code review fixes applied |
