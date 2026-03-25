# Application Lifecycle Domain Model

## Status
Proposed

## Context
AppOS is no longer only designing a deployment feature. It is defining a complete application lifecycle model for single-server self-hosted environments, covering install, publish, operate, maintain, change, recover, stop, and retire.

The current deployment model and UI are centered on deployment execution status. That is no longer sufficient for the next stage of product evolution because it mixes multiple concerns into one concept:

1. the long-lived lifecycle state of an application instance
2. the short-lived execution state of one operation
3. the release baseline used for upgrade and rollback
4. the external publication state exposed through proxy and domain binding
5. the execution graph used to run tasks
6. the policy decisions that vary by app type, source type, or risk profile

Without separating these concerns, the system will continue to accumulate ambiguity in API design, frontend projections, audit trails, and failure recovery behavior.

This document defines the canonical domain model for application lifecycle management in AppOS using the agreed layered combination:

1. state machine for external mental model
2. DAG for internal execution orchestration
3. Saga for failure compensation
4. lightweight rule tables for strategy decisions

Companion field draft: `specs/adr/app-lifecycle-field-definitions.md`

## Decisions

### 1. Canonical domain objects

AppOS application lifecycle management is defined by six primary domain objects and one execution sub-object:

| Object | Role | Main question answered |
| --- | --- | --- |
| `AppInstance` | lifecycle root object | What is the overall lifecycle state of this application? |
| `ReleaseSnapshot` | release baseline object | Which release/config baseline is active, recoverable, or last-known-good? |
| `OperationJob` | business action object | What operation is being performed right now, and what is its result? |
| `PipelineRun` | execution graph object | How is this operation being executed internally? |
| `PipelineNodeRun` | execution node object | Which node is running, blocked, failed, retried, or completed? |
| `Exposure` | publication object | Is the application externally exposed and healthy through proxy/domain binding? |
| `RuleProfile` | strategy object | Which validation, execution, compensation, and publication rules apply? |

These objects are deliberately separated. AppOS must not model the entire lifecycle only through deployment records.

### 2. Object responsibilities

| Object | Responsibilities | Explicitly not responsible for |
| --- | --- | --- |
| `AppInstance` | identity, ownership, lifecycle state, desired state, current active release reference, health summary | detailed execution steps of one task |
| `ReleaseSnapshot` | version baseline, rendered spec baseline, config snapshot, source reference, recoverability marker | application lifecycle state |
| `OperationJob` | operation type, actor, execution state, result, failure reason, target object references | long-term app state projection |
| `PipelineRun` | instantiated DAG phases, node dependency graph, execution progress, timings | product-facing lifecycle meaning |
| `PipelineNodeRun` | node-level execution status, retries, logs, error codes, compensation link | business semantics |
| `Exposure` | domain binding, route binding, certificate mode, external endpoint health, publication state | internal runtime state of containers |
| `RuleProfile` | policy selection for validation, execution strategy, compensation strategy, publication strategy | runtime execution history |

### 3. State ownership rules

State ownership is fixed by domain object. This rule is mandatory.

| State or semantic | Canonical owner | Must not be modeled as |
| --- | --- | --- |
| `registered`, `running_healthy`, `maintenance` | `AppInstance.lifecycle_state` | operation state |
| `queued`, `validating`, `executing`, `compensating` | `OperationJob.phase` or `PipelineRun.phase` | app lifecycle state |
| `success`, `failed`, `cancelled`, `compensated` | `OperationJob.terminal_status` | app lifecycle state |
| `timeout`, `verification_failed`, `resource_conflict` | `OperationJob.failure_reason` | top-level app state |
| `published`, `publication_failed` | `Exposure.publication_state` | app lifecycle state |
| `last_known_good`, `active`, `candidate` | `ReleaseSnapshot` | app lifecycle state |
| `backup_required`, `blue_green`, `manual_gate_before_publish` | `RuleProfile` | state machine node |

`timeout` is explicitly a failure reason, not a top-level lifecycle state.

### 4. AppInstance lifecycle state machine

`AppInstance` is the only product-facing long-lived lifecycle state machine.

