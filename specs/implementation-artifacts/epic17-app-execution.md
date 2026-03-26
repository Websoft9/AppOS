# Epic 17: Lifecycle Execution Core

**Module**: Application Lifecycle | **Status**: in-progress | **Priority**: P1 | **Depends on**: Epic 4, Epic 5, Epic 8, Epic 12, Epic 14

**Domain Reference**: `specs/adr/app-lifecycle-domain-model.md`

## Objective

Provide the shared lifecycle execution core for AppOS. Epic 17 owns the execution contract, orchestration model, execution state, recovery guardrails, and audit/observability surfaces for lifecycle actions and executions.

Epic 17 is not a broad "deploy" bucket. Store entry, installed-app management, and publication UX may enter or consume the core, but they do not redefine it.

Additional references:

- `specs/adr/app-lifecycle-pipeline-execution-engine.md`
- `specs/adr/app-lifecycle-install-resolution.md`

## Scope Guardrails

1. `AppInstance` is the product-facing projection. `OperationJob` is execution state. `PipelineRun` and `PipelineNodeRun` are the internal timeline. `ReleaseSnapshot` is the recoverable baseline. `Exposure` is publication state.
2. All inputs must normalize into one operation contract before queueing. There is no Store-only, Git-only, or Installed-only execution path.
3. Execution state is always split into `phase`, `terminal_status`, `failure_reason`, and `app_outcome`.
4. For each `server_id`, only one conflicting lifecycle operation may be active at a time.
5. First install failure performs cleanup and records failure. It does not pretend rollback exists when no baseline exists.
6. Action history, execution detail, timeline, logs, and audit are part of the MVP closed loop, not optional reporting extras.

## Current Baseline (2026-03-25)

### Implemented

- Clean-slate lifecycle collections exist for `app_instances`, `app_operations`, `app_releases`, `app_exposures`, `pipeline_runs`, and `pipeline_node_runs`.
- Lifecycle vocabulary, projection types, pipeline family metadata, and selector-based definition lookup are in place.
- Operation creation from Manual Compose and Git Compose is implemented on one shared contract.
- Pipeline seeding, async worker execution, serial per-server claim logic, cancellation requests, and orphaned-operation recovery are implemented.
- First install can run through validate -> prepare -> execute -> verify and produce a first active release baseline on success.
- Action history/detail, execution timeline, logs, stream updates, and audit linkage are implemented and already consumed by the Actions UI.
- Store/template entry can prefill the shared compose-based install path instead of creating a separate Store execution path.

### Not Yet Implemented

- Upgrade, rollback, recover, and reconfigure flows on the shared execution core.
- Publication-sensitive execution on the shared core.
- Full convergence of Installed-side lifecycle actions onto Epic 17 for start, stop, uninstall, and later management actions.
- Rich compensation/manual-gate policy beyond the first closed loop.

## Acceptance Criteria

- Epic 17 is described and implemented as a lifecycle execution core, not as a generic deploy bucket.
- The canonical first closed loop is install on the shared operation contract with observable pipeline progress and release creation.
- Input adapters feed the same normalized contract and do not introduce separate execution semantics.
- Action history, execution detail, log, timeline, and audit surfaces are available early enough for Epic 18 and operator troubleshooting.
- Deferred work is clearly isolated to change/recovery, publication, and broader management convergence.

## Delivery Slices

### Slice 1: Contract and Scheduler Core

Freeze the execution contract, lifecycle collections, pipeline metadata model, queue boundary, serial scheduling rule, cancel semantics, and orphan recovery semantics.

Status: review

### Slice 2: First Install Closed Loop

Prove the shared core with one narrow path: normalized compose input -> async execution -> release activation or safe failure -> observable status, detail, timeline, and logs.

Status: review

### Slice 3: Input Adapters

Add Store/template prefill and Git Compose retrieval without creating adapter-specific execution paths.

Status: review

### Slice 4: Change and Recovery

Add upgrade, redeploy, reconfigure, rollback, and recovery on top of the same core once baselines and observability are stable.

Status: backlog

### Slice 5: Publication on Shared Core

Add `publish` and `unpublish` with `Exposure` updates and compensation-aware failure handling.

Status: backlog

## Recommended Order

1. 17.1 contract and scheduler core
2. 17.5 minimum observability surface
3. 17.2 first install closed loop
4. 17.4 adapter entry slices
5. 17.3 change and recovery
6. 17.6 publication operations

Reason: the first closed loop is not valid unless it is queryable and debuggable.

## Stories

### Story 17.1 Lifecycle Contract and Scheduler Core

Define the execution contract, clean-slate lifecycle collections, selector-based pipeline model, queue boundary, serial scheduling invariant, cancellation, and orphan recovery semantics.

### Story 17.2 First Install Closed Loop (MVP)

Implement first install end-to-end on the shared lifecycle execution core with validation, async worker execution, timeline persistence, release activation, and safe first-install failure behavior.

### Story 17.3 Change and Recovery Operations

Implement upgrade, redeploy, reconfigure, recover, and rollback on the shared execution core using release baselines and deterministic failure handling.

### Story 17.4 Input Adapters (MVP Scope)

Add adapter entry slices that normalize into the shared execution contract without redefining runtime behavior.

- **17.4a Store Compose Prefill:** preload library/template compose into the shared install path.
- **17.4b Git Compose Adapter:** fetch git-hosted compose safely and create the same install operation.
- **17.4c Docker Run Adapter (post-MVP):** parse `docker run` into the normalized contract.
- **17.4d Source Package Adapter (post-MVP):** resolve source package/build input into the normalized contract.
- **17.4e Install Input Resolution:** normalize dialog-driven install inputs into one backend-owned lifecycle install payload before operation creation.

### Story 17.5 Action History and Execution Timeline Surface

Expose action history, execution detail, timeline, log, and audit surfaces for lifecycle execution so other modules consume one shared execution truth.

### Story 17.6 Create Deployment Page and Install Resolution Surface

Replace modal-based deployment creation with a full-page lifecycle entry surface that collects source-specific inputs, shows normalized install intent, and submits through the shared install resolution boundary.

## Story Status

| Story | Status |
|-------|--------|
| 17.1 Lifecycle Contract and Scheduler Core | review |
| 17.2 First Install Closed Loop (MVP) | review |
| 17.3 Change and Recovery Operations | backlog |
| 17.4a Store Compose Prefill | review |
| 17.4b Git Compose Adapter | review |
| 17.4e Install Input Resolution | in-progress |
| 17.5 Action History and Execution Timeline Surface | review |
| 17.6 Create Deployment Page and Install Resolution Surface | backlog |

## Story Artifacts

- `story17.1-lifecycle-contract.md`
- `story17.2-first-install.md`
- `story17.4a-store-deploy.md`
- `story17.4b-git-compose.md`
- `story17.4e-install-input-resolution.md`
- `story17.5-operation-history-timeline.md`
- `story17.6-create-deployment-page.md`

## Remaining Work Summary

1. Move change/recovery operations onto the shared core.
2. Replace modal-only deployment creation with a full-page install-resolution surface.
3. Finish backend-owned install input convergence so adapter-specific install flows resolve through one explicit normalizer.
4. Finish Installed-side convergence so lifecycle action entry points stop bypassing Epic 17.
5. Expand compensation and manual-intervention behavior beyond the first install slice.
