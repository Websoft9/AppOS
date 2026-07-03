# Story 8.11: Resource Metadata-Driven UI Slice

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: in-progress
**Depends on**: Story 8.5, Story 8.9

## User Story

As an AppOS operator,
I want resource forms to follow the selected kind and profile automatically,
so that I can configure connectors and runtime instances without learning product-specific protocol, auth, endpoint, and layout quirks.

## Goal

Introduce the next implementation slice of metadata-driven resource UI by extending backend template metadata and moving the highest-value connector and runtime-instance behaviors away from hardcoded frontend `kind` branches.

This story intentionally focuses on two resource families first:

1. `Connectors`
2. `Runtime Instances`

It does not attempt a total removal of every resource-specific branch across the entire Resources surface.

## Why Now

Current resource templates already define field lists and defaults, but key interaction behavior is still hardcoded in frontend code:

1. connectors previously hardcoded `smtp` endpoint decomposition and `proxy` auth-mode rules
2. runtime instances still hardcode database-vs-non-database flow, host/port handling, secret-backed credential rules, and SSL layout
3. runtime instances in the same category still diverge visually even when operators expect one shared interaction model
4. connector endpoint protocol defaults are implicit and not surfaced clearly to operators

Without a stronger metadata contract, each new resource kind or profile adds more frontend branching, more duplicated rules, and more maintenance risk.

## Scope

### In Scope

- keep connector metadata-driven improvements from the first Story 8.11 slice
- extend runtime instance template/profile metadata with UI-driving properties
- move runtime instance database layout and credential behavior away from hardcoded `kind` checks
- ensure runtime instances in the same operator-facing category can share one stable interaction model where intended, starting with database-like kinds
- move instance hidden/advanced/conditional field behavior into template metadata where practical
- add connector default endpoint protocol guidance and mismatch warnings without blocking save
- keep backend runtime interpretation unchanged in principle: frontend collects normalized inputs, backend decides final protocol/auth wiring
- add or update tests for the new metadata contract and UI behavior

### Out of Scope

- redesigning every resource kind into a brand-new visual layout
- removing every last resource-specific branch in one story
- redesigning `Servers` into a template-driven system
- changing persistence shape or runtime config loaders
- introducing a separate frontend template file format

## Design Decision

Resource `Template` remains the backend source of truth, but it is now treated as **definition metadata**, not as a narrow field-only schema.

### Connectors

Connectors already consume the first metadata slice:

- `authPresentation`
- `endpointShape`
- `endpointScheme`
- field-level `options`
- field-level `showWhen`

### Runtime Instances

Runtime instance templates now grow a matching UI-driving contract.

#### Template-level

- `layoutPreset`
  - examples: `database_connection`
- `endpointShape`
  - examples: `url`, `host_port`
- `defaultPort`
  - examples: `3306`, `5432`
- `credentialPresentation`
  - examples: `secret_or_inline`, `reference_only`, `none`
- `credentialLabel`
  - examples: `password`, `credential`
- `defaultProtocolHint`
  - examples: `https`, `http`, `socks5`

#### Field-level

- `advanced`
  - marks fields that should stay behind advanced toggles by default
- `hidden`
  - marks fields that should stay internal in the form model
- `showWhen`
  - conditional visibility based on another field value

## Acceptance Criteria

1. Connector template JSON returned by `/api/connectors/templates` continues to include the metadata fields already introduced in the previous slice.
2. Runtime instance template JSON returned by `/api/instances/templates` includes the new metadata fields when defined.
3. The runtime instance shared form layer uses template metadata rather than hardcoded `kind` checks for:
   - database host/port layout
   - default database ports
   - secret-or-inline credential flow
   - SSL layout and conditional certificate field visibility
   - hidden profile fields such as engine markers
4. Database-like runtime instances can share one host/port/username/password-oriented layout through template metadata instead of per-kind frontend branching.
5. Connector URL-style forms auto-apply the template default protocol when operators omit a scheme, and show a non-blocking warning when the typed scheme differs from the template default.
6. Runtime instance create/edit flows for at least `mysql-compatible`, `postgres-compatible`, `redis-compatible`, and `kafka-compatible` continue to work.
7. Existing connector create/edit flows for at least `proxy`, `smtp`, `registry`, and generic token-style integrations continue to work, including edit-mode save.
8. Frontend regression tests cover the metadata-driven runtime instance and connector behavior.
9. `make build` passes and touched tests pass.

## Implementation Notes

This story remains an incremental delivery. It establishes a reusable metadata contract across multiple Resource families and consumes it in the highest-value places first.