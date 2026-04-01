# Story 17.4e-A: Resolver Boundary Consolidation

Status: in-progress

## Story

As a lifecycle platform team,
I want install create and install check flows to share one explicit resolver boundary,
so that normalization semantics are owned by the lifecycle service layer instead of drifting across route handlers.

## Acceptance Criteria

1. Install preflight and install action creation must reuse one canonical install-ingress normalization path before side effects diverge.
2. Manual Compose and Git Compose request shaping that represents lifecycle meaning must live in shared lifecycle service code rather than duplicated route-local logic.
3. Route handlers may still parse HTTP bodies, but they must not independently decide normalization rules for project naming, runtime input semantics, or normalized install metadata.
4. `CheckInstallFromCompose` and `CreateOperationFromCompose` must differ only in outcome behavior such as validation-only vs operation creation, not in normalization semantics.
5. Existing install resolution behavior for Manual Compose and Git Compose must remain backward compatible while the boundary is consolidated.
6. This story must not redesign Epic 17 worker execution, queue semantics, or pipeline contracts.

## Delivered Now

- [x] A real shared resolver foundation already exists in `ResolveInstallFromCompose`.
- [x] Install preflight already resolves normalized spec before resource checks.
- [x] Operation creation already resolves normalized spec before lifecycle operation persistence.
- [x] The convergence problem is now clearly identified as ingress-boundary cleanup rather than missing execution-core capability.
- [x] A shared service-level install ingress request builder now exists and is reused by preflight request assembly and operation creation entry paths.
- [x] Manual Compose and Git Compose handlers now reuse one shared raw ingress-options builder for env, exposure, and metadata shaping.
- [x] Route parity tests now verify that Manual Compose `check/create` and Git Compose `check/create` produce matching normalized install spec fields.
- [x] Preflight-plus-create orchestration for compose-backed install creation now lives in lifecycle service code instead of being primarily coordinated inside the deploy route helper.

## Still Deferred

- [ ] Full removal of route-local source-specific normalization drift.
- [ ] A single canonical candidate-input contract above the current compose-centric resolver.
- [ ] Resolution-preview API and richer create-page consumption.

## Dev Notes

- This is the boundary-cleanup slice for Story `17.4e`, not a new execution feature.
- Treat route handlers as transport adapters, not owners of lifecycle normalization semantics.
- The practical target is one normalization boundary reused by both preflight and create flows.
- If a normalization rule must be updated in two route handlers, this story is not done.

## Implementation Breakdown

### 1. Shared ingress contract

- Introduce one explicit install-ingress request model above the current compose resolver inputs.
- The contract should carry all lifecycle-meaningful fields needed by both preflight and create flows.
- Keep HTTP-only concerns such as body parsing and response mapping out of this contract.

### 2. Route-to-service shaping cleanup

- Reduce route-local shaping in `backend/domain/routes/deploy.go` for Manual Compose and Git Compose install handlers.
- Move lifecycle-meaningful normalization decisions into shared lifecycle service code.
- Keep route handlers limited to transport adaptation, auth context, and error-to-HTTP translation.

### 3. Preflight and create-path alignment

- Make `CheckInstallFromCompose` and `CreateOperationFromCompose` consume the same ingress-normalization path.
- Ensure equivalent input payloads produce the same normalized project name, server id, source, adapter, metadata, env, and exposure-intent shape.
- If one path applies shaping that the other path does not, treat that as a bug against this story.

### 4. Source adapter reuse

- Reuse shared install-ingress shaping for both Manual Compose and Git Compose.
- Keep Git fetch and raw compose retrieval separate, but move post-fetch lifecycle normalization to the shared service boundary.
- Do not create one resolver branch per route if the difference is only transport or fetch acquisition.

### 5. Regression protection

- Add tests that compare equivalent create and check flows for normalized output consistency.
- Add tests that protect existing Manual Compose and Git Compose behavior while the boundary is being consolidated.
- Prefer service-level tests for normalization parity plus route tests for HTTP wiring.

### Suggested Implementation Focus

1. Introduce or formalize one shared ingress request model for install resolution.
2. Move shared shaping logic out of `backend/domain/routes/deploy.go` where practical.
3. Keep route-level responsibilities limited to body parsing, auth context, and HTTP response mapping.
4. Add tests that prove create and check paths produce the same normalized values for equivalent inputs.

## Minimal Acceptance Test Checklist

- [x] Manual Compose `check` and `create` flows produce the same normalized project name for the same input.
- [x] Manual Compose `check` and `create` flows produce the same normalized env and exposure-intent shape for the same input.
- [x] Git Compose `check` and `create` flows produce the same normalized metadata after compose retrieval.
- [ ] Route handlers no longer duplicate lifecycle-meaningful normalization rules already available in the service layer.
- [x] Existing HTTP behavior remains compatible for successful Manual Compose and Git Compose requests.
- [ ] Existing invalid compose, invalid env, and invalid exposure inputs still fail with consistent bad-request behavior.

## Function-Level Refactor Plan

1. Add one shared service request builder in `backend/domain/lifecycle/service/install_resolution.go`.
	- Input: source, adapter, compose, project/server fields, env, exposure, metadata, auth user id.
	- Output: one canonical install-ingress request.

2. Replace route-side preflight request assembly.
	- Move usage away from `buildInstallPreflightRequest` in `backend/domain/routes/deploy_install_preflight.go`.

3. Reduce route-side lifecycle shaping in `backend/domain/routes/deploy.go`.
	- Stop route handlers from owning exposure and metadata normalization.
	- Keep only body parsing, git fetch, and HTTP error mapping.

4. Make both paths call the same ingress builder.
	- `handleOperationInstallManualCompose`
	- `handleOperationInstallManualComposeCheck`
	- `handleOperationInstallGitCompose`
	- `handleOperationInstallGitComposeCheck`

5. Add parity tests in `backend/domain/routes/deploy_test.go`.
	- Manual create vs check
	- Git create vs check

### References

- [Source: specs/implementation-artifacts/story17.4e-install-input-resolution.md]
- [Source: specs/implementation-artifacts/iteration2-epic17-install-resolution-convergence-slice.md]
- [Source: specs/adr/app-lifecycle-install-resolution.md]
- [Source: backend/domain/lifecycle/service/install_resolution.go]
- [Source: backend/domain/lifecycle/service/install_preflight.go]
- [Source: backend/domain/routes/deploy.go]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Story created to formalize the first remaining convergence slice under `17.4e`.
- The slice assumes install execution already works and focuses only on ingress-boundary consolidation.
- Shared install-ingress request building now lives in lifecycle service code and is reused by both preflight and create entry paths.
- Manual Compose and Git Compose parity tests now assert matching normalized spec semantics across `check` and `create`.
- Compose-backed install creation now uses a service-owned `preflight + create` orchestration path while the route keeps audit and enqueue responsibilities.


### File List

- `backend/domain/lifecycle/service/install_resolution.go`
- `backend/domain/lifecycle/service/compose_operations.go`
- `backend/domain/routes/deploy.go`
- `backend/domain/routes/deploy_install_preflight.go`
- `backend/domain/routes/deploy_test.go`
