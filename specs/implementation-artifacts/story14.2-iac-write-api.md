# Story 14.2: File Write API

**Epic**: Epic 14 - IaC File Management  
**Priority**: P1  
**Status**: Done

---

## User Story

As an admin, I want to create, update, delete, move, upload, and download files under `/appos/data/` via API, so that orchestration files can be fully managed programmatically.

## Acceptance Criteria

- [x] `POST /api/ext/iac` creates file (with optional content) or empty directory; auto-creates intermediate directories (mkdir -p)
- [x] `PUT /api/ext/iac/content` overwrites file content; returns `404` if file does not exist
- [x] `DELETE /api/ext/iac` removes file; directories require `"recursive": true` or returns `400`
- [x] `POST /api/ext/iac/move`: both `from` and `to` validated by `ResolveSafePath()`; fails if destination exists; cross-root moves disallowed
- [x] `POST /api/ext/iac/upload` accepts `multipart/form-data` with `file` and `path` fields
  - Non-zip files: rejected if extension is in the blacklist (`415`) or size exceeds the single-file limit (`413`, default 10 MB)
  - `.zip` files: rejected if size exceeds the zip limit (`413`, default 50 MB); stored as-is at target path (no extraction)
  - Limits and blacklist read from Settings
- [x] `GET /api/ext/iac/download` streams file with correct `Content-Type` and `Content-Disposition` headers; directory → `400`
- [x] All path safety checks applied to every path parameter

## Dependencies

- Story 14.1 (ResolveSafePath, route group, stubs)
