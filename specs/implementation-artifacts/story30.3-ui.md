# Story 30.3: Assets UI

**Epic**: Epic 30 - Assets
**Status**: Proposed | **Priority**: P2 | **Depends on**: Story 30.2

## Objective

Deliver the first operator-facing Assets surface so users can manage shared technical assets without exposing internal modeling complexity.

## Scope

- add an Assets list page
- add create and edit flows
- add content preview for phase-1 assets
- show assets as `File` or `Folder` in the UI
- support phase-1 types `script` and `skill`
- keep the UI generic so future types can be added without redesigning the model
- let script operators manage `language`, `content`, and optional `reference`
- simplify script authoring into `Metadata`, `Content`, and collapsed `Advanced` sections
- support `Reference URL + Pull` and `Script Content + Upload` in the script flow
- let skill operators manage folder contents, GitHub source metadata, folder upload, and file-tree editing

## Minimum UI Slice

- list
- create
- edit
- content preview

## Acceptance Criteria

1. The UI provides an Assets list surface that shows at least name, type, and whether the asset is a file or folder.
2. The create and edit forms let the operator manage `script` and `skill` assets without exposing internal enum names directly.
3. The UI presents storage shape using user-facing labels `File` and `Folder`.
4. The UI supports both phase-1 shapes: a single-file asset flow and a folder-based asset flow.
5. The UI includes phase-1 content preview for assets without introducing execution controls.
6. The UI uses the Assets API contract from Story 30.2 without embedding domain-specific logic for Terminal, AI Chat, or future Automation.
7. Frontend tests cover list rendering plus at least one create or edit flow for each of the two phase-1 asset types.
8. The scripts UI includes a `language` field and enforces that `content` or `reference` is provided.
9. The scripts UI does not expose editable script `path` or `entrypoint`; those are derived or hidden from operators.
10. The scripts UI keeps script inputs in a single-column layout to reduce authoring friction.
11. The skills UI is folder-first, not textarea-first, and uses a file-editor surface in edit mode.
12. The skills UI supports GitHub import and folder upload as the two phase-1 source entry paths.
13. Frontend tests cover at least one script content-preview path.

## Out of Scope

- execution UX
- scheduling UX
- advanced diff or version UX
- multi-version script UX
- consumer-specific entry flows from Terminal or AI Chat