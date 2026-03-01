# Story 9.3: Space Sharing and Access

**Epic**: Epic 9 - User Space  
**Priority**: P2  
**Status**: done (as-built normalization)  
**Depends on**: Story 9.1

## User Story

As an authenticated user, I want to share and preview files safely, so that collaborators can access content when appropriate without exposing private space broadly.

## Acceptance Criteria

- [x] AC1: User can create, refresh, and revoke share links using expiring token policy.
- [x] AC2: Public share endpoints work without login only when token is valid and unexpired.
- [x] AC3: Owner-only preview endpoint streams browser-previewable media and rejects unsupported MIME types.
- [x] AC4: Preview responses include required security headers (`nosniff`, frame constraints, PDF sandbox policy).
- [x] AC5: UI offers preview by file type (text/code, image, pdf, audio, video) and supports fullscreen enhancement.
- [x] AC6: Share UI supports copy-link and QR-based distribution workflow.

## Tasks / Subtasks

- [x] Task 1: Sharing APIs
  - [x] 1.1 Implement share create/revoke ext endpoints
  - [x] 1.2 Implement anonymous share metadata/download endpoints
- [x] Task 2: Preview APIs and security
  - [x] 2.1 Implement owner-scoped preview endpoint and MIME whitelist
  - [x] 2.2 Add security headers and unsupported-type protection
- [x] Task 3: Frontend preview/share UX
  - [x] 3.1 Implement per-type preview rendering
  - [x] 3.2 Implement share dialog, copy behavior, QR support

## Dev Notes

- This story consolidates legacy capabilities: 9.4 + 9.7 + 9.9.
- Share access is governed by `share_token` + `share_expires_at`.
- Preview endpoint uses query token style for browser embed compatibility.

### Preview Endpoint (`GET /api/ext/space/preview/{id}`)

- Auth via `?token=` query param (allows direct browser embed in `<img>`, `<audio>`, `<video>`, `<iframe>` without custom headers)
- Registered on public router (not behind RequireAuth middleware)
- Rejects non-owners with 403
- MIME whitelist (matches `spacePreviewMimeTypeList` constant): images (png, jpeg, gif, webp, svg+xml, bmp, x-icon), PDF, audio (mpeg, wav, ogg, aac, flac, webm), video (mp4, webm, ogg)
- Returns 415 Unsupported Media Type for MIME types not in whitelist
- Response headers: `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`
- PDF additionally gets `Content-Security-Policy: sandbox` to block embedded JS
- SVG served as `image/svg+xml`; frontend renders via `<img>` which browser-sandboxes script execution

### Security Rationale

- `<img>` for SVG: browser suppresses all script/event-handler execution
- `iframe sandbox` for PDF: isolates PDF-embedded JS from page context
- `X-Content-Type-Options: nosniff`: prevents MIME-type confusion attacks
- `X-Frame-Options: SAMEORIGIN`: prevents clickjacking by third-party pages
- Authenticated proxy (`/api/ext/space/preview`) keeps token out of URL

### Frontend Behaviors

| Feature | Implementation |
|---|---|
| Share | Generates public link via ext API; copy button copies URL; link works without login; supports QR code generation + PNG download. **Caveat**: Radix Dialog focus-trap breaks `execCommand` on elements outside the dialog — fallback must select the in-dialog input via ref. |
| Preview | Eye button for previewable files. Types: text/code (fetched as raw text → `<pre>`), image (`<img>`), PDF (`<iframe>`), audio (`<audio>`), video (`<video>`). Fullscreen toggle. Edit button for text files opens editor directly. Direct URL auth via `?token=` query param. |

## Legacy Mapping

- Legacy 9.4 (Share) → included
- Legacy 9.7 (File Preview) → included
- Legacy 9.9 (Preview Enhancements) → included

## Change Log

| Date | Change |
|---|---|
| 2026-03-01 | Story created by consolidating sharing and access capabilities |
