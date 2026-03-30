# Story 18.1a: App Detail Boundary Classification

Status: review

## Story

As a product and engineering team,
I want `App Detail` to classify its data by aggregate ownership and projection type,
so that the lifecycle management surface stays centered on `AppInstance` without absorbing execution, runtime, gateway, and observability semantics into one giant app object.

## Acceptance Criteria

1. Classify the information shown in `App Detail` into three categories: `AppInstance aggregate state`, `lifecycle-related projections`, and `external runtime or observability data`.
2. `AppInstance` remains the primary management object for installed-app views and owns long-lived lifecycle meaning such as identity, desired state, lifecycle summary, and current release or exposure references.
3. `Operation`, `Release`, and `Exposure` data shown in `App Detail` are explicitly treated as related lifecycle projections or linked records rather than fields that redefine the `AppInstance` aggregate boundary.
4. Logs, health diagnostics, runtime status, terminal entry, and other operational views exposed from `App Detail` are classified as external runtime or observability data, not as `AppInstance` state.
5. The Epic 18 management surface description and downstream implementation work can use this classification to decide where new fields, actions, and detail panels belong.
6. This story does not change Epic 17 execution ownership, queue semantics, worker behavior, or pipeline contracts.

## Delivered Now

- [x] A stable three-way classification exists for current `App Detail` content.
- [x] `AppInstance` ownership boundaries are documented for Installed-side views.
- [x] Related lifecycle objects displayed in `App Detail` are marked as linked projections instead of aggregate-internal state.
- [x] Runtime and observability information shown in `App Detail` is marked as external supporting data.
- [x] Follow-on Epic 18 stories can reference this classification when adding lifecycle actions, configuration, publication, and recovery surfaces.

## Still Deferred

- [ ] UI restructuring beyond minimal labeling or documentation alignment.
- [ ] Detailed gateway boundary convergence between `Exposure` and `GatewayRoute`.
- [ ] Full query-model redesign for `App Detail`.
- [ ] Release and recovery flow convergence beyond current Installed-side scope.

## Dev Notes

- This is a domain-alignment story for Epic 18, not a visual redesign story.
- `App Detail` is a cross-domain container surface. It should remain app-centric without pretending every rendered datum belongs to the `AppInstance` aggregate.
- `AppInstance` is the management-facing object; Epic 17 `Operation` remains the execution-facing object.
- This story exists to reduce future modeling drift when Epic 18 adds action entry points, publication flows, config workflows, backup, and recovery surfaces.

### Suggested Classification Buckets

#### 1. AppInstance aggregate state

- app identity
- lifecycle state
- desired state
- current release reference
- primary exposure reference
- core status summary shown as lifecycle meaning

#### 2. Lifecycle-related projections

- last operation summary
- recent actions list
- release summary or release history snippets
- exposure summary
- recovery guidance derived from lifecycle state

#### 3. External runtime or observability data

- compose or container runtime status
- logs
- health checks and diagnostics
- terminal or shell entry points
- service and container operational views
- gateway or certificate details shown only as summary or linked context

## Current App Detail Classification (2026-03-30)

The current `App Detail` implementation is a multi-tab container with `overview`, `config`, `diff`, and `logs` tabs. It already mixes lifecycle state, execution projection, runtime state, and configuration assets in one page. The table below classifies the current content by ownership rather than by screen location.

