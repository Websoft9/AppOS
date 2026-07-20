# Story 36.2: Workflow DAG Runner

**Epic**: Epic 36 - Workflow
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 36.1, Story 35.2

## Objective

Implement the independent DAG execution runner for Workflow without modifying lifecycle orchestration.

## Scope

- build `backend/domain/workflow/engine/runner.go`
- implement dependency-aware ready-node execution
- support bounded parallelism
- persist node status and node outputs
- support node-level retry and timeout
- support orphan recovery for workflow runs

## Product Decisions

- Workflow runner is independent from `backend/domain/lifecycle/orchestration/runner.go`
- design may mirror lifecycle runner patterns, but code remains separate
- workflow runner is authoritative for scheduling order, status transitions, and retry decisions
- `subworkflow` is synchronous only in MVP
- overlap policy in MVP supports only `skip`
- cancel is best-effort cooperative cancellation in MVP

## Execution Contract

Runner loop contract:

1. claim one pending workflow run
2. load definition + node runs + resolved parameters + target context
3. select ready nodes from dependency state
4. execute ready set in bounded parallelism
5. persist node outputs and terminal status
6. stop when all nodes are terminal or one unrecoverable failure occurs

Ready node rules:

- node status must be `pending`
- all `depends_on` nodes must be terminal-successful for the current path
- skipped or compensated semantics are not required in MVP unless implementation naturally needs them

Terminal statuses required in MVP:

- `succeeded`
- `failed`
- `cancelled`
- `waiting`
- `manual_gate`

Cancellation rule:

- a run marked cancelled stops scheduling new nodes
- currently running nodes may finish or terminate according to executor capability
- cancellation is persisted even if some underlying remote work is only best-effort stopped

## Data Propagation

MVP data propagation supports:

- `{{ params.x }}`
- `{{ outputs.node_key.field }}`
- `{{ secrets.name }}`

Output rules:

- each node may emit structured `output_json`
- node output persistence happens before downstream scheduling
- downstream interpolation reads persisted outputs, not in-memory transient state

## Retry and Timeout

Node-level retry:

- node definition may set `retry.limit`
- retries are persisted through `retry_count`
- exhausted retry marks node `failed`

Node-level timeout:

- node definition may set `timeout_sec`
- timeout marks node failed with a machine-readable reason

## Recovery Policy

Workflow runner must support orphan recovery similar to lifecycle worker behavior:

- detect runs stuck in active non-terminal state after worker restart
- mark incomplete running nodes failed or abandoned according to MVP policy
- leave an audit-visible reason in run and node error fields

## Touch Points

- `backend/domain/workflow/engine/runner.go`
- `backend/domain/workflow/engine/plan.go`
- `backend/domain/workflow/engine/state.go`
- `backend/domain/worker/`

## Acceptance Criteria

1. Workflow uses an independent runner and does not modify lifecycle runner code.
2. The runner selects nodes by dependency readiness rather than declaration order alone.
3. The runner supports bounded parallel execution of independent nodes.
4. Node outputs are persisted and become available to downstream nodes through interpolation.
5. Node-level retry and timeout are persisted and execution-authoritative.
6. Workflow runs support orphan recovery after worker restart.
7. Overlap policy `skip` is supported for cron-triggered runs.

## Out of Scope

- generalized compensation system
- distributed worker fabric beyond Asynq
- async subworkflow execution
- workflow-level hook framework
