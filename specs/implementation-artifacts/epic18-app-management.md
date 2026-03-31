# Epic 18: Lifecycle Management Surface

**Module**: Application Lifecycle | **Status**: in-progress | **Priority**: P1 | **Depends on**: Epic 4, Epic 5, Epic 8, Epic 12, Epic 14, Epic 16, Epic 17

**Domain Reference**: `specs/adr/app-lifecycle-domain-model.md`

## Objective

Provide the unified lifecycle management workspace for already managed applications. Epic 18 owns `AppInstance` projection, installed app inventory and detail views, lifecycle action entry points, publication and configuration management surfaces, and operator-facing status interpretation built on top of Epic 17 execution contracts.

Epic 18 is the management surface above Epic 17. It should consume the lifecycle execution core, not recreate execution semantics inside Installed views.

## Current Baseline (2026-03-25)

### Implemented

- Installed app list and detail APIs already expose `AppInstance`-oriented projections.
- Installed app list and detail UI already render lifecycle state, runtime status, current execution, and last action links.
- Redeploy and upgrade entry points already create Epic 17 actions and hand off to the Actions surface.
- App config read, validate, write, and rollback surfaces already exist as management features.

### Still Not Converged

- Start, stop, restart, and uninstall still have local action paths instead of fully routing through Epic 17 actions.
- Config apply and rollback are not yet modeled as shared lifecycle actions.
- Publication, recovery, backup, and broader operator guidance are not yet finished as shared management flows.

## Requirements

1. Provide installed app list and detail views centered on `AppInstance`, including lifecycle state, health summary, current release, and relevant publication summary.
2. Aggregate runtime, release, exposure, and recent action data into one operator-friendly projection without redefining execution logic.
3. Provide lifecycle action entry points that create or trigger Epic 17 actions instead of implementing separate execution paths.
4. Support app configuration, publication, maintenance, backup, and retirement workflows through management surfaces backed by the shared lifecycle execution core.
5. Expose action result links, execution entry points, and recovery guidance when execution leaves an app in degraded or attention-required states.
6. Record and surface critical lifecycle actions in audit views for traceability.
7. Support installed-app management without requiring users to reason about internal DAG phases unless they intentionally open operation details.

## Acceptance Criteria

- Operators can find all managed apps and inspect lifecycle state, health summary, active release, and publication summary from one place.
- Installed-app views project `AppInstance` state rather than raw operation phases.
- Lifecycle actions from management views create or reference Epic 17 `OperationJob` records and never bypass the shared execution core.
- Configuration and publication management surfaces present clear validation and result states while delegating execution to lifecycle actions.
- Audit views can show who triggered lifecycle actions, what changed, and where to inspect execution results.
- Backup, recovery, and retirement flows are discoverable from installed-app views and guide the user to execution results or manual follow-up when needed.
- Actions history and execution detail links are available without forcing the Installed view to own execution semantics.

## Integration Notes

- Reuse Docker orchestration primitives from Epic 4; do not duplicate container runtime logic.
- Align app metadata and install sources with Epic 5.
- Reuse credentials/resource context from Epic 8 where required.
- Reuse audit event pipeline from Epic 12.
- Reuse file and IaC editing workflows from Epic 14 for config persistence.
- Reuse tunnel-aware connectivity assumptions from Epic 16 where applicable.
- Lifecycle action execution is owned by Epic 17 and consumed here as integration.
- App detail and inventory projections should align with the `AppInstance`, `ReleaseSnapshot`, `Exposure`, and `OperationJob` boundaries defined in the lifecycle ADR.

## Out of Scope

- Async lifecycle execution internals, worker scheduling, pipeline DAG ownership, and compensation mechanics.
- Release snapshot persistence contracts and last-known-good baseline semantics.
- Container runtime abstractions outside existing platform scope.
- CI/CD pipeline ownership and Git/File watch trigger orchestration.
- Multi-server scheduling or cluster orchestration.

## Stories

### Story 18.1 Installed App Inventory

Define installed app list and summary cards centered on `AppInstance` projection and normalized lifecycle status.

### Story 18.1a App Detail Boundary Classification

Classify `App Detail` data into `AppInstance` aggregate state, lifecycle-related projections, and external runtime or observability data so the management surface stops behaving like one giant app aggregate.

### Story 18.2 Lifecycle Actions

Implement lifecycle action entry points for start, stop, maintain, recover, publish, unpublish, and uninstall by creating or resuming shared Epic 17 operations with appropriate guards. Existing local action paths should be treated as interim behavior to be retired.

- **18.2a Local Action Convergence:** move Installed-side `start`, `stop`, `restart`, and `uninstall` off direct compose execution paths and onto shared Epic 17 lifecycle operations.

### Story 18.3 Configuration Management

Implement config edit/apply surfaces with validation, preview, and operation-result handoff to shared lifecycle execution.

### Story 18.4 Action Handoff and Status

Provide Installed-side action entry points and execution status tracking by integrating Epic 17 action workflows and execution views.

- **18.4a App Detail Action Handoff:** standardize how `App Detail` links to shared operation detail, exposes current execution context, and hands lifecycle actions off to Epic 17 without owning execution semantics locally.

### Story 18.5 Proxy and Domain Binding

Implement `Exposure` management surfaces for reverse proxy, domain binding, and certificate-related publication state visibility.

### Story 18.6 Audit and Action Records

Define installed-app audit views and operation record navigation for critical lifecycle actions.

### Story 18.7 Data Management and Backup

Implement data management, backup, and restore user flows that delegate execution to shared lifecycle operations and surface result semantics clearly.

## Story Status

| Story | Status |
|-------|--------|
| 18.1 Installed App Inventory | in-progress |
| 18.1a App Detail Boundary Classification | review |
| 18.2 Lifecycle Actions | in-progress |
| 18.2a Local Action Convergence | review |
| 18.3 Configuration Management | in-progress |
| 18.4 Action Handoff and Status | in-progress |
| 18.4a App Detail Action Handoff | review |
| 18.5 Proxy and Domain Binding | backlog |
| 18.6 Audit and Action Records | backlog |
| 18.7 Data Management and Backup | backlog |

## Story Artifacts

- `story18.1a-app-detail-boundary-classification.md`
- `story18.2a-local-action-convergence.md`
- `story18.4a-app-detail-action-handoff.md`
- `iteration1-epic18-lifecycle-convergence-slice.md`

## Recommended Iteration Slice

For the first lifecycle-management convergence pass, use:

- `18.1a App Detail Boundary Classification`
- `18.2a Local Action Convergence`
- `18.4a App Detail Action Handoff`

Execution order and dependency notes are captured in `iteration1-epic18-lifecycle-convergence-slice.md`.
