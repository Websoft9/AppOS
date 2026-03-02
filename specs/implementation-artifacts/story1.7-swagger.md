# Story 1.7: Swagger Baseline

**Epic**: Epic 1 - Infrastructure & Build System  
**Priority**: P1  
**Status**: Ready for Dev

---

## User Story

As a frontend developer and API integrator, I want a stable OpenAPI/Swagger contract for AppOS custom extension APIs, so that I can develop and validate integrations without guessing request/response shapes.

---

## Scope (MVP)

- Only cover AppOS custom routes under `/api/ext/*`
- Do not document PocketBase built-in dynamic APIs in this story
- Serve one Swagger UI page from backend runtime

---

## Domain Grouping (Business-first)

Swagger tags are grouped by business domain (not by Go file name):

- `Platform Bootstrap` → `/api/ext/setup/*`, `/api/ext/auth/*`
- `Runtime Operations` → `/api/ext/docker/*`, `/api/ext/services/*`, `/api/ext/proxy/*`, `/api/ext/system/*`, `/api/ext/backup/*`
- `Resource` → `/api/ext/resources/*`
- `Settings` → `/api/ext/settings/*`
- `Users` → `/api/ext/users/*`
- `Space` → `/api/ext/space/*`
- `IaC` → `/api/ext/iac/*`
- `Servers Operate` → `/api/ext/terminal/*`
- `Tunnel` → `/api/ext/tunnel/*`
- `Logs` → `*/logs` related endpoints across domains
- `Audit` → `/api/ext/audit/*` (reserved for current/future audit APIs)

Notes:
- Tag naming must remain stable even if handlers move between files
- Each endpoint belongs to exactly one primary business tag

---

## Acceptance Criteria

- [ ] OpenAPI 3.0 spec file exists for `/api/ext/*` core groups (docker, proxy, system, services, backup, resources, space, iac, terminal, tunnel)
- [ ] Backend exposes Swagger UI at `/api/ext/docs` (or `/docs`) in dev and production
- [ ] `make openapi-lint` command validates spec successfully in CI/local
- [ ] At least 5 representative endpoints include request body schema, response schema, and auth requirement
- [ ] API auth in docs explicitly states: routes require authenticated user/superuser according to route group
- [ ] README includes where to access docs and the MVP boundary (custom ext routes only)
- [ ] OpenAPI uses business-domain tags and every documented endpoint is tagged exactly once
- [ ] Mock execution is available for at least one happy-path collection (importable request examples or mock server from OpenAPI)
- [ ] A Go test (`routes_coverage_test.go`) asserts every registered `/api/ext/*` route has a matching path in `ext-api.yaml`; test runs in CI and fails on missing coverage

---

## Non-Goals

- Full PocketBase built-in API OpenAPI coverage
- Auto-generating schema from runtime collection metadata
- SDK generation and versioned API portal

---

## Implementation Notes (Minimal Path)

- Keep one source-of-truth spec file in repo: `backend/docs/openapi/ext-api.yaml`
- Spec is embedded into the appos binary via `backend/docs/openapi/docs.go` (`//go:embed`) — no nginx dependency
- Swagger UI served at `GET /openapi` (HTML, loads UI assets from CDN; only the YAML is embedded)
- Raw spec served at `GET /openapi/spec` (YAML, public, CORS-open for tooling)
- Start manual-first: hand-written schemas for high-value endpoints, then iterate
- Add CI step to prevent broken spec merge

---

## Mock Execution Strategy (Beyond Static Docs)

Goal: let frontend/integration work continue when backend endpoint is incomplete.

MVP decision: use an OpenAPI-driven mock server (e.g. Prism, Stoplight) for selected paths.

MVP requirement for this story:
- At least one domain (`Runtime Operations` or `Workspace & Files`) has a runnable mock server config
- Mock covers one happy-path response and one error response (`401` or `400`)

---

## Implementation Tasks

