# Story 29.1: Software Contract and Catalog

**Epic**: Epic 29 - Software Delivery
**Status**: review | **Priority**: P1 | **Depends on**: Epic 12, Epic 20

## Objective

Freeze one durable software-delivery contract that covers both `server` and `local` targets, and back that contract with one canonical AppOS-managed catalog.

## Reorganization Note

This story replaces the contract-setting portions of:

- Story 29.1 Model
- Story 29.2 Boundary
- Story 29.3 Template
- Story 29.4 Catalog

Implementation history from those superseded split stories is preserved in `specs/implementation-artifacts/epic29-legacy-implementation-record.md`.

Execution mechanics, operational UI, supported-software discovery, and local inventory are intentionally moved into later stories.

## Scope

- define the canonical software vocabulary for `component`, `capability`, `target`, `template`, `snapshot`, and `operation`
- define one shared lifecycle contract: `detect`, `install`, `upgrade`, `verify`, `repair`, `uninstall`
- define catalog metadata required by both backend execution and frontend surfaces
- keep `local` and `server` under one domain language while allowing target-specific policies
- define action policy so UI and API surfaces render from metadata rather than component-specific branching
- define the boundary between Software Delivery and Monitor clearly enough that runtime health remains outside this domain

## Domain Contract

### Subdomain Ownership

| Subdomain | Owns |
|-----------|------|
| `catalog` | managed component identity, template metadata, target-scope placement |
| `inventory` | installed component snapshot per target |
| `provisioning` | lifecycle execution and operation state |
| `target-readiness` | OS, privilege, network, and prerequisite capability checks |

Current mapping to preserve from the old story set:

| Current Material | Target Subdomain | Reason |
|------------------|------------------|--------|
| `components` inventory output | `inventory` | describes installed state on a target |
| component registry and config | `catalog` | defines what AppOS manages |
| software delivery install, upgrade, verify, repair execution | `provisioning` | executes delivery actions |
| OS, privilege, and network checks | `target-readiness` | determines whether actions can safely run |

### Target Scopes

- `server`: remote delivery targets managed through connected servers
- `local`: AppOS-local bundled components managed as platform inventory

### Core Entities

| Entity | Purpose |
|--------|---------|
| `SoftwareCatalogEntry` | what AppOS can manage |
| `InstalledComponentSnapshot` | what was last detected on a target |
| `SoftwareDeliveryOperation` | one async lifecycle action |
| `Capability` | delivery outcome consumed by other domains |
| `ComponentTemplate` | declarative execution strategy for one component |

### Lifecycle Contract

| Action | Meaning |
|--------|---------|
| `detect` | inspect installed state and version without mutating target |
| `install` | converge from `not_installed` to managed baseline |
| `upgrade` | converge an installed component to packaged baseline |
| `verify` | validate that the component satisfies expected capability |
| `repair` | rerun corrective converge steps without redefining target |
| `uninstall` | return the component to a controlled `not_installed` managed baseline |

Rules:

- `uninstall` is not a promise of full cleanup outside AppOS-owned assets
- supported actions are catalog-driven and may vary by component and target scope
- external domains should consume capability status, not template internals or shell commands

### Capability Mapping

| Capability | Current Component Key |
|-----------|------------------------|
| `container_runtime` | `docker` |
| `monitor_agent` | `monitor-agent` |
| `control_plane` | `control-agent` |
| `reverse_proxy` | `reverse-proxy` |

External domains should call capability contracts, not component contracts.

### Template Contract

#### Shared Fields

| Field | Notes |
|------|-------|
| `template_kind` | `package` or `script` |
| `display_name` | operator-facing name |
| `detect` | installed-state and version detection |
| `preflight` | verified OS baseline plus privilege, network, and runtime capability checks |
| `install` | install step definition |
| `upgrade` | upgrade step definition |
| `verify` | post-action verification |
| `repair` | optional repair step; defaults to install then verify when absent |
| `uninstall` | optional controlled baseline removal step |

#### Kind Rules

- `package`: distro-aware package install and service verification
- `script`: controlled installer plus explicit verification
- route and DTO shape must stay component-agnostic even when template internals differ

#### Placeholder Rule

- template placeholders are resolved from catalog metadata or trusted system settings
- template schema must not allow arbitrary shell input from the UI

### Canonical Catalog Shape

Each catalog entry must define at least:

