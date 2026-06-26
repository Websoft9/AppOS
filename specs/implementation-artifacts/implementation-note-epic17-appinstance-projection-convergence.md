# Implementation Note: Epic 17 AppInstance Projection Convergence

Status: proposed

## Purpose

Describe how the current AppInstance projection path should converge from scattered updater and read-path rules into one centralized projection module that implements the state contract frozen in `story17.3-instance-state-matrix.md`.

## Current Shape

Today AppInstance state is assembled from multiple places:

1. [backend/domain/lifecycle/projection/updater.go](backend/domain/lifecycle/projection/updater.go#L1) updates `lifecycle_state`, `health_summary`, and publication fields mainly from lifecycle operation outcomes.
2. [backend/domain/routes/apps.go](backend/domain/routes/apps.go#L934) normalizes runtime strings into `runtime_status` during API read-path assembly.
3. Monitoring and exposure evidence influence app detail indirectly, but they are not yet merged through one centralized AppInstance projection decision model.

This works for the first install loop, but it does not yet provide one deterministic contract for app-state semantics.

## Main Gaps

1. Operation outcome is treated as the dominant input even when runtime, health, or exposure evidence should override or refine the final product-facing state.
2. `running_healthy` is used as a broad success default, which hides distinctions such as degraded exposure, partial runtime recovery, or successful execution followed by unhealthy runtime.
3. `attention_required` is used as a broad failure sink without a clear boundary between degraded-but-observable runtime and true manual-intervention states.
4. Runtime normalization exists only in route read logic, so AppInstance state is not projected from one stable internal runtime vocabulary.
5. Publication state changes are mostly operation-result driven and not yet governed by a richer exposure-health projection pass.
6. No centralized precedence table exists for merging operation activity, runtime evidence, health evidence, exposure evidence, and desired state.

## Target Module

Add one centralized module under `backend/domain/lifecycle/projection/`, for example:

- `app_instance_state.go`

The module should expose a small deterministic API:

1. read current AppInstance projection inputs
2. normalize technical evidence into shared vocabularies
3. decide the canonical `instance_state`
4. write the resulting AppInstance projection fields and reason text

## Recommended Inputs

The centralized projector should merge these inputs explicitly:

1. latest active or in-flight lifecycle operation
2. operation terminal result and current phase
3. desired state
4. normalized runtime status
5. health summary
6. exposure/publication summary
7. key timestamps and existing projection anchors such as install, healthy, and retire markers

## Recommended Output Contract

The projector should become the single writer of these product-facing fields:

1. `lifecycle_state` or future `instance_state`
2. `health_summary`
3. `publication_summary`
4. `state_reason`
5. `installed_at`
6. `last_healthy_at`
7. `retired_at`

`OperationJob` fields such as `phase`, `terminal_status`, `failure_reason`, and `app_outcome` must remain owned by execution records rather than copied into AppInstance state verbatim.

## Convergence Steps

1. Extract and centralize runtime normalization so `runtime_status` is produced from one shared helper rather than ad hoc route logic.
2. Introduce a projection decision function that implements the precedence order frozen in `story17.3-instance-state-matrix.md`.
3. Make existing updater entry points call the centralized decision function rather than assigning broad lifecycle states directly.
4. Keep route handlers as readers of already-projected state plus technical detail, not hidden owners of projection semantics.
5. Expand tests around mixed evidence cases: successful update with degraded runtime, stopped desired state, publish degradation, partial runtime, and uninstall in flight.

## Boundaries

- This note does not redefine pipeline DAG execution.
- This note does not move action-history or timeline ownership away from `app_operations`, `pipeline_runs`, or `pipeline_node_runs`.
- This note does not require UI-first changes; the backend projection contract should converge before frontend surfaces depend on richer semantics.

## Immediate Follow-up

1. Keep `story17.3-instance-state-matrix.md` as the contract source.
2. Implement centralized projection convergence before broadening change/recovery semantics or Epic 18 management-state consumption.
3. Treat read-path runtime normalization and write-path lifecycle updates as one convergence target, not as separate long-term models.