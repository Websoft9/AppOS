# Story 29.5: Local Software Inventory Surface

**Epic**: Epic 29 - Software Delivery
**Status**: done | **Priority**: P1 | **Depends on**: Story 29.1

## Objective

Expose one read-only AppOS-local software inventory surface so operators can inspect platform-bundled software through the same domain language used for server-target software, without mixing it into server operations.

This story also absorbs the AppOS-local inventory intent that was previously described in Epic 6 `Components Inventory` and the `Installed Components` half of the old `/components` page.

## Reorganization Note

This story consolidates the AppOS-local slice that was previously spread across Epic 29 scope notes and the implementation follow-up attached to Story 29.6.

## Scope

- keep AppOS-local software visible as a first-class inventory surface under `Resources`
- reuse the same component language as server-target software where possible
- show truthful local installed state, versions, verification summary, and support notes
- keep the surface read-only for this epic split
- keep AppOS-local inventory separate from both server operations and supported-software discovery
- preserve the lightweight, admin-facing inventory feel from the old Epic 6 scope without reviving a standalone `System / Components` domain
- keep the first-read surface focused on installed composition, not lifecycle mutation, discovery catalog prose, or runtime monitoring

## Product Positioning

This page answers:

- what software is bundled or managed inside the AppOS runtime envelope
- what version AppOS currently has locally
- whether that local component is present or degraded
- when AppOS last detected the local component state

This page does not answer:

- what can be installed on a remote server
- what action is currently running on a remote server
- runtime telemetry that belongs to Monitor

## Migration Note

This story is the canonical replacement for Epic 6 local inventory requirements.

Mapping from the retired Epic 6 surface:

- Epic 6 `Installed Components` tab becomes this local-software inventory surface.
- Epic 6 detection-pipeline extensibility rules move to Story 29.1 contract and catalog rules.
- Epic 6 `Active Services` does not belong here and must stay in Epic 28 `Monitoring`.
- the retired `/components` route should not survive as a second local-inventory destination; any transition behavior should redirect or converge into this surface

## API Contract

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/software/local` | list AppOS-local software inventory |
| GET | `/api/software/local/{componentKey}` | read one AppOS-local component |

Rules:

- AppOS-local routes remain read-only in this story
- DTOs should stay as close as practical to server inventory DTOs so operators do not learn two vocabularies
- local inventory should not pretend to be a server instance list
- legacy compatibility adapters may temporarily project the old lightweight `id` / `name` / `version` / `available` / `last_detected_at` view from the canonical local-software model, but that shape is transitional rather than the long-term contract

## UI Contract

Show:

- label
- component key
- installed state
- detected version and packaged version when known
- verification or health summary in Software Delivery terms
- short note describing the component's role inside AppOS
- last detected or last updated time when available

Do not show:

- remote-server action buttons
- per-server readiness
- supported-software discovery rows for components that are not locally bundled
- Monitor runtime telemetry panels

Presentation rules:

- keep the page read-only and lightweight
- prefer a compact text-first card or dense row layout over an operational control panel
- support a high-density desktop layout for bundled software inventory while remaining readable on mobile
- do not add search, category grouping, source filters, or summary statistics in the first-pass surface
- keep operator copy admin-facing and avoid supply-chain jargon such as `SBOM` on the primary surface
- preserve responsive rendering for both desktop and mobile

State rules:

- loading, empty, and error states must be explicit
- partial detection remains a valid successful state: components may still render when version is unknown or verification is degraded
- unavailable or degraded local components should remain visible rather than being filtered out

Initial baseline intent:

- the first-pass local inventory should cover the AppOS runtime composition already managed by the platform
- typical examples include the AppOS backend, dashboard bundle, reverse proxy, supervisor/process manager, Redis, Docker tooling, Terraform CLI, Node.js, npm, bundled library/plugin artifacts, and the base runtime image
- the exact managed set remains catalog-driven rather than hard-coded in the page

## Technical Context

Current implementation anchor points:

- `backend/domain/routes/software.go`
- `backend/domain/software/service/service.go`
- `web/src/lib/software-api.ts`
- `web/src/components/software/LocalSoftwareInventoryPage.tsx`
- `web/src/routes/_app/_auth/resources/local-software.tsx`

This page already exists in lightweight form, so the work here is to formalize and preserve its role in the new five-story split.

The page should be treated as the forward path for any remaining Epic 6 `Installed Components` behavior. Do not expand or preserve the old standalone `/components` route as the canonical local inventory surface.

## Tasks / Subtasks

- [x] Task 1: Keep the local inventory contract aligned with the shared software vocabulary
	- [x] 1.1 normalize field naming with server inventory where possible
	- [x] 1.2 keep local-only explanatory copy concise and platform-oriented
	- [x] 1.3 ensure verification and installed-state semantics remain truthful
- [x] 1.4 absorb retired Epic 6 local inventory semantics into the canonical Story 29.5 contract
- [x] Task 2: Preserve the product boundary for AppOS-local inventory
	- [x] 2.1 keep navigation under `Resources`
	- [x] 2.2 keep the page read-only in this epic split
	- [x] 2.3 avoid mixing server operational controls into local inventory rows
- [x] 2.4 keep the page lightweight and non-operational rather than recreating the old two-tab `Components` workspace
- [x] Task 3: Validate with focused backend and frontend tests
	- [x] 3.1 route tests for list/detail behavior and literal path stability
	- [x] 3.2 API-client tests for local inventory DTO stability
	- [x] 3.3 page tests for read-only rendering and empty-state behavior
	- [x] 3.4 preserve explicit loading, error, empty, and partial-detection UI coverage for the local inventory surface

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
- the page is the canonical replacement for Epic 6 `Installed Components` rather than a second competing local inventory surface
- the first-pass UI remains minimal, responsive, and non-operational, with explicit loading, empty, error, and partial-detection states
- local rows remain catalog-driven and can show degraded or version-unknown components without hiding them from operators

## Notes

- this story keeps AppOS-local software first-class without bloating the server detail experience
- if a future epic wants local lifecycle actions, that should be a new story rather than an implicit expansion here
- if the old `/components` route remains temporarily for compatibility, it should eventually redirect or converge here rather than continue as a parallel product surface
- the old two-tab `Components` page should be treated as historical implementation scaffolding, not as a product pattern to preserve