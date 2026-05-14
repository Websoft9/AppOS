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
- define one shared lifecycle contract: `detect`, `install`, `upgrade`, `verify`, `reinstall`, `uninstall`
- define catalog metadata required by both backend execution and frontend surfaces
- keep `local` and `server` under one domain language while allowing target-specific policies
- define action policy so UI and API surfaces render from metadata rather than component-specific branching
- define the boundary between Software Delivery and Monitor clearly enough that runtime health remains outside this domain
- define the cross-domain status projection needed by control-plane-reporting components without making Software Delivery the owner of monitoring telemetry

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
| software delivery install, upgrade, verify, reinstall execution | `provisioning` | executes delivery actions |
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
| `detect` | inspect installed state, detected version, and minimal install-source classification without mutating target |
| `install` | converge from `not_installed` to managed baseline |
| `upgrade` | converge an installed component to packaged baseline |
| `verify` | validate that the component satisfies expected capability |
| `reinstall` | rerun converge from the managed install baseline when corrective recovery is needed |
| `uninstall` | return the component to a controlled `not_installed` managed baseline |

Rules:

- `uninstall` is not a promise of full cleanup outside AppOS-owned assets
- supported actions are catalog-driven and may vary by component and target scope
- external domains should consume capability status, not template internals or shell commands
- initial detect classification should stay minimal: enough to separate AppOS-managed installs from foreign package installs and manual installs, not enough to become a full package inventory system

### Capability Mapping

| Capability | Current Component Key |
|-----------|------------------------|
| `container_runtime` | `docker` |
| `monitor_agent` | `monitor-agent` |
| `reverse_proxy` | `reverse-proxy` |

External domains should call capability contracts, not component contracts.

### Template Contract

#### Shared Fields

| Field | Notes |
|------|-------|
| `template_kind` | `package` or `script` |
| `display_name` | operator-facing name |
| `detect` | installed-state, version, and minimal install-source detection |
| `preflight` | verified OS baseline plus privilege, network, and runtime capability checks |
| `install` | install step definition |
| `upgrade` | upgrade step definition |
| `verify` | post-action verification |
| `reinstall` | optional reinstall step; defaults to install then verify when absent |
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

Rules:

- shared component definitions stay singular; target placement is expressed through `target_type` metadata rather than duplicated component definitions
- Software Delivery does not manage a custom `appos-agent`; Netdata is the only continuous monitoring agent on managed servers
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

### Control-Plane Connection-Aware Components

Some managed components, such as `monitor-agent`, are not fully described by service readiness alone. They must also connect to, authenticate with, and report data to the AppOS control plane.

The contract should expose two operator-facing status dimensions for these components:

| Dimension | API field | Operator label | Ownership |
|-----------|-----------|----------------|-----------|
| service runtime | `service_status` | `Service Status` | Software Delivery resolves from install, service, and verification evidence. |
| AppOS reporting path | `appos_connection` | `AppOS Connection` | Monitor/control-plane telemetry provides evidence; Software Delivery may project the latest summarized value for component inventory. |

Recommended values:

| Field | Values |
|-------|--------|
| `service_status` | `running`, `stopped`, `installed`, `not_installed`, `needs_attention`, `unknown` |
| `appos_connection` | `connected`, `stale`, `not_connected`, `auth_failed`, `misconfigured`, `unknown`, `not_applicable` |

Rules:

- `appos_connection` is required only for components whose catalog metadata declares that AppOS reporting is expected.
- components that do not report to AppOS should return `not_applicable` or omit the field, depending on DTO compatibility constraints.
- Software Delivery must not sample metrics or own heartbeat freshness. It may consume a Monitor/control-plane summary as evidence when projecting the component inventory response.
- Monitor remains the source of truth for time-series telemetry, freshness windows, heartbeat history, and status timelines.
- A running service with stale reporting must remain distinguishable from a stopped service. Do not collapse both into one generic degraded state.

### Health Resolution Decision Tree

Component health/status projection must be implemented as an explicit decision tree or rule table, not as scattered component-specific `if/else` logic.

The resolver input is evidence, not UI text:

- `installed_state`
- `verification_state`
- service unit/process evidence when available
- last lifecycle operation terminal state
- catalog metadata, including whether AppOS reporting is expected
- latest Monitor/control-plane reporting summary when applicable
- authentication/configuration evidence when applicable

The resolver output is structured status, not presentation copy:

| Output | Purpose |
|--------|---------|
| `service_status` | service/runtime dimension consumed by server component inventory and detail views |
| `appos_connection` | reporting/control-plane dimension for reporting-aware components |
| `health_state` | optional compact aggregate for sorting/filtering if a later UI needs it |
| `health_reasons[]` | short machine-readable reasons that explain the selected branches |

Decision-tree requirements:

