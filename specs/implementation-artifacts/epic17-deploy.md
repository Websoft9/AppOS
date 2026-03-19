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
- Store/template-backed apps keep a required base `docker-compose.yml`; optional metadata and addon files may modify the final rendered plan but do not replace the base compose as the execution baseline.
- Deployment trigger source is recorded as `gitops`, `fileops`, or `manualops` for each run.
- Invalid deployment inputs fail fast before runtime apply with actionable error output.
- Each deployment run has a stable lifecycle state chosen from the canonical set: `queued`, `validating`, `preparing`, `running`, `verifying`, `success`, `failed`, `rolling_back`, `rolled_back`, `cancelled`, `timeout`, `manual_intervention_required`.
- On failed deploy after apply, system performs rollback to last-known-good release and records result.
- Operations views can query deployment status and link to run details without owning deploy logic.
- All deployment and rollback actions emit audit records with actor, action, target, and result.

## MVP Decisions (2026-03-01)

- API shape: add a new async deploy API; keep `/api/ext/docker/compose/*` as low-level execution primitives.
- State store: add a `deployments` collection for lifecycle/status/history (audit remains event trail).
- Scope: include local and remote targets in MVP.
- Sources: support `manualops`, `fileops`, and template/store-driven deploy through one orchestration path.

## Delivery Strategy (Incremental First)

Epic 17 should not be implemented as a big-bang "complete deployment platform". The correct delivery approach is to establish one minimal closed loop first, then expand adapters and recovery features in later slices.

### Phase 0: Contract Freeze

Define and review the minimum deploy contract before building UI breadth or advanced recovery logic:

1. `deployments` persistence shape
2. canonical lifecycle states, lifecycle events, and legal transitions
3. minimum `DeploymentSpec` fields
4. per-`server_id` serial execution invariant
5. first-deploy failure cleanup semantics
6. minimal status/detail APIs consumed by Operations

### Phase 1: First Deploy Closed Loop (Recommended Starting Point)

Build only one narrow execution path first:

1. target: local server
2. source: `manualops`
3. input: raw `docker-compose.yml`
4. execution: async deploy job -> validate -> compose up -> status persist
5. output: deployment detail/status query + audit trail

This phase exists to prove that the shared orchestration core is viable before adding template resolution, upgrade logic, or rollback complexity.

### Phase 2: Template/Store Adapter

After the closed loop is stable, add template/store-backed input normalization into the same `DeploymentSpec` pipeline.

### Phase 3: Upgrade and Rollback

Only after first deploy history, release snapshots, and failure recording are stable should upgrade/redeploy rollback logic be introduced.

## Recommended Development Order

Development should proceed in this order instead of the document order:

1. Story 17.1: freeze contract, FSM, and persistence model
2. Minimal subset of Story 17.5: status/list/detail APIs and audit linkage required by the first closed loop
3. Story 17.2: first deploy for ManualOps on the shared async pipeline
4. Story 17.4a/17.4b: Store/ManualOps input adapters and UI expansion
5. Story 17.3: redeploy/upgrade and rollback

Reason: without status persistence and query APIs, the deploy pipeline cannot be observed or integrated by Operations, so Story 17.5 cannot remain entirely last.

## Architecture & Technical Decisions (2026-03-02)

To strictly enforce the "Simplicity First" and "Single-Server Optimization" principles, the deployment engine should reuse the current application runtime where possible and avoid introducing new deployment frameworks (e.g., Terraform, Airflow). MVP should build on the existing embedded async worker model already used by the backend, while keeping the deploy contract independent enough to allow later worker refactoring if needed:

