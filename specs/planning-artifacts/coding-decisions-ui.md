# Coding Decisions - UI

## Link Back

For global engineering conventions, see [coding-decisions.md](coding-decisions.md).

## UI{#ui}

Design System Foundation (shadcn/ui, Tailwind, Dark/Light theme)

### Dialog Size Tiers{#dialog-sizes}

Standardized dialog widths based on content type. Override via `className` on `<DialogContent>`.

| Tier | Tailwind Class | Width | Use Case |
|------|---------------|-------|----------|
| **sm** | `max-w-sm` | 384px | Confirmations, simple alerts |
| **default** | (shadcn default `sm:max-w-lg`) | 512px | Forms, simple CRUD dialogs |
| **md** | `max-w-2xl` | 672px | Multi-field forms, detail views |
| **lg** | `max-w-4xl` | 896px | Terminal/code output, wide tables, command runners |
| **xl** | `max-w-6xl` | 1152px | Complex editors, side-by-side layouts |
| **full** | `max-w-[90vw] max-h-[85vh]` | ~90% viewport | Log viewers, full-screen editors |

**Guidelines:**
- Always pair large dialogs with `max-h-[85vh] flex flex-col` for scroll containment
- Mobile fallback is handled by shadcn's `max-w-[calc(100%-2rem)]`
- Prefer the smallest tier that avoids horizontal scrolling or cramped content

---

## Tech Stack{#tech-stack}

| Package | Version | Role |
|---------|---------|------|
| React | 19 | UI framework |
| Vite | 7 | Build tool |
| TypeScript | 5.9 | Language |
| Tailwind CSS | 4 | Styling |
| shadcn/ui | — | Component primitives (via Radix UI) |
| TanStack Router | 1.x | File-based routing + code-gen |
| TanStack Query | 5.x | Server state / data fetching |
| PocketBase JS SDK | 0.26 | API client + auth store |
| i18next / react-i18next | 25/16 | i18n |
| lucide-react | 0.56x | Icons |
| Monaco Editor | 4.x | Code editor widget |
| react-markdown | 10 | Markdown rendering |

Path alias: `@` → `src/`

---

## Directory Conventions{#directories}

```
src/
  components/<feature>/   # Feature-scoped components (docker/, store/, resources/, layout/, users/)
  components/ui/          # shadcn primitives — DO NOT edit these files
  contexts/               # React context providers (AuthContext, LayoutContext)
  hooks/                  # Shared custom hooks
  lib/                    # API clients and utilities (*-api.ts, *-types.ts, pb.ts, i18n.ts, utils.ts)
  routes/                 # TanStack Router file routes (auto code-gen → routeTree.gen.ts)
  locales/<lang>/<ns>.json  # i18n translation files
```

---

## Routing{#routing}

TanStack Router with **file-based routing**. `routeTree.gen.ts` is auto-generated — never edit by hand.

Route hierarchy and guards:

```
__root.tsx          ThemeProvider + AuthProvider
  _app.tsx          (layout wrapper)
    _auth.tsx       → redirect to /login if !pb.authStore.isValid
      _superuser.tsx → redirect to / if collectionName !== '_superusers'
    login / register / forgot-password / reset-password / setup
```

**Route guard pattern** — use `beforeLoad`:

```tsx
beforeLoad: async ({ location }) => {
  if (!pb.authStore.isValid) throw redirect({ to: '/login', search: { redirect: location.href } })
}
```

---

## Data Fetching{#data-fetching}

**TanStack Query + PocketBase SDK.** All API logic lives in `src/lib/*-api.ts`.

| File | Scope |
|------|-------|
| `pb.ts` | Singleton `pb` client (base URL `/`, proxied by Nginx) |
| `store-api.ts` | App Store catalog/products (local-first + CDN background sync) |
| `iac-api.ts` | IaC file read/write (`/api/ext/iac`) |
| `store-user-api.ts` | User favorites / notes |
| `store-custom-api.ts` | Custom app management |

**Rules:**
- Use `pb.collection('name').getList(…)` for PocketBase collections
- Use `pb.send('/api/ext/…', {})` for custom Go endpoints
- Wrap with `useQuery` / `useMutation`; keep `queryKey` arrays consistent

---

## Authentication{#auth}

Two PocketBase collections: `users` (regular) and `_superusers` (admin).

- `AuthContext` exposes: `user`, `isAuthenticated`, `isLoading`, `login()`, `logout()`
- Token stored by PocketBase SDK in `localStorage` automatically
- Guard regular pages with `_auth.tsx`; guard admin pages with `_superuser.tsx`
- Distinguish user type via `pb.authStore.record?.collectionName`

---

## i18n{#i18n}

- Namespaces: `common`, `store` (add new namespaces in `src/lib/i18n.ts`)
- Locale files: `src/locales/{en,zh}/<namespace>.json`
- Default language: English; user selection persisted in `localStorage` key `ws9-locale`
- Usage: `const { t } = useTranslation('namespace')`

---

## shadcn/ui Rules{#shadcn}

- **Never modify** files under `src/components/ui/` — they are shadcn-managed primitives
- Add new shadcn components via CLI: `npx shadcn@latest add <component>`
- Custom variants go in the feature component, not in the primitive

