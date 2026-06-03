# Story 32.3: Template Resolution Ingress

**Epic**: Epic 32 - Templates
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 32.1, Story 32.2, Epic 17, 19, 24

## Objective

Connect AppOS template-defined inputs to the shared Epic 17 install-resolution boundary so template-driven installs remain one normalized lifecycle ingress, not a second execution path.

This story does not redesign lifecycle execution. It defines how template meaning, operator inputs, shared envs, secrets, and render outputs become one backend-owned instance declaration before operation creation and runtime rendering.

## Product Positioning

This story defines the ingress layer of template engineering.

It should answer four questions clearly:

1. How does a template-driven install enter the shared lifecycle resolver?
2. What parts of template input remain candidate data versus normalized intent?
3. How are env layers, secret refs, and exposure intent preserved at ingress?
4. What does Epic 17 receive after template resolution finishes?

## Scope

- define the backend-owned ingress path from template selection to normalized install payload
- define how template `inputs`, `render`, and `source` layers feed Epic 17 resolution
- define how shared envs, operator inputs, secret-backed values, and exposure intent join the same resolution boundary
- define the minimum preview and create semantics for template-driven install flows

## Out of Scope

- worker execution internals
- Installed-side reconfiguration after install
- arbitrary template hook execution
- a full template editor UX

## Ingress Model

Template-driven install must follow one explicit sequence:

1. select template
2. collect candidate template inputs
3. resolve candidate input through backend template and lifecycle rules
4. persist one instance-scoped normalized declaration
5. produce rendered artifacts for runtime execution
6. hand one shared declaration-driven payload to Epic 17 operation creation

The frontend may assist input collection and preview, but it must not become the authority for final defaults, secret handling, or effective env generation.

## Candidate Input vs Normalized Intent

At ingress, AppOS should distinguish:

- `candidate input`: raw operator-supplied values and selections
- `normalized intent`: backend-authored install meaning after defaults, validation, and classification
- `instance declaration`: the persisted control-plane normalized form of that intent for one concrete instance
- `render output`: effective env, compose values, files, and exposure metadata prepared for execution

The create flow must not skip directly from candidate input to queueing.

The instance declaration is the durable source for later redeploy, modify, or reconcile behavior.

## Resolution Inputs

The template ingress should combine these logical layers before Epic 17 action creation:

1. platform-managed values
2. template defaults
3. shared env attachments
4. operator-editable app-scoped inputs
5. secret-backed values or secret refs
6. deployment-time overrides

This story assumes Epic 17 remains the owner of final normalization behavior, but template-driven install must feed it with explicit structured layers rather than UI-only state.

## Secret and Exposure Handling

Template ingress must preserve these semantics explicitly:

- secret-backed inputs must not remain only as raw browser strings when secret refs are required or available
- exposure and publish-related choices must remain explicit normalized intent, not vanish into generic env blobs
- the normalized install payload must distinguish runtime env, secret references, and exposure-related intent clearly enough for later preview and execution work

## Preview and Create Rules

Template-driven install should support two aligned backend behaviors:

1. preview/check: resolve template-driven install intent without creating an operation
2. create: reuse the same resolution rules, persist the instance declaration, then create the shared Epic 17 action

Preview and create must not drift into different normalization semantics.

Redeploy and modify flows should also derive from the persisted instance declaration rather than re-reading the reusable template alone.

## Output Contract

By the end of ingress resolution, the control plane should own one instance declaration, and Epic 17 should receive only declaration-driven lifecycle install data plus rendered artifacts such as:

- selected template identity and revision
- persisted instance identity
- resolved source attribution
- effective env result
- rendered compose values or template-rendered compose asset references
- rendered file outputs or file metadata
- secret-reference metadata
- normalized exposure intent

Workers must not need raw template form state.

## Acceptance Criteria

1. Template-driven install is explicitly modeled as a backend-owned ingress path into Epic 17, not as a separate execution channel.
2. The story distinguishes candidate input, normalized install intent, and rendered install output.
3. Template defaults, shared envs, operator inputs, secret-backed values, and deployment overrides are represented as explicit ingress layers.
4. Secret-backed and exposure-related template inputs remain explicit normalized semantics rather than hidden UI state.
5. Preview/check and create flows are required to share the same resolution boundary.
6. Instance-level redeploy and modify behavior can use the persisted instance declaration as the control-plane source of truth.
7. Epic 17 receives declaration-driven install payloads and rendered artifacts only, not raw template form data.


## References

- `specs/implementation-artifacts/epic32-templates.md`
- `specs/implementation-artifacts/story32.1-template-contract.md`
- `specs/implementation-artifacts/story32.2-upstream-compose-adapter.md`
- `specs/implementation-artifacts/story17.4e-install-input-resolution.md`
- `specs/implementation-artifacts/story17.4e-c-runtime-input-resolution.md`
- `specs/implementation-artifacts/story17.4e-d-secret-and-exposure-intent-normalization.md`
- `specs/implementation-artifacts/story17.4e-e-resolution-preview-api.md`
