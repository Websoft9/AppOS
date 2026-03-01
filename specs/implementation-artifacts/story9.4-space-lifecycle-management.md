# Story 9.4: Space Lifecycle Management

**Epic**: Epic 9 - User Space  
**Priority**: P2  
**Status**: done (as-built normalization; future scope noted)  
**Depends on**: Story 9.1

## User Story

As an authenticated user, I want safe lifecycle controls for files (trash/restore/delete), so that I can recover mistakes and manage file retention.

## Acceptance Criteria

- [x] AC1: Deleting from normal view performs soft delete (`is_deleted=true`) instead of hard delete.
- [x] AC2: Trash view shows deleted items and supports restore.
- [x] AC3: User can permanently delete items from trash and run empty-trash with confirmation.

## Tasks / Subtasks

- [x] Task 1: Trash lifecycle
  - [x] 1.1 Add migration and model field for soft delete
  - [x] 1.2 Implement delete/restore/permanent-delete behaviors in UI and API usage
- [x] Task 2: Scope governance
  - [x] 2.1 Link settings ownership to Epic 13 outputs
  - [x] 2.2 Keep version-history as future planned slice

## Dev Notes

- This story consolidates legacy capability: 9.8.
- Legacy 9.5 is represented as cross-epic dependency resolution (implemented in Epic 13).
- Legacy 9.6 remains planned and intentionally not marked done.

### Frontend Behaviors

| Feature | Implementation |
|---|---|
| Delete | Soft-delete to Trash; permanent delete from Trash view. AlertDialog confirm for empty-trash. |
| Trash | Toggle trash view; shows all soft-deleted items flat. Restore / permanent delete / empty trash. Back-to-files button in toolbar. |

## Legacy Mapping

- Legacy 9.8 (Soft Delete & Trash) → included
- Legacy 9.5 (Settings UI) → resolved by Epic 13 reference
- Legacy 9.6 (File Version History) → future planned scope

## Change Log

| Date | Change |
|---|---|
| 2026-03-01 | Story created by consolidating lifecycle and import capabilities |
