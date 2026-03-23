# Story 17.5: Operation History and Timeline Surface

Status: in-progress

## Story

As an operator,
I want to inspect lifecycle operation history, current status, timeline detail, logs, and audit linkage,
so that lifecycle execution is observable without pushing status logic into unrelated modules.

## Acceptance Criteria

1. Provide operation list and detail APIs for lifecycle history and status surfaces using `app_operations` as the canonical execution record.
2. Operation detail must expose normalized metadata, `phase`, `terminal_status`, `failure_reason`, `app_outcome`, release references, and timeline detail suitable for UI rendering.
3. Timeline detail must expose `pipeline_runs` and ordered `pipeline_node_runs` data without requiring the UI to reconstruct execution state from raw logs.
4. Execution logs must be available through persisted log reads and active stream updates while an operation is running.
5. Operation creation and execution must emit audit events with actor, action, target, and result semantics.
6. Lifecycle management surfaces must render history, detail, and timeline from these shared APIs rather than owning independent execution state.
7. This story must stay execution-observability focused and not absorb Store entry UX, Git adapter UX, or Installed-app command semantics.

## Tasks / Subtasks

- [ ] Expose operation history APIs (AC: 1,2)
  - [ ] Provide list and detail endpoints for `app_operations`
  - [ ] Expose canonical execution fields and release references
- [ ] Expose timeline APIs (AC: 2,3)
  - [ ] Return `pipeline_runs` summary for an operation
  - [ ] Return ordered `pipeline_node_runs` for operation detail and timeline rendering
- [ ] Expose execution log surfaces (AC: 4)
  - [ ] Provide persisted log read endpoint
  - [ ] Provide active stream endpoint for running operations
- [ ] Keep audit linkage complete (AC: 5)
  - [ ] Emit operation creation and execution audit records
- [ ] Bind lifecycle management surfaces to shared observability APIs (AC: 6,7)
  - [ ] Render history, detail, and timeline from operation APIs only

## Dev Notes

- This story is required earlier than a normal reporting story because the first install closed loop is not complete unless it is observable.
- Keep `AppInstance` lifecycle projection and raw operation execution detail distinct; they serve different operator needs.
- `app_operations`, `pipeline_runs`, and `pipeline_node_runs` are the primary persistence sources for this story.
- Installed-app management may consume these APIs later, but that integration belongs to Epic 18.

### References

- [Source: specs/implementation-artifacts/epic17-app-execution.md#Recommended Development Order]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Story 17.5 Operation History and Timeline Surface]
- [Source: specs/implementation-artifacts/epic18-app-management.md#Integration Notes]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.2 `app_operations`]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.5 `pipeline_runs`]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#3.6 `pipeline_node_runs`]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List


### File List
