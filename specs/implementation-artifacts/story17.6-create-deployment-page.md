# Story 17.6: Create Deployment Page and Install Resolution Surface

Status: in-progress

## Story

As a platform operator,
I want deployment task creation to use a full page instead of modal dialogs,
so that source-specific inputs, validation feedback, normalized resolution preview, and submission can work together in one clear lifecycle entry surface.

## Acceptance Criteria

1. The dashboard must provide a dedicated Create Deployment page route for install task creation instead of relying on modal-only entry for Manual Compose and Git Compose flows.
2. The page must separate shared deployment basics from source-specific inputs, with at least: deployment name, target server, and source-specific input sections for the active install path.
3. The page must support the current shared install entry paths for Manual Compose and Git Compose without changing the shared lifecycle execution contract.
4. The page must surface backend-owned validation and resolution semantics clearly, so the UI does not imply that raw form payloads are sent directly to workers.
5. The page must include a persistent review area that explains the normalized install intent that will be submitted, including source, adapter, target server, project name, and env or mount-file implications when present.
6. Duplicate app-name conflicts and other request validation failures must be presented inline from backend responses before or during submission, while the backend remains the final authority.
7. Submission must create the lifecycle action through the existing shared action APIs and then route the operator into the created action detail view.
8. Existing modal-specific state and interaction paths should be reduced or removed once the page covers their behavior, without breaking store-prefill and installed-prefill entry semantics.

## Scope

- Full-page deployment creation UX in the dashboard.
- Shared page shell for current create flows.
- Backend-linked validation and submission behavior for lifecycle install creation.
- Manual Compose and Git Compose as the first required source sections.

## Non-Goals

- Redefining worker payloads or lifecycle execution schemas.
- Implementing Docker Run parsing or Source Package resolution beyond linking them into future page sections.
- Moving publication execution into this story.

## Delivered Now

- [x] Added a dedicated `/deploy/create` route and full-page deployment creation surface.
- [x] Replaced Deploy home custom-entry actions so Compose, Git, Docker Command, and Source Packages now route into the create page instead of opening modal dialogs.
- [x] Implemented a two-column create page with shared basics on the left, a persistent review panel on the right, and mobile fallback to a single-column flow.
- [x] Preserved current Manual Compose and Git Compose backend submission paths through the shared action APIs.
- [x] Kept store-prefill handoff on the shared create page route instead of opening a modal-specific flow.
- [x] Added focused frontend tests for create-page submission and updated homepage routing tests.
- [x] Removed obsolete modal-specific controller state and deleted the unused deploy entry dialog components.
- [x] Added legacy `/deploy` prefill redirect behavior so older handoff links land on the new create page automatically.
- [x] Hardened SPA static-file cache policy so new create-page routes are not blocked by stale cached `index.html` after deployment.
- [x] Refined the create page into a denser industrial layout with non-collapsible `Info` and `Orchestration` sections, a collapsible `Advanced Options` section, and stronger section hierarchy.
- [x] Added source-package mount upload support, compose template import, sample compose fill, compose clear, and richer env editing helpers directly inside the orchestration surface.
- [x] Added frontend helpers for manual env values, shared env-set import, and secret-backed value generation while keeping backend secret validation authoritative.
- [x] Added a dedicated non-submitting `Check` action that surfaces backend preflight results before action creation.
- [x] Added realtime install-name availability checks via `POST /api/actions/install/name-availability` and surfaced result inline in the create page.
- [x] Extended install preflight checks to always include app-name availability plus resource checks (ports, container names, docker availability, disk space).

## Still Deferred

- [ ] Inline resolution-preview API beyond the current operator-facing summary and submission feedback.
- [ ] Backend-authored exposure editing and richer advanced-option editors beyond the current placeholders.
- [ ] True Docker Run parsing and Source Package preparation beyond the current guided placeholders.

## Proposed Design

### Page Shape

Use a dedicated route such as `/deploy/create` with a desktop two-column layout:

1. Left column: input work area.
2. Right column: sticky review and preflight area.

Mobile collapses into one column with the summary block below the main form.

### Primary Sections

1. Header and navigation actions
2. `Info`: app name and target server
3. `Orchestration` or `Repository`: source-specific deployment inputs
4. `Advanced Options`: deferred exposure and secret-backed platform options
5. Sticky `Review` panel with identity, resolution, input inventory, pre-flight state, and actions

