# Application Lifecycle PocketBase Collections Draft

## Status
Proposed

## Context
AppOS has adopted a clean-slate MVP strategy for application lifecycle management.

The product is not publicly released yet, and the current backend lifecycle implementation is not treated as a compatibility boundary. That means lifecycle persistence should be rebuilt around the new domain model instead of extending deploy-era collections.

This draft defines the PocketBase collection plan for the lifecycle model described in:

1. `specs/adr/app-lifecycle-domain-model.md`
2. `specs/adr/app-lifecycle-field-definitions.md`
3. `specs/adr/app-lifecycle-api-surface.md`

The goal is to make backend schema design, migration planning, and API implementation ready for development.

## Decisions

### 1. Collection set

The clean-slate lifecycle backend should use the following PocketBase collections:

1. `app_instances`
2. `app_operations`
3. `app_releases`
4. `app_exposures`
5. `pipeline_runs`
6. `pipeline_node_runs`

These collections are the canonical persistence layer for MVP lifecycle execution and management.

### 2. Legacy collection stance

The following stance is adopted for pre-release MVP:

1. `deployments` is legacy and should be removed from the lifecycle main path
2. old deploy-era fields should not be gradually extended just to preserve continuity
3. if `apps` remains for store/catalog semantics, it must not serve as the canonical lifecycle instance collection
4. historical data migration is optional and low priority
5. destructive reset is acceptable if it produces a cleaner lifecycle backend

### 3. Collection definitions

## 3.1 `app_instances`

Purpose: canonical managed application instance record.

### Fields

| Field | PocketBase type | Required | Notes |
| --- | --- | --- | --- |
| `key` | text | yes | unique stable app key |
| `name` | text | yes | user-facing app name |
| `template_key` | text | no | originating template/store identity |
| `server_id` | text | yes | target server identity |
| `lifecycle_state` | select | yes | single select |
| `desired_state` | select | no | single select |
| `health_summary` | select | yes | single select |
| `current_release` | relation | no | -> `app_releases` |
| `last_operation` | relation | no | -> `app_operations` |
| `primary_exposure` | relation | no | -> `app_exposures` |
| `publication_summary` | select | no | single select |
| `installed_at` | date | no | |
| `last_healthy_at` | date | no | |
| `retired_at` | date | no | |
| `state_reason` | text | no | short reason text |

### Select values

`lifecycle_state`:

1. `registered`
2. `installing`
3. `running_healthy`
4. `running_degraded`
5. `maintenance`
6. `updating`
7. `recovering`
8. `stopped`
9. `attention_required`
10. `retired`

`desired_state`:

1. `running`
2. `stopped`
3. `retired`

`health_summary`:

1. `healthy`
2. `degraded`
3. `unknown`
4. `stopped`

`publication_summary`:

1. `unpublished`
2. `published`
3. `degraded`
4. `unknown`

### Rules

1. `listRule`: authenticated
2. `viewRule`: authenticated
3. `createRule`: authenticated or superuser depending on final product policy
4. `updateRule`: authenticated or superuser depending on final product policy
5. `deleteRule`: superuser only for MVP

### Indexes and constraints

1. unique index on `key`
2. index on `server_id`
3. index on `lifecycle_state`
4. optional composite index on `(server_id, lifecycle_state)`

## 3.2 `app_operations`

Purpose: canonical lifecycle action store.

### Fields

| Field | PocketBase type | Required | Notes |
| --- | --- | --- | --- |
| `app` | relation | yes | -> `app_instances` |
| `server_id` | text | yes | routing key |
| `operation_type` | select | yes | single select |
| `trigger_source` | select | yes | single select |
| `adapter` | text | no | entry adapter |
| `requested_by` | relation | no | -> users or `_superusers` depending on auth model |
| `phase` | select | yes | single select |
| `terminal_status` | select | no | single select |
| `failure_reason` | select | no | single select |
| `app_outcome` | select | no | single select |
| `spec_json` | json | yes | normalized operation payload |
| `compose_project_name` | text | no | |
| `project_dir` | text | no | |
| `rendered_compose` | editor | no | final compose payload |
| `resolved_env_json` | json | no | |
| `baseline_release` | relation | no | -> `app_releases` |
| `candidate_release` | relation | no | -> `app_releases` |
| `result_release` | relation | no | -> `app_releases` |
| `pipeline_run` | relation | no | -> `pipeline_runs` |
| `log_cursor` | json | no | stream position metadata |
| `error_message` | text | no | |
| `queued_at` | date | yes | |
| `started_at` | date | no | |
| `ended_at` | date | no | |
| `cancel_requested_at` | date | no | |

### Select values

`operation_type`:

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

`trigger_source`:

1. `manualops`
2. `fileops`
3. `gitops`
4. `store`
5. `system`

`phase`:

1. `queued`
2. `validating`
3. `preparing`
4. `executing`
5. `verifying`
6. `compensating`

`terminal_status`:

1. `success`
2. `failed`
3. `cancelled`
4. `compensated`
5. `manual_intervention_required`

`failure_reason`:

1. `timeout`
2. `validation_error`
3. `resource_conflict`
4. `dependency_unavailable`
5. `execution_error`
6. `verification_failed`
7. `compensation_failed`
8. `unknown`

`app_outcome`:

1. `new_release_active`
2. `previous_release_active`
3. `no_healthy_release`
4. `state_unknown`

### Rules

1. `listRule`: authenticated
2. `viewRule`: authenticated
3. `createRule`: authenticated
4. `updateRule`: backend-controlled or superuser-only for direct record updates
5. `deleteRule`: superuser only

### Indexes and constraints

1. index on `app`
2. index on `server_id`
3. index on `phase`
4. index on `terminal_status`
5. index on `operation_type`
6. index on `queued_at`
7. recommended composite index on `(server_id, phase)`

## 3.3 `app_releases`

Purpose: release and rollback baseline store.

### Fields

| Field | PocketBase type | Required | Notes |
| --- | --- | --- | --- |
| `app` | relation | yes | -> `app_instances` |
| `created_by_operation` | relation | no | -> `app_operations` |
| `release_role` | select | yes | single select |
| `version_label` | text | no | |
| `source_type` | select | yes | single select |
| `source_ref` | text | no | |
| `rendered_compose` | editor | yes | baseline runtime plan |
| `resolved_env_json` | json | no | |
| `config_digest` | text | no | |
| `artifact_digest` | text | no | |
| `is_active` | bool | yes | default false |
| `is_last_known_good` | bool | yes | default false |
| `activated_at` | date | no | |
| `superseded_at` | date | no | |
| `notes` | text | no | |

### Select values

`release_role`:

1. `candidate`
2. `active`
3. `last_known_good`
4. `historical`

`source_type`:

1. `template`
2. `git`
3. `file`
4. `image`
5. `manual`

### Rules

1. `listRule`: authenticated
2. `viewRule`: authenticated
3. `createRule`: backend-controlled or superuser-only for direct writes
4. `updateRule`: backend-controlled or superuser-only for direct writes
5. `deleteRule`: superuser only

### Indexes and constraints

1. index on `app`
2. index on `is_active`
3. index on `is_last_known_good`
4. index on `activated_at`

## 3.4 `app_exposures`

Purpose: publication and entry-point store.

### Fields

| Field | PocketBase type | Required | Notes |
| --- | --- | --- | --- |
| `app` | relation | yes | -> `app_instances` |
| `release` | relation | no | -> `app_releases` |
| `exposure_type` | select | yes | single select |
| `is_primary` | bool | yes | default false |
| `domain` | text | no | |
| `path` | text | no | |
| `target_port` | number | no | integer |
| `certificate` | relation | no | -> `certificates` |
| `publication_state` | select | yes | single select |
| `health_state` | select | yes | single select |
| `last_verified_at` | date | no | |
| `disabled_at` | date | no | |
| `notes` | text | no | |

### Select values

`exposure_type`:

1. `domain`
2. `path`
3. `port`
4. `internal_only`

`publication_state`:

1. `unpublished`
2. `publishing`
3. `published`
4. `published_degraded`
5. `unpublishing`
6. `publication_failed`
7. `publication_attention_required`

`health_state`:

1. `healthy`
2. `degraded`
3. `unknown`

### Rules

1. `listRule`: authenticated
2. `viewRule`: authenticated
3. `createRule`: authenticated or superuser depending on product policy
4. `updateRule`: authenticated or superuser depending on product policy
5. `deleteRule`: superuser only for MVP

### Indexes and constraints

1. index on `app`
2. index on `publication_state`
3. index on `domain`
4. unique primary exposure per app enforced by app-layer validation or DB-level partial unique strategy if available

## 3.5 `pipeline_runs`

Purpose: one record per operation-level DAG instance.

### Fields

| Field | PocketBase type | Required | Notes |
| --- | --- | --- | --- |
| `operation` | relation | yes | -> `app_operations` |
| `pipeline_family` | select | yes | single select |
| `pipeline_version` | text | no | |
| `current_phase` | select | yes | single select |
| `status` | select | yes | single select |
| `node_count` | number | yes | integer |
| `completed_node_count` | number | yes | integer |
| `failed_node_key` | text | no | |
| `started_at` | date | no | |
| `ended_at` | date | no | |

### Select values

`pipeline_family`:

1. `ProvisionPipeline`
2. `ChangePipeline`
3. `ExposurePipeline`
4. `RecoveryPipeline`
5. `MaintenancePipeline`
6. `RetirePipeline`

`current_phase`:

1. `validating`
2. `preparing`
3. `executing`
4. `verifying`
5. `compensating`

`status`:

1. `active`
2. `completed`
3. `failed`
4. `cancelled`

### Rules

1. `listRule`: authenticated
2. `viewRule`: authenticated
3. `createRule`: backend-controlled or superuser-only
4. `updateRule`: backend-controlled or superuser-only
5. `deleteRule`: superuser only

### Indexes

1. index on `operation`
2. index on `status`
3. index on `started_at`

## 3.6 `pipeline_node_runs`

Purpose: one record per DAG node execution instance.

### Fields

| Field | PocketBase type | Required | Notes |
| --- | --- | --- | --- |
| `pipeline_run` | relation | yes | -> `pipeline_runs` |
| `node_key` | text | yes | stable internal node identifier |
| `node_type` | text | yes | node capability category |
| `display_name` | text | yes | UI-facing label |
| `phase` | select | yes | single select |
| `depends_on_json` | json | no | upstream nodes |
| `status` | select | yes | single select |
| `retry_count` | number | yes | integer, default 0 |
| `compensation_node_key` | text | no | |
| `error_code` | text | no | |
| `error_message` | text | no | |
| `started_at` | date | no | |
| `ended_at` | date | no | |

### Select values

`phase`:

1. `validating`
2. `preparing`
3. `executing`
4. `verifying`
5. `compensating`

`status`:

1. `pending`
2. `running`
3. `succeeded`
4. `failed`
5. `skipped`
6. `cancelled`
7. `compensated`

### Rules

1. `listRule`: authenticated
2. `viewRule`: authenticated
3. `createRule`: backend-controlled or superuser-only
4. `updateRule`: backend-controlled or superuser-only
5. `deleteRule`: superuser only

### Indexes

1. index on `pipeline_run`
2. index on `status`
3. index on `phase`
4. optional composite index on `(pipeline_run, status)`

### 4. `pipeline_runs` vs `pipeline_node_runs`

The distinction is intentional and required.

| Collection | Granularity | Main purpose |
| --- | --- | --- |
| `pipeline_runs` | one row per operation-level DAG instance | summarize the whole execution graph |
| `pipeline_node_runs` | one row per DAG node execution | capture node-by-node execution detail |

`pipeline_runs` answers:

1. which pipeline family is executing
2. which top-level phase is active
3. whether the whole execution is active, completed, failed, or cancelled
4. how many nodes exist and how many have completed

`pipeline_node_runs` answers:

1. which node is running or failed
2. what that node depends on
3. how many retries occurred
4. what specific error happened
5. whether compensation happened at node level

MVP recommendation: keep both collections. Since the backend is being rebuilt anyway, hiding node runs inside JSON blobs would create avoidable refactor debt.

### 5. Migration strategy

This rollout is a destructive MVP reset.

#### 5.1 Create

Create these collections in order:

1. `app_instances`
2. `app_releases`
3. `app_operations`
4. `app_exposures`
5. `pipeline_runs`
6. `pipeline_node_runs`

#### 5.2 Remove or archive

Legacy lifecycle collections or fields should be removed or archived when they conflict with the new model.

At minimum:

1. remove or archive `deployments`
2. do not add new lifecycle fields to the old deploy-era schema
3. if old app records in `apps` are lifecycle-oriented, either delete them or move required UI metadata into `app_instances`

#### 5.3 No data compatibility promise

For MVP:

1. no historical deploy data migration is required
2. no field-level backward compatibility is required
3. clean install behavior is more important than preserving previous dev-state data

### 6. Minimum API surface implied by this schema

Collection CRUD may cover basic reads, but lifecycle behavior still requires custom routes.

Minimum custom route groups:

1. `/api/app-instances/*`
2. `/api/app-operations/*`
3. `/api/app-exposures/*`
4. `/api/app-releases/*` for non-trivial release actions if needed

Minimum behavior-specific routes:

1. create operation
2. list operation history
3. get operation detail with pipeline timeline
4. list app instances with lifecycle projection
5. get app instance detail with release and exposure summary

### 7. Development readiness criteria

This collection draft is development-ready when the following are true:

1. collection names are accepted
2. field names are accepted
3. select enums are accepted
4. relation ownership is accepted
5. destructive migration stance is accepted

Once those five items are accepted, backend migration work may start.

Full MVP development readiness still depends on one more item outside this draft:

1. Story 17.2 must be rewritten against the new `install` operation contract so the first closed loop matches the new schema

### 8. Follow-up impact

This draft should drive the next concrete work items:

1. rewrite Story 17.2 against `app_instances` + `app_operations`
2. define migration files under `backend/internal/migrations/`
3. define operation and timeline APIs against `app_operations`, `pipeline_runs`, and `pipeline_node_runs`
4. define Installed App projections against `app_instances`, `app_releases`, and `app_exposures`