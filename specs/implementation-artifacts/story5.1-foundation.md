# Story 5.1: Store Foundation — Core UI, Categories, i18n

**Epic**: 5 - App Store | **Priority**: P0 | **Status**: ✅ Done

## User Story

As a user, I can browse the application catalog with category filtering and search, so I can quickly find the app I need.

## Acceptance Criteria

- [x] Store route `/store` renders within Dashboard layout (TanStack Router)
- [x] App cards display: icon, name (`trademark`), short description (`overview`), category tag
- [x] Primary category dropdown + secondary category chips (chips hidden when "All" selected)
- [x] App count shown per category
- [x] Search filters by `trademark` / `overview` in real time
- [x] Pagination with page sizes: 12 / 24 / 48 / 96
- [x] Loading state shown while data is fetching
- [x] Error state shown with user-friendly message on fetch failure
- [x] UI language follows Dashboard locale setting (en / zh)
- [x] Responsive layout works at 320px – 1920px

## Catalog JSON Data Structure

```
// catalog_{locale}.json — primary categories
[{ "key": "cms", "title": "...", "position": 5,
   "linkedFrom": { "catalogCollection": { "items": [ /* secondary categories */ ] } }
}]

// product_{locale}.json — each app
{ "key": "wordpress", "trademark": "WordPress", "overview": "...",
  "catalogCollection": {
    "items": [{ "key": "website", "title": "...",
      "catalogCollection": { "items": [{ "key": "cms" }] }  // → parent primary
    }]
  }
}
```

Filter logic: primary match → check `product.catalogCollection.items[*].catalogCollection.items[0].key`; secondary match → check `product.catalogCollection.items[*].key`.

## Key Design Decisions

- **UI**: shadcn/ui components + Tailwind CSS — consistent with Dashboard design system
- **Routing**: `dashboard/src/routes/_app/_auth/store/index.tsx` (TanStack Router file-based)
- **Data**: TanStack Query with `staleTime: 60 * 60 * 1000` (1h in-memory cache)
- **i18n**: react-i18next, namespace `store`

## Out of Scope

- App detail page (Story 5.2)
- Favorites / notes (Story 5.4)
- Deployment (Story 5.3)

## Dev Agent Record

**Date**: 2026-02-23 | **Agent**: Amelia (dev.agent)

### Completion Notes

- Installed `@tanstack/react-query`, `react-i18next`, `i18next`, `react-markdown`
- `main.tsx`: wrapped app with `QueryClientProvider`; initialized i18n via `src/lib/i18n.ts`
- i18n: bundled translations in `src/locales/{en,zh}/{store,common}.json`; locale auto-detected from browser, overridable via `localStorage`
- `src/lib/store-types.ts`: full TypeScript types for catalog/product JSON structures + `StoreFilters`, `PAGE_SIZES`
- `src/lib/store-api.ts`: `fetchStoreJson` with local-first + silent CDN background update; `useCatalog`/`useProducts` hooks; `enrichProducts`, `filterProducts`, `countByPrimaryCategory`, `countBySecondaryCategory` helpers
- `src/components/store/CategoryFilter.tsx`: primary dropdown with counts + secondary chips (hidden when All selected), ARIA-accessible
- `src/components/store/AppCard.tsx`: icon, trademark, overview (2-line clamp), category badge, deploy button
- `src/components/store/StorePagination.tsx`: smart page number generation, per-page selector (12/24/48/96), ARIA attributes
- `src/routes/_app/_auth/store/index.tsx`: full store page — loading/error state, useMemo for performance, pagination reset on filter change

### File List

- `dashboard/src/lib/store-types.ts` [NEW]
- `dashboard/src/lib/store-api.ts` [NEW]
- `dashboard/src/lib/i18n.ts` [NEW]
- `dashboard/src/locales/en/store.json` [NEW]
- `dashboard/src/locales/zh/store.json` [NEW]
- `dashboard/src/locales/en/common.json` [NEW]
- `dashboard/src/locales/zh/common.json` [NEW]
- `dashboard/src/components/store/AppIcon.tsx` [NEW]
- `dashboard/src/components/store/AppCard.tsx` [NEW]
- `dashboard/src/components/store/CategoryFilter.tsx` [NEW]
- `dashboard/src/components/store/StorePagination.tsx` [NEW]
- `dashboard/src/routes/_app/_auth/store/index.tsx` [NEW]
- `dashboard/src/main.tsx` [MODIFIED]
- `dashboard/src/routeTree.gen.ts` [AUTO-GENERATED]
- `dashboard/package.json` [MODIFIED — added 4 packages]