| Field | Notes |
|------|-------|
| `component_key` | canonical identity used by API, worker, snapshot, and UI |
| `label` | operator-facing name |
| `target_type` | `server` or `local`; canonical code and persistence field name |
| `capability` | mapped managed capability when applicable |
| `template_kind` | executor strategy family |
| `supported_actions` | lifecycle actions allowed for this component |
| `description` | short operator-facing support note |
| `readiness_requirements` | verified baseline, privilege, network, runtime capability, or dependency expectations |
| `visibility` | whether the component appears in server operations, supported-software discovery, local inventory, or multiple surfaces |

### Initial Catalog Set

| Component Key | Label | Template Ref | Template Kind | Verification Focus | Default Actions |
|--------------|-------|--------------|---------------|--------------------|-----------------|
| `docker` | Docker | `package-systemd` | `package` | binary version and daemon readiness | `install`, `upgrade`, `verify`, `uninstall` |
| `reverse-proxy` | Reverse Proxy | `package-systemd` | `package` | package version and service readiness | `install`, `upgrade`, `verify`, `uninstall` |
| `monitor-agent` | Netdata Agent | `script-systemd` | `script` | binary version and service readiness | `install`, `upgrade`, `verify`, `uninstall` |
| `control-agent` | AppOS Control Agent | `script-systemd` | `script` | binary version and service readiness | `install`, `upgrade`, `verify`, `uninstall` |

Rules:

- shared component definitions stay singular; target placement is expressed through `target_type` metadata rather than duplicated component definitions
- `control-agent` installer URL is resolved from trusted system settings at execution time, not hardcoded in catalog data
- adding a new component should require catalog registration, not a new route family or a new planning story

### Boundary with Monitor

Software Delivery owns:

- installed state
- detected version
- packaged target version
- lifecycle execution result
- readiness and verification conclusions

Monitor owns:

- runtime liveness
- runtime health telemetry
- service observation after delivery completes

This boundary must remain strict:

- Monitor does not own install or readiness workflows
- Software Delivery does not own heartbeat, active checks, health summaries, or status timelines

## API and DTO Contract

### Shared DTO Fields to Preserve

#### `SoftwareComponentSummary`

| Field | Type |
|------|------|
| `component_key` | string |
| `label` | string |
| `template_kind` | `package` or `script` |
| `installed_state` | `installed` or `not_installed` or `unknown` |
| `detected_version` | string |
| `packaged_version` | string |
| `verification_state` | `healthy` or `degraded` or `unknown` |
| `available_actions` | string[] |
| `last_action` | `SoftwareDeliveryLastAction` |

#### `SoftwareComponentDetail`

`SoftwareComponentDetail` extends the summary with:

| Field | Type |
|------|------|
| `service_name` | string |
| `binary_path` | string |
| `config_path` | string |
| `preflight` | `TargetReadinessResult` |
| `verification` | `SoftwareVerificationResult` |

#### `AsyncCommandResponse`

| Field | Type |
|------|------|
| `accepted` | bool |
| `operation_id` | string |
| `phase` | `accepted`, `preflight`, `executing`, `verifying`, `succeeded`, `failed`, or `attention_required` |
| `message` | string |

#### `SoftwareDeliveryLastAction`

| Field | Type |
|------|------|
| `action` | string |
| `result` | string |
| `at` | datetime string |

### Shared DTO Expectations

| DTO | Purpose |
|-----|---------|
| `SoftwareComponentSummary` | compact component row for UI lists |
| `SoftwareComponentDetail` | detailed component state plus readiness and verification |
| `SupportedServerSoftwareEntry` | read-only catalog entry for discovery surface |
| `LocalSoftwareComponentDetail` | AppOS-local inventory detail |
| `AsyncCommandResponse` | accepted async lifecycle response |
| `SoftwareDeliveryLastAction` | most recent action summary |

