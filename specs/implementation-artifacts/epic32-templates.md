# Epic 32: Templates

**Module**: Templates | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 5, 14, 17, 19, 24

## Overview

AppOS Templates is the canonical template-definition and template-adaptation domain for app installation.

It gives AppOS one normalized template contract for:

- Store-backed app install entry
- upstream Docker Compose adaptation
- install-time parameter collection
- env, secret, and file rendering
- template-version tracking and upgrade compatibility

This epic is not a second lifecycle engine. Templates defines install intent and renderable deployment assets, then hands the normalized result to Epic 17.

## Problem Statement

Today AppOS can prefill compose-based installs, but template meaning is still fragmented across raw `docker-compose.yml`, `.env`, store metadata, and ad hoc UI assumptions.

That creates three product problems:

1. Official upstream Compose projects are hard to convert into AppOS-ready templates in a repeatable way.
2. Upstream changes are hard to absorb without manual diff-and-rewrite work.
3. Install-time fields, defaults, secrets, and generated `.env` output do not yet come from one backend-owned contract.

Without a dedicated Templates epic, Store install remains thin prefill, `.env` keeps carrying too much hidden product meaning, and template evolution stays expensive.

## Definition

`Templates` owns the normalized template contract for app installation.

It owns:

- template manifest and input schema
- upstream-to-AppOS adaptation rules
- template default values and render rules
- template-aware install resolution inputs before operation creation
- template revision and compatibility metadata

It does not own:

- lifecycle execution, worker orchestration, or action state
- installed-app management projections
- raw secrets storage
- long-term app runtime state
- direct file editing as a user-facing IaC workspace

## Terminology

AppOS should use the following terms consistently.

- `official template`: an AppOS-provided baseline template maintained by the platform
- `custom template`: a user-authored or user-derived template intended for future reuse
- `instance declaration`: the instance-scoped normalized install declaration stored by the control plane after template resolution
- `runtime workspace`: the rendered execution directory pushed to a managed server and consumed by the runtime
- `image seed`: the read-only template baseline shipped inside the image
- `runtime official cache`: the writable runtime store for online-updated official templates

These terms answer different questions:

- templates answer how a class of app should be deployed
- instance declarations answer how one concrete instance should be deployed
- runtime workspaces answer what the executor actually runs

## Boundary

Use `Templates` when the product needs to define, import, normalize, validate, or render an app-install template.

Do not use `Templates` as a generic app-management module, a second Store catalog, or a replacement for Epic 17 install execution.

The control split is:

- Templates defines what an app install template means.
- Epic 17 resolves that template into one instance declaration and executes it through the shared lifecycle core.
- Epic 18 manages the installed result.

## Deployment Layer Model

Template-driven deployment should follow a three-layer model.

1. `template layer`
  - official templates
  - custom templates
  - purpose: reusable deployment definition
2. `control-plane declaration layer`
  - instance declarations
  - purpose: instance-scoped normalized desired deployment state
3. `runtime layer`
  - runtime workspaces on managed servers
  - purpose: rendered execution artifacts consumed by Docker Compose or equivalent runtime tools

The deployment path is therefore:

- template selection or derivation
- backend normalization into one instance declaration
- render and push to runtime workspace
- execute on the managed server

AppOS should not treat templates and runtime workspaces as the same object.

## Product Direction

AppOS should treat templates as a first-class product asset inside the main repository, under a dedicated folder such as `templates/apps`, not as a thin copy of upstream Compose folders.

Near-term strategy:

- keep AppOS templates in the AppOS repo
- keep upstream source and AppOS-normalized output explicitly separated
- make adaptation repeatable through rules, not manual one-off rewrites

This keeps template evolution, resolver changes, and install UX changes in one reviewable system until the contract stabilizes.

## Official Template Distribution Strategy

Official templates should not exist only in one immutable image location.

AppOS should support both:

1. `image seed`
  - shipped with the image
  - read-only baseline
  - offline fallback and compatibility floor
