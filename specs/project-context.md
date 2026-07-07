---
project_name: 'appos'
user_name: 'Websoft9'
date: '2026-07-07'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

> [!NOTE]
> The authoritative source for exact dependency versions is `backend/go.mod` and
> `web/package.json`. This section documents the major versions for AI context only.
> Always check those files for the current patch/minor versions.

### Architecture
Monorepo: Go backend + React/Vite frontend, built into a single Docker image (Alpine).

### Backend
- **Go 1.26** — CGO_ENABLED=0 static binary
- **PocketBase 0.39** — auth, DB, admin UI, custom Go routes via `backend/domain/routes/`
- **Asynq + Redis** — async task queue
- Domain logic in `backend/domain/`, persistence in `backend/infra/persistence/`
- Templates via Go `embed.FS` in `backend/domain/resource/*/templates/`

### Frontend
- **React 19** + **Vite 7** — bundled output to `web/dist/`
- **TypeScript 5.9** — strict mode
- **TanStack Router 1** — file-based routing, auto-generates `routeTree.gen.ts`
- **TailwindCSS 4** — CSS-first config (@tailwindcss/vite), NO `tailwind.config.js`
- **PocketBase JS SDK 0.26** — the ONLY HTTP client (`import { pb } from '@/lib/pb'`)
- **i18next 25** + **react-i18next 16**
- **xterm 5** + **Monaco Editor** — terminal + code editor
- **Recharts 3** — charts

### Testing
- Go: `testing` package + PocketBase `tests.TestApp` (baseline-clone fixture)
- Web: **Vitest 4** + **Testing Library 16** + jsdom — colocated `-*.test.tsx` files
- E2E: container smoke scripts in `tests/e2e/`

### Lint & Format
- Go: golangci-lint + gofmt
- Web: **ESLint 9** (flat config) + **Prettier 3** (no semicolons, single quotes)
- TypeScript: `no-explicit-any: off`, `exhaustive-deps: off`

---

## Critical Implementation Rules

### Language-Specific Rules

#### Go

**Build target**: `CGO_ENABLED=0` — always produce a static binary. No cgo, no dynamic linking.

**Custom API routes return raw JSON only.** Never wrap responses in PocketBase collection envelopes
(`items[]`, `page`, `totalPages`). The frontend `pb.send` expects raw arrays/objects directly.

**Superuser-only mutations.** All resource-changing routes (`POST/PUT/DELETE` on
`/api/instances`, `/api/connectors`, `/api/provider-accounts`, etc.) must bind
`apis.RequireSuperuserAuth()` on the router group.

**Templates via `embed.FS`.** Instance and connector config templates are embedded at compile time
from `backend/domain/resource/{instances,connectors}/templates/`. Do not read from disk at runtime.

**Lint**: `errcheck` runs on production code (not tests). `gosec` rules G304 (file path from variable)
and G115 (integer overflow) are suppressed — don't reintroduce them.

#### TypeScript

**Strict mode ON.** `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`.

**`verbatimModuleSyntax: true`.** Imports must use `import type` for type-only imports.
`import { type Foo }` is NOT sufficient — use `import type { Foo }`.

**`erasableSyntaxOnly: true`.** No enums, no namespaces — prefer `const` objects or union types.

**Path alias `@/`** → `./src/`. Always import from `@/components/...`, `@/lib/...`, `@/routes/...`.

**Selected lint relaxations:**
- `@typescript-eslint/no-explicit-any`: OFF — `any` is allowed
- `react-hooks/exhaustive-deps`: OFF — effect deps are not strictly enforced

### Framework-Specific Rules

#### PocketBase Integration

**Backend**: The PocketBase framework provides auth, DB, migrations, and admin UI. Custom API
routes are registered in `backend/domain/routes/routes.go` via `register*()` functions.

**Frontend `pb.send` is the ONLY HTTP client.** Never use `fetch` or `axios` directly.
It returns **raw JSON** for custom routes — NOT PocketBase-wrapped responses with
`items[]` / `page` / `totalPages`.

```ts
// GET list → direct array
const items = await pb.send<InstanceRecord[]>('/api/instances', { method: 'GET' })
// GET single → direct object
const item = await pb.send<InstanceRecord>(`/api/instances/${id}`, { method: 'GET' })
// Mutations → superuser required
await pb.send('/api/instances', { method: 'POST', body: payload })
```

#### TanStack Router

**File-based routing**: Route files under `web/src/routes/` define the route tree.
`web/src/routeTree.gen.ts` is **auto-generated** by the Vite plugin — NEVER edit it manually.

**Link component**: Always use `Link` from `@tanstack/react-router`, NOT raw `<a>` tags
(unless for external URLs).

```tsx
<Link to="/servers/$serverId" params={{ serverId: 'abc' }}>Server</Link>
```

#### React 19 Patterns

