# Story 17.4b: Git Compose Adapter

Status: in-progress

## Story

As a platform operator,
I want to create deployment pipelines from git-hosted compose sources,
so that repository-backed applications can enter the same deploy lifecycle without requiring a separate execution engine.

## Acceptance Criteria

1. Deploy Center must support a git-based deployment entry flow that accepts repository URL, ref, and compose path.
2. Backend must resolve or accept a raw compose URL, fetch compose content, validate it, and create a deployment record through the shared pipeline.
3. Public repository flows must work without extra credentials.
4. Private repository flows must support optional request-scoped auth header input for compose retrieval.
5. Sensitive auth header values used for compose retrieval must not be persisted in deployment spec, execution log, or audit detail.
6. Git-based deploys must still produce standard deployment history, detail, lifecycle, and log surfaces.

## Tasks / Subtasks

- [ ] Implement git-based entry flow (AC: 1)
  - [ ] Add Deploy Center git dialog and request shape
- [ ] Implement backend compose retrieval (AC: 2,3)
  - [ ] Resolve raw URL from repository metadata when needed
  - [ ] Download and validate compose content
- [ ] Support private retrieval safely (AC: 4,5)
  - [ ] Accept optional request-scoped auth header name and value
  - [ ] Keep secrets out of persisted deploy records and audit payloads
- [ ] Keep downstream visibility shared (AC: 6)
  - [ ] Use the same deployment detail and history surfaces as other adapters

## Dev Notes

- This story is an adapter story, not a git clone or source-build story.
- Scope is compose retrieval and normalization only.
- SSH clone, long-lived secret references, and full source build flows remain future work unless explicitly promoted into MVP later.

### References

- [Source: specs/implementation-artifacts/epic17-app-execution.md#Lifecycle Input Adapters (Minimal)]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Story 17.4 Input Adapters (MVP Scope)]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List


### File List
