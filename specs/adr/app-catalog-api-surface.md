# App Catalog API Surface

## Status
Proposed

## Context
App Catalog is now modeled as three current subdomains:

1. `Catalog Discovery`
2. `Custom App Authoring`
3. `Catalog Personalization`

The current implementation is split across multiple data sources and responsibilities:

1. official catalog data comes from static JSON bundles and CDN refresh
2. custom apps are stored in PocketBase `store_custom_apps`
3. favorites and notes are stored in PocketBase `store_user_apps`
4. template files live in the library or IAC workspace instead of one normalized catalog API

This has been acceptable for the first dashboard delivery, but it should not remain the long-term product API shape. The frontend currently understands external catalog JSON structure, merges official and custom records itself, and applies personalization client-side. That makes the product surface fragile and keeps domain rules in the browser.

This ADR defines the target backend API surface for App Catalog so that:

1. the frontend consumes a stable read model instead of raw source files
2. official apps, custom apps, personalization, and template references are normalized by the backend
3. PocketBase native collection APIs remain available for low-level inspection, but stop being the canonical product contract
4. deploy handoff can rely on one normalized catalog source of truth

Companion documents:

1. `specs/planning-artifacts/product-brief.md`
2. `specs/planning-artifacts/prd.md`
3. `specs/adr/app-lifecycle-api-surface.md`

## Decisions

### 1. API layering

The App Catalog backend should expose four layers of API:

1. **Canonical catalog business APIs**: product-facing routes used by dashboard catalog, custom app workflows, and deploy handoff
2. **Catalog source ingestion APIs**: admin or internal routes that refresh or reindex catalog source data
3. **Template and IaC primitive APIs**: lower-level file and template operations used by catalog and deploy workflows
4. **PocketBase native collection APIs**: generic record CRUD and query routes used for admin/debug inspection

The canonical product-facing logic must live in the custom catalog routes, not in raw PocketBase collection reads from the browser.

### 2. Canonical route groups

The canonical App Catalog route groups are:

1. `/api/catalog/categories/*`
2. `/api/catalog/apps/*`
3. `/api/catalog/custom-apps/*`
4. `/api/catalog/me/*`

Optional admin and internal support groups:

1. `/api/ext/catalog/sources/*`
2. `/api/ext/catalog/admin/*`

This split maps cleanly to the three current subdomains while leaving source refresh and indexing outside the main product API.

### 3. Canonical read model principles

All canonical read APIs should return a normalized catalog projection with these properties:

1. category structure is already flattened and validated; the frontend should not parse nested source JSON relationships
2. official apps and custom apps share a common summary shape where possible
3. personalization fields are merged into the response only for the authenticated caller
4. template relationship is exposed as a reference or summary object, not as raw file contents by default
5. deploy-facing fields are normalized for handoff, even when the underlying source differs between official library apps and custom apps

`Template` remains a core object in the response model, but it is not a peer route group yet because template lifecycle and publishing are not independent enough.

### 4. `categories` API

Purpose: provide the normalized category tree and category metadata used by catalog browsing.

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/catalog/categories` | list all primary and secondary categories | canonical category source for store filters |
| `GET` | `/api/catalog/categories/{key}` | get one category detail | includes parent/children and display metadata |
| `GET` | `/api/catalog/categories/{key}/apps` | list apps visible in one category | convenience projection; may proxy to app search |

The category API should return stable parent-child relationships independent of upstream catalog JSON nesting.

### 5. `apps` API

Purpose: expose official catalog discovery and normalized app detail for the App Store surface.

#### 5.1 Query routes

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/catalog/apps` | list visible catalog apps | supports category, search, source, tag, and pagination filters |
| `GET` | `/api/catalog/apps/{key}` | get one app detail | canonical app detail used by store dialog or detail page |
| `GET` | `/api/catalog/apps/{key}/deploy-source` | get normalized deploy handoff payload | returns source kind, template ref, and install metadata |
| `GET` | `/api/catalog/apps/{key}/related` | list related apps | optional recommendation or same-category projection |

