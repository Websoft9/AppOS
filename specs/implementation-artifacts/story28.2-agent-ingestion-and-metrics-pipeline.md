# Story 28.2: Agent Ingestion and Metrics Pipeline

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed
**Depends on**: Story 28.1, Epic 20

## Objective

Add the minimal ingestion path for managed servers so AppOS can receive host metrics, container metrics, heartbeat, and runtime summary from a systemd-managed agent.

## Scope

- Define authenticated ingest contract for server agent
- Add ingest endpoints for metrics, heartbeat, and runtime summary
- Store high-frequency metrics in `VictoriaMetrics`
- Update latest-status projection with heartbeat freshness and runtime summary

## First Slice Note

This story should absorb the first delivery slice at the ingest level instead of spawning an extra story.

For the first implementation pass, narrow Story 28.2 to:

- monitoring agent token bootstrap
- `POST /api/monitor/ingest/heartbeat` only
- `server` heartbeat first, `platform` self-observation may be local-only
- freshness evaluation into `healthy`, `offline`, or `unknown`

Metrics ingest and runtime summary ingest remain in Story 28.2, but should land after heartbeat-first validation succeeds.

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
- `POST /api/monitor/ingest/heartbeat`
- `POST /api/monitor/ingest/runtime-status`

### `POST /api/monitor/ingest/metrics`

Purpose: receive metric batches for host, container, and AppOS-adjacent runtime series.

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
	"systemdUnit": "[Unit]\nDescription=appos monitor agent\n...",
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
- optional recent diagnostic check records later in `monitor_check_results`
- agent token material in existing `secrets` collection

Do not persist:

- raw metric batches in PocketBase
- verbose runtime payload history in PocketBase
- a dedicated `monitor_agents` collection unless operations later prove it necessary

## Acceptance Criteria

- [ ] AC1: AppOS accepts authenticated ingest requests from managed servers.
- [ ] AC2: Host and container metrics are written to the dedicated time-series backend, not the primary business store.
- [ ] AC3: Heartbeat ingest updates freshness state for the related target.
- [ ] AC4: Stale or missing heartbeat can transition a target to `offline` through the latest-status projection.
- [ ] AC5: Runtime summary payloads can attach minimal container and app runtime state to the target summary without requiring log ingestion.
- [ ] AC6: Agent authentication uses a dedicated per-server monitoring token rather than coupling ingest trust to unrelated access tokens.
- [ ] AC7: Ingest payloads use a compact common envelope with bounded batch semantics.
- [ ] AC8: Unknown or disallowed metric families are rejected or ignored by an explicit allowlist policy.
- [ ] AC9: The MVP setup flow can generate a token and return enough config material to install a systemd-managed agent manually.

## Implementation Notes

- Keep payload shape compact and batch-friendly.
- Reuse existing secret-management and setup-route patterns where helpful, but keep monitoring token lifecycle separate from tunnel lifecycle.
- Do not introduce a full Prometheus-compatible scrape surface in this story.
- Keep TSDB access behind a writer adapter so VictoriaMetrics remains an implementation detail outside the monitoring domain boundary.
- Prefer one agent per server. Multi-agent fan-in on the same server is out of scope for MVP.

## File Targets

- backend ingest routes under `/api/monitor/ingest/*`
- backend time-series write adapter
- backend projection updater for heartbeat freshness
- backend OpenAPI docs for ingest endpoints
- bootstrap route or service for monitoring agent token/setup generation
- secret lookup helper for monitor-agent token validation

## Out of Scope

- Active checks
- Overview UI
- Alerting