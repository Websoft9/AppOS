# Epic 5: App Store Module

**Priority**: P1 | **Status**: In Progress | **Updated**: 2026-02-23

---

## Scope

- Browse application catalog, category navigation, search
- Application detail page (screenshot carousel / text-icon fallback / Markdown description)
- Favorites and notes (user-private)
- User-defined custom apps (private or globally shared)

---

## Key Decisions

### Data Layer

Official catalog (read-only) and user data (writable) are strictly separated and merged on the frontend before rendering:

| Data | Storage | Notes |
|------|---------|-------|
| catalog / product JSON | CDN + local fallback | Read-only; bundled with release, CDN keeps it up to date |
| Favorites & notes | PocketBase `store_user_apps` | User-private; unique on `(user, app_key)` |
| Custom apps | PocketBase `store_custom_apps` | Includes compose template; supports private / shared visibility |

### Media Resources (fetched online, not pre-stored in container)

| Resource | URL Pattern | Fallback |
|----------|-------------|----------|
| Catalog JSON | `https://artifact.websoft9.com/release/websoft9/store/{catalog\|product}_{locale}.json` | Local bundled file (`/store/*.json`) |
| App icon | Product JSON `logo.imageurl` field | Auto-generated text icon |
| Screenshots | Product JSON `screenshots[].value` field | Entire carousel section hidden |

**⚠️ Critical: CDN Referer Policy**

The CDN at `libs.websoft9.com` implements **hotlink protection** — requests with a `Referer` header from external domains return **403 Forbidden**. Solution: **all `<img>` tags must include `referrerPolicy="no-referrer"`** to prevent the browser from sending the Referer header.

```bash
# Test
curl -sI "https://libs.websoft9.com/Websoft9/logo/product/safeline-websoft9.png" → 200 OK
curl -sI -H "Referer: http://161.189.202.177:9091/store" "..." → 403 Forbidden
```

### PocketBase Collections

#### `store_user_apps` — Favorites & Notes

| Field | Type | Notes |
|-------|------|-------|
| `user` | Relation → users | Owner |
| `app_key` | Text | Matches `key` in product JSON |
| `is_favorite` | Bool | |
| `note` | Text (nullable) | Markdown |

Unique index on `(user, app_key)`. List/View rule: `@request.auth.id = user`.

#### `store_custom_apps` — User-Defined Apps

| Field | Type | Notes |
|-------|------|-------|
| `key` | Text (unique) | Must not conflict with official keys |
| `trademark` | Text | Display name |
| `logo_url` | URL (nullable) | Custom icon |
| `overview` | Text | Short description |
| `description` | Text | Markdown |
| `category_keys` | JSON | References catalog category keys |
| `compose_yaml` | Text | Docker Compose template (optional) |
| `env_text` | Text | .env file content (optional) |
| `visibility` | Select: `private/shared` | |
| `created_by` | Text | Auth record ID (supports users + _superusers) |

### Catalog Loading Strategy: Stale-While-Revalidate

Serve local JSON immediately (millisecond-level), then silently fetch CDN in the background to update the cache. CDN failures are ignored. Catalog data is decoupled from software releases and always available offline.

**Manual Sync**: "Sync Latest" button in catalog header force-fetches from CDN via `syncLatestFromCdn(locale, queryClient)`, which calls `setQueryData` + `invalidateQueries` to trigger immediate re-render.

---

## UI/UX Decisions

### Layout & Spacing

- **Grid**: `lg:grid-cols-6` — 6 apps per row on large screens
- **Page sizes**: `[30, 60, 120]` (not 12/24/48/96)
- **Row gap**: `gap-y-6` (larger than column gap `gap-x-4`) for better visual separation
- **Card alignment**: Summary text uses `min-h-[2.5rem]` (exact height of 2 lines at text-xs) + `line-clamp-2` to ensure all cards in the same row align vertically
- **Card full-height**: `h-full` on card wrapper ensures Deploy button stays at bottom

### App Store Default Language

**Default to English**, not browser language. Reasoning: App Store is a showcase of international software; English provides the widest coverage. User can explicitly switch languages via UI.

```ts
// dashboard/src/lib/i18n.ts
const savedLang = localStorage.getItem('ws9-locale')
const defaultLang = savedLang ?? 'en'  // NOT detectedLang
```

### Dialog Sizing

App detail modal: `sm:max-w-4xl` (896px) — aligned with Docker "Run Command" dialog sizing for UI consistency.

### Screenshot Carousel Behavior

When **all** screenshots fail to load, the `<ScreenshotCarousel>` component returns `null` (no partial UI). The section heading ("Screenshots") is rendered **inside** the component, so it also disappears when all images fail.

### Header Navigation

"App Store" text link added to Header (left of theme toggle), styled as `text-xs text-muted-foreground` — intentionally low-profile to avoid overwhelming the primary navigation.

---

## Critical Gotchas

### Nginx SPA Routing: Port-Stripping 301 Redirect

⚠️ **Problem**: `dashboard/public/store/` directory exists in the build → when user navigates to `/store`, nginx detects a real directory and issues a 301 redirect to `/store/` (trailing slash). Because nginx listens on port 80 internally, the `Location` header omits the external port (e.g., `9091`), causing the browser to redirect to `http://161.189.202.177/store/` (port stripped).

**Root Cause**: `try_files $uri $uri/ /index.html` — the `$uri/` check triggers directory detection.

**Solution**: Remove `$uri/` from `try_files` for SPA routes:

```nginx
# build/nginx.conf
location / {
    root /usr/share/nginx/html/dashboard;
    index index.html;
    try_files $uri /index.html;  # ← removed $uri/
}
```

---

## Stories

- [x] [5.1: Foundation](story5.1-foundation.md) — Core UI, category navigation, i18n
- [ ] [5.2: Store API & Display](story5.2-store-api.md) — online media fetch, SWR, detail page, icon/screenshot fallback, search
- [ ] [5.4: Favorites & Notes](story5.4-user-features.md) — per-user favorites toggle, catalog filter, inline notes
- [x] [5.5: Custom Apps](story5.5-custom-apps.md) — create/edit/delete custom apps, IAC template files, catalog grouping, sharing
- [ ] 5.6: i18n

---

## Dependencies

- Epic 7 (Dashboard framework) completed
- PocketBase migrations for `store_user_apps` and `store_custom_apps`
