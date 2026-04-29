# Story 29.3: Server Software Operational Surface

**Epic**: Epic 29 - Software Delivery
**Status**: in-progress | **Priority**: P1 | **Depends on**: Story 29.1, Story 29.2

## Objective

Expose one compact server-scoped operational surface where operators can inspect installed software state, understand readiness issues, and trigger supported lifecycle actions without leaving the Server Detail experience.

## Reorganization Note

This story replaces and expands the operator-facing parts of Story 29.6 Surface.

## Scope

- keep the operational UI inside Server Detail as a `Software` tab
- split the tab into `Prerequisites` and `Addons list`
- keep `docker` as the only prerequisite component in the first rollout
- render the remaining catalog-backed server components under `Addons list`
- show installed state, detected version, verification state, readiness issues, and latest action summary
- render only actions supported by the component metadata and current state
- include uninstall when the component contract marks it as supported
- keep the surface diagnostic-first and intentionally small

## UX Contract

Navigation:

- keep this surface inside the existing Server Detail tab set
- do not create a new standalone navigation family for server operations

Presentation:

- `Prerequisites` appears first and answers whether the server satisfies the platform baseline
- `Addons list` appears second and preserves the compact operational inventory view for all other managed host components
- status should remain scannable before opening any detail drawer
- readiness issues should be visible inline or through a compact expandable detail region
- in-progress operations should disable conflicting actions and show current phase feedback

Actions:

- supported actions derive from `available_actions`
- expected lifecycle set is `install`, `upgrade`, `verify`, `reinstall`, `uninstall`
- action labels must stay operational and explicit, not marketing-style

## UI Contract

### `Prerequisites`

First rollout rules:

- only `docker` appears in this group
- this group exists to answer platform readiness, not to duplicate the full addon inventory

Show for each prerequisite:

- label
- short role statement
- readiness status
- short impact statement when missing or degraded
- one primary corrective action derived from backend-supported actions

Do not show in this group:

- template kind
- last activity history
- the full lifecycle action set
- generic package-manager detail

### `Addons list`

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

For this refinement, `docker` is the only platform-gating prerequisite. Other managed server software remains in the addon inventory group unless a future story explicitly promotes it.

Related boundary note:

- if Server Detail later consumes monitor-backed Docker container telemetry, that read-model and UI behavior belongs to Story `28.6`, not this story
- this story remains responsible for software operational surface structure, readiness, and lifecycle action presentation rather than container telemetry design

This story should refine and complete that operational surface against the new lifecycle contract instead of inventing a parallel UI.

## Tasks / Subtasks

- [ ] Task 1: Align frontend types and action rendering with the reorganized contract
	- [x] 1.1 ensure `available_actions` can drive all supported lifecycle buttons, including uninstall when applicable
	- [ ] 1.2 keep action enablement tied to in-progress state and backend truth
	- [x] 1.3 keep version, verification, and last-action rendering consistent across rows
- [ ] Task 2: Complete server detail operational UX
	- [x] 2.1 preserve tab placement inside Server Detail
	- [x] 2.2 render readable readiness issues and degraded-state context
	- [x] 2.3 show accepted, running, succeeded, and failed action feedback clearly
	- [ ] 2.4 add a `Prerequisites` section with Docker as the only first-rollout entry
	- [ ] 2.5 keep the existing operational table as `Addons list` for the remaining components
- [x] Task 3: Keep server-scope boundaries explicit
	- [x] 3.1 do not mix AppOS-local inventory into this surface
	- [x] 3.2 point discovery use cases to Supported Software rather than overloading this tab
	- [x] 3.3 keep capability and inventory diagnostics centered on the selected server only
- [ ] Task 4: Validate with focused frontend tests
	- [ ] 4.1 row rendering and action-state tests
	- [ ] 4.2 readiness and degraded-state presentation tests
	- [ ] 4.3 uninstall-button visibility tests when catalog metadata supports it

## Current Gaps

- action buttons are not yet trimmed by readiness-aware backend truth; they mainly follow in-flight state and raw `available_actions`
- frontend tests do not yet explicitly cover uninstall visibility or readiness-driven disablement

## Guardrails

- no separate package-center UI
- no server-selector inside the page itself; scope comes from current Server Detail context
- no component-specific layouts unless the entire shared row model fails
- no hidden destructive action wording; uninstall must remain explicit and controlled

## Acceptance Criteria

- the Server Detail `Software` tab is split into `Prerequisites` and `Addons list`
- `docker` is shown as the only prerequisite component in the first rollout
- the prerequisite section makes it clear whether the server satisfies the platform baseline and what to do when Docker is missing or degraded
- operators can understand current installed state, readiness, and recent action outcome without leaving the tab
- lifecycle actions shown in the UI reflect backend-supported actions instead of hard-coded per-component assumptions
- in-progress and terminal action feedback is clear enough to prevent accidental duplicate operations
- the surface stays server-scoped and does not drift into a support catalog or local inventory page

## Notes

- this story is the primary operator workflow once a server exists
- if catalog discovery and server operations feel mixed together, the UI is doing too much and should be simplified again