# Story 36.1: Workflow Domain Foundation

**Epic**: Epic 36 - Workflow
**Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, Epic 19, Epic 20, Epic 30

## Objective

Define the canonical backend domain, persistence model, and definition contract for AppOS Workflow.

## Scope

- define the canonical package boundary under `backend/domain/workflow`
- define workflow definition, workflow run, and workflow node run records
- define the YAML-backed workflow definition contract for MVP
- define the server-target model for server-based executors
- add PocketBase collections, schema, and persistence layer
- add minimal CRUD routes for workflow definitions

## Product Decisions

- workflow definitions are stored in PocketBase as metadata plus YAML text
- YAML is the source of truth for workflow structure in MVP
- the product may offer form helpers, but persisted definitions remain YAML-backed
- one workflow has one default target server in MVP for `shell` and `docker` nodes
- node-level target override is out of scope in MVP
- workflow definitions are product-owned objects, not owner-first personal files
- workflow definitions may reference existing assets and secrets, but do not duplicate their storage models

## Domain Model

### Workflow Definition

Minimum fields:

- `id`
- `name`
- `description`
- `is_enabled`
- `definition_yaml`
- `default_server_id`
- `created_by`
- `updated`
- `created`

Derived or validated metadata may also be persisted for query and UI support:

- `trigger_types_json`
- `node_count`
- `has_ai_nodes`

### Workflow Run

Minimum fields:

- `id`
- `workflow_definition`
- `status`
- `trigger_type`
- `requested_by`
- `requested_by_email`
- `params_json`
- `resolved_server_id`
- `started_at`
- `ended_at`
- `error_message`
- `overlap_policy`
- `created`

### Workflow Node Run

Minimum fields:

- `id`
- `workflow_run`
- `node_key`
- `node_type`
- `display_name`
- `depends_on_json`
- `status`
- `retry_count`
- `output_json`
- `error_message`
- `execution_log`
- `execution_log_truncated`
- `started_at`
- `ended_at`
- `created`

## YAML Definition Contract

MVP definition shape:

```yaml
name: server-health-check
description: Diagnose one server and notify on failure
params:
  - name: dry_run
    type: boolean
    default: true
triggers:
  - type: cron
    schedule: '0 6 * * *'
overlap_policy: skip
default_server_id: <server-id>
nodes:
  - key: collect_logs
    type: shell
    timeout_sec: 120
    config:
      command: journalctl -p err --since '1 hour ago' --no-pager | tail -50
  - key: analyze
    type: llm
    depends_on: [collect_logs]
    config:
      prompt: 'Analyze: {{ outputs.collect_logs.stdout }}'
```

Required top-level keys in MVP:

- `name`
- `nodes`

Supported top-level keys in MVP:

- `description`
- `params`
- `triggers`
- `overlap_policy`
- `default_server_id`

Validation rules:

- every node `key` must be unique
- every `depends_on` target must exist
- cycles are invalid
- only supported trigger types and node types are accepted
- `shell` and `docker` definitions require one resolvable server target in MVP

## Package Boundary

Canonical backend package boundary:

- `backend/domain/workflow`

Expected first subpackages:

- `backend/domain/workflow`
- `backend/domain/workflow/engine`
- `backend/domain/workflow/executors`

Persistence implementation belongs in:

- `backend/infra/persistence/workflow_repository.go`

Schema belongs in:

- `backend/infra/schema/workflows.go`

## Backend API Direction

MVP route family:

```text
GET    /api/workflows
POST   /api/workflows
GET    /api/workflows/:id
PUT    /api/workflows/:id
DELETE /api/workflows/:id
```

Notes:

- custom routes return raw JSON only
- mutating routes are superuser-only in MVP
- YAML validation errors return explicit field-oriented messages when possible

## Acceptance Criteria

1. AppOS defines one canonical backend `Workflow` domain under `backend/domain/workflow`.
2. The story defines the minimum persisted models for workflow definition, workflow run, and workflow node run.
3. Workflow structure is stored as YAML text in PocketBase in MVP.
4. The story defines one supported YAML-backed definition contract for MVP including nodes, triggers, parameters, and overlap policy.
5. The story states that `shell` and `docker` executors are server-based and require a resolvable server target.
6. PocketBase collections and schema are specified for definitions, runs, and node runs.
7. CRUD routes for workflow definitions are defined as the MVP backend management surface.
8. Validation rules explicitly reject missing dependency targets, duplicate node keys, unsupported types, and cycles.

## Out of Scope

- workflow execution engine behavior
- retry runtime behavior
- cron registration implementation
- node executor implementation
- workflow run detail UI
