# Application Lifecycle Field Definitions

## Status
Proposed

## Context
`app-lifecycle-domain-model.md` defines the conceptual boundaries for AppOS lifecycle management. The next step is to freeze a field-level draft that can guide backend persistence, API contracts, and frontend projections without collapsing the model back into deploy-only records.

This document is the companion field definition draft for the lifecycle domain model. It focuses on logical fields first, then gives persistence recommendations for a clean-slate MVP implementation.

Because AppOS has not been publicly released and the current backend lifecycle implementation is not considered worth preserving, this document assumes a refactor-first stance:

1. prefer new lifecycle collections over extending legacy deploy-era collections
2. delete or rename legacy collections instead of carrying compatibility debt forward
3. reuse only infrastructure that remains architecturally sound, such as worker runtime or frontend surfaces

## Decisions

### 1. Logical objects vs physical persistence

The lifecycle model is defined in logical objects. For MVP, physical persistence should follow the new lifecycle boundaries directly instead of stretching legacy collection names.

| Logical object | Recommended physical persistence | Notes |
| --- | --- | --- |
| `AppInstance` | new `app_instances` collection | Do not overload existing `apps` with lifecycle semantics if the backend is being reset |
| `OperationJob` | new `app_operations` collection | Do not preserve `deployments` as the primary lifecycle contract |
| `ReleaseSnapshot` | new `app_releases` collection | Dedicated baseline history is required for rollback and recovery |
| `PipelineRun` | new `pipeline_runs` collection | Separate collection keeps execution graph concerns explicit |
| `PipelineNodeRun` | new `pipeline_node_runs` collection | Node-level observability should not be hidden in opaque blobs if we are refactoring anyway |
| `Exposure` | new `app_exposures` collection | Do not overload proxy configuration records with app lifecycle meaning |
| `RuleProfile` | code-backed profile in MVP; optional `rule_profiles` collection later | Do not introduce a workflow platform just to store policy |

Legacy collection stance for MVP:

1. `deployments` should be removed or renamed out of the main lifecycle path
2. lifecycle-critical fields should not be added to old deploy-centric records just to preserve history
3. if `apps` remains for app-store or catalog semantics, it must not double as the canonical lifecycle instance store

### 2. AppInstance field definition

`AppInstance` remains the lifecycle root object. For MVP refactor, it should live in a dedicated `app_instances` collection.

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | string | yes | stable app identity |
| `key` | string | yes | stable app key or slug |
| `name` | string | yes | user-facing name |
| `template_key` | string | no | originating template or store identity |
| `server_id` | string | yes | target server identity |
| `lifecycle_state` | enum | yes | `registered`, `installing`, `running_healthy`, `running_degraded`, `maintenance`, `updating`, `recovering`, `stopped`, `attention_required`, `retired` |
| `desired_state` | enum | no | operator intent such as `running`, `stopped`, `retired` |
| `health_summary` | enum | yes | `healthy`, `degraded`, `unknown`, `stopped` |
| `current_release_id` | relation -> `app_releases` | no | active baseline reference |
| `last_operation_id` | relation -> `app_operations` | no | most recent lifecycle action |
| `primary_exposure_id` | relation -> `app_exposures` | no | default public entry point if one exists |
| `publication_summary` | enum | no | `unpublished`, `published`, `degraded`, `unknown` |
| `installed_at` | datetime | no | first successful install time |
| `last_healthy_at` | datetime | no | latest known healthy verification |
| `retired_at` | datetime | no | lifecycle end timestamp |
| `state_reason` | short text | no | concise operator-facing explanation for degraded or attention-required states |

#### AppInstance notes

1. `lifecycle_state` is authoritative for management views.
2. `health_summary` is intentionally coarser than internal health checks.
3. `publication_summary` is a projection from `Exposure`, not a replacement for `Exposure`.
4. Frontend-friendly app metadata can be copied or projected into this collection rather than forcing lifecycle state onto unrelated records.

