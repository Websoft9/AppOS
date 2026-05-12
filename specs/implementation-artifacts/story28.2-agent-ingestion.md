# Story 28.2: Netdata Metrics and Control-Plane Evidence Pipeline

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed
**Depends on**: Story 28.1, Epic 20

## Objective

Replace the managed-server `appos-agent` push path with a Netdata metrics pipeline plus AppOS control-plane evidence collection.

Managed servers keep Netdata as the only continuous monitoring agent. AppOS derives metrics freshness from Netdata samples and collects non-metric facts, runtime snapshots, and manageability evidence through SSH/tunnel pull or temporary collectors.

## Scope

- Define Netdata remote-write metrics boundary for managed servers
- Add metrics freshness evaluation for Netdata-backed server targets
- Define control-plane pull contracts for facts, runtime snapshots, and manageability evidence
- Store high-frequency metrics in `VictoriaMetrics`
- Store normalized low-frequency host facts on the canonical server record such as `server.facts_json`
- Update latest-status projection with metrics freshness, control reachability, and runtime snapshot evidence

## First Slice Note

This story supersedes the original agent-ingestion direction. The first implementation pass should narrow to:

- Netdata remote-write freshness for `server` targets
- control-plane SSH/tunnel reachability evidence for `server` targets
- latest-status projection that distinguishes observable, manageable, stale, and offline states

Facts and runtime snapshots remain in this story, but should land after metrics freshness and control reachability semantics are stable.

## Legacy agent contract retirement

The following concepts are legacy under the new monitor direction:

- `appos-agent` managed-server binary
- monitor-agent token bootstrap for `appos-agent`
- `/api/monitor/servers/{id}/agent-token`
- `/api/monitor/servers/{id}/agent-setup`
- `/api/monitor/ingest/heartbeat`
- `/api/monitor/ingest/runtime-status`
- `appos-agent` facts push

Implementation may keep temporary backwards compatibility while replacement paths are introduced, but new design and new UI surfaces must not depend on these contracts.

## Authentication Draft

No AppOS-owned managed-server agent token is required for the new primary path.

Netdata metrics continue to flow through the AppOS public Netdata remote-write ingress. Control-plane pull uses existing server access credentials, SSH/tunnel reachability, and server-domain access resolution.

If a temporary collector is uploaded for one-shot collection, it should not receive a long-lived write token. It should return JSON on stdout to the control plane, and AppOS should own persistence.

<!-- Legacy agent token material retained below for implementation history only. -->

## Legacy Authentication Draft

This section is historical only. It describes the former `appos-agent` push model and must not be used for new implementation work.

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

## Evidence Contract Draft

All non-metric monitor inputs should become compact evidence records before latest-status projection.

Suggested evidence fields:

- `targetType`
- `targetId`
- `signalKind`: `metrics_freshness`, `control_reachability`, `runtime_snapshot`, `facts_snapshot`, `app_health`, `credential`, `reachability`
- `signalSource`: `netdata`, `ssh_pull`, `tunnel`, `temporary_collector`, `appos_self`
- `status`
- `severity`
- `reason`
- `observedAt`
- `expiresAt`
- `summary`

Projection rules should consume evidence, not raw collector-specific payloads.

## Legacy Ingest Contract Draft

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

## Legacy API Draft

The following ingest endpoints belong to the former `appos-agent` push model. New implementation should use Netdata remote write for time-series metrics and AppOS control-plane evidence collection for non-metric inputs.

- `POST /api/monitor/ingest/metrics`
- `POST /api/monitor/ingest/facts`
- `POST /api/monitor/ingest/heartbeat`
- `POST /api/monitor/ingest/runtime-status`

### Legacy `POST /api/monitor/ingest/metrics`

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

### Facts collection

Purpose: collect normalized low-frequency host facts through AppOS control-plane pull or a temporary collector.

Facts collection is a server-scoped snapshot write, not a patch stream.
The control-plane collector must normalize into AppOS-owned canonical field names, and the backend must persist the latest accepted snapshot onto the canonical server record.

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
- facts collection is server-scoped only in MVP: `targetType` must be `server`
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

### Metrics freshness

