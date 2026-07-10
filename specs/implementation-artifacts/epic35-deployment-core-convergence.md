# Epic 35: Deployment Core Convergence

**Module**: Application Lifecycle | **Status**: proposed | **Priority**: P1 | **Depends on**: Epic 17, Epic 18, Epic 34

**Domain References**:

- `specs/planning-artifacts/deployment-architecture-assessment.md`
- `specs/planning-artifacts/deployment-core-target-architecture.md`

## Objective

Converge AppOS onto one deployment/lifecycle execution core.

Epic 35 removes the remaining split between the legacy `deployments` path and the lifecycle-oriented execution core. It upgrades the runner from ordered pipeline execution to a true dependency-aware DAG runner, simplifies projection into a resolver over canonical facts, and introduces `RuleProfile` as the strategy layer for execution, compensation, and publication policy.

This epic is not a feature-add bucket. It is an architecture-convergence epic.

## Scope Guardrails

1. `deployments` is removed as a lifecycle truth source. No compatibility path is required.
2. Every lifecycle action must be represented as one `app_operation` plus one optional `pipeline_run` and related `pipeline_node_runs`.
3. `AppInstance` remains the product-facing projection and must not become the worker's in-flight state store.
4. Pipeline definitions remain metadata-driven; execution behavior must match DAG semantics instead of declaration-order semantics.
5. Projection must resolve from normalized facts. It must not hide upstream ambiguity through uncontrolled heuristics.
6. Strategy variation must move into `RuleProfile`, not expand as worker-side branching.
7. Existing Actions/history/log/timeline surfaces remain backed by lifecycle tables only.

## Acceptance Criteria

- There is one canonical lifecycle execution model: `app_operations`, `pipeline_runs`, `pipeline_node_runs`, `app_releases`, `app_exposures`, and `app_instances` projection.
- Legacy `deployments` schema, worker flow, and state transitions are no longer part of runtime lifecycle truth.
- The orchestration runner schedules nodes by dependency readiness, not by array order.
- Projection inputs are normalized before projection resolution and are traceable to explicit fact sources.
- `RuleProfile` exists as a first-class runtime selector for pipeline choice and policy behavior.
- Create/install/manage/publish flows consume the same converged execution core.

## Delivery Slices

### Slice 1: Canonical Execution Collapse

Remove the legacy deployment execution path and make lifecycle tables the only operational truth.

Status: proposed

### Slice 2: DAG Runner Upgrade

Upgrade the orchestration engine from sequential ordered-node execution to real dependency-aware DAG scheduling.

Status: proposed

### Slice 3: Projection Fact Model

Refactor AppInstance projection so it resolves state from canonical normalized facts rather than mixed raw strings and recovery heuristics.

Status: proposed

### Slice 4: RuleProfile Strategy Layer

Introduce `RuleProfile` as the strategy and policy layer for pipeline selection, compensation, retry, manual gates, and publication behavior.

Status: proposed

## Recommended Order

1. 35.1 remove legacy `deployments` from runtime truth and entry flows.
2. 35.2 upgrade the runner into a real DAG executor.
3. 35.3 simplify projection and normalize evidence boundaries.
4. 35.4 materialize `RuleProfile` and wire pipeline/policy selection through it.

Reason: execution truth must converge before projection and strategy can be cleaned up safely.

## Stories

### Story 35.1 Canonical Lifecycle Execution Cutover

Remove legacy `deployments` from active lifecycle truth and route all deployment/lifecycle actions through `app_operations` and the lifecycle worker path.

### Story 35.2 Dependency-Aware DAG Runner

Turn the current ordered-node orchestration runner into a real DAG scheduler with ready-node selection, persisted node-state transitions, and bounded parallel execution for independent nodes.

### Story 35.3 Projection Fact Model Convergence

Refactor AppInstance projection so product-facing state is resolved from canonical normalized facts for runtime, health, exposure, and activity, with explicit precedence and traceability.

### Story 35.4 RuleProfile Strategy Layer

Introduce `RuleProfile` as the runtime strategy boundary that owns pipeline selection, retry, compensation, manual-gate, verification, and publication policy.

## Story Status

| Story | Status |
|-------|--------|
| 35.1 Canonical Lifecycle Execution Cutover | proposed, development-ready |
| 35.2 Dependency-Aware DAG Runner | proposed, development-ready |
| 35.3 Projection Fact Model Convergence | proposed, development-ready |
| 35.4 RuleProfile Strategy Layer | proposed, development-ready |

## Story Artifacts

- `story35.1-canonical-lifecycle-execution-cutover.md`
- `story35.2-dependency-aware-dag-runner.md`
- `story35.3-projection-fact-model-convergence.md`
- `story35.4-rule-profile-strategy-layer.md`

## Remaining Work Summary

1. Collapse all lifecycle execution onto one truth model.
2. Align orchestration runtime behavior with the persisted DAG metadata model.
3. Reduce projection-layer ambiguity and make state derivation auditable.
4. Make policy variation explicit and metadata-driven through `RuleProfile`.
