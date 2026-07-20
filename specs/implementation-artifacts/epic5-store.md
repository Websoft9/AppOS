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

Official catalog (read-only) and user data (writable) are currently separated at the source layer. The next backend slice should normalize and merge them behind canonical catalog APIs instead of keeping the merge logic in the frontend:

| Data | Storage | Notes |
|------|---------|-------|
| catalog / product JSON | CDN + local fallback | Read-only; bundled with release, CDN keeps it up to date |
| Favorites & notes | PocketBase `store_user_apps` | User-private; unique on `(user, app_key)` |
| Custom apps | PocketBase `store_custom_apps` | Includes compose template; supports private / shared visibility |

### Official Catalog Runtime Packaging Direction

The official catalog should remain file-backed for now, but it should no longer be treated as a frontend-owned asset long term.

- Near-term target: backend-owned seed packaging
- Official `catalog_{locale}.json` and `product_{locale}.json` should be embedded into the backend binary as release seed data.
- On first start, the backend should materialize those seed files into a backend-managed runtime catalog directory and read API data from that directory.
- The runtime directory is the operational source used by `/api/catalog/*`; the embedded seed is the bootstrap source.
- This keeps binary deployments self-contained while removing the architectural dependency on the web static directory or nginx layout.

Current constraint:

- The release artifact/update pipeline is not ready to manage catalog seed version upgrades yet.
- A `.version` marker file may be reserved in the runtime directory design, but it is explicitly a future hook and must not be treated as a required part of the current implementation.
- Until the upgrade pipeline exists, first-start extraction and explicit overwrite rules are enough; full seed-version reconciliation remains deferred.

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

### Catalog Loading Strategy: Backend-Owned Seed Source

Official catalog data is packaged as backend seed files, embedded into the backend binary, and materialized into the runtime catalog directory by the backend source loader. Browser consumers read normalized catalog data only through `/api/catalog/*`.

Developer-side seed refresh is handled by `make sync-store`, which refreshes `backend/domain/catalog/seed/*.json` before build. There is no frontend CDN fetch path in the runtime store UI.

### Backend Transition Direction

The frontend-first Store implementation was acceptable for the first module delivery, but App Catalog should now move toward canonical backend APIs:

- `/api/catalog/categories` becomes the normalized category source
- `/api/catalog/apps` and `/api/catalog/apps/{key}` become the canonical read model for official + visible custom apps
- `/api/catalog/me/*` owns favorites and notes instead of exposing raw PocketBase write patterns to the browser
- future admin sync/rebuild endpoints may own operational refresh flows, but current runtime reads do not depend on browser-side sync
- official catalog seed packaging and runtime extraction are backend concerns, not frontend static hosting concerns

Source bundles, PocketBase collections, and IAC template files remain implementation details behind the catalog contract.

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

### Legacy Frontend Store Directory

The historical frontend static catalog directory is retired. Store routing no longer depends on a catalog directory in the web build output, so this epic should treat official catalog source storage as a backend packaging concern only.

---

## Stories

- [x] [5.1: Foundation](story5.1-foundation.md) — Core UI, category navigation, i18n
- [ ] [5.2: Store API & Display](story5.2-store-api.md) — online media fetch, SWR, detail page, icon/screenshot fallback, search
- [ ] [5.4: Favorites & Notes](story5.4-user-features.md) — per-user favorites toggle, catalog filter, inline notes
- [x] [5.5: Custom Apps](story5.5-custom-apps.md) — create/edit/delete custom apps, IAC template files, catalog grouping, sharing
- [ ] 5.6: i18n
- [ ] [5.7: Catalog Read API](story5.7-catalog-read-api.md) — normalized categories, app list, app detail, deploy-source payload
- [ ] [5.8: Catalog Personalization API](story5.8-catalog-personalization-api.md) — backend-owned favorites and notes contract
- [ ] [5.9: Catalog Source Sync & Projection](story5.9-catalog-source-sync.md) — source sync, projection rebuild, admin inspection

---

## Dependencies

- Epic 7 (Dashboard framework) completed
- PocketBase migrations for `store_user_apps` and `store_custom_apps`
