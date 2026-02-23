# Story 11.4: Self Profile (All Auth Users)

**Epic**: Epic 11 - User Management
**Priority**: P2
**Status**: done
**Depends on**: Story 11.1

## User Story

As any authenticated user (member or superuser), I want to manage my own profile, so I can keep my account information current without relying on a superuser.

## Acceptance Criteria

- [x] AC1: `/profile` route is accessible to all authenticated users (both `users` and `_superusers`)
- [x] AC2: Profile section: can update name (users only) and avatar; data persists after page reload
- [x] AC3: Password section: can change own password with `oldPassword`, `password`, `passwordConfirm`; field-level errors shown on failure
- [x] AC4: Email section: triggers PB `requestEmailChange` flow; informational message shown after request sent

## Tasks / Subtasks

- [x] Task 1: Profile route
  - [x] 1.1 Create `dashboard/src/routes/_app/_auth/profile.tsx`
  - [x] 1.2 Three sections: Profile, Password, Email — rendered as separate cards/sections
- [x] Task 2: Profile section
  - [x] 2.1 Show current name and avatar
  - [x] 2.2 Name field only shown/editable for `users` (superusers have no `name` field)
  - [x] 2.3 Avatar upload; use `pb.files.getURL(record, record.avatar)` for display
  - [x] 2.4 PATCH own record via `pb.collection(collectionName).update(authId, data)`
- [x] Task 3: Password section
  - [x] 3.1 Fields: oldPassword, password, passwordConfirm
  - [x] 3.2 PATCH own record with password fields; map `oldPassword` validation error to field
  - [x] 3.3 Clear form + success message on success
- [x] Task 4: Email section
  - [x] 4.1 Show current email (read-only display)
  - [x] 4.2 Input for new email + "Request Change" button
  - [x] 4.3 Call `pb.collection(collectionName).requestEmailChange(newEmail)`; show informational success message

## Dev Notes

- `collectionName` = `pb.authStore.record?.collectionName` ('users' or '_superusers')
- `authId` = `pb.authStore.record?.id`
- Superusers have no `name` or `avatar` fields — hide those UI elements when `collectionName === '_superusers'`
- Avatar upload: multipart form via `pb.collection(...).update(id, formData)` where formData includes avatar file
- Email change: PB sends confirmation email; no extra backend code needed
- Route is under `_auth` (not `_superuser`), so all authenticated users reach it

## Dev Agent Record

### Completion Notes
All tasks complete. Used inline success/error messages (no external toast library needed — not available in this project). Avatar and name fields are hidden for `_superusers`. Go migration `1740500000_add_users_name_avatar.go` adds name and avatar fields to the `users` collection. Profile link added to UserMenu component.

**Code review fixes**: Avatar preview blob URL properly revoked before creating new one (prevents memory leak). Save Profile button hidden for superusers (no editable fields). Removed unnecessary `as string` type casts.

## File List

- `dashboard/src/routes/_app/_auth/profile.tsx` — new: self-profile page (3 sections)
- `dashboard/src/components/layout/UserMenu.tsx` — modified: added Profile menu item
- `backend/internal/migrations/1740500000_add_users_name_avatar.go` — new: migration adds name+avatar to users

## Change Log

| Date | Change |
|---|---|
| 2026-02-23 | Story created |
| 2026-02-23 | All tasks implemented; story done |
| 2026-02-24 | Code review fixes applied |
