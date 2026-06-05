# Story 32.1: Template Contract v0

**Epic**: Epic 32 - Templates
**Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 17, 19, 24

## Objective

Define the first AppOS-owned template contract so template meaning no longer depends on ad hoc interpretation of raw `docker-compose.yml`, `.env`, store metadata, and frontend form state.

This story does not implement the full template engine. It freezes the minimal contract that later adapter, resolver, and validation work must follow.

## Product Positioning

This story defines the contract layer of template engineering.

It should answer four questions clearly:

1. What is a template in AppOS?
2. What inputs can a template ask for?
3. How do inputs become install-time render output?
4. What source and revision facts must AppOS preserve for future upgrades?

## Scope

- define the minimal four-layer template structure: `manifest`, `inputs`, `render`, `source`
- define variable classification rules
- define service-role and naming guidance
- define template revision metadata and compatibility markers
- define the minimum repository file layout for one normalized template
- define the separation between reusable templates and instance-scoped declarations

## Out of Scope

- adapter implementation for official Docker Compose imports
- lifecycle execution internals
- full Installed-side reconfigure flows
- arbitrary executable template hooks
- complete UI design for template editing

## Template vs Instance Declaration

This story defines the reusable template contract, not the instance-scoped desired state record.

The split is:

- template: reusable deployment definition for a class of app
- instance declaration: control-plane normalized declaration for one concrete app instance

Templates may be reused many times. Instance declarations are always instance-scoped.

## Contract Summary

An AppOS template is a normalized installation definition with four layers.

### 1. `manifest`

Describes what the app is.

Minimum fields:

- `key`
- `name`
- `trademark`
- `category`
- `docs`
- `capabilities`
- `requirements`
- `versions`

Purpose:

- identify the template
- declare product-facing metadata
- declare coarse runtime requirements and install capabilities

### 2. `inputs`

Describes what the operator may or must provide at install time.

Each input field must declare at minimum:

- `key`
- `type`
- `label`
- `required`
- `default`
- `visibility`
- `storage_mode`

Recommended input types for v0:

- `string`
- `number`
- `boolean`
- `select`
- `port`
- `domain`
- `secret_ref`

Required `visibility` values:

- `system`
- `basic`
- `advanced`

Required `storage_mode` values:

- `system_managed`
- `operator_editable`
- `secret_backed`

### 3. `render`

Describes how normalized inputs become install artifacts.

Minimum v0 targets:

- `env`
- `compose_values`
- `files`
- `exposure`

Rules:

- render rules are declarative mappings, not arbitrary scripts
- backend resolution is authoritative for defaulting, validation, and final effective output
- `.env` may be rendered output, but must not be the only semantic source

### 4. `source`

Describes where the template came from and how AppOS should reason about updates.

Minimum fields:

- `origin_kind` (`official`, `custom`, `imported`, `generated`)
- `origin_ref`
- `upstream_version`
- `template_revision`
- `adapter_version`
- `compatibility`

Purpose:

- preserve upstream provenance
- support semantic diff and regeneration
- distinguish template-format evolution from app-version evolution

## Repository Layout

One normalized template should live under a structure like:

```text
templates/apps/<template-key>/
  manifest.json
  inputs.schema.json
  render.json
  source.json
  compose/
    base.yml
  env/
    defaults.env
  files/
    src/
```

Notes:

- `manifest.json`, `inputs.schema.json`, `render.json`, and `source.json` are the contract-defining files.
- `compose/base.yml`, `env/defaults.env`, and `files/` are supporting template assets.
- additional files may exist later, but v0 should keep the contract small.

## Variable Rules

Variables must remain layered until backend resolution produces one effective env map.

Minimum logical layers:

1. platform-managed values
2. template defaults
3. shared env attachments
4. app-scoped operator inputs
5. secret-backed values
6. deployment-time overrides

Rules:

- template files may declare defaults, but not collapse all layers into one static `.env`
- secret-backed values must not require plaintext browser handling
- later layers may override earlier layers only through explicit resolution rules

## Secret-Backed Input Rules

`secret_backed` inputs should use the AppOS `secrets` module as the platform source of truth.

