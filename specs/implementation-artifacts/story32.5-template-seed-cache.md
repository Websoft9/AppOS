# Story 32.5: Official Template Seed and Runtime Cache Strategy

**Epic**: Epic 32 - Templates
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 32.1, Story 32.2, Story 32.4

## Objective

Define how AppOS stores, updates, and resolves official templates across image-shipped seed content and runtime online-update caches.

This story exists because official templates must support both offline baseline behavior and online updates without requiring image upgrades.

## Product Positioning

This story defines the official-template source-of-truth and update model.

It should answer four questions clearly:

1. Where do official templates live when the image ships?
2. How can official templates update online without replacing the image?
3. Which source wins when multiple official-template copies exist?
4. What should never be auto-overwritten during official template updates?

## Scope

- define `image seed` and `runtime official cache`
- define official-template read priority
- define online official-template update behavior
- define non-automatic propagation rules for existing instances and custom templates
- define the minimum metadata needed for official-template update safety

## Out of Scope

- full sync implementation
- full template publishing service design
- instance upgrade execution internals

## Official Template Layers

Official templates should exist in two layers.

### 1. Image Seed

Purpose:

- provide a read-only baseline shipped with the image
- allow offline first-start behavior
- provide a compatibility floor and rollback baseline

### 2. Runtime Official Cache

Purpose:

- store online-updated official templates at runtime
- allow official template updates without replacing the image
- preserve update metadata, cache status, and downloaded revisions

## Read Priority

For install-time template resolution, AppOS should use this logical priority:

1. custom template
2. runtime official cache
3. image seed

This lets user-authored work remain authoritative while still supporting online official updates.

## Update Rules

Online official-template updates should follow this model:

1. fetch index or metadata from the official source
2. download candidate template into staging
3. validate contract and compatibility
4. activate into runtime official cache only after validation passes
5. keep prior revision available for rollback or comparison

Official-template updates must not:

- overwrite the image seed
- overwrite custom templates
- automatically rewrite existing instance declarations

## Propagation Rules

Official template updates affect future template resolution by source priority, but they do not automatically mutate existing instance declarations.

Any instance-level adoption of an updated official template requires an explicit rebase, reconcile, or upgrade path.

## Metadata Expectations

At minimum, each official runtime-cached template should preserve:

- `template_key`
- `template_revision`
- `contract_version`
- `upstream_version`
- `checksum`
- `downloaded_at`
- `published_at` when known
- `source_url`
- `status`

This metadata is required to explain which official template version AppOS is actually using.

## Acceptance Criteria

1. AppOS explicitly distinguishes image-shipped official template seed from runtime official cache.
2. Official templates can update online through runtime cache semantics without requiring an image upgrade.
3. The story defines a deterministic read priority across custom templates, runtime official cache, and image seed.
4. Official template updates are explicitly prevented from automatically overwriting custom templates or existing instance declarations.
5. The minimum metadata required for runtime official template updates is documented.

## References

- `specs/implementation-artifacts/epic32-templates.md`
- `specs/implementation-artifacts/story32.1-template-contract.md`
- `specs/implementation-artifacts/story32.4-template-validation-regression.md`