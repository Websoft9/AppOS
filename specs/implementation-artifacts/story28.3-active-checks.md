# Story 28.3: Active Checks for Resource and App Availability

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed
**Depends on**: Story 28.1, Epic 8, Epic 18, Epic 19

## Objective

Add AppOS-owned active checks so resource reachability, credential usability, and selected app health do not depend only on agent self-report.

These checks belong to the `monitoring` domain.
Resource, app, and server domains continue to own target identity and endpoint metadata, but scheduling, execution policy, result normalization, and latest-status projection belong to monitoring.

## Scope

- Scheduled reachability checks for resources and selected endpoints
- Scheduled credential usability checks using minimal safe validation actions
- Scheduled app health probes where AppOS is the more trustworthy observer
- Heartbeat freshness evaluation for stale and offline state projection
- Persist latest check result, transition time, and failure reason into normalized status projection

## First Slice Note

Story 28.3 is explicitly not part of the first delivery slice.

It should start only after heartbeat-first validation in Story 28.1 and Story 28.2 proves that:

- latest-status projection is stable
- monitoring token bootstrap is workable
- stale and offline detection is understandable to operators

When Story 28.3 starts, recommended order is:

1. `reachability`
2. `credential`
3. `app_health`

This keeps the first active-check implementation focused on operator-verifiable failures before moving into credential semantics or app-specific health logic.

## Execution Model Draft

MVP should separate active checks into three layers:

1. `Check Registry`
	 declares what kinds of checks AppOS supports
2. `Check Scheduler`
	 decides when a check should run
3. `Check Executor`
	 performs the check and updates monitoring projections

This keeps check policy stable even if the scheduling mechanism changes later.

### Check Registry

Supported MVP check kinds:

- `reachability`
- `credential`
- `app_health`

Existing request-time probe helpers in other domains may be reused internally by executors, but they should not remain the system of record for operator-facing health state.

Suggested minimal executor contract:

```go
type CheckExecutor interface {
	Kind() string
	Supports(target MonitorTargetRef) bool
	Execute(ctx context.Context, target MonitorTargetRef) (CheckOutcome, error)
}
```

Suggested `CheckOutcome` fields:

- `target_type`
- `target_id`
- `check_kind`
- `outcome`
- `reason`
- `observed_by`
- `started_at`
- `finished_at`
- `details`

## Scheduling Draft

MVP should reuse existing platform infrastructure:

- PocketBase cron for periodic scheduling
- Asynq worker for execution isolation and retries where useful

Primary operating mode should be scheduled execution with persisted monitoring results.
On-demand execution may remain available as a manual diagnostic or refresh action, but business pages should consume stored monitoring status by default.

Recommended split:

- cron triggers enqueue or invoke check batches on schedule
- worker executes the actual checks and writes results

Ownership split:

- `monitoring scheduler` decides when a check runs
- `monitoring executor` performs the check
- business domains provide target metadata and safe validation inputs

Why this split:

- cron remains simple and declarative
- checks do not block serve lifecycle or HTTP request handling
- retries and concurrency limits can evolve without changing monitoring contracts

### Suggested scheduled jobs

| Job ID | Purpose | Interval |
|--------|---------|----------|
| `monitor_reachability_checks` | endpoint and connector reachability | `1m` |
| `monitor_credential_checks` | minimal credential validation | `5m` |
| `monitor_app_health_checks` | selected app-owned health probes | `1m` |
| `monitor_heartbeat_freshness` | stale and offline state evaluation | `30s` |

Intervals are product defaults, not hard guarantees. They may later move to settings, but should be fixed in MVP.

## Check Target Draft

Not every domain object deserves every check kind.

### Reachability

Applies to:

- network endpoints
- connectors with explicit endpoint URLs
- selected app service endpoints
- servers where AppOS actively tests connectivity

Minimal actions:

- TCP dial
- HTTP GET or HEAD to health endpoint
- optional TLS handshake check if that is the real operator concern

