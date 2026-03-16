# Story 24.3: Frontend — Shared Envs UI

**Epic**: Epic 24 - Shared Envs  
**Priority**: P1  
**Status**: ready-for-dev  
**Depends on**: Story 24.1, Story 24.2

---

## Objective

Build the Shared Envs list and edit UI under the Resources section. Remove the old `EnvGroupsPage` component and `/resources/env-groups` route. Add an `env_sets` attachment field to the App config page.

## Acceptance Criteria

### Shared Envs list page (`/resources/shared-envs`)

- [ ] AC1: Page accessible at `/resources/shared-envs` and linked from the Resources sidebar and Resource Hub.
- [ ] AC2: Displays a table of env sets: `Name`, `Description`, `Var count`, `Actions` (Edit, Delete).
- [ ] AC3: `[+ Create]` button opens a create form (inline or sheet).
- [ ] AC4: Delete action shows a confirmation dialog before calling `DELETE /api/collections/env_sets/records/{id}`; child `env_set_vars` deletion is handled by PocketBase relation cascade.

### Env set detail / edit form

- [ ] AC5: Form fields: `name` (required), `description`.
- [ ] AC6: Inline `env_set_vars` row editor below the main fields. Each row shows: `key` text input, value type toggle (`Value` / `Secret`), and either a `value` text input or a `secret` select populated from `GET /api/collections/secrets/records`.
- [ ] AC7: `[+ Add variable]` appends a new empty row.
- [ ] AC8: Each row has a `[Delete]` icon that removes it immediately (or marks for deletion on save).
- [ ] AC9: On save: upsert the `env_sets` record first, then sync `env_set_vars` — delete removed rows, create/update remaining rows in sequence.
- [ ] AC10: Duplicate key within the same set (client-side check before save) shows an inline error on the duplicate key field.
- [ ] AC11: `is_secret=true` rows render the value field as a secret selector; `secret` field is required. `value` sent as empty string.

### App config page — env sets attachment

- [ ] AC12: App detail / config page has an `Shared Envs` section listing currently attached sets.
- [ ] AC13: User can add env sets via a multi-select picker (populated from `GET /api/collections/env_sets/records`).
- [ ] AC14: Attached sets are displayed in attachment order with a drag-to-reorder handle.
- [ ] AC15: Reordering or removing a set triggers `PATCH /api/collections/apps/records/{id}` with the updated `env_sets` array.

### Cleanup

- [ ] AC16: Old `EnvGroupsPage` component (`src/components/resources/EnvGroupsPage.tsx` or equivalent) is deleted.
- [ ] AC17: Old route file `src/routes/_app/_auth/resources/env-groups.tsx` (or equivalent) is deleted.
- [ ] AC18: Resource Hub no longer shows an `Env Groups` card; instead shows `Shared Envs` card linking to `/resources/shared-envs`.
- [ ] AC19: Resource Store sidebar `Env Groups` entry replaced with `Shared Envs` pointing to `/resources/shared-envs`.
- [ ] AC20: `routeTree.gen.ts` is regenerated and contains no `/resources/env-groups` route.

## Data Flow

```
Shared Envs list
  pb.collection('env_sets').getList()

Env set vars (per set)
  pb.collection('env_set_vars').getList(1, 200, { filter: `set='${id}'` })

Secret selector options
  pb.collection('secrets').getList(1, 200)   // name + id only

App attachment
  pb.collection('apps').update(appId, { env_sets: orderedIds })
```

## Implementation Notes

- Use `pb.collection('env_sets')` and `pb.collection('env_set_vars')` directly via PocketBase JS SDK. No custom API calls.
- The `env_set_vars` row editor is a local React state array; sync to backend only on save (same pattern as existing form pages).
- Drag-to-reorder on App config page can use `@dnd-kit/sortable` if already in the project, otherwise a simple up/down button pair is acceptable for MVP.
- Secret selector should show only `id` and `name`; do not display or request `payload_encrypted`.
- Env set deletion should call only parent delete API; do not implement extra child-delete loops in frontend.

## Dependencies

- Story 24.1 (collections must exist)
- Story 24.2 (API rules verified, expand confirmed working)
- Epic 19 (secrets collection available for secret selector)
