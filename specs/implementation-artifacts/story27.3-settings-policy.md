# Story 27.3: Feeds Polling and Cleanup Policy

**Epic**: Epic 27 - Feeds  
**Priority**: P2  
**Status**: Proposed  
**Depends on**: Story 27.1, Story 27.2

## Objective

Replace per-source polling configuration with one platform-managed polling policy, add deterministic failure backoff, and enforce predictable feed-item retention with automatic trim after successful ingestion.

This story makes Feeds operationally safe on a single server without introducing a user-tuned settings surface.

## Product Decisions

- Per-source pull interval is removed from the product model.
- Feeds uses one platform-managed scheduled interval of `60 minutes`.
- No UI or API for feed polling interval configuration is introduced in this story.
- Automatic cleanup runs after every successful source poll.
- Feed item retention applies only to `origin_type = feed`.
- `bookmark` never participates in automatic or manual cleanup.
- `is_starred` is a reading preference only. It does not exempt a feed item from cleanup.
- Feed items are treated as re-fetchable cache, not permanent archive.

## Scope

In scope:

- remove per-source polling interval from backend contract and Feeds UI
- add scheduler state needed for failure backoff
- run lightweight retention trim after every successful source poll
- add one manual cleanup preview and execute flow for feed items
- expose enough cleanup summary data for operator confirmation

Out of scope:

- user-configurable feed settings page
- pinning feed items against retention
- bookmark cleanup or bookmark retention policy
- background cleanup job separate from poll success path

## Data Model Changes

### `feed_sources`

Remove:

| Field | Action | Reason |
| --- | --- | --- |
| `poll_interval_minutes` | remove | per-source interval is no longer supported |

Add:

| Field | Type | Constraints | Purpose |
| --- | --- | --- | --- |
| `failure_streak` | Number | required, integer, default `0`, min `0` | count consecutive scheduled or manual pull failures since last success |
| `next_poll_at` | DateTime | optional | next time the scheduler may attempt this source |

Retained source status fields:

- `last_fetched_at`
- `last_success_at`
- `last_error`
- `item_count`

### `feed_items`

No new fields are required.

Retention and cleanup apply only to rows where:

- `origin_type = feed`

Rows where `origin_type = bookmark` are always excluded.

## Platform Policy Constants

These values are backend-owned constants in this story, not persisted user settings:

- scheduled polling interval: `60m`
- failure backoff after 1st consecutive failure: `2h`
- failure backoff after 2nd consecutive failure: `6h`
- failure backoff after 3rd and later consecutive failures: `24h`
- per-source retained feed-item cap: `1,000`
- global retained feed-item cap: `30,000`

If a future story adds feed policy settings, it must preserve these values as the initial defaults and may not reopen per-source interval tuning.

## Scheduling Policy

### Due Rule

The platform polling job scans active sources serially.

A source is due when all of the following are true:

- `status = active`
- `next_poll_at` is empty, or `next_poll_at <= now`

Newly created active sources may leave `next_poll_at` empty so they are eligible on the next scheduler pass.

### Success Transition

On successful pull of one source:

- set `last_fetched_at = now`
- set `last_success_at = now`
- clear `last_error`
- set `failure_streak = 0`
- set `next_poll_at = now + 60m`
- refresh `item_count`
- run automatic cleanup for feed items

### Failure Transition

On failed pull of one source:

- set `last_fetched_at = now`
- preserve existing `last_success_at`
- set `last_error` to the normalized failure message
- increment `failure_streak` by `1`
- set `next_poll_at` according to failure backoff policy

Backoff mapping:

- streak `1` -> `now + 2h`
- streak `2` -> `now + 6h`
- streak `>= 3` -> `now + 24h`

### Manual Pull Now

Manual `Pull now` bypasses `next_poll_at` gating for the current request only.

After the attempt completes, it updates the same source state as any scheduled poll:

- success resets `failure_streak` and sets `next_poll_at = now + 60m`
- failure increments `failure_streak` and applies backoff

