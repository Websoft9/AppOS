# Lifecycle Pipeline Execution Engine

## Status
Proposed

## Context

Epic 17 already defines the lifecycle domain model, API surface, and collection model, but it does not yet freeze one minimal execution-engine contract for:

1. how `app_operations` are executed by workers
2. how `pipeline_runs` and `pipeline_node_runs` advance
3. what a pipeline node is allowed to do at runtime

The repository already uses an embedded Asynq worker. Epic 17 MVP should reuse that runtime instead of introducing a new workflow platform.

## Decisions

### 1. Execution ownership

1. `OperationJob` declares the requested business action and owns `phase`, `terminal_status`, `failure_reason`, and `app_outcome`.
2. `PipelineRun` is the persisted execution instance for one selected pipeline definition.
3. `PipelineNodeRun` is the smallest independently observable execution unit.
4. `AppInstance` is updated by projection rules and must not be used as the worker's in-flight state store.

### 2. Worker model

The lifecycle execution engine uses the existing embedded Asynq worker and queues by `operation_id`.

The worker is the execution host, not the business workflow brain.

The worker is split into four logical layers:

1. scheduler: claims one runnable operation and enforces per-`server_id` serial execution for conflicting operations
2. runner: loads the selected pipeline definition and advances the `PipelineRun`
3. node executor: executes one ready node using runtime primitives such as compose validation, workspace preparation, compose apply, health checks, proxy changes, or file operations
4. projection writer: persists terminal results and updates `AppInstance`, `ReleaseSnapshot`, and other lifecycle projections when required

The minimal execution flow is:

1. Asynq worker: receives one operation task
2. scheduler: decides whether the operation may run now
3. runner: selects the next ready pipeline node
4. node executor: executes that node
5. runner: decides whether to continue, pause, fail, or finish based on the node result
6. projection writer: persists app, release, and operation outcomes when required

Worker payloads must contain only normalized lifecycle data or an `operation_id`. Raw adapter input must never cross the queue boundary.

### 3. Pipeline definition model

Pipeline definitions are metadata-driven and selected by:

`operation_type + source + adapter -> pipeline definition`

Each definition must declare:

1. `family`
2. `initial_phase`
3. ordered nodes with dependency edges
4. node phase ownership
5. retry and manual-gate behavior

The MVP execution engine remains a rigid DAG runner, not a general-purpose workflow engine.

### 4. Node contract

Each node must represent one independently observable business execution unit.

Nodes are bound to executors by capability, not by one-executor-per-node-key. Multiple nodes may reuse one executor when they share the same execution capability and runtime semantics. A dedicated executor is only needed when a node family has materially different side effects, timeout behavior, or recovery rules.

Each node may define:

1. `depends_on`
2. `retryable`
3. `manual_gate`
4. `writes_projection`
5. `compensation_node_key`

For MVP, node execution is driven by persisted status transitions on `pipeline_node_runs`. A node is either pending, running, succeeded, failed, cancelled, or compensated.

Long-running nodes remain inside the current worker execution path. They should stream logs, obey stage-specific timeouts, and return a node result to the runner instead of recursively creating hidden sub-workflows.

### 5. Execution loop

The runner advances one operation through this loop:

1. claim operation
2. load operation, pipeline run, and node runs
3. find ready nodes
4. execute ready node or nodes
5. persist node result and pipeline summary
6. continue until success, failed, cancelled, compensated, or manual intervention is required

The safest default control flow is:

1. Asynq delivers one `operation_id` to the worker
2. scheduler decides whether the operation may run now
3. runner selects the next ready node
4. node executor runs the node and returns `success`, `failed`, `waiting`, or `manual_gate`
5. runner persists the result and decides whether to continue, pause, or finish

If a node must wait on an external condition, the operation should be persisted in a waiting state and later resumed through an explicit continuation path. Node executors should not freely create nested orchestration flows.

### 6. MVP scope

Epic 17 MVP only needs one fully working path:

1. `install`
2. source `manualops`
3. adapter `manual-compose`
4. local target first, remote reuse through the same worker path later

The first closed loop is:

`validate_spec -> prepare_workspace -> render_runtime_config -> start_runtime -> verify_runtime_health`

### 7. Guardrails

1. long-running tasks remain async and are controlled by stage-specific `context.Context` timeouts
2. orphaned in-flight operations are never resumed silently after process restart
3. first install failure performs cleanup, not rollback
4. resume and retry behavior are policy-controlled and not assumed for every node
5. Asynq is used as the worker runtime, not as the lifecycle orchestration model itself

## Consequences

This keeps Epic 17 aligned with the current backend runtime while giving the team one minimal contract for worker execution, pipeline progression, and node behavior.