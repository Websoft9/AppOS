# Story 17.5: Deployment History and Audit Surface

Status: in-progress

## Story

As an operator,
I want to inspect deployment history, current status, logs, and audit linkage,
so that deploy execution is observable without pushing status logic into unrelated modules.

## Acceptance Criteria

1. Provide deployment list and detail APIs for pipeline history and status surfaces.
2. Deployment detail must expose normalized metadata, canonical lifecycle state, and execution-stage detail suitable for UI rendering.
3. Execution logs must be available through persisted log reads and active stream updates while a deployment is running.
4. Deployment creation and execution must emit audit events with actor, action, target, and result semantics.
5. Deploy UI must render pipeline history and detail from these shared APIs rather than owning independent deployment state.
6. This story must stay execution-observability focused and not absorb Store, Git, or Installed-app command surfaces.

## Tasks / Subtasks

- [ ] Expose deployment history APIs (AC: 1,2)
  - [ ] Provide list and detail endpoints
  - [ ] Expose canonical lifecycle projection and execution-stage details
- [ ] Expose execution log surfaces (AC: 3)
  - [ ] Provide persisted log read endpoint
  - [ ] Provide active stream endpoint for running jobs
- [ ] Keep audit linkage complete (AC: 4)
  - [ ] Emit deploy creation and execution audit records
- [ ] Bind Deploy UI to shared surfaces (AC: 5,6)
  - [ ] Render history and detail from deploy APIs only

## Dev Notes

- This story is required earlier than a normal reporting story because the first deploy closed loop is not complete unless it is observable.
- Keep lifecycle projection and raw execution detail distinct; they serve different operator needs.
- Installed-app management may consume these APIs later, but that integration belongs to Epic 18.

### References

- [Source: specs/implementation-artifacts/epic17-deploy.md#Recommended Development Order]
- [Source: specs/implementation-artifacts/epic17-deploy.md#Story 17.5 Deployment History and Audit Surface]
- [Source: specs/implementation-artifacts/epic18-operations.md#Integration Notes]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List


### File List
