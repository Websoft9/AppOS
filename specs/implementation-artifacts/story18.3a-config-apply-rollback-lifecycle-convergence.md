# Story 18.3a: Config Apply and Rollback Lifecycle Convergence

Status: proposed

## Story

As an operator,
I want config apply and rollback to run through the shared lifecycle operation model,
so that configuration-changing flows use the same execution history, audit semantics, and status handoff pattern as other app lifecycle actions.

## Acceptance Criteria

1. Config apply and rollback no longer rely on a management-local route path as their primary behavior; they create or resume shared lifecycle operations.
2. These operations produce canonical execution records that can be inspected through the existing Epic 17 action surfaces.
3. Installed-side config workflows use the same operation handoff model already established for other lifecycle actions.
4. Any retained direct mutation path, if temporarily required, is clearly migration-only and not the primary architecture.
5. The story does not redesign config editing UX beyond what is needed to support shared operation creation and operator feedback.

## Delivered Now

- [x] The remaining config convergence gap is explicitly documented.
- [x] Installed-side action convergence already exists for several lifecycle actions.
- [ ] Config apply and rollback are fully aligned to the shared lifecycle operation model.

## Still Deferred

- [ ] Richer config validation workflow redesign.
- [ ] Full config diff and approval workflow.
- [ ] Multi-step config promotion or staged rollout semantics.

## Current Baseline (2026-04-01)

`handleAppInstanceConfigWrite` and `handleAppInstanceConfigRollback` in `backend/domain/routes/apps.go` still perform direct file mutation, app-record save, and audit logging within the app-management route layer.

This is the clearest remaining mutation-path boundary leak because:

1. Config changes are lifecycle-relevant mutations.
2. Their status, auditability, and operator follow-up should align with the shared action model.
3. Leaving them on a local route path preserves a second action architecture inside Epic 18.

## Dev Notes

- This is the main remaining mutation-path convergence story after `start`, `stop`, `restart`, and `uninstall` were converged.
- The first implementation slice can remain thin. The important boundary decision is operation ownership, not immediate redesign of every config sub-step.
- Prefer reusing existing Epic 17 operation creation patterns rather than inventing a config-only execution framework.

## Implementation Breakdown

### 1. Operation model decision

- Define how config apply and rollback map onto shared lifecycle operations.
- Carry enough metadata to make the resulting operation reproducible and auditable.
- Decide whether config rollback is its own operation type or a parameterized variant within the same family.

### 2. Backend route convergence

- Replace direct-primary config mutation routes with shared operation creation or enqueueing.
- Keep any temporary direct path isolated and non-primary if migration safety requires it.

### 3. Installed-side handoff

- Return operation references from config apply/rollback entry points.
- Reuse the action-detail handoff pattern already established in Epic 18.

### 4. Projection and audit behavior

- Ensure resulting app-state summaries are updated through shared lifecycle/projection rules where applicable.
- Keep audit semantics aligned with operation creation and outcome handling.

### 5. Tests

- Add or update backend route tests for config apply and rollback operation creation.
- Verify operation metadata, audit linkage, and handoff payload shape.

## Minimal Acceptance Test Checklist

- [ ] Config apply creates or resumes a shared lifecycle operation.
- [ ] Config rollback creates or resumes a shared lifecycle operation.
- [ ] Installed-side UI receives operation references and can hand off to shared action detail.
- [ ] Direct route-local config mutation is no longer the primary success path.

## References

- [Source: specs/implementation-artifacts/epic17-18-app-instance-subdomain-assessment.md]
- [Source: specs/implementation-artifacts/story18.2a-local-action-convergence.md]
- [Source: specs/implementation-artifacts/story18.4a-app-detail-action-handoff.md]
- [Source: specs/implementation-artifacts/epic17-app-execution.md]