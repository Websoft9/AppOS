# Story 27.1: Feed Source Registry

**Epic**: Epic 27 - Feeds  
**Priority**: P2  
**Status**: Proposed  
**Depends on**: Epic 21, Epic 22

## Objective

Create the minimal source registry for `Feeds` so operators can add, pause, archive, and inspect external RSS / Atom sources.

## Requirements

- Create `feed_sources` as the source registry collection.
- One source stores `name`, `url`, `format`, `status`, `poll_interval_minutes`, and `last_fetched_at`.
- `url` must be unique in business meaning.
- `format` is limited to `rss` or `atom`.
- `status` is limited to `active`, `paused`, or `archived`.
- Source management is product-facing and belongs to the `Feeds` subdomain, not to a generic settings page.
- MVP uses platform-managed polling only; user-defined scripts or arbitrary fetch logic are out of scope.
- Prefer PocketBase native collection APIs; do not introduce custom CRUD routes for source management.

## Table Structure

### `feed_sources`

| Field | Type | Constraints |
|-------|------|-------------|
| `name` | text | required |
| `url` | url | required, unique |
| `format` | text | required; `rss` \| `atom` |
| `status` | text | required; `active` \| `paused` \| `archived` |
| `poll_interval_minutes` | number | required, positive integer |
| `last_fetched_at` | datetime | optional |
| `created` | datetime | auto |
| `updated` | datetime | auto |

## API Definition

Use PocketBase native record endpoints only:

| Operation | Path |
|-----------|------|
| Feed source CRUD | `/api/collections/feed_sources/records` |

Rule baseline:
- `feed_sources` list/view: authenticated users
- `feed_sources` create/update/delete: superuser only in MVP

## Acceptance Criteria

- `feed_sources` exists with the fields above.
- Users with admin authority can create, pause, and archive sources.
- Duplicate source URLs are rejected.
- Archived sources remain queryable but are not polled.
- No custom `/api/ext/*` CRUD routes are introduced in this story.

## Tasks / Subtasks

- [ ] Task 1: Create `feed_sources` PocketBase migration
	- [ ] 1.1 Add `name`, `url`, `format`, `status`, `poll_interval_minutes`, `last_fetched_at`, `last_success_at`, `last_error`, `created`, `updated`
	- [ ] 1.2 Add unique index on `url`
	- [ ] 1.3 Set list/view rules to authenticated users and keep write operations superuser-only in MVP
- [ ] Task 2: Define backend source helpers in `domain/feeds`
	- [ ] 2.1 Add source record decoding with defensive field parsing
	- [ ] 2.2 Add due-check helper based on `poll_interval_minutes` and `last_fetched_at`
	- [ ] 2.3 Add source status update helper for success and failure cases
- [ ] Task 3: Add migration and collection regression tests
	- [ ] 3.1 Verify collection exists on fresh migration
	- [ ] 3.2 Verify duplicate `url` is rejected
	- [ ] 3.3 Verify paused and archived statuses remain valid stored values

## Integration Notes

- This story defines source identity only.
- Actual ingestion is handled by `story27.2-feed-item-ingestion-and-query.md`.
- Binding feed items to apps or topics is handled by `story27.3-judgment-and-binding.md`.
- Backend implementation direction is shared with `story27.2` in `story27.1-27.2-feeds-backend-technical-direction.md`.

## File Targets

- `backend/infra/migrations/XXXXXXXXXX_create_feed_sources.go` — new
- `backend/domain/feeds/source.go` — new
- `backend/domain/feeds/source_test.go` — new
- `backend/infra/migrations/migrations_test.go` — updated