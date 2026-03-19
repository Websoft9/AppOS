# Story 17.1: Deploy Contract and Scheduler Core

Status: in-progress

## Story

As a platform operator,
I want a strict deploy contract and scheduler core,
so that deployment jobs remain deterministic, auditable, and safe as trigger adapters and management surfaces expand.

## Acceptance Criteria

1. Define the canonical deployment lifecycle, lifecycle events, and legal transitions for the shared pipeline. The canonical state set is `queued`, `validating`, `preparing`, `running`, `verifying`, `success`, `failed`, `rolling_back`, `rolled_back`, `cancelled`, `timeout`, `manual_intervention_required`.
2. Separate responsibilities clearly: the FSM owns lifecycle progression, while worker and executor layers own compose validation, file preparation, compose apply, health checks, and log production.
3. Define `DeploymentSpec` and persistence contract in `deployments`. Minimum contract fields must cover `server_id`, `source`, `adapter`, `compose_project_name`, `project_dir`, `rendered_compose`, optional resolved env data, and optional release snapshot linkage.
4. Enforce the scheduling invariant: for each `server_id`, at most one active deploy execution may run at a time. Cross-server parallelism remains allowed.
5. Define orphan-task recovery on process restart for jobs left in non-terminal execution states.
6. Define terminal behavior for first deploy failure, timeout, cancellation, and ambiguous failure cases that require manual intervention.
7. Enforce the pre-queue normalization rule: worker payloads may include only normalized deployment data or deployment identifiers, never raw Store, Git, or file-upload input payloads.
8. Keep the deploy contract compatible with the existing embedded async worker model already used by the backend.

## Tasks / Subtasks

- [ ] Define lifecycle and contract boundaries (AC: 1,2,3)
  - [ ] Freeze canonical state and event names
  - [ ] Define legal transition matrix and terminal-state semantics
  - [ ] Define `DeploymentSpec` and release snapshot fields
- [ ] Define scheduler guarantees (AC: 4,5,6)
  - [ ] Document per-`server_id` serial execution invariant
  - [ ] Document restart recovery behavior for orphaned jobs
  - [ ] Document first-deploy cleanup versus rollback behavior
- [ ] Define queue boundary policy (AC: 7,8)
  - [ ] Keep raw adapter input outside worker payloads
  - [ ] Align queue contract with the current embedded worker architecture
- [ ] Add contract-level validation coverage (AC: 1-8)
  - [ ] FSM transition tests
  - [ ] Serial scheduling tests
  - [ ] Restart recovery tests

## Dev Notes

- Reuse the existing embedded async worker infrastructure; this story does not introduce a new orchestration framework.
- Reuse Docker execution primitives rather than duplicating compose executor internals.
- This story defines the shared deploy contract and scheduler boundaries; it does not own Store, Git, or Installed-app entry UX.

### References

- [Source: specs/implementation-artifacts/epic17-deploy.md#Stories]
- [Source: specs/implementation-artifacts/epic17-deploy.md#Architecture & Technical Decisions (2026-03-02)]
- [Source: specs/implementation-artifacts/epic17-deploy.md#Operational Guardrails (MVP)]
- [Source: specs/adr/deployment-engine-core-stack.md#Decisions]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List


### File List