**Hooks**: Use React 19's built-in features. No third-party hooks library needed.

**No forwardRef wrappers**: React 19 supports `ref` as a regular prop on all components.

#### TailwindCSS 4

**CSS-first config, no `tailwind.config.js`.** All configuration is in CSS files via
`@theme` directives. Use utility classes directly in JSX.

**Class composition**: Prefer `cn()` from `clsx` + `tailwind-merge` for conditional classes
(project uses `class-variance-authority` + `tailwind-merge`).

#### i18next

**Two-part key pattern**: `namespace.property`, e.g. `servers.connectionTab.connected`.
All user-visible strings go through `t()` — never hardcode English text in JSX.

**Tests mock i18next** at module level with a local lookup-table `t` function:
```ts
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = { ... }
      return labels[key] ?? key
    }
  }),
}))
```

### Testing Rules

#### Go Test Architecture

**Baseline-clone fixture** (used by `domain/routes/`, `domain/worker/`, `domain/monitor/`):
- `sync.Once` migrates one PocketBase app per package as a baseline template
- Each test calls `newTestEnv(t)` which clones from baseline for isolation
- Use `t.Cleanup()` / `defer te.cleanup()` to clean up after each test
- NEVER share a single live app instance across tests — it breaks isolation

```go
var pkgBaselineOnce sync.Once
var pkgBaselineDir  string

func newTestEnv(t *testing.T) *testEnv {
    t.Helper()
    baselineDir, _ := getBaseline()
    app, _ := tests.NewTestApp(baselineDir)
    return &testEnv{app: app}
}
```

**HTTP route tests**: Use `httptest.NewRecorder` + `httptest.NewRequest`. Test auth
boundaries: superuser routes return 401 without token.

**Test file placement**: `*_test.go` alongside source files in the SAME package.

#### Web Test Architecture

**Runner**: Vitest 4 with jsdom environment. Config in `web/vitest.config.ts`.

**Test file naming**: `-*.test.tsx` or `*.test.ts`, colocated with source:
```
src/components/servers/ServerConnectionTab.tsx
src/components/servers/ServerConnectionTab.test.tsx
```

**Mocking rules** (applied in EVERY component/page test):
1. `vi.mock('@/lib/pb', () => ({ pb: { send: vi.fn() } }))` — always
2. `vi.mock('react-i18next', ...)` — always, with lookup-table `t` function
3. `vi.mock('@tanstack/react-router', ...)` — when page renders `<Link>`
4. `afterEach(() => cleanup())` — always

**`sendMock` pattern**: Central mock variable with route-based dispatch:
```ts
sendMock.mockImplementation((path, options) => {
  if (path === '/api/instances' && options?.method === 'GET') return Promise.resolve([...])
  return Promise.resolve({})
})
```

**Component tests**: Use `render()`, `screen.getByText()` / `queryByText()`, `fireEvent.click()`.
Test element existence and callback invocation — NOT CSS styles.

#### Testing Gaps to Close (Priority Order)

| Priority | Area | What to test |
|----------|------|-------------|
| P0 | `domain/resource/shared` (5 files) | mapRow/buildPayload variant logic |
| P0 | `domain/lifecycle/model` (4 files) | deployment state machine transitions |
| P0 | `domain/dockerops` (1 file) | Docker command generation |
| P1 | `domain/monitor/metrics/tsdb` (2 files) | Write/query/cleanup logic |
| P1 | `web/components/ai/` (2 files) | Chat message display/send |
| P1 | `web/components/store/` (11 files) | App store search/filter/install |
| P2 | `web/components/users/` (3 files) | User CRUD dialogs |
| P2 | `web/pages/publish/` + `pages/docker/` | Page rendering |

### Code Quality & Style Rules

#### Formatting

**Prettier** (web/): no semicolons, single quotes, tabWidth 2, printWidth 100, no arrow parens.

**gofmt** (backend/): standard Go formatting. No custom rules.

#### Linting

**Go**: golangci-lint with gosec, govet, errcheck, staticcheck, unused, ineffassign, misspell.
`errcheck` and `ineffassign` are suppressed in test files only.

**Web**: ESLint 9 flat config. Explicitly disabled rules:
- `@typescript-eslint/no-explicit-any` — OFF
- `react-hooks/exhaustive-deps` — OFF
- `react-hooks/set-state-in-effect` — OFF
- `react-hooks/static-components` — OFF

#### Naming Conventions

**Go**: Exported identifiers are PascalCase, unexported are camelCase. Test functions:
`TestXxxYyy`. Error variables: `ErrXxx`. Package names: lowercase, single word preferred.

**TypeScript/TSX**:
- Files: kebab-case (`server-connection-tab.tsx`, `api-error.ts`)
- React components: PascalCase (`ServerConnectionTab`)
- Functions/variables: camelCase (`buildPayload`, `mappedRow`)
- Types/interfaces: PascalCase (`InstanceRecord`, `ServerConnectionPresentationSpec`)
- Test files: `-*.test.tsx` suffix (e.g. `ServerConnectionTab.test.tsx`)

