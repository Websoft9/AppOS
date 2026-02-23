# Epic 5: App Store Module

**Priority**: P1 | **Status**: In Progress | **Updated**: 2026-02-23

---

## Scope

- Browse application catalog, category navigation, search
- Application detail page (screenshot carousel / text-icon fallback / Markdown description)
- Favorites and notes (user-private)
- User-defined custom apps (private or globally shared)
- One-click deployment

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
| App icon | `https://libs.websoft9.com/Websoft9/logo/product/{key}.png` | Auto-generated text icon |
| Screenshots | `https://libs.websoft9.com/Websoft9/DocsPicture/en/{key}/` | Entire carousel section hidden |

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
| `compose_yaml` | Text | Docker Compose template |
| `visibility` | Select: `private/shared` | |
| `created_by` | Relation → users | |

### Catalog Loading Strategy: Stale-While-Revalidate

Serve local JSON immediately (millisecond-level), then silently fetch CDN in the background to update the cache. CDN failures are ignored. Catalog data is decoupled from software releases and always available offline.

---

## Stories

- [x] [5.1: Foundation](story5.1-foundation.md) — Core UI, category navigation, i18n
- [ ] [5.2: Store API & Display](story5.2-store-api.md) — online media fetch, SWR, detail page, icon/screenshot fallback, search
- [ ] 5.3: Deployment — one-click deployment integration
- [ ] 5.4: User Features — favorites, notes, custom apps
- [ ] 5.5  i18n

---

## Dependencies

- Epic 7 (Dashboard framework) completed
- PocketBase migrations for `store_user_apps` and `store_custom_apps`
- Deployment API `/api/ext/apps/deploy` available
