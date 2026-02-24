# Epic 14: System File API

## Overview

**Host-filesystem CRUD API** — a backend ext API that provides structured read/write access to `/appos/data/` for managing orchestration files (docker-compose, Ansible playbooks) and reusable templates. Completely separate from Epic 9 (user private space), which is backed by PocketBase's record-based storage.

**Status**: Backlog | **Priority**: P2 | **Depends on**: Epic 1, Epic 3, Epic 13

---

## Problem Statement

PocketBase's built-in file system binds every file to a Collection Record with an owner (`user_id`). This makes it semantically a **private user asset**, unsuitable for:

- System-level orchestration files that need to be directly referenced by Docker / Ansible on the host filesystem
- Shared workspaces where multiple users may need access to the same app's deployment files
- Template libraries that are reusable across apps and users

This Epic creates a purpose-built API that operates directly on the host filesystem under `/appos/data/`.

---

## Filesystem Layout

```
/appos/data/                         ← Docker VOLUME root (already declared in Dockerfile)
  pb/                                ← [system] PocketBase persistence — NOT accessible via File API
  │   pb_data/                       ← PocketBase DB & storage
  │   pb_migrations/                 ← PocketBase migrations
  redis/                             ← [system] Redis persistence — NOT accessible via File API
  apps/                              ← [writable] App instance workspaces (already pre-created)
  │   └── {appId}/
  │       ├── docker-compose.yml
  │       ├── .env
  │       └── ...
  workflows/                         ← [writable] Workflow instance workspaces
  │   └── {workflowId}/
  │       ├── playbook.yml
  │       ├── inventory
  │       └── ...
  templates/                         ← [writable] Reusable template library
      apps/                          ← Official / built-in app templates
      │   └── {slug}/
      │       ├── docker-compose.yml
      │       └── .env.example
      workflows/                     ← Official / built-in workflow templates
      │   └── {slug}/
      custom/                        ← User-defined custom templates
          └── {slug}/
```

### Root Access Policy

| Directory | File API Accessible | Default Permission |
|-----------|--------------------|--------------------|
| `pb/` | ❌ Forbidden | — |
| `redis/` | ❌ Forbidden | — |
| `apps/` | ✅ | Admin: full CRUD; User: phase 2 |
| `workflows/` | ✅ | Admin: full CRUD; User: phase 2 |
| `templates/` | ✅ | Admin: full CRUD; User: read-only |

**Security invariant**: all paths are resolved to absolute paths and validated against the whitelist `[apps, workflows, templates]`. Any path that escapes `/appos/data/` or references a forbidden root is rejected with `400`.

---

## Backend API

All routes are under `/api/ext/files` and require authentication (`apis.RequireAuth()`). Superuser operations additionally checked where relevant.

### Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/ext/files` | Required | List directory contents at `?path=` |
| `GET` | `/api/ext/files/content` | Required | Read file content at `?path=` |
| `POST` | `/api/ext/files` | Required | Create file or directory |
| `PUT` | `/api/ext/files/content` | Required | Overwrite file content |
| `DELETE` | `/api/ext/files` | Required | Delete file or directory (recursive for dirs) |
| `POST` | `/api/ext/files/move` | Required | Move or rename a file/directory |
| `POST` | `/api/ext/files/upload` | Required | Multipart upload of a file |
| `GET` | `/api/ext/files/download` | Required | Stream file download at `?path=` |

### Request / Response Contracts

**`GET /api/ext/files?path=apps/myapp`**
```json
{
  "path": "apps/myapp",
  "entries": [
    { "name": "docker-compose.yml", "type": "file", "size": 1024, "modified_at": "2026-02-24T10:00:00Z" },
    { "name": "data", "type": "dir", "size": 0, "modified_at": "2026-02-24T09:00:00Z" }
  ]
}
```

**`GET /api/ext/files/content?path=apps/myapp/docker-compose.yml`**
```json
{
  "path": "apps/myapp/docker-compose.yml",
  "content": "services:\n  web:\n    image: nginx\n",
  "size": 38,
  "modified_at": "2026-02-24T10:00:00Z"
}
```

**`POST /api/ext/files`** (create file)
```json
{ "path": "apps/myapp/docker-compose.yml", "type": "file", "content": "..." }
```

**`POST /api/ext/files`** (create directory)
```json
{ "path": "apps/myapp/data", "type": "dir" }
```

**`PUT /api/ext/files/content`**
```json
{ "path": "apps/myapp/docker-compose.yml", "content": "..." }
```

**`DELETE /api/ext/files`**
```json
{ "path": "apps/myapp/data", "recursive": true }
```

**`POST /api/ext/files/move`**
```json
{ "from": "apps/myapp/old.yml", "to": "apps/myapp/docker-compose.yml" }
```

### Path Convention

- All `path` values in requests are **relative** to `/appos/data/` (no leading slash)
- The backend resolves to absolute path and validates the root segment against the whitelist before any I/O
- Directory listings include `type: "file" | "dir"` for each entry
- Max file read/write size: **10 MB** (hardcoded, configurable via settings in phase 2)

