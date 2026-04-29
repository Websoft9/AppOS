# Story 28.2: Agent Ingestion and Metrics Pipeline

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed
**Depends on**: Story 28.1, Epic 20

## Objective

Add the minimal ingestion path for managed servers so AppOS can receive host metrics, low-frequency host facts, heartbeat, and runtime summary from a systemd-managed agent.

## Scope

- Define authenticated ingest contract for server agent
- Add ingest endpoints for metrics, facts, heartbeat, and runtime summary
- Store high-frequency metrics in `VictoriaMetrics`
- Store normalized low-frequency host facts on the canonical server record such as `server.facts_json`
- Update latest-status projection with heartbeat freshness and runtime summary

## First Slice Note

This story should absorb the first delivery slice at the ingest level instead of spawning an extra story.

For the first implementation pass, narrow Story 28.2 to:

- monitoring agent token bootstrap
- `POST /api/monitor/ingest/heartbeat` only
- `server` heartbeat first, `platform` self-observation may be local-only
- freshness evaluation into `healthy`, `offline`, or `unknown`

Facts ingest, metrics ingest, and runtime summary ingest remain in Story 28.2, but should land after heartbeat-first validation succeeds.

## Authentication Draft

MVP should use a dedicated monitoring agent token per server.

Do not reuse the tunnel token directly. The tunnel token solves remote access identity. The monitoring agent token solves ingest trust and rotation. Coupling them would make monitoring availability depend on tunnel lifecycle choices and would complicate future separation.

### Token model

- one monitoring agent token per managed server
- token stored in existing `secrets` collection
- `template_id = single_value`
- `created_source = system`
- preferred secret naming convention: `monitor-agent-token-{serverID}`
- plaintext token is shown only at generation or rotation time

### Bootstrap routes

