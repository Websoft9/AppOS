# Epic 17: Lifecycle Execution Core

**Module**: Application Lifecycle | **Status**: backlog | **Priority**: P1 | **Depends on**: Epic 4, Epic 5, Epic 8, Epic 12, Epic 14

**Domain Reference**: `specs/adr/app-lifecycle-domain-model.md`

## Objective

Provide the canonical execution core for AppOS application lifecycle operations. Epic 17 owns the lifecycle action model, operation execution contract, pipeline orchestration, release baselines, compensation behavior, and execution history for install, change, recovery, publication, maintenance, and retirement actions.

## Requirements

1. Define the canonical lifecycle execution domain contract described in the lifecycle ADR, centered on `OperationJob`, `PipelineRun`, `PipelineNodeRun`, `ReleaseSnapshot`, and execution-facing portions of `RuleProfile`.
2. Support a unified operation model for at least: install, start, stop, upgrade, redeploy, reconfigure, publish, unpublish, backup, recover, rollback, maintain, and uninstall.
3. Normalize all supported action sources into one lifecycle execution contract before queueing or execution.
4. Enforce canonical execution phase vocabulary: `queued`, `validating`, `preparing`, `executing`, `verifying`, and `compensating`.
5. Separate phase, terminal result, failure reason, and app outcome instead of overloading one lifecycle field.
6. Execute lifecycle operations through pipeline families with DAG-based internal orchestration and node-level observability.
7. Persist release baselines and last-known-good snapshots required for recovery and rollback.
8. Implement deterministic compensation behavior for failed change, recovery, and publication-sensitive operations.
9. Expose operation list, detail, status, timeline, and log APIs consumed by lifecycle management surfaces.
10. Reinterpret the current deployment list as an operation execution view rather than the application lifecycle model.

## Acceptance Criteria

- Lifecycle execution APIs are defined around `OperationJob` and related execution objects, not around deploy-only records.
- At least the first five core operations are supported end-to-end on the shared execution core: `install`, `upgrade`, `publish`, `rollback`, and `uninstall`.
- All operation runs expose phase, terminal status, failure reason, and app outcome as separate fields.
- Pipeline execution is observable through phase, node, log, and timing data without projecting node states into the app lifecycle state machine.
- Release snapshots can identify the active, candidate, and last-known-good baselines required for recovery.
- Failed change or recovery flows apply deterministic compensation rules and record whether the app remained on the previous release, activated a new release, or ended in an unknown state.
- Management surfaces can query operation status, history, and timeline data without re-implementing lifecycle execution logic.
- All lifecycle operations emit audit records with actor, action type, target, result, and relevant baseline references.

## MVP Decisions (2026-03-01, updated for lifecycle model)

- API shape: expose async lifecycle operation APIs; keep low-level compose/runtime routes as execution primitives only.
- State store: MVP should create clean lifecycle collections instead of evolving deploy-era records in place.
- Scope: include local and remote targets in MVP, but keep execution semantics identical across targets.
- Sources: support `manualops`, `fileops`, and template/store-driven actions through one normalization path.

## Delivery Strategy (Incremental First)

Epic 17 should not be implemented as a big-bang "complete lifecycle platform". The correct delivery approach is to establish one minimal closed loop on the shared lifecycle execution core, then expand supported operation types and strategy branches in later slices.

### Phase 0: Contract Freeze

Define and review the minimum lifecycle execution contract before building management breadth or advanced strategy branches:

1. `app_operations` persistence shape
2. canonical phase, terminal status, failure reason, and app outcome fields
3. minimum operation spec fields and pipeline contract
4. `app_releases` and last-known-good baseline model
5. per-`server_id` serial execution invariant
6. minimal status/detail/timeline APIs consumed by lifecycle management surfaces

### Phase 1: First Install Closed Loop (Recommended Starting Point)

Build only one narrow execution path first on the shared execution core:

1. target: local server
2. source: `manualops`
3. operation type: `install`
4. input: raw `docker-compose.yml`
5. execution: async operation -> validate -> prepare -> execute -> verify -> status persist
6. output: operation detail/status query + audit trail

This phase exists to prove that the shared lifecycle execution core is viable before adding template resolution, upgrade logic, publication changes, or rollback complexity.

### Phase 2: Template/Store Adapter

After the closed loop is stable, add template/store-backed input normalization into the same lifecycle execution contract.

### Phase 3: Change and Recovery

Only after first install history, release snapshots, and failure recording are stable should upgrade, reconfigure, publish, and rollback behavior be introduced.

## Recommended Development Order

