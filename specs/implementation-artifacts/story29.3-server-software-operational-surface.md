# Story 29.3: Server Software Operational Surface

**Epic**: Epic 29 - Software Delivery
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 29.1, Story 29.2

## Objective

Expose one compact server-scoped operational surface where operators can inspect installed software state, understand readiness issues, and trigger supported lifecycle actions without leaving the Server Detail experience.

## Reorganization Note

This story replaces and expands the operator-facing parts of Story 29.6 Surface.

## Scope

- keep the operational UI inside Server Detail as a `Software` tab
- render one row per catalog-backed server component
- show installed state, detected version, verification state, readiness issues, and latest action summary
- render only actions supported by the component metadata and current state
- include uninstall when the component contract marks it as supported
- keep the surface diagnostic-first and intentionally small

## UX Contract

Navigation:

- keep this surface inside the existing Server Detail tab set
- do not create a new standalone navigation family for server operations

Presentation:

- one compact list or stacked cards with one entry per component
- status should remain scannable before opening any detail drawer
- readiness issues should be visible inline or through a compact expandable detail region
- in-progress operations should disable conflicting actions and show current phase feedback

Actions:

- supported actions derive from `available_actions`
- expected lifecycle set is `install`, `upgrade`, `verify`, `repair`, `uninstall`
- action labels must stay operational and explicit, not marketing-style

## UI Contract

Show for each component:

- label
- component key
- installed state
- detected version and packaged version when known
- verification state
- readiness issue summary
- latest action result and timestamp when available
- action buttons for currently supported lifecycle actions

Do not show:

- product-discovery catalog prose beyond a short description
- advanced template editor or command editor
- generic package-manager controls
- AppOS-local software inventory mixed into the server tab

## Technical Context

Current implementation anchor points:

- `web/src/components/servers/ServerSoftwarePanel.tsx`
- `web/src/routes/_app/_auth/resources/servers.tsx`
- `web/src/lib/software-api.ts`
- `backend/domain/routes/software.go`

Current repo behavior already validates the basic interaction pattern:

- server detail already hosts a `Software` tab
- rows already render from backend component state
- action buttons already follow backend `available_actions`

This story should refine and complete that operational surface against the new lifecycle contract instead of inventing a parallel UI.

## Tasks / Subtasks

- [ ] Task 1: Align frontend types and action rendering with the reorganized contract
	- [ ] 1.1 ensure `available_actions` can drive all supported lifecycle buttons, including uninstall when applicable
	- [ ] 1.2 keep action enablement tied to in-progress state and backend truth
	- [ ] 1.3 keep version, verification, and last-action rendering consistent across rows
- [ ] Task 2: Complete server detail operational UX
	- [ ] 2.1 preserve tab placement inside Server Detail
	- [ ] 2.2 render readable readiness issues and degraded-state context
	- [ ] 2.3 show accepted, running, succeeded, and failed action feedback clearly
- [ ] Task 3: Keep server-scope boundaries explicit
	- [ ] 3.1 do not mix AppOS-local inventory into this surface
	- [ ] 3.2 point discovery use cases to Supported Software rather than overloading this tab
	- [ ] 3.3 keep capability and inventory diagnostics centered on the selected server only
- [ ] Task 4: Validate with focused frontend tests
	- [ ] 4.1 row rendering and action-state tests
	- [ ] 4.2 readiness and degraded-state presentation tests
	- [ ] 4.3 uninstall-button visibility tests when catalog metadata supports it

## Guardrails

- no separate package-center UI
- no server-selector inside the page itself; scope comes from current Server Detail context
- no component-specific layouts unless the entire shared row model fails
- no hidden destructive action wording; uninstall must remain explicit and controlled

## Acceptance Criteria

- the Server Detail `Software` tab shows all managed server-target components in one compact operational surface
- operators can understand current installed state, readiness, and recent action outcome without leaving the tab
- lifecycle actions shown in the UI reflect backend-supported actions instead of hard-coded per-component assumptions
- in-progress and terminal action feedback is clear enough to prevent accidental duplicate operations
- the surface stays server-scoped and does not drift into a support catalog or local inventory page

## Notes

- this story is the primary operator workflow once a server exists
- if catalog discovery and server operations feel mixed together, the UI is doing too much and should be simplified again