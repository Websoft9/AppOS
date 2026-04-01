# Story 18.1b: Runtime Context Technical Direction

Status: proposed

## Objective

Turn `18.1b AppInstance Runtime Context Stabilization` into an implementation-ready technical direction.

The goal is to make Installed-side app management read models stable without re-expanding `AppInstance` into an execution-owned object.

## Problem Statement

Current `AppInstance` API shaping in `backend/domain/routes/apps.go` reconstructs `project_dir`, `source`, and `compose_project_name` through this path:

`app_instances.last_operation -> app_operations -> operation fields/spec_json`

This is the exact seam the domain assessment called out as too weak.

It causes three practical problems:

1. `App Detail` and related management views depend on the existence and readability of the latest operation record.
2. Stable operator-facing app context is coupled to execution-history reconstruction.
3. The management read model cannot stand on its own when `last_operation` is empty, stale, or points at an operation that is no longer the best source for current app context.

## Current Code Evidence

### Backend coupling points

`backend/domain/routes/apps.go`

- `appInstanceResponse(...)` calls `resolveAppRuntimeContext(...)` before shaping `/api/apps` list and detail responses.
- `resolveAppRuntimeContext(...)` currently fails its primary path when `last_operation` is missing.
- `resolveAppRuntimeContext(...)` reads `project_dir`, `trigger_source`, and `compose_project_name` from `app_operations` first, then falls back to `spec_json`.

### Frontend dependence

`dashboard/src/pages/apps/types.ts`

- `AppInstance` expects `project_dir` and `source` directly from `/api/apps`.

`dashboard/src/pages/apps/AppDetailSecondaryTabs.tsx`

- The Installed-side page uses `app.project_dir` directly for workspace linking and runtime-related summary.

### Projection mismatch

`backend/domain/lifecycle/projection/updater.go`

- The projection layer already persists true app-management state like `desired_state`, `lifecycle_state`, `publication_summary`, and `last_operation`.
- It does not currently persist stable runtime-context anchor fields needed by Installed-side read models.

## Design Judgment

The fix should not be “make routes smarter at reconstructing from operations.”

The fix should be “make the app-management projection durable enough that routes do less reconstruction.”

That means:

- `last_operation` stays as lifecycle linkage.
- app-scoped management context gets its own stable projection fields.
- execution-owned detail stays on `Operation` and shared Actions surfaces.

## Recommended Boundary

### AppInstance should own as stable management projection

These fields should be readable without traversing `last_operation`:

1. `project_dir`
2. `compose_project_name`
3. app-scoped source lineage summary for management use

This is not execution detail. These are operator-facing runtime anchors used repeatedly across Installed-side views and management actions.

### AppInstance should not absorb

The following should remain execution-side or linked projection data:

1. pipeline internals
2. node state
3. action detail, timeline, and logs
4. execution-specific transient metadata that is only meaningful for one operation run

## Recommended Data Model Direction

### Minimal field additions to `app_instances`

Add stable projection fields to `app_instances`:

1. `project_dir` as text
2. `compose_project_name` as text
3. `runtime_context_source` as select or text

`runtime_context_source` is recommended over a generic `source` field name in storage because:

- it makes clear this is a management read-model summary, not raw operation payload reuse;
- it avoids confusion with release artifact source, publication source, or future source-build terminology.

### API response contract

Keep the Installed-side API response shape backward-compatible for now:

- continue returning `project_dir`
- continue returning `source`

Implementation rule:

- API `source` should read from projected `runtime_context_source`
- API should not force frontend changes in the first hardening slice

## Population Rules

### Primary write path

The stable runtime-context fields should be written when a lifecycle operation establishes or changes the app runtime anchor.

Recommended write events:

1. install
2. upgrade
3. redeploy
4. config apply or rollback once converged to shared lifecycle actions

### Source of truth for writes

Write projection fields from normalized operation input at the time the operation is created or when projection is updated from operation lifecycle transitions.

Preferred rule:

- operation creation writes canonical operation fields as today
- projection update copies stable runtime-context fields into `app_instances` when the operation becomes the new valid app runtime anchor

This keeps the domain layering consistent:

- operation remains execution record
- app instance remains management projection

### Fallback posture

