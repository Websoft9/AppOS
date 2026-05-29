# Story 22.3: Topics Settings

**Epic**: Epic 22 - Topics
**Priority**: P2
**Status**: Implemented
**Depends on**: Story 22.1, Story 22.2, Epic 13

## Goal

Keep Topics policy on the shared settings surface instead of scattering limits and defaults across route handlers and frontend pages.

Canonical location:

- `Settings > Workspace > Topics`
- one nav item
- three cards

Cards:

1. `Topic Share`
2. `Topic Comment Policy`
3. `Topic Description Import`

## Settings Entries

- `topic-share`
- `topic-comment-policy`
- `topic-import-policy`

## Current Alignment

- Canonical share policy should be `topic/share`.
- Epic 22 docs currently mention reuse of `space.quota` share duration.
- Current backend implementation already reads `topic/share` in `backend/domain/topics/config.go`.
- This story makes that direction explicit and removes the spec drift.

## Default Shape

`topic-share`

```json
{
  "shareDefaultMinutes": 30,
  "shareMaxMinutes": 60
}
```

`topic-comment-policy`

```json
{
  "allowGuestComments": true,
  "defaultGuestName": "Guest",
  "maxGuestNameLength": 100,
  "maxCommentBodyLength": 10000
}
```

`topic-import-policy`

```json
{
  "maxDescriptionImportKB": 2,
  "textOnly": true
}
```

## Boundary

In scope:

- topic share duration policy
- anonymous comment policy for shared topics
- topic description import size and text-only policy
- replacing topic comment hardcoded limits with persisted defaults
- aligning Epic 22 docs with the existing `topic/share` runtime direction

Out of scope:

- title / description requiredness
- close / reopen semantics
- markdown rendering behavior
- topic list pagination or query batch sizes

## Validation

- `shareDefaultMinutes >= 1`
- `shareMaxMinutes >= shareDefaultMinutes`
- `maxGuestNameLength >= 1`
- `maxCommentBodyLength >= 1`
- `defaultGuestName` must be non-empty and within `maxGuestNameLength`
- `maxDescriptionImportKB >= 1`

## Runtime Direction

- authenticated share creation reads `topic-share`
- public share comment creation reads `topic-comment-policy`
- authenticated topic detail pages read `topic-import-policy`
- missing rows fall back to the documented defaults
- current topic-domain constants become defaults, not the only source of truth

## Acceptance

- `topic/share` is the canonical Topics share settings entry.
- `Settings > Workspace > Topics` exposes `Topic Share`, `Topic Comment Policy`, and `Topic Description Import`.
- public guest-comment behavior no longer depends only on hardcoded `MaxGuestNameLen`, `MaxCommentBodyLen`, and `DefaultGuestName`.
- topic description import size and text-only checks no longer depend only on frontend hardcoded values.
- existing share-link behavior remains compatible with current defaults.

## Remaining Candidates

Worth moving to the same settings surface:

- `topics.index.tsx` still hardcodes share dialog default / max minutes and should read `topic/share` like `topics.$id.tsx`.
- `topics.index.tsx` still hardcodes description import size / text-only behavior and should read `topic/import-policy` like `topics.$id.tsx`.

Keep as implementation constants, not settings:

- topic list `PAGE_SIZE = 20`
- comment-count batch query `perPage=500`
- topic detail comments query `perPage=500`
- close / reopen semantics
- guest author storage prefix `guest:`
- collection names and route-local fetch sizes

## Later, Not This Story

- topic list page size or comment-count batch query limits