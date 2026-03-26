# Story 17.1: Lifecycle Contract and Scheduler Core

Status: review

## Story

As a platform operator,
I want a strict lifecycle execution contract and scheduler core,
so that every lifecycle action enters one deterministic, auditable execution model before adapters and management surfaces expand.

## Acceptance Criteria

1. Freeze the canonical execution fields: `phase`, `terminal_status`, `failure_reason`, and `app_outcome`.
2. Keep ownership boundaries explicit between `AppInstance`, `OperationJob`, `PipelineRun`, `PipelineNodeRun`, `ReleaseSnapshot`, and `Exposure`.
3. Use clean-slate lifecycle collections instead of extending deploy-era schema.
4. Persist normalized operation data in `app_operations` and keep raw adapter payloads out of worker tasks.
5. Enforce one conflicting active operation per `server_id` while still allowing cross-server parallelism.
6. Define cancellation and orphaned-operation recovery semantics for non-terminal jobs.

## Delivered Now

- [x] Lifecycle vocabulary and shared model types are defined for pipeline families, execution phases, operation types, sources, adapters, and projection targets.
- [x] Clean-slate lifecycle collections exist for `app_instances`, `app_operations`, `app_releases`, `app_exposures`, `pipeline_runs`, and `pipeline_node_runs`.
- [x] Pipeline definitions are selected through metadata by `operation_type + source + adapter`.
- [x] Operation creation persists normalized compose-based execution data in `app_operations` and seeds `pipeline_runs` plus `pipeline_node_runs`.
- [x] Worker claim logic enforces per-`server_id` serial execution for conflicting active operations.
- [x] Cancellation requests and orphaned-operation recovery are implemented in the worker path.

## Still Deferred

- [ ] Rich compensation policy beyond the first install slice.
- [ ] Broader transition-matrix coverage for future operation families.
- [ ] Advanced manual-gate semantics for later high-risk operations.

## Dev Notes

- This story is the contract anchor for Epic 17. It is not a UI story.
- The shared queue boundary is already normalized around operation records, not Store or Git payloads.
- Legacy deploy-era compatibility remains out of scope.

### References

- [Source: specs/implementation-artifacts/epic17-app-execution.md#Stories]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Architecture & Technical Decisions (2026-03-02, updated for lifecycle model)]
- [Source: specs/implementation-artifacts/epic17-app-execution.md#Operational Guardrails (MVP)]
- [Source: specs/adr/app-lifecycle-domain-model.md#Decisions]
- [Source: specs/adr/app-lifecycle-field-definitions.md#Decisions]
- [Source: specs/adr/app-lifecycle-pocketbase-collections.md#Decisions]
- [Source: specs/adr/app-lifecycle-pipeline-execution-engine.md]
- [Source: specs/adr/app-lifecycle-install-resolution.md]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Clean-slate lifecycle schema and indexes are in place.
- Metadata-driven pipeline selection and pipeline seeding are implemented.
- Scheduler claim, cancel request, and orphan recovery logic are already wired into the worker.


### File List