During migration, `resolveAppRuntimeContext(...)` may use this order:

1. read projected fields from `app_instances`
2. if missing, fall back to `last_operation`
3. if still missing, return partial context instead of treating missing `last_operation` as the defining failure

This should be treated as a migration bridge, not the final architecture.

## Route-Level Refactoring Direction

### `resolveAppRuntimeContext(...)`

Refactor from “operation-first reconstruction helper” into “app projection reader with migration fallback”.

Target behavior:

1. initialize from `app_instances` projection fields
2. only consult `last_operation` if projected fields are absent
3. return partial context when possible instead of hard failing on missing `last_operation`

### `appInstanceResponse(...)`

Use projected app context directly.

Also include `desired_state` in the response while touching this code path, because:

- the field already exists in schema and projection logic
- Installed-side types currently omit it
- this avoids reopening the same response contract twice

This is a strong piggyback opportunity between `18.1b` and `18.1c`.

## Frontend Direction

### Keep first slice minimal

The dashboard should not need structural redesign for `18.1b`.

Frontend changes should be limited to:

1. continuing to consume `project_dir` and `source` as before
2. optionally consuming `desired_state` once exposed
3. removing any hidden assumption that these fields only exist when `last_operation` exists

### No UI ownership expansion

Do not use this story as a reason to expand App Detail into deeper runtime or execution ownership.

The UI goal is stability of existing management views, not new runtime capability scope.

## Suggested File Touchpoints

### Backend

1. `backend/infra/migrations/` for new `app_instances` fields
2. `backend/domain/lifecycle/projection/updater.go`
3. `backend/domain/routes/apps.go`
4. route tests in `backend/domain/routes/apps_test.go`

### Frontend

1. `dashboard/src/pages/apps/types.ts`
2. Installed-side tests only where contract assumptions need to be updated

## Delivery Plan

### Slice A: Projection shape and response fallback

1. add projected runtime-context fields to `app_instances`
2. update response shaping to prefer projection fields
3. keep operation fallback for migration safety
4. expose `desired_state` in `/api/apps`

### Slice B: Projection write convergence

1. update projection write paths so install/upgrade/redeploy refresh runtime-context fields
2. verify later lifecycle actions do not erase valid app runtime anchor state unnecessarily

### Slice C: Remove overreliance on operation fallback

1. tighten `resolveAppRuntimeContext(...)` fallback behavior
2. treat operation lookup as compatibility bridge, not primary read source

## Test Strategy

### Backend tests to add or update

1. `/api/apps/{id}` returns `project_dir` and `source` when `last_operation` is empty but projected fields exist
2. `/api/apps/{id}` still returns `last_operation` independently as lifecycle linkage
3. `/api/apps` list responses remain stable under the same condition
4. `/api/apps` exposes `desired_state`
5. migration fallback still works when projected fields are absent but `last_operation` is present

### Frontend tests to add or update

1. Installed-side type fixtures include `desired_state`
2. App detail runtime/workspace links still render with projected `project_dir`

## Non-Goals

This story should not:

1. redesign action history queries
2. redesign config workflows
3. move execution detail into App Detail
4. attempt a full runtime or observability domain model rewrite

## Recommended Implementation Order

1. deliver backend response hardening and `desired_state` exposure together
2. then update projection write paths
3. then reduce operation fallback dependence

This order gives immediate Installed-side stability while keeping the first implementation slice small.

## Follow-On Relationship

This technical direction intentionally creates the cleanest handoff to:

1. `18.1c Desired State Projection Completion`
2. `18.4b App-scoped Action History Query Contract`
3. `18.3a Config Apply and Rollback Lifecycle Convergence`

In particular, `18.1b` and `18.1c` should be implemented together if the team wants the smallest high-value API contract cleanup.

## References

- `specs/implementation-artifacts/story18.1b-app-instance-runtime-context-stabilization.md`
- `specs/implementation-artifacts/story18.1c-desired-state-projection-completion.md`
- `specs/implementation-artifacts/epic17-18-app-instance-subdomain-assessment.md`
- `backend/domain/routes/apps.go`
- `backend/domain/lifecycle/projection/updater.go`
- `dashboard/src/pages/apps/types.ts`