#### Code Organization

**Backend**:
```
backend/
├── cmd/           # entry points
├── domain/        # business logic (routes, worker, monitor, secrets, etc.)
├── infra/         # infrastructure (persistence, tunnel, docker, migrations)
├── config/        # configuration constants
└── docs/          # OpenAPI specs
```

**Frontend**:
```
web/src/
├── components/    # shared UI components
├── pages/         # page-level components
├── routes/        # TanStack file-based routes
├── lib/           # utilities, API helpers, pb client
├── hooks/         # custom React hooks
└── test/          # test setup only (setup.ts)
```

#### Documentation

**No comments policy**: Do NOT add explanatory comments to code. Code should be
self-documenting. Exceptions: exported function doc comments, complex algorithmic logic.

**AGENTS.md**: The primary AI context file at project root. Update it when adding new
conventions or patterns.

### Development Workflow Rules

#### Build Pipeline

```bash
make build              # backend binary (CGO_ENABLED=0) + frontend dist — ALWAYS after changes
make lint               # golangci-lint + eslint + typecheck
make openapi-sync       # generate + merge + validate OpenAPI specs — ALWAYS after route changes
```

#### Quality Gate (CI)

`make check` runs the full gated pipeline (stops on first error):
1. lint (golangci-lint + eslint + typecheck)
2. fmt (gofmt + prettier)
3. openapi-check (spec coverage validation)
4. test (Go + Web + E2E smoke)

#### Test Commands

```bash
make test backend                # ALL Go tests
make test web                    # ALL Vitest tests
make test backend-targeted TARGET=TestName  # single Go test
npx vitest run src/path/to/file.test.tsx    # single web test
make test e2e fast               # container smoke tests
```

#### Focused Regression Targets

```bash
make test backend-iac        # IaC domain + route regression
make test backend-software   # software catalog/executor regression
```

#### CI Workflows

- **pr-gate.yml**: PR → main triggers full quality gate (lint + test + openapi + sec + e2e)
- **dev-fast-ci.yml**: Push to non-main branches triggers fast lint + fast tests + focused regression
- **main-post-merge.yml**: Push to main triggers quality gate + Docker image build + vulnerability scan

#### Route Development

1. Define route in `backend/domain/routes/routes.go` (or sibling `register*` file)
2. Write an HTTP test in the same package (follow baseline-clone pattern)
3. Run `make openapi-sync` to update specs
4. Run `make test backend-targeted TARGET=TestNewRoute` before committing

### Critical Don't-Miss Rules

#### 1. NEVER edit `routeTree.gen.ts`

This file is auto-generated by `@tanstack/router-vite-plugin`. Any manual edit will be
overwritten on the next Vite build. Define routes in `web/src/routes/` and let the
plugin regenerate.

#### 2. `buildPayload` expects mapped row data, NOT raw API

The `buildPayload` function flattens the mapped row back into the API shape.
If you fetch a single item from the API via `pb.send`, you MUST pass it through
`mapRow()` before feeding it to `buildPayload()`. Otherwise the payload will be
malformed (nested config won't be reconstructed correctly).

#### 3. Custom API routes return raw JSON only

Never wrap responses in `items[]` / `page` / `totalPages`. The frontend `pb.send`
treats custom route responses as raw JSON. If you accidentally use PocketBase's
collection response helpers, the frontend will break.

#### 4. Resource mutations require superuser auth

```go
mutations.Bind(apis.RequireSuperuserAuth())
mutations.PUT("/{id}", handleInstanceUpdate)
```

When adding new mutation endpoints to `/api/instances`, `/api/connectors`,
`/api/provider-accounts`, or `/api/ai-providers`, always bind the superuser
middleware. GET-only routes do not need it.

#### 5. Go embed patterns don't read from disk at runtime

Templates in `backend/domain/resource/{instances,connectors}/templates/` use `//go:embed`.
These are compiled into the binary. Do NOT use `os.ReadFile` or similar runtime
filesystem reads for template data.

#### 6. Frontend `pb.send` is the ONLY HTTP client

Never use `fetch`, `axios`, or `XMLHttpRequest` directly. All API calls go through
`import { pb } from '@/lib/pb'`. This ensures consistent auth token handling and
base URL resolution.

#### 7. Go tests: single live app instance breaks things

Follow the baseline-clone pattern documented in `tests/README.md`. A shared live
app instance across tests makes them order-dependent and breaks isolation.

#### 8. Prettier rules are non-negotiable

The codebase uses: no semicolons, single quotes, tabWidth 2, printWidth 100.
Generated code MUST match these rules or ESLint + Prettier CI will fail.

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-07-07
