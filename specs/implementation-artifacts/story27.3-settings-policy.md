# Story 27.3: Feeds Polling and Cleanup Policy

**Epic**: Epic 27 - Feeds  
**Priority**: P2  
**Status**: Proposed  
**Depends on**: Story 27.1, Story 27.2

## Objective

Replace per-source polling configuration with one platform-managed polling policy, add deterministic failure backoff, and enforce predictable feed-item retention with automatic trim after successful ingestion.

This story makes Feeds operationally safe on a single server without introducing a user-tuned settings surface.

## Final Definition

- Retention trim is a system behavior, not a manual operator action.
- The system should enforce retention automatically after successful polling and through one system-level scheduled retention sweep as a fallback path.
- One scheduled retention sweep must enforce both per-source caps and the global cap in the same run.
- Manual operations are delete actions initiated by operators, not policy enforcement.
- Manual delete may reuse the same oldest-first ordering rule as retention trim, but it remains a separate product behavior.
- Source-level manual delete uses quantity selection in a confirmation dialog.
- Global manual delete lives in Settings as a danger-zone action named `Delete All Articles` and also uses quantity selection in a confirmation dialog.

## Product Decisions

- Per-source pull interval is removed from the product model.
- Feeds uses one platform-managed scheduled interval of `60 minutes`.
- No UI or API for feed polling interval configuration is introduced in this story.
- Automatic cleanup runs after every successful source poll.
- A system-level scheduled retention task exists as a fallback sweep.
- Feed item retention applies only to `origin_type = feed`.
- `bookmark` never participates in automatic or manual cleanup.
- `is_starred` is a reading preference only. It does not exempt a feed item from cleanup.
- Feed items are treated as re-fetchable cache, not permanent archive.

## Scope

In scope:

- remove per-source polling interval from backend contract and Feeds UI
- add scheduler state needed for failure backoff
- run lightweight retention trim after every successful source poll
- add one system-level scheduled retention sweep as a fallback path
- add source-level manual delete with quantity selection
- add one Settings danger-zone global delete action with quantity selection

Out of scope:

- user-configurable feed settings page
- pinning feed items against retention
- bookmark cleanup or bookmark retention policy

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

System fallback cleanup runs as one system-level scheduled sweep.

The cleanup sequence is:

1. refresh the pulled source `item_count`
2. trim that source's feed items down to the per-source cap of `1,000`
3. refresh that source `item_count` again if any rows were deleted
4. if total feed-item count still exceeds `30,000`, trim oldest feed items globally until total returns to cap
5. refresh `item_count` for any source affected by deletion if required by implementation path

This order keeps the common case cheap and limits the heavier global trim to times when it is actually needed.

### Scheduled Retention Sweep

The scheduled retention task is a system behavior, not a user action.

One sweep must:

1. iterate all eligible feed sources and enforce the per-source cap
2. refresh affected source counts
3. enforce the global cap across all `origin_type = feed` rows
4. leave `bookmark` rows untouched

The sweep must use the same eligibility and oldest-first ordering rules as pull-triggered retention trim.

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

The same ordering rule must be used for pull-triggered retention trim, scheduled retention sweep, source delete, and global delete.

## Manual Delete Contract

Manual delete is operator-driven and separate from retention enforcement.

### Source Delete

In one source article list view:

- provide one delete action for that source's articles
- open a confirmation dialog with quantity selection
- default quantity equals the current article count for that source
- quantity input must support stepper-style increase/decrease and direct numeric input
- if quantity is smaller than the current count, delete the oldest eligible articles first
- the action icon should use a clear/eraser-style icon rather than a trash icon

### Global Delete

In Settings:

- provide one danger-zone action named `Delete All Articles`
- open a confirmation dialog with quantity selection
- default quantity equals the current total feed-article count
- quantity input must support stepper-style increase/decrease and direct numeric input
- if quantity is smaller than the current total, delete the oldest eligible articles first
- `bookmark` rows are never eligible

## UI Contract

On the Feeds page:

