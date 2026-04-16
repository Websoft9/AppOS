# Story 28.1: Monitoring Domain Foundation

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed
**Depends on**: Epic 8, Epic 18, Epic 20

## Objective

Define the minimal monitoring domain contract so all later ingestion, checks, and UI work share one target model and one latest-status model.

## Scope

- Define canonical monitor target types: `server`, `app`, `resource`, `platform`
- Define canonical signal types: `metric`, `heartbeat`, `health_check`, `availability_check`
- Define normalized latest-status model and allowed MVP states
- Define status projection ownership and persistence boundaries

## First Slice Note

This story should absorb the first delivery slice at the domain level instead of spawning an extra story.

For the first implementation pass, narrow Story 28.1 to:

- `monitor_latest_status` only
- `server` and `platform` target types only
- status set limited to `healthy`, `offline`, `unknown` where possible
- latest-status projection and persistence only

The broader target taxonomy remains the design direction, but first delivery should not block on full multi-target coverage.

## Entity Draft

This story should define only the minimum shared monitoring entities required by later stories.

### 1. MonitorTargetRef

Canonical identity reference reused across monitoring flows.

| Field | Type | Required | Notes |
|------|------|----------|-------|
| `target_type` | enum | yes | `server` \| `app` \| `resource` \| `platform` |
| `target_id` | string | yes | existing domain record id, or fixed singleton id for platform targets |
| `display_name` | string | yes | denormalized display label for list and overview rendering |
| `scope` | string | no | optional grouping such as `system`, `resource`, `app-runtime` |
| `source_domain` | string | yes | `servers`, `apps`, `resources`, `platform` |

Notes:

- `MonitorTargetRef` is a reference model, not a new registry.
- `server`, `app`, and `resource` records stay owned by their existing domains.
- `platform` targets may use fixed ids such as `appos-core`, `monitor-ingest`, `scheduler`.
- business domains own target identity and metadata; monitoring owns status projection, scheduling, and result normalization.

### 2. MonitorSignalEnvelope

Minimal normalized raw signal wrapper before status projection.

| Field | Type | Required | Notes |
|------|------|----------|-------|
| `signal_type` | enum | yes | `metric` \| `heartbeat` \| `health_check` \| `availability_check` |
| `target_type` | enum | yes | same as `MonitorTargetRef.target_type` |
| `target_id` | string | yes | same as `MonitorTargetRef.target_id` |
| `reported_at` | datetime | yes | producer timestamp |
| `observed_by` | string | yes | `agent`, `appos_active_check`, `appos_self` |
| `status_hint` | string | no | optional mapped status hint for non-metric signals |
| `reason` | string | no | short machine-readable or operator-readable reason |
| `payload` | object | no | raw signal body; must not contain secret values |

### 3. MonitorLatestStatus

Primary operator-facing projection. All monitoring pages should read from this entity first.

| Field | Type | Required | Notes |
|------|------|----------|-------|
| `target_type` | enum | yes | composite identity |
| `target_id` | string | yes | composite identity |
| `status` | enum | yes | `healthy` \| `degraded` \| `offline` \| `unreachable` \| `credential_invalid` \| `unknown` |
| `reason` | string | no | latest operator-facing reason |
| `signal_source` | string | yes | source of the state judgment |
| `last_transition_at` | datetime | yes | last status change time |
| `last_success_at` | datetime | no | last success-like observation |
| `last_failure_at` | datetime | no | last failure-like observation |
| `consecutive_failures` | int | yes | defaults to `0` |
| `last_checked_at` | datetime | no | last active-check execution time |
| `last_reported_at` | datetime | no | last pushed signal time |
| `summary` | object | no | tiny denormalized detail used by overview/detail surfaces |

Recommended `summary` keys for MVP:

- `heartbeat_state`
- `runtime_state`
- `check_kind`
- `metric_window`
- `failing_component`

## Business Store Draft

MVP should keep business-store persistence deliberately small.

### Preferred MVP Persistence Shape

Use PocketBase base collections, consistent with the current backend migration style.

Recommended collection constants:

- `MonitorLatestStatus = "monitor_latest_status"`
- `MonitorCheckResults = "monitor_check_results"`

Preferred rollout order:

