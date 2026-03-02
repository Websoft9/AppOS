# Epic 17: Deploy

**Module**: Application Lifecycle | **Status**: backlog | **Priority**: P1 | **Depends on**: Epic 4, Epic 5, Epic 8, Epic 12, Epic 14

## Objective

Provide a reliable single-server deployment workflow for applications, including first deploy, re-deploy, upgrade, and rollback, with clear execution status and auditability.

## Requirements

1. Support first-time deployment from app templates and existing compose-based app definitions.
2. Support re-deploy/upgrade workflows for already installed applications.
3. Support deployment triggers in three modes: GitOps, FileOps, and ManualOps.
4. Enforce pre-deploy validation (configuration, port conflicts, dependency checks, resource sanity checks).
5. Execute deployments with staged health gates and deterministic failure handling.
6. Support rollback using last-known-good release snapshot when deployment fails.
7. Persist deployment history, release metadata, and execution logs for traceability.
8. Expose deployment job status APIs consumed by Operations views.

## Acceptance Criteria

- Users can start first deploy, re-deploy, and upgrade from supported app definitions.
- Deployment trigger source is recorded as `gitops`, `fileops`, or `manualops` for each run.
- Invalid deployment inputs fail fast before runtime apply with actionable error output.
- Each deployment run has a stable lifecycle state (`queued`, `validating`, `running`, `success`, `failed`, `rolling_back`, `rolled_back`).
- On failed deploy after apply, system performs rollback to last-known-good release and records result.
- Operations views can query deployment status and link to run details without owning deploy logic.
- All deployment and rollback actions emit audit records with actor, action, target, and result.

## MVP Decisions (2026-03-01)

- API shape: add a new async deploy API; keep `/api/ext/docker/compose/*` as low-level execution primitives.
- State store: add a `deployments` collection for lifecycle/status/history (audit remains event trail).
- Scope: include local and remote targets in MVP.
- Sources: support `manualops`, `fileops`, and template/store-driven deploy through one orchestration path.

## Architecture & Technical Decisions (2026-03-02)

To strictly enforce the "Simplicity First" and "Single-Server Optimization" principles, the deployment engine will avoid distributed framework dependencies (e.g., Terraform, Airflow, Asynq, Redis) and adopt a lightweight native Go architecture:

1. **State Machine (FSM):** Use a strict Finite State Machine (e.g., `looplab/fsm` or a native Go struct) to govern the single-entity lifecycle. Canonical transitions: `queued` -> `validating` -> `running` -> `success`/`failed` -> `rolling_back` -> `rolled_back`. Additionally, `validating` may transition directly to `failed` (e.g., YAML error, port conflict) without entering `running`. The FSM prevents all other illegal state transitions and ensures safe rollbacks.
2. **Concurrency & Execution Engine:** The engine is event-driven via REST API into a database-backed queue. Work execution uses a **Per-Server bounded Worker pool (Goroutines with Channel queues)**. This strictly guarantees *cross-server parallel execution, but single-server strictly serial execution* to protect disk I/O and avoid Docker daemon deadlocks. Normalization of diverse inputs into a single `DeploymentSpec` must occur synchronously *before* entering the queue.
3. **Long-Running Task Resilience:** Avoid complex long-task managers. Instead, use Go's native `context.Context` (with timeouts) to terminate hung shell executions (e.g., `os/exec` wrapping `docker compose up`). Improve user wait anxiety via low-latency WebSocket/SSE multiplexed stdout/stderr log streams.
4. **Resolver/Normalizer Gate:** All deployment requests must pass a backend Resolver/Normalizer before queue insertion. The resolver merges multi-source inputs (Store form values, ManualOps YAML, defaults, server context) into one deterministic `DeploymentSpec`.

## Operational Guardrails (MVP)

1. **Scheduling invariant:** For each `server_id`, at most one deployment job may be in `running` or `rolling_back` at any time. Enforce this in both worker routing and database query/lock logic.
2. **Timeout policy matrix:** Use stage-specific timeout budgets managed by `context.Context`:
   - image pull
   - compose apply (`up`/`down`)
   - health-gate wait
   On timeout, mark `failed` and enter rollback path when last-known-good exists.
3. **Realtime log streaming contract:** Stream execution logs as ordered chunks with sequence numbers and timestamps. Single-run log cap: **5 MB** (truncate oldest lines when exceeded). Apply backpressure-safe buffering to protect control-plane memory.
4. **Process restart / orphan task recovery:** On control-plane startup, scan for any jobs left in `running` or `rolling_back` state (orphans from a previous crash). Immediately transition them to `failed` and trigger rollback if a last-known-good snapshot exists. Never silently resume a mid-flight job whose actual Docker state is unknown.
5. **First-deploy failure semantics:** A first-time deployment has no last-known-good snapshot. On failure, execute `docker compose down` to remove residual containers and mark the job `failed` (terminal state). Do **not** enter `rolling_back`; rollback path is only valid for upgrades/redeployments of an already-running app.
6. **Pre-queue normalization hard rule:** Worker processes must consume only normalized `DeploymentSpec` records. Raw inputs from UI/Git/file sources are forbidden in worker payloads.

## Minimal Delivery Path

1. Define deploy job contract and lifecycle states: `queued` → `validating` → `running` → `success`/`failed` → `rolling_back` → `rolled_back` (note: `validating` → `failed` is also a valid direct transition).
2. Wire async worker execution for deploy jobs, reusing existing Docker compose execution layer.
3. Persist run status/history in `deployments` and expose status/list/detail APIs for Operations.
4. Keep rollback minimal: compose-level rollback to last-known-good snapshot with result recording.

