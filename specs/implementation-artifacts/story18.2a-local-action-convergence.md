# Story 18.2a: Local Action Convergence

Status: review

## Story

As an operator,
I want Installed-side lifecycle actions to route through the shared Epic 17 execution core,
so that `start`, `stop`, `restart`, and `uninstall` no longer bypass the common operation model, execution history, and audit semantics.

## Acceptance Criteria

1. Installed-side `start`, `stop`, `restart`, and `uninstall` stop using direct compose execution as their primary management path and instead create or resume shared lifecycle operations.
2. These actions produce or reference the same canonical lifecycle execution record family used by other Epic 17-backed actions.
3. `App Detail` and Installed-side views navigate to shared execution status through operation references instead of treating these actions as local-only synchronous mutations.
4. App state summaries shown in Installed-side views are updated from shared lifecycle projection rules rather than ad hoc local `markAppAction` mutations.
5. Audit semantics for these actions align with Epic 17 operation creation and execution result handling.
6. Any remaining direct runtime path, if temporarily retained for migration safety, is explicitly documented as interim fallback and not presented as the target architecture.

## Delivered Now

- [x] Installed-side local action bypasses are documented.
- [x] Convergence target for `start`, `stop`, `restart`, and `uninstall` is defined against the shared execution core.
- [x] Epic 18 follow-on work can use one convergence note instead of re-deciding local vs shared action semantics.

## Still Deferred

- [x] Full implementation of shared lifecycle operations for `start`, `stop`, `restart`, and `uninstall` in the Installed-side slice.
- [ ] Publication, maintenance, recovery, and backup convergence beyond this local-action slice.
- [ ] UI refinements for pending/running/completed action feedback once shared operations become canonical.

## Implemented in This Slice

1. `start`, `stop`, `restart`, and `uninstall` now create shared lifecycle operations from `backend/internal/routes/apps.go`.
2. `restart` is now a formal lifecycle vocabulary item with metadata registry coverage.
3. Runtime execution now supports converged `runtime_stop`, `runtime_restart`, `runtime_check`, and `retirement` nodes.
4. Installed-side projections now update from shared operation success semantics instead of route-local `markAppAction` mutations.
5. `handleAppInstanceAction` and `markAppAction` were removed from the primary backend path.
6. `App Detail` and `Installed Apps` now navigate to shared action detail after creating these operations.

## Current Baseline (2026-03-30)

Current Installed-side action behavior is split:

1. `upgrade` and `redeploy` already create shared lifecycle operations through `handleAppInstanceLifecycleOperation`.
2. `start`, `stop`, and `restart` still call direct compose runtime actions through `handleAppInstanceAction`.
3. `uninstall` still performs direct `compose down`, updates the app record locally, and returns success without creating a shared operation record.

This means Installed-side management currently has two action models:

1. shared Epic 17 lifecycle execution for some actions
2. local runtime mutation for others

That split is exactly what this story is meant to eliminate.

## Current Code Evidence

| Action | Current Path | Current Behavior | Target Direction |
| --- | --- | --- | --- |
| `upgrade` | `/api/apps/{id}/upgrade` | creates shared lifecycle operation | keep on shared core |
| `redeploy` | `/api/apps/{id}/redeploy` | creates shared lifecycle operation | keep on shared core |
| `start` | `/api/apps/{id}/start` | direct compose start + local `markAppAction` update | converge to shared lifecycle operation |
| `stop` | `/api/apps/{id}/stop` | direct compose stop + local `markAppAction` update | converge to shared lifecycle operation |
| `restart` | `/api/apps/{id}/restart` | direct compose restart + local `markAppAction` update | converge to shared lifecycle operation |
| `uninstall` | `DELETE /api/apps/{id}` | direct compose down + local uninstall mutation | converge to shared lifecycle operation |

## Dev Notes

- This is an Epic 18 integration-convergence story, not an Epic 17 execution-contract story.
- Epic 17 already owns operation creation, execution state, timeline, logs, and audit linkage for shared lifecycle operations.
- The problem here is not missing lifecycle action UX; it is the remaining dual-path execution behavior in Installed-side management.
- Convergence should preserve `AppInstance` as the management-facing object while moving action execution truth into shared `Operation` records.
- This story should align terminology with the current DDD ADR: prefer `Operation` as the canonical concept even if some legacy docs still say `OperationJob`.

## Backend Implementation Breakdown

### 1. Route entry-point convergence

- Replace the `start` and `stop` handlers in `backend/internal/routes/apps.go` so they no longer call `handleAppInstanceAction` and instead use `handleAppInstanceLifecycleOperation`.
- Change `uninstall` in `backend/internal/routes/apps.go` from direct `ComposeDown` execution to shared operation creation using the same `createOperationFromCompose` path already used by `upgrade` and `redeploy`.
- Treat `restart` as a convergence case that may require a lifecycle-vocabulary addition before route unification, because the current route still passes the string literal `restart` and there is no formal `OperationTypeRestart` in `backend/internal/lifecycle/model/vocabulary.go`.

### 2. Operation vocabulary and metadata alignment