This keeps manual pulls truthful and prevents repeated failing sources from being hammered.

## Cleanup Policy

Automatic cleanup runs only after a source pull succeeds.

The cleanup sequence is:

1. refresh the pulled source `item_count`
2. trim that source's feed items down to the per-source cap of `1,000`
3. refresh that source `item_count` again if any rows were deleted
4. if total feed-item count still exceeds `30,000`, trim oldest feed items globally until total returns to cap
5. refresh `item_count` for any source affected by deletion if required by implementation path

This order keeps the common case cheap and limits the heavier global trim to times when it is actually needed.

### Cleanup Eligibility

Eligible for cleanup:

- `feed_items.origin_type = feed`

Not eligible for cleanup:

- `feed_items.origin_type = bookmark`

### Deletion Order

Deletion order must be stable and deterministic:

1. older `published_at` first
2. if `published_at` is null, older `created` first
3. if timestamps tie, lower record id first

The same ordering rule must be used for automatic cleanup preview, automatic cleanup execution, manual cleanup preview, and manual cleanup execution.

## Manual Cleanup Contract

Provide one explicit cleanup action for operators on the Feeds page.

The flow is preview first, execute second.

### Preview Endpoint

`POST /api/feeds/cleanup/preview`

Request body:

```json
{}
```

Response body:

```json
{
  "global_total_before": 31240,
  "global_cap": 30000,
  "global_delete_count": 240,
  "per_source_cap": 1000,
  "per_source_affected_count": 3,
  "per_source_delete_count": 160,
  "total_delete_count": 400,
  "sources": [
    {
      "source_id": "src_1",
      "source_name": "Example Feed",
      "current_count": 1140,
      "delete_count": 140,
      "retained_count": 1000
    }
  ]
}
```

The preview must be read-only and must not delete data.

### Execute Endpoint

`POST /api/feeds/cleanup`

Request body:

```json
{}
```

Response body:

```json
{
  "deleted_count": 400,
  "global_total_after": 30000,
  "per_source_affected_count": 3,
  "global_delete_count": 240,
  "per_source_delete_count": 160
}
```

Execution must apply the same eligibility and ordering rules as preview.

If preview would delete `0` rows, execute must succeed as a no-op and return `deleted_count = 0`.

## UI Contract

On the Feeds page:

- remove per-source poll interval editing and display
- keep source status visibility for `last_fetched_at`, `last_success_at`, `last_error`, and current item count
- provide one manual cleanup entry point for authenticated operators
- manual cleanup opens a confirmation dialog that first loads preview data
- confirmation dialog must show at least:
  - total items to delete
  - items deleted by per-source trim
  - items deleted by global trim
  - affected source count
  - per-source rows that exceed cap
- dialog confirm action calls execute endpoint
- after successful execution, refresh source summary and item list views

UI does not expose `failure_streak` or `next_poll_at` in MVP unless needed later for troubleshooting.

## Acceptance Criteria

- AC1: `feed_sources.poll_interval_minutes` is no longer used by backend scheduling logic and is removed from the Feeds UI contract.
- AC2: Active source scheduling is driven by `next_poll_at` rather than per-source interval.
- AC3: A successful pull resets `failure_streak` to `0`, clears `last_error`, and schedules the next poll for `60m` later.
- AC4: A failed pull increments `failure_streak` and sets `next_poll_at` using `2h`, `6h`, and `24h` backoff tiers.
- AC5: Manual `Pull now` bypasses schedule gating for that request, but still updates `failure_streak`, `last_error`, and `next_poll_at` using the same rules as scheduled pulls.
- AC6: After every successful source pull, the system trims that source's `origin_type = feed` items to at most `1,000` rows.
- AC7: After per-source trim, if total `origin_type = feed` rows still exceed `30,000`, the system trims the oldest eligible rows globally until count returns to `30,000`.
- AC8: `origin_type = bookmark` rows are never deleted by automatic cleanup or manual cleanup.
- AC9: Manual cleanup preview returns deterministic deletion counts without mutating data.
- AC10: Manual cleanup execution deletes exactly the rows implied by preview ordering rules, subject only to intervening data changes.
- AC11: Feeds UI no longer shows or edits per-source poll interval and exposes one manual cleanup confirmation flow.
- AC12: Route and domain tests cover backoff transitions, per-source trim, global trim, preview, execute, and bookmark exclusion.