## Unified Deployment Pipeline (Minimal)

1. Define target app (`what to deploy`): normalize all inputs into one `DeploymentSpec`.
2. Prepare infrastructure: validate target host, runtime, ports, volumes, credentials, and permissions.
3. Prepare deployable artifact: use image directly, then version/tag snapshot. (Source build is a post-MVP extension point.)
4. Prepare orchestration: render unified compose-oriented execution plan from normalized spec.
5. Run deployment: execute async job lifecycle (`queued` → `validating` → `running` → `success`/`failed` → `rolling_back` → `rolled_back`).
6. Publish access: output endpoint/access info and final health result.

## Deployment Input Adapters (Minimal)

**MVP scope (2 adapters only):**
- Store Compose: app template + user params → `DeploymentSpec`.
- ManualOps (raw YAML): user-supplied `docker-compose.yml` text → validated → `DeploymentSpec`.

**Post-MVP (deferred):**
- Docker Run Command: parse `docker run` args and convert to compose-compatible spec.
- Source Build: source repo/context + build config → built image → `DeploymentSpec`.
- Guided by App Name: interactive collection of required options (ports/env/volume/network) → `DeploymentSpec`.

- Rule: adapters differ only at input stage; execution, status, and rollback stay on one shared pipeline.

## Future Extension: AI Agent Guidance

- AI agent participation is optional and non-blocking; manual flow must always remain available.
- AI focuses on guided input collection and decision suggestions (ports, volumes, env defaults, health checks).
- AI outputs must be normalized into the same deterministic deploy contract before execution.
- High-impact decisions (public exposure, destructive change, rollback strategy) require explicit user confirmation.
- Store AI rationale and selected options in deployment metadata for auditability and postmortem review.

## Integration Notes

- Reuse Docker/container execution primitives from Epic 4.
- Reuse app definition and source metadata from Epic 5.
- Reuse resource credentials and server context from Epic 8.
- Reuse file and IaC editing APIs from Epic 14 for FileOps source-of-truth inputs.
- Control plane may execute deployments to multiple managed servers concurrently, but each target server remains strictly serial.
- Publish deployment execution state for Epic 18 Operations entry points and status views.
- Emit events/logs for future Monitoring epic consumption; this epic does not own full observability stack.
- Reuse audit pipeline from Epic 12; no duplicate audit subsystem.

## Out of Scope

- Full observability platform features (metrics dashboards, alert routing, long-term log analytics).
- Cluster-level orchestrators, distributed scheduling planes, and multi-node release strategies.
- Enterprise progressive delivery patterns beyond MVP staged checks.

## Stories

### Story 17.1 Deploy Contract and Scheduler Core

Define deployment input model, release snapshot model, and deployment job state machine. Must specify: (a) canonical FSM state set and allowed transitions (including `validating` → `failed` shortcut); (b) backend Resolver/Normalizer contract (input merge precedence, validation errors, deterministic output rules); (c) `DeploymentSpec` schema and its persistence location (stored as a JSON field on the `deployments` collection record, alongside the rendered compose YAML and resolved env map); (d) release snapshot schema for rollback reference; (e) per-`server_id` serial invariant and orphan-task recovery semantics; (f) user-initiated cancel semantics.

### Story 17.2 First Deploy Closed Loop (MVP)

Implement first-time deployment end-to-end with pre-deploy validation, async execution, realtime logs, and minimal status/detail APIs required by Operations views.

### Story 17.3 Redeploy/Upgrade with Failure Recovery

Implement re-deploy/upgrade execution path for installed apps, including timeout handling, deterministic failure states, and rollback to last-known-good snapshot when available.

### Story 17.4 Trigger Adapters (MVP Scope)

Implement MVP trigger/input adapters for Store Compose and ManualOps YAML through the shared Resolver/Normalizer pipeline with source attribution, then emit a normalized `DeploymentSpec` for queue insertion. Defer GitOps/FileOps adapters to post-MVP follow-up.

Subtasks:
- **17.4a Store Direct Deploy UI (MVP):** Build Store entry UI path to collect required app params, submit to Resolver/Normalizer, and create a deploy job with source=`manualops` (store-driven).
- **17.4b ManualOps Compose UI (MVP):** Build compose text/file input UI, show validation feedback from Resolver/Normalizer, and enqueue normalized `DeploymentSpec`.
- **17.4c Docker Run Adapter UI/API (Post-MVP):** Accept `docker run` command input, parse/normalize server-side into compose-compatible `DeploymentSpec`, then enter shared queue pipeline.
- **17.4d Source Package Adapter UI/API (Post-MVP):** Accept source package/build config input, resolve into build-and-deploy compose plan, normalize to `DeploymentSpec`, then enter shared queue pipeline.

### Story 17.5 Deployment History and Audit Surface

Implement deployment run history, status/list/detail query APIs, and audit linkage required by Operations integration.

## Story Status

| Story | Status |
|-------|--------|
| 17.1 Deploy Contract and Scheduler Core | ready-for-dev |
| 17.2 First Deploy Closed Loop (MVP) | backlog |
| 17.3 Redeploy/Upgrade with Failure Recovery | backlog |
| 17.4 Trigger Adapters (MVP Scope) | backlog |
| 17.5 Deployment History and Audit Surface | backlog |
