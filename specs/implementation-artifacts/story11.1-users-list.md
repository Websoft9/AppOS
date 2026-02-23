# Story 11.1: Users List (Superuser Console)

**Epic**: Epic 11 - User Management
**Priority**: P2
**Status**: done
**Depends on**: Epic 3 (auth), Epic 7 (dashboard foundation)

## User Story

As a superuser, I want to view all platform users (members and superusers) in one place, so I can manage them efficiently.

## Acceptance Criteria

- [x] AC1: `/users` route is only accessible to `_superusers`; members are redirected to `/`
- [x] AC2: Two tabs — **Members** (`users` collection) and **Superusers** (`_superusers` collection)
- [x] AC3: Each row shows avatar (initials fallback), name, email, verified status, created date, and action buttons (Edit · Reset Password · Delete)
- [x] AC4: Name/email search filters list via PB filter (`name ~ "{q}" || email ~ "{q}"`)
- [x] AC5: Pagination at 20/page with Previous/Next controls
- [x] AC6: Empty state shows a single "Add User" CTA
- [x] AC7: Delete action is hidden on the current logged-in superuser's own row

## Tasks / Subtasks

- [x] Task 1: Backend — `_superuser` layout guard
  - [x] 1.1 Create `dashboard/src/routes/_app/_auth/_superuser.tsx` layout that checks `pb.authStore.record?.collectionName === '_superusers'`, redirects to `/` otherwise
- [x] Task 2: Users list page
  - [x] 2.1 Create `dashboard/src/routes/_app/_auth/_superuser/users/index.tsx` with two-tab structure
  - [x] 2.2 Fetch Members from `/api/collections/users/records` with page/filter/sort params
  - [x] 2.3 Fetch Superusers from `/api/collections/_superusers/records` with page/filter/sort params
  - [x] 2.4 Render table columns: Avatar (initials fallback), Name/Email, Verified badge, Created, Actions
  - [x] 2.5 Implement search input with debounce; construct PB filter expression
  - [x] 2.6 Implement pagination (20/page)
  - [x] 2.7 Empty state with "Add User" CTA
  - [x] 2.8 Hide Delete button when `row.id === pb.authStore.record?.id`

## Dev Notes

- `_superuser.tsx` is a TanStack Router layout file (same pattern as `_auth.tsx`)
- Use `pb.authStore.record?.collectionName` to distinguish superuser vs member at runtime
- `_superusers` collection CRUD is available via PocketBase's native API with superuser-only access enforced by PB itself; no custom API rules needed here
- PB filter syntax for search: `name ~ "{q}" || email ~ "{q}"` (use `email ~ "{q}"` only for `_superusers` since it has no `name` field)
- Avatar: use `pb.files.getURL(record, record.avatar)` if avatar exists; otherwise render initials from name or email
- Follow existing patterns in `dashboard/src/routes/_app/_auth/files.tsx` for table layout and pagination

## Dev Agent Record

### Implementation Plan
Route guard pattern mirrors `_auth.tsx`. UsersTable is a self-contained component handling fetch/search/pagination/delete per collection.

### Completion Notes
All 7 ACs implemented and verified via `npm run build` (tsc + vite, 0 errors).

**Code review fixes**: Search filter uses `escapeFilter()` from shared `auth-types.ts` to prevent PB filter injection. `AuthRecord` / `PBList` replaced with shared type + SDK `ListResult<T>`. Reset Password button hidden for self. Sidebar Users nav item added (superuser-only, `useMemo`).

## File List

- `dashboard/src/routes/_app/_auth/_superuser.tsx` (new)
- `dashboard/src/routes/_app/_auth/_superuser/users/index.tsx` (new)
- `dashboard/src/lib/auth-types.ts` (new — shared AuthRecord + escapeFilter)
- `dashboard/src/components/layout/Sidebar.tsx` (modified — Users nav item)
- `dashboard/src/routeTree.gen.ts` (auto-updated by vite plugin)

## Change Log

| Date | Change |
|---|---|
| 2026-02-23 | Story created |
| 2026-02-23 | All tasks implemented; story done |
| 2026-02-24 | Code review fixes applied |
