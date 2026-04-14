# Story 28.3: Active Checks for Resource and App Availability

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed
**Depends on**: Story 28.1, Epic 8, Epic 18, Epic 19

## Objective

Add AppOS-owned active checks so resource reachability, credential usability, and selected app health do not depend only on agent self-report.

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

Recommended split:

- cron triggers enqueue or invoke check batches on schedule
- worker executes the actual checks and writes results

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