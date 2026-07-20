# Spec: Resource Shared Kernel

Status: proposed

## Purpose

Define the minimal shared kernel for template-driven external access resources under `backend/domain/resource/`.

## Scope

In scope:

- `accounts`
- `instances`
- `connectors`
- `aiproviders`

Out of scope:

- `servers`

`servers` is a managed runtime node domain, not a template-driven external access resource domain.

## Boundary

`resource/shared` is a shared kernel for template-driven external access resources, not a base package for all `resource/*` domains.

`aiproviders` may share `resource/shared`, but must not keep `connectors` as its implicit base domain.

## Shared Kernel Contract

`resource/shared` may own only these reusable concerns:

1. Pure helpers: template id normalization, config cloning/decoding, string-list helpers.
2. Shared errors: validation, conflict, access-denied.
3. Shared ref validators: credential and provider-account reference checks.
4. Template loading orchestration: scan, overlay, sort, shared field helpers.
5. Shared core metadata:
   - `ID`
   - `Created`
   - `Updated`
   - `IsEnabled`
6. Optional shared lifecycle/view flags when truly cross-domain:
   - `IsDefault`

## Non-Goals

`resource/shared` must not own:

1. `servers` runtime or connectivity logic.
2. A universal `Repository` interface.
3. A universal `SaveInput` type.
4. A universal `Template` type.
5. Domain-specific `applyTemplateConstraints` logic.
6. Probe/reachability persistence semantics.

## Reachability Rule

`Reachability` is a derived runtime/view result, not core resource identity.

If shared, it belongs in a projection or runtime-view helper, not in the persisted resource core.

## JSON Extensibility Rule

Do not add a second generic JSON persistence field to the shared kernel.

`config` remains the only instance-level extension bag.

Template-specific extensions remain owned by each domain template model.

## Implementation Order

1. Freeze the boundary: shared serves only `accounts`, `instances`, `connectors`, `aiproviders`.
2. Add shared validator helpers and shared core metadata structs.
3. Move `aiproviders` off connector-as-base and onto explicit local types plus `resource/shared`.
4. Keep reachability as projection/runtime output, not core state.
5. Add focused tests for shared metadata, validators, and the `aiproviders` boundary.

## Acceptance

1. `resource/shared` contains only low-level reusable kernel code.
2. `servers` does not depend on the shared kernel contract.
3. `aiproviders` no longer relies on `connectors` as its implicit base model/service contract.
4. `Created`, `Updated`, and `IsEnabled` are shareable kernel metadata.
5. `Reachability` is modeled as derived output, not persisted shared core state.
6. No new generic JSON field is introduced beyond `config`.