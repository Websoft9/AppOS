# Story 29.2: Software Lifecycle Execution

**Epic**: Epic 29 - Software Delivery
**Status**: in-progress | **Priority**: P1 | **Depends on**: Story 29.1

## Objective

Implement one template-driven lifecycle execution path for server-target software, including async operations, readiness checks, snapshot refresh, audit output, and controlled uninstall behavior.

## Reorganization Note

This story replaces the execution-oriented portions of:

- Story 29.2 Boundary
- Story 29.3 Template
- Story 29.5 Target Readiness
- Story 29.7 Worker

Implementation history from those superseded split stories is preserved in `specs/implementation-artifacts/epic29-legacy-implementation-record.md`.

## Scope

- keep lifecycle execution template-driven instead of component-driven
- support server-target `install`, `upgrade`, `verify`, `reinstall`, and `uninstall` through the same async pipeline
- extend detect truth minimally so execution can distinguish managed reinstall from future replacement-only paths
- preserve explicit preflight and readiness checks before mutating the target
- refresh inventory snapshots when operations reach a terminal state
- persist operation phase, result, and audit trail consistently
- expose capability status from installed-state and readiness conclusions

## Execution Contract

### Task Types

| Constant | Value |
|----------|-------|
| `TaskSoftwareInstall` | `software:install` |
| `TaskSoftwareUpgrade` | `software:upgrade` |
| `TaskSoftwareVerify` | `software:verify` |
| `TaskSoftwareReinstall` | `software:reinstall` |
| `TaskSoftwareUninstall` | `software:uninstall` |

### Action Pipeline

Each mutating action must follow the same high-level phases:

1. accept request and create operation record
2. validate target, component, and action support
3. evaluate readiness and preflight requirements
4. execute template-backed phases
5. run verification or post-action detection as needed
6. persist terminal outcome and refresh snapshot projection

### Phase Contract

| Phase | Purpose | Typical work |
|------|---------|--------------|
| `accepted` | register the operation | create operation record and stable operation id |
| `preflight` | decide whether execution may start | resolve template, evaluate readiness, reject unsafe execution |
| `executing` | run the primary action body | install, upgrade, reinstall, uninstall, or verify action work |
| `verifying` | confirm post-action truth | detect or verify resulting state before terminal outcome |
| `succeeded` | terminal success | persist success, refresh snapshot, write audit |
| `failed` | terminal failure | persist failure reason, refresh snapshot, write audit |
| `attention_required` | terminal operator review state | stop automatic progress and require human follow-up |

### Template Expectations

Lifecycle execution should preserve the old template-driven contract:

- shared steps remain `detect`, `preflight`, `install`, `upgrade`, `verify`, `reinstall`, and optional `uninstall`
- `package` and `script` template kinds both resolve through the same executor shape
- template resolution must happen before execution, and route shape must remain component-agnostic

### Detect Result Shape

Execution should consume detect output as a compact decision signal, not as a general package inventory API.

| Field | Meaning |
|------|---------|
| `installed_state` | whether the component is currently present |
| `detected_version` | currently detected runtime version when known |
| `install_source` | `managed`, `foreign_package`, `manual`, or `unknown` |
| `source_evidence` | one short hint describing why that source classification was chosen |

Rules:

- `reinstall` remains the corrective path for components already on a managed baseline
- detect classification must make it possible for a future `replaceinstall` action to reject implicit takeover of a foreign install
- `source_evidence` must stay short and operator-readable; it is diagnostic context, not raw package-manager output
- initial strong classification is only required for Docker; other components may return `unknown` until they need takeover semantics

### Readiness Rules

Minimum readiness signals:

- verified OS baseline when declared
- privilege availability
- network reachability when required by template
- required runtime capability such as service manager or package manager
- dependency or prerequisite capability state

#### Readiness Result Shape

| Field | Meaning |
|------|---------|
| `os_supported` | target OS is within the template's verified OS baseline when one is declared |
| `privilege_ok` | required privilege is available |
| `network_ok` | required network path is reachable |
| `dependency_ready` | prerequisite capability is already available |
| `service_manager_ok` | required service manager is available |
| `package_manager_ok` | required package manager is available |
| `ok` | overall readiness decision |
| `issues` | operator-readable blocking issues |

Rules:

- readiness output must remain visible even when action is rejected
- readiness failure should stop unsafe mutating phases early
- verification failure and readiness failure must remain distinguishable in operation state
- readiness should remain a first-class query result, not just an action-time side effect

### Controlled Uninstall Rule

`uninstall` must be implemented as a controlled baseline action:

- remove or disable AppOS-managed installation assets for the component
- rerun detect so the snapshot can converge to `not_installed` or another truthful terminal state
- do not claim full host cleanup for files or services outside AppOS-managed scope

### Operation State Shape

| Field | Notes |
|------|-------|
| `operation_id` | unique operation id |
| `server_id` | target server |
| `capability` | may be empty for direct component actions |
| `component_key` | target component |
| `action` | install, upgrade, verify, reinstall, or uninstall |
| `phase` | accepted, preflight, executing, verifying, succeeded, failed, or attention_required |
| `terminal_status` | none, success, or failed |
| `failure_reason` | human-readable failure reason when terminal state is failed |
| `created_at` | creation timestamp |
| `updated_at` | last-updated timestamp |

### Worker Flow

