# Story 8.5: Connector Foundation

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: proposed
**Depends on**: Story 8.1

## User Story

As an administrator,
I want endpoint-style external integrations to appear as Connectors,
so that AppOS uses one clear home for reusable external capability access instead of the narrower `endpoints` concept.

## Goal

Refactor the current `endpoints` resource family into `connectors` and establish a canonical connector backend foundation while preserving existing REST API, webhook, and MCP use cases.

## In Scope

- rename the product concept from `Endpoints` to `Connectors`
- evolve the backend resource model from `endpoints` toward `connectors`
- define the canonical backend connector concept and minimum field set
- preserve existing use cases for REST, webhook, and MCP targets
- keep secret-backed auth handling intact
- update resource hub/navigation language accordingly

## Out of Scope

- introducing every future connector template in one story
- provider-account-backed connector flows for all platforms
- migrating `instance` families into connectors
- self-hosted service-instance management

## Minimum Connector Semantics

A `connector` is a reusable connection configuration to an external capability.

It is not:

1. a concrete service instance dependency
2. an AI provider record
3. a platform account or tenant object
4. a one-off inline payload owned only by settings

## Minimum Canonical Field Set

| Field | Purpose |
| --- | --- |
| `name` | display name |
| `kind` | connector family such as `webhook`, `mcp`, `smtp`, `dns`, `registry`, or `http` |
| `template_id` | template or vendor hint such as `generic-webhook` or `generic-rest` |
| `endpoint` | primary URL or base endpoint |
| `auth_scheme` | auth mode hint such as `none`, `api_key`, `bearer`, `basic` |
| `credential` or `secret_refs` | secret binding for sensitive auth data |
| `config` | non-sensitive template-specific configuration |
| `description` | human description |
| `groups` | standard resource grouping |

## Current Model

Current endpoint resources carry this shape:

| Field | Meaning |
| --- | --- |
| `name` | display name |
| `type` | current target kind: `rest` / `webhook` / `mcp` |
| `url` | target URL |
| `auth_type` | current auth hint |
| `credential` | optional secret relation |
| `extra` | non-sensitive type-specific config |
| `description` | human description |

The story keeps this functional shape where needed, but changes the canonical product and domain meaning from `endpoint` to `connector`.

## Acceptance Criteria

1. `Endpoints` is no longer the long-term product term for this family; the canonical product label becomes `Connectors`.
2. Existing REST, webhook, and MCP target use cases remain supported during and after the refactor.
3. A canonical connector domain concept and minimum field set are defined for new work.
4. Secret-backed auth handling remains intact and continues to use secret references/relations rather than inline plaintext credentials.
5. New stories use connector terminology and target connector route/collection names.
6. The refactor explicitly does not absorb `instance` families such as databases, object storage dependencies, or model-service instances, and does not absorb `ai_provider` records.
7. Migration direction for old endpoint routes and frontend pages is documented.

## Tasks / Subtasks

- [ ] Task 1: Define connector domain contract and migration path
  - [ ] 1.1 Define canonical connector collection and route naming
  - [ ] 1.2 Define transition strategy from existing endpoint routes
  - [ ] 1.3 Freeze the minimum connector field set and secret-binding rules

- [ ] Task 2: Implement connector domain foundation
  - [ ] 2.1 Identify backend package target under `domain/resource/connectors`
  - [ ] 2.2 Keep REST, webhook, and MCP creation flows compatible through migration
  - [ ] 2.3 Ensure auth and secret-binding behavior remain stable

- [ ] Task 3: Frontend and documentation migration
  - [ ] 3.1 Rename resource-hub and page labels from `Endpoints` to `Connectors`
  - [ ] 3.2 Preserve existing list/create/edit behavior during route migration
  - [ ] 3.3 Document that connectors are capability-access resources, not `instances` or `ai_providers`

## Notes

- This story now absorbs the earlier connector-domain foundation split and is the single canonical connector story under Epic 8.
- The primary success condition is eliminating the long-term drift caused by the narrower `endpoint` label while preserving backward-compatible migration options.