### 3. OperationJob field definition

`OperationJob` is the execution-facing business action record. For MVP refactor, it should live in a dedicated `app_operations` collection.

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | string | yes | stable operation identity |
| `app_id` | relation -> `app_instances` | yes | target app instance |
| `server_id` | string | yes | target server routing key |
| `operation_type` | enum | yes | `install`, `start`, `stop`, `upgrade`, `redeploy`, `reconfigure`, `publish`, `unpublish`, `backup`, `recover`, `rollback`, `maintain`, `uninstall` |
| `trigger_source` | enum | yes | `manualops`, `fileops`, `gitops`, `store`, `system` |
| `adapter` | string | no | normalization adapter or entry path |
| `requested_by` | relation -> users or superusers | no | actor identity |
| `phase` | enum | yes | `queued`, `validating`, `preparing`, `executing`, `verifying`, `compensating` |
| `terminal_status` | enum | no | `success`, `failed`, `cancelled`, `compensated`, `manual_intervention_required` |
| `failure_reason` | enum | no | `timeout`, `validation_error`, `resource_conflict`, `dependency_unavailable`, `execution_error`, `verification_failed`, `compensation_failed`, `unknown` |
| `app_outcome` | enum | no | `new_release_active`, `previous_release_active`, `no_healthy_release`, `state_unknown` |
| `spec_json` | json | yes | normalized operation contract payload |
| `compose_project_name` | string | no | runtime isolation identity |
| `project_dir` | string | no | execution workspace |
| `rendered_compose` | text | no | final compose plan used for execution |
| `resolved_env_json` | json | no | resolved env values or references |
| `baseline_release_id` | relation -> `app_releases` | no | baseline used before action |
| `candidate_release_id` | relation -> `app_releases` | no | new prepared baseline if any |
| `result_release_id` | relation -> `app_releases` | no | baseline left active after completion |
| `pipeline_run_id` | relation -> `pipeline_runs` | no | execution graph root |
| `log_cursor` | string or json | no | pointer to latest log chunk or stream position |
| `error_message` | text | no | concise last error summary |
| `queued_at` | datetime | yes | accepted time |
| `started_at` | datetime | no | first active execution time |
| `ended_at` | datetime | no | terminal time |
| `cancel_requested_at` | datetime | no | explicit cancel time |

#### OperationJob notes

1. `phase` must always exist while the job is active.
2. `terminal_status` is null until the job reaches a terminal state.
3. `failure_reason` is classification only. It must not be overloaded as terminal status.
4. `spec_json` is the contract boundary between normalization and execution.

### 4. ReleaseSnapshot field definition

`ReleaseSnapshot` stores the lifecycle baseline required for activation, rollback, and auditability.

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | string | yes | release identity |
| `app_id` | relation -> `app_instances` | yes | owning app |
| `created_by_operation_id` | relation -> `app_operations` | no | operation that produced the snapshot |
| `release_role` | enum | yes | `candidate`, `active`, `last_known_good`, `historical` |
| `version_label` | string | no | app-facing version string |
| `source_type` | enum | yes | `template`, `git`, `file`, `image`, `manual` |
| `source_ref` | text | no | repository URL, image tag, template key, or file reference |
| `rendered_compose` | text | yes | resolved execution baseline |
| `resolved_env_json` | json | no | effective env map or references |
| `config_digest` | string | no | hash for drift detection |
| `artifact_digest` | string | no | image or bundle fingerprint |
| `is_active` | bool | yes | whether this snapshot is currently active |
| `is_last_known_good` | bool | yes | whether this snapshot is valid rollback baseline |
| `activated_at` | datetime | no | activation time |
| `superseded_at` | datetime | no | when a newer baseline replaced it |
| `notes` | text | no | migration or release notes |

#### ReleaseSnapshot notes

1. `release_role` is descriptive; `is_active` and `is_last_known_good` support fast queries.
2. MVP may start without a rich version model as long as rendered runtime baseline is stored.

