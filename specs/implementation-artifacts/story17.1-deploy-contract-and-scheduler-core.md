# Story 17.1: Deploy Contract and Scheduler Core

Status: ready-for-dev

## Story

As a platform operator,
I want a strict deploy contract and scheduler core,
so that deployment jobs are deterministic, auditable, and safe across multiple managed servers with single-server serial execution guarantees.

## Acceptance Criteria

1. Define canonical FSM states and allowed transitions for deployment jobs: `queued`, `validating`, `running`, `success`, `failed`, `rolling_back`, `rolled_back`. All allowed transitions must be exhaustively enumerated; any unlisted transition is forbidden. Additional valid transitions beyond the happy path: `validating → failed`, `rolling_back → failed` (if rollback execution itself fails, e.g. corrupted last-known-good snapshot; record rollback failure reason and mark terminal `failed`).
2. Support direct transition `validating -> failed` for pre-apply rejection scenarios (for example YAML validation and port conflict).
3. Define `DeploymentSpec` schema and persistence contract in `deployments` (JSON record), including rendered compose YAML and resolved environment map. Minimum required fields: `app_id`, `server_id`, `trigger_source` (one of: `store`, `manualops`, `fileops`, `gitops`), `compose_yaml` (rendered string), `env_map` (resolved key-value pairs), `version` (snapshot tag or commit ref), `created_at`. Additional fields may be added by downstream stories.
4. Define release snapshot schema for rollback reference and last-known-good linkage.
5. Enforce scheduling invariant: for each `server_id`, at most one job in `running` or `rolling_back` at any time. When a new deploy request arrives for a server that already has an active job, the new job is accepted and retained in `queued` state; it must not be rejected. The worker picks up the queued job only after the active job reaches a terminal state (`success`, `failed`, or `rolled_back`).
6. Define orphan-task recovery on process restart: stale `running`/`rolling_back` jobs must become `failed`, then follow rollback path when snapshot exists.
7. Define user-cancel semantics as context cancellation; cancellation leads to `failed` and follows standard rollback-or-cleanup behavior.
8. Enforce pre-queue normalization hard rule: worker payloads may include only normalized `DeploymentSpec`; raw UI/Git/file inputs are forbidden.

## Tasks / Subtasks

- [ ] Define deploy domain contracts (AC: 1,2,3,4)
  - [ ] Create deployment state enum/constants and transition matrix
  - [ ] Define `DeploymentSpec` DTO and validation contract
  - [ ] Define release snapshot DTO and relationship fields
- [ ] Implement scheduler invariants (AC: 5)
  - [ ] Add per-`server_id` mutual exclusion guard in scheduler routing
  - [ ] Add persistence-layer query/lock constraint for active job uniqueness
- [ ] Implement failure/cancel/restart semantics (AC: 6,7)
  - [ ] Add startup recovery routine for orphan jobs
  - [ ] Add cancel propagation using `context.Context`
  - [ ] Normalize terminal state behavior for first deploy vs upgrade
- [ ] Implement normalization gate policy (AC: 8)
  - [ ] Introduce resolver output contract for queue insertion
  - [ ] Reject any queue push with raw input payload shape
- [ ] Add developer-facing contract tests (AC: 1-8)
  - [ ] FSM transition tests (allow/deny matrix)
  - [ ] Scheduler invariant tests (single active job per server)
  - [ ] Restart recovery tests

## Dev Notes

- Reuse Epic 4 docker execution primitives; do not duplicate compose executor internals.
- Keep architecture lightweight: no Redis, Asynq, Airflow, Terraform, Temporal for this story.
- Control plane may process jobs for different servers concurrently, while each target server remains strictly serial.
- `DeploymentSpec` is produced by backend Resolver/Normalizer before queue insertion.
- This story defines contract/scheduler guardrails; it does not deliver full deploy UX flow.

### Project Structure Notes

- Backend core changes likely under deploy orchestration modules in `backend/internal/`.
- Story artifact tracked in `specs/implementation-artifacts/`.
- Keep schema and state names aligned with Epic 17 definitions.

### References

- [Source: specs/implementation-artifacts/epic17-deploy.md#Stories]
- [Source: specs/implementation-artifacts/epic17-deploy.md#Architecture & Technical Decisions (2026-03-02)]
- [Source: specs/implementation-artifacts/epic17-deploy.md#Operational Guardrails (MVP)]
- [Source: specs/adr/deployment-engine-core-stack.md#Decisions]

## Dev Agent Record

### Agent Model Used

GPT-5.3-Codex

### Debug Log References


### Completion Notes List


### File List