---

## Permission Model

| Role | `apps/` & `workflows/` | `templates/` |
|------|------------------------|---------------|
| Superuser (admin) | Full CRUD | Full CRUD |
| Regular user | Own directories only (Phase 2) | Read-only |

**Ownership rule**: a user who creates an app automatically owns that app's directory (`apps/{appId}/`). Ownership is determined by the app record's creator field in PocketBase — the file API checks this at request time. No explicit grant table needed.

Phase 2 will wire up this ownership check for regular users. MVP restricts non-admin access entirely to keep implementation simple until the need is validated.

---

## Go Implementation Notes

- New route file: `backend/internal/routes/files.go`
- Registration: `registerFileRoutes(g)` added to `routes.go` under `/api/ext/files`
- Base path constant: `filesBasePath = "/appos/data"` (or from settings)
- Allowed roots constant: `filesAllowedRoots = []string{"apps", "workflows", "templates"}`
- Path safety helper: `resolveSafePath(base, relPath, allowedRoots) (string, error)` — resolves, validates, rejects traversal
- All OS errors mapped to appropriate HTTP status codes (not found → 404, permission → 403, etc.)

---

## Out of Scope (MVP)

- File version history / rollback
- Multi-user permission grants per directory
- Binary file preview
- Real-time file watching / WebSocket notifications
- Symlink support
- File search / grep across content
- S3 / remote storage backend (local host filesystem only)
- Frontend UI — owned by consuming feature Epics (App Management, Template Management)
- Dockerfile directory initialization — handled in Epic 1 (see "Dockerfile Directory Layout" section in [epic1-infrastructure.md](epic1-infrastructure.md))

---

## Story Status

| Story | Title | Status |
|-------|-------|--------|
| 14.1 | Backend Route Foundation + Path Safety | 📋 Backlog |
| 14.2 | Directory List + File Read API | 📋 Backlog |
| 14.3 | File Write + Create + Delete + Move API | 📋 Backlog |
| 14.4 | Upload + Download API | 📋 Backlog |
| 14.5 | Per-user Permission Model | 📋 Backlog (Phase 2) |

> **Frontend**: Epic 14 does not own any UI. File editing and browsing UI is the responsibility of the consuming feature Epic (e.g. App Management, Template Management). Each consumer implements its own editor/browser component backed by this API.

---

## Story 14.1 — Backend Route Foundation + Path Safety

**Objective**: Register `/api/ext/files` route group. Implement the core path safety utility and stub all endpoints.

**Acceptance Criteria**:
- [ ] `backend/internal/routes/files.go` created, registered in `routes.go`
- [ ] `resolveSafePath()` rejects `..` traversal, symlink escape, and non-whitelisted roots
- [ ] All 8 endpoints registered and return `501 Not Implemented` (stubs)
- [ ] Unit tests for `resolveSafePath()` covering edge cases

---

## Story 14.2 — Directory List + File Read API

**Objective**: Implement `GET /api/ext/files` (list) and `GET /api/ext/files/content` (read).

**Acceptance Criteria**:
- [ ] List returns entries with `name`, `type`, `size`, `modified_at`
- [ ] List of a non-existent path returns `404`
- [ ] Read returns file content as UTF-8 string; binary files return `415`
- [ ] Files over 10 MB are rejected with `413`
- [ ] Superuser auth enforced; regular user returns `403`

---

## Story 14.3 — File Write + Create + Delete + Move API

**Objective**: Implement create, update, delete, and move endpoints.

**Acceptance Criteria**:
- [ ] `POST` creates file (with optional content) or empty directory
- [ ] `PUT` overwrites file content; returns `404` if file does not exist
- [ ] `DELETE` removes file; for directories, requires `"recursive": true` or returns `400`
- [ ] `POST /move` renames or moves; fails if destination already exists (no silent overwrite)
- [ ] All path safety checks applied

---

## Story 14.4 — Upload + Download API

**Objective**: Implement multipart upload and streaming download.

**Acceptance Criteria**:
- [ ] Upload accepts `multipart/form-data` with `file` field and `path` field
- [ ] Upload rejects files over 10 MB
- [ ] Download streams file content with correct `Content-Type` and `Content-Disposition` headers
- [ ] Download of a directory returns `400`

---

## Story 14.5 — Per-user Permission Model (Phase 2)

**Objective**: Allow regular users to access specific directories based on app ownership or explicit grants.

**Permission rule**: app creator automatically owns `apps/{appId}/`. Ownership is resolved by querying the app record's creator field in PocketBase at request time — no separate grant table.

**Open Questions (resolve before story):**
- Does ownership grant full read-write, or read-write with delete restricted (prevent accidental removal of live compose files)?
- How is ownership transferred if app creator leaves or is deleted?

**Acceptance Criteria**: TBD — deferred until user feedback validates the need.
