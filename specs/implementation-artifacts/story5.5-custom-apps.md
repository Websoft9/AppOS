# Story 5.5: Custom Apps

**Epic**: 5 - App Store | **Priority**: P2 | **Status**: done

## User Story

As a user, I can create, edit, and share custom apps in the catalog, so that I can manage private or team-shared app definitions not covered by the official catalog.

## Acceptance Criteria

### Creation — Two Entry Points

- [x] "Add Custom App" button in catalog header
- [x] **Option A: Based on existing app** — searchable app picker; pre-fills `trademark`, `overview`, `category_keys` and a starter compose template
- [x] **Option B: Create from scratch** — blank form

### Custom App Form

- [x] Required: `trademark` (display name), `overview` (short text), `compose_yaml`
- [x] Optional: `logo_url`, `description` (Markdown), `category_keys` (multi-select from existing catalog categories)
- [x] `key` auto-generated from `trademark` (slugified, lowercased); editable; validated unique against official catalog keys and existing custom keys
- [x] `visibility`: `private` (default) / `shared` — no role restriction; creator identity recorded via `created_by`
- [x] Switching visibility to `shared` requires explicit confirmation: "This app will be visible to all users in this AppOS instance"
- [x] Save → creates record in `store_custom_apps`; owner can edit/delete; non-owners see shared apps read-only

### Catalog Layout — Grouped Display

- [x] **When custom apps exist**: catalog renders two clearly labeled group blocks:
  1. **Custom Apps** (top) — all custom apps visible to the current user (own private + all shared)
  2. **Official Apps** (below, collapsible) — standard catalog
- [x] **When no custom apps**: group block headers are not rendered; catalog displays as normal single list
- [x] Category filter and search apply across both groups; group hidden entirely if 0 results after filter
- [x] Pagination remains single and global on the merged result set; grouping is visual only
- [x] Custom app cards show "Custom" badge; shared apps show creator display name

### Detail View

- [x] Clicking a custom app card opens `AppDetailModal` (reuse existing component)
- [x] Sections with no data are conditionally hidden: screenshots section hidden if `logo_url` absent and no screenshots; system requirements hidden if fields are zero/absent
- [x] Deploy button shown on custom app detail; Edit/Delete buttons for owner; "Edit Files" link to IAC editor

### Edit / Delete

- [x] Edit/Delete buttons on custom app detail modal (visible only to creator)
- [x] Edit opens same form, pre-filled (key-based remount forces fresh state)
- [x] Delete prompts confirmation dialog; removes record

### Backend: PocketBase Migration

- [x] Migration: `store_custom_apps` collection
  - Fields: `key` (Text, unique), `trademark` (Text), `logo_url` (Text, nullable), `overview` (Text), `description` (Text nullable), `category_keys` (JSON), `compose_yaml` (Text, optional), `env_text` (Text, optional), `visibility` (Select: private/shared), `created_by` (TextField — supports users + _superusers)
  - List/View rule: `visibility = "shared" || created_by = @request.auth.id`
  - Create rule: `@request.auth.id != ""`
  - Update/Delete rule: `created_by = @request.auth.id`
  - Unique index on `key`

### IAC Integration (added during implementation)

- [x] Backend: `GET /library`, `GET /library/content` (read-only), `POST /library/copy` (copies library → templates)
- [x] Frontend: `iac-api.ts` — library read/copy, template ensure (mkdir + upsert files), extra file upload
- [x] "Based on" creates template by copying library folder then overlaying user changes
- [x] "Scratch" creates empty `.env`, `docker-compose.yml`, `readme.md` in templates
- [x] IAC page `root` search param scopes file tree for direct template editing

## Dev Notes

### Catalog Grouping Logic

```ts
const myCustomApps = customApps.filter(a => a.created_by === currentUserId || a.visibility === 'shared')
const hasCustomApps = myCustomApps.length > 0
// Render: hasCustomApps ? two groups : flat list
// After category/search filter, hide group block entirely if its result count === 0
```

Pagination remains global to keep UX minimal. When "show favorites only" (Story 5.4) is active, each group is filtered to favorited items only; groups with 0 favorited items are hidden.

### Creator Name Display

Fetch custom apps with `expand=created_by` to get user record:

```ts
pb.collection('store_custom_apps').getFullList({ expand: 'created_by' })
// Display: record.expand?.created_by?.name || record.expand?.created_by?.email || 'Unknown'
```

### Key & Compose