## Tasks / Subtasks

- [ ] Task 1: Migrate source scheduling model
  - [ ] 1.1 Add `failure_streak` and `next_poll_at` to `feed_sources`
  - [ ] 1.2 Remove `poll_interval_minutes` from `feed_sources`
  - [ ] 1.3 Backfill existing active sources so `next_poll_at` is immediately eligible or computed from current state
- [ ] Task 2: Replace due logic and poll state transitions
  - [ ] 2.1 Update `feeds.Source` scheduling logic to use `next_poll_at`
  - [ ] 2.2 Add failure backoff helper
  - [ ] 2.3 Update scheduled and manual pull paths to share the same transition rules
- [ ] Task 3: Add cleanup domain service
  - [ ] 3.1 Compute cleanup preview summary without mutation
  - [ ] 3.2 Trim one source to cap using deterministic ordering
  - [ ] 3.3 Trim global feed items to cap using deterministic ordering
  - [ ] 3.4 Refresh affected source item counts after deletion
- [ ] Task 4: Wire cleanup into successful polling path
  - [ ] 4.1 Run source-local trim after successful ingest
  - [ ] 4.2 Run global trim only when total feed items exceed cap
  - [ ] 4.3 Keep cleanup failures observable without losing truthful poll result state
- [ ] Task 5: Add manual cleanup routes
  - [ ] 5.1 Add `POST /api/feeds/cleanup/preview`
  - [ ] 5.2 Add `POST /api/feeds/cleanup`
  - [ ] 5.3 Return summary fields required by confirmation UI
- [ ] Task 6: Update Feeds UI
  - [ ] 6.1 Remove poll interval display and editing
  - [ ] 6.2 Add manual cleanup dialog driven by preview then execute
  - [ ] 6.3 Refresh source and item queries after cleanup success
- [ ] Task 7: Add focused tests
  - [ ] 7.1 Source scheduling and backoff tests
  - [ ] 7.2 Cleanup ordering and cap-enforcement tests
  - [ ] 7.3 Route tests for preview and execute
  - [ ] 7.4 Frontend tests for cleanup dialog and removed interval UI

## Implementation Notes

- Keep this policy backend-owned. Do not introduce a settings page or saved system setting in this story.
- Reuse the existing platform-managed polling job from Story 27.2. This story changes its due logic and post-success behavior; it does not create one cron job per source.
- Prefer one cleanup service in `backend/domain/feeds` so scheduled cleanup and manual cleanup share the same candidate selection and ordering logic.
- Cleanup should operate on ids selected in one deterministic query path rather than ad hoc record iteration.
- If automatic cleanup succeeds after ingest, the poll is successful.
- If ingest succeeds but cleanup fails, the source fetch state should still remain truthful; return an observable error and record it in logs rather than rewriting the poll as fetch failure.
- Existing installs may require a transitional migration path if historical code still references `poll_interval_minutes`; backend reads must be migrated before field removal is relied on in production.

## File Targets

- `backend/infra/migrations/XXXXXXXXXX_feed_sources_schedule_policy.go` — new
- `backend/domain/feeds/source.go` — update
- `backend/domain/feeds/poller.go` — update
- `backend/domain/feeds/cleanup.go` — new
- `backend/domain/feeds/source_test.go` — update
- `backend/domain/feeds/poller_test.go` — update
- `backend/domain/feeds/cleanup_test.go` — new
- `backend/domain/routes/feeds.go` — update
- `backend/domain/routes/feeds_test.go` — update
- `web/src/routes/_app/_auth/feeds.tsx` — update
- `web/src/routes/_app/_auth/-feeds.test.tsx` — update
