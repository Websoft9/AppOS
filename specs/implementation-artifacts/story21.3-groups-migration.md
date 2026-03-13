# Story 21.3: Groups Migration

**Epic**: Epic 21 - Groups  
**Priority**: P2  
**Status**: Proposed  
**Depends on**: Story 21.1

---

## Objective

Remove the historical `resource_groups` implementation and migrate any retained group relationships into the new Groups model.

## Requirements

- Remove `resource_groups` collection.
- Remove historical business-table `groups` relation fields.
- Remove legacy `/api/ext/resources/groups` routes.
- Transform retained historical group relationships into `group_items` records before old fields are dropped.
- Remove or replace legacy UI references to `resource_groups`.
- If there is no useful historical data to retain, explicit deletion without backfill is allowed.

## Table Structure Migration Definition

### Source (legacy)

- `resource_groups` collection (to be removed)
- Legacy business collection fields named `groups` (to be removed)

### Target (new)

- `groups`
- `group_items`

Mapping rules:
- Legacy group entity -> `groups` record
- Legacy object-group relation -> `group_items` record (`group_id`, `object_type`, `object_id`)
- Duplicate relations must be collapsed by target unique index (`group_id + object_type + object_id`)

## API and Route Migration Definition

- Remove legacy custom routes: `/api/ext/resources/groups/*`
- Keep and use PocketBase native endpoints:
	- `/api/collections/groups/records`
	- `/api/collections/group_items/records`
- No compatibility proxy layer is required after migration completion.

## Acceptance Criteria

- Historical `resource_groups` records are either migrated into `groups` or explicitly removed by a one-time migration step.
- Historical per-object group relations are transformed into `group_items` records before old schema fields are dropped.
- `resource_groups` collection no longer exists after migration.
- No business collection, including `servers`, carries a `groups` field after migration.
- All legacy `/api/ext/resources/groups` routes are removed.
- Existing UI references to `resource_groups` or legacy group APIs are removed or redirected to the new Groups surfaces.
- Migration is idempotent: rerunning it does not create duplicate `groups` or `group_items` records.

## Integration Notes

- This story should land after the new backend model in `story21.1-groups-backend.md` exists.
- Coordinate with `story21.2-groups-frontend.md` so the new Groups UI is available when legacy surfaces are removed.
- No backward-compatibility layer is required after migration completes.
- If retained historical data quality is poor, prefer deletion over carrying broken groups into the new model.
- Topic linkage (Epic 22) depends on stable post-migration `groups.id`; ensure migration does not regenerate ids after initial cutover.