- `key`: slugified from `trademark`; client-side uniqueness check against catalog + existing custom keys
- Option A compose: minimal starter template only (official app's real compose is not available client-side)

### Backend Migration Pattern

Follow `backend/internal/migrations/1740300000_create_user_files.go`. File naming: `17XXXXXXXXXX_create_store_custom_apps.go`.

### File Locations

| File | Action |
|------|--------|
| `backend/internal/migrations/17XXXXXXXXXX_create_store_custom_apps.go` | NEW |
| `dashboard/src/lib/store-custom-api.ts` | NEW — custom apps CRUD hooks |
| `dashboard/src/components/store/CustomAppDialog.tsx` | NEW — create/edit form (two modes) |
| `dashboard/src/components/store/CustomAppCard.tsx` | NEW — card with edit/delete controls |
| `dashboard/src/routes/_app/_auth/store/index.tsx` | UPDATE — grouped catalog layout |
| `dashboard/src/locales/en/store.json` | UPDATE |
| `dashboard/src/locales/zh/store.json` | UPDATE |

### References

- Epic schema: [epic5-store.md](epic5-store.md#store_custom_apps)
- Migration pattern: [backend/internal/migrations/1740300000_create_user_files.go](../../backend/internal/migrations/1740300000_create_user_files.go)
- Store page: [dashboard/src/routes/_app/_auth/store/index.tsx](../../dashboard/src/routes/_app/_auth/store/index.tsx)

## Minimal Acceptance Test Checklist

- [ ] Given user opens "Add Custom App", When selecting "Based on existing app", Then picker supports keyword search and pre-fills base fields
- [ ] Given visibility is changed to shared, When user confirms, Then app becomes visible to other instance users with creator name shown
- [ ] Given custom apps exist, When catalog loads, Then Custom Apps group is on top and Official Apps group is below
- [ ] Given filters/search remove all items from one group, When results render, Then empty group block is hidden
- [ ] Given non-owner views a shared custom app, When opening card/actions, Then app is readable but edit/delete controls are not shown

## Dev Agent Record

**Date**: 2026-05-24 | **Agent**: Amelia (dev.agent)

### Completion Notes

- **Migration**: `store_custom_apps` collection — `key` (unique), `trademark`, `logo_url`, `overview`, `description`, `category_keys` (JSON), `compose_yaml` (optional), `env_text` (optional), `visibility` (private/shared), `created_by` (TextField, supports users + _superusers); rules: list/view = shared or own; create = authenticated; update/delete = own only
- **IAC integration**: Custom app creation writes template files to `templates/apps/{key}/` via IAC API:
  - "Based on" → `iacLibraryCopy` copies entire library folder, then overlays user changes
  - "Scratch" → creates empty `.env`, `docker-compose.yml`, `readme.md`
  - Extra files uploaded via multipart `iacUploadFile`
  - Backend `POST /api/ext/iac/library/copy` copies `library/apps/{sourceKey}/` → `data/templates/apps/{destKey}/`
  - Backend `GET /api/ext/iac/library[/content]` provides read-only access to `/appos/library/`
- **CustomAppDialog**: three-step (select → optional app picker → form); file upload buttons for compose.yml/.env; extra files multi-upload; auto-key from trademark; key conflict validation; amber warning on shared visibility
- **CustomAppCard**: simplified — app info + View button only (no edit/delete on card)
- **AppDetailModal**: Deploy + Edit/Delete (owner) + "Edit Files" IAC link (navigates to `/iac?root=templates/apps/{key}`)
- **Catalog grouping**: custom apps section on top; official apps section collapsible (chevron toggle)
- **IAC page**: added `root` search param to scope file tree to a single directory
- **Edit metadata**: `key={editingCustomApp?.id ?? 'new'}` on `CustomAppDialog` forces remount when switching create/edit
- TypeScript: 0 errors | Go: clean compile

### File List

- `backend/internal/migrations/1741300001_create_store_custom_apps.go` [NEW]
- `backend/internal/routes/iac.go` [MODIFIED — library handlers + copy endpoint]
- `dashboard/src/lib/iac-api.ts` [NEW — IAC client with library/template helpers]
- `dashboard/src/lib/store-custom-api.ts` [NEW — custom apps CRUD hooks + adapter]
- `dashboard/src/components/store/CustomAppDialog.tsx` [NEW]
- `dashboard/src/components/store/CustomAppCard.tsx` [NEW]
- `dashboard/src/components/store/AppDetailModal.tsx` [MODIFIED — onEdit/onDelete/iacEditPath props]
- `dashboard/src/routes/_app/_auth/store/index.tsx` [MODIFIED — grouped layout, collapsible, edit wiring]
- `dashboard/src/routes/_app/_auth/_superuser/iac.tsx` [MODIFIED — root search param]
- `dashboard/src/locales/en/store.json` [MODIFIED]
- `dashboard/src/locales/zh/store.json` [MODIFIED]
