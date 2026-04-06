# Story 8.5: Endpoints to Connectors Refactor

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: proposed
**Depends on**: Story 8.1

## User Story

As an administrator,
I want endpoint-style external integrations to appear as Connectors,
so that AppOS uses one clear home for reusable external capability access instead of the narrower `endpoints` concept.

## Goal

Refactor the current `endpoints` resource family into `connectors` while preserving existing REST API, webhook, and MCP use cases.

## In Scope

- rename the product concept from `Endpoints` to `Connectors`
- evolve the backend resource model from `endpoints` toward `connectors`
- preserve existing use cases for REST, webhook, and MCP targets
- keep secret-backed auth handling intact
- update resource hub/navigation language accordingly

## Out of Scope

- introducing every future connector template in one story
- provider-account-backed connector flows for all platforms
- migrating `instance` families into connectors
- self-hosted service-instance management

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
3. Secret-backed auth handling remains intact and continues to use secret references/relations rather than inline plaintext credentials.
4. New stories use connector terminology and target connector route/collection names.
5. The refactor explicitly does not absorb `instance` families such as databases, object storage dependencies, or model-service instances.
6. Migration direction for old endpoint routes and frontend pages is documented.

## Tasks / Subtasks

- [ ] Task 1: Backend — domain and route migration plan
  - [ ] 1.1 Define canonical connector collection and route naming
  - [ ] 1.2 Define transition strategy from existing endpoint routes
  - [ ] 1.3 Ensure auth and secret-binding behavior remain stable

- [ ] Task 2: Frontend — product terminology migration
  - [ ] 2.1 Rename resource-hub and page labels from `Endpoints` to `Connectors`
  - [ ] 2.2 Preserve existing list/create/edit behavior during route migration
  - [ ] 2.3 Keep REST / Webhook / MCP creation flows available

- [ ] Task 3: Documentation — family boundary
  - [ ] 3.1 Document that connectors are capability-access resources
  - [ ] 3.2 Document that service-like dependencies belong to `Service Instances`, not connectors
  - [ ] 3.3 Document that future connector templates may expand beyond REST / Webhook / MCP

## Notes

- This story is both a naming refactor and a semantic boundary refactor.
- The primary success condition is eliminating the long-term drift caused by the narrower `endpoint` label while preserving backward-compatible migration options.