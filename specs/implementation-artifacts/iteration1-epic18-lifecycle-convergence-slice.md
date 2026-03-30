# Iteration 1: Epic 18 Lifecycle Convergence Slice

Status: proposed

## Objective

Execute the first lifecycle-management domain-convergence slice without creating a parallel epic.

This iteration uses Epic 18 as the management-surface host and focuses on three linked stories:

1. `18.1a App Detail Boundary Classification`
2. `18.2a Local Action Convergence`
3. `18.4a App Detail Action Handoff`

The slice is intentionally small.

- It does not redesign all Installed flows.
- It does not replace Epic 17.
- It does not attempt full publication, recovery, or config convergence in one pass.

## Why This Slice First

This is the highest-value starting point for lifecycle management convergence because it resolves three current sources of modeling drift at once:

1. `App Detail` currently mixes app-owned state, lifecycle projections, runtime state, and observability content.
2. Installed-side `start`, `stop`, `restart`, and `uninstall` still bypass the shared Epic 17 execution model.
3. Management-to-execution handoff exists partially in the UI, but is not yet standardized as one clear interaction contract.

## Included Stories

| Story | Purpose | Current Status |
| --- | --- | --- |
| `18.1a App Detail Boundary Classification` | Define what in `App Detail` belongs to `AppInstance`, what is lifecycle projection, and what is external runtime or observability data | review |
| `18.2a Local Action Convergence` | Converge Installed-side local actions onto the shared Epic 17 operation model | proposed |
| `18.4a App Detail Action Handoff` | Standardize how `App Detail` links to shared execution truth and avoids owning execution semantics | proposed |

## Execution Order

### Step 1: 18.1a App Detail Boundary Classification

Purpose:

- Freeze field and panel ownership before changing behavior.
- Prevent future work from expanding `App Detail` as a giant mixed aggregate.

Expected output:

- stable classification of current App Detail data
- explicit boundary notes for `AppInstance`, lifecycle projections, runtime/observability data
- a list of what future stories may add locally vs via linked execution surfaces

Why first:

- Neither local-action convergence nor handoff standardization is safe until the management page boundary is clear.

### Step 2: 18.2a Local Action Convergence

Purpose:

- Remove the remaining dual-path action model in Installed-side management.
- Make `start`, `stop`, `restart`, and `uninstall` follow the same shared-operation direction already used by `redeploy` and `upgrade`.

Expected output:

- local bypasses documented and retired or explicitly isolated
- Installed-side action entry points aligned to shared `Operation`
- Installed summary updates driven by projection rules instead of local mutation shortcuts

Why second:

- Once page ownership is clear, action ownership is the next highest-value inconsistency to remove.
- Handoff standardization is easier after actions actually create shared operations.

### Step 3: 18.4a App Detail Action Handoff

Purpose:

- Standardize the operator journey from `App Detail` to shared execution truth.
- Keep `App Detail` app-centric while ensuring execution detail remains in Epic 17 surfaces.

Expected output:

- one formal handoff rule for action status, links, and execution-detail navigation
- consistent treatment of `last_operation`, created operation ids, and current execution summaries
- clearer separation between management summary and execution detail ownership

Why third:

- Handoff can be designed conceptually earlier, but it becomes implementable and stable only after local actions stop bypassing shared execution.

## Dependency Graph

```text
18.1a App Detail Boundary Classification
        |
        v
18.2a Local Action Convergence
        |
        v
18.4a App Detail Action Handoff
```

Additional dependency notes:

1. `18.4a` also depends conceptually on `18.1a`, because handoff rules rely on the distinction between app-owned state and linked execution projections.
2. `18.2a` depends on Epic 17 shared execution truth already existing for operation creation, timeline, logs, and audit.
3. None of these stories should re-open Epic 17 execution-contract ownership.

## Practical Delivery Model

| Stage | Story | Delivery Type | Recommended Output |
| --- | --- | --- | --- |
| Stage A | `18.1a` | domain alignment / review | documented classification and boundary judgment |
| Stage B | `18.2a` | backend + API convergence | action-path unification to shared operations |
| Stage C | `18.4a` | UI + flow standardization | consistent status links, action-result handoff, and operator guidance |

## Definition of Done for Iteration 1

Iteration 1 should be considered complete when all of the following are true:

1. `App Detail` no longer acts as an unbounded owner of all displayed data.
2. Installed-side lifecycle actions use one primary shared-operation model.
3. `App Detail` consistently hands execution truth off to Epic 17 surfaces.
4. `AppInstance` remains the management-facing object and `Operation` remains the execution-facing object.
5. New Epic 18 work can build on this slice without re-deciding page ownership, local action ownership, or handoff semantics.

## Explicitly Out of Scope for Iteration 1

1. Full configuration-operation convergence
2. Publication and gateway boundary completion
3. Recovery and backup flow redesign
4. Full query-model redesign for Installed surfaces
5. Multi-server topology or cluster-aware lifecycle behavior

## Risks and Watchpoints

1. If `18.2a` starts changing execution semantics instead of only converging entry paths, it will drift into Epic 17 scope.
2. If `18.4a` tries to duplicate timeline, logs, or audit inside `App Detail`, it will recreate the same ownership confusion this slice is supposed to remove.
3. If future fields are added to `App Detail` without using the `18.1a` classification, the slice will degrade quickly.

## References

- [Source: specs/implementation-artifacts/epic18-app-management.md]
- [Source: specs/implementation-artifacts/story18.1a-app-detail-boundary-classification.md]
- [Source: specs/implementation-artifacts/story18.2a-local-action-convergence.md]
- [Source: specs/implementation-artifacts/story18.4a-app-detail-action-handoff.md]
- [Source: specs/adr/appos-ddd-architecture.md]