1. create `monitor_latest_status` first
2. ship `monitor_check_results` only if active-check diagnostics need shallow recent history immediately

### Table / Collection: `monitor_latest_status`

Purpose: one latest state row per monitored target.

| Field | Type | Indexed | Notes |
|------|------|---------|-------|
| `id` | string | yes | internal primary key |
| `target_type` | text | yes | unique composite index part 1 |
| `target_id` | text | yes | unique composite index part 2 |
| `display_name` | text | no | denormalized for overview rendering |
| `status` | text | yes | filterable current state |
| `reason` | text | no | short failure/degradation reason |
| `signal_source` | text | no | latest deciding source |
| `last_transition_at` | datetime | yes | current state entered at |
| `last_success_at` | datetime | no | last success-like event |
| `last_failure_at` | datetime | no | last failure-like event |
| `last_checked_at` | datetime | no | AppOS active-check timestamp |
| `last_reported_at` | datetime | no | pushed report timestamp |
| `consecutive_failures` | number | no | current streak |
| `summary_json` | json | no | tiny read-model payload |
| `created` | datetime | no | standard audit field |
| `updated` | datetime | yes | standard audit field |

Required indexes:

- unique: `(target_type, target_id)`
- query: `(status, updated)`
- query: `(target_type, status)`

### Optional Table / Collection: `monitor_check_results`

Purpose: shallow latest-or-recent check history for active checks only.

| Field | Type | Indexed | Notes |
|------|------|---------|-------|
| `id` | string | yes | internal primary key |
| `target_type` | text | yes | query key |
| `target_id` | text | yes | query key |
| `check_kind` | text | yes | `reachability` \| `credential` \| `app_health` |
| `outcome` | text | yes | `success` \| `failure` |
| `reason` | text | no | latest failure reason |
| `observed_by` | text | no | usually `appos_active_check` |
| `started_at` | datetime | no | execution start |
| `finished_at` | datetime | yes | execution end |
| `details_json` | json | no | small diagnostic payload |

Notes:

- This table is optional for story 28.1 if the team wants to ship only `monitor_latest_status` first.
- Time-series metrics do not belong here.

## PocketBase Collection Draft

### Collection: `monitor_latest_status`

Recommended rules:

- `ListRule`: authenticated users can read, subject to later domain auth tightening
- `ViewRule`: authenticated users can read, subject to later domain auth tightening
- `CreateRule`: `nil` because backend-managed only
- `UpdateRule`: `nil` because backend-managed only
- `DeleteRule`: `nil` because backend-managed only

Recommended field mapping:

| PocketBase Field | Type |
|------------------|------|
| `target_type` | `SelectField` |
| `target_id` | `TextField` |
| `display_name` | `TextField` |
| `status` | `SelectField` |
| `reason` | `TextField` |
| `signal_source` | `TextField` |
| `last_transition_at` | `DateField` |
| `last_success_at` | `DateField` |
| `last_failure_at` | `DateField` |
| `last_checked_at` | `DateField` |
| `last_reported_at` | `DateField` |
| `consecutive_failures` | `NumberField` |
| `summary_json` | `JSONField` |

Recommended enum values:

- `target_type`: `server`, `app`, `resource`, `platform`
- `status`: `healthy`, `degraded`, `offline`, `unreachable`, `credential_invalid`, `unknown`

Recommended indexes:

- `idx_monitor_latest_target_unique` unique on `target_type, target_id`
- `idx_monitor_latest_status_updated` non-unique on `status, updated`
- `idx_monitor_latest_target_status` non-unique on `target_type, status`

### Collection: `monitor_check_results`

This collection should remain optional in the first migration wave.

Recommended rules:

- `ListRule`: authenticated users can read, subject to later domain auth tightening
- `ViewRule`: authenticated users can read, subject to later domain auth tightening
- `CreateRule`: `nil` because backend-managed only
- `UpdateRule`: `nil` because backend-managed only
- `DeleteRule`: `nil` because backend-managed only

Recommended field mapping:

| PocketBase Field | Type |
|------------------|------|
| `target_type` | `SelectField` |
| `target_id` | `TextField` |
| `check_kind` | `SelectField` |
| `outcome` | `SelectField` |
| `reason` | `TextField` |
| `observed_by` | `TextField` |
| `started_at` | `DateField` |
| `finished_at` | `DateField` |
| `details_json` | `JSONField` |