1. API handler validates request and creates operation record in `accepted`
2. API handler enqueues Asynq task with `{serverID, componentKey, action}`
3. worker updates operation to `preflight`
4. worker resolves catalog entry and template
5. worker evaluates readiness; if not ready, persist `failed`, write audit, refresh snapshot if needed, and stop
6. worker updates operation to `executing`
7. worker executes template action
8. worker updates operation to `verifying`
9. worker runs post-action verify or detect
10. worker persists terminal state, refreshes snapshot projection, then writes audit record

Rules:

- one active in-flight operation per component per server at a time
- phase transitions must only go forward
- unexpected worker failure must leave the operation in `failed`, not `accepted`
- terminal state must be persisted before audit write
- future replacement-capable actions must consume detect source classification before mutating a host that is not already on a managed baseline

### Persistence

- operations are stored in `software_operations`
- API list and detail handlers read operation state from that collection
- snapshot persistence should flow through the shared projection helper rather than a parallel write path

## Technical Context

Current implementation anchor points:

- `backend/domain/software/service/service.go`
- `backend/domain/software/service/supported_catalog.go`
- `backend/domain/software/projection/snapshot.go`
- `backend/domain/software/readiness.go`
- `backend/domain/worker/software_delivery.go`
- `backend/domain/software/executor/`
- `backend/domain/routes/software.go`

Current repo patterns already established:

- async actions are queue-backed
- operation phases and last-action summaries already exist
- terminal worker completion already refreshes snapshot projection

This story should extend that pattern cleanly rather than introducing a second execution stack.

## API Contract

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/servers/{serverId}/software/{componentKey}/install` | queue install |
| POST | `/api/servers/{serverId}/software/{componentKey}/upgrade` | queue upgrade |
| POST | `/api/servers/{serverId}/software/{componentKey}/verify` | queue verify |
| POST | `/api/servers/{serverId}/software/{componentKey}/reinstall` | queue reinstall |
| POST | `/api/servers/{serverId}/software/{componentKey}/uninstall` | queue controlled uninstall |
| GET | `/api/servers/{serverId}/software/operations` | list async lifecycle operations |
| GET | `/api/servers/{serverId}/software/operations/{operationId}` | read one operation |

## Tasks / Subtasks

- [x] Task 1: Normalize lifecycle action support in backend service and routes
	- [x] 1.1 add or confirm catalog-driven support for all lifecycle actions
	- [x] 1.2 reject unsupported actions consistently with route tests
	- [x] 1.3 define Asynq task types and payload shape for install, upgrade, verify, reinstall, and uninstall
	- [x] 1.4 keep operation conflict rules explicit when another action is already running
- [x] Task 2: Complete template-driven worker execution
	- [x] 2.1 ensure install, upgrade, verify, reinstall, and uninstall resolve through template phases
	- [x] 2.2 preserve operation phase tracking and user-facing messages
	- [x] 2.3 keep snapshot refresh on both success and failure terminal paths
	- [x] 2.4 register software worker handlers in bootstrap and use the shared queue policy
- [ ] Task 3: Encode readiness and verification rigor
	- [x] 3.1 persist readiness issues as first-class diagnostic output
	- [ ] 3.2 distinguish readiness failure, execution failure, and verification degradation
	- [x] 3.3 recalculate capability status from truthful installed-state and verification data
	- [x] 3.4 expose readiness in component detail and capability query responses
	- [ ] 3.5 extend detect output with minimal install-source classification for Docker takeover decisions
- [x] Task 4: Add uninstall baseline behavior
	- [x] 4.1 define uninstall template hook or strategy contract
	- [x] 4.2 rerun detect after uninstall to refresh target snapshot truthfully
	- [x] 4.3 emit audit entries and operation summaries that clearly communicate controlled scope
- [x] Task 5: Validate with focused tests
	- [x] 5.1 service tests for action policy and last-action projection
	- [x] 5.2 readiness tests for blocking and ready states across OS, privilege, network, and dependency dimensions
	- [x] 5.3 worker tests for terminal refresh, forward-only phases, and uninstall flow
	- [x] 5.4 route tests for invalid action, queue unavailable, operation conflicts, and operation detail behavior

## Current Gaps

- software-domain events are still defined but not emitted from the execution path
- `available_actions` still reflects catalog policy more directly than readiness-trimmed backend truth
- the server operational UI still needs tighter readiness-aware action enablement

## Guardrails

- no component-specific worker branching for common lifecycle phases
- no synchronous long-running execution in request handlers
- no silent readiness bypass for mutating actions
- no uninstall semantics that overpromise full system cleanup
- no snapshot persistence path separate from the shared projection helper

## Acceptance Criteria

- operators can queue `install`, `upgrade`, `verify`, `reinstall`, and `uninstall` through one consistent server-target action model
- lifecycle execution remains template-driven and does not fork into per-component service logic for normal cases
- readiness covers OS, privilege, network, and prerequisite dependency state and is available from the Software Delivery API surface
- detect output remains minimal but can distinguish managed Docker installs from foreign package installs and manual installs
- operation records expose clear phases and terminal outcomes
- snapshot projection is refreshed after terminal worker completion so server inventory stays current
- readiness, execution, and verification problems are distinguishable in backend responses and logs
- controlled uninstall returns the component to a truthful managed baseline without claiming arbitrary host cleanup

## Notes

- this story is the execution backbone for the rest of the epic
- AppOS-local inventory remains read-only in this epic split unless a future story explicitly promotes local lifecycle actions