1. **State Machine (FSM):** Use a strict Finite State Machine (e.g., `looplab/fsm` or a native Go struct) to govern the single-entity lifecycle only. The FSM owns lifecycle progression, canonical states, lifecycle events, and legal transitions. The FSM does **not** own deployment execution actions such as compose validation, file upload, remote directory preparation, `docker compose up/down`, health checks, or log streaming. Those actions remain in the worker/executor layer and emit lifecycle events back into the FSM. Canonical lifecycle states are: `queued`, `validating`, `preparing`, `running`, `verifying`, `success`, `failed`, `rolling_back`, `rolled_back`, `cancelled`, `timeout`, `manual_intervention_required`.
2. **Concurrency & Execution Engine:** The engine is event-driven via REST API into an async worker queue. For MVP, reuse the existing embedded Asynq/Redis worker infrastructure already present in the backend, but enforce deploy-specific scheduling rules at the application layer: *cross-server parallel execution, but single-server strictly serial execution*. Normalization of diverse inputs into a single `DeploymentSpec` must occur synchronously *before* entering the queue.
3. **Long-Running Task Resilience:** Avoid complex long-task managers. Instead, use Go's native `context.Context` (with timeouts) to terminate hung shell executions (e.g., `os/exec` wrapping `docker compose up`). Improve user wait anxiety via low-latency WebSocket/SSE multiplexed stdout/stderr log streams.
4. **Resolver/Normalizer Gate:** All deployment requests must pass a backend Resolver/Normalizer before queue insertion. The resolver merges multi-source inputs (Store form values, ManualOps YAML, defaults, server context) into one deterministic `DeploymentSpec`.
5. **Compose-First App Template Contract:** For Store/template-backed apps, the required execution baseline is a plain `docker-compose.yml`. Optional `app-metadata.yml` stays minimal and is used only to declare platform-specific hints such as entrypoint, persistent paths, optional addon compose files, and required user inputs. Optional addon compose files (for example MySQL/Postgres/Redis) must be generic capability bundles, not app-specific business templates.

### Current Architecture Alignment Note

The repository already contains:

1. embedded async worker infrastructure
2. existing Docker compose execution primitives under `/api/ext/docker/compose/*`
3. PocketBase-based persistence and audit pipelines

Epic 17 MVP should reuse these foundations rather than replacing them before the first deploy closed loop is proven.

### Lifecycle Model (Canonical)

The deployment lifecycle should be understood as a progression from request acceptance to a terminal, operator-meaningful result:

1. `queued` — deployment request accepted and persisted, not yet executing
2. `validating` — validating normalized inputs and target environment preconditions
3. `preparing` — preparing execution workspace, files, rendered compose, and remote/local prerequisites
4. `running` — executing deployment actions such as `docker compose up`
5. `verifying` — verifying the deployment result, including health gates and readiness checks
6. `success` — deployment completed and verification passed
7. `failed` — deployment terminated unsuccessfully without automatic recovery success
8. `rolling_back` — compensating to a last-known-good release
9. `rolled_back` — rollback completed successfully
10. `cancelled` — deployment stopped due to explicit user cancellation
11. `timeout` — deployment exceeded stage or job timeout budget
12. `manual_intervention_required` — deployment reached a non-recoverable ambiguous state requiring operator action

For MVP, implementation may begin with a narrower active subset such as `queued -> validating -> preparing -> running -> verifying -> success/failed`, while still reserving the full canonical set in the contract.

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

1. Define deploy job contract and lifecycle states. The canonical model is `queued` → `validating` → `preparing` → `running` → `verifying` → `success`/`failed`, with optional recovery and control branches into `rolling_back`, `rolled_back`, `cancelled`, `timeout`, and `manual_intervention_required` as the product matures.
2. Persist run status/history in `deployments` and expose status/list/detail APIs for Operations.
3. Wire async worker execution for deploy jobs, reusing existing Docker compose execution layer.
4. Start with first deploy on ManualOps/local server before expanding to other adapters.
5. Keep rollback minimal: compose-level rollback to last-known-good snapshot with result recording.

## Unified Deployment Pipeline (Minimal)

1. Define target app (`what to deploy`): normalize all inputs into one `DeploymentSpec`.
2. Prepare infrastructure: validate target host, runtime, ports, volumes, credentials, and permissions.
3. Prepare deployable artifact: use image directly, then version/tag snapshot. (Source build is a post-MVP extension point.)
4. Prepare orchestration: render unified compose-oriented execution plan from normalized spec, base compose, selected addon compose files, and resolved env values.
5. Run deployment: execute async job lifecycle (`queued` → `validating` → `preparing` → `running` → `verifying` → `success`/`failed`), then enter `rolling_back`/`rolled_back` or other terminal branches only when the lifecycle rules require them.
6. Publish access: output endpoint/access info and final health result.

## App Template Contract (Minimal)

For Store/template-backed apps, keep the authoring model intentionally small:

