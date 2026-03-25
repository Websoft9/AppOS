# Story 17.4b: Git Compose Adapter

Status: review

## Story

As a platform operator,
I want to create lifecycle install operations from git-hosted compose sources,
so that repository-backed applications enter the same execution core without requiring a separate engine.

## Acceptance Criteria

1. The shared install flow must support a git-based entry that accepts repository URL, ref, and compose path.
2. Backend must resolve or accept a raw compose URL, fetch compose content, validate it, and create a lifecycle operation through the shared pipeline.
3. Public repository flows must work without extra credentials.
4. Private repository flows must support optional request-scoped auth header input for compose retrieval.
5. Sensitive auth header values used for compose retrieval must not be persisted in operation spec, execution log, or audit detail.
6. Git-based installs must still produce standard action history, execution detail, lifecycle, and log surfaces.

## Delivered Now

- [x] The install flow exposes a git-based entry dialog with repository URL, ref, and compose path.
- [x] Backend can derive or accept a raw compose URL, fetch the compose file, validate it, and create the same shared install operation.
- [x] Public repository flows work without extra credentials.
- [x] Private retrieval supports request-scoped header name and value.
- [x] Sensitive header values are excluded from persisted operation data and audit detail.
- [x] Git-based installs reuse the same action history, execution detail, lifecycle, and log surfaces.

## Still Deferred

- [ ] SSH clone and long-lived credential references.
- [ ] Full source-build or repository checkout workflows.

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

- Git Compose creation is implemented end-to-end and already covered by backend route tests.
- Private header-based retrieval is request-scoped and not persisted into operation records.
- This story feeds the shared execution core; it does not create git-specific runtime behavior.


### File List
