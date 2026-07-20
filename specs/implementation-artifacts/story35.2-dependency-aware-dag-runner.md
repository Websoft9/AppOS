# Story 35.2: Dependency-Aware DAG Runner

Status: proposed

## Story

As a lifecycle-engine maintainer,
I want the orchestration runner to execute nodes by dependency readiness,
so that pipeline metadata is behaviorally truthful and future operation families can branch, wait, compensate, and parallelize safely.

## Acceptance Criteria

1. The runner must select ready nodes from dependency state instead of iterating by declaration order alone.
2. `depends_on` relationships in pipeline definitions and persisted `pipeline_node_runs` must be execution-authoritative.
3. The runner must support explicit node outcomes at minimum for `succeeded`, `failed`, `cancelled`, `waiting`, `manual_gate`, and `compensated` semantics, even if some are initially policy-limited.
4. Independent nodes may execute in bounded parallelism when the selected rule profile and runtime target allow it.
5. Pipeline phase progression must derive from actual ready/running/completed node state, not array position.
6. Continuation, retry, and manual-gate decisions must be persisted so the worker can resume deterministically.

## Scope

- orchestration runner behavior
- pipeline/node persisted status transitions
- execution-context loading and ready-node selection
- node result contract used by lifecycle worker/executors

## Out of Scope

- replacing Asynq
- introducing an external workflow engine
- broad new operation families before runner semantics stabilize

## Implementation Notes

- Start with one deterministic ready-set scheduler; do not introduce a general-purpose workflow platform.
- Preserve the existing Asynq worker model; the runner changes behavior, not substrate.
- Keep node executors capability-based and avoid hiding orchestration inside nested subflows.

## Touch Points

- `backend/domain/lifecycle/orchestration/runner.go`
- `backend/domain/lifecycle/orchestration/execution_context.go`
- `backend/domain/lifecycle/orchestration/pipeline_seed.go`
- `backend/domain/worker/lifecycle_operations.go`
- `backend/domain/lifecycle/model/definitions.go`
- `backend/infra/schema/pipeline_runs.go`
- `backend/infra/schema/pipeline_node_runs.go`

## Suggested Order

1. define node outcome/status contract
2. implement ready-node selection from dependency state
3. persist waiting/manual-gate/continuation semantics
4. add bounded parallel ready-set execution
5. update phase-summary derivation and worker tests

## Risks

- Existing node executors may encode assumptions that only hold under sequential execution.
- Parallel execution must stay bounded by per-server conflict rules.

## References

- `specs/adr/app-lifecycle-pipeline-execution-engine.md`
- `specs/planning-artifacts/deployment-core-target-architecture.md`
