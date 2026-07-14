# Epic 36: Workflow

**Module**: Workflow | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 12, Epic 19, Epic 20, Epic 25, Epic 30, Epic 31

## Overview

AppOS Workflow is the user-level orchestration module for scheduled and manual automation.

It adds a product-owned workflow layer on top of existing AppOS infrastructure so users can define DAG-based tasks, run them on demand or by cron, and attach AI-capable nodes without introducing a separate workflow platform.

## Position

Workflow owns:

- workflow definitions
- workflow runs and node runs
- manual and cron triggers
- DAG execution ordering and bounded parallelism
- node-level logs, retry, timeout, and approval states

Workflow does not own:

- PocketBase native platform cron registration
- generic chat UX
- a standalone workflow server
- a third-party action marketplace
- a full Dagu replacement

## Direction

Reference Dagu's product shape and runner ideas, but implement an AppOS-specific workflow kernel.

Reuse existing AppOS foundations:

- PocketBase for persistence
- Asynq for execution
- PocketBase cron for scheduling
- AI Runtime and Assets for AI-capable nodes
- opencode CLI for `agent` nodes

### Runner Strategy

**Option B: independent runner.** Build a new `workflow/engine/runner.go` without modifying `lifecycle/orchestration/runner.go`. Both runners share the same design pattern (hooks-based ready-node loop) but evolve independently — lifecycle runner remains dedicated to deployment operations, workflow runner handles general-purpose DAG execution with retries, timeouts, and broader node types.

## Definition Model

- source of truth: workflow definition stored in PocketBase
- authoring format in MVP: YAML stored as text plus validated structured metadata
- first UI may use form helpers, but persisted definition remains YAML-backed
- workflow parameters, triggers, nodes, retry/timeout, and executor config are all defined inside the workflow definition

## Execution Model

- `shell` is **server-based** by default: it executes against a selected AppOS server target rather than inside the AppOS container
- `docker` is also server-based in MVP: it runs on a selected server that has Docker capability
- `http`, `llm`, `agent`, `smtp`, `condition`, `manual_gate`, and `subworkflow` execute from the workflow runtime boundary
- `agent` uses opencode as an executor, not as a scheduler; the workflow engine remains authoritative
- MVP trigger types are `manual` and `cron`; inbound webhook trigger is deferred

## Data and Secrets

- parameters are passed into a run at trigger time
- node outputs are persisted and can be referenced by downstream nodes
- MVP interpolation model should support at minimum:
  - `{{ params.x }}`
  - `{{ outputs.node_key.field }}`
  - `{{ secrets.name }}`
- secrets must resolve through the existing AppOS secrets domain and must be masked in logs when possible

## Reliability Policy

- default overlap policy for cron-triggered workflows: `skip`
- workflow runs and node runs must support orphan recovery similar to lifecycle worker recovery
- node-level retry and timeout are in MVP
- workflow-level timeout and lifecycle hooks such as `on_failure` / `on_success` are post-MVP unless required by implementation pressure

## MVP Cut

- workflow definitions are authored as YAML text with validation; no visual builder in MVP
- one workflow has one default target server for `shell` and `docker` nodes in MVP
- node-level target override is post-MVP
- `subworkflow` is synchronous only in MVP
- `llm` is single-shot inference only in MVP
- `agent` uses opencode inside a bounded workspace and is not a replacement for the workflow scheduler
- inbound webhook trigger, loops, fan-out templating, and generalized hooks remain post-MVP unless later stories explicitly pull them in

## Reference Direction

- Dagu: product boundary, YAML shape, executor registry, run model
- go-taskflow: DAG ready-set, condition, and subflow implementation ideas
- go-workflows: durable workflow recovery ideas only

## MVP

- workflow definition storage
- workflow run and node run records
- trigger types: `manual`, `cron`
- node types:

| Node | Purpose | Coverage |
|---|---|---|
| `shell` | run commands on target server | ops scripts, data collection |
| `http` | call external APIs | webhooks, REST calls, notifications via webhook |
| `llm` | single LLM inference | analysis, classification, summarization |
| `agent` | multi-step AI agent (opencode) | diagnosis, repair, code generation |
| `docker` | isolated container execution on target server | sandboxed scripts, toolchains |
| `smtp` | send email notifications | alerting, reports |
| `condition` | branch based on upstream output | dynamic path selection |
| `manual_gate` | human approval | governance for high-risk actions |
| `subworkflow` | invoke another workflow | composition, modularity |

Notifications: `http` node covers webhook notifications. `smtp` node covers email notifications. No separate notification subsystem needed.

- run status, logs, retry, timeout, outputs

## Out of Scope

- visual drag-and-drop editor
- distributed workflow worker fabric beyond Asynq
- full external plugin ecosystem
- inbound webhook trigger
- replacing lifecycle orchestration
- replacing server-level Linux cron management

## Minimal Architecture

```text
workflow definition (PocketBase)
  ↓
manual trigger / cron trigger
  ↓
workflow run + node run seed
  ↓
Asynq workflow:execute
  ↓
workflow DAG runner
  ↓
executor registry (shell/http/llm/agent/docker/smtp/...)
  ↓
run logs + outputs + terminal status
```

## Stories

### Story 36.1 - Workflow Domain Foundation

- define workflow, workflow_run, workflow_node_run model
- add PocketBase collections, schema, and persistence layer
- add minimal CRUD routes for workflow definitions
- define YAML-backed workflow definition contract and validation
- record workflow target model for server-based executors

### Story 36.2 - Workflow DAG Runner

- implement independent workflow runner (parallel to lifecycle runner, not modifying it)
- dependency-aware ready-node execution with bounded parallelism
- support retry, timeout, terminal states, and node output propagation
- persist node outputs and node status transitions
- add overlap policy and orphan recovery behavior for workflow runs

### Story 36.3 - Workflow Triggers and Execution

- add manual run endpoint
- add cron-backed workflow trigger registration
- enqueue workflow execution through Asynq and record run ownership
- resolve run parameters and secret references at execution time

### Story 36.4 - Workflow Node Executors

- implement executor registry + built-in executors: `shell`, `http`, `llm`, `agent`, `docker`, `smtp`, `condition`, `manual_gate`, `subworkflow`
- `http` covers webhook notifications; `smtp` covers email notifications
- `agent` invokes opencode CLI with workspace + prompt, collects output
- `shell` and `docker` execute against selected AppOS server targets
- reuse AI provider resolution and prompt/asset references for `llm`
- keep executor registration internal and capability-scoped

### Story 36.5 - Workflow Web MVP

- add minimal workflow list/create/edit/run UI
- add run history and node log viewing
- expose cron/manual trigger state and basic run summaries

## Risks

- scope drift from AppOS workflow module into general-purpose workflow platform
- unclear boundary between lifecycle orchestration and workflow orchestration
- unstable AI node output contracts if schema discipline is weak
- secret leakage through node logs or agent workspaces if masking rules are weak
- server-targeted executors increase permission and connectivity complexity

## Dependencies

- Epic 12: Audit
- Epic 19: Secrets
- Epic 20: Servers
- Epic 25: System Cron
- Epic 30: Assets
- Epic 31: AI Runtime

## Decision

Proceed with a self-built AppOS workflow kernel inspired by Dagu, not a Dagu clone.