2. `runtime official cache`
  - writable runtime store
  - receives online official template updates without requiring an image upgrade

Recommended logical read priority:

1. custom template
2. runtime official cache
3. image seed

This allows AppOS to support both reproducible baseline behavior and online official template updates.

Online official template updates must not automatically mutate existing instance declarations or custom templates.

## Change Semantics

AppOS should distinguish template changes from instance changes.

Rules:

1. instance-level redeploy and modify actions update the instance declaration
2. template-level edits update the reusable custom template
3. official template updates change only official template sources, not existing instance declarations
4. template-to-instance propagation requires an explicit rebase, reconcile, or upgrade action

This keeps future reuse rules separate from live instance behavior.

## Core Model

The minimal template model should have four layers:

1. `manifest`: app identity, version options, docs, requirements, capabilities
2. `inputs`: install-time fields, defaults, validation, secret-backed markers
3. `render`: how inputs become effective env, compose values, files, and exposure intent
4. `source`: upstream origin, template revision, adaptation metadata

Recommended internal concepts:

- `TemplateDefinition`
- `TemplateInputSchema`
- `TemplateRenderPlan`
- `TemplateSource`
- `TemplateRevision`
- `TemplateCompatibility`

## Rules

### 1. `.env` is not the only source of truth

`.env` may remain an input template and execution output, but it must not carry the whole product contract alone.

### 2. Backend owns normalization

Frontend may render forms and preview, but backend templates/resolution logic is authoritative for defaults, validation, secret references, and effective env generation.

### 3. Upstream is preserved, not hand-forked blindly

Official Compose sources should be kept as upstream references. AppOS should maintain explicit adaptation rules and normalized output, not opaque manual rewrites only.

### 4. Container names should be stable, not globally hardcoded

Templates should prefer `instance-id + role-suffix` naming and role metadata such as `primary`, `database`, or `init`.

AppOS should depend on service role and resolved endpoint semantics, not only on literal container names.

### 5. Templates stay declarative in MVP

Phase 1 should prefer manifest/schema/render rules over arbitrary shell hooks.

## Engineering Principles

Epic 32 should follow these template-engineering principles.

### 1. Single Source of Truth

AppOS must keep one canonical template contract.

`manifest`, `inputs`, `render`, and backend resolution rules define template meaning. Raw `docker-compose.yml`, `.env`, frontend form state, and rendered files must not each become separate truth sources.

### 2. Declarative Over Imperative

Template behavior should be expressed through schema, validation rules, render mappings, and explicit metadata before introducing executable hooks.

This keeps template behavior reviewable, testable, and predictable.

### 3. Normalize Before Execute

Every install entry path must normalize into one backend-owned install payload before Epic 17 operation creation.

Store, imported Compose, Git, and custom templates are allowed as inputs, but they must not create separate execution semantics.

### 4. Separate Upstream From AppOS

Upstream source, adaptation rules, normalized template definition, and rendered install output must remain distinct layers.

This is required for repeatable upgrades, semantic diffing, and controlled regeneration.

### 5. Automate the Common 80 Percent

Template adaptation should automate the common structural work such as service, env, port, volume, and network extraction.

The remaining high-risk semantic decisions such as primary service identity, publish semantics, secret classification, and upgrade safety may require explicit review.

### 6. Layer Variables Explicitly

Template defaults, platform-managed values, shared envs, app-scoped inputs, secret-backed values, and deployment-time overrides must remain separate until backend resolution produces one effective env result.

This prevents `.env` from becoming an untraceable mix of source data, system defaults, and user changes.

### 7. Prefer Service Role Over Literal Container Name

Templates should define stable service-role semantics such as `primary`, `database`, `cache`, and `init`.

Container names may stay stable and predictable, but AppOS should not make literal container names the only control-plane identity.

### 8. Regression Is Part of the Contract

Template work is not complete without contract validation, render validation, representative sample coverage, and upstream-change review.

A template system that cannot safely absorb upstream changes is not yet engineered well enough.