Contract rules:

- template inputs may accept a secret reference such as `secretRef:<id>`, not only raw text
- instance declarations should persist secret references, not plaintext values
- backend resolution may reveal plaintext only during the final render step needed for runtime execution
- one app instance should normally own its own secret record even when the template key is the same
- cross-instance secret reuse should be supported only as an explicit operator choice, not as the default behavior

Default product behavior for install UX:

- if the operator leaves a `secret_backed` field empty, the frontend may offer secure random generation and immediate secret creation
- if the operator enters a plaintext value, the frontend should create a secret record first, then continue the flow using the returned reference
- if the operator selects an existing secret, the flow should continue with that reference directly

## Canonical Root URL Rules

Some apps have one canonical external URL such as `root_url`.

When present, this value should not be treated as an ordinary env field.

Contract guidance:

- templates may mark one input or derived value as `canonical_root_url`
- when `canonical_root_url` is set and the app enforces it, AppOS should treat that address as the primary external entry
- template metadata should distinguish whether AppOS can manage later changes or only detect drift

Recommended change policies for v0:

- `rebuild_ok`: AppOS can apply a changed canonical URL through later render and redeploy behavior
- `install_only`: AppOS can seed the canonical URL only during first install; later changes should not be presented as ordinary reconfigure
- `migration_required`: AppOS cannot reliably write the canonical URL because it is set inside app initialization or other app-internal state; later domain changes require app-specific remediation

Management boundary guidance:

- `template_env`: AppOS writes the value through template render output
- `bootstrap_seed`: AppOS may seed the value only during first install
- `app_internal`: AppOS does not control the value directly and should surface remediation state instead of pretending it can reconcile automatically

For `migration_required` or `app_internal` cases, the control plane should treat domain binding and app-effective canonical URL as related but not identical facts.

## Service Identity Rules

Templates should model service roles explicitly.

Recommended v0 roles:

- `primary`
- `database`
- `cache`
- `worker`
- `init`
- `proxy_helper`

Container naming guidance:

- prefer stable `instance-id` plus role suffix naming
- do not make literal container names the only control-plane identity
- publish and runtime resolution should prefer role and resolved endpoint semantics

## Versioning Rules

The template contract must separate:

1. template contract version
2. template revision
3. upstream app version
4. installed app resolved version

This prevents upstream app upgrades from being confused with template-format changes.

## Backend Resolution Boundary

Epic 17 remains the execution owner.

Template Contract v0 must support this rule:

- the frontend may collect candidate inputs from the template
- backend resolves defaults, shared envs, secret refs, and effective render outputs
- Epic 17 receives only instance-scoped normalized declaration data and rendered artifacts

## Minimum Instance Declaration Boundary

The reusable template contract should be able to feed a later instance declaration model with at least:

- `instance_id`
- `template_key`
- `template_revision`
- `template_origin_kind`
- `resolved_version`
- `resolved_env_layers` or equivalent normalized env representation
- `secret_refs`
- `exposure_intent`
- `target_server`
- `source_attribution`

This story does not define the full persistence schema for instance declarations, but the template contract must be rich enough to support one.

## Acceptance Criteria

1. AppOS has one explicit minimal template contract with four layers: `manifest`, `inputs`, `render`, and `source`.
2. The contract distinguishes metadata, operator inputs, render behavior, and upstream provenance rather than mixing them in one file.
3. Variable handling is explicitly layered and supports `system_managed`, `operator_editable`, and `secret_backed` classifications.
4. Service-role semantics are defined independently from literal container names.
5. The repository layout for one normalized template is small, explicit, and implementation-ready.
6. The contract preserves the Epic 17 boundary: templates define install meaning, but do not create a second execution path.
7. The contract clearly separates reusable template definition from later instance-scoped normalized declarations.

## References

- `specs/implementation-artifacts/epic32-templates.md`
- `specs/implementation-artifacts/epic17-app-execution.md`
- `specs/implementation-artifacts/story17.4e-install-input-resolution.md`
- `specs/implementation-artifacts/epic19-secrets.md`
- `specs/implementation-artifacts/epic24-shared-envs.md`
