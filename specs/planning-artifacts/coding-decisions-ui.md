# Coding Decisions - UI

## Link Back

For global engineering conventions, see [coding-decisions.md](coding-decisions.md).
For product IA, navigation grouping, and module ownership, see [architecture.md](architecture.md) and [prd.md](prd.md).

## UI{#ui}

Design system foundation: shadcn/ui + Tailwind with light/dark theme support.

Scope note:

- This file owns frontend engineering conventions and implementation baselines.
- Canonical UX behavior, page patterns, IA, state rules, and interaction contracts live in `ux-designs/ux-appos-canonical/DESIGN.md` and `ux-designs/ux-appos-canonical/EXPERIENCE.md`.

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

### Drawer Size Tiers{#drawer-sizes}

Standardize side-drawer widths by tier name. For drawers built with `<SheetContent>`, prefer a shared tier token over ad hoc pixel values.

| Tier | Target Width | Implementation Contract | Use Case |
|------|--------------|-------------------------|----------|
| **sm** | 384px | `width/max-width: min(384px, calc(100vw - 2rem))` | Lightweight metadata, confirmations, short read-only panels |
| **md** | 672px | `width/max-width: min(672px, calc(100vw - 2rem))` | Multi-section detail panels, compact editors |
| **lg** | 896px | `width/max-width: min(896px, calc(100vw - 2rem))` | Server/resource detail drawers, command surfaces, wide metadata panels |
| **xl** | 1152px | `width/max-width: min(1152px, calc(100vw - 2rem))` | Complex multi-column side workspaces |
| **full** | ~90vw | `width/max-width: min(90vw, calc(100vw - 2rem))` | Large inspectors, log viewers, near-fullscreen side panels |

- Default drawer side is `right` unless the workflow specifically benefits from left anchoring.
- Drawer width should be chosen by tier name only. Future implementations should use a shared prop or mapping such as `drawerTier="lg"`, not hardcoded per-page width values.
- Because the base `SheetContent` side variants may include width caps such as `sm:max-w-sm`, width tiers must be applied in a way that reliably overrides those defaults. Use a shared style map or helper when necessary.
- Standard drawer surface: `overflow-y-auto`, full-height side panel, standard content padding (`p-6` desktop, reduce only when density is required).
- Use `lg` as the default for detail drawers when the content includes tabs, actions, or 3-column metadata.
- Prefer `md` for simple read-only detail drawers and `xl` or `full` only when smaller tiers would force horizontal scrolling.

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
- `catalog-api.ts`: normalized backend catalog reads
- `store-presenter.ts`: store presentation helpers and local search-history helpers
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
