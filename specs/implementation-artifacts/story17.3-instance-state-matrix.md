# Story 17.3: AppInstance State Matrix and Projection Contract

Status: proposed

## Story

As a platform operator,
I want one canonical AppInstance state matrix and projection contract,
so that product-facing app state stays stable while execution, runtime, health, and exposure details remain separated and interpretable.

## Acceptance Criteria

1. `AppInstance` must expose one product-facing primary state vocabulary that does not reuse raw execution phases or raw runtime strings as top-level state.
2. The canonical primary state vocabulary must stay limited to: `installing`, `running`, `degraded`, `stopped`, `updating`, `uninstalling`, `attention_required`, `retired`, and `unknown`.
3. Technical state dimensions must remain explicit and separate from the primary state, at minimum covering: presence, activity, runtime, health, and exposure.
4. The backend must define deterministic projection rules from lifecycle operation state, runtime observation, health summary, and exposure summary into the primary AppInstance state.
5. `installed` must not be the user-facing primary AppInstance state; it must remain a presence fact or equivalent technical dimension.
6. Raw runtime observations such as Docker or Compose strings may be preserved, but they must not become the canonical product-facing AppInstance state vocabulary.
7. Projection rules must define precedence for in-flight operations, runtime failures, degraded health, successful stop, uninstall completion, and ambiguous or missing evidence.
8. The story must document current gaps between the existing projection/updater implementation and the target model so later execution and management stories can converge on one contract.

## Canonical Matrix

### User-facing primary state

| `instance_state` | Meaning |
| --- | --- |
| `installing` | first install is in progress |
| `running` | runtime is available and health is acceptable |
| `degraded` | the app exists but runtime, health, or exposure evidence is degraded |
| `stopped` | the app is intentionally not running |
| `updating` | a change operation is in progress |
| `uninstalling` | uninstall or retirement is in progress |
| `attention_required` | safe automatic convergence failed and operator action is required |
| `retired` | lifecycle ended and the app is no longer active |
| `unknown` | available evidence is insufficient or conflicting |

### Technical dimensions

| Dimension | Suggested values | Notes |
| --- | --- | --- |
| `presence_state` | `present`, `absent`, `retiring`, `unknown` | replaces overloading `installed` as a primary product state |
| `activity_action` | `install`, `update`, `restart`, `stop`, `start`, `uninstall`, `rollback`, `verify`, `none` | derived from the active or latest lifecycle operation |
| `activity_phase` | `queued`, `preparing`, `executing`, `verifying`, `completed`, `failed`, `blocked`, `unknown` | operation or pipeline detail, not product state |
| `runtime_status` | `running`, `partial`, `starting`, `restarting`, `stopped`, `error`, `unknown` | normalized runtime observation |
| `health_status` | `healthy`, `degraded`, `stopped`, `unknown` | runtime health summary |
| `exposure_status` | `published`, `degraded`, `unpublished`, `unknown` | external publication summary |

## Projection Rules

Apply the first matching rule in priority order:

1. `presence_state=absent` or lifecycle retirement completed -> `retired`
2. `activity_action=uninstall` and operation is non-terminal -> `uninstalling`
3. `activity_action=install` and operation is non-terminal -> `installing`
4. non-terminal `activity_action` in `update`, `restart`, `start`, `stop`, `rollback`, `recover`, `publish`, or `unpublish` -> `updating`
5. terminal failure requiring manual intervention -> `attention_required`
6. `runtime_status=stopped` and desired state is stopped or stop succeeded -> `stopped`
7. `runtime_status=running` and `health_status=healthy` and exposure is not degraded -> `running`
8. any present app with `runtime_status=error`, `runtime_status=partial`, `health_status=degraded`, or `exposure_status=degraded` -> `degraded`
9. otherwise -> `unknown`

## Scope Boundaries

- This story defines AppInstance projection semantics and vocabulary.
- This story does not redefine `OperationJob.phase`, `OperationJob.terminal_status`, or pipeline node execution semantics.
- This story does not replace runtime-specific raw observations; it defines how those observations are normalized and projected.
- This story does not own create-page UX, action history UI, or publication workflow implementation.
- Epic 17 owns the definition of this contract; Epic 18 and later modules consume it.

## Current Gaps vs Target Model

1. The current updater in [backend/domain/lifecycle/projection/updater.go](backend/domain/lifecycle/projection/updater.go#L68) is mainly operation-outcome-driven and does not project from runtime observation, health evidence, and exposure evidence together.
2. Successful operations default many paths to `running_healthy`, which is too coarse for cases such as partial runtime recovery, degraded publication, or successful update with unresolved health degradation.
3. Failure handling currently collapses to `attention_required` broadly, without distinguishing recoverable degraded runtime from true manual-intervention states.
4. `runtime_status` is normalized in read-path code at [backend/domain/routes/apps.go](backend/domain/routes/apps.go#L934) but is not part of one centralized AppInstance projection contract.
5. Publication state is updated mostly from publish and unpublish operation success, not from a richer exposure-health projection loop.
6. There is no explicit centralized transition matrix or precedence table for AppInstance state; behavior is spread across lifecycle vocabulary, updater rules, route read logic, and monitoring data.
7. `state_reason` is freeform and useful, but it is not yet driven by a structured state-decision model.
8. The current model does not preserve a richer normalized runtime vocabulary such as `partial`, `starting`, or `restarting` for AppInstance projection.

## Relationship to Existing Epic 17 Work

- Story `17.1` freezes lifecycle ownership boundaries and execution vocabulary.
- Story `17.5` exposes execution observability and must not become the owner of product-facing app-state semantics.
- Story `17.6` and later management stories consume this contract but do not define it.
- Existing `17.3 Change and Recovery Operations` should use this matrix rather than inventing action-specific AppInstance state semantics.

## Dev Notes

- The existing ADR already states that `AppInstance` is the product-facing lifecycle state machine while `OperationJob` and `PipelineRun` own execution detail.
- The implementation target should be one centralized AppInstance projection module that merges operation state, runtime evidence, health evidence, and exposure evidence before API serialization.

### References

- [Source: specs/adr/app-lifecycle-domain-model.md]
- [Source: specs/implementation-artifacts/epic17-app-execution.md]
- [Source: specs/implementation-artifacts/story17.1-lifecycle-contract.md]
- [Source: specs/implementation-artifacts/story17.5-action-history-timeline.md]
- [Source: specs/implementation-artifacts/implementation-note-epic17-appinstance-projection-convergence.md]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Freezes a compact but complete AppInstance state contract without mixing it into execution-state vocabulary.
- Records the main implementation gap: AppInstance state is still updated mostly from operation outcomes instead of a unified projection decision model.


### File List