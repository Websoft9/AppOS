# Deployment Engine Architecture & Core Technology Stack

## Status
Accepted

## Context
We are discussing the design for "Epic 17: Deploy" targeting a single-server optimized, resource-constrained AppOS environment capable of managing multiple remote servers point-to-point. The system must be lightweight, relying on existing infrastructure where possible, reducing complexity while ensuring robust tracking and execution of remote deployment tasks.

## Decisions

*   **Workflow vs Pipeline:** Reject heavy workflow engines (like Airflow or Temporal). Adopt a rigid pipeline model to minimize external dependencies and overhead.
*   **State Machine:** Adopt `looplab/fsm` **or an equivalent hand-written Go struct + switch** (zero external dependency) for single-entity lifecycle locking. Canonical transitions: `queued` -> `validating` -> `running` -> `success`/`failed` -> `rolling_back` -> `rolled_back`. Additionally: `validating` may transition directly to `failed` (pre-apply rejection); `rolling_back` may transition to `failed` if rollback execution itself fails (record failure reason, terminal state). User-initiated cancel is treated as context cancellation (same as timeout) leading to `failed`. Implementation choice left to the engineer; correctness of transition rules matters more than the library. PocketBase handles data persistence, not business flow transitions.
*   **Worker & Queueing:** Native Go Channels + PocketBase (SQLite) for queues. Utilize a per-Server bounded worker pool (guarantees cross-server concurrency, strict single-server serial execution). Reject external queues like Redis/Asynq.
*   **Spec Normalization:** Use `compose-spec/compose-go` for ahead-of-queue deterministic compilation of Git/Store inputs.
*   **Execution:** Use `os/exec` directly interacting with the target's `docker compose` binary using injected `DOCKER_HOST` SSH paths.
*   **Observability (Long Tasks):** Rely on Go `context.Context` for hard timeout cutoffs. Use PocketBase native Realtime (SSE) to broadcast stdout/stderr streams to the UI instead of building custom WebSockets.
*   **Scheduling Invariant:** For each `server_id`, at most one deployment may be in `running` or `rolling_back`; enforce at worker routing and persistence lock layers.
*   **Timeout & Log Guardrails:** Apply stage-specific timeout budgets (`image pull`, `compose apply`, `health wait`) and stream ordered log chunks. Single-run log cap: **5 MB** (truncate oldest lines). Backpressure-safe buffering protects control-plane memory.
*   **Orphan Task Recovery:** On process restart, any job found in `running` or `rolling_back` is considered orphaned (Docker state unknown). Immediately mark `failed` and execute rollback path if last-known-good snapshot exists.
*   **First-Deploy Failure Semantics:** First-time deployments have no last-known-good snapshot. Failure = `docker compose down` (cleanup) then terminal `failed`. `rolling_back` state is only reachable for upgrades of an already-running application.

## Consequences
The resulting architecture is highly reliable and maintains an extremely low resource footprint. There is a very tight coupling to the local container toolchain, but it is intentionally limited for massive horizontal cluster orchestration.