Reachability should be modeled as a monitoring check kind first, not as a resource-page-only feature.

### Credential Usability

Applies to:

- resources with credential references
- connectors and provider accounts where a safe validation action exists

Minimal actions must be non-destructive. Examples:

- authenticated `GET` or lightweight metadata call
- login handshake without mutation
- list-one or describe-one capability where provider APIs support it

Not acceptable for MVP:

- write operations
- create/delete probes
- broad inventory sync just to prove credentials work

### App Health

Applies to:

- managed apps with stable health endpoint or equivalent runtime probe

Minimal actions:

- HTTP health endpoint check
- container runtime status interpretation where endpoint-based probe does not exist

Guardrail:

- app health should be configured per app type or runtime pattern, not invented ad hoc per record in MVP

## Result Projection Draft

Every finished active check should do two writes at most:

1. optional recent record in `monitor_check_results`
2. required upsert into `monitor_latest_status`

Projection rules:

- successful check updates `last_checked_at`
- successful check may update `last_success_at`
- failed check updates `last_checked_at`, `last_failure_at`, and `reason`
- failed check increments `consecutive_failures`
- check-specific failure states may outrank heartbeat freshness

State mapping guidance:

- reachability failure → `unreachable`
- credential validation failure → `credential_invalid`
- app health failure with fresh heartbeat → `degraded`

## Minimal Diagnostics Draft

MVP diagnostics should stay compact.

Suggested `details_json` examples:

- reachability: `protocol`, `host`, `port`, `latency_ms`, `http_status`
- credential: `provider_kind`, `action`, `error_code`
- app health: `probe_type`, `endpoint`, `http_status`, `runtime_state`

Do not persist:

- raw secret payloads
- full remote API responses
- full HTML or response bodies

## API and Query Draft

This story does not need a broad new control surface, but it should define the internal read contract consumed by later operator pages.

Suggested route family:

- `GET /api/monitor/targets/{targetType}/{targetId}/checks`

Suggested response shape:

```json
{
	"targetType": "resource",
	"targetId": "res_xxx",
	"items": [
		{
			"checkKind": "credential",
			"outcome": "failure",
			"reason": "authentication failed",
			"observedBy": "appos_active_check",
			"startedAt": "2026-04-14T12:03:00Z",
			"finishedAt": "2026-04-14T12:03:01Z",
			"details": {
				"action": "metadata_get"
			}
		}
	]
}
```

## Reuse Draft

The repo already has an instance reachability probe surface. MVP should prefer reusing existing dial and health-check helpers where they exist instead of creating duplicate TCP or HTTP probing code paths.

Similarly, scheduling should reuse the existing cron and worker infrastructure already started by the backend runtime.

## Acceptance Criteria

- [ ] AC1: AppOS runs reachability checks on a schedule without requiring target self-report.
- [ ] AC2: AppOS runs credential usability checks without storing or echoing secret material in monitoring outputs.
- [ ] AC3: Selected app health probes can mark a target `degraded` even when heartbeat remains fresh.
- [ ] AC4: Check failures update latest-status projection with reason, last failure time, and consecutive failure count.
- [ ] AC5: MVP keeps validation actions minimal and safe, avoiding destructive external operations.
- [ ] AC6: Active checks run through a shared registry and executor contract rather than bespoke logic per route or page.
- [ ] AC7: Scheduling reuses existing cron and worker infrastructure instead of introducing a separate monitoring scheduler.
- [ ] AC8: Reachability, credential, and app-health failures map to distinct monitoring states with clear precedence.
- [ ] AC9: Recent check diagnostics stay compact and exclude secret values or large remote payloads.

## Implementation Notes

- Reuse existing cron or worker infrastructure; do not create a bespoke scheduler unless necessary.
- Focus on current-state reliability first; deep history is optional in MVP.
- Credential usability means “AppOS can complete a minimal validation action”, not merely “secret shape looks valid”.
- Prefer a small allowlist of check kinds over an early generic plugin system.
- If a check kind lacks a safe minimal validation action, it should not ship in MVP.

