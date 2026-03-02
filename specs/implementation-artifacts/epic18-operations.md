# Epic 18: Operations

**Module**: Application Lifecycle | **Status**: backlog | **Priority**: P1 | **Depends on**: Epic 4, Epic 5, Epic 8, Epic 12, Epic 14, Epic 16, Epic 17

## Objective

Provide a unified post-deployment management experience for installed applications on a single server, so operators can safely view, operate, configure, expose, audit, and protect app data without requiring advanced DevOps knowledge.

## Requirements

1. Support installed app list and detail views with normalized runtime state.
2. Support lifecycle actions: start, stop, restart, uninstall.
3. Support app configuration updates (env, ports, mounts, and runtime options) with validation.
4. Support reverse proxy/domain binding management for installed apps.
5. Record critical operations in audit logs for traceability.
6. Support data management and backup operations for app persistence.
7. Provide re-deploy/upgrade entry points that delegate execution to Deploy Epic workflows.

## Acceptance Criteria

- Operators can find all installed apps and inspect status from one place.
- Lifecycle operations return clear result states and error messages.
- Configuration changes are validated before apply and persisted safely.
- Domain/proxy binding updates are visible and recoverable on failure.
- All critical operations emit audit entries with actor, action, target, and result.
- Data backup/restore workflows are actionable and produce verifiable outcomes.
- Re-deploy/upgrade actions in Installed views delegate to Deploy Epic APIs and only return execution status/result links.

## Integration Notes

- Reuse Docker orchestration primitives from Epic 4; do not duplicate container runtime logic.
- Align app metadata and install sources with Epic 5.
- Reuse credentials/resource context from Epic 8 where required.
- Reuse audit event pipeline from Epic 12.
- Reuse file and IaC editing workflows from Epic 14 for config persistence.
- Reuse tunnel-aware connectivity assumptions from Epic 16 where applicable.
- Re-deploy/upgrade/rollback workflow execution is owned by Deploy Epic and consumed here as integration.

## Out of Scope

- Multi-server scheduling or cluster orchestration.
- New container runtime abstractions outside existing platform scope.
- Deployment workflow orchestration (re-deploy, upgrade execution, release strategy, rollback logic).
- CI/CD pipeline ownership and Git/File watch trigger orchestration.
- Non-essential advanced deployment patterns (canary/blue-green at cluster scale).

## Stories

### Story 18.1 Installed App Inventory

Define list/detail model for installed apps and runtime status aggregation.

### Story 18.2 Lifecycle Operations

Implement start/stop/restart/uninstall operations with safe guards and state transitions.

### Story 18.3 Configuration Management

Implement config edit/apply flow with schema validation and rollback point.

### Story 18.4 Deployment Handoff and Status

Provide Installed-side deploy/redeploy entry points and execution status tracking by integrating Deploy Epic workflows.

### Story 18.5 Proxy and Domain Binding

Implement reverse proxy/domain binding configuration lifecycle for installed apps.

### Story 18.6 Audit and Operation Records

Define and emit audit events for all critical management operations.

### Story 18.7 Data Management and Backup

Implement app data backup/restore lifecycle and recovery validation.

## Story Status

| Story | Status |
|-------|--------|
| 18.1 Installed App Inventory | backlog |
| 18.2 Lifecycle Operations | backlog |
| 18.3 Configuration Management | backlog |
| 18.4 Deployment Handoff and Status | backlog |
| 18.5 Proxy and Domain Binding | backlog |
| 18.6 Audit and Operation Records | backlog |
| 18.7 Data Management and Backup | backlog |
