# Story 32.2: Upstream Compose Adapter

**Epic**: Epic 32 - Templates
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 32.1, Epic 17

## Objective

Define the repeatable adapter path that converts official upstream Docker Compose projects into AppOS-normalized templates.

This story does not require perfect automatic conversion. It establishes the engineering contract for preserving upstream sources, applying AppOS adaptation rules, and reviewing upstream changes safely.

## Product Positioning

This story defines the adaptation layer of template engineering.

It should answer four questions clearly:

1. How does AppOS keep upstream Compose sources separate from AppOS templates?
2. What parts of an upstream project should be normalized automatically?
3. What parts require explicit review?
4. How does AppOS absorb upstream updates without manual rewrite from scratch?

## Scope

- define upstream source tracking for official Compose-based apps
- define the normalization path from upstream files into AppOS template contract files
- define which Compose semantics are extracted automatically in v0
- define semantic-diff and adaptation-review expectations for upstream updates
- define minimal regression requirements for adapter output

## Out of Scope

- implementation of the full adapter engine
- full install UI consumption
- Installed-side upgrade orchestration
- support for every non-Compose packaging format

## Adapter Layers

AppOS should keep four explicit layers:

1. `upstream`
2. `adapter rules`
3. `normalized template`
4. `rendered install output`

Rules:

- upstream files are preserved as references, not overwritten in place
- AppOS-normalized templates are generated or maintained as a separate layer
- rendered install output is an execution artifact, not a template-definition layer

## Input Surface

The adapter should primarily consume these upstream signals when present:

- `docker-compose.yml` or equivalent Compose file
- `.env`
- auxiliary mounted files under `src/` or equivalent directories
- metadata files such as `variables.json` when available

## Automatic Normalization Targets

The common 80 percent that should be normalized automatically includes:

- service inventory
- image and tag references
- env and env-file references
- exposed ports and likely publish candidates
- volumes and mount paths
- network declarations
- depends-on relationships
- healthcheck declarations
- obvious init or sidecar services

## Review-Required Decisions

The adapter must allow explicit review for higher-risk meaning:

- which service is `primary`
- which variables are `operator_editable`
- which variables are `secret_backed`
- whether publish semantics are HTTP, HTTPS, DB, MQ, SSH, or internal-only
- what data paths are upgrade- and backup-critical
- whether upstream changes are safe to absorb automatically

## Semantic Diff Rules

Upstream updates should not be reviewed as raw file diffs only.

AppOS should reason about at least these semantic change categories:

- service added, removed, or renamed
- image or tag changed
- port exposure changed
- env variable added, removed, or changed
- volume path changed
- network behavior changed
- healthcheck changed
- init/sidecar behavior changed

## Repository Direction

Recommended structure:

```text
templates/
  upstream/
  adapters/
  apps/
  tests/
```

Minimal meaning:

- `upstream/`: source references or imported upstream assets
- `adapters/`: normalization rules and mapping metadata
- `apps/`: AppOS-normalized templates that satisfy Story 32.1
- `tests/`: sample regressions and adapter validation coverage

## Output Expectations

The adapter output must be able to populate or validate these AppOS template artifacts:

- `manifest.json`
- `inputs.schema.json`
- `render.json`
- `source.json`
- `compose/base.yml`
- `env/defaults.env`

This story does not require every output field to be machine-generated. It requires the adapter path to make the contract reviewable and repeatable.

## Resolution Boundary

The adapter does not execute installs.

Its job is to prepare AppOS-normalized template meaning so later template-aware install flows can pass through the Epic 17 resolution boundary.

## Acceptance Criteria

1. AppOS defines an explicit four-layer adapter model: upstream, adapter rules, normalized template, and rendered output.
2. Common Compose structure such as services, env, ports, volumes, networks, and healthchecks is identified as adapter-normalizable work.
3. High-risk semantic decisions such as primary service identity, secret classification, and publish semantics are explicitly marked as review-required.
4. Upstream updates are reviewed through semantic change categories, not just raw file diffs.
5. The recommended repository structure supports upstream preservation, normalized output, and regression checks without collapsing them into one folder.
6. The adapter path reinforces the Epic 17 rule that install execution remains shared and normalized.

## References

- `specs/implementation-artifacts/epic32-templates.md`
- `specs/implementation-artifacts/story32.1-template-contract.md`
- `specs/implementation-artifacts/epic17-app-execution.md`
