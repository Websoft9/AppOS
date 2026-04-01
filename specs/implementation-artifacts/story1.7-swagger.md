# Story 1.7: OpenAPI Contract (Final)

**Epic**: Epic 1 - Infrastructure & Build System  
**Priority**: P1  
**Status**: Done

## Objective
Provide a stable, generated OpenAPI contract for AppOS and serve Swagger UI directly from backend runtime.

## Final Implementation (As Built)
- Ext spec is generated: `backend/docs/openapi/ext-api.yaml`
- Native spec is manually maintained: `backend/docs/openapi/native-api.yaml`
- Final merged spec is generated: `backend/docs/openapi/api.yaml`
- Runtime serves docs at:
  - `GET /openapi` (Swagger UI)
  - `GET /openapi/spec` (embedded merged YAML)
- Embedded source in binary: `backend/docs/openapi/docs.go` (`APISpec`)

## Single Source of Truth
- For **Ext generation**, `backend/docs/openapi/group-matrix.yaml` is the only source of truth.
- Generator behavior is matrix-driven:
  - scan files from `groups[*].sources.extRouteFiles`
  - include routes matched by `groups[*].extSurface` (any path prefix, not limited to `/api/ext`)
  - assign tags from matrix group mapping
  - parse `@Summary` and `@Description` from handler comments; fall back to auto-generated summary if absent
  - allow route-comment marker overrides (`@swagger summary/auth`)

## Documentation Types (Critical)
1) Business Logic Routes (named handlers)
- Scope: custom handlers in `backend/domain/routes/*.go` (for example audit, docker, terminal, iac, settings).
- Authoring: handler comment annotations (`@Summary`, `@Description`) are parsed and written to spec; `@swagger summary/auth` markers provide additional overrides.
- Output: generated into `backend/docs/openapi/ext-api.yaml` by matrix-driven generator.

2) PB Collection CRUD / Native Web APIs
- Scope: PocketBase native endpoints (records, auth actions, collections, settings, files, realtime, backups, health, crons).
- Authoring: manually maintained in `backend/docs/openapi/native-api.yaml`.
- Output: merged into final API contract via openapi merge.

3) Final Runtime Contract (delivery artifact)
- Scope: single runtime-facing OpenAPI contract used by Swagger UI and external tooling.
- Authoring: generated only, never manual edit.
- Output: `backend/docs/openapi/api.yaml`, embedded and served at `/openapi/spec`.

## Commands
- Generate Ext: `make openapi-gen`
- Merge Ext + Native: `make openapi-merge`
- Full sync + validation: `make openapi-sync`
- Direct CLI: `cd backend && go run ./cmd/openapi <gen|merge|sync>`

## Tasks / Subtasks
- [x] Task 1: Establish OpenAPI asset model
  - [x] 1.1 Generate Ext spec to `backend/docs/openapi/ext-api.yaml`
  - [x] 1.2 Maintain Native spec in `backend/docs/openapi/native-api.yaml`
  - [x] 1.3 Merge final runtime spec to `backend/docs/openapi/api.yaml`

- [x] Task 2: Serve runtime documentation
  - [x] 2.1 Expose Swagger UI at `GET /openapi`
  - [x] 2.2 Expose embedded spec at `GET /openapi/spec`
  - [x] 2.3 Embed merged spec via `backend/docs/openapi/docs.go`

- [x] Task 3: Enforce matrix-driven generation
  - [x] 3.1 Use `backend/docs/openapi/group-matrix.yaml` as single source of truth for Ext generation
  - [x] 3.2 Scan route files from `groups[*].sources.extRouteFiles`
  - [x] 3.3 Filter generated Ext routes by `groups[*].extSurface`

- [x] Task 4: Build and quality gates
  - [x] 4.1 Provide unified command entry `backend/cmd/openapi` (`gen|merge|sync`)
  - [x] 4.2 Keep route coverage gate in `backend/domain/routes/routes_coverage_test.go`
  - [x] 4.3 Keep ext route ownership gate in `backend/domain/routes/ext_route_ownership_test.go`

## Verification Gates
- Route coverage gate: `backend/domain/routes/routes_coverage_test.go`
- Ownership gate: `backend/domain/routes/ext_route_ownership_test.go`
- Expected quality bar: no uncovered `/api/ext/*` route in CI.

## Known Pitfalls
- `@Description` text containing `: ` (colon + space) breaks YAML if unquoted. Generator auto-wraps descriptions in double quotes; keep descriptions single-line.

## Maintenance Rules (Minimal)
- Change Ext grouping/tag/surface/file ownership: edit `group-matrix.yaml` first.
- Change Native endpoints: edit `native-api.yaml`.
- Do not manually edit generated files: `ext-api.yaml`, `api.yaml`.

## Native Update Governance (Mandatory)
- Any update to `backend/docs/openapi/native-api.yaml` MUST follow the top-of-file rules in that file.
- The top-of-file rule block in `native-api.yaml` is mandatory and MUST NOT be deleted.
- If rule content needs adjustment, update both places in the same change:
  - `backend/docs/openapi/native-api.yaml` (top rule block)
  - this story section (for policy redundancy)

Canonical rule block (must stay semantically consistent):
1. Maintain native endpoints only (non-/api/ext/*).
2. method+path must align with group-matrix Native|Mixed nativeSurface.
3. Use Native wording in all description fields (avoid vendor naming).
4. After edits run: make openapi-merge (recommended: make openapi-sync).