### Source-Specific Behavior

1. Manual Compose:
   - compose editor with upload, template import, sample fill, clear, and stronger validation messaging
   - env editing helpers for manual values, shared env sets, and generated secret-backed values
   - mount-file upload area using relative `./src/` semantics inside the app workspace
2. Git Compose:
   - repository URL, ref, compose path, optional fetch header fields
   - clear explanation that backend resolves raw repository input into normalized install data

### Summary Panel

The review panel should show operator-facing output expectations, not internal execution detail noise:

1. deployment name
2. target server
3. source and adapter
4. normalized install preview fields already known client-side
5. validation state and backend response messages
6. primary submit action and a non-submitting `Check` action

## Backend Interaction Notes

- Use the existing action creation endpoints as the submission boundary.
- Keep backend resolution as the authority for defaults, secret-backed refs, and install normalization.
- Add a lightweight preflight API for `Check` so the UI can surface compose validation, duplicate-name conflicts, and server-resource conflicts without creating an action.
- Reuse the current duplicate-name conflict behavior so the page can surface `409 Conflict` inline.

## Dev Notes

- This story is the UI consumption counterpart of [specs/implementation-artifacts/story17.4e-install-input-resolution.md](specs/implementation-artifacts/story17.4e-install-input-resolution.md).
- The create page should teach the user that deployment creation is a lifecycle action entry surface, not a direct worker form.
- Store-prefill and installed-prefill should continue to land on the same page with prefilled source context instead of opening divergent modals.
- The page should redirect to the shared action detail view immediately after successful creation.

### References

- [Source: specs/adr/app-lifecycle-install-resolution.md]
- [Source: specs/implementation-artifacts/story17.4e-install-input-resolution.md]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Story 17.4 Input Adapters (MVP Scope)]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Added a dedicated planning story for replacing create-deployment modals with a full page tied to backend install resolution semantics.
- Kept the story focused on frontend page architecture plus backend-linked validation and submission behavior.
- Explicitly excluded publication operations so Epic 17 planning stays coherent after the renumbering request.
- Implemented the first live slice of the story with `/deploy/create`, shared controller reuse, and deploy-home entry rewiring.
- Manual Compose and Git Compose now submit from the full page and redirect to shared action detail after creation.
- Backend-owned exposure editing remains deferred even though the page now exposes richer frontend env helpers and keeps backend validation authoritative.
- Added cache-control hardening for the dashboard shell because route rollout issues are otherwise easy to misdiagnose as missing frontend routes.
- The stabilized UI now treats `Info` and `Orchestration` as always-visible working sections and keeps `Advanced Options` as the only top-level collapsible block.
- Added realtime app-name availability checks on create-page input changes, using a lightweight backend endpoint without creating operations.
- Updated backend preflight output so `checks.app_name` is always present and participates in blocking decisions alongside resource probes.
- Added regression tests for name-availability and for preflight resource-check presence, plus frontend test coverage for realtime name checks.
- Updated OpenAPI artifacts and group matrix to include `POST /api/actions/install/name-availability` in the Actions surface.
- Updated create-page submission flow so server-side preflight is always re-checked before action creation and blocked responses return early.
- Added optional create/check input for estimated app disk (`app_required_disk_gib`) and surfaced it in the review panel.
- Refined disk preflight semantics so only threshold/estimate capacity conflicts become hard blockers while probe-unavailable paths stay warnings.


### File List

- `dashboard/src/pages/deploy/CreateDeploymentPage.tsx`
- `dashboard/src/routes/_app/_auth/deploy.create.tsx`
- `dashboard/src/pages/deploy/DeployPage.tsx`
- `dashboard/src/pages/deploy/actions/useActionsController.ts`
- `dashboard/src/pages/deploy/actions/action-types.ts`
- `dashboard/src/pages/deploy/DeployPage.test.tsx`
- `dashboard/src/pages/deploy/CreateDeploymentPage.test.tsx`
- `dashboard/src/routeTree.gen.ts`
- `build/nginx.conf`
- `backend/domain/routes/deploy.go`
- `backend/domain/routes/deploy_test.go`
- `backend/domain/routes/settings.go`
- `backend/docs/openapi/ext-api.yaml`
- `backend/docs/openapi/api.yaml`
- `backend/docs/openapi/group-matrix.yaml`