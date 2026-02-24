# Story 5.5: Custom Apps

**Epic**: 5 - App Store | **Priority**: P2 | **Status**: ready-for-dev

## User Story

As a user, I can create, edit, and share custom apps in the catalog, so that I can manage private or team-shared app definitions not covered by the official catalog.

## Acceptance Criteria

### Creation — Two Entry Points

- [ ] "Add Custom App" button in catalog header
- [ ] **Option A: Based on existing app** — searchable app picker; pre-fills `trademark`, `overview`, `category_keys` and a starter compose template
- [ ] **Option B: Create from scratch** — blank form

### Custom App Form

- [ ] Required: `trademark` (display name), `overview` (short text), `compose_yaml`
- [ ] Optional: `logo_url`, `description` (Markdown), `category_keys` (multi-select from existing catalog categories)
- [ ] `key` auto-generated from `trademark` (slugified, lowercased); editable; validated unique against official catalog keys and existing custom keys
- [ ] `visibility`: `private` (default) / `shared` — no role restriction; creator identity recorded via `created_by`
- [ ] Switching visibility to `shared` requires explicit confirmation: "This app will be visible to all users in this AppOS instance"
- [ ] Save → creates record in `store_custom_apps`; owner can edit/delete; non-owners see shared apps read-only

### Catalog Layout — Grouped Display

- [ ] **When custom apps exist**: catalog renders two clearly labeled group blocks:
  1. **Custom Apps** (top) — all custom apps visible to the current user (own private + all shared)
  2. **Official Apps** (below) — standard catalog
- [ ] **When no custom apps**: group block headers are not rendered; catalog displays as normal single list
- [ ] Category filter and search apply across both groups; group hidden entirely if 0 results after filter
- [ ] Pagination remains single and global on the merged result set; grouping is visual only
- [ ] Custom app cards show "Custom" badge; shared apps show creator display name

### Detail View

- [ ] Clicking a custom app card opens `AppDetailModal` (reuse existing component)
- [ ] Sections with no data are conditionally hidden: screenshots section hidden if `logo_url` absent and no screenshots; system requirements hidden if fields are zero/absent
- [ ] **No Deploy button** on custom app detail in this story — deployment of custom compose is out of scope; deploy capability tracked as a future story

### Edit / Delete

- [ ] Gear/edit icon on custom app card (visible only to creator)
- [ ] Edit opens same form, pre-filled
- [ ] Delete prompts confirmation dialog; removes record

### Backend: PocketBase Migration

- [ ] Migration: `store_custom_apps` collection
  - Fields: `key` (Text, unique), `trademark` (Text), `logo_url` (URL, nullable), `overview` (Text), `description` (Text nullable), `category_keys` (JSON), `compose_yaml` (Text), `visibility` (Select: private/shared), `created_by` (Relation→users)
  - List/View rule: `visibility = "shared" || created_by = @request.auth.id`
  - Create rule: `@request.auth.id != ""`
  - Update/Delete rule: `created_by = @request.auth.id`
  - Unique index on `key`

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

- `store_custom_apps` PocketBase collection: fields `key` (unique), `trademark`, `logo_url`, `overview`, `description`, `category_keys` (JSON), `compose_yaml`, `visibility` (private/shared), `created_by` (RelationField → users); rules: list/view = shared or own; create = authenticated; update/delete = own only
- `store-custom-api.ts`: `useCustomApps` (expand created_by), `useCreateCustomApp`, `useUpdateCustomApp`, `useDeleteCustomApp`, `getCreatorName(app, userId, t?)`, `customAppToProduct()` adapter for AppDetailModal reuse
- `CustomAppDialog.tsx`: three-step dialog (mode select → optional app picker → form); auto-generates key from trademark; key conflict validation against both official and custom apps; inline amber warning on visibility=shared
- `CustomAppCard.tsx`: reuses AppCard visual style; "Custom" badge; edit/delete controls (owner only); creator name for shared apps via `getCreatorName`
- `AppDetailModal.tsx`: added `showDeploy?: boolean` prop (default true); custom apps pass `showDeploy={false}` — Deploy button fully suppressed
- `index.tsx`: grouped layout — custom apps section (no pagination) above official apps (paginated); `visibleCustomApps` memo (filtered by ownership + visibility + search + favorites); "Add Custom App" header button; `openCustomDetail` uses `customAppToProduct` adapter; `handleSaveCustomApp` dispatches create or update
- i18n: added `customApp.*` namespace (24 keys) and `card.view` to both en and zh
- TypeScript: 0 errors | Go: clean compile

### File List

- `backend/internal/migrations/1741300001_create_store_custom_apps.go` [NEW]
- `dashboard/src/lib/store-custom-api.ts` [NEW]
- `dashboard/src/components/store/CustomAppDialog.tsx` [NEW]
- `dashboard/src/components/store/CustomAppCard.tsx` [NEW]
- `dashboard/src/components/store/AppDetailModal.tsx` [MODIFIED — showDeploy prop]
- `dashboard/src/routes/_app/_auth/store/index.tsx` [MODIFIED]
- `dashboard/src/locales/en/store.json` [MODIFIED]
- `dashboard/src/locales/zh/store.json` [MODIFIED]
