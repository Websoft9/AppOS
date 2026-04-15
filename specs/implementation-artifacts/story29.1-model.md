# Story 29.1: Model

**Epic**: Epic 29 - Server Base
**Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, Epic 20

## Objective

Freeze the minimal domain contract for AppOS-managed server base components.

## Scope

- define canonical component keys
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
| GET | `/api/servers/{serverId}/base-environment` | list components |
| GET | `/api/servers/{serverId}/base-environment/{componentKey}` | read one component |
| POST | `/api/servers/{serverId}/base-environment/{componentKey}/install` | install component |
| POST | `/api/servers/{serverId}/base-environment/{componentKey}/upgrade` | upgrade component |
| POST | `/api/servers/{serverId}/base-environment/{componentKey}/verify` | verify component |

### DTOs

#### `ServerBaseComponentSummary`

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
| `last_action` | `ServerBaseLastAction` |

#### `ServerBaseComponentDetail`

`ServerBaseComponentDetail` extends `ServerBaseComponentSummary` with:

| Field | Type |
|------|------|
| `service_name` | string |
| `binary_path` | string |
| `config_path` | string |
| `preflight` | `ServerBasePreflightResult` |
| `verification` | `ServerBaseVerificationResult` |

#### `ServerBaseActionResponse`

| Field | Type |
|------|------|
| `component_key` | string |
| `action` | `install` \| `upgrade` \| `verify` |
| `result` | `success` \| `failed` |
| `installed_state` | string |
| `detected_version` | string |
| `packaged_version` | string |
| `verification_state` | string |
| `message` | string |
| `output` | string |

#### `ServerBasePreflightResult`

| Field | Type |
|------|------|
| `ok` | bool |
| `os_supported` | bool |
| `privilege_ok` | bool |
| `network_ok` | bool |
| `issues` | string[] |

#### `ServerBaseVerificationResult`

| Field | Type |
|------|------|
| `state` | `healthy` \| `degraded` \| `unknown` |
| `checked_at` | datetime string |
| `reason` | string |
| `details` | object |

#### `ServerBaseLastAction`

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
	"component_key": "monitor-agent",
	"action": "install",
	"result": "success",
	"installed_state": "installed",
	"detected_version": "1.45.3",
	"packaged_version": "1.45.3",
	"verification_state": "healthy",
	"message": "Netdata agent installed and verified",
	"output": "..."
}
```

### Audit Actions

- `server.serverbase.install`
- `server.serverbase.upgrade`
- `server.serverbase.verify`

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
| `ServerBaseCapabilityReady` | capability reaches ready state |
| `ServerBaseCapabilityDegraded` | capability verification becomes degraded |
| `ServerBaseActionSucceeded` | install / upgrade / verify succeeds |
| `ServerBaseActionFailed` | install / upgrade / verify fails |

Rule:

- external domains must not depend on `component_key`, `template_kind`, `script_url`, or execution commands
- these remain internal to Server Base

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

#### `ServerBaseOperation`

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

Server Base async work should be adjacent to the App Lifecycle execution model, but not inside the same domain runner.

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
- keep Server Base command handling and execution flow in its own domain service
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

- `backend/domain/serverbase/templates.yaml`
- `backend/domain/serverbase/catalog.yaml`

## Acceptance Criteria

- [ ] component keys are fixed as `docker`, `monitor-agent`, `control-agent`, `reverse-proxy`
- [ ] one shared response shape exists for list, detail, install, upgrade, verify
- [ ] preflight and verification states are explicit and operator-readable
- [ ] audit naming is stable across all component actions

## Notes

- this story freezes naming and contract first
- no UI is required in this story