1. **Required base compose:** each app package must include a runnable `docker-compose.yml`.
2. **Optional minimal metadata:** `app-metadata.yml` is optional and should contain only platform hints that compose does not express well: entrypoint, persistent paths, addon list, and required user inputs.
3. **Optional generic addons:** addon compose files are optional overlays selected by the resolver (for example bundled MySQL vs external DB mode). Addons stay capability-focused and business-agnostic.
4. **Resolved output:** the resolver produces one `DeploymentSpec` containing rendered compose, resolved env map, selected addon list, and final `compose_project_name` for per-install isolation.

## Deployment Input Adapters (Minimal)

**MVP scope (delivery order):**
- ManualOps (raw YAML): user-supplied `docker-compose.yml` text -> validated -> `DeploymentSpec`.
- Store Compose: app template package (`docker-compose.yml` + optional `app-metadata.yml` + optional addon compose files) + user params -> `DeploymentSpec`.

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

Define deployment input model, release snapshot model, and deployment job state machine. Must specify: (a) canonical FSM state set, lifecycle events, and allowed transitions, including the MVP path `queued` → `validating` → `preparing` → `running` → `verifying` → `success`/`failed`; (b) explicit separation of responsibility between lifecycle progression owned by the FSM and execution actions owned by worker/executor layers; (c) backend Resolver/Normalizer contract (input merge precedence, validation errors, deterministic output rules); (d) `DeploymentSpec` schema and its persistence location (stored as a JSON field on the `deployments` collection record, alongside the rendered compose YAML and resolved env map); (e) release snapshot schema for rollback reference; (f) per-`server_id` serial invariant and orphan-task recovery semantics; (g) user-initiated cancel semantics; (h) minimal app template contract: base compose, optional metadata, optional addon overlays, resolved capability mode (`bundled`/`resource`/`external`), and generated `compose_project_name` per install.

### Story 17.2 First Deploy Closed Loop (MVP)

Implement first-time deployment end-to-end with pre-deploy validation, async execution, realtime logs, and minimal status/detail APIs required by Operations views.

Implementation order inside this story:

1. local server only
2. ManualOps raw compose input only
3. deployment record creation and state transitions
4. compose apply using existing Docker execution primitives
5. detail/list/status query APIs

### Story 17.3 Redeploy/Upgrade with Failure Recovery

Implement re-deploy/upgrade execution path for installed apps, including timeout handling, deterministic failure states, and rollback to last-known-good snapshot when available.

### Story 17.4 Trigger Adapters (MVP Scope)

Implement MVP trigger/input adapters through the shared Resolver/Normalizer pipeline with source attribution, then emit a normalized `DeploymentSpec` for queue insertion. For the current delivery slice, split adapter work into separate stories so Store entry, Git-based compose retrieval, and future adapters do not blur the execution-core scope.

Subtasks:
- **17.4a Store Direct Deploy UI (MVP):** Build Store entry UI path to prefill deployment inputs from library/template assets and create a deploy job from the shared pipeline.
- **17.4b Git Compose Adapter (MVP):** Build git-based compose input flow, including repository metadata resolution and optional private-repository auth header handling for compose retrieval.
- **17.4c Docker Run Adapter UI/API (Post-MVP):** Accept `docker run` command input, parse/normalize server-side into compose-compatible `DeploymentSpec`, then enter shared queue pipeline.
- **17.4d Source Package Adapter UI/API (Post-MVP):** Accept source package/build config input, resolve into build-and-deploy compose plan, normalize to `DeploymentSpec`, then enter shared queue pipeline.

### Story 17.5 Deployment History and Audit Surface

Implement deployment run history, status/list/detail query APIs, and audit linkage required by Operations integration.

Note: a minimal subset of this story is required before Story 17.2 is considered complete, because the first deploy closed loop must be observable and queryable.

## Story Status

| Story | Status |
|-------|--------|
| 17.1 Deploy Contract and Scheduler Core | in-progress |
| 17.2 First Deploy Closed Loop (MVP) | in-progress |
| 17.3 Redeploy/Upgrade with Failure Recovery | backlog |
| 17.4a Store Direct Deploy UI (MVP) | in-progress |
| 17.4b Git Compose Adapter (MVP) | in-progress |
| 17.5 Deployment History and Audit Surface | in-progress |

## Story Artifacts

- `story17.1-deploy-contract.md`
- `story17.2-first-deploy.md`
- `story17.4a-store-deploy.md`
- `story17.4b-git-compose.md`
- `story17.5-history-audit.md`