Development should proceed in this order instead of the document order:

1. Story 17.1: freeze lifecycle execution contract, state model, and persistence model
2. Minimal subset of Story 17.5: status/list/detail/timeline APIs and audit linkage required by the first closed loop
3. Story 17.2: first install for ManualOps on the shared async lifecycle pipeline
4. Story 17.4a/17.4b: Store/Git input adapters and UI expansion
5. Story 17.3: change and recovery operations
6. Story 17.6: publication operations on the shared execution core

Reason: without status persistence and query APIs, the lifecycle execution pipeline cannot be observed or integrated by management surfaces, so Story 17.5 cannot remain entirely last.

## Architecture & Technical Decisions (2026-03-02, updated for lifecycle model)

To strictly enforce the "Simplicity First" and "Single-Server Optimization" principles, the lifecycle execution core should reuse the current application runtime where possible and avoid introducing new workflow platforms. MVP should build on the existing embedded async worker model already used by the backend, while keeping the lifecycle contract independent enough to allow later worker refactoring if needed:

1. **Lifecycle mental model vs execution model:** `AppInstance` owns the long-lived product-facing lifecycle state. `OperationJob` owns business action execution state. `PipelineRun` owns DAG execution detail. `ReleaseSnapshot` owns recoverable baselines. `Exposure` owns publication state. These concerns must not collapse back into one deploy record shape.
2. **Clean-slate MVP persistence:** Because AppOS is still pre-release and the current backend lifecycle code is not a compatibility target, Epic 17 should create new lifecycle collections rather than extending or preserving legacy deploy-era schemas.
3. **Execution state model:** Use a strict state model for operation execution, separating phase, terminal status, failure reason, and app outcome. The FSM or equivalent implementation owns legal progression of operation phases only. It does **not** own detailed node execution or product-facing app lifecycle projection.
4. **Concurrency & Execution Engine:** The engine is event-driven via REST API into an async worker queue. For MVP, reuse the existing embedded Asynq/Redis worker infrastructure already present in the backend, but enforce lifecycle scheduling rules at the application layer: cross-server parallel execution, but single-server strictly serial execution for conflicting operations.
5. **Long-Running Task Resilience:** Avoid complex long-task managers. Use Go's native `context.Context` for timeout control and expose low-latency execution logs and node progress for timeline views.
6. **Resolver/Normalizer Gate:** All supported lifecycle actions must pass a backend Resolver/Normalizer before queue insertion. The resolver merges multi-source inputs into one deterministic operation contract.
7. **Compose-first baseline:** For Store/template-backed apps, the required execution baseline remains a plain compose-oriented runtime plan. Optional metadata stays minimal and expresses lifecycle-relevant hints instead of replacing the baseline.

### Current Architecture Alignment Note

The repository already contains:

1. embedded async worker infrastructure
2. existing Docker compose execution primitives under `/api/ext/docker/compose/*`
3. PocketBase-based persistence and audit pipelines

Epic 17 MVP should reuse these foundations rather than replacing them before the first lifecycle execution closed loop is proven.

### Canonical Execution Model

The lifecycle execution core should be understood as a progression from action request acceptance to a terminal, operator-meaningful result:

1. `phase`: `queued`, `validating`, `preparing`, `executing`, `verifying`, `compensating`
2. `terminal_status`: `success`, `failed`, `cancelled`, `compensated`, `manual_intervention_required`
3. `failure_reason`: classified cause such as `timeout`, `validation_error`, or `verification_failed`
4. `app_outcome`: whether a new release became active, the previous release remained active, no healthy release remained, or the resulting state is unknown

For MVP, implementation may begin with a narrower active subset such as `install -> queued -> validating -> preparing -> executing -> verifying -> success/failed`, while reserving the full contract shape in the model.

## Operational Guardrails (MVP)

1. **Scheduling invariant:** For each `server_id`, at most one conflicting lifecycle operation may be executing or compensating at any time. Enforce this in both worker routing and database query/lock logic.
2. **Timeout policy matrix:** Use stage-specific timeout budgets managed by `context.Context`:
   - image pull
   - compose apply (`up`/`down`)
   - health-gate wait
   On timeout, record `failure_reason = timeout` and enter compensation when the selected strategy requires it.
