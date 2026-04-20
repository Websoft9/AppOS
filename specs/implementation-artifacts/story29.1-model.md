# Story 29.1: Model

**Epic**: Epic 29 - Software Delivery
**Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, Epic 20

## Objective

Freeze the minimal domain contract for AppOS-managed software delivery components.

## Scope

- define canonical component keys and delivery target vocabulary
- keep one identity model shared by `local` and `server` targets
- define installed, preflight, and verification states
- define inventory and action response shapes
- define audit action names

## Contract

### Component Keys

- `docker`
- `monitor-agent`
- `control-agent`
- `reverse-proxy`

### Inventory Shape

| Field | Notes |
|------|-------|
| `component_key` | canonical key |
| `label` | operator-facing label |
| `installed_state` | `installed` \| `not_installed` \| `unknown` |
| `detected_version` | current version when known |
| `packaged_version` | target/package version when known |
| `verification_state` | `healthy` \| `degraded` \| `unknown` |
| `available_actions` | `install` \| `upgrade` \| `verify` |
| `last_action` | latest action summary |

## API Contract

### Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/servers/{serverId}/software` | list components |
| GET | `/api/servers/{serverId}/software/{componentKey}` | read one component |
| POST | `/api/servers/{serverId}/software/{componentKey}/install` | install component |
| POST | `/api/servers/{serverId}/software/{componentKey}/upgrade` | upgrade component |
| POST | `/api/servers/{serverId}/software/{componentKey}/verify` | verify component |
| GET | `/api/servers/{serverId}/software/capabilities` | list target capability status |
| GET | `/api/software/local` | list AppOS-local software inventory |
| GET | `/api/software/local/{componentKey}` | read one AppOS-local component |

Rules:

- keep `component_key` as the canonical field name; do not rename it to `software_key`
- this story defines a shared model for `local` and `server` targets, but the MVP HTTP surface remains server-scoped

### DTOs

#### `SoftwareComponentSummary`

| Field | Type |
|------|------|
| `component_key` | string |
| `label` | string |
| `template_kind` | `package` \| `script` |
| `installed_state` | `installed` \| `not_installed` \| `unknown` |
| `detected_version` | string |
| `packaged_version` | string |
| `verification_state` | `healthy` \| `degraded` \| `unknown` |
| `available_actions` | string[] |
| `last_action` | `SoftwareDeliveryLastAction` |

#### `SoftwareComponentDetail`

`SoftwareComponentDetail` extends `SoftwareComponentSummary` with:

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
| `phase` | `accepted` \| `preflight` \| `executing` \| `verifying` \| `succeeded` \| `failed` \| `attention_required` |
| `message` | string |

#### `TargetReadinessResult`

| Field | Type |
|------|------|
| `ok` | bool |
| `os_supported` | bool |
| `privilege_ok` | bool |
| `network_ok` | bool |
| `dependency_ready` | bool |
| `issues` | string[] |

#### `SoftwareVerificationResult`

| Field | Type |
|------|------|
| `state` | `healthy` \| `degraded` \| `unknown` |
| `checked_at` | datetime string |
| `reason` | string |
| `details` | object |

#### `SoftwareDeliveryLastAction`

| Field | Type |
|------|------|
| `action` | string |
| `result` | string |
| `at` | datetime string |

### Response Examples

```json
{
	"items": [
		{
			"component_key": "docker",
			"label": "Docker",
			"template_kind": "package",
			"installed_state": "installed",
			"detected_version": "26.1.4",
			"packaged_version": "26.1.4",
			"verification_state": "healthy",
			"available_actions": ["upgrade", "verify"],
			"last_action": {
				"action": "verify",
				"result": "success",
				"at": "2026-04-15T08:00:00Z"
			}
		}
	]
}
```

```json
{
	"accepted": true,
	"operation_id": "swop_01JQ2ABCDEF0123456789XYZ",
	"phase": "accepted",
	"message": "software action queued"
}
```

### Audit Actions

- `server.software.install`
- `server.software.upgrade`
- `server.software.verify`
- `server.software.repair`

## Tasks / Subtasks

