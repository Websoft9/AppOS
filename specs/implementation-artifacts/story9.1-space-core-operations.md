# Story 9.1: Space Core Operations

**Epic**: Epic 9 - User Space  
**Priority**: P2  
**Status**: done (as-built normalization)  
**Depends on**: Epic 1, Epic 3

## User Story

As an authenticated user, I want to view and organize my private space, so that I can manage files and folders efficiently.

## Acceptance Criteria

- [x] AC1: `/space` route provides authenticated per-user isolated workspace.
- [x] AC2: User can browse folder hierarchy with breadcrumb navigation and current-path context.
- [x] AC3: User can create folders and upload files under current folder with server-side ownership enforcement.
- [x] AC4: Root-level reserved folder names are blocked (`deploy`, `artifact`) by frontend and backend.
- [x] AC5: List view supports search/sort/pagination and keeps folder-first ordering.
- [x] AC6: Quota endpoint is available and UI displays usage stats and limits.
- [x] AC7: Upload enforces extension policy, per-file size, and batch-count limits.
- [x] AC8: User can import a remote file URL into current space with backend validation (scheme/SSRF/extension/size).

## Tasks / Subtasks

- [x] Task 1: Data model and migration baseline
  - [x] 1.1 Create `user_files` collection and required fields
  - [x] 1.2 Add folder fields (`is_folder`, `parent`) and file size field
- [x] Task 2: Backend guardrails
  - [x] 2.1 Add create hooks for folder validation and upload header contract
  - [x] 2.2 Implement `/api/ext/space/quota`
- [x] Task 3: Core UI interactions
  - [x] 3.1 Implement list layout, breadcrumb, search/sort/pagination
  - [x] 3.2 Implement New Folder and Upload flows with client validation
- [x] Task 4: URL import capability
  - [x] 4.1 Implement `/api/ext/space/fetch` backend policy checks
  - [x] 4.2 Add Fetch URL action in Space toolbar and submission flow

## Dev Notes

- This story consolidates legacy capabilities from Epic9 original items: 9.1 + 9.2 + 9.10.
- PocketBase native CRUD remains the primary data API for `user_files`.
- Quota constants are currently hardcoded in backend and exposed via ext API.

### Hook Validation (`hooks.go`)

`OnRecordCreateRequest("user_files")`:
1. If `is_folder=true` and `parent=""`: reject reserved root names
2. If `is_folder=true`: enforce item count limit
3. If file: require `X-Space-Batch-Size` header; enforce `maxUploadFiles`
4. If file: validate extension; enforce item count limit

### Header Contract (file create)

For `POST /api/collections/user_files/records` when creating a file (`is_folder=false`):
- `X-Space-Batch-Size` is required (integer ≥ 1, ≤ `space/quota.maxUploadFiles`)
- Frontend sends this header for both batch upload and single-file create

### Frontend Behaviors

| Feature | Implementation |
|---|---|
| Header toolbar | Single row: title → breadcrumb path (`/` for root) → search input → flex spacer → Refresh / action buttons |
| Stats | One-line text below list: `N folders · N files · N/max items used · max file size X MB` |
| Folder navigation | Breadcrumb in toolbar; click segment to navigate; dialogs pre-fill current folder as parent |
| Search | Filter by name within current folder; result count shown inline when active |
| Sort | Click Name / Type / Modified / Created column headers; folders always listed before files |
| Pagination | Page-size select (15/45/90); Previous/Next controls |
| Path column | Full path from root computed client-side via `buildPath()` |
| Upload | Validates allow/deny settings, file size, and max files per batch before submit |
| New Folder | Creates `is_folder=true` record; reserved name check at root |
| File size | Column shows human-readable size (K/M) from `size` field; set on upload, create, and save |
| Download | Native `<a download>` using authenticated PB file URL |
| Fetch URL | Download file from public URL directly into Space. Backend validates scheme, SSRF, extension, size. Synchronous (blocks UI until complete). |
| View mode | Toggle list/grid; grid shows icon + name cards |
| File icons | Type-specific icons: code, image, video, archive, music, pdf, generic |
| Actions | Per-row dropdown menu (MoreVertical) with context-aware options |

## Legacy Mapping

- Legacy 9.1 (Backend Collection + Migration + Hooks) → included
- Legacy 9.2 (Space List UI) → included
- Legacy 9.10 (Fetch File from URL) → included

## Change Log

| Date | Change |
|---|---|
| 2026-03-01 | Story created by consolidating legacy Epic9 items for BMAD compliance |
