# Story 22.2: Topics Frontend

**Epic**: Epic 22 - Topics  
**Priority**: P2  
**Status**: Proposed  
**Depends on**: Story 22.1, Epic 7

---

## Objective

Implement the Topics list page, Topic detail page, create/edit form, and commenting UI — all driven by PocketBase native SDK calls against the `topics` and `topic_comments` collections.

## Requirements

- Add `Collaboration > Topics` navigation entry.
- Implement Topics list page at route `/topics`.
- Implement Topic detail page at route `/topics/$id`.
- Topics list shows: title, author, last updated time, comment count.
- Topic detail shows: title, body (Markdown rendered), author, timestamps, comments, add-comment form.
- Create/edit form fields: `title` (required), `body` (optional Markdown textarea).
- Topic delete requires a confirmation dialog.
- Comment add and delete from detail view.
- All data via PocketBase native SDK (no custom routes).
- `body` is stored as plain Markdown and rendered with `react-markdown`. Do **not** use `dangerouslySetInnerHTML`.
- `created_by` must be set explicitly on create: `created_by: pb.authStore.record?.id`.
- Comment count on the list page uses a batch filter query (one request for all visible topics), not a per-row individual request.
- Regular users may only edit/delete their own records. No admin-specific UI is required for MVP.

## Navigation

- `Collaboration` is a sidebar visual grouping label only — not a route segment, not a page, and does not appear in breadcrumbs.
- In `Sidebar.tsx`, add `Topics` as a child under the existing `Collaboration` group (alongside `Groups`).
- Routes: `/topics` (list) and `/topics/$id` (detail).
- Route files: `_app/_auth/topics.index.tsx` and `_app/_auth/topics.$id.tsx`.
- Breadcrumb on list page: `Topics`. Breadcrumb on detail page: `Topics / <title>`.

## UI Layout

### Topics List Page

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Topics                                                    [ New Topic ]     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Topics                                                                      │
│ Capture shared context, decisions, and discussion threads for your team.   │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ Search title...                ]                                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ Title              Author         Updated       Comments   Actions           │
│──────────────────────────────────────────────────────────────────────────────│
│ Deployment plan    alice          2026-03-12    4          [Edit] [Delete]  │
│ DB migration Q2    bob            2026-03-10    1          [Edit] [Delete]  │
│ Incident 2026-03   alice          2026-03-08    9          [Edit] [Delete]  │
└──────────────────────────────────────────────────────────────────────────────┘

Empty state:

┌──────────────────────────────────────────────────────────────────────────────┐
│ No topics yet                                                               │
│ Create the first Topic to start capturing shared context for your team.    │
│                                                    [ New Topic ]            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Topic Detail Page

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Topics / Deployment plan                          [ Edit ] [ Delete ]       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Deployment plan                                                             │
│ alice · Created 2026-03-12 · Updated 2026-03-12                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ [rendered Markdown body]                                                    │
│                                                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│ Comments (4)                                                                │
│──────────────────────────────────────────────────────────────────────────────│
│ bob · 2026-03-12                                                            │
│ Looks good, please double-check the rollback step.                         │
│                                                              [ Delete ]    │
│                                                                             │
│ alice · 2026-03-12                                                          │
│ Will do, adding a note now.                                                 │
│                                                              [ Delete ]    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Add a comment                                                               │
│ ┌────────────────────────────────────────────────────────────────────────┐  │
│ │                                                                        │  │
│ └────────────────────────────────────────────────────────────────────────┘  │
│                                                         [ Post Comment ]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Topic Create / Edit Dialog or Page

```text
┌──────────────────────────────────────────────────────────────┐
│ New Topic                                                    │
├──────────────────────────────────────────────────────────────┤
│ Title *                                                      │
│ [ Enter topic title...                                  ]    │
│                                                              │
│ Body                                                         │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Markdown supported                                       │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│                                   [ Cancel ] [ Save ]        │
└──────────────────────────────────────────────────────────────┘
```

## Acceptance Criteria

- `Topics` nav item appears under `Collaboration` alongside `Groups`.
- Topics list shows title, author display name, last updated time, and comment count.
- Topic detail renders `body` as Markdown and shows comments in chronological order.
- Users can create a topic via the New Topic form; `title` is required.
- Users can edit their own topics.
- Users can delete their own topics with a confirmation dialog.
- Users can add comments on any topic.
- Users can delete their own comments.
- Comment count on the list page is loaded via a single batch filter query.
- All data operations use PocketBase native SDK calls only.

## Integration Notes

- Table structure and collection rules: see `story22.1-topics-backend.md`.
- `react-markdown` is already a project dependency — no new package required.