- [x] Task 1: Align model.go with story contract
  - [x] 1.1 rename `Operation` → `SoftwareDeliveryOperation` to match DTO name
  - [x] 1.2 verify all DTO fields and types match story contract exactly
- [x] Task 2: Add cross-domain capability interfaces (`interfaces.go`)
  - [x] 2.1 `CapabilityQuerier` interface (ListCapabilities, GetCapabilityStatus, IsCapabilityReady)
  - [x] 2.2 `CapabilityCommander` interface (EnsureCapability, UpgradeCapability, VerifyCapability)
- [x] Task 3: Add domain event constants (`events.go`)
  - [x] 3.1 event name constants for SoftwareCapabilityReady, Degraded, ActionSucceeded, ActionFailed
- [x] Task 4: Write comprehensive tests (`model_test.go`)
  - [x] 4.1 constant value tests (guard against typos)
  - [x] 4.2 JSON marshaling tests (verify output shape matches story contract)
  - [x] 4.3 interface compilation test (CapabilityQuerier, CapabilityCommander)

## Cross-Domain Contract

### Capability Mapping

| Capability | Current Component Key |
|-----------|------------------------|
| `container_runtime` | `docker` |
| `monitor_agent` | `monitor-agent` |
| `control_plane` | `control-agent` |
| `reverse_proxy` | `reverse-proxy` |

External domains should call capability contracts, not component contracts.

### Query Contract

| Call | Purpose |
|------|---------|
| `ListCapabilities(serverId)` | list capability readiness for one server |
| `GetCapabilityStatus(serverId, capability)` | read one capability state |
| `IsCapabilityReady(serverId, capability)` | return ready / not ready |

### Command Contract

| Call | Purpose |
|------|---------|
| `EnsureCapability(serverId, capability)` | install or converge capability |
| `UpgradeCapability(serverId, capability)` | upgrade capability |
| `VerifyCapability(serverId, capability)` | verify capability health |

### Event Contract

| Event | Trigger |
|------|---------|
| `SoftwareCapabilityReady` | capability reaches ready state |
| `SoftwareCapabilityDegraded` | capability verification becomes degraded |
| `SoftwareActionSucceeded` | install / upgrade / verify succeeds |
| `SoftwareActionFailed` | install / upgrade / verify fails |

Rule:

- external domains must not depend on `component_key`, `template_kind`, `script_url`, or execution commands
- these remain internal to Software Delivery

## Interaction Policy

### Synchronous Calls

Allowed only for read-model access.

| Call | Policy |
|------|--------|
| `ListCapabilities(serverId)` | synchronous |
| `GetCapabilityStatus(serverId, capability)` | synchronous |
| `IsCapabilityReady(serverId, capability)` | synchronous |

### Asynchronous Calls

Required for install, upgrade, verify, or repair work.

| Call | Policy |
|------|--------|
| `EnsureCapability(serverId, capability)` | asynchronous |
| `UpgradeCapability(serverId, capability)` | asynchronous |
| `VerifyCapability(serverId, capability)` | asynchronous |

### Operation Contract

Async command responses should return:

- `accepted`
- `operation_id`
- `phase`

Final outcome should be read from status projection or emitted events, not from the initial command response.

### Operation Phases

| Phase | Meaning |
|------|---------|
| `accepted` | command accepted and queued |
| `preflight` | preflight checks running |
| `executing` | install or upgrade in progress |
| `verifying` | post-action verification in progress |
| `succeeded` | terminal success |
| `failed` | terminal failure |
| `attention_required` | stopped for operator intervention |

### Suggested Operation DTO

#### `SoftwareDeliveryOperation`

| Field | Type |
|------|------|
| `operation_id` | string |
| `server_id` | string |
| `capability` | string |
| `component_key` | string |
| `action` | `install` \| `upgrade` \| `verify` |
| `phase` | string |
| `terminal_status` | `success` \| `failed` \| `none` |
| `failure_reason` | string |
| `created_at` | datetime string |
| `updated_at` | datetime string |

### Shared vs Separate Fields

Shared pattern with Lifecycle operation model:

