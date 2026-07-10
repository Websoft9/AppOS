# Deployment Core Target Architecture

## Overview

This document defines the target architecture for the next-generation AppOS deployment core after convergence.

The target model removes the legacy `deployments` execution path and standardizes AppOS on one lifecycle-oriented architecture built from:

1. `AppOperation` as the business action record
2. `PipelineRun` and `PipelineNodeRun` as the execution graph truth
3. `AppRelease` as the release baseline and rollback surface
4. `AppExposure` as the external publication surface
5. `AppInstance` as the product-facing projection
6. `RuleProfile` as the strategy layer

## Core Paradigm

The unified paradigm is:

**declarative lifecycle orchestration**

More specifically:

- desired business intent enters as an `AppOperation`
- runtime policy is selected by `RuleProfile`
- execution is instantiated as a DAG
- node execution mutates canonical runtime facts
- projection resolves those facts into product-facing state

This is a reconcile-oriented orchestration model, not a deployment-record state machine.

## Canonical Objects

### 1. AppInstance

Product-facing lifecycle root.

Owns:

- lifecycle state
- desired state
- health summary
- publication summary
- current release reference
- primary exposure reference
- operator-facing reason text

Does not own:

- in-flight execution detail
- node transitions
- retry state

### 2. AppOperation

Business action record.

Owns:

- operation type
- trigger
- execution mode
- phase
- terminal status
- failure reason
- app outcome
- normalized spec payload

Does not own:

- product-facing lifecycle state
- internal node graph execution

### 3. PipelineRun

Instantiated execution graph.

Owns:

- selected pipeline family and definition
- current execution phase
- overall pipeline status
- node counts and failed node summary

### 4. PipelineNodeRun

Smallest observable execution unit.

Owns:

- node identity and capability type
- dependency edges
- status, retries, manual-gate/wait semantics
- execution logs and error details
- compensation linkage

### 5. AppRelease

Recoverable runtime baseline.

Owns:

- rendered compose/runtime spec baseline
- resolved env baseline
- version/source identity
- active / candidate / last-known-good / historical role

### 6. AppExposure

External publication state.

Owns:

- exposure type
- route/domain intent
- certificate linkage
- publication state
- exposure health state

### 7. RuleProfile

Execution and policy strategy object.

Owns:

- pipeline family/definition selection hints
- retry policy
- compensation policy
- manual-gate policy
- verification policy
- publication sensitivity
- bounded concurrency policy

## Target Control Flow

```text
request -> normalize intent -> create AppOperation -> resolve RuleProfile
        -> select PipelineDefinition -> seed PipelineRun/NodeRuns
        -> DAG runner executes ready nodes
        -> node outcomes persist canonical facts
        -> operation terminal result persisted
        -> projection updates AppInstance / AppRelease / AppExposure
        -> UI/API read one lifecycle truth model
```

## Target Execution Model

### Queue boundary

- workers receive `operation_id`
- raw adapter payloads do not cross the queue boundary
- runtime execution always begins from persisted normalized records

### Scheduler boundary

- one conflicting active lifecycle operation per `server_id`
- cross-server parallelism allowed
- same-server non-conflicting parallelism remains policy-controlled

### DAG runner boundary

The runner is a dependency-aware DAG executor, not a simple ordered loop.

It must:

- load node graph state
- compute ready nodes from dependency completion
- execute ready nodes
- persist status transitions deterministically
- support continuation for waiting/manual-gate states
- support bounded parallelism where policy allows

It must not:

- invent hidden nested workflows
- derive execution order from array position alone
- hide strategy policy inside executors

## Projection Model

Projection is a resolver, not a compensation engine.

Projection inputs must come from normalized fact channels:

- operation activity facts
- runtime facts
- health facts
- exposure/publication facts
- release facts

Projection responsibilities:

- derive product-facing lifecycle state
- derive stable state reason
- expose compact product-facing state to UI/API

Projection must not:

- act as the primary source of execution truth
- compensate for ambiguous source semantics with uncontrolled heuristics

## Policy Model

All meaningful strategy variation belongs in `RuleProfile`.

Examples:

- standard compose install
- source-build install
- high-risk change with manual gate
- publication-sensitive change
- rollback/recovery strict compensation

Selection inputs may include:

- operation type
- source type
- execution mode
- app template/category
- exposure sensitivity
- target/server capability

## Explicit Non-Goals

- no compatibility preservation for legacy `deployments`
- no external workflow engine introduction in this phase
- no generalized rules engine
- no multi-server cluster scheduler in this phase

## Architectural Invariants

1. `AppOperation` is the only lifecycle action truth.
2. `PipelineRun` plus `PipelineNodeRun` are the only execution-graph truth.
3. `AppInstance` is a projection, never the in-flight execution store.
4. `AppRelease` is required for deterministic promotion, rollback, and recovery.
5. `AppExposure` owns publication state; publication state does not masquerade as top-level execution state.
6. Strategy belongs to `RuleProfile`, not to scattered worker branching.
7. The worker runtime remains Asynq-based; orchestration semantics live in lifecycle code, not in the queue substrate.

## Migration Direction

The architecture converges in this order:

1. remove legacy `deployments` from runtime truth
2. upgrade the runner into a real DAG executor
3. normalize evidence boundaries and simplify projection
4. introduce `RuleProfile` as the strategy layer

This order is mandatory because later steps assume one execution truth.