### Route Families Governed by This Contract

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/servers/{serverId}/software` | list server-target installed components |
| GET | `/api/servers/{serverId}/software/{componentKey}` | read one server-target component |
| GET | `/api/servers/{serverId}/software/capabilities` | list target capability readiness |
| GET | `/api/software/server-catalog` | list supported server-target software |
| GET | `/api/software/server-catalog/{componentKey}` | read one supported server-target entry |
| GET | `/api/software/local` | list AppOS-local inventory |
| GET | `/api/software/local/{componentKey}` | read one AppOS-local component |

Rules:

- `component_key` remains the canonical identity field across API and persistence layers
- discovery routes stay read-only
- server lifecycle actions stay server-scoped even though the contract itself is shared

### Audit Action Names

- `server.software.install`
- `server.software.upgrade`
- `server.software.verify`
- `server.software.repair`
- `server.software.uninstall`

## Developer Context

Current implementation anchor points:

- `backend/domain/software/model.go`
- `backend/domain/software/catalog/`
- `backend/domain/software/interfaces.go`
- `backend/domain/software/template.go`
- `backend/domain/software/readiness.go`
- `backend/domain/software/service/supported_catalog.go`
- `backend/domain/routes/software.go`
- `web/src/lib/software-api.ts`

Current repo direction already validates several parts of this story:

- catalog-backed server discovery exists
- server and local inventory already share one software vocabulary
- template-driven execution is already the preferred design rule

This story should therefore consolidate and formalize the contract instead of reopening low-level implementation choices.

## Tasks / Subtasks

- [x] Task 1: Consolidate the shared software-delivery vocabulary
	- [x] 1.1 freeze canonical target scopes, component identity, capability mapping, and lifecycle action names
	- [x] 1.2 define which fields are mandatory on every catalog entry
	- [x] 1.3 define how supported actions, audit names, and DTO field names are represented and consumed
- [x] Task 2: Normalize the catalog contract
	- [x] 2.1 align server and local catalog metadata under one schema
	- [x] 2.2 encode discovery visibility and operational visibility explicitly
	- [x] 2.3 preserve initial catalog coverage for Docker, reverse proxy, monitor agent, and control agent
	- [x] 2.4 define uninstall support as metadata, not ad hoc UI branching
- [x] Task 3: Freeze cross-domain boundaries
	- [x] 3.1 define the Software Delivery versus Monitor split in story language and API language
	- [x] 3.2 define capability-facing contract for external consumers
	- [x] 3.3 preserve subdomain mapping for catalog, inventory, provisioning, and target-readiness
	- [x] 3.4 define audit action naming for all lifecycle operations
- [x] Task 4: Add contract validation coverage
	- [x] 4.1 backend tests for DTO and catalog shape stability
	- [x] 4.2 backend tests for template schema validity and placeholder safety
	- [x] 4.3 backend tests for capability map and required catalog coverage
	- [x] 4.4 route tests that guard canonical field names and literal paths
	- [x] 4.5 frontend type tests or API-client tests that guard against schema drift

## Guardrails

- no component-specific route families
- no separate contract language for `local` versus `server`
- no lifecycle semantics embedded only in frontend labels
- no Monitor runtime-state concerns folded into software inventory contract
- no promise that uninstall performs arbitrary host cleanup outside AppOS-managed scope

## Acceptance Criteria

- one documented lifecycle contract exists for `detect`, `install`, `upgrade`, `verify`, `repair`, and `uninstall`
- every AppOS-managed software component can be described through one canonical catalog shape
- the initial managed set of Docker, reverse proxy, monitor agent, and control agent fits that catalog shape without route forks
- `server` and `local` inventory surfaces derive from the same domain language rather than separate ad hoc DTOs
- `package` and `script` template kinds are both supported by one shared contract
- supported actions are discoverable from metadata and can drive later UI and worker stories
- the boundary with Monitor is explicit enough that runtime observation does not leak into this epic

## Notes

- this story is the contract and catalog foundation for the rest of the reorganized Epic 29 set
- later stories should consume this contract rather than redefining component metadata locally

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References

- `go test ./domain/software/catalog ./domain/routes -run 'ServerCatalog|LocalCatalog|SupportedServerCatalog' -count=1`
- `go test ./domain/software/... ./domain/routes -run 'Software|Catalog|Boundary' -count=1`
- `npm test -- --run src/lib/software-api.test.ts`

### Completion Notes List

- Added canonical catalog metadata fields for capability, description, readiness requirements, and visibility to both server and local catalogs.
- Exposed supported server catalog metadata directly from catalog entries so discovery surfaces consume metadata instead of hardcoded descriptions.
- Preserved the existing server/local shared vocabulary and boundary tests while tightening route and API-client coverage for the supported catalog shape.
- Implementation continues to use `target_type` in code for the `server` and `local` scope split.

### File List

- `backend/domain/software/model.go`
- `backend/domain/software/catalog/loader.go`
- `backend/domain/software/catalog/catalog_server.yaml`
- `backend/domain/software/catalog/catalog_local.yaml`
- `backend/domain/software/catalog/loader_test.go`
- `backend/domain/software/service/supported_catalog.go`
- `backend/domain/routes/software_test.go`
- `web/src/lib/software-api.ts`
- `web/src/lib/software-api.test.ts`
- `specs/implementation-artifacts/story29.1-software-contract-and-catalog.md`

## Change Log

- 2026-04-26: completed the canonical catalog metadata implementation, expanded supported catalog API shape, and synchronized story status/tasks to review.