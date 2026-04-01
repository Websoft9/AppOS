# Story 17.4e: Install Input Resolution

Status: in-progress

## Story

As a platform operator,
I want install dialogs and adapter-specific inputs to be resolved into one normalized lifecycle install payload,
so that different install entry points can reuse the same execution core without leaking raw UI payloads into workers.

## Acceptance Criteria

1. Backend must own install input resolution before lifecycle operation creation.
2. Different install entry points may collect different candidate inputs, but they must normalize into one shared install payload.
3. Resolution must validate inputs, apply defaults, and produce rendered runtime inputs such as compose and env data.
4. Sensitive inputs such as passwords, tokens, or external database credentials must be handled by backend logic and not passed into worker payloads as raw form data.
5. Inputs that imply publication or external exposure semantics must be preserved as lifecycle publication intent or equivalent normalized metadata rather than hidden as install-only form state.
6. Workers and pipeline runners must consume only normalized lifecycle operation data.

## Delivered Now

- [x] Backend already owns operation creation for Manual Compose and Git Compose installs.
- [x] Workers consume normalized operation records and do not receive raw install dialog payloads.
- [x] Source and adapter attribution are persisted in the operation contract before queueing.
- [x] Rendered compose and basic runtime metadata are written into the normalized operation record before execution.

## Still Deferred

- [ ] Converge Store, manual, Git, and future guided install inputs through one explicit resolver/normalizer layer.
- [ ] Resolve env overlays, optional addons, and richer defaults inside backend normalization rather than entry-specific UI handling.
- [ ] Preserve publication intent and exposure-related inputs as normalized lifecycle metadata.
- [ ] Classify and convert broader sensitive install inputs into secret-backed references where required.

## Follow-On Decomposition

The remaining work in this story is now split into five narrower planning artifacts:

1. `17.4e-A Resolver Boundary Consolidation`
2. `17.4e-B Source Candidate Convergence`
3. `17.4e-C Runtime Input Resolution`
4. `17.4e-D Secret and Exposure Intent Normalization`
5. `17.4e-E Resolution Preview API and Create-Page Consumption`

These slices are recorded in:

- `specs/implementation-artifacts/story17.4e-a-resolver-boundary-consolidation.md`
- `specs/implementation-artifacts/story17.4e-b-source-candidate-convergence.md`
- `specs/implementation-artifacts/story17.4e-c-runtime-input-resolution.md`
- `specs/implementation-artifacts/story17.4e-d-secret-and-exposure-intent-normalization.md`
- `specs/implementation-artifacts/story17.4e-e-resolution-preview-api.md`
- `specs/implementation-artifacts/iteration2-epic17-install-resolution-convergence-slice.md`

## Dev Notes

- This story defines the normalization boundary between install dialogs and the shared execution core.
- It does not own pipeline execution, worker scheduling, or publication execution itself.
- Store, Git, manual, and future guided install flows should all converge here before operation creation.

### References

- [Source: specs/adr/app-lifecycle-install-resolution.md]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Story 17.4 Input Adapters (MVP Scope)]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- The current backend already enforces the queue boundary for Manual Compose and Git Compose installs.
- The missing work is not basic normalization existence; it is convergence and expansion into richer install input resolution.


### File List