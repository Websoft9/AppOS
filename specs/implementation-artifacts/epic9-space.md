# Epic 9: User Space

## Overview

**Per-user private space** — each authenticated user gets an isolated space for storing, editing, organizing, and sharing files.

**Status**: 4-story normalized split complete (as-built) | **Priority**: P2 | **Depends on**: Epic 1, Epic 3 (Epic 13 for settings dependency)

---

## Data Model

```
user_files (PocketBase Collection)
  ├── owner            → auth user ID
  ├── name             → display filename or folder name
  ├── content          → FileField (PocketBase storage; empty for folders)
  ├── mime_type        → e.g. text/plain
  ├── is_folder        → bool (true = folder record, no file content)
  ├── parent           → parent folder record ID (empty = root)
  ├── share_token      → platform share URL token (empty = not shared)
  ├── share_expires_at → expiry timestamp (empty = no active share)
  ├── is_deleted        → bool (true = soft-deleted / in trash)
  ├── created          → AutodateField
  └── updated          → AutodateField
```

**Sharing**: controlled entirely by `share_token` + `share_expires_at`. A valid non-expired token means the file is publicly accessible — no `is_public` field.

**Folders**: virtual containers — `is_folder=true`, no file content. The flat PB list is navigated via `parent` ID chains in the UI (`buildPath()` for full path display).

---

## Quota Constants (Phase 1 — hardcoded)

| Constant | Value | Notes |
|---|---|---|
| `spaceMaxSizeMB` | `10` | Per-file upload limit |
| `spaceMaxPerUser` | `100` | Includes folders and files |
| `spaceShareMaxMin` | `60` | Hard ceiling for share duration |
| `spaceShareDefaultMin` | `30` | Default when not specified |
| `maxUploadFiles` | `50` (configurable, max `200`) | Max files per single upload batch |
| `spaceAllowedUploadFormats` | 80+ extensions | text, code, pdf, office docs |
| `spaceEditableFormats` | ~70 extensions | text and code only (no pdf/office) |
| `spaceReservedFolderNames` | `deploy,artifact` | Root-level names reserved by system |

All constants live in `backend/internal/routes/space.go` and mirrored in `backend/internal/hooks/hooks.go`.
All marked `// TODO (Story 9.5): replace with settings API`.

The `/api/ext/space/quota` endpoint exposes all constants to the frontend as JSON.

---

## File Formats

**Upload policy (current)**:
- `uploadAllowExts` non-empty: allowlist-only (denylist ignored)
- `uploadAllowExts` empty: denylist-only (not denied = allowed)
- if both lists are empty: any file with extension is allowed

**Online editable**: text and code only — office/pdf formats are blocked from the editor (edit button disabled in UI).

---

## Reserved Folder Names

`deploy` and `artifact` are reserved root-level folder names used by the system. Users cannot create folders with these names at the root level. Sub-folders are not restricted.

Validation is enforced at both the backend hook (`hooks.go`) and the frontend (client-side pre-check with hint text).

---

## Backend API

### PocketBase Native (authenticated)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/collections/user_files/records` | List all user's items (files + folders) |
| `POST` | `/api/collections/user_files/records` | Upload file or create folder |
| `PATCH` | `/api/collections/user_files/records/{id}` | Update file content or metadata |
| `DELETE` | `/api/collections/user_files/records/{id}` | Delete item |
| `GET` | `/api/files/user_files/{recordId}/{filename}` | Download file (authenticated) |

PB access rules: `owner = @request.auth.id` on all CRUD operations.

### Ext APIs

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/ext/space/quota` | Required | Return effective quota limits |
| `POST` | `/api/ext/space/share/{id}` | Required | Create/refresh share token (max 60 min) |
| `DELETE` | `/api/ext/space/share/{id}` | Required | Revoke share |
| `GET` | `/api/ext/space/preview/{id}` | `?token=` query | Stream file for inline browser preview |
| `POST` | `/api/ext/space/fetch` | Required | Download remote URL into user's space |
| `GET` | `/api/ext/space/share/{token}` | None | Validate token, return file metadata |
| `GET` | `/api/ext/space/share/{token}/download` | None | Stream file content (public) |

Share `POST` body: `{ "minutes": N }`. Response: `{ "share_token", "share_url", "expires_at" }`.
`share_url` is a relative path (`/api/ext/space/share/{token}/download`); the frontend prepends `window.location.origin`.

---

## Migrations

| File | Purpose |
|---|---|
| `1740300000_create_user_files.go` | Initial collection with all fields |
| `1740300001_user_files_add_autodate.go` | Adds `created`/`updated` AutodateFields to existing deployments |
| `1740300002_user_files_folder_support.go` | Adds `is_folder` (bool) + `parent` (text) fields |
| `1740300003_user_files_add_size.go` | Adds `size` (number, bytes) field for file-size display |
| `1741300010_rename_settings_files_to_space.go` | Renames `app_settings` module key from `files` → `space` (Epic 9 rebrand) |
| `1741600000_user_files_soft_delete.go` | Adds `is_deleted` (bool) field for soft-delete / trash |

---

## Story Status

### Normalized Stories (BMAD)

| Story | Title | Status |
|---|---|---|
| 9.1 | Space Core Operations | ✅ Done |
| 9.2 | Space Content Operations | ✅ Done |
| 9.3 | Space Sharing and Access | ✅ Done |
| 9.4 | Space Lifecycle Management | ✅ Done (9.6 kept planned) |
| 9.5 | Settings (space quotas/formats) | ✅ Resolved by Epic 13 (no standalone Epic9 story file) |
| 9.6 | File Version History | 📋 Planned |

Related documents:
- `specs/implementation-artifacts/story9.1-space-core-operations.md`
- `specs/implementation-artifacts/story9.2-space-content-operations.md`
- `specs/implementation-artifacts/story9.3-space-sharing-and-access.md`
- `specs/implementation-artifacts/story9.4-space-lifecycle-management.md`

### Legacy Capability Mapping (for historical traceability)

| Story | Title | Status |
|---|---|---|
| 9.1 | Backend Collection + Migration + Hooks | ✅ Mapped to Story 9.1 |
| 9.2 | Space List UI | ✅ Mapped to Story 9.1 |
| 9.3 | Online Editor | ✅ Mapped to Story 9.2 |
| 9.4 | Share | ✅ Mapped to Story 9.3 |
| 9.5 | Settings UI (Admin) | ⏳ Resolved by Epic 13 (Story 13.2 + 13.4) |
| 9.6 | File Version History | 📋 Planned |
| 9.7 | File Preview (browser-native) | ✅ Mapped to Story 9.3 |
| 9.8 | Soft Delete & Trash | ✅ Mapped to Story 9.4 |
| 9.9 | Preview Enhancements (fullscreen, edit, text/code) | ✅ Mapped to Story 9.3 |
| 9.10 | Fetch File from URL | ✅ Mapped to Story 9.1 |

---

## Numbering Notes

- 9.5 is intentionally retained for historical traceability and is resolved by Epic 13 (Stories 13.2 + 13.4).
- 9.6 remains planned as future scope (File Version History).
- Legacy 9.7/9.8/9.9/9.10 details are maintained in consolidated Story files 9.1~9.4, not duplicated in this Epic document.

## Scope Boundary (Current)

- In scope: normalized as-built capability mapping and epic-level architecture constraints.
- Out of scope in this Epic document: per-story implementation details, step-by-step acceptance narratives, UI behavior breakdowns.
