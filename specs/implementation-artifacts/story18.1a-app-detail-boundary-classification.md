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

## App Detail Design Rules

The following rules are the normative design rules for future `App Detail` expansion.

1. `App Detail` owns app-centric summary and entry points, not every execution or runtime truth in full.
2. Execution truth stays in `Actions` and `Action Detail`; `App Detail` may show summaries, status hints, and deep links only.
3. Runtime-heavy capabilities may be entered from `App Detail`, but deep operations should remain app-scoped gateways into their owning surfaces rather than being fully reimplemented inline.
4. Only app-scoped projections should become first-class `App Detail` content; platform-wide capabilities must not be disguised as app tabs.

## App Detail Final Primary Tabs

The primary information architecture for `App Detail` should stabilize on the following first-level tabs:

1. `Overview`
2. `Access`
3. `Actions`
4. `Runtime`
5. `Compose`
6. `Observability`
7. `Data`
8. `Automation`
9. `Settings`

### Why These Tabs

- `Overview` keeps the page app-centric.
- `Access` combines endpoint and account-entry concerns into one operator mental model: how to get into the app.
- `Actions` keeps lifecycle history and operation entry points together without collapsing into execution-detail ownership.
- `Runtime` contains app-scoped runtime and container operations.
- `Compose` keeps orchestration assets and config editing together.
- `Observability` unifies logs, metrics, and heartbeat/health instead of splitting them into unstable top-level tabs.
- `Data` groups database and backup concerns into one app data plane.
- `Automation` isolates app-scoped schedules and planned runs from lifecycle actions.
- `Settings` keeps app-specific preferences, metadata, and security summary together.

## Navigation and Layout Recommendation

### First-Level Navigation

- First-level tabs should be vertical on desktop.
- The main reason is scale: nine primary tabs are too many for a stable horizontal top bar.
- Vertical navigation also reinforces that `App Detail` is an app workspace, not a simple form page.

### Second-Level Navigation

- Prefer sections before introducing nested tabs.
- Use horizontal second-level tabs only when one first-level tab contains 2 to 4 highly stable peer subviews that operators switch between frequently.
- The default structure should be: `vertical primary tabs + stacked sections in the content area`.

### Responsive Rule

- Desktop: vertical primary tabs on the left, sections on the right.
- Mobile: replace vertical tabs with a compact top selector or horizontally scrollable tab strip.
- On mobile, avoid deep nested tabs whenever possible.

## Tab Structure and Section Layout

This section defines the target section breakdown for each primary tab.

### 1. Overview

Purpose:

- Give one operator-facing summary of the app's current lifecycle, exposure, health, and recent activity.

Sections:

- `Lifecycle Summary`
- `Access Snapshot`
- `Current Execution Summary`
- `Health Snapshot`
- `Recent Actions`

### 2. Access

Purpose:

- Answer how operators or end users reach the app and how they sign in.

Sections:

- `Endpoints`
- `Accounts`

### 3. Actions

Purpose:

- Show all app-scoped lifecycle actions while keeping full execution truth outside the page.

Sections:

- `Current and Recent`
- `Action History`
- `Quick Filters and Deep Links`

### 4. Runtime

Purpose:

- Show app-scoped container/runtime status and provide controlled entry points into runtime operations.

Sections:

- `Containers`
- `Runtime Operations`
- `Container Diagnostics Entry`

### 5. Compose

Purpose:

- Own the runtime orchestration asset summary and editing workflow for the app.

Sections:

- `Compose Asset`
- `Validation and Diff`
- `Rollback and IaC Handoff`

### 6. Observability

Purpose:

- Unify logs, metrics, and app heartbeat/health into one supporting domain surface.

Sections:

- `Logs`
- `Metrics`
- `Health and Heartbeat`

### 7. Data

Purpose:

- Group application data dependencies and recovery safeguards.

Sections:

- `Database Connections`
- `Backups and Restore Points`

### 8. Automation

Purpose:

- Hold app-scoped schedules and repeatable automation entry points without confusing them with lifecycle execution.

Sections:

- `Schedules`
- `Recent Runs`
- `Automation Links`

### 9. Settings

Purpose:

- Keep app-specific preferences, metadata, and lightweight security summary together.

Sections:

- `App Settings`
- `Security Summary`
- `Metadata and Notes`

## Field Inventory by Tab

The following inventory is the current target field list for the future `App Detail` layout. It is intentionally product-facing and does not freeze backend schema design.

### Overview

#### Lifecycle Summary

- `app name`
- `app id`
- `lifecycle_state`
- `status`
- `runtime_status`
- `health_summary`
- `publication_summary`
- `installed_at`
- `updated`