- Keep `start`, `stop`, and `uninstall` on the canonical operation vocabulary already present in `backend/internal/lifecycle/model/vocabulary.go`.
- Decide whether `restart` should become a first-class lifecycle operation type or be explicitly modeled as a composed sequence outside the primary convergence scope. The default recommendation for this story is to add a formal lifecycle operation type if the shared execution core is expected to own restart as a first-class action.
- Ensure route-created operations carry enough metadata for Installed-side handoff, including `installed_app_id`, `requested_action`, and `project_dir`.
- For `uninstall`, explicitly decide how `removeVolumes` is represented. Preferred direction: carry it in operation metadata/spec so the shared execution path, audit trail, and timeline remain reproducible.

### 3. Shared execution handoff requirements

- Reuse `handleAppInstanceLifecycleOperation` as the primary convergence helper where possible instead of creating a second Installed-only operation creation path.
- If `uninstall` requires a specialized helper, keep it as a thin wrapper around `createOperationFromCompose` rather than preserving direct runtime mutation in the route.
- Do not leave `handleAppInstanceAction` as the default path for any target action covered by this story.
- Once convergence is complete, `handleAppInstanceAction` and `markAppAction` should either be removed or reduced to clearly temporary migration-only fallback logic that is not on the primary request path.

### 4. Projection ownership changes

- Stop mutating `app_instances` directly in the request path for converged actions.
- Replace local `markAppAction`-driven state updates with projection updates derived from shared operation lifecycle events.
- Preserve `AppInstance.last_operation` as the linkage point used by Installed-side detail and list views.
- Verify that `backend/internal/lifecycle/projection/updater.go` remains the canonical place where `stop` and `uninstall` drive `AppInstance` state changes, and extend it only if `restart` becomes a first-class lifecycle operation.

### 5. Backend test additions

- Add route tests in `backend/internal/routes/apps_test.go` for `start` and `stop` that assert `202 Accepted` and creation of `app_operations`, matching the existing `upgrade` operation-creation test shape.
- Add a route test for `DELETE /api/apps/{id}` that asserts uninstall creates a queued shared operation instead of returning immediate local success.
- Add tests that confirm the created operation carries the expected existing project directory, compose project name, and requested action metadata.
- Add or update lifecycle metadata tests so selector coverage exists for every converged action. If `restart` becomes a formal operation type, add selector and registry coverage for it.
- Remove or rewrite any tests that currently encode synchronous direct-action behavior for converged routes.

## Implementation Sequence

1. Converge `start` and `stop` onto `handleAppInstanceLifecycleOperation`.
2. Convert `uninstall` to shared operation creation, including `removeVolumes` propagation.
3. Decide and implement the `restart` model.
4. Retire or isolate `handleAppInstanceAction` and `markAppAction`.
5. Backfill route, metadata, and projection tests.

## Explicit Decisions Needed

1. `restart`: add first-class `OperationTypeRestart` or deliberately defer restart convergence out of this story.
2. `uninstall.removeVolumes`: treat as durable operation input or accept a temporary metadata-only bridge.
3. Migration posture: fully remove local direct runtime routes in this slice, or retain a guarded fallback behind non-default code paths only.

Recommended default for this story:

- `start`, `stop`, and `uninstall` must converge now.
- `restart` should converge in the same story only if its lifecycle vocabulary, metadata registry, and worker/execution path can be added without re-opening Epic 17 contract scope.

## Minimal Acceptance Test Checklist

- [x] `POST /api/apps/{id}/start` returns a shared operation payload instead of synchronous runtime output.
- [x] `POST /api/apps/{id}/stop` returns a shared operation payload instead of synchronous runtime output.
- [x] `DELETE /api/apps/{id}` creates a shared uninstall operation and does not mutate `app_instances` directly in-route.
- [x] `AppInstance.last_operation` is updated through shared operation/projection flow for converged actions.
- [x] No primary Installed-side path still depends on `markAppAction` for `start`, `stop`, or `uninstall`.
- [ ] Audit records for converged actions reflect operation creation semantics rather than local direct execution semantics.

### Migration Intent

#### Current undesired pattern

- Installed view calls direct runtime action
- runtime mutates immediately
- app summary is updated locally
- no shared operation history is created for that action family

#### Target pattern

- Installed view requests lifecycle action
- backend creates or resumes shared `Operation`
- Epic 17 execution core owns runtime mutation
- projections update `AppInstance`
- Installed view links to shared execution status

### References

- [Source: specs/implementation-artifacts/epic18-app-management.md#Current Baseline (2026-03-25)]
- [Source: specs/implementation-artifacts/epic18-app-management.md#Requirements]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Objective]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Remaining Work Summary]
- [Source: specs/adr/appos-ddd-architecture.md#L129]
- [Source: specs/adr/appos-ddd-architecture.md#L246]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Story updated after implementation. Installed-side `start`, `stop`, `restart`, and `uninstall` now converge on the Epic 17 shared execution core.
- Backend route tests and worker/runtime tests now cover the converged path, and Installed-side frontend pages hand off to shared action detail.

### File List
