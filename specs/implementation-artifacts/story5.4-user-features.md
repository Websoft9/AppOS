# Story 5.4: Favorites & Notes

**Epic**: 5 - App Store | **Priority**: P1 | **Status**: ready-for-dev

## User Story

As a user, I can favorite apps and attach personal notes, so that I can quickly find and annotate the apps most relevant to me.

## Acceptance Criteria

### Favorites — App Card (Catalog)

- [ ] Heart icon on each app card (top-right), filled when favorited
- [ ] Click toggles immediately (optimistic update); on failure rolls back and shows error toast
- [ ] Favorite state persists across sessions

### Favorites — Detail Modal

- [ ] Heart icon also present in the detail modal header; stays in sync with card state

### Favorites — Catalog Filter

- [ ] "Show favorites only" checkbox above the app grid, below category selectors
- [ ] When checked: only favorited apps shown; pagination resets to page 1
- [ ] If no favorited apps match, show empty state with clear-filter action

### Notes — Detail Modal

- [ ] Note icon in modal header (filled/outlined based on note existence)
- [ ] Click opens inline plain-text textarea with Save / Cancel
- [ ] Saved note shown as preview (line-clamp 3 lines, expandable); on save failure show error toast
- [ ] Clearing note saves `null` — record preserved (may still hold `is_favorite`)

### Backend: PocketBase Migration

- [ ] Migration: `store_user_apps` collection
  - Fields: `user` (Relation→users, required), `app_key` (Text, required), `is_favorite` (Bool, default false), `note` (Text nullable)
  - Access rules: list/view/create/update/delete = `@request.auth.id = user`
  - Unique index on `(user, app_key)`

## Dev Notes

### Architecture

- One query on mount: `getFullList({ filter: 'user = @request.auth.id' })` → TanStack Query key `['store_user_apps']`
- Create-or-update: find by `app_key` in cache → `update` or `create` → `invalidateQueries`
- Favorite filter: local boolean state, client-side array filter (no extra API)
- Notes: plain textarea, no Markdown dependency

### Backend Migration Pattern

Follow `backend/internal/migrations/1740300000_create_user_files.go` — `core.NewBaseCollection`, access rules via `types.Pointer(rule)`, `m.Register`.

File naming: use next available timestamp, e.g. `17XXXXXXXXXX_create_store_user_apps.go`.

### File Locations

| File | Action |
|------|--------|
| `backend/internal/migrations/17XXXXXXXXXX_create_store_user_apps.go` | NEW |
| `dashboard/src/lib/store-user-api.ts` | NEW — favorites/notes CRUD hooks |
| `dashboard/src/components/store/FavoriteButton.tsx` | NEW |
| `dashboard/src/components/store/NoteEditor.tsx` | NEW |
| `dashboard/src/components/store/AppCard.tsx` | UPDATE — heart icon overlay (top-right corner) |
| `dashboard/src/routes/_app/_auth/store/index.tsx` | UPDATE — favorites filter checkbox row |
| `dashboard/src/components/store/AppDetailModal.tsx` | UPDATE — favorite icon + note section |
| `dashboard/src/locales/en/store.json` | UPDATE — i18n keys |
| `dashboard/src/locales/zh/store.json` | UPDATE — i18n keys |

### References

- PocketBase collections schema: [epic5-store.md](epic5-store.md#PocketBase-Collections)
- Migration pattern: [backend/internal/migrations/1740300000_create_user_files.go](../../backend/internal/migrations/1740300000_create_user_files.go)
- PB SDK usage: [architecture.md](../planning-artifacts/architecture.md#Frontend-single-SDK)
- Store page: [dashboard/src/routes/_app/_auth/store/index.tsx](../../dashboard/src/routes/_app/_auth/store/index.tsx)
- Detail modal: [dashboard/src/components/store/AppDetailModal.tsx](../../dashboard/src/components/store/AppDetailModal.tsx)

## Minimal Acceptance Test Checklist

- [ ] Given user is on catalog, When clicking heart on an unfavorited app, Then icon becomes filled and refresh keeps it favorited
- [ ] Given network fails on favorite toggle, When request errors, Then icon rolls back and error toast is shown
- [ ] Given "Show favorites only" is enabled, When no favorited apps match current filters, Then empty state appears with clear-filter action
- [ ] Given app detail modal is open, When toggling heart there, Then card and modal heart states stay consistent
- [ ] Given note exists, When saving empty textarea, Then note becomes null but favorite state remains unchanged

## Dev Agent Record

**Date**: 2026-05-24 | **Agent**: Amelia (dev.agent)

### Completion Notes

- `store_user_apps` PocketBase collection: fields `user`, `app_key`, `is_favorite`, `note`; UNIQUE INDEX on `(user, app_key)`; rules scoped to `user = @request.auth.id`
- `store-user-api.ts`: `useUserApps` (staleTime: Infinity), `useToggleFavorite` (full optimistic update with rollback), `useSaveNote` (create-or-update)
- `FavoriteButton.tsx`: heart icon toggle, `e.stopPropagation()`, filled red when favorited
- `NoteEditor.tsx`: sticky-note icon, inline edit mode, `line-clamp-3` preview with "Show more", null on clear
- `AppCard.tsx`: optional `userApps` + `onToggleFavorite` props; FavoriteButton overlay at top-right
- `AppDetailModal.tsx`: FavoriteButton in header, NoteEditor section before deploy; `showDeploy` prop for reuse by custom apps
- `index.tsx`: favorites filter checkbox, `showFavoritesOnly` state, empty state variation, error toast (useState + setTimeout pattern)
- i18n: added `favorites.*` and `note.*` keys to both en and zh
- TypeScript: 0 errors | Go: clean compile

### File List

- `backend/internal/migrations/1741300000_create_store_user_apps.go` [NEW]
- `dashboard/src/lib/store-user-api.ts` [NEW]
- `dashboard/src/components/store/FavoriteButton.tsx` [NEW]
- `dashboard/src/components/store/NoteEditor.tsx` [NEW]
- `dashboard/src/components/store/AppCard.tsx` [MODIFIED]
- `dashboard/src/components/store/AppDetailModal.tsx` [MODIFIED]
- `dashboard/src/routes/_app/_auth/store/index.tsx` [MODIFIED]
- `dashboard/src/locales/en/store.json` [MODIFIED]
- `dashboard/src/locales/zh/store.json` [MODIFIED]
