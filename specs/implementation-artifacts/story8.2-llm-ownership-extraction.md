# Story 8.2: LLM Ownership Extraction

**Epic**: Epic 8 - Resources
**Priority**: P1
**Status**: proposed
**Depends on**: Story 8.1, Epic 13

## User Story

As an administrator,
I want LLM provider definitions to live under resource ownership instead of Settings,
so that Settings becomes a reference layer and LLM access can evolve under the canonical resource taxonomy.

## Goal

Remove canonical ownership of LLM provider configuration from `settings` and move the current provider-style shape into the `connector` family.

This story covers only provider-style LLM access such as OpenAI-compatible APIs and secret-bound remote provider configs. It does not yet introduce self-hosted model services as `instance` resources.

## In Scope

- dedicated backend API for current LLM provider resources
- migrate current settings-owned LLM provider persistence out of `settings`
- keep secret masking and preserve-on-patch semantics
- update settings/frontend behavior so LLM provider management no longer relies on `/api/settings/entries/llm-providers`
- document that future self-hosted model services belong to `instances`, not this story

## Out of Scope

- full `connectors` generic framework
- self-hosted model-service inventory
- model discovery, quota, usage, or per-model runtime semantics
- advanced provider-account linkage

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

During this story, the shape may remain transitional, but canonical ownership must move away from `settings`.

## Acceptance Criteria

1. `settings` is no longer the canonical owner of LLM provider objects.
2. LLM provider CRUD no longer depends on `GET/PATCH /api/settings/entries/llm-providers` as the canonical API.
3. Secret-field masking and preserve-on-patch semantics remain intact for LLM API keys.
4. Dashboard LLM management uses the dedicated LLM resource surface instead of settings-entry transport.
5. The story explicitly documents that self-hosted model services are future `instance` work and remain out of scope.
6. Settings, if it still needs LLM defaults later, references resource identity rather than owning the full provider payload.

## Tasks / Subtasks

- [ ] Task 1: Backend — extract ownership from settings
  - [ ] 1.1 Introduce a dedicated LLM resource route surface
  - [ ] 1.2 Move validation and secretRef handling into the LLM resource domain
  - [ ] 1.3 Stop treating `llm-providers` as a canonical settings entry

- [ ] Task 2: Backend — preserve compatibility during migration
  - [ ] 2.1 Define whether a temporary compatibility path is needed
  - [ ] 2.2 Keep response masking stable for `apiKey`
  - [ ] 2.3 Keep preserve-on-patch semantics for `***` placeholders stable

- [ ] Task 3: Frontend — move off settings transport
  - [ ] 3.1 Replace settings-entry LLM API calls with the dedicated LLM route
  - [ ] 3.2 Keep the current provider-management UI behavior stable during the transition
  - [ ] 3.3 Prepare the resource-hub migration path toward `connectors`

- [ ] Task 4: Documentation — taxonomy consistency
  - [ ] 4.1 Record that current LLM provider configs are `connector` resources
  - [ ] 4.2 Record that self-hosted model services are future `instance` resources

## Notes

- This story is a taxonomy-ownership migration, not the final generic connector framework.
- A transitional LLM-specific API is acceptable if it moves ownership out of settings and preserves a clean migration path toward `connectors`.