| State | Meaning | Typical user interpretation |
| --- | --- | --- |
| `registered` | app instance exists in management but has not completed first install | known to AppOS, not running yet |
| `installing` | first install operation is in progress | being installed |
| `running_healthy` | an active release exists and runtime plus publication expectations are met | running normally |
| `running_degraded` | an active release exists but runtime or publication health is degraded | running with risk |
| `maintenance` | app is in controlled maintenance mode | intentionally under maintenance |
| `updating` | a change operation is in progress, including upgrade, redeploy, reconfigure, or publish change | being changed |
| `recovering` | rollback or recovery is in progress | recovering to a safe baseline |
| `stopped` | app has been intentionally stopped but remains managed | stopped intentionally |
| `attention_required` | AppOS cannot safely auto-converge and operator action is required | needs manual intervention |
| `retired` | app lifecycle has ended and it is no longer active in management | retired or uninstalled |

`AppInstance` does not carry internal execution detail such as `validating`, `preparing`, or `verifying`.

### 5. Lifecycle stages

The product lifecycle is defined in eight user-meaningful stages:

1. introduce
2. install
3. run
4. maintain
5. change
6. recover
7. stop
8. retire

These stages are conceptual product stages. They are not one-to-one execution states and must not be implemented as an alternative to the `AppInstance` state machine.

### 6. OperationJob model

`OperationJob` represents one business action request against an `AppInstance`.

#### 6.1 Supported operation types

AppOS should standardize the following operation types as the canonical first set:

1. `install`
2. `start`
3. `stop`
4. `upgrade`
5. `redeploy`
6. `reconfigure`
7. `publish`
8. `unpublish`
9. `backup`
10. `recover`
11. `rollback`
12. `maintain`
13. `uninstall`

#### 6.2 Operation state shape

`OperationJob` state is split into four fields instead of one overloaded state field.

| Field | Purpose | Suggested values |
| --- | --- | --- |
| `phase` | current execution phase | `queued`, `validating`, `preparing`, `executing`, `verifying`, `compensating` |
| `terminal_status` | final result | `success`, `failed`, `cancelled`, `compensated`, `manual_intervention_required` |
| `failure_reason` | failure classification | `timeout`, `validation_error`, `resource_conflict`, `dependency_unavailable`, `execution_error`, `verification_failed`, `compensation_failed`, `unknown` |
| `app_outcome` | effect on app availability | `new_release_active`, `previous_release_active`, `no_healthy_release`, `state_unknown` |

This replaces the previous pattern of using one deployment state list to carry phase, result, and failure reason simultaneously.

### 7. PipelineRun and DAG orchestration

`PipelineRun` is the internal DAG instance used to execute one `OperationJob`.

The relationship is:

`OperationJob.type` + `RuleProfile` + runtime context -> `PipelineDefinition` -> `PipelineRun` -> `PipelineNodeRun[]`

`OperationJob` is not the DAG itself. `OperationJob` declares what business action is requested. `PipelineRun` defines how it is executed.

#### 7.1 Canonical pipeline phases

All pipeline families should reuse the same top-level execution phase vocabulary where applicable:

1. `validating`
2. `preparing`
3. `executing`
4. `verifying`
5. `compensating`

Some operation types may omit a phase, but the vocabulary remains canonical.

#### 7.2 Pipeline families

AppOS should group execution templates into six pipeline families:

| Pipeline family | Primary operations |
| --- | --- |
| `ProvisionPipeline` | `install`, `start` |
| `ChangePipeline` | `upgrade`, `redeploy`, `reconfigure` |
| `ExposurePipeline` | `publish`, `unpublish` |
| `RecoveryPipeline` | `recover`, `rollback` |
| `MaintenancePipeline` | `maintain`, `backup` |
| `RetirePipeline` | `stop`, `uninstall` |

One operation type may expand into different DAG variants based on rule profile and runtime context. Therefore, operation type maps to a pipeline family, not to a single hard-coded DAG.

### 8. DAG node reuse model

DAG nodes must follow layered reuse instead of either extreme:

1. do not create a completely separate node set for every business action
2. do not force every action to share one over-abstracted global node catalog

Node reuse should be organized in three layers:

| Node layer | Reuse scope | Examples |
| --- | --- | --- |
| shared execution nodes | reusable across many operations | `prepare_workspace`, `render_runtime_config`, `pull_runtime_artifacts`, `start_runtime`, `verify_runtime_health`, `write_audit_event` |
| shared domain nodes | reusable across related operation families | `create_candidate_release`, `activate_release`, `restore_previous_release`, `register_proxy_route`, `verify_public_endpoint`, `create_backup_snapshot` |
| specialized action nodes | only used in narrow contexts | `switch_upgrade_traffic`, `freeze_for_manual_intervention`, `finalize_retirement` |

Node granularity must represent the smallest independently observable, retryable, and compensatable business execution unit. Nodes must not be reduced to trivial shell subcommands.

