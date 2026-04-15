# Story 29.4: Surface

**Epic**: Epic 29 - Server Base
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 29.2, Story 29.3

## Objective

Expose one minimal server-scoped surface for server base management.

## Scope

- add a server base panel or tab on server detail
- show template-backed component state, version, last result, and available actions
- keep the surface diagnostic-first and small

## UI Contract

- one server-scoped panel or tab
- one row or card per component
- rows/cards are rendered from catalog entries
- actions limited to `Install`, `Upgrade`, `Verify`
- feedback limited to current state, version, last result, and in-progress state

## Tasks / Subtasks

- [ ] Task 1: Add frontend API helpers
	- [ ] 1.1 list server base components
	- [ ] 1.2 read component detail
	- [ ] 1.3 invoke install / upgrade / verify
- [ ] Task 2: Add server detail surface
	- [ ] 2.1 render compact component list
	- [ ] 2.2 render action buttons with loading and error states
	- [ ] 2.3 render last result and version summary
- [ ] Task 3: Add frontend validation
	- [ ] 3.1 auth and action feedback handling
	- [ ] 3.2 component-state rendering tests

## Guardrails

- no extra navigation tree
- no advanced settings editor
- no package repository or channel management UI

## Acceptance Criteria

- [ ] operators can inspect all managed base components in one place
- [ ] operators can trigger install, upgrade, or verify without switching surfaces
- [ ] action feedback is explicit and readable
- [ ] the UI does not expand into a generic package center
- [ ] the UI renders from catalog/template metadata without component-specific screen forks

## Notes

- prefer one compact list or card stack
- do not add advanced configuration in this story