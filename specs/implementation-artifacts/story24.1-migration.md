# Story 24.1: Migration — Shared Envs Collections

**Epic**: Epic 24 - Shared Envs  
**Priority**: P1  
**Status**: implemented

---

## Objective

Remove the old `env_groups` / `env_group_vars` collections that were part of the Resource Store (Epic 8), and replace them with standalone `env_sets` / `env_set_vars` PocketBase native collections. Add an ordered `env_sets` relation field to the `apps` collection.

Current boundary outcome:
- `env_sets` / `env_set_vars` now exist as standalone shared-env collections rather than Resource Store-owned collections.
- `apps.env_sets` is now the only attachment field for shared env consumption.
- This migration aligns Shared Envs with the current model as a reusable runtime configuration asset, not a `resource` submodule.

## Acceptance Criteria

- [ ] AC1: New migration file creates `env_sets` collection with fields: `name` (Text, required, unique), `description` (Text).
- [ ] AC2: New migration file creates `env_set_vars` collection with fields: `set` (Relation → env_sets, required), `key` (Text, required), `value` (Text), `is_secret` (Bool, default false), `secret` (Relation → secrets, optional).
- [ ] AC3: DB-level unique index on `(set, key)` in `env_set_vars` (no two rows in the same set may share a key).
- [ ] AC4: `apps` collection gains an `env_sets` Relation[] field (ordered list of → env_sets IDs). If a previous `env_groups` Relation[] field exists on `apps`, it is removed in this migration.
- [ ] AC5: Old migration files that created `env_groups` and `env_group_vars` are deleted or superseded; the old collections must not exist after migration runs.
- [ ] AC6: `env_sets` and `env_set_vars` are standalone collections — they have no dependency on `resource_groups` and no `groups` field.
- [ ] AC7: PocketBase API Rules set on both collections: `listRule` and `viewRule` require auth; `createRule`, `updateRule`, `deleteRule` require superuser.
- [ ] AC8: `secret` expand on `env_set_vars` is enabled (so frontend can expand secret name in a single request).
- [ ] AC9: This story is explicitly marked as breaking change for MVP; old `env_groups` / `env_group_vars` data is not migrated.
- [ ] AC10: Existing `apps.env_groups[]` attachment data is deprecated and removed with old field cleanup; no automatic transfer to `apps.env_sets[]`.
- [ ] AC11: Release notes/changelog entry states: "destructive change, new installs only" for Shared Envs rollout.
- [ ] AC12: Clean install path validation passes with only `env_sets` / `env_set_vars` / `apps.env_sets` in use.

## Implementation Notes

- Migration file naming convention: `{timestamp}_shared_envs.go` under `backend/infra/migrations/`.
- The old `env_groups`-related migration files should be deleted. If they created other collections as well, split the deletion carefully.
- `is_secret` and `value` are mutually exclusive at the application layer, not the DB layer. DB allows both to have values; validation is enforced in the frontend and any future backend logic.
- `apps.env_sets` order semantics: PocketBase Relation[] preserves insertion order. The frontend is responsible for sending the ordered array; the backend stores it as-is.
- Migration sequence (MVP destructive): create new collections/fields for Shared Envs -> remove old env-group collections/fields -> verify clean install behavior.
- No historical data backfill is performed in this phase.

## Dependencies

- Epic 1 (PocketBase setup, migration runner)
- Epic 3 (auth, superuser rules)
- Epic 19 (secrets collection must exist before `env_set_vars.secret` relation can reference it)
