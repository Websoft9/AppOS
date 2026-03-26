# Story 17.6: Create Deployment Page and Install Resolution Surface

Status: in-progress

## Story

As a platform operator,
I want deployment task creation to use a full page instead of modal dialogs,
so that source-specific inputs, validation feedback, normalized resolution preview, and submission can work together in one clear lifecycle entry surface.

## Acceptance Criteria

1. The dashboard must provide a dedicated Create Deployment page route for install task creation instead of relying on modal-only entry for Manual Compose and Git Compose flows.
2. The page must separate shared deployment basics from source-specific inputs, with at least: deployment name, target server, deployment source selector, and source-specific input sections.
3. The page must support the current shared install entry paths for Manual Compose and Git Compose without changing the shared lifecycle execution contract.
4. The page must surface backend-owned validation and resolution semantics clearly, so the UI does not imply that raw form payloads are sent directly to workers.
5. The page must include a persistent summary area that explains the normalized install intent that will be submitted, including source, adapter, target server, project name, and exposure or env implications when present.
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
- [x] Implemented a two-column create page with source selection, shared basics, source-specific inputs, and a sticky resolution summary.
- [x] Preserved current Manual Compose and Git Compose backend submission paths through the shared action APIs.
- [x] Kept store-prefill handoff on the shared create page route instead of opening a modal-specific flow.
- [x] Added focused frontend tests for create-page submission and updated homepage routing tests.
- [x] Removed obsolete modal-specific controller state and deleted the unused deploy entry dialog components.
- [x] Added legacy `/deploy` prefill redirect behavior so older handoff links land on the new create page automatically.
- [x] Hardened SPA static-file cache policy so new create-page routes are not blocked by stale cached `index.html` after deployment.

## Still Deferred

- [ ] Inline resolution-preview API beyond the current operator-facing summary and submission feedback.
- [ ] Rich advanced editors for env, exposure intent, and secret-backed input selection.
- [ ] True Docker Run parsing and Source Package preparation beyond the current guided placeholders.

## Proposed Design

### Page Shape

Use a dedicated route such as `/deploy/create` with a desktop two-column layout:

1. Left column: input work area.
2. Right column: sticky summary and validation area.

Mobile collapses into one column with the summary block below the main form.

### Primary Sections

1. Header and source context
2. Deployment source selector
3. Shared basics: app name, target server, optional context
4. Source-specific input section
5. Advanced options: env, exposure intent, secrets guidance
6. Sticky resolution summary and submit actions

### Source-Specific Behavior

1. Manual Compose:
   - compose editor with helper copy and stronger validation messaging
   - optional sample or prefill handling
2. Git Compose:
   - repository URL, ref, compose path, optional fetch header fields
   - clear explanation that backend resolves raw repository input into normalized install data

### Summary Panel

The summary panel should show operator-facing output expectations, not internal execution detail noise:

1. deployment name
2. target server
3. source and adapter
4. normalized install preview fields already known client-side
5. validation state and backend response messages
6. primary submit action and optional validate action

## Backend Interaction Notes

- Use the existing action creation endpoints as the submission boundary.
- Keep backend resolution as the authority for defaults, secret-backed refs, and install normalization.
- If needed, add a lightweight validation or resolution-preview API only to support page feedback; do not move normalization rules into the frontend.
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
- Advanced env, exposure, and secret-editing remain intentionally deferred even though the page now explains that those semantics stay backend-owned.
- Added cache-control hardening for the dashboard shell because route rollout issues are otherwise easy to misdiagnose as missing frontend routes.


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