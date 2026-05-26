# Story 29.3: Server Components Contract

**Epic**: Epic 29 - Software Delivery
**Status**: in-progress | **Priority**: P1 | **Depends on**: Story 29.1, Story 29.2

## Objective

Define the backend and shared interaction contract that feeds the server-scoped `Components` tab.

## Reorganization Note

This story defines the canonical data, status, and action contract for the server-scoped `Components` tab. Product naming, layout, and interaction details belong to Story 20.7.

## Scope

- define which server-target components appear in `Prerequisites` versus `Addons`
- keep `docker` as the only prerequisite component in the first rollout
- define the backend truth for installed state, verification state, readiness issues, latest action summary, and supported lifecycle actions
- define the action-availability and in-flight-operation rules consumed by the UI
- keep this contract server-scoped and separate from supported-software discovery and AppOS-local inventory

## Contract

### Grouping

- the backend contract must distinguish `Prerequisites` from `Addons`
- `docker` is the only `Prerequisites` component in the first rollout
- all other server-target managed software remains in `Addons` unless a later story explicitly promotes it

### Component Fields

Each server component row must expose enough truth for the UI to render without component-specific heuristics:

- `component_key`
- `label`
- `installed_state`
- `detected_version`
- `packaged_version` when known
- `verification_state`
- `readiness` summary and issues
- `available_actions`
- latest action result and timestamp when available
- backend-resolved service and connection status fields when the component reports to AppOS

### Action Rules

- supported actions derive from `available_actions`
- expected lifecycle set is `install`, `upgrade`, `verify`, `reinstall`, `uninstall`
- unsupported actions must stay absent from the contract rather than being guessed in the UI
- one in-flight operation per component per server remains the controlling conflict rule
- action enablement must follow backend truth for operation state and readiness, not frontend-only heuristics

### Status Rules

- installed state, verification state, and readiness must remain distinct signals
- connection-aware components may expose separate `Service Status` and `AppOS Connection` values
- the frontend consumes backend-resolved status fields and must not duplicate component-specific status decision trees
- readiness issues must stay visible through the contract even when a mutating action is blocked

## Technical Context

Current implementation anchor points:

- `backend/domain/routes/software.go`
- `backend/domain/software/service/service.go`
- `backend/domain/software/projection/`
- `web/src/lib/software-api.ts`

Related boundary note:

- Story 20.7 owns tab naming, layout, wording, and interaction design
- Story 29.3 owns the server component contract that Story 20.7 renders
- monitor-backed container telemetry remains in Story `28.6`, not this story

## Tasks / Subtasks

- [ ] Task 1: Expose one stable server-components contract
	- [x] 1.1 ensure `available_actions` can drive all supported lifecycle actions, including uninstall when applicable
	- [ ] 1.2 keep action enablement tied to in-flight state and backend truth
	- [ ] 1.3 keep prerequisite-versus-addon grouping explicit in the API shape
- [ ] Task 2: Keep status semantics reviewable and reusable
	- [ ] 2.1 keep installed state, verification state, and readiness distinct
	- [ ] 2.2 expose connection-aware status fields without frontend-specific fallback logic
	- [ ] 2.3 keep latest action result and timestamp stable for selected-server rows
- [ ] Task 3: Keep scope boundaries explicit
	- [x] 3.1 do not mix AppOS-local inventory into this contract
	- [x] 3.2 do not leak supported-software discovery into server inventory responses
	- [x] 3.3 keep capability and inventory diagnostics centered on the selected server only
- [ ] Task 4: Validate with backend and contract tests
	- [ ] 4.1 route tests for grouped list/detail behavior
	- [ ] 4.2 API-client tests for action availability and status-field stability
	- [ ] 4.3 tests for readiness-aware disablement and uninstall support visibility

## Current Gaps

- action availability still leans on raw `available_actions` more than readiness-aware backend truth
- the grouped contract is not yet fully documented as backend-owned rather than UI-owned

## Guardrails

- no separate inventory contract for the same selected-server data
- no AppOS-local inventory or supported-software discovery fields in this contract
- no frontend-only status derivation that bypasses backend truth
- no hidden destructive action semantics; uninstall must remain explicit and controlled

## Acceptance Criteria

- the backend contract distinguishes `Prerequisites` and `Addons` for the selected server
- `docker` is the only prerequisite component in the first rollout
- each server component exposes installed state, verification state, readiness issues, latest action summary, and backend-supported lifecycle actions without frontend guesswork
- lifecycle actions consumed by the UI reflect backend-supported actions instead of hard-coded per-component assumptions
- in-flight and blocked action state is derivable from backend truth and prevents duplicate operations
- the contract stays server-scoped and does not drift into supported-software discovery or AppOS-local inventory

## Notes

- this story is the backend/shared contract that feeds the primary operator workflow once a server exists
- if Story 20.7 needs layout or wording changes, those changes should not force a contract rewrite here