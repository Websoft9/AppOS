# Story 18.4a: App Detail Action Handoff

Status: review

## Story

As an operator,
I want `App Detail` to hand lifecycle actions and execution-status inspection off to the shared Epic 17 execution surfaces,
so that installed-app management remains app-centric without rebuilding execution semantics inside the detail page.

## Acceptance Criteria

1. `App Detail` exposes one clear handoff model from management intent to shared execution truth.
2. The page uses shared operation references such as `last_operation` and created operation ids to navigate to the canonical action detail surface.
3. Lifecycle actions initiated from `App Detail` do not require the page to interpret pipeline internals beyond lightweight status summaries.
4. `App Detail` may show current execution summary or last action summary, but execution detail, timeline, logs, and audit remain owned by Epic 17 surfaces.
5. The handoff pattern is consistent for both existing shared-operation actions (`redeploy`, `upgrade`) and future converged actions (`start`, `stop`, `restart`, `uninstall`).
6. The story does not move execution detail UI into `App Detail`; it standardizes linking, summary, and operator guidance.

## Delivered Now

- [x] Current App Detail handoff behavior is documented.
- [x] A target handoff pattern is defined for management-side lifecycle actions.
- [x] Follow-on Epic 18 implementation can converge action buttons and status links without re-deciding ownership boundaries.

## Still Deferred

- [ ] Full UI polish for pending/running/completed execution states in Installed views.
- [x] Unified handoff behavior for all lifecycle actions in the current Installed-side slice.
- [ ] Rich cross-linking to timeline, logs, and audit from secondary surfaces.

## Implemented in This Slice

1. `App Detail` now routes `start`, `stop`, `restart`, `uninstall`, `redeploy`, and `upgrade` to shared action detail through operation ids.
2. `Installed Apps` now uses the same handoff model from the list/grid action menu.
3. `App Detail` now explicitly labels inline execution state as summary-only and points operators to Actions for execution truth.
4. Installed-side pages now use explicit handoff copy so management summary and execution detail ownership are separated in the UI.

## Current Baseline (2026-03-30)

`App Detail` already shows early signs of the target handoff model:

1. `Execution Status` button navigates to the shared action detail route when `last_operation` exists.
2. `last_operation` in lifecycle metadata is rendered as a clickable reference to the shared action detail route.
3. `redeploy` and `upgrade` create an operation and immediately navigate to the shared action detail page.
4. `current_pipeline` is shown only as lightweight summary in the overview tab rather than rendering a local pipeline timeline.

The remaining gaps are now narrower:

1. `start`, `stop`, `restart`, and `uninstall` have been converged to shared operation-driven handoff.
2. `App Detail` still mixes app summary, execution summary, runtime information, config editing, and logs in one page, so ownership boundaries still require continued discipline.
3. Pending/running/completed state polish across Installed views is still lighter than the full target interaction model.

## Current UI Evidence

| Current UI Element / Flow | Current Behavior | Handoff Classification | Target Direction |
| --- | --- | --- | --- |
| `Execution Status` button | opens shared `/actions/$actionId` detail using `last_operation` | canonical handoff | keep and standardize |
| `last_operation` link in metadata | clickable shared action-detail reference | canonical handoff | keep and standardize |
| `redeploy` action | creates shared operation then navigates to action detail | canonical handoff | keep |
| `upgrade` action | creates shared operation then navigates to action detail | canonical handoff | keep |
| `current_pipeline` summary card | shows family and current phase inline | lightweight execution summary | keep as summary only |
| `start` / `stop` / `restart` buttons | create shared operations then navigate to action detail | canonical handoff | keep and refine copy/state polish |
| `uninstall` dialog | creates shared uninstall operation then navigates to action detail | canonical handoff | keep and refine copy/state polish |
| `logs` tab | shows runtime logs inside App Detail | supporting operational view | may stay as convenience view, but not execution ownership |

## Dev Notes

- This is an Epic 18 management-surface integration story, not an Epic 17 execution-detail story.
- The purpose is to standardize operator movement between `AppInstance`-centric management and `Operation`-centric execution truth.
- `App Detail` should summarize execution enough to support decision-making, but deeper execution interpretation belongs to shared action detail, timeline, log, and audit surfaces.
- This story depends conceptually on `18.1a` because handoff only makes sense after app-owned fields and projection fields are distinguished.
- This story should also align with `18.2a`, because once local actions converge, their primary success path should also use the shared handoff pattern.

### Target Handoff Rule

#### App Detail owns

- app-facing lifecycle summary
- action entry points
- operation reference display
- lightweight current execution summary
- guidance for where to inspect deeper results

#### Shared execution surfaces own

- execution detail
- timeline / node progression
- execution logs as lifecycle record
- audit linkage for one operation
- terminal execution outcome interpretation

### References

- [Source: specs/implementation-artifacts/epic18-app-management.md#Requirements]
- [Source: specs/implementation-artifacts/epic18-app-management.md#Acceptance Criteria]
- [Source: specs/implementation-artifacts/story18.1a-app-detail-boundary-classification.md]
- [Source: specs/implementation-artifacts/story18.2a-local-action-convergence.md]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Story 17.5 Action History and Execution Timeline Surface]
- [Source: specs/adr/appos-ddd-architecture.md#L129]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Story updated after implementation. `App Detail` and `Installed Apps` now use one shared handoff model for the Installed-side lifecycle slice.
- Remaining work is mainly UX polish around richer inline status summaries and deeper cross-links, not ownership re-definition.

### File List
