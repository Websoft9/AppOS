# Epic 11: User Management

## Overview

**Platform user management** — list, create, edit, delete users, reset passwords, and self-service profile.

**Status**: Done | **Priority**: P2 | **Depends on**: Epic 3, Epic 7

---

## Design Philosophy: Leverage PocketBase, Add Nothing Extra

PocketBase provides the complete auth foundation. This epic builds mostly **UI** on top of what PB already gives us — no custom auth middleware, no custom role tables, no custom RBAC engine.

**Minimal custom Go code**: one ext route (admin password reset) + one `OnRecordDeleteRequest` hook (superuser deletion guards). Everything else is PB native.

---

## Role Model (Two-tier, PB-native)

PocketBase's dual-collection model is the RBAC system. No extra tables needed.

| Role | Collection | Capabilities |
|---|---|---|
| **Superuser** | `_superusers` | Full platform access; manages all users and settings; accesses PB Admin UI (`/_/`) |
| **Member** | `users` | Access to their own resources (files, apps they created); cannot manage other users |

**No custom role field needed.** `pb.authStore.record.collectionName` distinguishes the two at runtime.

**Multi-superuser**: Multiple superusers are fully supported by PocketBase. The setup page creates the first one; additional superusers are added here.

---

## Data Model

### `users` collection (PocketBase built-in, extend only)

```
users (PocketBase Auth Collection — built-in fields)
  ├── id           → auto
  ├── email        → unique, required
  ├── emailVisibility → bool (default false)
  ├── username     → optional (if enabled in auth method)
  ├── name         → display name (add this field)
  ├── avatar       → FileField, single image (add this field)
  ├── verified     → bool (PB built-in)
  ├── created      → auto
  └── updated      → auto
```

**No extra fields.** `_superusers` is managed as-is by PocketBase.

`name` and `avatar` fields are added to the `users` collection via a Go migration (same pattern as existing migrations in `backend/internal/migrations/`). Not manual Admin UI config.

---

## API

### PocketBase Native (zero custom code)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/collections/users/records` | Superuser | List all members |
| `POST` | `/api/collections/users/records` | Superuser | Create member |
| `PATCH` | `/api/collections/users/records/{id}` | Superuser or self | Edit member |
| `DELETE` | `/api/collections/users/records/{id}` | Superuser | Delete member |
| `GET` | `/api/collections/_superusers/records` | Superuser | List all superusers |
| `POST` | `/api/collections/_superusers/records` | Superuser | Create superuser |
| `PATCH` | `/api/collections/_superusers/records/{id}` | Superuser or self | Edit superuser |
| `DELETE` | `/api/collections/_superusers/records/{id}` | Superuser | Delete superuser |

**PB API rules** on `users`:
- List/View: `@request.auth.collectionName = "_superusers"` (superusers see all; members blocked)
- Create/Delete: `@request.auth.collectionName = "_superusers"`
- Update: `@request.auth.collectionName = "_superusers" || @request.auth.id = id` (self-edit allowed)

`_superusers` is PocketBase system collection — rules managed by PB; access is superuser-only by default.

### Custom Ext Route (one endpoint)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/ext/users/{collection}/{id}/reset-password` | Superuser | Admin sets a user's password directly |

Body: `{ "password": "newpass", "passwordConfirm": "newpass" }`.
Internally calls PB's `app.FindAuthRecordById()` + `record.SetPassword()` + `app.Save()`.
Works for both `users` and `_superusers` collections (collection in path: `users` or `_superusers`).

> Email-based password reset (self-service) is already handled by Epic 3.7. This route is for admin-forced reset without email.

---

## Story Decisions

### Story 11.1 — Users List
- Single entry point `/users` with two tabs (`users` / `_superusers`); no additional role system.
- List actions: Edit, Reset Password, Delete only — no analytics, compound filters, or bulk operations.
- → See [story11.1-users-list.md](story11.1-users-list.md)

### Story 11.2 — Create User
- Single "Add User" entry on `/users` rendered as a Sheet.
- Phase 1: no invitation flow; admin sets initial password directly to reduce dependencies.
- `verified` represents email-verified state only; does not enforce a forced password change on first login.
- → See [story11.2-create-user.md](story11.2-create-user.md)

### Story 11.3 — Edit & Admin Reset Password
- Edit and reset password are separate actions: edit uses PB native `PATCH`; admin reset uses a single ext route.
- One backend extension point only, scoped to "admin directly changes another user's password".
- Minimum safety floor: cannot delete self, cannot delete the last superuser.
- → See [story11.3-edit-reset-password.md](story11.3-edit-reset-password.md)

### Story 11.4 — Self Profile
- Profile page serves the current logged-in user only; no user directory concept introduced.
- Email change follows PB native flow (request change + confirmation email); no custom flow built.
- → See [story11.4-profile.md](story11.4-profile.md)

---

## Frontend Route Tree

```
/_app/_auth/
  profile.tsx          ← self-service profile (all users)

/_app/_auth/_superuser/   ← layout guard: superuser only
  users/
    index.tsx          ← user list (tabs: Members / Superusers); Edit Sheet is inline (state-driven, no separate route)
```

`_superuser.tsx` layout: checks `pb.authStore.record?.collectionName === '_superusers'`, else redirect to `/`.

---

## Superuser Safety Constraints (MVP)

Implemented as a single `OnRecordDeleteRequest` hook in Go (registered on the `_superusers` collection):
- Prevent deleting current logged-in superuser → abort with `cannot_delete_self`
- Prevent deleting the last remaining superuser → abort with `cannot_delete_last_superuser` (uses `CountRecords`, not `FindAllRecords`)

Frontend hides the Delete action on the current user's own row (UI-layer guard only; backend is the source of truth).

---

## Code Review Decisions

Post-implementation review applied the following cross-cutting improvements (details in each story):

- **Filter injection prevention**: Shared `escapeFilter()` utility in `dashboard/src/lib/auth-types.ts`; all PB filter queries use it
- **Shared types**: `AuthRecord` interface extracted to `dashboard/src/lib/auth-types.ts`; all user components import from there
- **Password min length**: CreateUserSheet and ResetPasswordDialog enforce ≥ 8 chars client-side
- **CountRecords over FindAllRecords**: Superuser count guard uses `app.CountRecords()` to avoid loading all records
- **SDK types**: Uses PocketBase SDK's `ListResult<T>` instead of custom `PBList` interface

---

## Out of Scope (Phase 1)

- Email-based invitation flow
- OAuth2 / SSO provider management (PB supports it; expose in Phase 2)
- Fine-grained permissions per resource (beyond superuser/member split)
- Audit log of user actions (covered by Epic 12)
- User groups / teams
