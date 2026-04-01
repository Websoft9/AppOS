# Story 17.4e-E: Resolution Preview API and Create-Page Consumption

Status: proposed

## Story

As a platform operator,
I want the create-deployment page to show a backend-authored normalized install preview before action creation,
so that I can inspect real lifecycle intent instead of relying only on client-side summaries and preflight side signals.

## Acceptance Criteria

1. The backend must expose a read-only resolution-preview endpoint that returns normalized install intent without creating an operation.
2. The preview must reuse the same normalization rules as install preflight and install action creation.
3. The create page must consume the preview and present backend-authored normalized values such as source, adapter, project name, target server, runtime-input summary, and preserved exposure intent.
4. The preview must distinguish normalized install intent from resource preflight results so operators understand the difference between "what will be submitted" and "what might block execution".
5. The page must continue to route successful submissions into shared action detail after action creation.
6. This story must not move worker details, pipeline timelines, or execution internals into the create page.

## Delivered Now

- [x] `/deploy/create` already exists as the full-page lifecycle entry surface.
- [x] The page already shows operator-facing summaries and backend preflight feedback.
- [x] Install name availability and preflight checks already provide early signal without action creation.
- [x] The remaining gap is a true backend-authored normalized-intent preview.

## Still Deferred

- [ ] A dedicated resolution-preview API separate from preflight.
- [ ] UI sections that clearly separate candidate input, normalized intent, and execution checks.
- [ ] Richer preview summaries for secret refs, exposure intent, and future source variants.

## Dev Notes

- This is the operator-visibility slice for `17.4e`.
- Do not overload preflight to stand in for normalized intent preview forever.
- The create page should teach the user the lifecycle ingress model: candidate input -> normalized intent -> queued action.
- If the preview shape and create shape diverge, this story is not done.

### Suggested Implementation Focus

1. Add a preview endpoint that resolves install intent without queueing.
2. Reuse the same resolver boundary as preflight and create.
3. Update `/deploy/create` review panel to display backend-authored normalized summaries.
4. Keep resource conflicts and capacity warnings visually separate from normalized intent.

### References

- [Source: specs/implementation-artifacts/story17.4e-install-input-resolution.md]
- [Source: specs/implementation-artifacts/story17.6-create-deployment-page.md]
- [Source: specs/implementation-artifacts/iteration2-epic17-install-resolution-convergence-slice.md]
- [Source: backend/domain/lifecycle/service/install_preflight.go]
- [Source: dashboard/src/pages/deploy/CreateDeploymentPage.tsx]
- [Source: dashboard/src/pages/deploy/actions/useActionsController.ts]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Story created to formalize the final operator-facing convergence slice under `17.4e`.
- The slice assumes the create page exists and focuses on exposing normalized lifecycle intent clearly before submission.


### File List
