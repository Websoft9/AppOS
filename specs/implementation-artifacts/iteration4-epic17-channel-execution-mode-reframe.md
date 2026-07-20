# Lifecycle Channel and Execution Mode Reframe

Status: draft

## Confirmed decisions

This proposal records the confirmed direction for the lifecycle install model.

1. `source` is renamed to `channel`.
2. `channel` values are `store | git | custom`.
3. `adapter` is renamed to `execution_mode`.
4. `execution_mode` values are `compose | build`.
5. Build strategy remains nested build metadata, not a new top-level lifecycle dimension.

## Problem statement

The current model has two naming and modeling problems.

### `source` is overloaded

The current `source` values mix different abstraction levels:

- business origin: `template`, `git`
- payload form: `file`, `image`
- user action flavor: `manual`

As a result, `source` does not answer a single stable question.

### `adapter` is also overloaded

The current `adapter` values such as `manual-compose`, `git-compose`, and
`source-build` mix ingress flavor and execution semantics in one field.

Examples:

- `manual-compose` and `git-compose` encode origin details
- `source-build` encodes a graph split: build first, then deploy

This makes the field hard to reason about and encourages enum growth through
combined names.

## Target model

The target lifecycle model should use four top-level dimensions.

| Dimension | Question answered | Example values |
| --- | --- | --- |
| `operation_type` | What action is being performed? | `install`, `upgrade`, `rollback` |
| `trigger` | Who or what initiated the operation? | `manual`, `automatic` |
| `channel` | Where did the app come from? | `store`, `git`, `custom` |
| `execution_mode` | Which pipeline shape should run? | `compose`, `build` |

### `channel`

`channel` is business origin.

| Value | Meaning |
| --- | --- |
| `store` | app-store template or catalog driven install |
| `git` | Git repository driven install |
| `custom` | operator-supplied content without a productized upstream |

Important properties:

- `channel` survives later lifecycle operations.
- `channel` supports UX and policy decisions.
- `channel` does not select the pipeline graph.

### `execution_mode`

`execution_mode` is pipeline shape.

| Value | Meaning |
| --- | --- |
| `compose` | deploy from resolved compose input |
| `build` | build artifact first, then deploy |

Important properties:

- `execution_mode` is small by design.
- `execution_mode` should be the only install-time execution selector besides `operation_type`.
- `execution_mode` must not encode channel names.

## Why build is not a separate top-level dimension

The real pipeline split is binary:

- deploy directly
- build first, then deploy

That split is already captured by `execution_mode=compose|build`.

Different build techniques such as the following are not separate top-level
lifecycle dimensions:

- `dockerfile`
- `buildpacks`
- future `binary`
- future `static-site`

These should remain nested under build metadata, for example
`source_build.builder_strategy`, because they only matter once the graph has
already chosen the `build` execution mode.

## Selector rule

Pipeline definitions should be selected by:

- `operation_type + execution_mode`

They should not be selected by:

- `operation_type + channel + execution_mode`
- `operation_type + trigger + execution_mode`

Reasoning:

- `channel` changes origin, not graph shape.
- `trigger` changes initiator semantics, not graph shape.
- `execution_mode` is the dimension that materially changes preflight checks,
  execution nodes, artifact flow, and runtime ownership.

## Example mapping

| User path | `channel` | `execution_mode` | Remarks |
| --- | --- | --- | --- |
| Manual compose install | `custom` | `compose` | direct operator-provided compose |
| Store template install | `store` | `compose` | same graph as shared compose deploy |
| Git compose install | `git` | `compose` | Git is origin metadata, not a graph split |
| Uploaded source package | `custom` | `build` | build graph produces deployable artifact |
| Future Git source build | `git` | `build` | channel remains Git while mode becomes build |
| Future store template with build | `store` | `build` | upstream remains store while graph changes |

## Current-to-target rename plan

| Current concept | Target concept | Current storage |
| --- | --- | --- |
| `source` | `channel` | `spec_json.source`, `app_instances.source_type` |
| `adapter` | `execution_mode` | `spec_json.adapter`, `app_operations.adapter` |
| `trigger_source` | `trigger` | `app_operations.trigger_source` |

## Minimal migration path

### Step 1: terminology alignment

- Update docs and design notes to speak in terms of `channel` and `execution_mode`.
- Stop introducing new logic that assumes `source` and `adapter` are stable names.

### Step 2: vocabulary alignment

- Replace current source value semantics with `store | git | custom`.
- Replace current adapter value semantics with `compose | build`.
- Keep normalization helpers for older values during migration.

### Step 3: selector alignment

- Ensure metadata definitions only key on `operation_type + execution_mode`.
- Remove any remaining channel-based selector branches.

### Step 4: API and persistence alignment

- Rename response fields from `source` to `channel`.
- Rename response fields from `adapter` to `execution_mode`.
- Decide whether database field names are migrated immediately or kept as transitional internal names.

### Step 5: build metadata alignment

- Keep build-specific details inside the build input payload.
- Add or refine `builder_strategy` values only when a real builder implementation exists.
- Do not add a top-level lifecycle dimension unless `build` later proves too coarse for pipeline selection.

## Non-goals

This proposal does not require AppOS to support every build flavor immediately.

Specifically, it does not require immediate first-class support for:

- binary compilation
- static-site pipeline specialization
- image import specialization beyond the existing build path

Those can be added later as build-strategy capabilities without changing the
shape of the top-level lifecycle model.

## Recommended policy

Until the full rename lands:

- treat current `source` as transitional channel metadata
- treat current `adapter` as transitional execution-mode metadata
- avoid inventing combined names such as `store-compose` or `git-build`
- keep pipeline graph decisions anchored on `operation_type + execution_mode`

## Summary

The stable lifecycle model should be:

- `operation_type`: what action is being performed
- `trigger`: who or what initiated it
- `channel`: where the app comes from
- `execution_mode`: how AppOS executes it

Only `operation_type + execution_mode` should choose the pipeline definition.
`channel` and `trigger` remain important operational metadata, but they should
not shape the pipeline graph.
