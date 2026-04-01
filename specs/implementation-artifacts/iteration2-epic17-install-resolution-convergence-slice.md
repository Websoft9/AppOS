# Iteration 2: Epic 17 Install Resolution Convergence Slice

Status: proposed

## Objective

Finish the real remaining work in `17.4e Install Input Resolution` without re-opening the already-working lifecycle execution core.

This iteration assumes the following are already true:

1. the shared lifecycle execution contract exists
2. Manual Compose and Git Compose already create operations through the shared core
3. preflight already reuses the current install resolver foundation
4. `/deploy/create` already exists as the management-side entry page

So the point of this iteration is not to rebuild install execution.

The point is to finish convergence at the install-ingress boundary.

## Current Baseline

The backend already has a meaningful resolver foundation:

1. `ResolveInstallFromCompose` produces a `NormalizedInstallSpec`
2. preflight calls the resolver before resource checks
3. create-operation flow also calls the resolver before queueing
4. env values are normalized and secret refs are validated
5. exposure intent is normalized into explicit lifecycle metadata

Current gaps are narrower:

1. resolution is still compose-centric rather than candidate-input-centric
2. route-level parsing still owns too much source-specific request shaping
3. env/default/addon/mount semantics are not converged through one explicit resolver layer
4. secret-backed install inputs are validated, but not yet modeled as a broader install-input classification system
5. the create page still lacks a true backend-authored resolution preview API

## Recommended Story Breakdown

Use five slices.

Do not reopen Epic 17 contract ownership.
Do not redesign worker execution.
Do not mix publication execution into these slices.

---

## Story 17.4e-A Resolver Boundary Consolidation

### Why

WHY are install routes still shaping too much request meaning locally?

Because current convergence stops at `ResolveInstallFromCompose`, but route handlers still decide too much about how source-specific inputs become resolver inputs.

That means install resolution exists, but the ingress boundary is not fully owned yet.

### Goal

Create one canonical install-resolution ingress contract used by both:

1. preflight
2. action creation

### Scope

1. introduce an explicit install candidate/request model above `NormalizedInstallSpec`
2. move route-level shaping into shared lifecycle service helpers where practical
3. make Manual Compose and Git Compose use one resolution path with source-specific adapters feeding a shared ingress contract
4. keep `CheckInstallFromCompose` and `CreateOperationFromCompose` aligned on the same normalization boundary

### Acceptance Focus

1. no duplicated source-specific normalization rules across create and check handlers
2. resolver ingress is a lifecycle service concern, not a route-local concern
3. create and check flows differ only in side effects, not in normalization semantics

### Likely Files

1. `backend/domain/lifecycle/service/install_resolution.go`
2. `backend/domain/lifecycle/service/install_preflight.go`
3. `backend/domain/routes/deploy.go`
4. `backend/domain/routes/deploy_install_preflight.go`

---

## Story 17.4e-B Source Candidate Convergence

### Why

WHY is install still at risk of fragmenting even though the execution core is shared?

Because source entry points still behave like separate worlds:

1. manual compose
2. git compose
3. store or installed prefill
4. future source-package or guided paths

Right now they happen to land on a shared create page, but they do not yet clearly converge as one candidate-input family.

### Goal

Define one candidate-input model for install ingress, with source-specific sections treated as input variants, not execution variants.

### Scope

1. formalize source candidate types and required fields
2. treat Store-prefill and Installed-prefill as candidate generators, not special execution modes
3. normalize source attribution and fetch metadata consistently
4. isolate future placeholders such as Docker Command or Source Package so they extend the same ingress model later

### Acceptance Focus

1. all current install entry paths can be explained as candidate-input variants into one resolver contract
2. source-specific metadata is durable and explicit in normalized spec metadata
3. no new install source may bypass the shared ingress model

### Dependency Note

This should build on Story `17.4e-A`, not run before it.

---

## Story 17.4e-C Runtime Input Resolution: Env, Defaults, Addons, Mounts

### Why

WHY is install resolution still incomplete even though compose and env already work?

Because what exists now is base normalization, not full runtime-input convergence.

The unresolved problem is richer runtime preparation:

1. env overlays
2. default application of source/template rules
3. optional addon selection
4. mount or file payload classification

If these stay entry-specific, the shared lifecycle contract will keep receiving partially pre-baked UI decisions.

