# Story 29.5: Local Software Inventory Surface

**Epic**: Epic 29 - Software Delivery
**Status**: Proposed | **Priority**: P1 | **Depends on**: Story 29.1

## Objective

Expose one read-only AppOS-local software inventory surface so operators can inspect platform-bundled software through the same domain language used for server-target software, without mixing it into server operations.

## Reorganization Note

This story consolidates the AppOS-local slice that was previously spread across Epic 29 scope notes and the implementation follow-up attached to Story 29.6.

## Scope

- keep AppOS-local software visible as a first-class inventory surface under `Resources`
- reuse the same component language as server-target software where possible
- show truthful local installed state, versions, verification summary, and support notes
- keep the surface read-only for this epic split
- keep AppOS-local inventory separate from both server operations and supported-software discovery

## Product Positioning

This page answers:

- what software is bundled or managed inside the AppOS runtime envelope
- what version AppOS currently has locally
- whether that local component is present or degraded

This page does not answer:

- what can be installed on a remote server
- what action is currently running on a remote server
- runtime telemetry that belongs to Monitor

## API Contract

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/software/local` | list AppOS-local software inventory |
| GET | `/api/software/local/{componentKey}` | read one AppOS-local component |

Rules:

- AppOS-local routes remain read-only in this story
- DTOs should stay as close as practical to server inventory DTOs so operators do not learn two vocabularies
- local inventory should not pretend to be a server instance list

## UI Contract

Show:

- label
- component key
- installed state
- detected version and packaged version when known
- verification or health summary in Software Delivery terms
- short note describing the component's role inside AppOS

Do not show:

- remote-server action buttons
- per-server readiness
- supported-software discovery rows for components that are not locally bundled
- Monitor runtime telemetry panels

## Technical Context

Current implementation anchor points:

- `backend/domain/routes/software.go`
- `backend/domain/software/service/service.go`
- `web/src/lib/software-api.ts`
- `web/src/components/software/LocalSoftwareInventoryPage.tsx`
- `web/src/routes/_app/_auth/resources/local-software.tsx`

This page already exists in lightweight form, so the work here is to formalize and preserve its role in the new five-story split.

## Tasks / Subtasks

- [ ] Task 1: Keep the local inventory contract aligned with the shared software vocabulary
	- [ ] 1.1 normalize field naming with server inventory where possible
	- [ ] 1.2 keep local-only explanatory copy concise and platform-oriented
	- [ ] 1.3 ensure verification and installed-state semantics remain truthful
- [ ] Task 2: Preserve the product boundary for AppOS-local inventory
	- [ ] 2.1 keep navigation under `Resources`
	- [ ] 2.2 keep the page read-only in this epic split
	- [ ] 2.3 avoid mixing server operational controls into local inventory rows
- [ ] Task 3: Validate with focused backend and frontend tests
	- [ ] 3.1 route tests for list/detail behavior and literal path stability
	- [ ] 3.2 API-client tests for local inventory DTO stability
	- [ ] 3.3 page tests for read-only rendering and empty-state behavior

## Guardrails

- no server lifecycle actions on this page
- no runtime-monitoring charts or service logs
- no drift into a generic system-settings page
- no separate vocabulary for local inventory if the shared contract already covers the field

## Acceptance Criteria

- operators can inspect AppOS-local managed software from a dedicated read-only surface
- the page uses the same software-delivery language as the server inventory surface where practical
- local inventory stays separate from supported-software discovery and server-target operations
- the route and frontend contracts remain simple enough to test without remote server fixtures

## Notes

- this story keeps AppOS-local software first-class without bloating the server detail experience
- if a future epic wants local lifecycle actions, that should be a new story rather than an implicit expansion here