- `operation_id`
- `phase`
- `terminal_status`
- `failure_reason`
- `created_at`
- `updated_at`

Must remain separate from Lifecycle domain:

- no `app_id`
- no `release_id`
- no `app_outcome`
- no lifecycle pipeline metadata
- use `server_id`, `capability`, and `component_key` instead

### Cross-Domain Guidance

- Deploy: query readiness first, then issue async ensure command if missing
- Monitoring: consume action and health events, then refresh projections
- Gateway: depend on reverse proxy readiness, not on component install details

## Execution Boundary

### Relationship to App Lifecycle Runner

Software Delivery async work should be adjacent to the App Lifecycle execution model, but not inside the same domain runner.

Shared:

- queue and worker infrastructure
- operation id pattern
- phase-oriented status model
- audit and event publication conventions

Not shared:

- lifecycle pipeline families
- app release semantics
- app operation types
- lifecycle-specific recovery rules

### Recommendation

- reuse the async substrate
- keep Software Delivery command handling and execution flow in its own domain service
- if AppOS later introduces a platform-wide long-running operation model, both domains may converge on the same generic operation envelope without merging runners

## Tasks / Subtasks

- [ ] Task 1: Freeze shared enums and response shape
	- [ ] 1.1 Define component keys
	- [ ] 1.2 Define state enums
	- [ ] 1.3 Define list/detail/action response DTOs
- [ ] Task 2: Freeze route family
	- [ ] 2.1 List route
	- [ ] 2.2 Detail route
	- [ ] 2.3 Install / upgrade / verify routes
- [ ] Task 3: Freeze audit naming
	- [ ] 3.1 Action names
	- [ ] 3.2 Target identity fields

## Guardrails

- no component-specific response shape drift
- no secret payloads in inventory or audit detail
- no generic package abstraction in this story
- list, detail, and action routes must all resolve to the same DTO family

## Suggested Files

- `backend/domain/software/templates.yaml`
- `backend/domain/software/catalog.yaml`

## Acceptance Criteria

- [x] component keys are fixed as `docker`, `monitor-agent`, `control-agent`, `reverse-proxy`
- [x] one shared response shape exists for list, detail, install, upgrade, verify
- [x] preflight and verification states are explicit and operator-readable
- [x] audit naming is stable across all component actions

## Notes

- this story freezes naming and contract first

## Dev Agent Record

### Implementation Plan

- Task 1: Rename Operation → SoftwareDeliveryOperation in model.go; verify all fields
- Task 2: Create interfaces.go with CapabilityQuerier and CapabilityCommander
- Task 3: Create events.go with domain event name constants
- Task 4: Create model_test.go with constant, JSON marshaling, and interface tests

### Debug Log

<!-- Agent adds debug notes here during implementation -->

### Completion Notes

- **Task 1**: Renamed `Operation` → `SoftwareDeliveryOperation` in `model.go`; all DTO fields verified against story contract.
- **Task 2**: Created `interfaces.go` with `CapabilityStatus`, `CapabilityQuerier`, and `CapabilityCommander` Go interfaces; follow-up implementation now lives behind `backend/domain/software/service`.
- **Task 3**: Created `events.go` with 4 domain event name constants using `software.<subject>.<verb>` naming.
- **Task 4**: Created `model_test.go` with 15 tests — constant values, JSON field presence, JSON value correctness, and interface compilation. All 15 pass. Zero regressions across full backend build.

## File List

- `backend/domain/software/model.go`
- `backend/domain/software/interfaces.go`
- `backend/domain/software/events.go`
- `backend/domain/software/model_test.go`

## Change Log

- 2026-04-20: Story 29.1 implemented by Dev Agent
  - `model.go`: renamed `Operation` → `SoftwareDeliveryOperation`
	- `interfaces.go`: created with `CapabilityStatus`, `CapabilityQuerier`, `CapabilityCommander`
	- `service/service.go`: concrete capability query/command implementation plus target inventory projection writes
  - `events.go`: created with 4 domain event constants
  - `model_test.go`: created with 15 tests (all pass)

## Status

review
- no UI is required in this story