# Story 30.3: Assets UI

**Epic**: Epic 30 - Assets
**Status**: Proposed | **Priority**: P2 | **Depends on**: Story 30.2

## Objective

Deliver the first operator-facing Assets surface so users can manage shared technical assets without exposing internal modeling complexity.

## Scope

- add an Assets list page
- add create and edit flows
- show assets as `File` or `Folder` in the UI
- support phase-1 types `script` and `skill`
- keep the UI generic so future types can be added without redesigning the model

## Acceptance Criteria

1. The UI provides an Assets list surface that shows at least name, type, and whether the asset is a file or folder.
2. The create and edit forms let the operator manage `script` and `skill` assets without exposing internal enum names such as `storage_kind` or `source_kind` directly.
3. The UI presents storage shape using user-facing labels `File` and `Folder`.
4. The UI supports both phase-1 shapes: a single-file asset flow and a folder-based asset flow.
5. The UI uses the Assets API contract from Story 30.2 without embedding domain-specific logic for Terminal, AI Chat, or future Automation.
6. Frontend tests cover list rendering plus at least one create or edit flow for each of the two phase-1 asset types.

## Out of Scope

- execution UX
- scheduling UX
- advanced diff or version UX
- consumer-specific entry flows from Terminal or AI Chat