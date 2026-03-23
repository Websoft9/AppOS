# Story 17.1: Lifecycle Contract and Scheduler Core

Status: in-progress

## Story

As a platform operator,
I want a strict lifecycle execution contract and scheduler core,
so that lifecycle operations remain deterministic, auditable, and safe as trigger adapters and management surfaces expand.

## Acceptance Criteria

1. Define the canonical lifecycle execution contract for the shared pipeline, using separate fields for `phase`, `terminal_status`, `failure_reason`, and `app_outcome`.
2. Separate responsibilities clearly: `AppInstance` owns product-facing lifecycle state, `OperationJob` owns execution state, `PipelineRun` owns DAG execution detail, and worker/executor layers own compose validation, file preparation, compose apply, health checks, and log production.
3. Define clean-slate PocketBase collections for lifecycle execution. Minimum MVP set is `app_instances`, `app_operations`, `app_releases`, and `app_exposures`, with `pipeline_runs` and `pipeline_node_runs` added when node-level execution history is part of MVP observability.
4. Define the normalized operation contract persisted in `app_operations`. Minimum contract fields must cover `server_id`, `operation_type`, `trigger_source`, `adapter`, `compose_project_name`, `project_dir`, `rendered_compose`, optional resolved env data, and optional release snapshot linkage.
5. Enforce the scheduling invariant: for each `server_id`, at most one conflicting lifecycle operation may run at a time. Cross-server parallelism remains allowed.
6. Define orphan-task recovery on process restart for jobs left in non-terminal execution states.
7. Define terminal behavior for first install failure, timeout, cancellation, compensation failure, and ambiguous failure cases that require manual intervention.
8. Enforce the pre-queue normalization rule: worker payloads may include only normalized operation data or operation identifiers, never raw Store, Git, or file-upload input payloads.
9. Reuse the existing embedded async worker architecture only where it still serves the new lifecycle model. Backward compatibility with legacy deploy-era schema is not required.

## Tasks / Subtasks

- [ ] Define lifecycle and contract boundaries (AC: 1,2,3,4)
  - [ ] Freeze canonical phase, terminal status, failure reason, and app outcome names
  - [ ] Define legal transition matrix and terminal-state semantics
  - [ ] Define normalized operation contract and release snapshot fields
  - [ ] Define new lifecycle collection set and ownership boundaries
- [ ] Define scheduler guarantees (AC: 5,6,7)
  - [ ] Document per-`server_id` serial execution invariant
  - [ ] Document restart recovery behavior for orphaned jobs
  - [ ] Document first-install cleanup versus rollback behavior
- [ ] Define queue boundary policy (AC: 8,9)
  - [ ] Keep raw adapter input outside worker payloads
  - [ ] Reuse worker infrastructure without inheriting old deploy schema
- [ ] Add contract-level validation coverage (AC: 1-9)
  - [ ] FSM transition tests
  - [ ] Serial scheduling tests
  - [ ] Restart recovery tests

## Dev Notes

- Reuse the existing embedded async worker infrastructure where still valid; this story does not introduce a new orchestration framework.
- Reuse Docker execution primitives rather than duplicating compose executor internals.
- This story defines the shared lifecycle execution contract, new collection ownership, and scheduler boundaries; it does not own Store, Git, or Installed-app entry UX.
- This story is explicitly a clean-slate MVP contract story. Legacy deploy-era schema compatibility is out of scope.
- The minimum lifecycle persistence set is `app_instances`, `app_operations`, `app_releases`, `app_exposures`, `pipeline_runs`, and `pipeline_node_runs`.

### References

- [Source: specs/implementation-artifacts/epic17-app-execution.md#Stories]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Architecture & Technical Decisions (2026-03-02, updated for lifecycle model)]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Operational Guardrails (MVP)]
- [Source: specs/adr/app-lifecycle-domain-model.md#Decisions]
- [Source: specs/adr/app-lifecycle-field-definitions.md#Decisions]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#Decisions]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List


### File List
