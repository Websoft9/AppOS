# Story 14.1: File Read API

**Epic**: Epic 14 - IaC File Management  
**Priority**: P1  
**Status**: Done

---

## User Story

As an admin, I want to list directories and read file contents under `/appos/data/` via API, so that other features and the file editor can retrieve orchestration files.

## Acceptance Criteria

- [x] `internal/fileutil/` package created with `ResolveSafePath()`, `CopyDir()`, `CopyFile()`
- [x] `ResolveSafePath()` rejects `..` traversal, symlink escape, and non-whitelisted roots; unit tests cover edge cases
- [x] `backend/internal/routes/iac.go` created and registered in `routes.go`; the file route sub-group binds `apis.RequireSuperuserAuth()`; write/upload/download endpoints stubbed as `501`
- [x] `GET /api/ext/iac` lists directory entries with `name`, `type`, `size`, `modified_at`; non-existent path → `404`; empty dir → `entries: []`
- [x] `GET /api/ext/iac/content` returns UTF-8 file content; binary detection via `http.DetectContentType()` — non-text MIME type → `415`; files over 10 MB → `413`
- [x] Superuser only; regular auth token → `403` (enforced by `apis.RequireSuperuserAuth()` middleware on the `/files` sub-group)

## Implementation Notes

- `filesBasePath = "/appos/data"`, `filesAllowedRoots = ["apps", "workflows", "templates"]`
- Map OS errors to HTTP status codes: not found → 404, permission denied → 403
- `fileutil` package is shared with the deploy flow — keep it free of HTTP dependencies
