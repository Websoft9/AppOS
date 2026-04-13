# Story 8.2a: AI Provider Backend Foundation

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: proposed
**Depends on**: Story 8.1, Story 8.2

## User Story

As an administrator,
I want a canonical AI Provider backend foundation,
so that AppOS can manage hosted and local provider definitions as first-class resources instead of hiding them in Settings or generic Connectors.

## Goal

Introduce a brand-new `ai_providers` resource family with a registration-only backend domain, template-aware profiles, and authenticated CRUD APIs.

This story establishes the clean-slate canonical model first. It does not make AppOS responsible for installing or operating model runtimes.

## In Scope

- create a new `ai_providers` collection and backend domain model
- define minimum provider identity semantics for hosted and local provider endpoints
- add template-aware AI provider profiles similar to the existing resource template approach
- expose authenticated list/get/template routes and superuser-only mutation routes
- keep optional secret binding available for provider auth and future model defaults
- support provider-account linkage when a provider depends on a cloud/platform identity

## Out of Scope

- migrating every legacy connector record into `ai_providers`
- Ollama installation, migration, model pulling, or runtime lifecycle management
- generic agent, prompt, or workflow orchestration
- model catalog sync, quota tracking, or usage analytics
- frontend IA redesign beyond the minimum route and create-surface support required by dependent stories

## Minimum AI Provider Semantics

An `ai_provider` is a reusable provider definition for where AppOS obtains model capability.

It is not:

1. a generic external capability connector such as SMTP, DNS, webhook, or MCP
2. a managed model runtime that AppOS installs or operates
3. a platform account or tenant boundary
4. an inline app-only payload

## Minimum Canonical Field Set

| Field | Purpose |
| --- | --- |
| `name` | display name |
| `kind` | provider kind such as `hosted_llm` or `local_llm` |
| `template_id` | built-in profile id under the chosen kind |
| `endpoint` | provider base URL or reachable local endpoint |
| `credential` | optional secret relation for API key or token auth |
| `provider_account` | optional platform-account relation |
| `config` | non-sensitive provider-specific configuration |
| `description` | human description |

## Initial Classification Rules

| Object | Canonical family |
| --- | --- |
| OpenAI | `ai_provider` |
| Anthropic | `ai_provider` |
| OpenRouter | `ai_provider` |
| Ollama endpoint consumed by AppOS | `ai_provider` |
| MCP server | `connector` |

## Template Metadata Rules

`ai_providers` template metadata is intentionally split into three layers:

1. `category` is the product-facing discovery group used for navigation and onboarding, such as `hosted` or `local`.
2. `kind` is the canonical resource identity and must stay stable for backend logic, such as `hosted_llm` or `local_llm`.
3. `template_id` is a profile under one `kind`, such as `openai`, `anthropic`, `openrouter`, or `ollama`.

Naming rules:

1. `category` must never replace `kind` as the identity axis.
2. `template_id` must stay inside one `kind` family.
3. Local provider endpoints that AppOS only consumes still belong to `ai_providers`, not `instances`.

## Acceptance Criteria

1. A new canonical `ai_providers` backend domain exists under `domain/resource/aiproviders` or an equivalently named package that clearly maps to the `ai_provider` family.
2. A new `ai_providers` collection exists with the minimum canonical field set for registration-only provider objects.
3. The API exposes `/api/ai-providers` CRUD plus template discovery routes.
4. Template-aware validation exists so a `template_id` must belong to the selected provider `kind`.
5. Secret binding remains relation-based and optional; no inline plaintext credential ownership is introduced.
6. Ollama-style local endpoints are supported as provider records without implying runtime management responsibility.
7. Automated tests cover migration, persistence, and route behavior.

## Tasks / Subtasks

- [ ] Task 1: Freeze the clean-slate AI Provider contract
  - [ ] 1.1 Define minimum registration-only AI Provider semantics and boundaries
  - [ ] 1.2 Define minimum canonical field set and route naming
  - [ ] 1.3 Define template-aware profile strategy for hosted and local providers

- [ ] Task 2: Implement backend AI Provider domain and storage
  - [ ] 2.1 Add `domain/resource/aiproviders` model, service, repository contract, errors, and templates
  - [ ] 2.2 Add PocketBase persistence repository and collection migration for `ai_providers`
  - [ ] 2.3 Enforce template/kind validation and optional secret-reference validation

- [ ] Task 3: Expose API and verify behavior
  - [ ] 3.1 Add `/api/ai-providers` list/get/create/update/delete and template routes
  - [ ] 3.2 Add route, persistence, and migration tests
  - [ ] 3.3 Run targeted backend test suites to verify the story end-to-end

## Notes

- This story creates the independent family foundation needed before AppOS can fully separate AI Provider UX from generic Connectors.
- The route should use the product-facing plural `ai-providers`, while backend code may use either `ai_provider` or `aiprovider` naming as long as the mapping is explicit and consistent.
- Provider-style Ollama access belongs here only because AppOS is consuming an existing endpoint, not operating the runtime.