Recommended list filters for `GET /api/catalog/apps`:

1. `primaryCategory`
2. `secondaryCategory`
3. `q`
4. `source=official|custom|all`
5. `visibility=all|owned|shared`
6. `favorite=true|false`
7. `limit`
8. `offset` or cursor-style pagination

#### 5.2 App detail response expectations

The normalized app detail should include:

1. base app identity: `key`, `title`, `overview`, `description`, `icon`, `screenshots`
2. category summary: primary and secondary categories
3. source summary: `official` or `custom`
4. template reference summary: template key, availability, and source type
5. deploy handoff metadata: install mode, source package, compose/template reference, capability flags
6. caller personalization: favorite state and note

The frontend should not need extra PocketBase calls to decorate app detail with favorite or note state.

### 6. `custom-apps` API

Purpose: provide canonical product APIs for custom app authoring instead of exposing raw PocketBase record CRUD directly to the browser.

#### 6.1 Query and detail routes

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/catalog/custom-apps` | list custom apps visible to current user | includes owned and shared visibility rules |
| `GET` | `/api/catalog/custom-apps/{id}` | get one custom app detail | includes authoring metadata and template reference |

#### 6.2 Mutation routes

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/catalog/custom-apps` | create a custom app | may optionally derive from official app/template |
| `PATCH` | `/api/catalog/custom-apps/{id}` | update custom app metadata | does not necessarily return raw template files |
| `DELETE` | `/api/catalog/custom-apps/{id}` | delete custom app | policy-controlled if shared references exist |
| `POST` | `/api/catalog/custom-apps/{id}/duplicate` | clone custom app | optional convenience behavior |
| `POST` | `/api/catalog/custom-apps/{id}/share` | change visibility to shared | can also accept share settings payload |
| `POST` | `/api/catalog/custom-apps/{id}/unshare` | return visibility to private | policy-controlled if dependents exist |

#### 6.3 Authoring rules

The custom app API should own these rules:

1. key uniqueness across official and custom catalog space
2. visibility enforcement
3. normalization of category references
4. association with template/IaC workspace
5. optional creation-from-official-app or creation-from-template workflow

### 7. `me` API for personalization