These routes are operator/bootstrap routes, not ingest routes.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/monitor/servers/{id}/agent-token` | create or rotate monitoring agent token |
| GET | `/api/monitor/servers/{id}/agent-setup` | return agent config snippet and systemd unit template |

Bootstrap route behavior:

- requires superuser auth
- idempotent token fetch unless `rotate=true`
- rotation invalidates the previous token immediately
- no public setup script route is required for MVP; returning config text is enough

## Ingest Contract Draft

All ingest routes should be backend-managed and machine-authenticated.

### Authentication transport

Preferred MVP transport:

- `Authorization: Bearer <monitor-agent-token>`

Alternative accepted transport only if implementation simplicity requires it:

- `X-AppOS-Agent-Token: <token>`

Lookup behavior:

1. resolve token against system-created secret named `monitor-agent-token-{serverID}`
2. infer the related `serverID`
3. reject requests for mismatched server ownership in the payload

### Request envelope

All ingest endpoints should accept a common top-level envelope.

```json
{
	"serverId": "srv_xxx",
	"agentVersion": "0.1.0",
	"reportedAt": "2026-04-14T12:00:00Z",
	"items": []
}
```

Required top-level fields:

- `serverId`
- `reportedAt`
- `items`

Optional top-level fields:

- `agentVersion`
- `hostname`

Guardrails:

- `serverId` in the payload must match the authenticated token owner
- `reportedAt` older than a bounded skew window may be accepted but marked as stale-source input
- batch size should be capped in MVP to avoid oversized writes

## API

- `POST /api/monitor/ingest/metrics`
- `POST /api/monitor/ingest/facts`
- `POST /api/monitor/ingest/heartbeat`
- `POST /api/monitor/ingest/runtime-status`

### `POST /api/monitor/ingest/metrics`

Purpose: receive metric batches for host, container, and AppOS-adjacent runtime series.

### Container Telemetry Extension

This story should also own the first monitoring-side contract for Docker container telemetry when AppOS chooses Netdata-backed collection instead of request-time Docker CLI stats.

Scope of this extension:

- define allowlisted container telemetry families for CPU, memory, and network usage
- keep container telemetry in the metrics pipeline rather than PocketBase collections
- define stable label requirements so UI consumers can join telemetry to Docker inventory safely
- keep telemetry ingestion separate from Docker inventory, inspect, logs, and control actions

Out of scope for this extension:

- image inventory ingestion
- network inventory ingestion
- volume inventory ingestion
- full container inventory snapshots in monitoring storage
- replacing Docker CLI as the control-plane integration for server detail actions

Required label direction for container telemetry:

- `server_id` remains required for server ownership
- one stable container identity label must be present for joins, such as `container_id`
- optional operator-friendly labels such as `container_name`, `compose_project`, and `compose_service` may be included when collector quality is acceptable
- UI consumers must treat human-readable labels as best-effort hints; `container_id` remains the canonical join key

MVP usage target:

- this telemetry is intended for server detail and app detail runtime evidence
- first UI consumers may replace request-time `docker stats` reads with monitor-backed current usage and short-window trends
- Docker list, inspect, logs, and lifecycle actions continue to use Docker ext APIs outside this story

Suggested `items` payload shape:

```json
[
	{
		"targetType": "server",
		"targetId": "srv_xxx",
		"series": "appos_host_cpu_usage",
		"value": 0.42,
		"unit": "ratio",
		"labels": {
			"server_id": "srv_xxx"
		},
		"observedAt": "2026-04-14T12:00:00Z"
	}
]
```

MVP rules:

- accept only allowlisted metric families
- ignore or reject unknown series families
- write metrics to `VictoriaMetrics`
- do not mirror raw metric points into PocketBase collections
- container telemetry must stay bounded to a small allowlist and must not open arbitrary per-label TSDB querying from the browser

### `POST /api/monitor/ingest/facts`

Purpose: receive normalized low-frequency host facts selected by `appos-agent` from collector output such as Netdata.

Facts ingest is a server-scoped snapshot write, not a patch stream.
The agent must send AppOS-owned canonical field names, and the backend must persist the latest accepted snapshot onto the canonical server record.

Suggested `items` payload shape:

```json
[
	{
		"targetType": "server",
		"targetId": "srv_xxx",
		"facts": {
			"os": {
				"family": "linux",
				"distribution": "ubuntu",
				"version": "24.04"
			},
			"kernel": {
				"release": "6.8.0-31-generic"
			},
			"architecture": "arm64",
			"cpu": {
				"cores": 4
			},
			"memory": {
				"total_bytes": 8589934592
			}
		},
		"observedAt": "2026-04-14T12:00:00Z"
	}
]
```

MVP rules:

- facts are low-frequency snapshots, not time-series samples
- Netdata may be the source collector, but payload field names must already be normalized to AppOS-owned shape before persistence
- facts ingest is server-scoped only in MVP: `targetType` must be `server` and `targetId` must equal authenticated `serverId`
- batch size should be `1` in MVP so one request writes one canonical server snapshot
- upsert normalized facts onto the canonical server record such as `server.facts_json`
- facts writes replace the previous snapshot for that server instead of merging partial payloads
- store the accepted snapshot observation time separately on the server record such as `server.facts_observed_at`
- do not persist collector-native fact payloads or plugin metadata verbatim
- unknown top-level fact groups should be rejected or dropped by explicit allowlist policy rather than silently persisted

MVP canonical fact allowlist:

- `os.family`
- `os.distribution`
- `os.version`
- `kernel.release`
- `architecture`
- `cpu.cores`
- `memory.total_bytes`

Not in MVP facts payloads:

- full CPU model strings
- network interface inventory
- disk inventory
- Netdata plugin metadata
- raw container facts
- collector-native payload passthrough

### `POST /api/monitor/ingest/heartbeat`

Purpose: update freshness and simple liveness for server-owned targets.

Suggested `items` payload shape:

```json
[
	{
		"targetType": "server",
		"targetId": "srv_xxx",
		"status": "healthy",
		"reason": null,
		"observedAt": "2026-04-14T12:00:00Z"
	},
	{
		"targetType": "app",
		"targetId": "app_xxx",
		"status": "healthy",
		"reason": null,
		"observedAt": "2026-04-14T12:00:00Z"
	}
]
```

MVP rules:

- heartbeat updates `last_reported_at`
- heartbeat may update `last_success_at` for healthy reports
- heartbeat alone must not overwrite stronger failure states produced by active checks

### `POST /api/monitor/ingest/runtime-status`

Purpose: receive compact runtime summary not suited to TSDB-only reads.

Suggested `items` payload shape:

```json
[
	{
		"targetType": "server",
		"targetId": "srv_xxx",
		"runtimeState": "running",
		"containers": {
			"running": 12,
			"restarting": 1,
			"exited": 0
		},
		"apps": [
			{
				"appId": "app_xxx",
				"runtimeState": "running"
			}
		],
		"observedAt": "2026-04-14T12:00:00Z"
	}
]
```

MVP rules:

- runtime summary is compact and latest-only
- store distilled runtime summary in `summary_json` through latest-status projection
- do not persist full container inventories or verbose process lists in PocketBase for MVP

## Freshness and State Draft

Heartbeat freshness should be evaluated centrally by AppOS, not only inferred at write time.

Recommended MVP thresholds:

- expected heartbeat interval: `30s`
- stale threshold: `90s`
- offline threshold: `180s`

Recommended behavior:

1. fresh heartbeat keeps agent-owned target eligible for `healthy` or `degraded`
2. no heartbeat beyond stale threshold marks `summary.heartbeat_state = stale`
3. no heartbeat beyond offline threshold can transition target to `offline`
4. active-check failures still outrank fresh heartbeat when the target is reachable but unhealthy

## VictoriaMetrics Write Draft

The backend should hide TSDB specifics behind a small write adapter.

Suggested responsibilities:

- validate allowlisted metric names
- normalize labels
- batch points into one write call where possible
- surface write failures as `appos_monitor_ingest_failures_total`
- avoid leaking TSDB response details into operator-facing APIs

Suggested file targets:

- monitoring TSDB writer adapter
- monitoring metric allowlist definitions
- monitoring label normalization helpers

## Registration and Setup Draft

MVP should keep agent setup intentionally small.

### `GET /api/monitor/servers/{id}/agent-setup`

Suggested response:

```json
{
	"serverId": "srv_xxx",
	"token": "plain-text-token",
	"ingestBaseUrl": "https://appos.example.com/api/monitor/ingest",
	"systemdUnit": "[Unit]\nDescription=appos agent\n...",
	"configYaml": "server_id: srv_xxx\ninterval: 30s\n..."
}
```

This is enough for MVP because the operator can copy a rendered config and systemd unit to the managed server. No remote installer or package repository is required yet.

## Platform Self-Observation Write Path

Platform targets (`appos-core`, `monitor-ingest`, `scheduler`, `worker`) are not managed servers and do not run an external agent. AppOS must write their status directly.

Recommended approach:

- AppOS self-collects platform-component health internally on a short background interval
- Results are written to `monitor_latest_status` using the same upsert path as ingest routes
- `target_type = platform`, `target_id` uses the fixed component identifiers
- `signal_source = appos_self`
- Platform self metrics (CPU, memory, queue depth) are written to VictoriaMetrics through the same write adapter used for ingest metrics

This makes platform status visible in the overview without requiring an external signal path. The background collector may run as a lightweight goroutine inside the AppOS process, triggered by the existing cron or ticker infrastructure.

## Collection and Persistence Draft

This story should not create a raw-ingest collection by default.

Persist only:

- latest status updates in `monitor_latest_status`
- normalized host facts on the canonical server record such as `server.facts_json`
- latest facts observation time on the canonical server record such as `server.facts_observed_at`
- optional recent diagnostic check records later in `monitor_check_results`
- agent token material in existing `secrets` collection

Do not persist:

- raw metric batches in PocketBase
- raw collector fact payloads in PocketBase
- verbose runtime payload history in PocketBase
- a dedicated `monitor_agents` collection unless operations later prove it necessary

## Acceptance Criteria

- [ ] AC1: AppOS accepts authenticated ingest requests from managed servers.
- [ ] AC2: Host and container metrics are written to the dedicated time-series backend, not the primary business store.
- [ ] AC3: AppOS accepts authenticated `POST /api/monitor/ingest/facts` requests that are scoped to the token-owning server only.
- [ ] AC4: Normalized low-frequency host facts can be ingested and persisted onto the canonical server record in `server.facts_json`, with `server.facts_observed_at` updated from the accepted snapshot.
- [ ] AC5: Facts ingest writes replace the previous facts snapshot for that server instead of merging partial collector payloads.
- [ ] AC6: Facts ingest accepts only the MVP canonical fact allowlist and does not persist collector-native field names or plugin metadata verbatim.
- [ ] AC7: Heartbeat ingest updates freshness state for the related target.
- [ ] AC8: Stale or missing heartbeat can transition a target to `offline` through the latest-status projection.
- [ ] AC9: Runtime summary payloads can attach minimal container and app runtime state to the target summary without requiring log ingestion.
- [ ] AC10: Agent authentication uses a dedicated per-server monitoring token rather than coupling ingest trust to unrelated access tokens.
- [ ] AC11: Ingest payloads use a compact common envelope with bounded batch semantics.
- [ ] AC12: Unknown or disallowed metric families are rejected or ignored by an explicit allowlist policy.
- [ ] AC13: The MVP setup flow can generate a token and return enough config material to install a systemd-managed agent manually.
- [ ] AC14: Container telemetry ingestion defines a stable container identity label contract that downstream UI can join against Docker inventory without persisting container inventories in PocketBase.
- [ ] AC15: The first container telemetry slice remains limited to runtime usage evidence and does not absorb Docker inventory, inspect, logs, or action control into the monitoring domain.

## Implementation Notes

As-built note:

- heartbeat freshness projection now uses registry-backed heartbeat mapping at projection time rather than resolving the server baseline inside the projection helper itself
- `signals/agent` passes the resolved target registry entry into heartbeat evaluation so the freshness-to-status mapping stays aligned with the canonical monitoring registry contract

- Keep payload shape compact and batch-friendly.
- Treat Netdata as an allowed fact source, but keep AppOS field naming and persistence shape independent from collector-native schemas.
- Reuse existing secret-management and setup-route patterns where helpful, but keep monitoring token lifecycle separate from tunnel lifecycle.
- Facts ingest should be implemented only after adding server schema fields for `facts_json` and `facts_observed_at`.
- Facts route tests should cover server ownership mismatch, invalid target type, invalid target id, replace-not-merge semantics, and allowlist enforcement before implementation is marked complete.
- Agent-side facts collection should not block heartbeat delivery; facts failures may be logged and retried on the next cycle while heartbeat remains the primary freshness signal.
- Do not introduce a full Prometheus-compatible scrape surface in this story.
- Keep TSDB access behind a writer adapter so VictoriaMetrics remains an implementation detail outside the monitoring domain boundary.
- Prefer one agent per server. Multi-agent fan-in on the same server is out of scope for MVP.
- Container telemetry should prefer a collector-native source such as Netdata when available, but AppOS must still normalize series names and required labels before exposing them to UI consumers.
- Do not let container telemetry requirements force a broadening of the existing monitor read APIs into arbitrary TSDB explorers.

## File Targets

- backend ingest routes under `/api/monitor/ingest/*`
- backend migration for server facts fields
- backend time-series write adapter
- backend facts persistence updater for canonical server records
- backend projection updater for heartbeat freshness
- backend OpenAPI docs for ingest endpoints
- bootstrap route or service for monitoring agent token/setup generation
- secret lookup helper for monitor-agent token validation
- backend route tests for facts ingest
- agent facts collection and `/facts` post path
- agent or collector mapping for allowlisted container telemetry series
- backend metric allowlist and query mapping for container telemetry consumers

## Out of Scope

- Active checks
- Overview UI
- Docker inventory replacement
- Alerting

## Dev Agent Record

### Completion Notes

- Added `servers.facts_json` and `servers.facts_observed_at` as the canonical persistence target for low-frequency server facts snapshots.
- Implemented `POST /api/monitor/ingest/facts` with bearer-token ownership validation, one-item MVP batch enforcement, and server-scoped target validation.
- Added `signals/agent` facts normalization and allowlist enforcement for `os`, `kernel`, `architecture`, `cpu.cores`, and `memory.total_bytes`.
- Implemented replace-not-merge facts persistence onto the server record.
- Extended `appos-agent` to collect a minimal canonical facts snapshot from local OS/runtime state and post it to `/facts` without blocking heartbeat when facts collection or upload degrades.
- Added monitor route coverage for facts happy path, ownership mismatch, allowlist rejection, replace semantics, and batch size enforcement.

### Tests Run

- `cd /data/dev/appos/backend && go test ./infra/migrations`
- `cd /data/dev/appos/backend && go test ./domain/routes`
- `cd /data/dev/appos/backend && go test ./domain/monitor/signals/agent ./cmd/appos-agent`

### File List

- `backend/infra/migrations/1765500000_add_server_monitor_facts.go`
- `backend/infra/migrations/migrations_test.go`
- `backend/domain/monitor/signals/agent/errors.go`
- `backend/domain/monitor/signals/agent/facts.go`
- `backend/domain/routes/monitor.go`
- `backend/domain/routes/monitor_test.go`
- `backend/cmd/appos-agent/main.go`
- `specs/implementation-artifacts/story28.2-agent-ingestion.md`