## File Targets

- backend active-check executor and registry
- backend persistence for latest check outcomes
- backend route or internal query layer for latest check results
- cron or worker registration for scheduled monitoring jobs

## Out of Scope

- Multi-step remediation
- Notification routing
- Broad plugin system for arbitrary checks

## Dev Agent Record

- Implemented the first `28.3` execution slice for monitoring-owned `reachability` checks.
- Reused the existing instance TCP probe logic by moving it behind `backend/domain/monitor/reachability.go`.
- Added scheduled trigger wiring through PocketBase cron and Asynq task execution.
- Scoped the first pass to `resource instances` only and projected results into `monitor_latest_status`.
- Kept `/api/instances/reachability` as an on-demand diagnostic surface.
- Updated monitor route tests to use current timestamps so heartbeat semantics remain stable over time.
- Moved heartbeat freshness from implicit overview-read refresh into an explicit monitoring cron + worker task.
- Wired the service instances resource page to consume `monitor_latest_status` directly for resource targets.
- Added list-level monitor status and last-checked display so resource operators consume projected monitoring state instead of request-time probes.
- Added an initial monitoring-owned target registry overlay inside the monitor domain.
- Refactored reachability sweep to resolve eligible resource-instance targets through that registry before probing, instead of sweeping every instance record indiscriminately.
- Extended the registry schema to declare `server` and `app` target baselines as capability entries, without adding new active probes yet.
- Added the first registry-driven non-reachability active check: `credential` for `generic-redis` resource instances, using system secret resolution plus a minimal Redis `PING` validation action.
- Added `monitor_credential_checks` cron + worker wiring and kept the first credential slice scoped to redis instances only.
- Moved initial `reachability` and `credential` status mappings into the monitoring target registry overlay so target policies, not hardcoded switch branches, define outcome-to-status projection.
- Updated heartbeat freshness projection to consume the server baseline registry mapping, so `fresh/stale/offline` heartbeat outcomes now follow monitoring target policy instead of a hardcoded status switch.
- Updated app target synthesis and runtime-status projection to consume the app baseline registry mapping, so app-health status derivation now follows monitoring target policy instead of route/service-local switches.
- Moved initial status precedence into monitoring target registry entries so current resource/server/app projections can preserve stronger failures using target policy instead of only a global hardcoded priority table.
- Moved initial failure-reason defaults into monitoring target registry policies so heartbeat, reachability, credential, and app-health projections now share target-defined fallback reason semantics instead of scattered hardcoded strings.
- Added registry-backed `reason_code` policy and persisted those codes into monitoring summaries so operator surfaces can consume structured failure semantics without a new table migration.

### Tests Run

- `cd /data/dev/appos/backend && go test ./domain/monitor ./domain/worker`
- `cd /data/dev/appos/backend && go test ./domain/routes ./platform/hooks ./cmd/appos`
- `cd /data/dev/appos/web && npm test -- --run src/routes/_app/_auth/resources/-service-instances.test.tsx`

## File List

- `backend/domain/monitor/reachability.go`
- `backend/domain/monitor/target_registry.go`
- `backend/domain/monitor/credential.go`
- `backend/domain/monitor/credential_test.go`
- `backend/domain/monitor/target_registry_test.go`
- `backend/domain/monitor/targets/resource-instances.json`
- `backend/domain/monitor/targets/server-apps.json`
- `backend/domain/routes/instances.go`
- `backend/domain/routes/monitor_test.go`
- `backend/domain/worker/monitoring_checks.go`
- `backend/domain/worker/monitoring_checks_test.go`
- `backend/domain/worker/worker.go`
- `backend/platform/hooks/cron.go`
- `backend/platform/hooks/hooks.go`
- `backend/cmd/appos/main.go`
- `web/src/routes/_app/_auth/resources/service-instances.tsx`
- `web/src/routes/_app/_auth/resources/-service-instances.test.tsx`