Purpose: derive freshness from the most recent Netdata-backed metric sample for server-owned targets.

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

- metrics freshness updates `last_reported_at` or equivalent latest-observed freshness metadata
- fresh metrics may update `last_success_at` for observability freshness only
- metrics freshness alone must not overwrite stronger failure states produced by active checks or control reachability evidence

### Runtime snapshot

Purpose: collect compact runtime summary not suited to TSDB-only reads through SSH/tunnel pull or a temporary collector.

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

Metrics freshness and control reachability should be evaluated centrally by AppOS.

Recommended MVP thresholds:

- expected Netdata export interval: `10s` to `30s`, depending on generated Netdata config
- stale threshold: `3x` expected export interval, with a minimum of `60s`
- offline threshold: `5x` expected export interval, with a minimum of `180s`

Recommended behavior:

1. fresh metrics keep a target observable but do not prove it is manageable
2. stale metrics mark `summary.metrics_state = stale`
3. missing metrics beyond offline threshold can contribute to `offline` only when control reachability also fails or is unknown
4. control reachability failures can mark a target `observable_not_manageable` when metrics are fresh
5. active-check failures still outrank freshness when the target is reachable but unhealthy

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

## Legacy Registration and Setup Draft

This section is historical only. MVP setup should no longer expose AppOS-owned managed-server agent setup.

### Legacy `GET /api/monitor/servers/{id}/agent-setup`

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

This route is legacy under the no-`appos-agent` direction. Netdata setup remains in the server monitor-agent/software delivery path; AppOS-owned agent setup should be retired.

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
- temporary collector artifacts should not be persisted after execution

Do not persist:

- raw metric batches in PocketBase
- raw collector fact payloads in PocketBase
- verbose runtime payload history in PocketBase
- a dedicated `monitor_agents` collection unless operations later prove it necessary

## Acceptance Criteria

- [ ] AC1: AppOS receives Netdata remote-write metrics from managed servers without requiring `appos-agent`.
- [ ] AC2: Host and container metrics are written to the dedicated time-series backend, not the primary business store.
- [ ] AC3: AppOS can collect normalized low-frequency host facts through control-plane pull or a temporary collector.
- [ ] AC4: Normalized low-frequency host facts can be persisted onto the canonical server record in `server.facts_json`, with `server.facts_observed_at` updated from the accepted snapshot.
- [ ] AC5: Facts ingest writes replace the previous facts snapshot for that server instead of merging partial collector payloads.
- [ ] AC6: Facts ingest accepts only the MVP canonical fact allowlist and does not persist collector-native field names or plugin metadata verbatim.
- [ ] AC7: Netdata metrics freshness updates freshness evidence for the related server target.
- [ ] AC8: Stale or missing metrics plus failed or unknown control reachability can transition a target to `offline` through the latest-status projection.
- [ ] AC9: Runtime snapshots can attach minimal container and app runtime state to the target summary without requiring log ingestion.
- [ ] AC10: Control-plane pull uses existing server access resolution rather than introducing a second long-lived managed-server AppOS agent credential.
- [ ] AC11: Evidence records use a compact common shape with bounded summary semantics.
- [ ] AC12: Unknown or disallowed metric families are rejected or ignored by an explicit allowlist policy.
- [ ] AC13: The MVP setup flow no longer exposes AppOS-owned managed-server agent setup; Netdata remains the only continuous managed-side agent.
- [ ] AC14: Container telemetry ingestion defines a stable container identity label contract that downstream UI can join against Docker inventory without persisting container inventories in PocketBase.
- [ ] AC15: The first container telemetry slice remains limited to runtime usage evidence and does not absorb Docker inventory, inspect, logs, or action control into the monitoring domain.

## Implementation Notes

Legacy as-built note:

- previous heartbeat freshness projection used registry-backed heartbeat mapping at projection time rather than resolving the server baseline inside the projection helper itself
- previous `signals/agent` code passed the resolved target registry entry into heartbeat evaluation so the freshness-to-status mapping stayed aligned with the canonical monitoring registry contract