3. **Realtime log streaming contract:** Stream execution logs as ordered chunks with sequence numbers and timestamps. Single-run log cap: **5 MB** (truncate oldest lines when exceeded). Apply backpressure-safe buffering to protect control-plane memory.
4. **Process restart / orphan task recovery:** On control-plane startup, scan for any jobs left in active execution phases. Immediately mark them failed or compensation-required based on available baselines. Never silently resume a mid-flight job whose actual runtime state is unknown.
5. **First-install failure semantics:** A first-time install has no last-known-good snapshot. On failure, execute cleanup of unactivated runtime resources and mark the job `failed`. Do not attempt release rollback when no recoverable baseline exists.
6. **Pre-queue normalization hard rule:** Worker processes must consume only normalized operation records. Raw inputs from UI/Git/file sources are forbidden in worker payloads.

## Minimal Delivery Path

1. Define operation contract and canonical execution fields.
2. Persist operation status/history and release baselines, and expose status/list/detail/timeline APIs.
3. Wire async worker execution for the first operation family, reusing existing runtime execution layer.
4. Start with first install on ManualOps/local server before expanding to other adapters and operation types.
5. Keep compensation minimal at first: cleanup for first install failure and baseline rollback for upgrade failure.

## Unified Lifecycle Execution Pipeline (Minimal)

1. Define target app and operation: normalize all inputs into one operation contract.
2. Prepare infrastructure: validate target host, runtime, ports, volumes, credentials, permissions, and publication prerequisites when relevant.
3. Prepare baseline: resolve source, config, env, and release baseline required for the operation.
4. Prepare orchestration: render a compose-oriented execution plan and supporting metadata for the selected pipeline family.
5. Run operation: execute async lifecycle phases (`queued` -> `validating` -> `preparing` -> `executing` -> `verifying`), then enter `compensating` only when lifecycle rules require it.
6. Project results: update release baselines, operation result fields, and any publication or app outcome projections.

## App Template Contract (Minimal)

For Store/template-backed apps, keep the authoring model intentionally small:

1. **Required base compose:** each app package must include a runnable `docker-compose.yml`.
2. **Optional minimal metadata:** `app-metadata.yml` is optional and should contain only platform hints that compose does not express well: entrypoint, persistent paths, addon list, and required user inputs.
3. **Optional generic addons:** addon compose files are optional overlays selected by the resolver. Addons stay capability-focused and business-agnostic.
4. **Resolved output:** the resolver produces one normalized operation spec containing the rendered compose, resolved env map, selected addon list, and final `compose_project_name` for per-install isolation.

## Lifecycle Input Adapters (Minimal)

**MVP scope (delivery order):**
- ManualOps (raw YAML): user-supplied `docker-compose.yml` text -> validated -> normalized operation spec.
- Store Compose: app template package (`docker-compose.yml` + optional `app-metadata.yml` + optional addon compose files) + user params -> normalized operation spec.

**Post-MVP (deferred):**
- Docker Run Command: parse `docker run` args and convert to compose-compatible operation spec.
- Source Build: source repo/context + build config -> built image -> normalized operation spec.
- Guided by App Name: interactive collection of required options (ports/env/volume/network) -> normalized operation spec.

- Rule: adapters differ only at input stage; execution, status, and compensation stay on one shared lifecycle core.

## Future Extension: AI Agent Guidance

- AI agent participation is optional and non-blocking; manual flow must always remain available.
- AI focuses on guided input collection and decision suggestions (ports, volumes, env defaults, health checks).
- AI outputs must be normalized into the same deterministic lifecycle operation contract before execution.
- High-impact decisions (public exposure, destructive change, rollback strategy) require explicit user confirmation.
- Store AI rationale and selected options in operation metadata for auditability and postmortem review.

## Integration Notes

- Reuse Docker/container execution primitives from Epic 4.
- Reuse app definition and source metadata from Epic 5.
- Reuse resource credentials and server context from Epic 8.
- Reuse file and IaC editing APIs from Epic 14 for FileOps source-of-truth inputs.
- Control plane may execute lifecycle operations to multiple managed servers concurrently, but each target server remains strictly serialized for conflicting actions.
- Publish operation execution state for Epic 18 lifecycle management entry points and status views.
- Emit events/logs for future Monitoring epic consumption; this epic does not own full observability stack.
- Reuse audit pipeline from Epic 12; no duplicate audit subsystem.

## Out of Scope

- Installed app inventory projections and unified management workspace design.
- Lifecycle detail page information architecture owned by management surfaces.
- Broad UI treatment for configuration, backup browsing, or publication management beyond the execution contract they consume.
- Full observability platform features (metrics dashboards, alert routing, long-term log analytics).
- Cluster-level orchestrators, distributed scheduling planes, and multi-node release strategies.

## Stories

### Story 17.1 Lifecycle Contract and Scheduler Core