### 9. Secrets Are Platform-Owned But Instance-Scoped

AppOS should treat sensitive template values as platform-owned secrets, but the default ownership unit should be one app instance, not one shared app family secret.

Rules:

- secret-backed template inputs should resolve through the AppOS `secrets` module
- one installed app instance should normally get its own generated or user-provided secret record
- templates and instance declarations should store secret references, not plaintext secret values
- runtime rendering may materialize plaintext only at the latest necessary step for execution
- sharing one secret across multiple app instances should be explicit and exceptional, not the default UI path

Recommended default UX:

- when a template field is `secret_backed`, the frontend should let the operator either generate a new secret or enter a value once and save it into `secrets`
- the create flow should then keep passing only the resulting secret reference through template resolution and instance declaration persistence

## Minimal Conclusions

Epic 32 should keep four decisions explicit.

1. Templates, instance declarations, and runtime workspaces are three different layers and should not share one directory or one source-of-truth role.
2. Template updates must not automatically mutate installed instances; instance-level adoption should happen only through an explicit rebase, reconcile, or upgrade action.
3. One app may expose multiple variants such as community or enterprise, but AppOS should model them as template variants under one app identity rather than as unrelated Compose files with separate execution semantics.
4. AI may accelerate template normalization, but it should work from a template-material package that includes upstream Compose, env examples, install docs, and upgrade notes, then remain subject to explicit human review.
5. Secret-backed template fields should default to one secret per installed app instance; the platform stores the secret, while templates and instance declarations carry only references.

## Core Capabilities

Templates provides:

- normalized template definition files
- input schema for install-time parameter collection
- upstream Compose adaptation pipeline
- render plan for env, compose values, files, and secret references
- template revision tracking and compatibility checks
- pre-install validation hooks for schema and adaptation-level errors

## MVP

The first coherent loop should be narrow and execution-aligned.

### MVP user flow

1. Operator selects an app from Store or a template source.
2. AppOS loads one normalized template definition.
3. AppOS collects template-defined inputs and secrets.
4. Backend resolves effective env, compose values, and file outputs.
5. AppOS submits one shared Epic 17 install request.

### MVP committed capabilities

- define one AppOS-owned template contract
- support official Compose adaptation into that contract
- support `.env` defaults plus explicit input schema
- classify variables into system-managed, operator-editable, and secret-backed
- track upstream source and template revision
- hand resolved install payload to Epic 17 without a Store-only execution path

### MVP non-goals

- arbitrary executable template hooks
- full upgrade orchestration redesign
- complete Installed-side reconfiguration model
- automatic perfect conversion of every upstream Compose project

## Directory Direction

Preferred final layout should optimize for clarity, not backward compatibility.

### Repository source

Keep template engineering assets in the AppOS repository:

- `templates/upstream/apps/<app>/`
  - preserved upstream Compose files, env examples, install notes, upgrade notes
- `templates/adapters/apps/<app>/`
  - AppOS adaptation rules and review metadata for that upstream app
- `templates/modules/<module>/`
  - reusable semantic building blocks such as `mysql`, `postgres`, `redis`, `proxy`, or `volume`
- `templates/apps/<app>/manifest.json`
- `templates/apps/<app>/inputs.schema.json`
- `templates/apps/<app>/render.json`
- `templates/apps/<app>/source.json`
- `templates/apps/<app>/compose/base.yml`
- `templates/apps/<app>/env/defaults.env`
- `templates/apps/<app>/variants/<variant>/`
  - variant-specific overrides such as `community` and `enterprise`
- `templates/tests/apps/<app>/`
  - expected shapes, upstream review checklists, sample values, and regression baselines
- `templates/tools/`
  - validation and rendering helpers

This layout keeps upstream source, reusable modules, normalized templates, variants, tests, and tools readable without mixing runtime state into the repository.

### Runtime layout

Keep runtime state separate from repository source:

- `/appos/system/templates/official/`
  - read-only image seed for official templates