#### Access Snapshot

- `primary domain`
- `public IP access URL`
- `certificate summary`
- `account availability summary`

#### Current Execution Summary

- `last_operation`
- `current_pipeline.family`
- `current_pipeline.current_phase`
- `current operation status hint`
- `link to action detail`

#### Health Snapshot

- `heartbeat state`
- `last successful heartbeat`
- `latest diagnostic summary`
- `resource usage summary`

#### Recent Actions

- `latest N actions`
- `latest success`
- `latest failure`
- `link to full actions list`

### Access

#### Endpoints

- `primary domain`
- `secondary domains`
- `path-based exposure`
- `public IP URL`
- `port`
- `TLS / certificate status`
- `certificate expiry summary`
- `exposure publication_state`
- `link to gateway or exposure detail`

#### Accounts

- `default username`
- `default password hint`
- `credential retrieval method`
- `operator-entered account notes`
- `first login instructions`
- `password rotation reminder`
- `secret reference link`

### Actions

#### Current and Recent

- `current queued/running action`
- `last_operation`
- `operation type`
- `started_at`
- `finished_at`
- `terminal_status`
- `app_outcome`

#### Action History

- `action list table`
- `operation id`
- `operation type`
- `status`
- `source`
- `server`
- `duration`
- `result summary`

#### Quick Filters and Deep Links

- `filter by status`
- `filter by operation type`
- `filter by source`
- `open action detail`
- `open actions page with app filter`

### Runtime

#### Containers

- `container list`
- `container name`
- `container id`
- `image`
- `state`
- `restart count`
- `published ports`
- `created time`

#### Runtime Operations

- `exec entry`
- `file browser entry`
- `container log entry`
- `start / stop / restart shortcuts where appropriate`
- `open runtime project path`

#### Container Diagnostics Entry

- `open container detail`
- `open docker view`
- `runtime error summary`
- `project_dir`

### Compose

#### Compose Asset

- `compose content`
- `iac_path`
- `compose project name`
- `source lineage`

#### Validation and Diff

- `validation state`
- `validation message`
- `diff preview`
- `last validated content marker`

#### Rollback and IaC Handoff

- `rollback available`
- `rollback_saved_at`
- `rollback_source_action`
- `open in IaC`

### Observability

#### Logs

- `aggregated app logs`
- `container log links`
- `log refresh state`
- `latest error snippet`

#### Metrics

- `CPU usage`
- `memory usage`
- `disk usage`
- `network throughput`
- `container resource summary`

#### Health and Heartbeat

- `heartbeat status`
- `last heartbeat time`
- `health check results`
- `runtime_reason`
- `warning / degraded signals`

### Data

#### Database Connections

- `database type`
- `host`
- `port`
- `database name`
- `username`
- `credential reference`
- `connection method notes`
- `link to related resource`

#### Backups and Restore Points

- `backup enabled status`
- `latest volume backup`
- `latest restore point`
- `backup target`
- `backup policy summary`
- `restore entry link`

### Automation

#### Schedules

- `cron or schedule list`
- `schedule expression`
- `enabled status`
- `target action`
- `next run time`

#### Recent Runs

- `latest run status`
- `last run time`
- `last error`
- `run duration`

#### Automation Links

- `open system task detail`
- `open automation procedure`
- `open related action history`

### Settings

#### App Settings

- `app-level preferences`
- `operational flags`
- `environment summary`
- `custom annotations`

#### Security Summary

- `scan status summary`
- `latest scan time`
- `risk summary`
- `credential exposure hint`
- `hardening recommendations summary`

#### Metadata and Notes

- `operator notes`
- `business owner`
- `maintenance window`
- `tags`
- `support reference`

## Deep Link and Ownership Rules

The following content should remain summarized in `App Detail` and route outward when deeper inspection or control is needed.

### Keep as Summary in App Detail

- lifecycle status and publication summary
- current execution summary
- latest health and resource summary
- app-scoped access summary
- latest database and backup summary

### Deep Link to Other Surfaces

- operation timeline, node progression, and execution truth -> `Actions` / `Action Detail`
- full runtime manipulation and terminal interaction -> runtime/container/terminal surfaces
- gateway route and certificate detail -> exposure or gateway surfaces
- full backup management and restore workflow -> data or backup execution surfaces
- platform-wide security and scan workflows -> security or system surfaces

### Explicit Non-Goals for App Detail

- it is not the owner of platform-wide configuration
- it is not the owner of full execution detail
- it is not the owner of full remote access tooling
- it is not the owner of generalized observability infrastructure

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
