# Story 32.6: Instance Declaration Model

**Epic**: Epic 32 - Templates
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 32.1, Story 32.3, Epic 17

## Objective

Define the control-plane instance declaration as the durable normalized source of truth for one deployed app instance.

This story keeps reusable templates, instance-scoped desired state, and runtime workspaces explicitly separated.

## Scope

- define `instance declaration` as a first-class control-plane concept
- define the minimum fields required for one durable declaration
- define how create, redeploy, modify, and reconcile flows should use the declaration
- define the boundary between declaration data and runtime workspace output

## Out of Scope

- full persistence implementation
- worker internals
- full drift engine design
- Installed-side UX details

## Definition

An `instance declaration` is the instance-scoped normalized desired deployment state stored by the control plane after template resolution.

It is:

- derived from a template plus operator inputs and platform context
- durable across redeploy and modify actions
- the control-plane source of truth for one concrete instance

It is not:

- a reusable template
- a managed-server runtime workspace
- a raw form payload

## Minimum Fields

The minimum declaration boundary should include:

- `instance_id`
- `template_key`
- `template_revision`
- `template_origin_kind`
- `resolved_version`
- `target_server`
- `source_attribution`
- `resolved_env` or equivalent normalized env-layer representation
- `secret_refs`
- `exposure_intent`
- `service_roles`
- `last_applied_revision` or equivalent runtime linkage marker

## Usage Rules

The control-plane behavior should follow these rules:

1. create uses template resolution to produce the first instance declaration
2. redeploy reads the existing instance declaration as its control-plane source
3. modify updates the instance declaration first, then renders runtime output from it
4. reconcile compares the instance declaration with runtime state or runtime workspace state

This prevents runtime behavior from depending on reusable templates as if they were instance state.

## Runtime Boundary

The runtime workspace is a rendered execution artifact derived from the instance declaration.

The declaration should remain the durable control-plane source even if the runtime workspace is regenerated, replaced, or removed.

## Template Update Boundary

Official-template or custom-template changes must not automatically mutate existing instance declarations.

Any adoption of newer template revisions by an existing instance should occur through an explicit rebase, reconcile, or upgrade path.

## Acceptance Criteria

1. AppOS explicitly defines `instance declaration` as a control-plane object distinct from reusable templates and runtime workspaces.
2. The story defines a minimum field boundary rich enough to support create, redeploy, and modify flows.
3. Redeploy and modify behavior are defined to use the instance declaration instead of re-reading reusable templates as the only source.
4. The story preserves explicit boundaries between template updates and instance mutation.

## References

- `specs/implementation-artifacts/epic32-templates.md`
- `specs/implementation-artifacts/story32.1-template-contract.md`
- `specs/implementation-artifacts/story32.3-template-resolution-ingress.md`