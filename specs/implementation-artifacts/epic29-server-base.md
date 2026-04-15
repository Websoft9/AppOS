# Epic 29: Server Base

**Module**: Servers / System | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, 20, 28

## Overview

Own the small set of host-level components AppOS depends on to operate a server safely.

Managed components:

- Docker
- Netdata agent
- AppOS control agent
- Nginx

This epic is not a generic package manager. It exists only to detect, install, upgrade, verify, and audit AppOS-managed prerequisites.

Planning rule:

- components are template instances, not story boundaries
- story boundaries should follow shared capability layers

## Scope

### In

- component inventory and state
- install, upgrade, verify actions
- preflight checks for OS, privilege, and network reachability
- version detection and health verification
- audit trail for component actions

### Out

- arbitrary package installation
- full reverse proxy configuration
- app deployment workflows
- free-form script execution

## Model

Aggregate root: `ServerBaseComponent`

Execution unit: `ComponentTemplate`

Core fields:

- `component_key`
- `installed_state`
- `detected_version`
- `packaged_version`
- `verification_state`
- `last_action`

Allowed keys:

- `docker`
- `monitor-agent`
- `control-agent`
- `reverse-proxy`

Template kinds:

- `package`
- `script`

## API Draft

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/servers/{serverId}/server-base` | list component state |
| GET | `/api/servers/{serverId}/server-base/{componentKey}` | read one component |
| POST | `/api/servers/{serverId}/server-base/{componentKey}/install` | install component |
| POST | `/api/servers/{serverId}/server-base/{componentKey}/upgrade` | upgrade component |
| POST | `/api/servers/{serverId}/server-base/{componentKey}/verify` | verify component |

## Cross-Domain Contract

Other domains should depend on capabilities, not on component keys or template kinds.

### Capabilities

| Capability | Current Component |
|-----------|-------------------|
| `container_runtime` | `docker` |
| `monitor_agent` | `monitor-agent` |
| `control_plane` | `control-agent` |
| `reverse_proxy` | `reverse-proxy` |

### Query Calls

- `ListCapabilities(serverId)`
- `GetCapabilityStatus(serverId, capability)`
- `IsCapabilityReady(serverId, capability)`

### Command Calls

- `EnsureCapability(serverId, capability)`
- `UpgradeCapability(serverId, capability)`
- `VerifyCapability(serverId, capability)`

### Events

- `ServerBaseCapabilityReady`
- `ServerBaseCapabilityDegraded`
- `ServerBaseActionSucceeded`
- `ServerBaseActionFailed`

Rule:

- callers express capability intent only
- Server Base resolves component, template, and execution details internally

## Interaction Rules

### Synchronous

Use synchronous calls for read-only status queries only.

- `ListCapabilities(serverId)`
- `GetCapabilityStatus(serverId, capability)`
- `IsCapabilityReady(serverId, capability)`

### Asynchronous

Use asynchronous commands for install, upgrade, or repair actions.

- `EnsureCapability(serverId, capability)`
- `UpgradeCapability(serverId, capability)`
- `VerifyCapability(serverId, capability)`

Expected command response:

- accepted or rejected
- operation id
- initial phase

### Event Collaboration

Other domains should react to result events instead of blocking on long-running execution.

- Deploy waits for prerequisite readiness
- Monitoring refreshes projections from action and health events
- Gateway reacts to reverse proxy readiness changes

### Rule of Thumb

- read state synchronously
- mutate state asynchronously
- coordinate long-running cross-domain flows through events

## Runner Boundary

Server Base should not reuse the App Lifecycle runner as the same business execution core.

Recommended split:

- share async infrastructure such as queue, worker hosting, audit, and operation tracking patterns
- do not share lifecycle-specific pipeline family, release semantics, or app operation model

Reason:

- lifecycle execution is app-centric and release-oriented
- server base execution is server-capability-centric and prerequisite-oriented
- installation and upgrade steps may look similar operationally, but they do not share the same business state model

Recommended implementation shape:

- one Server Base application service for async command submission
- one Server Base runner or worker flow for install, upgrade, verify actions
- optional shared generic operation envelope if AppOS later standardizes long-running operations across domains

## Operation Model

### Server Base Phases

- `accepted`
- `preflight`
- `executing`
- `verifying`
- `succeeded`
- `failed`
- `attention_required`

Phase intent:

- `accepted`: command is persisted and queued
- `preflight`: OS, privilege, network, and dependency checks
- `executing`: install or upgrade command is running
- `verifying`: post-action health and version checks
- `succeeded`: capability is ready
- `failed`: command reached terminal failure
- `attention_required`: automatic retry is not enough; operator intervention needed

### Shared vs Separate

Shared with Lifecycle execution:

- `operation_id`
- `phase`
- `terminal_status`
- `failure_reason`
- audit and event timestamps

Separate from Lifecycle execution:

- no `release` or `exposure` fields
- no app outcome fields
- no lifecycle pipeline family fields
- capability, component, and server-target fields remain Server Base specific

## Stories

### 29.1 Model

- freeze component keys and response shape
- define preflight and verification results
- define audit naming

### 29.2 Template

- define template schema and executor contract
- support package and script template kinds
- keep install, upgrade, verify flows template-driven

### 29.3 Catalog

- register Docker, Netdata agent, control agent, and Nginx as template instances
- bind each component to one template kind and verification policy
- keep component expansion data-driven

### 29.4 Surface

- add minimal server-scoped server base panel
- show state, version, last result, actions

## Acceptance Criteria

- [ ] one canonical inventory exists for AppOS-managed server base components
- [ ] Docker, Netdata agent, control agent, and Nginx use one consistent action contract
- [ ] every mutation runs preflight before execution
- [ ] every action returns state, version, and verification result when available
- [ ] every action is audited
- [ ] scope stays limited to AppOS-managed prerequisites

## Story Artifacts

- `story29.1-model.md`
- `story29.2-template.md`
- `story29.3-catalog.md`
- `story29.4-surface.md`