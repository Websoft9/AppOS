# Story 36.3: Workflow Triggers and Execution

**Epic**: Epic 36 - Workflow
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 36.1, Story 36.2, Epic 25

## Objective

Provide the execution entrypoints that create workflow runs and send them into the workflow worker.

## Scope

- add manual run endpoint
- add cron-backed workflow trigger registration and dispatch
- enqueue workflow execution through Asynq
- resolve runtime parameters, target server, and secret references
- define overlap handling for cron-triggered runs
- add approval and cancellation execution endpoints required by MVP runtime

## Product Decisions

- MVP trigger types are `manual` and `cron`
- inbound webhook trigger is post-MVP
- cron dispatch uses PocketBase cron as the scheduling substrate
- workflow runtime uses Asynq as the execution substrate
- overlap policy is `skip` only in MVP

## Backend Contract Direction

Execution endpoints:

```text
POST /api/workflows/:id/run
GET  /api/workflows/:id/runs
GET  /api/workflow-runs/:runId
GET  /api/workflow-runs/:runId/nodes
POST /api/workflow-runs/:runId/cancel
POST /api/workflow-runs/:runId/approve/:nodeKey
POST /api/workflow-runs/:runId/reject/:nodeKey
```

Notes:

- all mutating execution endpoints are superuser-only in MVP
- manual run accepts params payload and optional run-time server override only if product later adds it; MVP uses default server target

## Cron Registration Direction

AppOS should not create a second generic scheduler.

MVP direction:

- enabled workflow definitions with cron triggers are registered into PocketBase cron at startup
- cron callback performs only lightweight dispatch logic
- heavy execution always goes to Asynq

Dispatch flow:

```text
PocketBase cron
  ↓
workflow dispatch wrapper
  ↓
create workflow_run + node_run seeds
  ↓
enqueue workflow:execute
```

## Parameter and Secret Resolution

- manual trigger params are provided at request time
- cron trigger params come from definition defaults in MVP
- secret references resolve at execution time, not at definition save time
- resolved secret values must not be written back into persisted definition or exposed in logs

## Acceptance Criteria

1. AppOS provides a manual run API for workflow definitions.
2. Enabled cron-triggered workflow definitions are scheduled through PocketBase cron and dispatched into Asynq.
3. Workflow dispatch creates persisted workflow_run and workflow_node_run records before execution.
4. Overlap policy `skip` prevents duplicate cron-triggered runs of the same workflow while a prior run is active.
5. Runtime parameters and secret references resolve at execution time.
6. Workflow run list and detail APIs expose enough truth for the MVP UI.
7. Approval and cancellation endpoints exist for runtime-controlled nodes and runs.

## Out of Scope

- inbound webhook trigger
- catch-up scheduling
- multiple overlap policies
- cron editor UX beyond raw expression support inherited from definition authoring
