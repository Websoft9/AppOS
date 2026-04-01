# Story 18.4b: App-scoped Action History Query Contract

Status: proposed

## Story

As an operator,
I want Installed-side pages to request app-related action history through an explicit app-scoped contract,
so that Epic 18 consumes execution truth from Epic 17 without rebuilding action filtering and query shaping in the client.

## Acceptance Criteria

1. Installed-side pages can request action history for one app through an app-scoped backend query contract.
2. The dashboard no longer needs to fetch broad `/api/actions` inventory and filter it locally just to show one app's recent actions.
3. The returned app-scoped action data remains execution projection, not `AppInstance` aggregate state.
4. The contract supports the Installed-side use case without duplicating full action-detail semantics already owned by Epic 17 surfaces.
5. The story does not move execution timeline, logs, or audit ownership into the app-management surface.

## Delivered Now

- [x] Installed-side pages already hand off to shared action detail.
- [x] Execution truth already exists in Epic 17 action surfaces.
- [ ] App-scoped action-history consumption is expressed as a clean query contract.

## Still Deferred

- [ ] Richer app-scoped action analytics or advanced filtering UI.
- [ ] Cross-app or fleet-wide action search redesign.
- [ ] Inline timeline or log visualization in Installed-side surfaces.

## Current Baseline (2026-04-01)

`dashboard/src/pages/apps/AppDetailPage.tsx` currently fetches `/api/actions` and filters the results in the client by app id.

This is operationally workable but architecturally weak because:

1. The management page is rebuilding app-scoped query semantics locally.
2. The API contract is broader than the page actually needs.
3. Future Epic 18 work may copy this pattern and gradually re-own execution-query semantics on the management side.

## Dev Notes

- This is a query-contract cleanup story, not an execution-surface replacement story.
- Prefer a thin app-scoped execution view over adding more client-side filtering logic.
- Keep action detail, timeline, logs, and audit on the shared Epic 17 surfaces.

## Implementation Breakdown

### 1. Backend query contract

- Add an app-scoped action-history endpoint or query mode under the existing ownership boundary.
- Return only the summary fields required by Installed-side pages.
- Keep the contract aligned with the handoff model already used by `App Detail` and `Installed Apps`.

### 2. Frontend consumption update

- Replace full `/api/actions` fetch plus local filtering in `AppDetailPage.tsx`.
- Use the app-scoped contract for `Action History` and related summary cards.
- Preserve navigation to shared `/actions/$actionId` detail.

### 3. Boundary validation

- Confirm that the new response remains projection-oriented.
- Do not reclassify action history into `AppInstance` aggregate fields.

### 4. Tests

- Add route tests for app-scoped action-history retrieval.
- Add or update frontend tests for action-history loading behavior where coverage already exists.

## Minimal Acceptance Test Checklist

- [ ] Installed-side action history does not require loading the full `/api/actions` inventory.
- [ ] App-scoped action-history results contain the summary fields needed for action handoff.
- [ ] Action detail navigation still uses canonical action ids.
- [ ] Execution-detail ownership remains on Epic 17 surfaces.

## References

- [Source: specs/implementation-artifacts/epic17-18-app-instance-subdomain-assessment.md]
- [Source: specs/implementation-artifacts/story18.4a-app-detail-action-handoff.md]
- [Source: specs/implementation-artifacts/epic17-app-execution.md]