### 5. PipelineRun field definition

`PipelineRun` is the instantiated execution graph for one `OperationJob`.

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | string | yes | pipeline run identity |
| `operation_id` | relation -> `app_operations` | yes | owning operation |
| `pipeline_family` | enum | yes | `ProvisionPipeline`, `ChangePipeline`, `ExposurePipeline`, `RecoveryPipeline`, `MaintenancePipeline`, `RetirePipeline` |
| `pipeline_version` | string | no | template version or code revision |
| `current_phase` | enum | yes | top-level execution phase |
| `status` | enum | yes | `active`, `completed`, `failed`, `cancelled` |
| `node_count` | int | yes | total nodes |
| `completed_node_count` | int | yes | completed nodes |
| `failed_node_key` | string | no | first or current failed node |
| `started_at` | datetime | no | start time |
| `ended_at` | datetime | no | end time |

#### PipelineRun notes

1. `PipelineRun` is execution infrastructure, not a user-facing lifecycle object.
2. If MVP stores node runs inside the operation record, this shape should still be preserved logically.

### 6. PipelineNodeRun field definition

`PipelineNodeRun` captures the smallest independently observable, retryable, and compensatable execution unit.

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | string | yes | node run identity |
| `pipeline_run_id` | relation -> `pipeline_runs` | yes | owning pipeline run |
| `node_key` | string | yes | stable internal node identifier |
| `node_type` | string | yes | node capability category |
| `display_name` | string | yes | UI-facing label |
| `phase` | enum | yes | owning top-level phase |
| `depends_on_json` | json | no | upstream node keys |
| `status` | enum | yes | `pending`, `running`, `succeeded`, `failed`, `skipped`, `cancelled`, `compensated` |
| `retry_count` | int | yes | retry attempts |
| `compensation_node_key` | string | no | linked compensation node |
| `error_code` | string | no | machine-readable failure code |
| `error_message` | text | no | human-readable failure summary |
| `started_at` | datetime | no | start time |
| `ended_at` | datetime | no | end time |

#### PipelineNodeRun notes

1. Node payload logs can remain in stream storage and be referenced indirectly.
2. Node granularity must stay at capability-block level, not shell-command level.

### 7. Exposure field definition

`Exposure` models app publication through proxy and domain binding independently from runtime deployment.

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `id` | string | yes | exposure identity |
| `app_id` | relation -> `app_instances` | yes | owning app |
| `release_id` | relation -> `app_releases` | no | target release for this exposure |
| `exposure_type` | enum | yes | `domain`, `path`, `port`, `internal_only` |
| `is_primary` | bool | yes | primary public entry point marker |
| `domain` | string | no | bound domain |
| `path` | string | no | bound path prefix |
| `target_port` | int | no | service port exposed through proxy |
| `certificate_id` | relation -> `certificates` | no | bound certificate |
| `publication_state` | enum | yes | `unpublished`, `publishing`, `published`, `published_degraded`, `unpublishing`, `publication_failed`, `publication_attention_required` |
| `health_state` | enum | yes | `healthy`, `degraded`, `unknown` |
| `last_verified_at` | datetime | no | last endpoint verification |
| `disabled_at` | datetime | no | when publication was intentionally disabled |
| `notes` | text | no | operator notes or failure summary |

#### Exposure notes

1. One app may have zero, one, or multiple exposures.
2. `publication_state` must not replace `AppInstance.lifecycle_state`.

### 8. RuleProfile field definition

`RuleProfile` is a lightweight policy bundle. It should remain code-backed in MVP unless direct runtime configurability is necessary.

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `profile_key` | string | yes | stable strategy identity |
| `app_type` | enum | yes | `stateless`, `stateful`, or future categories |
| `operation_type` | enum | yes | target operation family |
| `release_strategy` | enum | yes | `inplace`, `recreate`, `blue_green` |
| `health_policy` | enum | yes | `none`, `container`, `http`, `custom` |
| `compensation_policy` | enum | yes | `best_effort`, `strict`, `manual_gate` |
| `data_policy` | enum | yes | `retain`, `backup_required`, `delete_on_uninstall` |
| `publication_policy` | enum | yes | `none`, `optional`, `domain_required`, `manual_gate_before_publish` |
| `risk_level` | enum | yes | `low`, `medium`, `high` |
| `timeout_profile_json` | json | no | per-phase timeout budgets |
| `retry_profile_json` | json | no | per-node retry guidance |