Define the lifecycle execution input model, `ReleaseSnapshot` model, `OperationJob` state structure, and scheduler core. Must specify: (a) canonical phase, terminal status, failure reason, and app outcome fields; (b) explicit separation of responsibility between `AppInstance`, `OperationJob`, `PipelineRun`, `ReleaseSnapshot`, and `Exposure`; (c) backend Resolver/Normalizer contract; (d) normalized operation spec persistence location; (e) release snapshot schema for promotion and rollback reference; (f) per-`server_id` serial invariant and orphan-task recovery semantics; (g) user-initiated cancel semantics; (h) minimal template contract for lifecycle execution.

### Story 17.2 First Install Closed Loop (MVP)

Implement first-time install end-to-end on the shared lifecycle execution core with validation, async execution, realtime logs, and minimal status/detail APIs required by management views.

Implementation order inside this story:

1. local server only
2. ManualOps raw compose input only
3. operation record creation and state transitions
4. compose apply using existing Docker execution primitives
5. detail/list/status/timeline query APIs

### Story 17.3 Change and Recovery Operations

Implement upgrade, redeploy, reconfigure, recover, and rollback execution paths for managed apps, including timeout handling, deterministic failure states, and compensation to last-known-good baselines when available.

### Story 17.4 Input Adapters (MVP Scope)

Implement MVP trigger/input adapters through the shared Resolver/Normalizer pipeline with source attribution, then emit a normalized operation spec for queue insertion. For the current delivery slice, split adapter work into separate stories so Store entry, Git-based compose retrieval, and future adapters do not blur the execution-core scope.

Subtasks:
- **17.4a Store Direct Install UI (MVP):** Build Store entry UI path to prefill lifecycle execution inputs from library/template assets and create an install job from the shared pipeline.
- **17.4b Git Compose Adapter (MVP):** Build git-based compose input flow, including repository metadata resolution and optional private-repository auth handling for compose retrieval.
- **17.4c Docker Run Adapter UI/API (Post-MVP):** Accept `docker run` command input, parse/normalize server-side into a compose-compatible operation spec, then enter the shared queue pipeline.
- **17.4d Source Package Adapter UI/API (Post-MVP):** Accept source package/build config input, resolve into a build-and-run compose plan, normalize to an operation spec, then enter the shared queue pipeline.

### Story 17.5 Operation History and Timeline Surface

Implement operation run history, status/list/detail/timeline query APIs, and audit linkage required by lifecycle management integration.

Note: a minimal subset of this story is required before Story 17.2 is considered complete, because the first install closed loop must be observable and queryable.

### Story 17.6 Publication Operations on Shared Execution Core

Implement publication-oriented operations on the shared lifecycle execution core, including `publish` and `unpublish`, with `Exposure` state updates, verification, and compensation-aware failure behavior.

## Story Status

| Story | Status |
|-------|--------|
| 17.1 Lifecycle Contract and Scheduler Core | in-progress |
| 17.2 First Install Closed Loop (MVP) | in-progress |
| 17.3 Change and Recovery Operations | backlog |
| 17.4a Store Direct Install UI (MVP) | in-progress |
| 17.4b Git Compose Adapter (MVP) | in-progress |
| 17.5 Operation History and Timeline Surface | in-progress |
| 17.6 Publication Operations on Shared Execution Core | backlog |

## Story Artifacts

- `story17.1-lifecycle-contract.md`
- `story17.2-first-install.md`
- `story17.4a-store-deploy.md`
- `story17.4b-git-compose.md`
- `story17.5-operation-history-timeline.md`

## Backend Work Packages

This section is the executable backend implementation breakdown for Epic 17. It is not a separate epic or story. Its only purpose is to translate the lifecycle model into development workstreams and recommended sequencing.

### Recommended Delivery Order

1. Collection migrations
2. Projection and lifecycle service layer
3. Operation creation API
4. Worker scheduling and install execution
5. Timeline and detail APIs
6. Final app list/detail projections consumed by Epic 18

Reason: without schema and projection rules, the worker path and APIs will drift from the lifecycle model.

### Workstream A: Collections

1. Create `app_instances`
   Purpose: canonical managed application identity and lifecycle projection
   Done when: fields, enums, rules, and indexes match the lifecycle collection draft and one record maps to one managed app instance
2. Create `app_operations`
   Purpose: canonical lifecycle action store
   Done when: install can be represented end-to-end using separate `phase`, `terminal_status`, `failure_reason`, and `app_outcome` fields
3. Create `app_releases`
   Purpose: release baseline and rollback store
   Done when: first install success can create an active and last-known-good release baseline
