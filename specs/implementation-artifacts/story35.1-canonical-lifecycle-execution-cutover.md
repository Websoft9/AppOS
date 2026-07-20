# Story 35.1: Canonical Lifecycle Execution Cutover

Status: proposed

## Story

As a platform operator,
I want one canonical lifecycle execution path,
so that all deployment and management actions run through one auditable truth model without a competing legacy deployment engine.

## Acceptance Criteria

1. No runtime lifecycle action may create or depend on a legacy `deployments` record.
2. Install, start, stop, restart, redeploy, uninstall, and later publish-oriented actions must create `app_operations` records and, when applicable, seed `pipeline_runs` plus `pipeline_node_runs`.
3. No worker path may write `app_instances` lifecycle state through legacy deployment synchronization.
4. All lifecycle execution detail APIs and UI surfaces must read from lifecycle tables only.
5. The legacy deployment schema and worker flow must be removed from the active runtime model without introducing a compatibility shim.
6. Audit, logs, and action-history behavior must remain intact on the lifecycle path after cutover.

## Scope

- backend lifecycle routes and operation creation paths
- worker execution paths
- lifecycle read APIs used by dashboard actions/history/detail views
- schema and code references that still treat `deployments` as active truth

## Out of Scope

- DAG scheduling behavior changes
- projection fact-model cleanup
- `RuleProfile` introduction

## Implementation Notes

- Remove legacy deployment entry routes, worker handlers, and projection sync paths from the lifecycle runtime.
- Keep migration expectations explicit: this story is a clean cutover, not a backward-compatibility exercise.
- Frontend entry surfaces may still present similar UX, but the backend execution model must be lifecycle-only.

## Touch Points

- `backend/domain/routes/deploy.go`
- `backend/domain/worker/worker.go`
- `backend/domain/worker/lifecycle_operations.go`
- `backend/domain/deploy/deploy.go`
- `backend/infra/schema/deployments.go`
- `web/src/pages/deploy/*`
- `web/src/routes/_app/_auth/deploy*`

## Suggested Order

1. remove legacy create/run/cancel read paths
2. route all lifecycle actions through `app_operations`
3. remove deployment-driven projection writes
4. remove legacy schema/runtime references
5. run full action-history/detail regression pass

## Risks

- Hidden UI or worker dependencies on `deployments` may surface late.
- Existing install-related entry points may still assume deployment-era payload semantics.

## References

- `specs/planning-artifacts/deployment-architecture-assessment.md`
- `specs/implementation-artifacts/epic17-app-execution.md`
