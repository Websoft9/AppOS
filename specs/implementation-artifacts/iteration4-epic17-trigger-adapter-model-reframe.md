# Lifecycle Trigger and Adapter Model Reframe

Status: draft

## Purpose

Clarify the role of `operation_type`, `trigger`, and `adapter` in the lifecycle model so pipeline selection stays stable as AppOS adds more deployment paths.

This note is a design correction to the current lifecycle contract, where pipeline definitions are selected by `operation_type + source + adapter`.

## Current Assessment

The current model uses three selector dimensions:

- `operation_type`
- `source`
- `adapter`

In practice these dimensions are not equally important.

- `operation_type` describes lifecycle intent.
- `adapter` describes execution strategy.
- `source` currently mixes trigger semantics and entry-path semantics.

That mixing has already caused drift:

- The Store prefill story says Store should enter the shared manual compose flow rather than define a Store-only execution path.
- The current backend route for template/store install creates operations with `source=store` and `adapter=manual-compose`.
- The metadata registry has no `install + store + manual-compose` definition, so selection fails even though the execution path is the same as shared compose install.

This is evidence that `source` is overloaded and should not participate in pipeline graph selection.

## Proposed Terminology

### `operation_type`

Answers: what lifecycle action is being performed?

Examples:

- `install`
- `upgrade`
- `publish`
- `rollback`

Rules:

- This remains a first-class pipeline selector dimension.
- It defines the lifecycle family boundary.
- It should remain small and business-meaningful.

### `trigger`

Answers: who or what triggered this operation?

Recommended values:

- `manual`
- `automatic`

Optional secondary detail values:

- `external_event`
- `scheduled_task`
- `internal_reconcile`

Rules:

- `trigger` replaces the current overloaded `source` concept.
- `trigger` is not a pipeline selector dimension.
- `trigger` is persisted for audit, analytics, UX, and policy decisions.
- `trigger_detail` is optional metadata, not part of pipeline matching.

### `adapter`

Answers: how is this operation executed?

Examples:

- `manual-compose`
- `git-compose`
- `source-build`
- `store-compose`
- `static-build`
- `git-source-build`

Rules:

- `adapter` is the execution-strategy dimension.
- `adapter` participates in pipeline selection.
- Different adapters may produce different node graphs, inputs, and validation rules.

## Proposed Selector Rule

Pipeline definitions should be selected by:

- `operation_type + adapter`

Not by:

- `operation_type + trigger + adapter`

Reasoning:

- `trigger` changes who initiated work, not how the work executes.
- `adapter` changes node graph shape, required inputs, and runtime mechanics.
- Keeping `trigger` in the selector creates a combinatorial expansion without adding execution clarity.

## Dimension Responsibilities

| Dimension | Question answered | Controls pipeline graph | Should be persisted on operation | Typical cardinality |
| --- | --- | --- | --- | --- |
| `operation_type` | What lifecycle action is this? | Yes | Yes | Small |
| `trigger` | Who or what initiated it? | No | Yes | Very small |
| `adapter` | How will AppOS execute it? | Yes | Yes | Moderate |

## Mapping the Current Install Paths

| Current entry | Current meaning | Proposed `trigger` | Proposed `adapter` | Notes |
| --- | --- | --- | --- | --- |
| Manual compose form | Operator pastes compose | `manual` | `manual-compose` | Shared compose path |
| Git compose form | Operator provides repo/ref/compose path | `manual` | `git-compose` | Retrieval path differs before execution |
| Store/template install | Operator starts from Store UI | `manual` | `store-compose` or `manual-compose` | Use `store-compose` only if execution adds Store-specific nodes |
| Scheduled reconciliation install | System enqueues install | `automatic` | depends on artifact path | Trigger changes, adapter may not |

## Rule for Store and Git

Store and Git are not triggers.

They describe either:

- how inputs are prepared before execution, or
- what execution strategy is used after preparation.

Therefore:

- `store` should not be modeled as a trigger.
- `git` should not be modeled as a trigger.
- if Store and Git only alter ingress normalization, they stay outside selector logic.
- if they alter execution graph, they must be represented as distinct adapters.

## Adapter Modeling Guidance for Future Deployment Paths

### Git Compose Deploy

- Trigger is usually `manual`.
- Adapter is `git-compose`.
- Distinct because compose retrieval is part of the execution preparation path.

### Source Build Deploy

- Trigger is usually `manual`.
- Adapter is `source-build`.
- Distinct because it adds build, publish, and release nodes.

### Static Blog Build Deploy

- Trigger is usually `manual`.
- Adapter should be `static-build`.
- Distinct because output is a built artifact or static site bundle, not a generic runtime compose flow.

### Git Source Build Deploy

- Trigger is usually `manual`.
- Adapter should be `git-source-build` if git checkout and source build form one execution strategy.
- Do not collapse this into a generic `git` label because the meaningful distinction is execution mode, not ingress origin.

## Decision Rule: When to Add a New Adapter

Introduce a new adapter when one or more of the following are true:

- the node graph changes
- required preflight checks change materially
- required persisted execution inputs change materially
- runtime ownership changes materially
- build/publish/release behavior changes materially

Do not introduce a new adapter when only these change:

- who clicked the button
- which page initiated the operation
- which metadata labels are attached for audit
- which defaults are prefilled before the operation record is created

## Migration Direction

### Step 1: terminology correction

- Introduce `trigger` vocabulary with values `manual` and `automatic`.
- Keep a secondary detail field for automation subtype when needed.

### Step 2: selector simplification

- Remove `source` from `DefinitionSelector`.
- Remove `sources` from lifecycle metadata definitions.
- Select definitions by `operation_type + adapter`.

### Step 3: persistence compatibility

- Replace `trigger_source` with `trigger` in new contracts.
- If migration cost is high, temporarily keep the storage field but narrow allowed values to trigger semantics and stop using it for metadata selection.

### Step 4: adapter normalization

- Re-evaluate all install ingress paths and name adapters by execution strategy rather than entry origin.
- Decide whether Store should remain `manual-compose` or become `store-compose` based on whether Store-specific execution nodes are required.

## Recommended Immediate Policy

Until the model is refactored:

- treat Store as a shared compose install path, not a distinct source-driven execution path
- avoid introducing any new lifecycle definition that differs only by `source`
- prefer new adapter names only when execution semantics truly diverge

## Impact on Existing Story Language

This note supersedes one part of the current lifecycle contract language:

- the selector should no longer be described as `operation_type + source + adapter`

It remains aligned with the existing Store prefill story intent:

- Store should feed the shared install system unless it truly requires a distinct execution strategy

## Summary

The stable lifecycle model should be:

- `operation_type`: what lifecycle action is being performed
- `trigger`: who or what initiated it
- `adapter`: how AppOS executes it

Only `operation_type + adapter` should choose the pipeline definition.
`trigger` should remain operational metadata, not a graph-selection dimension.