Recommended enum values:

- `check_kind`: `reachability`, `credential`, `app_health`
- `outcome`: `success`, `failure`

Recommended indexes:

- `idx_monitor_checks_target_kind_finished` on `target_type, target_id, check_kind, finished_at`
- `idx_monitor_checks_outcome_finished` on `outcome, finished_at`

## Migration Draft

Implementation should follow the established `backend/infra/migrations/*.go` pattern.

Recommended files:

- `backend/infra/collections/names.go`
  add `MonitorLatestStatus` and optionally `MonitorCheckResults`
- `backend/infra/migrations/<timestamp>_monitor_latest_status.go`
  create or ensure `monitor_latest_status`
- `backend/infra/migrations/<timestamp>_monitor_check_results.go`
  optional second migration if the team wants shallow check history in MVP

Recommended migration approach:

1. use `core.NewBaseCollection(...)`
2. apply `ListRule` and `ViewRule` consistent with current authenticated-read collections
3. keep create, update, and delete backend-managed
4. use `SelectField` for bounded enums instead of free-text where values are already frozen
5. use `JSONField` for `summary_json` and `details_json`
6. add indexes explicitly in migration code

Illustrative migration skeleton for `monitor_latest_status`:

```go
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.MonitorLatestStatus)
		if err != nil {
			col = core.NewBaseCollection(collections.MonitorLatestStatus)
		}

		col.ListRule = types.Pointer("@request.auth.id != ''")
		col.ViewRule = types.Pointer("@request.auth.id != ''")
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		addFieldIfMissing(col, &core.SelectField{Name: "target_type", Required: true, MaxSelect: 1, Values: []string{"server", "app", "resource", "platform"}})
		addFieldIfMissing(col, &core.TextField{Name: "target_id", Required: true, Max: 200})
		addFieldIfMissing(col, &core.TextField{Name: "display_name", Required: true, Max: 200})
		addFieldIfMissing(col, &core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"healthy", "degraded", "offline", "unreachable", "credential_invalid", "unknown"}})
		addFieldIfMissing(col, &core.TextField{Name: "reason", Max: 500})
		addFieldIfMissing(col, &core.TextField{Name: "signal_source", Max: 80})
		addFieldIfMissing(col, &core.DateField{Name: "last_transition_at", Required: true})
		addFieldIfMissing(col, &core.DateField{Name: "last_success_at"})
		addFieldIfMissing(col, &core.DateField{Name: "last_failure_at"})
		addFieldIfMissing(col, &core.DateField{Name: "last_checked_at"})
		addFieldIfMissing(col, &core.DateField{Name: "last_reported_at"})
		addFieldIfMissing(col, &core.NumberField{Name: "consecutive_failures", OnlyInt: true})
		addFieldIfMissing(col, &core.JSONField{Name: "summary_json", MaxSize: 1 << 20})

		col.AddIndex("idx_monitor_latest_target_unique", true, "target_type, target_id", "")
		col.AddIndex("idx_monitor_latest_status_updated", false, "status, updated", "")
		col.AddIndex("idx_monitor_latest_target_status", false, "target_type, status", "")

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.MonitorLatestStatus)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
```

## Query and Update Draft

Expected MVP access patterns:

- upsert by `(target_type, target_id)` when ingest or active checks finish
- list by unhealthy states for overview pages
- filter by `target_type` for embedded detail surfaces
- fetch one exact target for detail status card

Expected updater behavior:

1. normalize incoming signal into one status judgment candidate
2. compare with existing latest-status row
3. update `last_transition_at` only when status value changes
4. update `last_success_at` or `last_failure_at` according to outcome class
5. increment or reset `consecutive_failures`
6. keep `summary_json` intentionally small and UI-oriented

## JSON Handling Guardrail

Because PocketBase JSON fields may decode into multiple runtime shapes in this repo, monitoring code must decode `summary_json` and `details_json` defensively rather than assuming `map[string]any`.

## Time-Series Naming Draft

Story 28.1 should freeze naming conventions, not full storage implementation.

