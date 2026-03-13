# Story 22.1: Topics Backend

**Epic**: Epic 22 - Topics  
**Priority**: P2  
**Status**: Proposed  
**Depends on**: Epic 19

---

## Objective

Create the `topics` and `topic_comments` PocketBase collections via Go migration, configured with the correct field types, constraints, and access rules required by the Topics UI.

## Requirements

- Create `topics` collection with `title`, `body`, `created_by`, `created`, and `updated` fields.
- Create `topic_comments` collection with `topic_id`, `body`, `created_by`, `created`, and `updated` fields.
- Collections are created via Go migration (not the PB Admin UI) to ensure reproducibility across environments.
- `body` is stored as plain text (Markdown); no rich-text editor type is used.
- `created_by` is a Relation to `_pb_users_auth_`; the frontend must supply it explicitly at create time — PocketBase does not auto-set relation fields.
- Collection access rules: list and view are open to authenticated users; create requires authentication; update and delete are restricted to the record author.
- PocketBase superusers bypass all collection rules by default — no additional rule is needed for platform admin access.
- No custom Go routes are introduced.

## Table Structure

### `topics`

| Field | PB Type | Constraints |
|-------|---------|-------------|
| `title` | text | required |
| `body` | text | optional |
| `created_by` | relation → `_pb_users_auth_` | required |
| `created` | datetime | auto |
| `updated` | datetime | auto |

### `topic_comments`

| Field | PB Type | Constraints |
|-------|---------|-------------|
| `topic_id` | relation → `topics` | required, `CascadeDelete=true` |
| `body` | text | required |
| `created_by` | relation → `_pb_users_auth_` | required |
| `created` | datetime | auto |
| `updated` | datetime | auto |

Business constraint: deleting a `topics` record must cascade-delete all related `topic_comments`.

## Collection Rules

| Collection | listRule | viewRule | createRule | updateRule | deleteRule |
|------------|----------|----------|------------|------------|------------|
| `topics` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.id != ""` | `created_by = @request.auth.id` | `created_by = @request.auth.id` |
| `topic_comments` | `@request.auth.id != ""` | `@request.auth.id != ""` | `@request.auth.id != ""` | `created_by = @request.auth.id` | `created_by = @request.auth.id` |

## API Definition

Use PocketBase native record endpoints only:

| Operation | Method | Path |
|-----------|--------|------|
| Topic CRUD | `GET/POST/PATCH/DELETE` | `/api/collections/topics/records[/:id]` |
| Comment CRUD | `GET/POST/PATCH/DELETE` | `/api/collections/topic_comments/records[/:id]` |

Useful filters:

| Use case | Filter |
|----------|--------|
| Topics by a user | `filter=(created_by='<userId>')` |
| Comments for a topic | `filter=(topic_id='<topicId>')&sort=created` |
| Batch comments for multiple topics | `filter=(topic_id='a'\|\|topic_id='b'\|\|...)` |

Expand: `expand=created_by` resolves the author relation in one request.

## Acceptance Criteria

- `topics` collection exists with `title`, `body`, `created_by`, `created`, `updated` and the rules above.
- `topic_comments` collection exists with `topic_id`, `body`, `created_by`, `created`, `updated` and the rules above.
- Unauthenticated `GET /api/collections/topics/records` returns `401`.
- Authenticated user can `POST` a topic by supplying `created_by` explicitly.
- Authenticated user cannot `PATCH` or `DELETE` a topic authored by another user (returns `403`).
- Deleting a topic cascades to delete all its comments.
- Migration runs cleanly on a fresh `make redo` with no manual PB Admin UI steps.