- `/appos/data/templates/official/`
  - writable runtime official cache updated online
- `/appos/data/templates/custom/`
  - writable user-defined templates
- `/appos/data/instances/<instance-id>/declaration.json`
  - durable control-plane instance declaration for one installed app
- `/appos/data/runtime/apps/<instance-id>/`
  - rendered runtime workspace pushed to execution

### Runtime read and write rules

Read priority should stay explicit:

1. official template resolution reads `/appos/data/templates/official/` first, then falls back to `/appos/system/templates/official/`
2. custom template resolution reads `/appos/data/templates/custom/`
3. installed-instance operations read `/appos/data/instances/<instance-id>/declaration.json` as the control-plane source of truth
4. execution reads `/appos/data/runtime/apps/<instance-id>/` only as rendered runtime output, not as durable product state

Write rules should stay explicit too:

1. online official-template updates write only to `/appos/data/templates/official/`
2. user-created or user-derived reusable templates write only to `/appos/data/templates/custom/`
3. create, modify, rebase, or reconcile actions update `/appos/data/instances/<instance-id>/declaration.json` first
4. runtime rendering writes `/appos/data/runtime/apps/<instance-id>/` from the instance declaration
5. `/appos/system/templates/official/` remains read-only and is never mutated at runtime

This layout makes the mental model simple:

- `templates` answer how an app class should be deployed
- `instances` answer how one concrete installation should exist
- `runtime/apps` holds execution artifacts only

## Story Breakdown

### Story 32.1: Template Contract

Define the AppOS template manifest, input schema, render-plan boundary, and revision metadata.

Primary artifact:

- `specs/implementation-artifacts/story32.1-template-contract.md`

Output:

- canonical template file structure
- variable-classification rules
- role-based service naming guidance
- template revision and compatibility fields

### Story 32.2: Upstream Compose Adapter

Primary artifact:

- `specs/implementation-artifacts/story32.2-upstream-compose-adapter.md`

Define the repeatable adapter path from official `docker-compose.yml` sources into AppOS templates.

Output:

- upstream/source tracking model
- normalization rules for env, ports, volumes, networks, and service roles
- semantic diff and adaptation-review workflow

### Story 32.3: Template Resolution Ingress

Primary artifact:

- `specs/implementation-artifacts/story32.3-template-resolution-ingress.md`

Connect template-defined inputs to the shared Epic 17 install-resolution boundary.

Output:

- template-aware create-deployment inputs
- backend-owned effective env and secret reference resolution
- rendered install payload handoff to Epic 17

### Story 32.4: Template Validation and Regression

Primary artifact:

- `specs/implementation-artifacts/story32.4-template-validation-regression.md`

Add validation and regression coverage so template changes and upstream updates are reviewable.

Output:

- schema validation
- render validation
- sample-template regression coverage
- upstream-change impact review checklist

### Story 32.5: Official Template Seed and Runtime Cache Strategy

Define the official-template distribution, caching, update, and promotion model.

Output:

- image seed and runtime cache terminology
- official-template online update rules
- read-priority and copy-on-write rules
- explicit non-automatic propagation rules for existing instance declarations

### Story 32.6: Instance Declaration Model

Primary artifact:

- `specs/implementation-artifacts/story32.6-instance-declaration-model.md`

Define the durable control-plane normalized declaration for one concrete deployed instance.

Output:

- instance declaration terminology and boundary
- minimum field set for durable instance state
- create, redeploy, modify, and reconcile source-of-truth rules

## Acceptance Criteria

- AppOS has one explicit template contract instead of inferring install semantics only from raw `.env` and Compose files.
- Official Compose applications can be adapted into AppOS templates through a repeatable rule-driven process.
- Template inputs, defaults, secret references, and render outputs are backend-owned before Epic 17 operation creation.
- Template storage and runtime evolution remain in the AppOS repository for the current phase.
- Service naming guidance supports stable publishability without requiring globally hardcoded container names.
- Template changes can be validated with contract and regression checks before affecting install flows.