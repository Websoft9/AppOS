# Story 36.5: Workflow Web MVP

**Epic**: Epic 36 - Workflow
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 36.1, Story 36.3, Story 36.4

## Objective

Provide the smallest usable AppOS UI for authoring, running, and observing workflows.

## Scope

- workflow list view
- create and edit workflow definition metadata and YAML
- manual run dialog
- run history view
- node run log and status view
- approval interaction for manual-gate nodes

## Product Direction

MVP UI is a management console, not a visual graph builder.

The first UI should optimize for these operator questions:

1. what workflows exist
2. what does this workflow run against
3. how do I run it now
4. what happened in the last run
5. where did one node fail or wait for approval

If a feature does not help answer one of those questions, it should stay out of MVP.

## Information Architecture

MVP contains exactly three surfaces:

1. `Workflow List`
2. `Workflow Editor`
3. `Run Detail`

### 1. Workflow List

Each row should expose only:

- `Name`
- `Status`
- `Triggers`
- `Target Server`
- `Updated`
- `Actions`

Allowed actions:

- `Edit`
- `Run Now`
- `Enable` / `Disable`
- `Delete`

### 2. Workflow Editor

Editor contains:

- `Name`
- `Description`
- `Target Server`
- `Enabled`
- `Definition YAML`

MVP may include lightweight YAML helpers, but not a visual DAG designer.

### 3. Run Detail

Run detail contains:

- run summary header
- node run list
- per-node status
- per-node logs
- approval action for manual-gate nodes

## Interaction Rules

### Create / Edit

- save validates YAML before persistence
- invalid definitions should block save with actionable errors

### Run Now

- open a small dialog for runtime params
- create workflow run and navigate to run detail on success

### Run History

- newest runs first
- list status, trigger type, requester, started time, ended time

### Approval

- only waiting `manual_gate` nodes show approve/reject controls
- approval action updates node state and lets execution continue through backend truth

### Cancel

- active runs may expose a `Cancel` action
- cancellation is best-effort and should show the resulting persisted run status rather than promising immediate remote termination

## API Surface Used by UI

```text
GET    /api/workflows
POST   /api/workflows
GET    /api/workflows/:id
PUT    /api/workflows/:id
DELETE /api/workflows/:id
POST   /api/workflows/:id/run
GET    /api/workflows/:id/runs
GET    /api/workflow-runs/:runId
GET    /api/workflow-runs/:runId/nodes
POST   /api/workflow-runs/:runId/approve/:nodeKey
POST   /api/workflow-runs/:runId/reject/:nodeKey
```

## Acceptance Criteria

1. AppOS provides a minimal workflow list page with create, edit, run, enable/disable, and delete actions.
2. Workflow editing supports YAML-backed definition management and server target selection.
3. Operators can launch a manual run and reach run detail from the UI.
4. Run detail shows node statuses and node logs without requiring a visual graph builder.
5. Manual-gate approvals can be completed from the UI.

## Out of Scope

- visual node drag-and-drop editor
- graph canvas or DAG visualizer
- inbound webhook trigger management UI
- advanced analytics, charts, or notification dashboards
