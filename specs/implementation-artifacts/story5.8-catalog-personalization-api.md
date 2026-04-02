# Story 5.8: Catalog Personalization API

**Epic**: 5 - App Store | **Priority**: P1 | **Status**: Proposed | **Depends on**: Story 5.7

## Objective

Move favorites and notes behind canonical backend APIs so the browser stops depending directly on the persistence shape of `store_user_apps` and stops using toggle-only write semantics.

## Scope

- caller-scoped personalization list endpoint
- idempotent favorite write endpoint
- note create/update endpoint
- note delete endpoint
- integration of personalization into catalog read payloads

## Acceptance Criteria

- [ ] `GET /api/catalog/me/apps` returns the caller's catalog personalization state.
- [ ] `PUT /api/catalog/me/apps/{appKey}/favorite` sets the final favorite state explicitly instead of toggling server state blindly.
- [ ] `PUT /api/catalog/me/apps/{appKey}/note` creates or updates the caller's note for one app.
- [ ] `DELETE /api/catalog/me/apps/{appKey}/note` clears the caller's note.
- [ ] Personalization APIs are authenticated and strictly scoped to the caller.
- [ ] Catalog summary/detail responses include the caller's favorite state and note projection.
- [ ] The dashboard store page no longer writes directly to PocketBase `store_user_apps` for normal product behavior.

## Out of Scope

- recommendation engine
- recently viewed apps
- saved filter presets
- public or shared notes

## Tasks / Subtasks

- [ ] Task 1: Add `/api/catalog/me/*` route group
  - [ ] 1.1 Add personalization list endpoint
  - [ ] 1.2 Add idempotent favorite endpoint
  - [ ] 1.3 Add note write and clear endpoints
- [ ] Task 2: Add service logic over `store_user_apps`
  - [ ] 2.1 Resolve or create per-user app personalization record
  - [ ] 2.2 Enforce caller-only access
  - [ ] 2.3 Normalize null/empty note behavior
- [ ] Task 3: Integrate with catalog read projection
  - [ ] 3.1 Inject favorite state into list payloads
  - [ ] 3.2 Inject favorite state and note into detail payloads
- [ ] Task 4: Validation
  - [ ] 4.1 Backend auth and route tests
  - [ ] 4.2 Regression tests for write idempotency
  - [ ] 4.3 Dashboard store consumer switched to canonical personalization API

## Notes

- `store_user_apps` remains the persistence mechanism in MVP, but its shape is no longer the public product contract.
- Prefer request bodies like `{ "isFavorite": true }` and `{ "note": "..." }` over toggle-only semantics.