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
7. Install preflight, preview, and operation creation must reuse the same normalization boundary.
8. Store-prefill, Installed-prefill, Manual Compose, and Git Compose must behave as candidate-input variants into one resolver contract, not as separate execution paths.

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
- [ ] Expose a backend-authored normalized install preview separate from resource preflight.

## Remaining Convergence Scope

### Boundary and candidate model

- One canonical lifecycle install-ingress boundary must be reused by preflight and create flows.
- Route handlers remain transport adapters; they must not own lifecycle normalization rules.
- Current install entry paths should be treated as candidate-input variants into one shared resolver contract.
- `candidate_kind`, `source`, `adapter`, `origin_context`, and equivalent install-ingress metadata must survive normalization without creating source-specific execution semantics.

### Runtime, secret, and exposure normalization

- Runtime-affecting inputs such as env overlays, shared env imports, file-like inputs, and optional add-ons must resolve at ingress, not in UI-only state or worker payloads.
- Secret-like inputs must be classified at ingress and must not become durable raw worker-facing payloads where secret refs are required or available.
- Exposure and publication-related inputs must survive as explicit normalized lifecycle intent instead of disappearing into generic metadata.

### Preview and create-page consumption

- The create page should consume a backend-authored normalized install preview before action creation.
- Preview must stay distinct from resource preflight so operators can see both normalized intent and blocking checks.
- Story `17.6` owns the page UX; this story owns the normalization and preview contract the page consumes.

## Dev Notes

- This story defines the normalization boundary between install dialogs and the shared execution core.
- It does not own pipeline execution, worker scheduling, or publication execution itself.
- Store, Git, manual, and future guided install flows should all converge here before operation creation.
- This story now absorbs the former `17.4e-A` through `17.4e-E` convergence slices as one canonical story.

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