- Keep payload shape compact and batch-friendly.
- Treat Netdata as an allowed fact source, but keep AppOS field naming and persistence shape independent from collector-native schemas.
- Reuse existing secret-management and setup-route patterns where helpful, but keep monitoring token lifecycle separate from tunnel lifecycle.
- Facts ingest should be implemented only after adding server schema fields for `facts_json` and `facts_observed_at`.
- Facts route tests should cover server ownership mismatch, invalid target type, invalid target id, replace-not-merge semantics, and allowlist enforcement before implementation is marked complete.
- Facts collection failures should not block metrics freshness evaluation; facts failures may be logged and retried on the next control-plane pull cycle.
- Do not introduce a full Prometheus-compatible scrape surface in this story.
- Keep TSDB access behind a writer adapter so VictoriaMetrics remains an implementation detail outside the monitoring domain boundary.
- Prefer zero AppOS-owned long-running agents per server. Netdata is the only continuous managed-side monitoring agent in this direction.
- Container telemetry should prefer a collector-native source such as Netdata when available, but AppOS must still normalize series names and required labels before exposing them to UI consumers.
- Do not let container telemetry requirements force a broadening of the existing monitor read APIs into arbitrary TSDB explorers.

## File Targets

- backend Netdata freshness evaluator
- backend control-plane evidence collector for SSH/tunnel pull
- backend migration for server facts fields
- backend time-series write adapter
- backend facts persistence updater for canonical server records
- backend projection updater for metrics freshness
- backend OpenAPI docs for Netdata remote write, evidence projection, and legacy route retirement behavior
- legacy cleanup for monitoring agent token/setup generation
- backend route or worker tests for control-plane facts collection
- control-plane facts collection and runtime snapshot path
- Netdata or control-plane mapping for allowlisted container telemetry series
- backend metric allowlist and query mapping for container telemetry consumers

## Out of Scope

- Active checks
- Overview UI
- Docker inventory replacement
- Alerting

## Replacement Implementation Slices

Use these slices for follow-up implementation work instead of extending the legacy `appos-agent` path.

### 28.2A Netdata metrics freshness evidence

- Query latest Netdata-backed samples for each managed server.
- Emit `metrics_freshness` evidence with `fresh`, `stale`, `missing`, or `unknown` state.
- Project metrics freshness into `monitor_latest_status` without claiming SSH/tunnel manageability.
- Keep VictoriaMetrics query details behind the monitor metrics adapter.

Implementation progress:

- Added Netdata-backed server metrics freshness query, evaluation, projection, worker task, and cron scheduling.
- Metrics freshness now writes `signal_source = netdata` and summary fields such as `metrics_freshness_state`, `metrics_observed_at`, and `metrics_reason_code`.
- Tests: `go test ./domain/monitor/status ./domain/monitor/metrics ./domain/monitor/signals/checks ./domain/worker`.

### 28.2B Control-plane reachability evidence

- Use existing server access resolution and SSH/tunnel path to perform a minimal safe control reachability probe.
- Emit `control_reachability` evidence with distinct outcomes for reachable, timeout, auth failure, tunnel unavailable, and unknown.
- Combine `metrics_freshness` and `control_reachability` into operator-facing server states such as observable-but-not-manageable and manageable-but-monitoring-stale.

Implementation progress:

- Added AppOS control-plane server reachability probing for direct SSH TCP paths and tunnel-forwarded SSH paths.
- Added `control_reachability` latest-status projection with `signal_source = appos_active_check` and summary fields such as `control_reachability_state`, `control_reason_code`, `probe_protocol`, `host`, `port`, and `latency_ms`.
- Added worker task and cron scheduling for `monitor:control_reachability` every minute.
- Updated the server monitor registry baseline to include Netdata and AppOS active-check signal sources plus `metrics_freshness` and `control_reachability` checks.
- Tests: `go test ./domain/monitor/... ./domain/worker`.

### 28.2C Facts snapshot by control-plane pull

- Replace agent-pushed facts with control-plane collection.
- Keep the existing canonical facts persistence fields: `servers.facts_json` and `servers.facts_observed_at`.
- Keep the allowlist narrow and align naming toward OpenTelemetry Resource semantic conventions where practical.

Implementation progress:

- Added AppOS control-plane facts pull over the existing managed-server SSH/tunnel access configuration.
- Reused the existing canonical facts normalization and replace-not-merge persistence path for `servers.facts_json` and `servers.facts_observed_at`.
- Added a narrow remote facts command for `os.family`, `os.distribution`, `os.version`, `kernel.release`, `architecture`, `cpu.cores`, and `memory.total_bytes`.
- Added worker task and cron scheduling for `monitor:facts_pull` every 15 minutes.
- Updated the server monitor registry baseline to include `facts_snapshot`.
- Tests: `go test ./domain/monitor/signals/checks ./domain/worker ./domain/monitor`.

### 28.2D Runtime snapshot by control-plane pull

- Collect compact docker/systemd/runtime summary through SSH/tunnel pull or a temporary collector.
- Persist only distilled evidence and latest-status summary, not full inventory history.
- Keep Docker inventory, inspect, logs, and lifecycle control outside Monitor.

Implementation progress:

- Added AppOS control-plane runtime snapshot pull over the existing managed-server SSH/tunnel access configuration.
- Collected a compact Docker state summary via `docker ps -a --format '{{.State}}'` and persisted only distilled counts for running, restarting, and exited-like containers.
- Reused the existing runtime-status projection path while allowing pulled snapshots to write `signal_source = appos_active_check` instead of the legacy agent source.
- Runtime latest-status summaries now include `check_kind = runtime_summary`, `signal_source`, `runtime_state`, and container state counts.
- Added worker task and cron scheduling for `monitor:runtime_snapshot_pull` every minute.
- Tests: `go test ./domain/monitor/signals/snapshots ./domain/monitor/signals/checks ./domain/worker`.

### 28.2E Legacy appos-agent retirement

- Removed the managed-server binary, build/release/Docker delivery paths, generated artifacts, software catalog entry, installer script, runtime bindings, and software settings for the former custom agent.
- Removed monitor token/setup routes, ingest routes, heartbeat freshness worker/cron, heartbeat registry policy, and token/heartbeat signal helpers with no compatibility shims.
- Updated server monitoring defaults to use Netdata plus AppOS control-plane active checks only.
- Updated OpenAPI and UI focus services so operators see Netdata as the only continuous managed-side monitoring agent.
- Tests: `make openapi-sync`; `cd backend && go test ./...`; `cd web && npm test -- src/lib/software-api.test.tsx src/lib/software-api.test.ts src/components/servers/ServerServicesPanel.test.tsx`.

## Legacy Dev Agent Record

The following record documents the previously implemented agent-push slice. It is retained for historical context only and should not guide new implementation under the no-`appos-agent` direction.

### Completion Notes

- Added `servers.facts_json` and `servers.facts_observed_at` as the canonical persistence target for low-frequency server facts snapshots.
- Implemented `POST /api/monitor/ingest/facts` with bearer-token ownership validation, one-item MVP batch enforcement, and server-scoped target validation.
- Added `signals/agent` facts normalization and allowlist enforcement for `os`, `kernel`, `architecture`, `cpu.cores`, and `memory.total_bytes`.
- Implemented replace-not-merge facts persistence onto the server record.
- Previously extended `appos-agent` to collect a minimal canonical facts snapshot from local OS/runtime state and post it to `/facts`; this path is now legacy and should be replaced by control-plane facts collection.
- Added monitor route coverage for facts happy path, ownership mismatch, allowlist rejection, replace semantics, and batch size enforcement.

### Tests Run

- `cd /data/dev/appos/backend && go test ./infra/migrations`
- `cd /data/dev/appos/backend && go test ./domain/routes`
- Legacy only: `cd /data/dev/appos/backend && go test ./domain/monitor/signals/agent ./cmd/appos-agent`

### File List

- `backend/infra/migrations/1765500000_add_server_monitor_facts.go`
- `backend/infra/migrations/migrations_test.go`
- `backend/domain/monitor/signals/snapshots/errors.go`
- `backend/domain/monitor/signals/snapshots/facts.go`
- `backend/domain/routes/monitor.go`
- `backend/domain/routes/monitor_test.go`
- Legacy only: `backend/cmd/appos-agent/main.go`
- `specs/implementation-artifacts/story28.2-agent-ingestion.md`