Purpose: expose caller-specific catalog state without forcing the frontend to coordinate direct writes to `store_user_apps`.

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/catalog/me/state` | get personalization state summary | favorites count, notes count, recent items if added later |
| `GET` | `/api/catalog/me/apps` | list personalized app states | favorite and note projections for current user |
| `PUT` | `/api/catalog/me/apps/{appKey}/favorite` | set favorite state | idempotent write preferred over toggle semantics |
| `PUT` | `/api/catalog/me/apps/{appKey}/note` | create or update note | body contains note text or null |
| `DELETE` | `/api/catalog/me/apps/{appKey}/note` | clear note | optional alternative to null note payload |

The backend should prefer idempotent personalization routes over toggle-only behavior because the client should not have to derive next state from a stale cache.

### 8. Source ingestion and admin routes

Purpose: manage official catalog refresh and normalized projection rebuild without mixing those concerns into the product-facing API.

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| `POST` | `/api/ext/catalog/sources/sync` | fetch latest source bundles and rebuild normalized projection | superuser |
| `GET` | `/api/ext/catalog/sources/status` | inspect source freshness and last sync result | superuser |
| `POST` | `/api/ext/catalog/sources/reindex` | rebuild normalized catalog projection from current source | superuser |
| `GET` | `/api/ext/catalog/admin/apps/{key}/raw` | inspect raw source payload for one app | superuser |
| `GET` | `/api/ext/catalog/admin/categories/raw` | inspect raw category source payload | superuser |

The current frontend-side "Sync Latest" behavior should eventually move behind these routes so the browser no longer fetches source bundles directly for revalidation.

### 9. Template and IaC primitive routes

Template files and IAC workspace writes remain important, but they are not the canonical App Catalog business API.

The catalog business API may depend on lower-level primitives such as:

1. reading library template files
2. creating custom template directories
3. uploading extra files
4. validating generated compose content

These primitives may continue to live under existing IaC or file route groups. App Catalog should orchestrate them, not expose them as its main product contract.

### 10. PocketBase native collection APIs

PocketBase already exposes native record APIs for:

1. `store_custom_apps`
2. `store_user_apps`

These remain useful for debugging and admin inspection, but they should not be treated as the canonical frontend contract for product behavior.

| Collection | Usefulness | Should main UI depend on it directly? | Reason |
| --- | --- | --- | --- |
| `store_custom_apps` | useful | no | too close to persistence shape; misses normalized app projection and template orchestration |
| `store_user_apps` | useful | no | persistence detail for personalization, not a stable product-facing contract |

### 11. Auth model

Recommended auth policy:

1. catalog query APIs require authenticated user access by default
2. personalization APIs are authenticated and scoped to the caller
3. custom app mutations require authenticated user access, with ownership and visibility rules enforced server-side
4. source ingestion and admin inspection routes require superuser auth

This fits the current product position better than making the canonical catalog API superuser-only.

### 12. MVP subset

The full target surface is larger than the first backend delivery. The minimum canonical subset should be:

1. `GET /api/catalog/categories`
2. `GET /api/catalog/apps`
3. `GET /api/catalog/apps/{key}`
4. `GET /api/catalog/apps/{key}/deploy-source`
5. `GET /api/catalog/custom-apps`
6. `POST /api/catalog/custom-apps`
7. `PATCH /api/catalog/custom-apps/{id}`
8. `DELETE /api/catalog/custom-apps/{id}`
9. `GET /api/catalog/me/apps`
10. `PUT /api/catalog/me/apps/{appKey}/favorite`
11. `PUT /api/catalog/me/apps/{appKey}/note`
12. `POST /api/ext/catalog/sources/sync`

That subset is enough to remove frontend dependence on raw source JSON shape while keeping implementation scope under control.

### 13. Normalized response schemas

The canonical App Catalog API should stabilize around a small number of response shapes reused across list, detail, personalization, and deploy handoff.

#### 13.1 Category tree

`GET /api/catalog/categories`

```json
{
	"items": [
		{
			"key": "cms",
			"title": "CMS",
			"position": 10,
			"appCount": 24,
			"children": [
				{
					"key": "website",
					"title": "Website",
					"position": 10,
					"appCount": 18,
					"parentKey": "cms"
				}
			]
		}
	],
	"meta": {
		"sourceVersion": "2026-04-02T00:00:00Z",
		"locale": "en"
	}
}
```

Schema notes:

1. `children` is always explicit; the frontend does not reconstruct links from nested source JSON
2. `appCount` is already normalized across official and visible custom apps when requested by the current API mode
3. `meta.sourceVersion` helps cache invalidation and UI sync display

#### 13.2 App summary

`GET /api/catalog/apps`

```json
{
	"items": [
		{
			"key": "wordpress",
			"title": "WordPress",
			"overview": "Open source publishing platform",
			"iconUrl": "https://.../wordpress.png",
			"source": "official",
			"visibility": "public",
			"primaryCategory": {
				"key": "cms",
				"title": "CMS"
			},
			"secondaryCategories": [
				{
					"key": "website",
					"title": "Website"
				}
			],
			"badges": ["hot"],
			"template": {
				"key": "wordpress",
				"source": "library",
				"available": true
			},
			"personalization": {
				"isFavorite": true,
				"hasNote": false
			},
			"updatedAt": "2026-04-02T00:00:00Z"
		}
	],
	"page": {
		"limit": 30,
		"offset": 0,
		"total": 214,
		"hasMore": true
	},
	"meta": {
		"locale": "en",
		"sourceVersion": "2026-04-02T00:00:00Z"
	}
}
```

Schema notes:

1. `source` is `official` or `custom`
2. `visibility` is `public`, `private`, or `shared`; official apps are always `public`
3. `template` is a summary reference, not raw template content
4. `personalization` is caller-specific and omitted or null for unauthenticated/public modes if those are added later

#### 13.3 App detail

`GET /api/catalog/apps/{key}`

```json
{
	"key": "wordpress",
	"title": "WordPress",
	"overview": "Open source publishing platform",
	"description": "...markdown...",
	"iconUrl": "https://.../wordpress.png",
	"screenshots": [
		{
			"key": "home",
			"url": "https://.../wordpress-home.png"
		}
	],
	"source": {
		"kind": "official",
		"visibility": "public",
		"author": null,
		"recordId": null
	},
	"categories": {
		"primary": {
			"key": "cms",
			"title": "CMS"
		},
		"secondary": [
			{
				"key": "website",
				"title": "Website"
			}
		]
	},
	"links": {
		"website": "https://wordpress.org",
		"docs": "https://support.websoft9.com/en/docs/wordpress",
		"github": "https://github.com/Websoft9/docker-library/tree/main/apps/wordpress"
	},
	"requirements": {
		"vcpu": 1,
		"memoryMb": 1024,
		"storageMb": 5120
	},
	"template": {
		"key": "wordpress",
		"source": "library",
		"available": true,
		"pathHint": "library/apps/wordpress"
	},
	"deploy": {
		"supported": true,
		"mode": "template",
		"sourceKind": "library",
		"defaultAppName": "WordPress"
	},
	"personalization": {
		"isFavorite": true,
		"note": null
	},
	"audit": {
		"createdAt": null,
		"updatedAt": "2026-04-02T00:00:00Z"
	}
}
```

Schema notes:

1. `source.recordId` is populated for custom apps and null for official apps
2. `template.pathHint` is informational only; file access still goes through proper APIs
3. `deploy` is intentionally lightweight; deeper handoff payload belongs to `/deploy-source`

#### 13.4 Deploy source payload

`GET /api/catalog/apps/{key}/deploy-source`

```json
{
	"app": {
		"key": "wordpress",
		"title": "WordPress",
		"source": "official"
	},
	"template": {
		"key": "wordpress",
		"source": "library",
		"available": true
	},
	"install": {
		"prefillMode": "target",
		"prefillSource": "library",
		"prefillAppKey": "wordpress",
		"prefillAppName": "WordPress"
	},
	"capabilities": {
		"hasComposeTemplate": true,
		"hasEnvTemplate": true,
		"supportsDirectDeploy": true
	}
}
```

Schema notes:

1. this payload is optimized for deploy handoff and should stay small
2. the frontend should not infer deploy semantics from mixed app detail fields once this endpoint exists

#### 13.5 Personalization list

`GET /api/catalog/me/apps`

```json
{
	"items": [
		{
			"appKey": "wordpress",
			"isFavorite": true,
			"note": "Need to test on low-memory host",
			"updatedAt": "2026-04-02T00:00:00Z"
		}
	]
}
```

Schema notes:

1. this route returns only caller-owned personalization state
2. app summary/detail routes may embed the matching record as a denormalized projection

## Consequences

### Positive

1. the frontend stops understanding source-specific catalog JSON structure
2. official apps, custom apps, and personalization can be merged once in the backend
3. deploy handoff can consume one normalized app reference model
4. PocketBase stays the persistence framework without becoming the public product API
5. future template lifecycle expansion remains possible without redesigning the catalog read model

### Negative

1. backend must own normalization, caching, and refresh logic for source bundles
2. one more projection layer must be tested and documented
3. source sync failure modes become backend responsibilities instead of frontend fallback behavior

### Rejected alternative

**Alternative:** keep the browser reading official JSON directly and continue using PocketBase native APIs for the rest.

**Why rejected:** this keeps source parsing, merge rules, and personalization joins in the frontend, which is acceptable for a first module release but not for a stable App Catalog domain contract.

## Next steps

1. define the normalized response schema for category tree, app summary, app detail, and deploy source payload
2. decide whether catalog projection is materialized into PocketBase collections or cached in memory/file with rebuild support
3. implement the MVP subset route group under `/api/catalog/*`
4. update dashboard store data access to use the canonical routes before removing direct source JSON fetches