### Goal

Move richer runtime-input shaping into backend-owned resolution logic before operation creation.

### Scope

1. normalize env overlays and shared env-set imports as backend-owned resolution input
2. define how optional addons become normalized metadata or rendered compose changes
3. classify mount-file or source-package related inputs so they become operation-facing runtime inputs, not UI-only state
4. ensure preflight and creation consume the same resolved runtime payload

### Acceptance Focus

1. runtime-affecting input transformations happen before queueing
2. worker consumes resolved runtime payload, not UI assembly hints
3. create-page helpers remain convenience only; backend remains authority

### Dependency Note

This story is the first major value story after resolver-boundary cleanup.

---

## Story 17.4e-D Secret and Exposure Intent Normalization

### Why

WHY separate this from general input resolution?

Because secret handling and publication-related intent are the two places where teams quietly destroy their domain boundary.

If raw secrets or publication semantics remain hidden inside arbitrary form payloads, you do not have a real lifecycle ingress model.

### Goal

Make sensitive input and exposure intent first-class normalized install data.

### Scope

1. expand secret-backed input classification beyond simple env string ref validation
2. define how secret-like install inputs are converted into durable secret references or rejected
3. make exposure and publication intent durable normalized metadata with clear validation rules
4. preserve future certificate/domain/path intent without pushing publication execution into this story

### Acceptance Focus

1. workers never need raw secret form values
2. publication-relevant install intent is not lost in route-local payload shaping
3. normalized spec clearly distinguishes runtime env, secret refs, and exposure intent

### Dependency Note

This story should follow `17.4e-C`, because richer runtime inputs must be classified before secret and publication semantics can be modeled cleanly.

---

## Story 17.4e-E Resolution Preview API and Create-Page Consumption

### Why

WHY is this a separate story if `/deploy/create` already exists?

Because the page exists, but a true backend-authored resolution preview does not.

Current UI can check preflight and show operator-facing summaries, but it still cannot ask the backend:

1. what exactly was normalized
2. what defaults were applied
3. which runtime inputs were resolved
4. which secret refs or exposure intent were retained

Without that, the user still does not see the real lifecycle ingress contract before submission.

### Goal

Expose a read-only resolution preview endpoint and consume it in `/deploy/create`.

### Scope

1. add a resolution-preview API that returns normalized install intent without creating an operation
2. keep preflight as resource and conflict validation, not as the only preview mechanism
3. show normalized source, adapter, project name, server, env summary, secret-ref summary, and exposure intent summary in the create page
4. make the create page teach the operator the difference between candidate input, normalized intent, and queued action

### Acceptance Focus

1. create page reflects backend-authored normalization, not guessed client-side assembly
2. preview and create use the same normalization rules
3. users can inspect normalized intent before action creation

### Dependency Note

This should be the final story in the slice, because it depends on the resolver boundary being stable.

---

## Recommended Execution Order

1. `17.4e-A Resolver Boundary Consolidation`
2. `17.4e-B Source Candidate Convergence`
3. `17.4e-C Runtime Input Resolution: Env, Defaults, Addons, Mounts`
4. `17.4e-D Secret and Exposure Intent Normalization`
5. `17.4e-E Resolution Preview API and Create-Page Consumption`

## Why This Order

1. first stabilize the boundary
2. then unify source candidates
3. then resolve richer runtime input
4. then harden sensitive/publication semantics
5. finally expose the normalized result clearly to operators

If you reverse that order, the UI preview will freeze the wrong contract.

## Explicitly Not Needed Now

1. redoing `17.1` or `17.2`
2. redesigning the worker pipeline
3. folding publication execution into install resolution
4. introducing recovery semantics here
5. turning install resolution into a new business domain

## Delivery Guidance

If team capacity is limited, the minimum high-value subset is:

1. `17.4e-A`
2. `17.4e-C`
3. `17.4e-E`

That subset is enough to prove one clean ingress model and expose it in the UI.

## References

1. `specs/implementation-artifacts/story17.4e-install-input-resolution.md`
2. `specs/implementation-artifacts/story17.6-create-deployment-page.md`
3. `specs/adr/app-lifecycle-install-resolution.md`
4. `backend/domain/lifecycle/service/install_resolution.go`
5. `backend/domain/lifecycle/service/install_preflight.go`
6. `backend/domain/routes/deploy.go`