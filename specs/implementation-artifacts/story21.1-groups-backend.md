# Story 21.1: Groups Backend

**Epic**: Epic 21 - Groups  
**Priority**: P2  
**Status**: Proposed  
**Depends on**: Epic 17, Epic 19

---

## Objective

Create the `groups` and `group_items` backend model, based on PocketBase native collections, and provide the CRUD/query contract required by the Groups UI and cross-module integration.

## Requirements

- Create `groups` collection with `name`, `description`, `created_by`, `created`, and `updated` fields.
- Create `group_items` collection with `group_id`, `object_type`, `object_id`, `created`, and `updated` fields.
- `object_type` is stored as plain `text`; backend does not enforce enum values.
- Valid `object_type` values and object mapping are defined in frontend shared constant `src/lib/object-types.ts`.
- The same `group_id + object_type + object_id` combination cannot be created twice.
- Group membership is presentation-only and must not affect authorization or runtime behavior.
- Business collections do not gain a `groups` field.
- Prefer PocketBase native collection APIs; do not introduce custom group CRUD routes.

## Table Structure

### `groups`

| Field | Type | Constraints |
|-------|------|-------------|
| `name` | text | required, unique via `AddIndex("idx_groups_name", true, "name", "")` |
| `description` | text | optional |
| `created_by` | text | optional, stores creator auth id |
| `created` | datetime | auto |
| `updated` | datetime | auto |

### `group_items`

| Field | Type | Constraints |
|-------|------|-------------|
| `group_id` | relation -> `groups` | required, `CascadeDelete=true` |
| `object_type` | text | required |
| `object_id` | text | required |
| `created` | datetime | auto |
| `updated` | datetime | auto |

Business constraints:
- `group_id + object_type + object_id` must be unique via `AddIndex("idx_group_items_unique", true, "group_id,object_type,object_id", "")`.
- Deleting a `groups` record must cascade-delete related `group_items` records.

## API Definition

Use PocketBase native records endpoints only:

| Operation | Path |
|-----------|------|
| Group CRUD | `/api/collections/groups/records` |
| Group item CRUD | `/api/collections/group_items/records` |

Recommended filters:
- Group items by group: `/api/collections/group_items/records?filter=(group_id='xxx')`
- Groups by object: `/api/collections/group_items/records?filter=(object_type='server'&&object_id='yyy')`

Rule baseline:
- `groups` list/view: authenticated users
- `groups` create/update/delete: superuser only
- `group_items` list/view: authenticated users
- `group_items` create/update/delete: superuser only

## Acceptance Criteria

- `groups` and `group_items` collections exist with the fields above.
- Group CRUD uses `/api/collections/groups/records`.
- Group item CRUD uses `/api/collections/group_items/records`.
- Duplicate `group_id + object_type + object_id` is rejected by unique index.
- Deleting a group cascades and removes related `group_items`.
- No custom `/api/ext/resources/groups` routes are introduced in this story.

## Integration Notes

- This story defines the backend contract consumed by `story21.2-groups-frontend.md`.
- Historical `resource_groups` cleanup and old schema migration are handled by `story21.3-groups-migration.md`.
- Topic/comment capability is out of scope for this story and handled by Epic 22 Topics.
- Object existence cleanup for historical stale links belongs to migration story, not this story.