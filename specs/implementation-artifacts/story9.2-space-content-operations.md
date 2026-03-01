# Story 9.2: Space Content Operations

**Epic**: Epic 9 - User Space  
**Priority**: P2  
**Status**: done (as-built normalization)  
**Depends on**: Story 9.1

## User Story

As an authenticated user, I want to create and edit file content online, so that I can complete routine text/code changes without leaving the platform.

## Acceptance Criteria

- [x] AC1: User can create a new editable file in current folder.
- [x] AC2: Online editor opens for text/code formats and blocks non-editable formats.
- [x] AC3: Saving updates file content and keeps ownership and parent-folder boundaries intact.
- [x] AC4: File metadata reflects updates correctly (modified time and size field).
- [x] AC5: User can rename files/folders with conflict-safe validation.
- [x] AC6: User can duplicate files with predictable naming suffix.

## Tasks / Subtasks

- [x] Task 1: Editor capability
  - [x] 1.1 Implement editor dialog and save flow
  - [x] 1.2 Restrict editing by configured editable formats
- [x] Task 2: File operations
  - [x] 2.1 Implement rename operation for files/folders
  - [x] 2.2 Implement duplicate operation for files
- [x] Task 3: Data consistency
  - [x] 3.1 Keep `size` and timestamp fields synchronized on save/create

## Dev Notes

- This story consolidates legacy capability from Epic9 original item 9.3 and related file actions.
- Editable-format policy is controlled by backend constants and mirrored in frontend behavior.

### Frontend Behaviors

| Feature | Implementation |
|---|---|
| New File | Online textarea creation for editable formats; saves as file upload |
| Editor | `sm:max-w-3xl` (768px), `max-h-[65vh]` scrollable textarea; disabled for office/pdf |
| Rename | Inline rename dialog for files and folders |
| Duplicate | Copy file with " (copy)" suffix |

## Legacy Mapping

- Legacy 9.3 (Online Editor) → included
- Legacy file actions (Rename, Duplicate) from Epic9 feature set → included

## Change Log

| Date | Change |
|---|---|
| 2026-03-01 | Story created by consolidating content operation capabilities |
