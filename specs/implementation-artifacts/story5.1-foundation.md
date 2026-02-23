# Story 5.1: Store Foundation — Core UI, Categories, i18n

**Epic**: 5 - App Store | **Priority**: P0 | **Status**: 🔲 Ready for Dev

## User Story

As a user, I can browse the application catalog with category filtering and search, so I can quickly find the app I need.

## Acceptance Criteria

- [ ] Store route `/store` renders within Dashboard layout (TanStack Router)
- [ ] App cards display: icon, name (`trademark`), short description (`overview`), category tag
- [ ] Primary category dropdown + secondary category chips (chips hidden when "All" selected)
- [ ] App count shown per category
- [ ] Search filters by `trademark` / `overview` in real time
- [ ] Pagination with page sizes: 12 / 24 / 48 / 96
- [ ] Loading state shown while data is fetching
- [ ] Error state shown with user-friendly message on fetch failure
- [ ] UI language follows Dashboard locale setting (en / zh)
- [ ] Responsive layout works at 320px – 1920px

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
