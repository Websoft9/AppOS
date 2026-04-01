# Epic 17/18: App Instance Subdomain Assessment

**Module**: Application Lifecycle
**Status**: review
**Date**: 2026-04-01
**Scope**: Epic 17 Lifecycle Execution Core, Epic 18 Lifecycle Management Surface
**Primary Domain Focus**: `AppInstance`

## Objective

Assess whether Epic 17 and Epic 18 are aligned around the `AppInstance` subdomain, whether the current DDD boundary is clear enough to keep implementing safely, and where modeling or application-layer drift still exists.

This is not a new feature story. It is a domain and implementation assessment intended to guide the remaining convergence work.

## Executive Judgment

The overall direction is correct.

Epic 17 is now clearly framed as the execution core and Epic 18 is clearly framed as the management surface above it. The main ownership split is coherent:

- Epic 17 owns lifecycle execution contract, operation creation, execution state, timeline, logs, and audit-oriented execution truth.
- Epic 18 owns `AppInstance`-centered operator views, management entry points, and app-facing summaries built on top of Epic 17 outputs.

The strongest progress is already visible in Installed-side lifecycle action convergence and shared action-detail handoff.

The remaining risk is not conceptual confusion in the specs. The remaining risk is implementation drift in a few places where `AppInstance` management views still depend too directly on `Operation` details or where management-side change flows still bypass the shared execution path.

## Overall Assessment

### 1. Requirements Consistency

Assessment: strong

The Epic 17 and Epic 18 documents are aligned on the core product boundary:

- Epic 17 defines the shared lifecycle execution core rather than a generic deploy bucket.
- Epic 18 defines the installed-app management surface rather than a second execution system.
- Story `18.1a` provides a useful three-way classification for `App Detail`: `AppInstance aggregate state`, `lifecycle-related projections`, and `external runtime or observability data`.
- Story `18.2a` and `18.4a` extend that boundary correctly into lifecycle action handoff and execution-status navigation.

At the planning level, the team is no longer mixing long-lived app meaning and short-lived execution meaning in one concept. That is the right foundation.

### 2. Boundary Clarity

Assessment: mostly clear, with a few unstable seams

The target boundary is clear:

- `AppInstance` is the management-facing root object.
- `Operation` is the execution-facing object.
- `PipelineRun` and `PipelineNodeRun` are internal execution state, not product-facing app state.
- `ReleaseSnapshot` and `Exposure` remain related lifecycle objects, not fields that collapse back into `AppInstance`.

However, two seams are still weaker than the specs imply:

1. Some `AppInstance` read behavior still depends on `last_operation` as an implementation anchor instead of treating it as a related projection only.
2. Config mutation flows still behave like management-local actions instead of shared lifecycle actions.

These seams do not invalidate the model, but they do mean the boundary is not yet fully embodied in code.

## Domain Modeling Assessment

Assessment: good

### What is working well

1. The lifecycle ADR separates long-lived lifecycle state, operation state, release baseline, publication state, and pipeline execution state cleanly.
2. `AppInstance` remains the product-facing lifecycle state machine, which is the right choice for Installed-side UX and operator reasoning.
3. The `OperationType`, pipeline family, and projection vocabulary in backend lifecycle model code are consistent enough to support convergence work without reopening the whole domain.
4. The Epic 18 boundary-classification story is concrete enough to guide future app-detail additions without re-debating aggregate ownership.

### What is still weak

1. `desired_state` is part of the intended `AppInstance` aggregate meaning, but it is not fully surfaced through the current management projection.
2. Some app-scoped runtime context still behaves like derived execution residue rather than durable app-scoped context.

### Domain-model judgment

The model itself is not the problem. The model is ahead of some read-side and application-layer implementation choices.

## Domain Rules and Collaboration Assessment

Assessment: good, but not yet fully converged

### What is working well

1. Installed-side `start`, `stop`, `restart`, and `uninstall` now converge through shared lifecycle operations rather than direct local runtime mutation.
2. Projection updates are already centered around lifecycle projection logic instead of route-local state mutation for those converged actions.
3. `App Detail` and Installed-side views now hand operators to shared action detail rather than trying to own full execution interpretation locally.
4. Audit and execution history are treated as shared execution truth, not page-local state.

### What is still weak

1. Config apply and rollback are still not modeled as shared lifecycle actions.
2. App-scoped action history consumption is still implemented as management-side filtering over a broad execution API rather than as an explicit app-scoped execution query contract.
3. The practical collaboration rule “Epic 18 consumes execution truth but does not rebuild it” is mostly followed for actions, but less cleanly followed for execution-query shaping.

### Collaboration judgment

The direction is correct. The next step is not rethinking ownership. The next step is finishing convergence where behavior can still bypass or re-interpret the shared execution core.

