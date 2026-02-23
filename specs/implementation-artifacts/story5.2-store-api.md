# Story 5.2: Store API & Display — Media, Detail Page, Search

**Epic**: 5 - App Store | **Priority**: P0 | **Status**: 🔲 Ready for Dev

## User Story

As a user, I can view app icons, screenshots, and a detail page with full description, so I can evaluate an app before deploying it.

## Acceptance Criteria

### Catalog Data Loading

- [ ] `fetchStoreJson(locale, type)` fetches from local bundled file first (`/store/{type}_{locale}.json`)
- [ ] After returning local data, silently fetches CDN in background and updates TanStack Query cache on success
- [ ] CDN unreachable → silently ignored, local version remains active
- [ ] CDN base: `https://artifact.websoft9.com/release/websoft9/store`
- [ ] Local fallback files located at `dashboard/public/store/`

### App Icons

- [ ] Icon loaded from `https://libs.websoft9.com/Websoft9/logo/product/{key}.png`
- [ ] On load failure → render text icon (first letter of `trademark`, background color derived from `key` hash)
- [ ] Text icon is pure CSS, no canvas

### App Detail Page / Modal

- [ ] Clicking an app card opens a detail view with:
  - Icon (with text-icon fallback), name, website link, GitHub link
  - System requirements: vCPU, memory (GB), storage (GB)
  - Categories as clickable tags → clicking filters the catalog
  - Documentation link (EN: `https://support.websoft9.com/en/docs/{key}`, ZH: `https://support.websoft9.com/docs/{key}`)
  - `overview` field as plain text
  - `description` field rendered as Markdown (`react-markdown`)
  - GitHub URL: `https://github.com/Websoft9/docker-library/tree/main/apps/{key}`
- [ ] Screenshot carousel loads images from `https://libs.websoft9.com/Websoft9/DocsPicture/en/{key}/`
- [ ] If **any** screenshot fails to load → entire carousel section is hidden (no broken image shown)
- [ ] Deploy button present (wired in Story 5.3)

### Search

- [ ] Search input with autocomplete dropdown (max 10 suggestions)
- [ ] Suggestion shows: app icon, name, primary category
- [ ] Matching: prefix match (priority 1) → contains match (priority 2), case-insensitive
- [ ] 300ms debounce; client-side only (no API calls)
- [ ] Last 10 searches stored in `localStorage`, shown when input is empty
- [ ] Keyboard navigation: ↑↓ arrows, Enter to select, ESC to close

## Dependencies

- Story 5.1 completed (store layout and routing ready)
- `dashboard/public/store/` contains bundled JSON files
