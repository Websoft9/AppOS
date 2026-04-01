# Epic 22: Topics

**Module**: Collaboration / Topics | **Status**: Implemented | **Priority**: P2 | **Depends on**: Epic 19

## Overview

Lightweight collaboration module for user-authored discussion threads with threaded comments. Located under **Collaboration > Topics** as a sibling to Groups.

## Data Model

### `topics` collection

| Field | Type | Notes |
|-------|------|-------|
| title | TextField | Required, max 500 |
| description | TextField | Optional, Markdown |
| created_by | TextField | User ID, max 100 |
| closed | BoolField | Close/reopen toggle |
| share_token | TextField | Random 64-hex token, max 128 |
| share_expires_at | TextField | RFC 3339 timestamp, max 64 |
| created / updated | AutodateField | |

### `topic_comments` collection

| Field | Type | Notes |
|-------|------|-------|
| topic_id | RelationField | FK to topics, cascade delete |
| body | TextField | Required |
| created_by | TextField | User ID or `guest:<name>`, max 100 |
| created / updated | AutodateField | |

**Collection rules**: List/View require auth; Create requires auth; Update/Delete require ownership.

## Custom Routes (`backend/domain/routes/topics.go`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/ext/topics/share/{id}` | Yes (owner) | Create/refresh share token |
| DELETE | `/api/ext/topics/share/{id}` | Yes (owner) | Revoke share token |
| GET | `/api/ext/topics/share/{token}` | Public | Resolve share → topic + comments |
| POST | `/api/ext/topics/share/{token}/comments` | Public | Anonymous comment (guest_name) |

Share quota reuses `space.quota.shareMaxMinutes` / `shareDefaultMinutes` settings.

## Frontend Pages

| Route | File | Features |
|-------|------|----------|
| `/topics` | `topics.index.tsx` | List, search, sort, CRUD, close/reopen, share with QR, file upload |
| `/topics/$id` | `topics.$id.tsx` | Detail, comments, edit, close/reopen, share with QR, file upload |
| `/share/topic/$token` | `share/topic.$token.tsx` | Public view, anonymous comments |

### Key behaviors

- **Share**: Generates time-limited public link + QR code. Clipboard copy uses `lib/clipboard.ts` (handles Radix Dialog focus-trap fallback).
- **File upload**: Text files up to 1 MB appended to Description. Binary files rejected (null-byte detection).
- **Close/Reopen**: Closed topics block edits and new comments. Confirmation dialog on close.
- **Markdown**: Description and comments rendered via `MarkdownView`; editors use `MarkdownEditor` (Write/Preview tabs).

## Shared Utilities

- `lib/clipboard.ts` — `copyToClipboard(text, inputRef?)`: Modern API → in-dialog Input fallback → temporary textarea fallback.

## Scope Boundaries

| In scope | Out of scope |
|----------|-------------|
| Topic CRUD with title and description | Task boards / kanban |
| Threaded comments | Assignees / workflow states |
| Close / Reopen | Labels, milestones |
| Time-limited share with QR | Real-time subscriptions |
| Text file upload to description | Attachment storage |
| Anonymous guest comments via share | |
