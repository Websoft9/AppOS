# Story 28.4: Minimal Operator Surfaces

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed
**Depends on**: Story 28.1, Story 28.2, Story 28.3, Epic 18, Epic 20

## Objective

Expose the monitoring domain through one minimal overview and a small set of embedded summaries so operators can judge what is wrong, why, and since when.

## Scope

- Add one minimal monitoring overview under the system status area
- Embed monitoring summaries into server, app, and resource detail surfaces where relevant
- Show normalized current state, last success, last failure, reason, and short-window metric trend
- Keep the UI diagnostic-first and deliberately small

## First Slice Note

Story 28.4 should begin with overview only.

For the first implementation pass, narrow Story 28.4 to:

- one minimal unhealthy-target overview
- `server` and `platform` items first
- latest status, reason, and transition time only

Do not start with:

- embedded server, app, or resource detail summaries
- short-window charts
- check-history rendering

Those belong to later expansion of Story 28.4 after the heartbeat-first slice is proven useful.

## Surface Model Draft

MVP should expose monitoring through two surface types only:

1. `overview surface`
	 one cross-domain status summary for rapid triage
2. `embedded detail summary`
	 one compact observability block inside existing detail pages

Do not create a dashboard builder, widget system, or separate analytics workspace.

## Overview Draft

The overview is a triage surface, not a dense metrics console.

Primary user questions:

1. what is unhealthy now
2. what category it belongs to
3. what failed most recently
4. where to click next

### Overview sections

Suggested MVP layout:

- status counts row
- unhealthy items list
- platform self-observation list

### Status counts row

Show only a small set of summary counts:

- `healthy`
- `degraded`
- `offline`
- `unreachable`
- `credential_invalid`
- `unknown`

### Unhealthy items list

Each row should show:

- `display_name`
- `target_type`
- `status`
- `reason`
- `last_transition_at`
- one direct link into the owning detail surface

Optional small additions:

- `signal_source`
- compact freshness badge such as `fresh`, `stale`, `offline`

### Platform self-observation list

Keep this separate from general unhealthy targets so operators can quickly distinguish product failures from managed-target failures.

Suggested items:

- `appos-core`
- `monitor-ingest`
- `scheduler`
- `worker`

## Embedded Detail Summary Draft

Every supported detail surface should consume the same normalized model first.

### Server detail summary

Show:

- current status
- last heartbeat
- last failure reason
- short-window host metric trend
- compact container runtime summary

Do not show:

- full container table
- raw metric query builder
- long check history table

### App detail summary

This should align with the existing app-detail observability direction where health and heartbeat sit together.

Show:

- current status
- heartbeat state
- latest diagnostic summary
- short-window app or host-adjacent resource trend
- latest check outcomes relevant to the app

Do not show:

- separate top-level monitoring workspace per app
- full logs view inside this card

### Resource detail summary

Show:

- current status
- reachability result
- credential usability result
- last failure reason
- last checked time

Do not show:

- raw secret values
- verbose provider API responses

## Read API Draft

### `GET /api/monitor/overview`

Suggested response shape:

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
			"targetType": "app",
			"targetId": "app_xxx",
			"displayName": "gitea-prod",
			"status": "degraded",
			"reason": "health check timeout",
			"lastTransitionAt": "2026-04-14T12:03:00Z",
			"detailHref": "/apps/app_xxx"
		}
	],
	"platformItems": [
		{
			"targetId": "monitor-ingest",
			"displayName": "Monitor Ingest",
			"status": "healthy",
			"reason": null,
			"lastTransitionAt": "2026-04-14T12:00:00Z"
		}
	]
}
```

### `GET /api/monitor/targets/{targetType}/{targetId}`

This route should remain the single source for latest normalized status used by embedded cards.

### `GET /api/monitor/targets/{targetType}/{targetId}/series`

MVP series response should stay intentionally small.

Suggested query parameters:

- `window=1h|6h|24h`
- `series=cpu|memory|disk|network`

Suggested response shape:

```json
{
	"targetType": "server",
	"targetId": "srv_xxx",
	"window": "1h",
	"series": [
		{
			"name": "cpu",
			"unit": "percent",
			"points": [
				[1713096000, 32.1],
				[1713096060, 30.8]
			]
		}
	]
}
```

Guardrails:

- only short-window queries in MVP
- no arbitrary label selectors from the browser
- backend maps UI-friendly names to allowlisted TSDB series

## UI Guardrails Draft

The surface should stay aligned with the product UX direction: orientation and diagnosis first, not a control room aesthetic.

Required guardrails:

- no grid of dozens of cards
- no draggable widgets
- no custom saved dashboards
- no giant table as the default overview
- no chart-first landing page

Preferred presentation:

- compact status chips
- short lists
- one or two small sparkline-style trends where justified
- direct links to the owning detail surfaces

## Data Loading Draft

Recommended loading order for each embedded summary:

1. load normalized latest status
2. if metrics exist, load one short-window series request
3. if check diagnostics are relevant, load latest check results

This keeps the page useful even when TSDB data is slow or temporarily unavailable.

## Failure Handling Draft

UI behavior when some monitoring data is unavailable:

- if latest status exists but trend data fails, keep the status visible and suppress the chart
- if latest status is missing, show `unknown` rather than a blank block
- if monitoring backend itself is degraded, surface that fact in the platform self-observation area

## API

- `GET /api/monitor/overview`
- `GET /api/monitor/targets/{targetType}/{targetId}`
- `GET /api/monitor/targets/{targetType}/{targetId}/series`
- `GET /api/monitor/targets/{targetType}/{targetId}/checks`

## Acceptance Criteria

- [ ] AC1: Operators can open one overview that summarizes unhealthy targets across server, app, resource, and platform scopes.
- [ ] AC2: Server, app, and resource detail surfaces can show the normalized latest status without reimplementing monitoring logic locally.
- [ ] AC3: Detail surfaces show last success, last failure, failure reason, and short-window trend where metrics exist.
- [ ] AC4: The MVP UI remains lightweight and does not become a custom dashboard builder.
- [ ] AC5: Monitoring failures inside AppOS itself are visible from the same operator surface.
- [ ] AC6: Overview prioritizes unhealthy-target triage and direct navigation over chart density or table complexity.
- [ ] AC7: Embedded summaries for server, app, and resource details all consume the same normalized latest-status contract.
- [ ] AC8: Series APIs remain short-window and allowlisted, with no arbitrary browser-driven TSDB querying.
- [ ] AC9: Partial monitoring data failure degrades gracefully without hiding the latest known target status.

## Implementation Notes

- Prefer existing detail pages and system status surfaces over adding new navigation sprawl.
- Read from latest-status projections first, then query time-series data only for compact trends.
- Keep copy operator-facing and diagnosis-oriented.
- Keep the overview intentionally sparse enough that an operator can decide where to click within a few seconds.
- Reuse existing app-detail observability language rather than inventing a second vocabulary for the same concepts.

## File Targets

- dashboard monitoring overview route or embedded system status panel
- dashboard detail page summary components for servers, apps, and resources
- frontend monitoring API helpers

## Out of Scope

- Full-screen NOC dashboard
- User-configurable widgets
- Large historical reporting