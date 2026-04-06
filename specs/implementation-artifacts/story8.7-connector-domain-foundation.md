# Story 8.7: Connector Domain Foundation

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: proposed
**Depends on**: Story 8.1, Story 8.2, Story 8.5

## User Story

As a platform engineer,
I want a canonical connector domain,
so that LLM providers and endpoint-style external integrations share one reusable backend model instead of continuing as separate ad hoc resource shapes.

## Goal

Define and introduce the minimum viable `connector` domain model for AppOS.

This story creates the reusable base shape and canonical ownership rules. It is not yet responsible for every future connector kind or a fully generic template engine.

## Why Now

AppOS already has two converging resource families:

1. current LLM provider configuration that has been moved out of `settings`
2. current `endpoints` resources that are being renamed and narrowed toward `connectors`

Without a shared connector base, both families will continue evolving in parallel and create duplicate logic for secret binding, endpoint handling, labels, grouping, and migration.

## In Scope

- define canonical backend connector concept and minimum field set
- define canonical product meaning of a connector
- introduce a reusable connector data model compatible with current LLM provider configuration
- introduce a reusable connector data model compatible with current endpoint-style integrations
- define migration compatibility rules from existing LLM and endpoint shapes

## Out of Scope

- every future connector template and vendor-specific field
- provider-account-backed flows for every platform
- self-hosted service inventory, which belongs to `Service Instances`
- full connector test framework
- advanced capability registry or quota/usage tracking

## Minimum Connector Semantics

A `connector` is a reusable connection configuration to an external capability.

It is not:

1. a concrete service instance dependency
2. a platform account or tenant object
3. a one-off inline payload owned only by settings

## Minimum Canonical Field Set

The minimum shared connector model should support the following logical fields:

| Field | Purpose |
| --- | --- |
| `name` | display name |
| `kind` | connector family such as `llm`, `webhook`, `mcp`, `smtp`, `dns`, `registry` |
| `template_id` | template or vendor hint such as `openai`, `anthropic`, `generic-rest`, `generic-webhook` |
| `endpoint` | primary URL or base endpoint |
| `auth_scheme` | auth mode hint such as `none`, `api_key`, `bearer`, `basic` |
| `credential` or `secret_refs` | secret binding for sensitive auth data |
| `config` | non-sensitive template-specific configuration |
| `description` | human description |
| `groups` | standard resource grouping |

The exact physical storage model may use one secret relation or a future richer `secret_refs` shape, but the logical contract must preserve reusable secret binding.

## Compatibility Mapping

### Current LLM shape -> Connector

| Current LLM field | Target connector meaning |
| --- | --- |
| `name` | `template_id` or display name, depending on vendor strategy |
| `endpoint` | `endpoint` |
| `apiKey` | `credential` or `secret_refs` |
| resource family | `kind = llm` |

### Current Endpoint shape -> Connector

| Current endpoint field | Target connector meaning |
| --- | --- |
| `type=rest` | `kind = rest_api` or `kind = http` with template semantics |
| `type=webhook` | `kind = webhook` |
| `type=mcp` | `kind = mcp` |
| `url` | `endpoint` |
| `auth_type` | `auth_scheme` |
| `credential` | `credential` |
| `extra` | `config` |

## Acceptance Criteria

1. A canonical connector domain concept is documented and used by new resource stories.
2. The minimum shared connector field set is defined and sufficient for current LLM providers and current endpoint-style integrations.
3. The story explicitly distinguishes connector semantics from `Service Instances` semantics.
4. A migration mapping exists for both current LLM provider shape and current endpoint shape.
5. Secret binding remains a first-class part of the connector model and is not replaced with inline plaintext fields.
6. The story does not require a full template engine before the connector domain can exist.

## Tasks / Subtasks

- [ ] Task 1: Define connector domain contract
  - [ ] 1.1 Freeze connector meaning and boundary relative to `instance` and `provider_account`
  - [ ] 1.2 Freeze the minimum logical field set
  - [ ] 1.3 Freeze the target route and collection naming direction

- [ ] Task 2: Define compatibility with current resources
  - [ ] 2.1 Map current LLM provider shape into connector semantics
  - [ ] 2.2 Map current endpoint resource shape into connector semantics
  - [ ] 2.3 Identify which existing fields remain transitional versus canonical

- [ ] Task 3: Define secret-handling and config rules
  - [ ] 3.1 Keep secret binding canonical through relation or secret-ref modeling
  - [ ] 3.2 Keep non-sensitive per-kind settings under `config`
  - [ ] 3.3 Explicitly exclude plaintext credential ownership in connector records

- [ ] Task 4: Prepare implementation follow-up
  - [ ] 4.1 Identify backend package target under `domain/resource/connectors`
  - [ ] 4.2 Identify target frontend resource page and hub label updates
  - [ ] 4.3 Identify migration dependencies for LLM and endpoint stories

## Notes

- This story is the reusable base needed before a generic connector surface can replace the current point solutions.
- The story intentionally prefers a small stable contract over a premature fully generic template system.