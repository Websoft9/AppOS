# Story 30.4: AI System Prompt

**Epic**: Epic 30 - Assets
**Status**: Proposed | **Priority**: P2 | **Depends on**: Story 30.1, Story 30.2, Story 30.3

## Objective

Add `kind=prompt` as a simple reusable asset type for AI system prompts, with built-in starter templates and a lightweight handoff to AI Copilot.

## Scope

- extend model, API, and UI to support `kind=prompt`
- seed one protected system-managed meta prompt
- seed 5-8 built-in prompt templates for operators to reference
- let users send current prompt text to AI Copilot input for manual refinement

## Model

New constants and fields:

- `KindPrompt = "prompt"`
- `is_system` marks a protected system-managed asset
- `is_template` marks a built-in starter template
- `template_key` gives seeded prompt assets a stable identity

Prompt rules:

- `kind=prompt` always uses `storage_kind=file`
- `kind=prompt` always uses `source_kind=local`
- prompt assets do not use `language`, `script_extension`, `entrypoint`, or `reference`
- prompt content is plain text and may contain `{{var}}` placeholders

Template variables:

- phase 1 uses plain-text `{{var}}` convention only
- no variable metadata field is introduced in this story
- consumer domains decide how to resolve placeholders later

## API

Reuse existing endpoints:

- `POST /api/assets`
- `GET /api/assets`
- `GET /api/assets/{id}`
- `PUT /api/assets/{id}`
- `DELETE /api/assets/{id}`
- `GET /api/assets/{id}/content`

Prompt-specific behavior:

- create/update accepts `kind=prompt` with local `content`
- delete rejects `is_system=true` prompt assets
- no prompt `reference` pull endpoint is added

## Seed Data

The system seeds:

- 1 protected meta prompt used for system-prompt creation guidance
- 5-8 built-in starter templates visible in the prompt list

Rules:

- the meta prompt is visible, editable, and not deletable
- starter templates are visible in the prompt list and available as create-time references
- starter templates are regular assets unless later policy says otherwise

## UI

Prompt family page:

- list prompt assets beside scripts and skills
- show badges for `System` and `Template`
- hide source/reference controls because prompts are local-only

Prompt create/edit flow:

1. User starts from blank or picks one of the built-in templates
2. User edits prompt content directly
3. User may click `Send to AI Copilot`
4. App opens AI Copilot with the current prompt text prefilled in the message input
5. User finishes the iterative refinement manually in Copilot, then returns and saves the final prompt asset

This story does not embed streaming AI authoring inside the prompt page.

## Out of Scope

- binding a prompt asset to AI sessions or providers
- automated prompt rewrite inside the assets page
- remote prompt download via `reference`

## Acceptance Criteria

1. `kind=prompt` assets can be created, read, updated, and deleted through the existing assets API.
2. Prompt assets are constrained to local single-file content and reject `reference` input.
3. One protected system-managed meta prompt is always seeded and cannot be deleted.
4. At least 5 built-in prompt templates are seeded and visible in the prompt list.
5. The prompt create/edit flow lets users start from a built-in template.
6. The prompt page provides a `Send to AI Copilot` action that prefills the Copilot message input.
