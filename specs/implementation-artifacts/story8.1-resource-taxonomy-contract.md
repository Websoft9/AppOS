# Story 8.1: Resource Taxonomy Contract

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: proposed
**Depends on**: Epic 8, [specs/adr/resource-taxonomy-instance-connector.md](specs/adr/resource-taxonomy-instance-connector.md)

## User Story

As a product and engineering team,
I want one canonical taxonomy for long-lived resources,
so that frontend navigation, backend domains, settings references, and future migrations all use the same language and ownership rules.

## Goal

Turn the resource taxonomy ADR into an explicit implementation contract for naming, route targets, resource-family boundaries, and migration decisions.

## In Scope

- canonical product labels: `Servers`, `Service Instances`, `AI Providers`, `Platform Accounts`, `Connectors`
- canonical backend terms: `server`, `instance`, `ai_provider`, `provider_account`, `connector`
- classification rules for ambiguous families such as `llm`, `s3`, and `registry`
- route and collection target names for future work
- explicit boundary between resources and settings ownership

## Out of Scope

- backend CRUD implementation for `instances`
- LLM data migration itself
- endpoint-to-connector route refactor itself
- resource hub UI implementation

## Contract

### Product Labels

| Backend term | Product label |
| --- | --- |
| `server` | `Servers` |
| `instance` | `Service Instances` |
| `ai_provider` | `AI Providers` |
| `provider_account` | `Platform Accounts` |
| `connector` | `Connectors` |

### Target Route Direction

| Family | Target path |
| --- | --- |
| `server` | `/api/servers` |
| `instance` | `/api/instances` |
| `ai_provider` | `/api/ai-providers` |
| `provider_account` | `/api/provider-accounts` |
| `connector` | `/api/connectors` |

### Classification Rules

| Object | Canonical family |
| --- | --- |
| third-party RDS | `instance` |
| object storage used as long-lived app dependency | `instance` |
| current settings-owned LLM provider configuration | `ai_provider` |
| OpenAI or Anthropic access | `ai_provider` |
| Ollama endpoint access consumed by AppOS | `ai_provider` |
| MCP endpoint access | `connector` |
| DNS automation target | `connector` |
| SMTP delivery target | `connector` |
| cloud or source-control account | `provider_account` |

## Acceptance Criteria

1. Epic 8 and the companion ADR use the same five-family taxonomy and label mapping.
2. Product/UI label `Platform Accounts` is explicitly mapped to backend term `provider_account`.
3. Product/UI label `Service Instances` is explicitly mapped to backend term `instance`.
4. Product/UI label `AI Providers` is explicitly mapped to backend term `ai_provider`.
5. The target route direction for all five families is documented and treated as canonical for new stories.
6. `settings` is explicitly documented as a reference layer rather than canonical owner for long-lived business resources.
7. `llm`, `s3`, `registry`, and `mcp` have documented classification rules to avoid story-level drift.

## Tasks / Subtasks

- [ ] Task 1: Documentation alignment
  - [ ] 1.1 Update Epic 8 Phase 2 terminology and route direction
  - [ ] 1.2 Update companion ADR terminology and product-label mapping
  - [ ] 1.3 Mark any superseded resource-taxonomy drafts as non-authoritative

- [ ] Task 2: Taxonomy contract publication
  - [ ] 2.1 Define the canonical five-family matrix
  - [ ] 2.2 Document the product-label to backend-term mapping
  - [ ] 2.3 Document target route names for future implementation stories

- [ ] Task 3: Ambiguous object classification
  - [ ] 3.1 Freeze LLM current-state classification as `ai_provider`
  - [ ] 3.2 Freeze object storage dependency classification as `instance`
  - [ ] 3.3 Freeze managed database dependency classification as `instance`
  - [ ] 3.4 Freeze MCP classification as `connector`

## Notes

- This story is intentionally documentation-heavy because it prevents the next backend stories from implementing conflicting ownership models.
- The contract should remain stable even if individual migration stories ship incrementally.