# Story 17.4e-C: Runtime Input Resolution

Status: in-progress

## Story

As a lifecycle platform team,
I want runtime-affecting install inputs to be resolved by backend normalization before queueing,
so that env overlays, defaults, addons, and file-like runtime inputs do not remain trapped in entry-specific UI logic.

## Acceptance Criteria

1. Runtime-affecting install inputs must be normalized before lifecycle operation creation rather than interpreted by workers from raw UI payloads.
2. Env overlays, shared env-set imports, and equivalent runtime configuration helpers must resolve into one backend-owned runtime payload or metadata shape.
3. Optional addons or overlay-like install options must be represented as normalized metadata or rendered runtime inputs rather than entry-specific form-only state.
4. Mount-file, source-package, or similar runtime file inputs must have a defined classification at the install-ingress boundary even if execution support remains partial.
5. Install preflight and install creation must consume the same resolved runtime-input semantics.
6. Frontend helpers may assist collection, but backend resolution remains authoritative.

## Delivered Now

- [x] Basic env normalization already exists.
- [x] Secret-ref validation already participates in env normalization.
- [x] Preflight and create flows already share compose-based normalization for current Manual Compose and Git Compose slices.
- [x] Backend ingress now accepts an explicit `runtime_inputs` shape for richer install-time env and file inputs.
- [x] Shared env imports now resolve during backend normalization and override inline env consistently in both preflight and create paths.
- [x] File-like inputs (`mount-file`, `source-package`) now have durable classification at the install-ingress boundary.
- [x] Invalid file-like runtime inputs now fail with aligned `400` behavior in both check and create flows.
- [x] Frontend create flows now submit structured non-empty runtime inputs, including uploaded source-package state.

## Still Deferred

- [ ] Backend-owned resolution of richer env overlays beyond current shared-import and sensitive helpers.
- [ ] Addon or overlay classification that survives beyond one page controller.
- [ ] Worker/runtime execution support that actively consumes normalized file-like runtime inputs.

## Dev Notes

- This story is the runtime-input enrichment slice for `17.4e`.
- It should deepen the resolver, not expand worker responsibilities.
- If a runtime-affecting input is only understandable by reading UI controller state, this story is not done.
- The outcome should make later install sources easier to add without copying runtime-assembly logic.

### Suggested Implementation Focus

1. Expand the normalized install spec or ingress request to represent richer runtime inputs explicitly.
2. Keep create and check behavior aligned.
3. Decide which inputs render compose directly and which remain normalized metadata until later phases.
4. Add regression tests that cover equivalent runtime input semantics across entry modes.

### References

- [Source: specs/implementation-artifacts/story17.4e-install-input-resolution.md]
- [Source: specs/implementation-artifacts/story17.6-create-deployment-page.md]
- [Source: specs/adr/app-lifecycle-install-resolution.md]
- [Source: backend/domain/lifecycle/service/install_resolution.go]
- [Source: dashboard/src/pages/deploy/actions/useActionsController.ts]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Story created to isolate richer runtime-input convergence from the broader install-resolution backlog.
- The slice deliberately focuses on backend-owned normalization rather than frontend control complexity.
- Runtime input normalization now spans frontend submission, route ingress, backend resolution, and parity coverage between preflight and create.
- File-like runtime inputs are intentionally normalized and validated at ingress, while worker-side execution support remains deferred.


### File List

- `backend/domain/lifecycle/service/install_resolution.go`
- `backend/domain/lifecycle/service/install_resolution_test.go`
- `backend/domain/lifecycle/service/compose_operations.go`
- `backend/domain/routes/deploy.go`
- `backend/domain/routes/deploy_test.go`
- `dashboard/src/pages/deploy/actions/useActionsController.ts`
- `dashboard/src/pages/deploy/OrchestrationSection.tsx`
- `dashboard/src/pages/deploy/CreateDeploymentPage.tsx`
- `dashboard/src/pages/deploy/CreateDeploymentPage.test.tsx`