Suggested metric series families:

- `appos_host_cpu_usage`
- `appos_host_memory_usage_bytes`
- `appos_host_disk_usage_bytes`
- `appos_host_network_rx_bytes_total`
- `appos_host_network_tx_bytes_total`
- `appos_container_cpu_usage`
- `appos_container_memory_usage_bytes`
- `appos_platform_process_cpu_usage`
- `appos_platform_process_memory_usage_bytes`
- `appos_monitor_ingest_failures_total`

Suggested common labels:

- `target_type`
- `target_id`
- `server_id`
- `app_id`
- `container_name`
- `component`

## Minimal Read API Field Draft

Story 28.1 does not need to implement routes, but it should lock the response contract used by later stories.

### `GET /api/monitor/targets/{targetType}/{targetId}`

```json
{
	"targetType": "server",
	"targetId": "srv_xxx",
	"displayName": "prod-01",
	"status": "healthy",
	"reason": null,
	"signalSource": "agent",
	"lastTransitionAt": "2026-04-14T12:00:00Z",
	"lastSuccessAt": "2026-04-14T12:00:00Z",
	"lastFailureAt": null,
	"lastCheckedAt": null,
	"lastReportedAt": "2026-04-14T12:00:00Z",
	"consecutiveFailures": 0,
	"summary": {
		"heartbeatState": "fresh",
		"runtimeState": "running"
	}
}
```

### `GET /api/monitor/overview`

```json
{
	"counts": {
		"healthy": 10,
		"degraded": 2,
		"offline": 1,
		"unreachable": 1,
		"credentialInvalid": 1,
		"unknown": 0
	},
	"unhealthyItems": [
		{
			"targetType": "resource",
			"targetId": "res_xxx",
			"displayName": "registry-main",
			"status": "credential_invalid",
			"reason": "authentication failed",
			"lastTransitionAt": "2026-04-14T12:03:00Z",
			"detailHref": "/resources/res_xxx"
		}
	]
}
```

## Decision Rules Draft

These rules should be explicit in implementation even if they live as code constants.

1. Fresh heartbeat does not automatically imply `healthy` if active health checks are failing.
2. `credential_invalid` outranks generic `degraded` for resource targets when credential validation fails.
3. `offline` is reserved for stale or missing reports from agent-owned targets.
4. `unreachable` is reserved for AppOS-initiated connectivity failure.
5. If no trusted signal exists yet, status must remain `unknown`.

## Acceptance Criteria

- [ ] AC1: A canonical target model exists and reuses identity from existing server, app, and resource domains instead of creating duplicate registries.
- [ ] AC2: A canonical signal taxonomy exists for metrics, heartbeat, health checks, and availability checks.
- [ ] AC3: Every monitored target can project to one normalized latest-status document with `status`, `reason`, `last_transition_at`, `last_success_at`, `last_failure_at`, and `consecutive_failures`.
- [ ] AC4: MVP status values are limited to `healthy`, `degraded`, `offline`, `unreachable`, `credential_invalid`, and `unknown`.
- [ ] AC5: Secret values are never persisted in monitoring records; only validation outcomes are stored.
- [ ] AC6: A concrete business-store draft exists for the latest-status projection, including required indexes and a unique key on target identity.
- [ ] AC7: A minimal response field contract exists for target detail and monitoring overview reads.
- [ ] AC8: Status precedence rules are documented so heartbeat, health checks, and credential checks cannot produce contradictory UI semantics.

## Implementation Notes

- Keep this story domain-first; do not over-design history retention.
- Status projection must be the primary read model for operator-facing pages.
- Metrics storage shape may remain abstract here as long as later stories can bind it to VictoriaMetrics cleanly.
- Prefer one stable latest-status projection over early generalization into a broad event-sourcing model.
- If PocketBase collections are used for MVP persistence, field names may stay snake_case internally while API fields stay camelCase externally.

## File Targets

- backend monitoring domain package for shared target, signal, and status types
- backend persistence layer for latest-status projection
- optional OpenAPI schema fragments if route work starts in parallel
- migration or collection definition for `monitor_latest_status`

## Out of Scope

- Agent implementation
- Scheduled checks
- Monitoring UI
- Alert routing