### 9. Recommended indexes and constraints

| Object | Recommended constraint or index |
| --- | --- |
| `app_instances` | index on `server_id`, `lifecycle_state`; unique `key` |
| `app_operations` | index on `app_id`, `server_id`, `phase`, `terminal_status`, `operation_type`, `queued_at` |
| `app_releases` | index on `app_id`, `is_active`, `is_last_known_good`, `activated_at` |
| `pipeline_runs` | index on `operation_id`, `status`, `started_at` |
| `pipeline_node_runs` | index on `pipeline_run_id`, `status`, `phase` |
| `app_exposures` | index on `app_id`, `publication_state`, `domain`, `is_primary`; unique per app for one primary exposure |

### 10. Management projection contract

The Installed App list and detail views should be assembled from logical projections, not from raw operation rows.

#### 10.1 App list projection

Minimum list payload:

| Field | Source |
| --- | --- |
| `app_id` | `AppInstance.id` |
| `name` | `AppInstance.name` |
| `lifecycle_state` | `AppInstance.lifecycle_state` |
| `health_summary` | `AppInstance.health_summary` |
| `publication_summary` | `AppInstance.publication_summary` or `Exposure` projection |
| `current_release_label` | `ReleaseSnapshot.version_label` |
| `last_operation_type` | latest `OperationJob.operation_type` |
| `last_operation_status` | latest `OperationJob.terminal_status` or active `phase` |
| `updated_at` | projected latest meaningful activity timestamp |

#### 10.2 Operation detail projection

Minimum detail payload:

| Field | Source |
| --- | --- |
| `operation_id` | `OperationJob.id` |
| `operation_type` | `OperationJob.operation_type` |
| `phase` | `OperationJob.phase` |
| `terminal_status` | `OperationJob.terminal_status` |
| `failure_reason` | `OperationJob.failure_reason` |
| `app_outcome` | `OperationJob.app_outcome` |
| `pipeline_family` | `PipelineRun.pipeline_family` |
| `timeline_nodes` | `PipelineNodeRun[]` |
| `baseline_release_id` | `OperationJob.baseline_release_id` |
| `result_release_id` | `OperationJob.result_release_id` |

### 11. MVP persistence stance

For MVP refactor, persistence should be reset around the lifecycle model:

1. create dedicated lifecycle collections: `app_instances`, `app_operations`, `app_releases`, `app_exposures`
2. create `pipeline_runs` and `pipeline_node_runs` as first-class execution collections if timeline and node observability are part of MVP execution UX
3. remove or archive legacy `deployments` instead of letting it remain the semantic center of lifecycle execution
4. keep `RuleProfile` code-backed until runtime authoring is genuinely needed
5. treat any migration from old backend data as optional cleanup, not as a compatibility requirement

### 12. Collection naming recommendation

Recommended PocketBase collection names for the clean-slate lifecycle model:

1. `app_instances`
2. `app_operations`
3. `app_releases`
4. `app_exposures`
5. `pipeline_runs`
6. `pipeline_node_runs`

If an old collection survives for unrelated reasons, its lifecycle ownership must be explicitly limited and documented.

### 13. Follow-up impact

This document should guide the next updates to:

1. story 17.1 contract language
2. backend collection and migration design
3. operation status and timeline API design
4. installed app list/detail projections in Epic 18
5. release baseline and exposure ownership boundaries across lifecycle stories

Companion migration draft: `specs/adr/app-lifecycle-pocketbase-collections.md`