- define branch precedence explicitly, e.g. `not_installed` before service checks, terminal failed operation before healthy display, auth/config failures before generic stale reporting.
- keep component-specific behavior in catalog metadata or resolver facts, not in route handlers or frontend conditionals.
- make the tree table-driven and covered by tests for each leaf state.
- expose enough `health_reasons[]` to explain why a status was selected without leaking raw shell output.
- allow future reporting-aware components to reuse the same resolver by changing metadata, not adding new conditional branches.

Illustrative first-pass tree:

| Precedence | Condition | `service_status` | `appos_connection` |
|------------|-----------|------------------|--------------------|
| 1 | `installed_state = not_installed` | `not_installed` | `not_applicable` or `unknown` |
| 2 | latest lifecycle operation ended `failed` or `attention_required` | `needs_attention` | unchanged from available evidence |
| 3 | verification confirms service running | `running` | evaluate reporting branch if expected |
| 4 | installed but service stopped/inactive | `stopped` | evaluate reporting branch if expected |
| 5 | installed but service evidence unavailable | `installed` | evaluate reporting branch if expected |
| 6 | reporting expected and auth/config failed | unchanged | `auth_failed` or `misconfigured` |
| 7 | reporting expected and latest control-plane sample is fresh | unchanged | `connected` |
| 8 | reporting expected and latest sample is stale | unchanged | `stale` |
| 9 | reporting expected and no successful sample exists | unchanged | `not_connected` |
| 10 | insufficient evidence | `unknown` | `unknown` |

### Minimal Detect Extension

Detect should remain intentionally small. The first extension only adds enough truth to decide whether a corrective action stays within the managed baseline or must escalate to replacement flow.

#### `DetectionResult`

| Field | Type | Notes |
|------|------|-------|
| `installed_state` | `installed` or `not_installed` or `unknown` | existing truth signal |
| `detected_version` | string | existing version signal when known |
| `install_source` | `managed` or `foreign_package` or `manual` or `unknown` | minimal source classification |
| `source_evidence` | string | short operator-readable hint such as `apt:docker-ce`, `apt:docker.io`, `rpm:moby-engine`, or `binary:/usr/bin/docker` |

Rules:

- `install_source=managed` means the installed component matches the AppOS-managed package or script baseline for that component
- `install_source=foreign_package` means the component is package-managed but not from the AppOS-recognized baseline
- `install_source=manual` means the runtime is present but package ownership does not support a safe managed-path conclusion
- `install_source=unknown` is the fallback when detection cannot classify source truthfully
- initial rollout only needs strong classification for Docker because that is the first component expected to branch between `reinstall` and a future replacement action

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
| `install_source` | `managed` or `foreign_package` or `manual` or `unknown` |
| `source_evidence` | string |
| `packaged_version` | string |
| `verification_state` | `healthy` or `degraded` or `unknown` |
| `service_status` | `running`, `stopped`, `installed`, `not_installed`, `needs_attention`, or `unknown` |
| `appos_connection` | `connected`, `stale`, `not_connected`, `auth_failed`, `misconfigured`, `unknown`, or `not_applicable` |
| `health_reasons` | string[] |
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
- `server.software.reinstall`
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
- [ ] Task 5: Define reporting-aware health projection
	- [ ] 5.1 add catalog metadata for components that require AppOS reporting
	- [ ] 5.2 define `service_status`, `appos_connection`, and `health_reasons[]` DTO behavior
	- [ ] 5.3 implement the status resolver as a decision tree or rule table, not component-specific route branching
	- [ ] 5.4 add table-driven tests for every decision-tree leaf state
	- [ ] 5.5 verify Monitor remains the source of heartbeat, freshness, telemetry, and status timeline evidence

## Guardrails

- no component-specific route families
- no separate contract language for `local` versus `server`
- no lifecycle semantics embedded only in frontend labels
- no Monitor runtime-state concerns folded into software inventory contract
- no promise that uninstall performs arbitrary host cleanup outside AppOS-managed scope

## Acceptance Criteria

- one documented lifecycle contract exists for `detect`, `install`, `upgrade`, `verify`, `reinstall`, and `uninstall`
- every AppOS-managed software component can be described through one canonical catalog shape
- the initial managed set of Docker, reverse proxy, monitor agent, and control agent fits that catalog shape without route forks
- `server` and `local` inventory surfaces derive from the same domain language rather than separate ad hoc DTOs
- `package` and `script` template kinds are both supported by one shared contract
- supported actions are discoverable from metadata and can drive later UI and worker stories
- the boundary with Monitor is explicit enough that runtime observation does not leak into this epic
- reporting-aware components expose separate `service_status` and `appos_connection` status dimensions without folding Monitor telemetry ownership into Software Delivery
- component health/status projection is specified and tested as a decision tree or rule table rather than scattered `if/else` logic

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