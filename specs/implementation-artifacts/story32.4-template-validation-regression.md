# Story 32.4: Template Validation and Regression

**Epic**: Epic 32 - Templates
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 32.1, Story 32.2, Story 32.3

## Objective

Define the validation and regression boundary for AppOS templates so template changes and upstream updates are reviewable before they affect install flows.

This story does not require a full production-grade validation engine on day one. It freezes the minimum checks and review categories that make template work safe enough to scale.

## Product Positioning

This story defines the verification layer of template engineering.

It should answer four questions clearly:

1. What must be validated in one normalized template?
2. What must be compared when upstream changes?
3. What sample coverage is required before a template is trusted?
4. What failures should block template promotion into active install flows?

## Scope

- define contract validation for template files
- define render validation for effective install outputs
- define minimum sample-template regression expectations
- define upstream-change review and impact categories
- define the minimum promotion gate for template updates

## Out of Scope

- complete CI implementation
- full end-to-end runtime deployment test matrix
- production template publishing workflow

## Validation Layers

AppOS template validation should have four layers.

### 1. Contract Validation

Verify that one normalized template satisfies Story 32.1.

Minimum checks:

- required contract files exist
- JSON structure is parseable
- required fields exist in `manifest`, `inputs`, `render`, and `source`
- input field keys are unique
- variable classifications use allowed values

### 2. Render Validation

Verify that a template can produce coherent install outputs before queueing.

Minimum checks:

- required input placeholders resolve or remain explicitly allowed
- env mappings do not contain unresolved accidental references
- render targets align with declared service roles and minimal exposure intent
- each template exposure intent has only the compact access fields needed by the MVP: `label`, `service`, `port`, `protocol`, and optional `default`
- exposure intent does not include runtime-only or resolved fields such as `id`, `containerName`, `serverPort`, `url`, host, or route id
- compose-related outputs remain structurally valid for the supported template slice

### 3. Sample Regression Validation

Verify that representative templates still satisfy expected normalized behavior.

Minimum v0 expectation:

- keep at least one concrete sample such as `wordpress`
- compare expected manifest, input classes, render targets, and source metadata shape
- compare expected exposure intent entries for service, protocol, container port, and default marker
- catch accidental contract drift caused by future template changes

### 4. Upstream Change Review

Verify that upstream changes are interpreted through semantic categories, not only raw file diffs.

Minimum review categories:

- service shape changed
- image/tag changed
- env surface changed
- port exposure changed
- volume or mount behavior changed
- network behavior changed
- health or init behavior changed
- metadata or version support changed

## Promotion Rules

Template changes should not be treated as ready for install flows until they pass the minimum validation layers appropriate to the change.

At minimum:

- contract changes must pass contract validation
- adapter changes must pass contract validation plus upstream-change review
- template sample updates must pass sample regression validation
- changes affecting render semantics should pass render validation before create/install consumption

## Failure Semantics

The validation layer should clearly separate:

- blocking errors
- review-required warnings

Blocking errors include:

- missing contract files
- malformed required JSON
- unsupported variable classification values
- impossible required render references

Review-required warnings include:

- likely primary-service ambiguity
- newly introduced secret-like env variables
- new publish-related ports or protocols
- upstream changes that alter service role assumptions

## Acceptance Criteria

1. AppOS defines explicit contract validation expectations for normalized template files.
2. AppOS defines explicit render validation expectations before template-driven install flows consume a template.
3. AppOS requires at least one representative sample template regression target.
4. Upstream updates are reviewed using semantic impact categories rather than raw file diffs only.
5. The story distinguishes blocking validation failures from review-required warnings.
6. Template promotion into active install flows is described as a gated process, not an unchecked file drop.

## References

- `specs/implementation-artifacts/epic32-templates.md`
- `specs/implementation-artifacts/story32.1-template-contract.md`
- `specs/implementation-artifacts/story32.2-upstream-compose-adapter.md`
- `specs/implementation-artifacts/story32.3-template-resolution-ingress.md`