### 9. ReleaseSnapshot model

`ReleaseSnapshot` exists to support deterministic promotion, rollback, recovery, and auditability.

Each snapshot should be able to represent:

1. source reference
2. resolved runtime spec baseline
3. config baseline
4. env baseline
5. activation status
6. whether it is last-known-good

Minimum release roles:

| Release role | Meaning |
| --- | --- |
| `candidate` | prepared for activation but not yet the active baseline |
| `active` | current live baseline |
| `last_known_good` | latest verified safe rollback baseline |
| `historical` | no longer active but retained for audit and rollback policy |

### 10. Exposure model

External publication must be modeled independently from runtime deployment.

This is required because an application can be running normally while publication is absent, partial, or failed.

#### 10.1 Exposure state machine

| State | Meaning |
| --- | --- |
| `unpublished` | no external publication exists |
| `publishing` | publication change is in progress |
| `published` | publication exists and validation passed |
| `published_degraded` | publication exists but has health or certificate issues |
| `unpublishing` | publication removal is in progress |
| `publication_failed` | publication change failed |
| `publication_attention_required` | publication state cannot be safely determined without operator action |

`Exposure` tracks domain binding, route binding, certificate mode, target port or service mapping, and publication health.

### 11. Saga compensation model

Saga compensation is mandatory for change and recovery flows.

Compensation is not represented only by a `rolling_back` state. Compensation must be defined at step or capability level.

Minimum compensation principles:

1. install failure cleans up unactivated resources and returns to a retryable baseline
2. upgrade failure restores the previous release when a last-known-good snapshot exists
3. publication failure restores the previous route or leaves publication in an explicitly degraded state
4. reconfigure failure restores the last working config baseline when possible
5. if safe convergence cannot be established, project `AppInstance` to `attention_required`

### 12. RuleProfile model

`RuleProfile` is a lightweight policy layer, not a general-purpose workflow engine.

It selects execution strategy without forcing policy into state machine branches.

Suggested policy dimensions:

| Dimension | Example values |
| --- | --- |
| app type | `stateless`, `stateful` |
| source type | `template`, `git`, `file`, `image` |
| release strategy | `inplace`, `recreate`, `blue_green` |
| health policy | `container`, `http`, `custom`, `none` |
| compensation policy | `best_effort`, `strict`, `manual_gate` |
| data policy | `retain`, `backup_required`, `delete_on_uninstall` |
| publication policy | `none`, `domain_required`, `manual_gate_before_publish` |
| risk level | `low`, `medium`, `high` |

### 13. Lifecycle projection rules

`AppInstance` state is projected from operation and exposure outcomes, not directly copied from pipeline phases.

Examples:

1. successful first install -> `AppInstance` becomes `running_healthy` or `running_degraded`
2. successful upgrade with successful compensation fallback -> `AppInstance` may remain `running_healthy` while `OperationJob.terminal_status = compensated`
3. runtime healthy but publication invalid -> `AppInstance` may become `running_degraded`, while `Exposure.publication_state = publication_failed` or `published_degraded`
4. failure with ambiguous infrastructure state -> `AppInstance` becomes `attention_required`

### 14. Existing deployment list reinterpretation

The current deployment list must be redefined as an operation execution view instead of the lifecycle model itself.

Recommended product positioning:

1. treat the current deployment list as `Operation Timeline` or `Pipeline Run View`
2. it visualizes one `OperationJob` and its `PipelineRun`
3. it does not define the full lifecycle of an application instance
4. future non-deploy operations such as publish, rollback, maintain, and uninstall should reuse the same execution-view pattern

This preserves current investment while correcting its semantic scope.

## Consequences

### Positive

1. lifecycle state, execution state, release baseline, and publication state become independently understandable
2. frontend can show user-meaningful state without exposing internal execution noise
3. backend can evolve from deployment-centric records to full lifecycle management without replacing the current execution core
4. rollback and recovery semantics become explicit and testable
5. future operations can reuse one execution-view model without conflating business lifecycle state

### Trade-offs

1. the model introduces more domain objects than the current deploy-centric shape
2. the system must maintain projections between operation outcomes and app lifecycle state
3. some existing deployment assumptions will need to be renamed or downgraded in scope

### Follow-up impact

This document should guide updates to:

1. Epic 17 Lifecycle Execution Core
2. Epic 18 Lifecycle Management Surface
3. proxy and certificate related epics where `Exposure` is involved
4. operation history and timeline UI terminology
5. backend persistence schemas and APIs for lifecycle-aware execution