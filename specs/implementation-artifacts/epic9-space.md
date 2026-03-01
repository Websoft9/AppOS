# Epic 9: User Space

## Overview

**Per-user private space** — each authenticated user gets an isolated space for storing, editing, organizing, and sharing files.

**Status**: Stories 9.1–9.4 complete | **Priority**: P2 | **Depends on**: Epic 1, Epic 3 (Epic 13 only for Story 9.5)

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
| `GET` | `/api/ext/space/preview/{id}` | Required | Stream file content for inline browser preview |
| `GET` | `/api/ext/space/share/{token}` | None | Validate token, return file metadata |
| `GET` | `/api/ext/space/share/{token}/download` | None | Stream file content (public) |

Share `POST` body: `{ "minutes": N }`. Response: `{ "share_token", "share_url", "expires_at" }`.
`share_url` is a relative path (`/api/ext/space/share/{token}/download`); the frontend prepends `window.location.origin`.

**Preview endpoint** (`GET /api/ext/space/preview/{id}`):
- Authentication required; rejects non-owners with 403
- MIME whitelist (matches `spacePreviewMimeTypeList` constant): images (png, jpeg, gif, webp, svg+xml, bmp, x-icon), PDF, audio (mpeg, wav, ogg, aac, flac, webm), video (mp4, webm, ogg)
- Returns 415 Unsupported Media Type for MIME types not in whitelist
- Response headers on every preview: `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`
- PDF additionally gets `Content-Security-Policy: sandbox` to block embedded JS
- SVG served as `image/svg+xml`; frontend renders via `<img>` which browser-sandboxes script execution

### Header Requirements (file create)

For `POST /api/collections/user_files/records` when creating a file (`is_folder=false`):
- `X-Space-Batch-Size` is required
- must be an integer ≥ 1
- must be ≤ current `space/quota.maxUploadFiles`

Purpose: enforce server-side max files per upload batch (not only frontend validation).

---

## Frontend Features

**Route**: `/_app/_auth/space` → `/space`

| Feature | Implementation |
|---|---|
| Header toolbar | Single row: title → breadcrumb path (`/` for root) → search input → flex spacer → Refresh / action buttons |
| Stats | One-line text below list: `N folders · N files · N/max items used · max file size X MB` |
| Folder navigation | Breadcrumb in toolbar; click segment to navigate; dialogs pre-fill current folder as parent |
| Search | Filter by name within current folder; result count shown inline when active |
| Sort | Click Name / Type / Created column headers; folders always listed before files |
| Pagination | 20 items per page; Previous/Next controls |
| Path column | Full path from root computed client-side via `buildPath()` |
| Upload | Validates allow/deny settings, file size, and max files per batch before submit |
| New Folder | Creates `is_folder=true` record; reserved name check at root |
| New File | Online textarea creation for editable formats; saves as file upload |
| Editor | `sm:max-w-3xl` (768px), `max-h-[65vh]` scrollable textarea; disabled for office/pdf |
| File size | Column shows human-readable size (K/M) from `size` field; set on upload, create, and save |
| Download | Native `<a download>` using authenticated PB file URL |
| Share | Generates public link via ext API; copy button copies URL; link works without login; supports QR code generation + PNG download. **Caveat**: Radix Dialog focus-trap breaks `execCommand` on elements outside the dialog — fallback must select the in-dialog input via ref. |
| Preview | Eye button (shown only for previewable MIME types). Fetches `/api/ext/space/preview/{id}` as authenticated request, creates Blob URL, renders in Dialog: `<img>` for images & SVG, `<iframe sandbox="allow-scripts">` for PDF, `<audio>` for audio, `<video>` for video. Dialog footer includes inline Download link. Blob URL revoked on close. |
| Delete | AlertDialog confirm; warns folder does not cascade-delete children |
| Refresh | Spinner icon button in toolbar |

---

## Migrations

| File | Purpose |
|---|---|
| `1740300000_create_user_files.go` | Initial collection with all fields |
| `1740300001_user_files_add_autodate.go` | Adds `created`/`updated` AutodateFields to existing deployments |
| `1740300002_user_files_folder_support.go` | Adds `is_folder` (bool) + `parent` (text) fields |
| `1740300003_user_files_add_size.go` | Adds `size` (number, bytes) field for file-size display |
| `1741300010_rename_settings_files_to_space.go` | Renames `app_settings` module key from `files` → `space` (Epic 9 rebrand) |

---

## Hook Validation (`hooks.go`)

