# Story 8.2: AI Provider Foundation

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: proposed
**Depends on**: Story 8.1, Epic 13

## User Story

As an administrator,
I want AI provider definitions to live under a dedicated resource family instead of Settings,
so that Settings becomes a reference layer and AI access can evolve under the canonical resource taxonomy.

## Goal

Move canonical ownership of AI provider configuration out of `settings` and establish `ai_providers` as a first-class backend resource family.

This story covers provider-style AI access such as OpenAI-compatible APIs and local provider endpoints that AppOS only consumes, such as Ollama. It does not make AppOS responsible for installing or operating model runtimes.

## In Scope

- create a canonical `ai_providers` collection and backend domain model
- expose dedicated backend API for AI provider resources
- migrate current settings-owned LLM provider persistence out of `settings`
- keep secret masking and preserve-on-patch semantics
- support optional secret binding and optional provider-account linkage
- update settings/frontend behavior so LLM provider management no longer relies on `/api/settings/entries/llm-providers`
- document that provider-style Ollama access belongs to `ai_providers`, while runtime operation remains out of scope

## Out of Scope

- full generic AI workflow framework
- model runtime installation, migration, and lifecycle management
- model discovery, quota, usage, or per-model runtime semantics
- advanced provider-account automation
- frontend IA redesign beyond the minimum route and create-surface support required by dependent stories

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

## Target Shape

The current LLM provider shape remains provider-oriented:

```json
{
  "items": [
    {
      "name": "OpenAI",
      "endpoint": "https://api.openai.com/v1",
      "apiKey": "secretRef:..."
    }
  ]
}
```

During this story, the shape may remain transitional, but canonical ownership must move away from `settings` and into `ai_providers`.

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

1. `settings` is no longer the canonical owner of LLM provider objects.
2. A new canonical `ai_providers` backend domain exists with authenticated CRUD plus template discovery routes.
3. LLM provider CRUD no longer depends on `GET/PATCH /api/settings/entries/llm-providers` as the canonical API.
4. Secret-field masking and preserve-on-patch semantics remain intact for LLM API keys.
5. Dashboard LLM management uses the dedicated AI Provider resource surface instead of settings-entry transport.
6. The story explicitly documents that provider-style Ollama access belongs to `ai_providers` and runtime operation remains out of scope.
7. Settings, if it still needs LLM defaults later, references resource identity rather than owning the full provider payload.

## Tasks / Subtasks

- [ ] Task 1: Freeze the AI Provider contract and backend foundation
  - [ ] 1.1 Define minimum registration-only AI Provider semantics and boundaries
  - [ ] 1.2 Define minimum canonical field set and route naming
  - [ ] 1.3 Define template-aware profile strategy for hosted and local providers

- [ ] Task 2: Implement backend AI Provider domain and migrate ownership from settings
  - [ ] 2.1 Add `ai_providers` domain, storage, and routes
  - [ ] 2.2 Move validation and secretRef handling into the AI Provider resource domain
  - [ ] 2.3 Stop treating `llm-providers` as a canonical settings entry

- [ ] Task 3: Preserve compatibility during migration
  - [ ] 3.1 Define whether a temporary compatibility path is needed
  - [ ] 3.2 Keep response masking stable for `apiKey`
  - [ ] 3.3 Keep preserve-on-patch semantics for `***` placeholders stable

- [ ] Task 4: Frontend and taxonomy migration
  - [ ] 4.1 Replace settings-entry LLM API calls with the dedicated AI Provider route
  - [ ] 4.2 Keep the current provider-management UI behavior stable during the transition
  - [ ] 4.3 Record that current LLM provider configs are `ai_provider` resources, not `connector` records

## Notes

- This story now absorbs the earlier backend-foundation split and is the single canonical AI Provider story under Epic 8.
- A transitional AI-provider-specific API is acceptable if it moves ownership out of settings and preserves a clean migration path toward the dedicated `ai_provider` family.