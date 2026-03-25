# Story 17.5: Action History and Execution Timeline Surface

Status: review

## Story

As an operator,
I want to inspect lifecycle action history, current execution status, timeline detail, logs, and audit linkage,
so that lifecycle execution is observable without pushing status logic into unrelated modules.

## Acceptance Criteria

1. Provide action history and execution detail APIs for lifecycle history and status surfaces using `app_operations` as the canonical execution record.
2. Execution detail must expose normalized metadata, `phase`, `terminal_status`, `failure_reason`, `app_outcome`, release references, and timeline detail suitable for UI rendering.
3. Timeline detail must expose `pipeline_runs` and ordered `pipeline_node_runs` data without requiring the UI to reconstruct execution state from raw logs.
4. Execution logs must be available through persisted log reads and active stream updates while an operation is running.
5. Operation creation and execution must emit audit events with actor, action, target, and result semantics.
6. Lifecycle management surfaces must render history, detail, and timeline from these shared APIs rather than owning independent execution state.
7. This story must stay execution-observability focused and not absorb Store entry UX, Git adapter UX, or Installed-app command semantics.

## Delivered Now

- [x] Action history and execution detail APIs are exposed from `app_operations`.
- [x] Execution detail returns canonical execution fields, selector metadata, and pipeline summary.
- [x] `pipeline_runs` and ordered `pipeline_node_runs` are returned for timeline rendering.
- [x] Persisted logs and active stream updates are available for running and completed operations.
- [x] Operation create, run, cancel, delete, and app-triggered execution paths emit audit records.
- [x] The Actions UI already consumes these shared APIs instead of rebuilding execution state client-side.

## Still Deferred

- [ ] Server-side filtering, pagination, and richer audit cross-linking beyond the current MVP surfaces.
- [ ] Broader Epic 18 consumption once Installed-side actions fully converge on Epic 17.

## Dev Notes

- This story is required earlier than a normal reporting story because the first install closed loop is not complete unless it is observable.
- Keep `AppInstance` lifecycle projection and raw operation execution detail distinct; they serve different operator needs.
- `app_operations`, `pipeline_runs`, and `pipeline_node_runs` are the primary persistence sources for this story.
- Installed-app management may consume these APIs later, but that integration belongs to Epic 18.

### References

- [Source: specs/implementation-artifacts/epic17-app-execution.md#Recommended Development Order]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Story 17.5 Action History and Execution Timeline Surface]
- [Source: specs/implementation-artifacts/epic18-app-management.md#Integration Notes]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.2 `app_operations`]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.5 `pipeline_runs`]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.6 `pipeline_node_runs`]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Shared action-history/execution-detail/log/timeline APIs are already implemented and consumed by the dashboard Actions views.
- The first install closed loop is now observable enough to support review and future Epic 18 integration.
- This story should stay focused on shared execution observability and avoid reclaiming adapter UX scope.


### File List