- remove per-source poll interval editing and display
- keep source status visibility for `last_fetched_at`, `last_success_at`, `last_error`, and current item count
- provide one source-level manual delete entry point for authenticated operators when a concrete source is selected
- source delete uses a quantity confirmation dialog with default count, stepper controls, and direct numeric input
- source delete action uses a clear/eraser-style icon
- after successful source delete, refresh source summary and item list views

In Settings:

- provide one `Delete All Articles` danger-zone action
- global delete uses a quantity confirmation dialog with default count, stepper controls, and direct numeric input
- after successful global delete, refresh source summary and item list views

UI does not expose `failure_streak` or `next_poll_at` in MVP unless needed later for troubleshooting.

## Acceptance Criteria

- AC1: `feed_sources.poll_interval_minutes` is no longer used by backend scheduling logic and is removed from the Feeds UI contract.
- AC2: Active source scheduling is driven by `next_poll_at` rather than per-source interval.
- AC3: A successful pull resets `failure_streak` to `0`, clears `last_error`, and schedules the next poll for `60m` later.
- AC4: A failed pull increments `failure_streak` and sets `next_poll_at` using `2h`, `6h`, and `24h` backoff tiers.
- AC5: Manual `Pull now` bypasses schedule gating for that request, but still updates `failure_streak`, `last_error`, and `next_poll_at` using the same rules as scheduled pulls.
- AC6: After every successful source pull, the system trims that source's `origin_type = feed` items to at most `1,000` rows.
- AC7: After per-source trim, if total `origin_type = feed` rows still exceed `30,000`, the system trims the oldest eligible rows globally until count returns to `30,000`.
- AC8: The system-level scheduled retention task sweeps all eligible sources for per-source caps and then enforces the global cap in the same run.
- AC9: `origin_type = bookmark` rows are never deleted by automatic trim, scheduled retention sweep, source delete, or global delete.
- AC10: Source delete defaults to the current source article count, supports quantity editing, and deletes oldest eligible rows first when quantity is smaller than the total.
- AC11: Settings exposes one `Delete All Articles` danger-zone action that defaults to the current total feed-article count, supports quantity editing, and deletes oldest eligible rows first when quantity is smaller than the total.
- AC12: Feeds UI no longer shows or edits per-source poll interval and exposes source-level delete through a confirmation dialog with quantity controls.
- AC13: Route and domain tests cover backoff transitions, pull-triggered trim, scheduled retention sweep, source delete, global delete, and bookmark exclusion.

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
- [ ] Task 5: Add system-level scheduled retention sweep
  - [ ] 5.1 Register one system cron task for feed retention sweep
  - [ ] 5.2 Sweep all eligible sources for per-source cap enforcement
  - [ ] 5.3 Enforce the global cap in the same run
- [ ] Task 6: Add manual delete routes
  - [ ] 6.1 Add source-level delete with quantity input
  - [ ] 6.2 Add global delete with quantity input
  - [ ] 6.3 Reuse deterministic oldest-first selection logic
- [ ] Task 7: Update Feeds UI and Settings UI
  - [ ] 7.1 Remove poll interval display and editing
  - [ ] 7.2 Add source delete dialog with quantity controls and clear/eraser icon
  - [ ] 7.3 Add `Delete All Articles` danger-zone action in Settings
  - [ ] 7.4 Refresh source and item queries after delete success
- [ ] Task 8: Add focused tests
  - [ ] 8.1 Source scheduling and backoff tests
  - [ ] 8.2 Cleanup ordering and cap-enforcement tests
  - [ ] 8.3 Scheduled retention sweep tests
  - [ ] 8.4 Route tests for source delete and global delete
  - [ ] 8.5 Frontend tests for source delete dialog, Settings danger zone, and removed interval UI

## Implementation Notes

- Keep this policy backend-owned. Do not introduce a settings page or saved system setting in this story.
- Reuse the existing platform-managed polling job from Story 27.2. This story changes its due logic and post-success behavior; it does not create one cron job per source.
- Prefer one cleanup service in `backend/domain/feeds` so pull-triggered trim, scheduled retention sweep, source delete, and global delete share the same candidate selection and ordering logic.
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
