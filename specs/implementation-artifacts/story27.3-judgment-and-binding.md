# Story 27.3: Judgment and Binding

**Epic**: Epic 27 - Feeds  
**Priority**: P2  
**Status**: Proposed  
**Depends on**: Story 27.2, Epic 18, Epic 22

## Objective

Allow operators to judge whether one feed item matters and bind that item to local AppOS objects.

## Requirements

- Create `feed_judgments` as the decision record for one feed item in one target context.
- MVP target contexts are `app` and `topic` only.
- One `item_id + target_type + target_id` combination can exist at most once.
- Supported decisions are `relevant`, `ignore`, and `watch`.
- Optional short operator note is allowed.
- Binding a feed item to a topic does not create or replace topic discussion content automatically unless explicitly requested in a later story.
- Binding a feed item to an app does not trigger upgrade, alert, or remediation automatically.
- The UI must make judgment explicit and queryable from the Feeds page.

## Table Structure

### `feed_judgments`

| Field | Type | Constraints |
|-------|------|-------------|
| `item_id` | relation -> `feed_items` | required, cascade delete |
| `target_type` | text | required; `app` \| `topic` |
| `target_id` | text | required |
| `decision` | text | required; `relevant` \| `ignore` \| `watch` |
| `note` | text | optional |
| `created_by` | relation -> `_pb_users_auth_` | required |
| `created` | datetime | auto |
| `updated` | datetime | auto |

Business constraint:
- `item_id + target_type + target_id` must be unique in business meaning.

## API Definition

Use PocketBase native record endpoints only:

| Operation | Path |
|-----------|------|
| Feed judgment CRUD | `/api/collections/feed_judgments/records` |

Rule baseline:
- `feed_judgments` list/view: authenticated users
- `feed_judgments` create: authenticated users
- `feed_judgments` update/delete: author only in MVP

## Acceptance Criteria

- `feed_judgments` exists with the fields above.
- Users can mark one feed item as `relevant`, `ignore`, or `watch` for one app or one topic.
- Duplicate judgment records for the same `item_id + target_type + target_id` are rejected.
- Users can add an optional short note.
- Binding remains informational only and does not trigger side effects.
- Feed list or detail can surface the latest judgment state for the current user context.

## Integration Notes

- App target references align with Epic 18 lifecycle surfaces.
- Topic target references align with Epic 22 topic identity.
- Automation, notification, or incident escalation based on judgments is out of scope for MVP.