| Current App Detail Data / Element | Current Source | Classification | Notes |
| --- | --- | --- | --- |
| `id`, `name`, `server_id`, `created`, `updated`, `installed_at` | `/api/apps/{id}` | `AppInstance aggregate state` | Core management identity and lifecycle anchor |
| `lifecycle_state` | `/api/apps/{id}` | `AppInstance aggregate state` | Lifecycle meaning belongs to `AppInstance` |
| `status` | `/api/apps/{id}` | `AppInstance aggregate state` | Installed-side lifecycle summary rather than execution detail |
| `publication_summary` | `/api/apps/{id}` | `AppInstance aggregate state` | App-facing publication summary; does not replace gateway-owned route policy |
| `last_operation` reference | `/api/apps/{id}` | `lifecycle-related projection` | Points to `Operation`; should remain a linked execution record, not app-owned execution state |
| `current_pipeline` family / phase | `/api/apps/{id}` | `lifecycle-related projection` | Execution projection from Epic 17, not `AppInstance` state |
| `Current Release` derived from active releases list | `/api/apps/{id}/releases` | `lifecycle-related projection` | Current release is shown as summary or reference; release history remains its own lifecycle object set |
| `Release Count` | `/api/apps/{id}/releases` | `lifecycle-related projection` | Derived summary over related lifecycle records |
| `Primary Exposure` derived from exposures list | `/api/apps/{id}/exposures` | `lifecycle-related projection` | App-facing exposure summary, not shared gateway route ownership |
| `Exposure Count` | `/api/apps/{id}/exposures` | `lifecycle-related projection` | Derived summary over related lifecycle records |
| `source` | `/api/apps/{id}` | `lifecycle-related projection` | Represents install/source lineage, not long-lived app business state |
| `runtime_status` | `/api/apps/{id}` with compose status normalization | `external runtime or observability data` | Derived from compose runtime and normalized into app response for convenience |
| `runtime_reason` | `/api/apps/{id}` | `external runtime or observability data` | Runtime diagnostic context, not aggregate meaning |
| `project_dir` | `/api/apps/{id}` and runtime resolution | `external runtime or observability data` | Runtime location / execution context, not core app business identity |
| `IaC Path` / `iac_path` | `/api/apps/{id}` and config endpoints | `external runtime or observability data` | Configuration asset reference into IaC workspace |
| `Compose Config` tab content | `/api/apps/{id}/config` | `external runtime or observability data` | Configuration asset editing surface backed by runtime/IaC assets |
| `Diff Preview` tab | client-side diff over config content | `external runtime or observability data` | Presentation-only derivative of configuration asset state |
| `Logs` tab output | `/api/apps/{id}/logs` | `external runtime or observability data` | Runtime logs belong to operational/runtime observation, not `AppInstance` |
| `Redeploy` / `Upgrade` actions | `/api/apps/{id}/redeploy`, `/api/apps/{id}/upgrade` | `lifecycle-related projection` | Management entry points that create or navigate to Epic 17 operations |
| `Start` / `Stop` / `Restart` / `Uninstall` actions | `/api/apps/{id}/{action}` | `AppInstance aggregate state` entry point with execution handoff | Product intent starts from app management but should converge on shared operation handling |
| `Execution Status` link | `last_operation` navigation | `lifecycle-related projection` | Explicit handoff from management surface to execution surface |

### Initial Boundary Judgment

1. The `overview` tab is mixed and should not be treated as a pure `AppInstance` page.
2. The strongest `AppInstance` fields today are identity, lifecycle summary, publication summary, and installed-side status fields.
3. `current_pipeline`, `last_operation`, release snippets, and exposure snippets should remain linked lifecycle projections.
4. Runtime status, logs, project path, IaC path, config editing, and diff belong to runtime or observability support layers even when presented from `App Detail`.
5. Future App Detail expansion should prefer adding summary cards and deep links over absorbing more foreign-domain state into the app aggregate.

### References

- [Source: specs/implementation-artifacts/epic18-app-management.md#Objective]
- [Source: specs/implementation-artifacts/epic18-app-management.md#Requirements]
- [Source: specs/implementation-artifacts/epic18-app-management.md#Integration Notes]
- [Source: specs/planning-artifacts/prd.md#L43]
- [Source: specs/planning-artifacts/prd.md#L139]
- [Source: specs/adr/appos-ddd-architecture.md#L129]
- [Source: specs/adr/appos-ddd-architecture.md#L246]

## Dev Agent Record

### Agent Model Used

GPT-5.4

### Debug Log References


### Completion Notes List

- Story created to anchor iteration-1 lifecycle management convergence without introducing a parallel epic.
- This story should feed Epic 18 implementation choices and reduce accidental aggregate sprawl inside Installed views.
- Current `App Detail` implementation has now been classified against actual UI fields and backend response semantics.

### File List
