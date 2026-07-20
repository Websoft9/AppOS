# Implementation Note: Epic 17 AppInstance Projection Convergence

Status: implemented

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

## Executable Engineering Checklist

1. [x] Add a centralized AppInstance projection decision module under `backend/domain/lifecycle/projection/`.
2. [x] Move runtime-status normalization out of `backend/domain/routes/apps.go` into the projection package.
3. [x] Route existing updater entry points through one shared lifecycle-state decision function instead of assigning broad states inline.
4. [x] Keep write-path `lifecycle_state`, `health_summary`, and `publication_summary` persistence centralized while converging read-path precedence.
5. [x] Add dedicated unit tests for runtime normalization and lifecycle-state decisions before expanding mixed-evidence read/write integration.
6. [x] Move the main app route read-path runtime fallback onto the shared projection helper instead of route-local normalization logic.
7. [x] Expand full read/write convergence beyond sparse monitor-status fallback by preserving degraded stored evidence on successful write-path projection and by fixing terminal-pipeline activity misclassification when `current_phase` is retained.
8. [x] Introduce an explicit canonical `instance_state` read-path field for API consumers.
9. [x] Remove `lifecycle_state` from app list/detail API responses and from the primary app UI consumers.

## Planned Go Modules

1. `backend/domain/lifecycle/projection/app_instance_state.go`
2. `backend/domain/lifecycle/projection/app_instance_state_test.go`
3. existing integration points:
   - `backend/domain/lifecycle/projection/updater.go`
   - `backend/domain/routes/apps.go`

## Planned Function Signatures

```go
type RuntimeStatus string

type ActivityStatus string

type AppStateDecisionInput struct {
	Current            model.AppInstanceProjection
	ExistingApp        bool
	ActivityAction     model.OperationType
	ActivityStatus     ActivityStatus
	RuntimeStatus      RuntimeStatus
	HealthSummary      model.HealthSummary
	PublicationSummary model.PublicationSummary
}

func NormalizeRuntimeStatus(raw string) RuntimeStatus

func DecideAppLifecycleState(input AppStateDecisionInput) model.AppLifecycleState
```

The first slice keeps these signatures intentionally small. They are enough to centralize updater behavior and route runtime normalization without prematurely redesigning the whole aggregate.

Current code after the first refactor slice also includes:

```go
func RuntimeStatusFromProjection(current model.AppInstanceProjection) RuntimeStatus

func ResolveRuntimeStatus(current model.AppInstanceProjection, liveRaw string, runtimeReason string) RuntimeStatus
```

## Test Matrix

| Area | Cases |
| --- | --- |
| runtime normalization | `running`, `exited`, `stopped`, `restarting`, `starting`, `dead/error`, empty/unknown |
| queued activity | new install -> `installing`, existing change -> `updating`, recover/rollback -> `recovering`, maintain -> `maintenance` |
| succeeded activity | stop -> `stopped`, uninstall -> `retired`, maintain -> `maintenance`, publish/unpublish preserve lifecycle while publication changes, generic success -> running or degraded based on evidence |
| failed activity | failure -> `attention_required` with preserved reason handling |
| cancelled activity | first install without release -> `registered`; otherwise preserve prior lifecycle |
| observed evidence fallback | runtime stopped -> `stopped`, runtime running + healthy -> `running_healthy`, runtime restarting/error or degraded health/publication -> `running_degraded` |

## Current Refactor Status

The first convergence slice is now implemented:

1. `backend/domain/lifecycle/projection/app_instance_state.go` owns shared runtime normalization and lifecycle decision helpers.
2. `backend/domain/lifecycle/projection/updater.go` now calls the shared lifecycle decision function instead of hardcoding most broad lifecycle assignments inline.
3. `backend/domain/routes/apps.go` now resolves `runtime_status` through the shared projection helpers instead of route-local normalization logic.
4. Route-side shaping now merges primary exposure evidence and app monitor latest-summary evidence before final runtime and summary output.
5. App responses now compute an effective `lifecycle_state` from current pipeline activity plus merged observed evidence instead of only echoing the stored projection field.
6. Focused tests cover runtime normalization, state-decision paths, mixed evidence, and route integration compatibility.
7. The main app route now calls one unified projection-package resolver for effective lifecycle and runtime output instead of assembling those decisions inline in the route layer.
8. Pipeline-response to activity mapping and exposure-plus-monitor evidence interpretation now also live in the projection package; the route layer only loads raw records and summaries, then passes them into shared helpers.
9. The route layer now passes one unified raw-source contract into the projection package, which resolves activity, observed evidence, effective runtime, and effective lifecycle in one place.
10. `state_reason` is now resolved through the same effective projection path for read responses, so in-flight activity and runtime fallback no longer show stale write-path reasons such as `operation completed`.
11. App API responses now expose an explicit canonical `instance_state` field mapped from the effective projection and no longer return `lifecycle_state` on list/detail responses.
12. The main app list and detail pages now use `instance_state` as the primary user-facing state for badges, summary filtering, action gating, overview narration, and diagnostics.

The main remaining gap is no longer basic centralization. Read-path projection now consumes app monitor latest-status `status/reason` when summary payloads are sparse, successful write-path projection no longer blindly overwrites degraded stored evidence, and terminal pipelines are no longer misclassified as queued only because `current_phase` was retained. The remaining work is narrower: deeper mixed-evidence regression coverage and any future write-path inputs that should consume fresh monitor/exposure records directly instead of only respecting the stored projection fields.

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