4. Create `app_exposures`
   Purpose: publication and entry-point store
   Done when: the schema exists for future publish and unpublish operations without redesign
5. Create `pipeline_runs`
   Purpose: one record per operation-level DAG instance
   Done when: one install operation can own one persisted pipeline timeline root
6. Create `pipeline_node_runs`
   Purpose: one record per DAG node execution instance
   Done when: node-by-node progress and failed node visibility no longer depend on opaque JSON blobs

### Workstream B: Migrations

1. Create initial lifecycle migration set
   Tasks: create the six lifecycle collections in dependency-safe order and enforce field types, enums, indexes, and rules from the collection draft
   Done when: clean install produces lifecycle-native collections for this domain
2. Remove or archive legacy lifecycle schema
   Tasks: remove or archive `deployments` from the new lifecycle path and avoid adding new lifecycle fields to old deploy-era schema
   Done when: no new lifecycle feature depends on `deployments`
3. Verify clean-install behavior
   Tasks: run clean install migrations and confirm the schema matches the collection draft exactly
   Done when: clean install path matches the new lifecycle model without stale collection names

### Workstream C: Hooks And Lifecycle Services

1. Build lifecycle projection service
   Tasks: update `app_instances.lifecycle_state`, `health_summary`, `current_release`, and `last_operation` based on operation and release outcomes
   Done when: install can project `registered -> installing -> running_healthy` or a safe failure state
2. Build release baseline service
   Tasks: create candidate and active release helpers and ensure first install failure never leaves a fake active release
   Done when: first install success always produces a valid active release baseline
3. Build pipeline timeline service
   Tasks: create `pipeline_runs`, create `pipeline_node_runs`, and update aggregate execution progress as nodes advance
   Done when: operation detail can render a timeline from persisted rows alone
4. Add validation and consistency hooks
   Tasks: reject invalid backend-controlled writes and prevent contradictory lifecycle state combinations
   Done when: lifecycle invariants remain intact under direct write attempts

### Workstream D: APIs

1. Create operation creation API
   Purpose: start first install from ManualOps
   Done when: one API call can create `app_instances`, `app_operations`, and the initial worker payload safely
2. Create operation list and detail APIs
   Done when: management surfaces can query operation history without reconstructing raw PocketBase state client-side
3. Create timeline API
   Done when: one response can return operation execution status, `pipeline_runs`, `pipeline_node_runs`, and log metadata needed for timeline rendering
4. Create app list and detail projection APIs
   Done when: Epic 18 can render installed app list/detail from lifecycle projections instead of raw operation rows

### Workstream E: Worker And Executor

1. Implement install pipeline planner
   Suggested first node set:
   - `validate_compose_input`
   - `prepare_workspace`
   - `render_runtime_config`
   - `apply_runtime_plan`
   - `verify_runtime_health`
   - `finalize_first_release`
   Done when: install runs through a stable, inspectable capability-level timeline
2. Implement first install executor path
   Tasks: load operation record, advance canonical phases, execute nodes with existing runtime primitives, and persist node and operation progress continuously
   Done when: first install works end-to-end for local ManualOps input
3. Implement first install failure handling
   Tasks: classify failures, clean residual runtime state, persist terminal failure, and project app state safely
   Done when: failed first install neither attempts rollback nor leaves fake active release state
4. Implement scheduling invariant
   Tasks: enforce one conflicting active lifecycle operation per `server_id` while allowing cross-server parallel execution
   Done when: conflicting operations cannot run concurrently on one target server

### Workstream F: Testing And Verification

1. Migration verification
   Done when: clean install migration path produces the expected lifecycle schema
2. Lifecycle projection verification
   Done when: `registered -> installing -> running_healthy` and failed-first-install projections are both covered
3. Timeline verification
   Done when: pipeline run creation, node ordering, and failed-node visibility are tested
4. Scheduling verification
   Done when: per-server conflict blocking, cross-server concurrency, and restart recovery are covered

### MVP Cut Line

The backend MVP is complete for the first lifecycle closed loop when all of the following are true:

1. lifecycle collections exist and migrate cleanly
2. ManualOps first install creates `app_instances`, `app_operations`, `pipeline_runs`, and `pipeline_node_runs`
3. first install success creates and activates `app_releases`
4. first install failure cleans up and records terminal failure correctly
5. app list and operation detail APIs expose enough data for management surfaces
6. one-server conflict scheduling is enforced

### Immediate Start Sequence

1. Workstream A
2. Workstream B
3. Workstream C1 and C2
4. Workstream D1
5. Workstream E1 and E2

That is the shortest path to a real install closed loop.
