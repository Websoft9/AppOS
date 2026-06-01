# Story 5.2: Store Display — Media, Detail Page, Search

**Epic**: 5 - App Store | **Priority**: P0 | **Status**: ✅ Done (display slice); frontend static source retired

## User Story

As a user, I can view app icons, screenshots, and a detail page with full description, so I can evaluate an app before deploying it.

## Acceptance Criteria

### Catalog Data Loading

- [x] Store read surfaces consume backend `/api/catalog/*` endpoints instead of reading raw frontend JSON bundles.
- [x] Official catalog seed files are backend-owned and materialized into the runtime catalog directory by the backend catalog source loader.
- [x] Browser consumers do not fetch CDN catalog bundles directly.

### App Icons

- [x] Icon URL from product JSON `logo.imageurl` field (not derived from `key`)
- [x] On load failure → render text icon (first letter of `trademark`, background color derived from `key` hash)
- [x] Text icon is pure CSS, no canvas
- [x] ⚠️ **All `<img>` tags include `referrerPolicy="no-referrer"`** — CDN at `libs.websoft9.com` blocks requests with external Referer headers (403)

### App Detail Page / Modal

- [x] Clicking an app card opens a detail view with:
  - Icon (with text-icon fallback), name, website link, GitHub link
  - System requirements: vCPU, memory (GB), storage (GB)
  - Categories as clickable tags → clicking filters the catalog
  - Documentation link (EN: `https://support.websoft9.com/en/docs/{key}`, ZH: `https://support.websoft9.com/docs/{key}`)
  - `summary` or `overview` field as plain text (prefer `summary` when available)
  - `description` field rendered as Markdown (`react-markdown` + `@tailwindcss/typography`)
  - GitHub URL: `https://github.com/Websoft9/docker-library/tree/main/apps/{key}`
- [x] Screenshot carousel loads images from product `screenshots[].value` array
- [x] If **all** screenshots fail to load → component returns `null` (section heading also hidden)
- [x] ⚠️ Screenshots also require `referrerPolicy="no-referrer"`
- [x] Deploy button present (wired in Story 5.3)
- [x] Dialog sizing: `sm:max-w-4xl` (896px) — consistent with Docker page dialogs

### Search

- [x] Search input with autocomplete dropdown (max 10 suggestions)
- [x] Suggestion shows: app icon, name, primary category
- [x] Matching: prefix match (priority 1) → contains match (priority 2), case-insensitive
- [x] 300ms debounce; client-side only (no API calls)
- [x] Last 10 searches stored in `localStorage`, shown when input is empty
- [x] Keyboard navigation: ↑↓ arrows, Enter to select, ESC to close

### Layout & Alignment

- [x] Grid: `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6` — 6 apps per row on large screens
- [x] Gap: `gap-x-4 gap-y-6` — row gap larger than column gap for better visual separation
- [x] Card summary: `min-h-[2.5rem] line-clamp-2` — ensures all cards align vertically (2rem = exact 2-line height at text-xs)
- [x] Card wrapper: `h-full` — Deploy button stays at bottom
- [x] Page sizes: `[30, 60, 120]`

## Dependencies

- Story 5.1 completed (store layout and routing ready)
- Backend catalog read API and seed loader provide the official catalog source

## Dev Agent Record

**Date**: 2026-02-23 | **Agent**: Amelia (dev.agent)

### Completion Notes

- Store display now reads through `src/lib/catalog-api.ts`; presenter-only helpers live in `src/lib/store-presenter.ts`.
- `src/components/store/AppIcon.tsx`: `<img>` with `onError` fallback to pure-CSS text icon; background hashed from app key; no canvas
- `src/components/store/SearchAutocomplete.tsx`: 300ms debounce hook; prefix→contains sorted suggestions; localStorage history (max 10); ↑↓/Enter/ESC keyboard nav; ARIA combobox/listbox roles
- `src/components/store/ScreenshotCarousel.tsx`: tracks failed image URLs; hides entire section if **any** image fails; keyboard-accessible prev/next + dot indicators
- `src/components/store/AppDetailModal.tsx`: Dialog from shadcn/ui; ReactMarkdown description; locale-aware doc URL; system requirements grid; category chips that filter catalog; Deploy button (stub for Story 5.3)

### File List

- `web/src/lib/catalog-api.ts` [CURRENT read surface for official catalog]
- `web/src/lib/store-presenter.ts` [CURRENT presenter helpers]
- `web/src/components/store/AppIcon.tsx` [UPDATED — added `referrerPolicy="no-referrer"`, accepts `logoUrl` prop]
- `web/src/components/store/SearchAutocomplete.tsx` [NEW]
- `web/src/components/store/ScreenshotCarousel.tsx` [UPDATED — `referrerPolicy="no-referrer"`, conditional title rendering]
- `web/src/components/store/AppDetailModal.tsx` [UPDATED — `sm:max-w-4xl`, `@tailwindcss/typography`]
- `web/src/components/store/AppCard.tsx` [UPDATED — shows `summary` instead of `overview`, `min-h-[2.5rem]` alignment]
- `web/src/components/store/StorePagination.tsx` [NEW]
- `web/src/routes/_app/_auth/store/index.tsx` [UPDATED — backend catalog consumer, grid layout adjustments]
- `web/src/components/layout/Header.tsx` [UPDATED — added "App Store" link]
- `web/src/lib/i18n.ts` [UPDATED — default locale 'en' instead of browser detection]
- `web/src/lib/store-types.ts` [UPDATED — PAGE_SIZES [30,60,120]]
- `web/src/index.css` [UPDATED — `@plugin "@tailwindcss/typography"`]
- `web/src/locales/en/store.json` [UPDATED — added store UI keys]
- `web/src/locales/zh/store.json` [UPDATED — added store UI keys]

---

## Technical Gotchas & Solutions

### 1. CDN Referer Hotlink Protection (403 Forbidden)

**Problem**: `libs.websoft9.com` returns `403 Forbidden` when `Referer` header is present from external domains.

**Detection**:
```bash
curl -sI "https://libs.websoft9.com/Websoft9/logo/product/safeline-websoft9.png" → 200 OK
curl -sI -H "Referer: http://161.189.202.177:9091/store" "..." → 403 Forbidden
```

**Solution**: Add `referrerPolicy="no-referrer"` to all `<img>` tags loading CDN resources.

### 3. Screenshot Section Visibility Logic

Initial AC said "hide carousel if **any** screenshot fails" — revised to "hide if **all** fail" for better UX. Title rendering moved inside `<ScreenshotCarousel>` so it disappears together with the images when all fail.

### 4. Product Data Structure

- Logo: `product.logo?.imageurl` (not derived from `key`)
- Screenshots: `product.screenshots[].value` (full URLs in JSON)
- Summary: prefer `product.summary ?? product.overview` for card display

### 5. Current Read Boundary

Store display code should stay behind backend `/api/catalog` contracts. Official seed packaging, runtime extraction, and seed refresh workflows are backend concerns, not frontend fetch concerns.
