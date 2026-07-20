# Story 27.2: Feed Ingestion Query

**Epic**: Epic 27 - Feeds  
**Priority**: P2  
**Status**: Proposed  
**Depends on**: Story 27.1, Epic 25

## Objective

Ingest RSS / Atom entries into normalized `feed_items` so operators can query external signals from one dedicated Feeds page.

## Requirements

- Create `feed_items` as the normalized item store.
- Each item belongs to one `feed_source`.
- Items store only the minimum signal payload: `title`, `link`, `published_at`, optional plain-text `summary`, extracted `keywords`, extracted `tags`, and `state`.
- The backend must dedupe source entries using stable source identity such as source item id or normalized link.
- Re-ingestion may refresh content fields, but must preserve existing operator-owned `state`.
- Query must support source, tag, keyword, state, and time filters.
- The first Feeds page must behave as a signal workbench, not as a full reader.
- Item click opens the original link; full article rendering is out of scope.
- Ingestion scheduling uses one platform-managed polling job that scans due active sources serially rather than one cron job per source.
- The Sources list may contain special workspace entries such as `Bookmark`; such entries are views only and must not be modeled as `feed_sources` records.

## Table Structure

### `feed_items`

| Field | Type | Constraints |
|-------|------|-------------|
| `source_id` | relation -> `feed_sources` | required, cascade delete |
| `external_id` | text | required |
| `title` | text | required |
| `link` | url | required |
| `published_at` | datetime | optional |
| `summary` | text | optional, plain text only |
| `keywords_json` | json | optional |
| `tags_json` | json | optional |
| `state` | text | required; `ingested` \| `reviewed` \| `dismissed` \| `bound` |
| `created` | datetime | auto |
| `updated` | datetime | auto |

Business constraint:
- `source_id + external_id` must be unique in business meaning.

## Query Contract

Use PocketBase native records endpoints for item read/query where practical:

| Operation | Path |
|-----------|------|
| Feed item list/query | `/api/collections/feed_items/records` |

Recommended filters:
- by source: `filter=(source_id='xxx')`
- by state: `filter=(state='ingested')`
- by time: `sort=-published_at`

If tag or keyword filtering requires a custom query shape later, that may be added in a follow-up story. It is not required to block the initial model.

## Acceptance Criteria

- `feed_items` exists with the fields above.
- System can ingest RSS / Atom entries from active sources.
- Duplicate source entries are not stored twice.
- Failure to fetch one source does not abort the whole polling pass.
- Users can list items on a dedicated Feeds page.
- Users can filter by source, state, and time in MVP.
- Tag and keyword values are extracted and stored in MVP, but filter UI or custom query support for them may follow once PocketBase native query limits are proven insufficient.
- Clicking an item opens the original source link, not an in-app reader.

## Tasks / Subtasks

- [ ] Task 1: Create `feed_items` PocketBase migration
	- [ ] 1.1 Add `source_id`, `external_id`, `title`, `link`, `published_at`, `summary`, `keywords_json`, `tags_json`, `state`, `created`, `updated`
	- [ ] 1.2 Add unique index on `source_id,external_id`
	- [ ] 1.3 Set authenticated read rules and keep write operations backend-owned in MVP
- [ ] Task 2: Add feed parsing and normalization service
	- [ ] 2.1 Fetch one source URL and parse RSS or Atom
	- [ ] 2.2 Normalize candidate item fields into one internal item shape
	- [ ] 2.3 Generate stable `external_id` from source item identity or normalized link
- [ ] Task 3: Add extraction and persistence logic
	- [ ] 3.1 Extract weak keywords from title and summary
	- [ ] 3.2 Map obvious terms into initial tags such as `release`, `security`, `breaking-change`, `maintenance`
	- [ ] 3.3 Insert or update items without clobbering existing operator-owned `state`
- [ ] Task 4: Add polling coordinator
	- [ ] 4.1 Register one platform-managed periodic polling job
	- [ ] 4.2 Scan active due sources serially
	- [ ] 4.3 Update `last_fetched_at`, `last_success_at`, and `last_error` per source
- [ ] Task 5: Add backend tests
	- [ ] 5.1 Verify one parser fixture produces normalized items
	- [ ] 5.2 Verify dedupe blocks duplicate `source_id + external_id`
	- [ ] 5.3 Verify existing item `state` survives re-ingestion
	- [ ] 5.4 Verify paused or archived sources are skipped by polling

## Integration Notes

- Poll cadence and fetch trigger read from `feed_sources`.
- Existing cron or background task infrastructure should be reused.
- AI-oriented source analysis is intentionally deferred to a future follow-up story.
- Feed backend remains in `backend/domain/feeds` with thin route and persistence call sites.
- If native records query proves too weak for tag or keyword filtering, add one thin read endpoint later rather than introducing it in MVP.
- If `Bookmark` is added later, it should reuse the Feeds page shell and item-centric reading model, while keeping manual saved-link entry separate from source polling behavior.

## File Targets

- `backend/infra/migrations/XXXXXXXXXX_create_feed_items.go` — new
- `backend/domain/feeds/parser.go` — new
- `backend/domain/feeds/normalize.go` — new
- `backend/domain/feeds/extract.go` — new
- `backend/domain/feeds/poller.go` — new
- `backend/domain/feeds/parser_test.go` — new
- `backend/domain/feeds/poller_test.go` — new
- `backend/cmd/appos/main.go` or platform cron registration target — updated
- `backend/infra/migrations/migrations_test.go` — updated