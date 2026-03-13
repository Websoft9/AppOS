# Story 19.2: Secrets UI

**Epic**: Epic 19 - Secrets Management
**Priority**: P0
**Status**: done
**Depends on**: Story 19.1

## User Story

As an admin, I want a Secrets management page under Admin → Credentials, so that I can create, view, update, revoke, and reveal secrets through the dashboard.

## Acceptance Criteria

- [x] AC1: `Credentials` menu group appears in Admin sidebar; expands to two sub-items: `Secrets` and `Environment Variables`.
- [x] AC2: Secrets list page displays: id (truncated, full on hover), name, template_id (with label), scope, access_mode, status, last_used_at, last_used_by. No raw secret value shown.
- [x] AC3: Create form fetches template list from `GET /api/secrets/templates`; renders fields dynamically based on selected template. Password-type fields use masked input.
- [x] AC4: Edit form allows updating metadata (name, scope, access_mode) and payload separately; payload update triggers `PUT /api/secrets/:id/payload`.
- [x] AC5: Reveal button visible only when `access_mode ≠ use_only`; requires confirm dialog before calling `GET /api/secrets/:id/reveal`; result shown in a dismissible overlay (not persisted).
- [x] AC6: Active secrets show `Revoke` action button (not Delete); clicking revoke calls `PATCH` with `status=revoked` after confirm dialog.
- [x] AC7: Revoked secrets show `Delete` action button; active secrets do not show Delete.
- [x] AC8: All destructive actions (revoke, delete, reveal) require confirm dialog.

## Tasks / Subtasks

- [x] Task 1: Add `Credentials` menu group to admin sidebar
  - [x] 1.1 Top-level `Credentials` entry collapsible
  - [x] 1.2 Sub-items: `Secrets` (route: `/admin/credentials/secrets`) and `Environment Variables` (placeholder link)
- [x] Task 2: Secrets list page (`/admin/credentials/secrets`)
  - [x] 2.1 Table with columns per AC2 (id, name, type, scope, access_mode, status, created, last_used_at, last_used_by)
  - [x] 2.2 Status badge (active/revoked), access_mode badge
  - [x] 2.3 Action menu per row: Edit / Reveal (conditional) / Revoke or Delete (conditional)
- [x] Task 3: Create/Edit form
  - [x] 3.1 Fetch templates on mount; render template selector
  - [x] 3.2 Dynamic field rendering based on selected template
  - [x] 3.3 Separate "Update Values" section in edit form (calls payload endpoint)
- [x] Task 4: Reveal overlay
  - [x] 4.1 Confirm dialog → call reveal API → show plaintext in modal with copy button
  - [x] 4.2 Plaintext not stored in component state after modal closes
- [x] Task 5: Revoke / Delete confirm dialogs with clear consequence messaging

## Integration Notes

- Depends on Story 19.1 APIs: `GET /api/secrets/templates`, `PUT /api/secrets/:id/payload`, `GET /api/secrets/:id/reveal`, and PB records CRUD for `secrets`.
- `Environment Variables` is only a sibling menu entry in this story; its page/feature is handled by a separate epic.

## Dev Notes

- Single route file architecture: entire Secrets page (list + create dialog + edit dialog) in one route file.
- Client-side full data load via `getFullList()` + in-memory search, sort, exclude-based filter, pagination.
- Search matches id, name, description, last_used_by.
- URL param `?id=<secret_id>` pins list to a single record (exact match); dismissible chip shown in search bar. Other modules use `<Link to="/admin/credentials/secrets" search={{ id }} />` to deep-link.
- Edit mode: metadata form and payload form rendered as independent sections (no accordion).
- Create mode: metadata fields collapsed under a collapsible panel; payload fields primary.
- Template-driven forms support `type: "textarea"` and `upload: true` (file upload with binary rejection).
- Reveal overlay shows labeled key-value pairs when template fields available, raw JSON fallback otherwise.
- Use existing shadcn/ui dialog and table components.

## File List

- `dashboard/src/routes/_app/_auth/secrets.tsx` — list + create/edit dialogs
- `dashboard/src/components/secrets/SecretForm.tsx` — dynamic template-driven field renderer
- `dashboard/src/components/secrets/RevealOverlay.tsx` — reveal overlay with copy

## Change Log

| Date | Change |
|------|--------|
| 2026-03-11 | Story created |
| 2026-03-11 | Implemented credentials sidebar group, secrets list/create/edit/reveal UI, and env-vars placeholder route |
| 2026-03-12 | Added ID column to list; search covers id field; `?id=` URL param for deep-link filtering |

## Dev Agent Record

### Debug Log

- Added sidebar nested nav support and inserted `Credentials` with `Secrets` + `Environment Variables` entries.
- Implemented secrets list page with conditional actions (`Reveal`, `Revoke`, `Delete`) and reveal overlay.
- Implemented create/edit pages with dynamic template-driven payload fields and separate payload update API call.

### Completion Notes

- Validation executed:
  - `cd dashboard && npm run typecheck` (passing after 2026-03-12 changes)
  - `cd dashboard && npm test`
- Frontend typecheck and tests passed.
