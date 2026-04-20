# Story 29.6: Surface

**Epic**: Epic 29 - Software Delivery
**Status**: Review | **Priority**: P1 | **Depends on**: Story 29.4, Story 29.5

## Objective

Expose one minimal server-scoped surface for software delivery management.

## Scope

- add a software delivery panel or tab on server detail
- show template-backed component state, version, last result, and available actions
- show target readiness signals beside component state
- keep the surface diagnostic-first and small
- keep this screen limited to `server` target software; AppOS-local software is out of scope for this UI story

Follow-up note:
- AppOS-local software is now surfaced separately from Resources as a dedicated read-only inventory page; it is still intentionally excluded from the Server Detail Software tab

## UX Reference

Place the Software Delivery surface as a **"Software" tab** inside the existing Server Detail page (alongside the existing Services, Terminal, and Files tabs). Follow the same tab container pattern used by those surfaces.

Use the compact list-with-actions pattern already established in the Services tab:
- one row per component (icon, label, version badge, status chip, action buttons)
- status chip: `Installed` (green), `Not Installed` (gray), `Degraded` (amber), `Unknown` (gray)
- readiness issues shown as a tooltip or inline sub-row below the component row
- action buttons (`Install`, `Upgrade`, `Verify`, `Repair`) disabled when already in-progress or not available per `available_actions`

Do not introduce a new sidebar entry or top-level navigation item.

## UI Contract

- one server-scoped panel inside the Server Detail page Software tab
- one row per component, rendered from catalog entries
- actions limited to `Install`, `Upgrade`, `Verify`, `Repair`
- feedback limited to current state, version, last result, and in-progress state
- no AppOS-local software inventory mixed into the server detail tab

## Tasks / Subtasks

- [x] Task 1: Add frontend API helpers
	- [x] 1.1 list software components
	- [x] 1.2 read component detail
	- [x] 1.3 invoke install / upgrade / verify
- [x] Task 2: Add server detail surface
	- [x] 2.1 add Software tab to server detail page (tab container pattern)
	- [x] 2.2 render compact component list (one row per component)
	- [x] 2.3 render action buttons with loading and error states
	- [x] 2.4 render last result and version summary
	- [x] 2.5 render readiness issues inline below degraded/not-ready component rows
- [x] Task 3: Add frontend validation
	- [x] 3.1 auth and action feedback handling
	- [x] 3.2 component-state rendering tests

## Guardrails

- no extra navigation tree
- no advanced settings editor
- no package repository or channel management UI

## Acceptance Criteria

- [x] Software tab appears in Server Detail page alongside existing server tabs
- [x] operators can inspect all managed software components in one place
- [x] operators can trigger install, upgrade, verify, or repair without switching surfaces
- [x] action feedback is explicit and readable
- [x] the UI does not expand into a generic package center
- [x] readiness signals are visible without opening advanced diagnostics
- [x] the UI renders from catalog/template metadata without component-specific screen forks

## Notes

- prefer one compact list or card stack
- do not add advanced configuration in this story

## Dev Agent Record

**Agent**: Amelia (bmad-agent-dev)

### Files Created
- `web/src/lib/software-api.ts` — API helpers: `listSoftwareOperations`, `listSoftwareComponents`, `getSoftwareComponent`, `listSoftwareCapabilities`, `getSoftwareOperation`, `invokeSoftwareAction`, plus software component / capability / async response types
- `web/src/lib/software-api.test.ts` — 11 unit tests covering operations, components, capabilities, and async action response contract
- `web/src/components/servers/ServerSoftwarePanel.tsx` — Panel rendered from backend software components with compact rows, readiness issues, action buttons, and in-progress / accepted feedback
- `backend/domain/routes/software.go` — server-scoped software routes for list, detail, capabilities, operations, and async action handling
- `web/src/components/software/LocalSoftwareInventoryPage.tsx` — separate AppOS-local inventory page
- `web/src/routes/_app/_auth/resources/local-software.tsx` — Resources route for AppOS-local software inventory

### Files Modified
- `web/src/routes/_app/_auth/resources/servers.tsx` — added `ServerSoftwarePanel` import, `'software'` added to tab union type in `onValueChange` and `validateSearch`, added `<TabsTrigger value="software">` and `<TabsContent value="software">`

### Tests
- Frontend: 11/11 pass (`software-api.test.ts`)
- Backend: `go build ./...` clean; all existing tests pass

### Change Log
| Date | Change |
|------|--------|
| 2025 | Implemented Story 29.6: Software tab surface + backend software route family |
