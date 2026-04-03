# Coding Decisions - UI

## Link Back

For global engineering conventions, see [coding-decisions.md](coding-decisions.md).
For product IA, navigation grouping, and module ownership, see [architecture.md](architecture.md) and [prd.md](prd.md).

## UI{#ui}

Design system foundation: shadcn/ui + Tailwind with light/dark theme support.

### Dialog Size Tiers{#dialog-sizes}

Standardize dialog widths by content type. Override with `className` on `<DialogContent>` only when needed.

| Tier | Tailwind Class | Width | Use Case |
|------|---------------|-------|----------|
| **sm** | `max-w-sm` | 384px | Confirmations, simple alerts |
| **default** | (shadcn default `sm:max-w-lg`) | 512px | Forms, simple CRUD dialogs |
| **md** | `max-w-2xl` | 672px | Multi-field forms, detail views |
| **lg** | `max-w-4xl` | 896px | Terminal/code output, wide tables, command runners |
| **xl** | `max-w-6xl` | 1152px | Complex editors, side-by-side layouts |
| **full** | `max-w-[90vw] max-h-[85vh]` | ~90% viewport | Log viewers, full-screen editors |

- Always pair large dialogs with `max-h-[85vh] flex flex-col` for scroll containment
- Mobile fallback is handled by shadcn's `max-w-[calc(100%-2rem)]`
- Prefer the smallest tier that avoids horizontal scrolling or cramped content

### Page Header{#page-header}

All list and index pages use the same header pattern:

- Title: `text-2xl font-bold tracking-tight`
- Description: `text-muted-foreground mt-1`

### Empty State{#empty-state}

When a list page has no records, do not render the table header. Show a dedicated empty state with a clear create action.

### List Page Minimal Pattern{#list-page-minimal-pattern}

For standard list/index pages, use this minimal interaction pattern by default:

1. Include a search input.
2. Header actions are right-aligned as two buttons: `Refresh` (left) + `Create` (right).
3. Sortable table headers use a **single-arrow** indicator only (no dual-arrow icon).
4. If there is no separate detail page, each `Name` cell must support inline row expansion:
  - Show a rotatable `>` icon before name text.
  - Click toggles expanded details under the same row.
  - Expanded content should include full `ID` and key metadata.
5. Row actions are shown in a three-dot (`⋮`) dropdown menu, not as always-visible inline buttons.

Keep the page visually minimal: no extra chrome, no redundant columns, no duplicate actions.

## Tech Stack{#tech-stack}

Core UI stack:

- React 19 + TypeScript 5.9
- Vite 7
- Tailwind CSS 4 + shadcn/ui
- TanStack Router 1.x + TanStack Query 5.x
- PocketBase JS SDK 0.26
- i18next / react-i18next
- lucide-react, Monaco Editor, react-markdown

Path alias: `@` → `src/`

## Directory Conventions{#directories}

- `src/components/<feature>/`: feature-scoped components
- `src/components/ui/`: shadcn primitives; do not edit directly
- `src/contexts/`: React providers
- `src/hooks/`: shared hooks
- `src/lib/`: API clients and utilities
- `src/routes/`: TanStack Router file routes; `routeTree.gen.ts` is generated
- `src/locales/<lang>/<ns>.json`: translation files

## Routing{#routing}

TanStack Router uses file-based routing. `routeTree.gen.ts` is generated and must not be edited by hand.

- `__root.tsx`: theme and auth providers
- `_app.tsx`: layout wrapper
- `_auth.tsx`: redirects unauthenticated users to `/login`
- `_superuser.tsx`: blocks non-superusers from admin-only pages

Use `beforeLoad` for route guards.

## Data Fetching{#data-fetching}

Use TanStack Query + PocketBase SDK. API logic lives in `src/lib/*-api.ts`.

- `pb.ts`: singleton PocketBase client
- `store-api.ts`: store catalog and products
- `iac-api.ts`: IaC file read and write
- `store-user-api.ts`: user favorites and notes
- `store-custom-api.ts`: custom app management

Rules:
- Use `pb.collection('name').getList(…)` for PocketBase collections
- Use `pb.send('/api/<domain>/…', {})` for custom Go endpoints such as `iac`, `servers`, `proxy`, and `deploy`
- Do not use `/api/ext/`; it is deprecated and inconsistent with the API naming baseline in [coding-decisions.md](coding-decisions.md)
- Wrap requests with `useQuery` or `useMutation` and keep `queryKey` arrays consistent

## Authentication{#auth}

Two PocketBase collections: `users` (regular) and `_superusers` (admin).

- `AuthContext` exposes: `user`, `isAuthenticated`, `isLoading`, `login()`, `logout()`
- Token stored by PocketBase SDK in `localStorage` automatically
- Guard regular pages with `_auth.tsx`; guard admin pages with `_superuser.tsx`
- Distinguish user type via `pb.authStore.record?.collectionName`

## i18n{#i18n}

- Namespaces: `common`, `store` (add new namespaces in `src/lib/i18n.ts`)
- Locale files: `src/locales/{en,zh}/<namespace>.json`
- Default language: English; user selection persisted in `localStorage` key `ws9-locale`
- Usage: `const { t } = useTranslation('namespace')`

## shadcn/ui Rules{#shadcn}

- Never modify files under `src/components/ui/`; they are shadcn-managed primitives.
- Add new shadcn components via CLI: `npx shadcn@latest add <component>`.
- Put custom variants in feature components, not in primitives.

