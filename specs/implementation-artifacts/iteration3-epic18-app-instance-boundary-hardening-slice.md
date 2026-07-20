# Iteration 3: Epic 18 App Instance Boundary Hardening Slice

Status: proposed

## Objective

Execute the next Epic 18 convergence slice after Installed-side action convergence and action-detail handoff.

This slice hardens the `AppInstance` management boundary without reopening Epic 17 execution ownership.

It focuses on four linked stories:

1. `18.1b App Runtime Projection`
2. `18.4a App Action Handoff`
3. `18.3a Config Apply and Rollback Lifecycle Convergence`

## Why This Slice Next

The current model is directionally correct, but the remaining debt now sits in read-side and mutation seams:

1. `AppInstance` detail shaping still reconstructs app-scoped runtime context through `last_operation` in places where a stable management projection should exist.
2. `App Detail` still loads broad action inventory and filters locally instead of consuming an app-scoped execution query contract.
3. Config write and rollback still bypass the shared lifecycle operation model.
4. `desired_state` exists in the domain model but is not fully expressed in the management API/UI contract.

These issues are tightly coupled. Solving them together produces a cleaner management surface and reduces the chance that future Epic 18 work will build on temporary bridges.

## Included Stories

| Story | Purpose | Current Status |
| --- | --- | --- |
| `18.1b App Runtime Projection` | Make app-scoped runtime, source, and desired-state context readable without depending primarily on `last_operation` reconstruction | proposed |
| `18.4a App Action Handoff` | Give Installed-side pages a consistent handoff and app-scoped execution query surface | in-progress |
| `18.3a Config Apply and Rollback Lifecycle Convergence` | Move config apply/rollback onto the shared lifecycle operation model | proposed |

## Execution Order

### Step 1: 18.1b App Runtime Projection

Purpose:

- Strengthen `AppInstance` read-side self-sufficiency.
- Stop treating `last_operation` as the primary source for stable management context.

Why first:

- The other three stories depend on clearer app-scoped read semantics.

### Step 2: 18.4a App Action Handoff

Purpose:

- Replace client-side filtering of broad execution inventory with an explicit app-scoped query contract.

Why second:

- Once app-scoped context is stable, the execution-consumption contract can be cleaned up without mixing query ownership back into the page.

### Step 3: 18.3a Config Apply and Rollback Lifecycle Convergence

Purpose:

- Make config mutation obey the same shared execution and audit model as other lifecycle actions.

Why third:

- It depends on clearer app context and should reuse the execution/query contract shape instead of inventing a parallel management-only flow.

## Dependency Graph

```text
18.1b App Runtime Projection
        |
        v
18.4a App Action Handoff
        |
        v
18.3a Config Apply and Rollback Lifecycle Convergence
```

Additional dependency notes:

1. `18.3a` should not redefine Epic 17 execution contracts; it should package config mutation inside the existing shared lifecycle action model.
2. `18.1c` can ship independently if needed, but it gains the most value after `18.1b` clarifies the management projection boundary.

## Practical Delivery Model

| Stage | Story | Delivery Type | Recommended Output |
| --- | --- | --- | --- |
| Stage A | `18.1b` | backend read-model hardening | stable app-scoped runtime/source/desired-state projection |
| Stage B | `18.4a` | backend query + frontend consumption cleanup | explicit app-scoped action history contract plus consistent handoff |
| Stage C | `18.3a` | backend + API convergence | config apply/rollback as shared lifecycle operations |

## Definition of Done for This Slice

This iteration should be considered complete when all of the following are true:

1. `AppInstance` detail no longer depends primarily on `last_operation` to reconstruct stable app-scoped management context.
2. Installed-side pages do not fetch broad `/api/actions` inventory just to filter actions for one app.
3. Config apply and rollback create or resume shared lifecycle operations instead of mutating only in local app-management routes.
4. `desired_state` is visible in the backend management contract and frontend type surface where operators need it.
5. Epic 18 continues to consume execution truth from Epic 17 without rebuilding execution semantics locally.

## Explicitly Out of Scope

1. Full release and recovery redesign
2. Publication and gateway boundary completion
3. Full App Detail IA redesign
4. Multi-server or cluster-aware lifecycle behavior
5. Replacing Epic 17 execution history, timeline, logs, or audit surfaces

## Risks and Watchpoints

1. If `18.1b` stores too much runtime-specific detail inside `AppInstance`, it will over-correct and collapse runtime concerns back into the aggregate.
2. If `18.4b` turns into a second generic actions API instead of an app-scoped view, it will add duplication rather than remove it.
3. If `18.3a` keeps direct config mutation as the real primary path and only wraps it cosmetically, the boundary leak will remain.
4. If `18.1c` exposes `desired_state` without clarifying when and how it changes, operators may read it as a duplicate of `lifecycle_state` instead of intent.

## References

- [Source: specs/implementation-artifacts/epic17-18-app-instance-subdomain-assessment.md]
- [Source: specs/implementation-artifacts/epic18-app-management.md]
- [Source: specs/implementation-artifacts/story18.1a-app-detail-boundary.md]
- [Source: specs/implementation-artifacts/story18.2a-lifecycle-action-convergence.md]
- [Source: specs/implementation-artifacts/story18.4a-app-action-handoff.md]
- [Source: specs/adr/app-lifecycle-domain-model.md]