## Application Implementation Assessment

Assessment: acceptable for continued work, but carrying debt that should be reduced before scope expands too far

### What is working well

1. The `/api/apps` surface now exposes a useful operator projection for list and detail pages.
2. Installed-side routes for lifecycle actions are thin enough to route into shared operation creation for the converged action set.
3. Dashboard Installed Apps and App Detail pages now use one shared handoff model for execution detail.
4. Backend tests already cover the converged lifecycle-action path.

### Where the implementation still drifts

#### A. App-scoped runtime context depends too heavily on `last_operation`

Current backend response shaping still resolves parts of app runtime/config context by following `app_instances.last_operation` back into `app_operations`.

This makes practical sense as a temporary bridge, but it means the management read model is still partially dependent on execution-history plumbing.

That is weaker than the intended domain boundary because:

- `last_operation` should remain a linked lifecycle projection.
- app-scoped management context should not fail only because the latest execution record is absent or no longer usable for read-side reconstruction.

#### B. App Detail action history still consumes a broad execution list and filters locally

The dashboard currently loads the general `/api/actions` list and filters it by app id in the client.

This works, but it is not the cleanest DDD or application-layer contract because:

- the management surface is effectively reconstructing an app-scoped execution query locally;
- execution ownership stays in Epic 17, but query shaping is drifting back into Epic 18 page code.

#### C. Config write and rollback remain on a local management path

Config write and rollback are still implemented as direct file mutation plus app record save and audit logging in the app-management route layer.

This is the clearest remaining example of a change flow that still behaves outside the shared lifecycle action model.

It is acceptable as interim behavior, but it should not be mistaken for the target architecture.

## Key Gaps

### Gap 1: AppInstance projection is not yet fully self-sufficient

The current projection is good enough for list/detail surfaces, but not yet strong enough to fully separate app-scoped management context from latest-execution reconstruction.

### Gap 2: Config mutation is still outside the shared lifecycle contract

This is now the main convergence gap after Installed-side action convergence.

### Gap 3: App-scoped execution query contract is not explicit enough

Epic 18 should consume app-scoped execution views from Epic 17 more directly rather than filtering broad execution inventory in the page layer.

### Gap 4: `desired_state` is under-expressed in the management read model

The concept exists in the domain model and projection structure, but it is not yet fully represented in the current management API/UI contract.

## Recommended Convergence Order

### Step 1: Stabilize app-scoped runtime context

Create a more explicit app-scoped runtime/query model so `project_dir`, source lineage, and similar operator-facing runtime anchors do not rely primarily on `last_operation` lookup.

This is the best next move because it strengthens the `AppInstance` management boundary without reopening execution ownership.

### Step 2: Introduce app-scoped action history/query consumption

Add an app-scoped execution query surface so Installed-side pages can request app-related action history and summaries directly, rather than loading broad action inventory and filtering in the client.

### Step 3: Converge config apply and rollback onto shared lifecycle actions

Treat config apply/rollback as shared lifecycle operations, even if the first slice remains thin and reuses the current file/IaC behavior under a lifecycle operation envelope.

### Step 4: Complete `desired_state` exposure in the management projection

Expose `desired_state` where it helps operators reason about intended versus current app state.

## What Should Not Be Reopened

The following decisions currently look sound and should not be casually reopened:

1. Epic 17 as the lifecycle execution core rather than a general deploy bucket.
2. Epic 18 as the management surface above the shared execution core.
3. `AppInstance` as the management-facing object.
4. `Operation` as the execution-facing object.
5. Shared action-detail handoff instead of embedding execution detail inside `App Detail`.

## Delivery Readiness Judgment

Epic 17 and Epic 18 are ready to continue implementation under the current DDD framing.

The work does not need a modeling reset.

It does need disciplined convergence on the remaining seams before too many more app-management capabilities are built on top of temporary bridges.

The project is in a good state if the team treats the remaining work as boundary-hardening and query-model cleanup, not as permission to blur `AppInstance` and `Operation` again.

## Recommended Follow-On Stories or Slices

1. `AppInstance runtime context stabilization`
2. `App-scoped action history query contract`
3. `Config apply/rollback lifecycle convergence`
4. `Desired state projection completion`

## References

- `specs/adr/app-lifecycle-domain-model.md`
- `specs/adr/appos-ddd-architecture.md`
- `specs/implementation-artifacts/epic17-app-execution.md`
- `specs/implementation-artifacts/epic18-app-management.md`
- `specs/implementation-artifacts/story18.1a-app-detail-boundary-classification.md`
- `specs/implementation-artifacts/story18.2a-local-action-convergence.md`
- `specs/implementation-artifacts/story18.4a-app-detail-action-handoff.md`