`OnRecordCreateRequest("user_files")`:
1. If `is_folder=true` and `parent=""`: reject reserved root names
2. If `is_folder=true`: enforce item count limit
3. If file: require `X-Space-Batch-Size` header; enforce `maxUploadFiles`
4. If file: validate extension; enforce item count limit

Header contract for file create requests:
- `X-Space-Batch-Size`: integer ≥ 1
- must be ≤ current `space/quota.maxUploadFiles`
- frontend sends this header for both batch upload and single-file create

---

## Story Status

| Story | Title | Status |
|---|---|---|
| 9.1 | Backend Collection + Migration + Hooks | ✅ Done |
| 9.2 | Space List UI | ✅ Done |
| 9.3 | Online Editor | ✅ Done |
| 9.4 | Share | ✅ Done |
| 9.5 | Settings UI (Admin) | ⏳ Resolved by Epic 13 (Story 13.2 + 13.4) |
| 9.6 | File Version History | 📋 Planned |
| 9.7 | File Preview (browser-native) | ✅ Done |

---

## Story 9.7 — File Preview (Browser-Native)

**Objective**: Users can preview files that the browser can render natively (images, SVG, PDF, audio, video) without downloading.

**Backend** (`routes/space.go`):
- `GET /api/ext/space/preview/{id}` — auth required, owner-only
- MIME whitelist via `spacePreviewMimeTypeList` constant (mirrors frontend `PREVIEW_MIME_TYPES`)
- Security headers: `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`
- PDF additionally: `Content-Security-Policy: sandbox`
- Returns 415 for MIME types outside whitelist; 403 for non-owners

**Frontend** (`routes/_app/_auth/space.tsx`):
- `PREVIEW_MIME_TYPES` set + `getPreviewType()` helper (image / pdf / audio / video)
- Eye button rendered only for previewable files
- `openPreview()`: authenticated fetch → `URL.createObjectURL(blob)`; `closePreview()`: revokes blob URL
- Preview Dialog renders: `<img>` (image/SVG) · `<iframe sandbox="allow-scripts">` (PDF) · `<audio controls>` (audio) · `<video controls>` (video)
- Footer: Close + Download link

**Security rationale**:
- `<img>` for SVG: browser suppresses all script/event-handler execution
- `iframe sandbox` for PDF: isolates PDF-embedded JS from page context
- `X-Content-Type-Options: nosniff`: prevents MIME-type confusion attacks
- `X-Frame-Options: SAMEORIGIN`: prevents clickjacking by third-party pages
- Authenticated proxy (`/api/ext/space/preview`) keeps token out of URL

**Acceptance Criteria**:
- [x] Eye button visible only for files with previewable MIME type
- [x] Images (png, jpg, gif, webp, bmp, ico) and SVG render in `<img>` in Dialog
- [x] PDF renders in sandboxed `<iframe>` in Dialog
- [x] Audio renders in `<audio controls>` in Dialog
- [x] Video renders in `<video controls>` in Dialog
- [x] Backend rejects non-owner access with 403
- [x] Backend rejects unsupported MIME types with 415
- [x] All security headers present on preview response
- [x] Blob URL revoked on dialog close (no memory leak)
- [x] TypeScript: no type errors; Go: no build errors

---

## Story 9.6 — File Version History

**Objective**: Users can view and restore previous versions of a file in their space.

**Requirements**:
- Every save (create or update of a file record) automatically creates a version snapshot
- Users can list all historical versions of a file (timestamp, size, who saved)
- Users can preview or download any past version
- Users can restore a past version as the current content
- Version retention policy: configurable maximum number of versions per file (default TBD)
- Versions are stored per file, not per folder; folders have no version history
- Version data must not count against the user's space quota

**Open Questions** (solution not decided):
- Storage backend: PB FileField on a sibling `user_file_versions` collection vs. content-addressed storage vs. Git-backed store
- Retention limit: time-based, count-based, or size-based
- Whether to expose diffs between versions

**Acceptance Criteria**:
- [ ] Saving a file creates a retrievable snapshot
- [ ] Version list shows timestamp and is ordered newest-first
- [ ] Past version can be previewed inline and downloaded
- [ ] Restore replaces current content and creates a new version entry for the restore action
- [ ] Exceeding retention limit silently drops the oldest version

**Dependencies**: Epic 1, Epic 3; no Epic 2 dependency anticipated.

---

## Out of Scope (current)

- Version history / diff — moved to Story 9.6 (planned)
- Binary / non-browser-native file preview (e.g. Office formats)
- Collaborative editing
- Cascading folder delete
- Global search (cross-folder)
- Story 9.5 settings UI (resolved by Epic 13, stories 13.2 + 13.4)
