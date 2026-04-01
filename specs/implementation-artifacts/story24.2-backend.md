# Story 24.2: Backend — Shared Envs

**Epic**: Epic 24 - Shared Envs  
**Priority**: P1  
**Status**: ready-for-dev  
**Depends on**: Story 24.1

---

## Objective

Verify that PocketBase native Records API fully serves all Shared Envs CRUD needs. Remove any existing custom ext route code for `env_groups` from the Resource Store route file. No new custom routes are added.

## Acceptance Criteria

- [ ] AC1: All custom route handlers for `env_groups` in `backend/domain/routes/resources.go` (or equivalent) are deleted.
- [ ] AC2: `GET /api/collections/env_sets/records` returns a list of env sets for authenticated users.
- [ ] AC3: `POST /api/collections/env_sets/records` creates an env set; superuser only.
- [ ] AC4: `PATCH /api/collections/env_sets/records/{id}` updates an env set; superuser only.
- [ ] AC5: `DELETE /api/collections/env_sets/records/{id}` deletes an env set; superuser only.
- [ ] AC6: `GET /api/collections/env_set_vars/records?filter=set='{id}'` returns all vars for a given set; authenticated users.
- [ ] AC7: `POST /api/collections/env_set_vars/records` creates a var row; superuser only.
- [ ] AC8: `PATCH /api/collections/env_set_vars/records/{id}` updates a var row; superuser only.
- [ ] AC9: `DELETE /api/collections/env_set_vars/records/{id}` deletes a var row; superuser only.
- [ ] AC10: `GET /api/collections/env_set_vars/records/{id}?expand=secret` returns the var with the referenced secret record expanded (name only, value masked).
- [ ] AC11: `GET /api/collections/apps/records/{id}?expand=env_sets` returns the app with all attached env set records expanded.
- [ ] AC12: Attempting to create a duplicate key within the same set (same `set` + `key`) returns a DB-level error surfaced as a `400` response.
- [ ] AC13: Automated backend test asserts `expand=secret` response includes only allowed fields (`id`, `name`, `template_id`) and does not include `payload_encrypted`.

## API Reference

All via PocketBase native Records API. No custom routes.

```
GET    /api/collections/env_sets/records
POST   /api/collections/env_sets/records
GET    /api/collections/env_sets/records/{id}
PATCH  /api/collections/env_sets/records/{id}
DELETE /api/collections/env_sets/records/{id}

GET    /api/collections/env_set_vars/records?filter=set='{id}'
POST   /api/collections/env_set_vars/records
GET    /api/collections/env_set_vars/records/{id}?expand=secret
PATCH  /api/collections/env_set_vars/records/{id}
DELETE /api/collections/env_set_vars/records/{id}

GET    /api/collections/apps/records/{id}?expand=env_sets
PATCH  /api/collections/apps/records/{id}   (update env_sets ordered list)
```

## Implementation Notes

- This story is primarily a removal story: delete `env_groups` custom routes, verify PB native API rules are correctly set via migration (Story 24.1).
- No Go handler code to write. Focus is on confirming the rules work and the expand configs are correct.
- If `resources.go` registers an `/env-groups` route group, remove it entirely. Ensure no 404 fallback or leftover registration remains.
- Secret expand on `env_set_vars`: the expanded `secret` record should only surface `id`, `name`, `template_id` — never `payload_encrypted`. This is enforced by PocketBase ViewRule on the `secrets` collection (Epic 19).
- Contract test should fail fast if a future schema change accidentally exposes encrypted payload fields.

## Dependencies

- Story 24.1 (collections and rules must exist)
- Epic 19 (secrets ViewRule must mask payload)
