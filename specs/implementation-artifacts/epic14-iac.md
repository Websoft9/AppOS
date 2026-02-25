# Epic 14: IaC File Management

## Overview

**The edit side of the IaC loop.** Provides structured read/write access to `/appos/data/` so users can modify orchestration files (docker-compose, Ansible playbooks, templates) and trigger continuous deployment. Includes a backend IaC API and a minimal web-based code editor UI.

Completely separate from Epic 9 (user private space, PocketBase record-based storage).

**Status**: Done (Phase 1) | **Priority**: P1 | **Depends on**: Epic 1, Epic 3, Epic 13

---

## Access Policy

Base path: `/appos/data/`

| Root | Accessible | Permission |
|------|-----------|------------|
| `pb/` | ❌ | — |
| `redis/` | ❌ | — |
| `apps/` | ✅ | Admin: full CRUD; User: Phase 2 |
| `workflows/` | ✅ | Admin: full CRUD; User: Phase 2 |
| `templates/` | ✅ | Admin: full CRUD; User: read-only |

Any path escaping `/appos/data/` or referencing a forbidden root is rejected with `400`.

`/appos/library/` is out of scope. The library → apps copy is handled internally by `fileutil.CopyDir()` during the deploy flow and is not exposed via HTTP API.

---

## Backend API

All routes under `/api/ext/iac`, require `apis.RequireSuperuserAuth()`.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/ext/iac` | List directory contents at `?path=` |
| `GET` | `/api/ext/iac/content` | Read file content at `?path=` |
| `POST` | `/api/ext/iac` | Create file or directory |
| `PUT` | `/api/ext/iac/content` | Overwrite file content |
| `DELETE` | `/api/ext/iac` | Delete file or directory |
| `POST` | `/api/ext/iac/move` | Move or rename |
| `POST` | `/api/ext/iac/upload` | Multipart file upload |
| `GET` | `/api/ext/iac/download` | Stream file download at `?path=` |

### Request / Response Contracts

**`GET /api/ext/iac?path=apps/myapp`**
```json
{
  "path": "apps/myapp",
  "entries": [
    { "name": "docker-compose.yml", "type": "file", "size": 1024, "modified_at": "2026-02-24T10:00:00Z" },
    { "name": "data", "type": "dir", "size": 0, "modified_at": "2026-02-24T09:00:00Z" }
  ]
}
```

**`GET /api/ext/iac/content?path=apps/myapp/docker-compose.yml`**
```json
{
  "path": "apps/myapp/docker-compose.yml",
  "content": "services:\n  web:\n    image: nginx\n",
  "size": 38,
  "modified_at": "2026-02-24T10:00:00Z"
}
```

**`POST /api/ext/iac`** — create file or directory
```json
{ "path": "apps/myapp/docker-compose.yml", "type": "file", "content": "..." }
{ "path": "apps/myapp/data", "type": "dir" }
```

**`PUT /api/ext/iac/content`**
```json
{ "path": "apps/myapp/docker-compose.yml", "content": "..." }
```

**`DELETE /api/ext/iac`**
```json
{ "path": "apps/myapp/data", "recursive": true }
```

**`POST /api/ext/iac/move`**
```json
{ "from": "apps/myapp/old.yml", "to": "apps/myapp/docker-compose.yml" }
```

### Path Convention

- All `path` values are **relative** to `/appos/data/` (no leading slash)
- Backend resolves to absolute path and validates root segment against whitelist before any I/O
- Empty directory returns `entries: []` (not 404)

### Upload Constraints

| Constraint | Default | Configurable |
|-----------|---------|-------------|
| Max single file size | 10 MB | ✅ Settings |
| Max zip file size | 50 MB | ✅ Settings |
| Allowed archive format | `.zip` only | ❌ Constant |
| Extension blacklist | `.exe .dll .so .bin .deb .rpm .apk .msi .dmg .pkg` | ✅ Settings |

Blacklist applies to upload only (`POST /upload`). Regular `POST`/`PUT` (text content via JSON body) is not subject to blacklist — content is already a string.

---

## Permission Model

| Role | `apps/` & `workflows/` | `templates/` |
|------|------------------------|---------------|
| Superuser | Full CRUD | Full CRUD |
| Regular user | Own directories only (Phase 2) | Read-only |

MVP: superuser only. Phase 2: app creator inherits full CRUD over `apps/{appId}/` based on the `creator` field in the app record — no extra permission table needed.

---

## Go Implementation Notes

- Route file: `backend/internal/routes/iac.go` → `registerIaCRoutes(g)` under `/api/ext/iac`
- `internal/fileutil/` package: `ResolveSafePath()`, `CopyDir()`, `CopyFile()` — shared by IaC API routes and deploy flow
- `filesBasePath = "/appos/data"`, `filesAllowedRoots = ["apps", "workflows", "templates"]`
- `filesAllowedArchive = ".zip"` (constant — not configurable)
- Upload limits and extension blacklist read from Settings at request time (not cached at startup)
- Map OS errors to HTTP status codes: not found → 404, permission denied → 403

---

## Out of Scope (MVP)

- File version history / rollback (handled by deploy Epic via PB `config_versions` collection)
- Multi-user per-directory permission grants
- Binary preview, real-time file watching, symlink support, full-text search
- S3 / remote storage backend
- Deploy trigger — apply/deploy after save belongs to the deploy Epic
- `/appos/library/` access

---

## Story Status

| Story | Title | Status |
|-------|-------|--------|
| [14.1](story14.1-iac-read-api.md) | IaC Read API | ✅ Done |
| [14.2](story14.2-iac-write-api.md) | IaC Write API | ✅ Done |
| 14.3 | Per-user Permission Model | 📋 Backlog (Phase 2) |
| [14.4](story14.4-iac-browser-ui.md) | IaC Browser UI | ✅ Done |

---

> Story details: [14.1](story14.1-iac-read-api.md) · [14.2](story14.2-iac-write-api.md) · [14.4](story14.4-iac-browser-ui.md)