- [x] Create endpoint inventory table (pre-seeded below; complete remaining rows)
- [x] Finalize tag taxonomy and add to OpenAPI top-level `tags`
- [ ] Document P0 domain endpoints with schemas and examples
- [x] Add Swagger UI route and static spec hosting (`GET /openapi`, `GET /openapi/spec`)
- [x] Add `openapi-lint` command and CI check (`make openapi-check`)
- [x] Add one runnable mock workflow and short usage note in README
- [x] Write `routes_coverage_test.go` and add `go test` to CI

### Route Coverage Test

File: `backend/internal/routes/routes_coverage_test.go` (already committed)

How it works (no runtime router introspection needed):

1. Scans every non-test `.go` file in the `routes` package line-by-line
2. Seeds known base paths: `g → /api/ext`, then tracks each `.Group()` chain
3. Collects all `.GET/.POST/.PUT/.DELETE/.PATCH` calls whose resolved prefix starts with `/api/ext`
4. Reads `docs/openapi/ext-api.yaml`, extracts all `paths:` keys starting with `/api/ext`
5. Reports any code route not present in the spec → `go test` fails

Current detection count: **150 routes** across all route files.

The test skips (not fails) if the spec file doesn't exist yet, enabling gradual rollout.
Once the spec exists, any new unspecced route will break CI automatically.

Spec location: `backend/docs/openapi/ext-api.yaml`
Embed package: `backend/docs/openapi/docs.go`

---

## Endpoint Inventory (Merged)

Purpose: provide a single source of truth for Swagger scope, ownership, and rollout order.

### Fill Rules

- One row per endpoint (method + path)
- `Business Domain` must match Story 1.7 tag taxonomy
- `Auth Type` uses one of: `public`, `auth`, `superuser`
- `Priority` uses one of: `P0`, `P1`, `P2`
- `Swagger Status` uses one of: `not-started`, `in-progress`, `done`
- `Mock Ready` uses one of: `yes`, `no`

### Endpoint Inventory Table

| Business Domain | Route Group | Method | Path | Auth Type | Request Schema | Response Schema | Error Cases | Priority | Owner | Swagger Status | Mock Ready | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Runtime Operations | docker | GET | /api/ext/docker/servers | auth | query: server_id? | 200: DockerServer[] | 401, 500 | P0 | backend | not-started | no | |
| Runtime Operations | services | GET | /api/ext/services | auth | none | 200: ServiceStatus[] | 401, 500 | P0 | backend | not-started | no | |
| IaC | iac | GET | /api/ext/iac | superuser | query: path | 200: FileListResponse | 400, 401, 403 | P0 | backend | not-started | no | |
| Space | space | GET | /api/ext/space/quota | auth | none | 200: SpaceQuota | 401, 500 | P0 | backend | not-started | no | |
| Remote Access | terminal | GET | /api/ext/terminal/ssh/{serverId} | auth | path: serverId | 101 websocket | 401, 404, 500 | P1 | backend | not-started | no | ws endpoint |

### Domain Coverage Checklist

> Track which domains have all P0 endpoints documented in the table above.

- [ ] Platform Bootstrap (`setup`, `auth`)
- [ ] Runtime Operations (`docker`, `proxy`, `system`, `services`, `backup`)
- [ ] Resource (`resources`)
- [ ] Settings (`settings`)
- [ ] Users (`users`)
- [ ] Space (`space`)
- [ ] IaC (`iac`)
- [ ] Servers Operate (`terminal`)
- [ ] Tunnel (`tunnel`)
- [ ] Logs (`*/logs`)
- [ ] Audit (`audit`)

### Delivery Gates

- [ ] P0 endpoints all have request/response schema
- [ ] P0 endpoints all have auth annotation
- [ ] At least one domain has `Mock Ready = yes`
- [ ] No duplicated method+path rows
- [ ] Story 1.7 acceptance criteria can be checked from this table
- [ ] `routes_coverage_test.go` passes (zero uncovered routes in CI)

---

## Definition of Done

- [ ] Story acceptance criteria all checked
- [ ] Team can open Swagger UI locally and from container deployment
- [ ] One frontend flow can complete integration using documented contract only
