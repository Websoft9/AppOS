# Epic 28: Monitoring

**Module**: Observability | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 8, 18, 19, 20

## Overview

Establish a minimal monitoring domain for AppOS that gives operators one place to judge runtime health across servers, applications, resources, and AppOS itself.

This epic adopts a push-first hybrid model:

- managed servers run a systemd agent that pushes host, container, and app heartbeat signals to AppOS
- AppOS executes active checks for reachability, credential usability, and selected health probes
- high-frequency metrics use a dedicated time-series store
- latest status, check results, and operator-facing summaries remain in the business data store

The goal is not to build a full observability platform. The goal is to provide a small, reliable operator signal surface that answers: what is unhealthy, why, and since when.

---

## Scope Boundaries

| In scope | Out of scope |
|----------|-------------|
| Server metrics: CPU, memory, disk, network | Full log platform or centralized log search |
| Container runtime summary and resource metrics | Complex alert routing and notification workflows |
| Application heartbeat and health summary | Distributed tracing |
| Resource reachability checks | Multi-node monitoring clusters |
| Resource credential usability checks | Per-tenant observability isolation |
| AppOS self metrics and monitor pipeline health | Large historical analytics or BI-style reporting |
| Minimal overview and detail-page observability surfaces | Highly customized dashboards |

---

## Monitoring Model

The epic defines four monitoring subdomains:

1. `Host & Runtime Telemetry`
   - host metrics
   - container metrics
   - container runtime state summary

2. `App Health & Heartbeat`
   - app heartbeat
   - app health check result
   - degraded reason
   - last success and last failure time

3. `Resource Availability`
   - endpoint reachability
   - credential usability
   - last failure reason
   - consecutive failure count

4. `Platform Self-Observation`
   - AppOS CPU, memory, queue, worker, and job metrics
   - monitor ingestion health
   - scheduler and background task status

---

## Technical Direction

**Collection model**:

- `agent push`: host metrics, container metrics, app heartbeat, local runtime summary
- `AppOS active check`: reachability checks, credential checks, selected app health probes, AppOS self-observation

**Storage split**:

- time-series metrics: `VictoriaMetrics` single-node
- current status, latest check result, target metadata, and health summaries: existing AppOS business store

**Read model**:

The product should read primarily from normalized status projections rather than query raw time-series data for every page load. Trend charts may query the time-series store directly for short windows.

### Minimal Domain Flow

```text
server agent / AppOS checker
   ↓
raw signal ingest
   ↓
signal normalization
   ↓
latest status projection
   ↓
overview + detail surfaces
```

### Storage Responsibilities

| Concern | Store | Notes |
|---------|-------|-------|
| host metrics | VictoriaMetrics | append-only metric series |
| container metrics | VictoriaMetrics | append-only metric series |
| AppOS self metrics | VictoriaMetrics | append-only metric series |
| latest heartbeat | business store | one latest state per target |
| latest health result | business store | includes reason and transition time |
| reachability result | business store | current state first, history optional later |
| credential validation result | business store | store outcome only, never secret payload |

### Domain Guardrails

- Monitoring stores validation outcomes, not secret material.
- Monitoring reads canonical target identity from existing domains; it does not create parallel server, app, or resource registries.
- Logs and traces are not required for epic completion.
- Historical check history may be shallow in MVP as long as the latest status is reliable.
- Detailed target taxonomy, status fields, persistence schema, and precedence rules are owned by Story 28.1.

---

## Stories

### 28.1 Monitoring Domain Foundation

- Define canonical monitor target types: `server`, `app`, `resource`, `platform`
- Define canonical signal types: `metric`, `heartbeat`, `health_check`, `availability_check`
- Define normalized status projection with states such as `healthy`, `degraded`, `offline`, `unreachable`, `credential_invalid`
- Persist latest status snapshot and last failure reason per target

### 28.2 Agent Ingestion and Metrics Pipeline

- Introduce a lightweight server-side agent contract intended to run under systemd on managed servers
- Add ingestion endpoints for metrics, heartbeat, and runtime summary
- Store host and container metrics in `VictoriaMetrics`
- Record agent freshness and stale-heartbeat detection in the business store

### 28.3 Active Checks for Resource and App Availability

- Add scheduled checks for resource reachability
- Add scheduled checks for credential usability using minimal safe validation actions
- Add selected app health probes owned by AppOS where server-side checks are more trustworthy than agent-reported state
- Persist latest check result, transition time, and failure reason

### 28.4 Minimal Operator Surfaces

- Add one minimal monitoring overview under the system status area
- Embed observability summaries into server detail, app detail, and resource detail surfaces where relevant
- Show current state, last success, last failure, failure reason, and short-window metric trend
- Keep the UI diagnostic-first, not dashboard-heavy

---

## Acceptance Criteria

- [ ] AppOS accepts pushed metrics and heartbeat data from managed servers through authenticated ingestion endpoints
- [ ] Host and container metrics are stored in a dedicated time-series backend rather than the primary business store
- [ ] AppOS executes scheduled reachability and credential-usability checks without relying on agent self-report alone
- [ ] Each monitored target exposes one normalized latest status with transition time and failure reason
- [ ] Operators can inspect monitoring state from a minimal overview plus related detail pages for servers, apps, and resources
- [ ] AppOS self metrics and monitoring pipeline health are visible so monitor failures are diagnosable
- [ ] Logs, tracing, complex alert routing, and large custom dashboards remain out of scope for this epic

---

## Minimal API Draft

This epic assumes a split between write-only ingest routes and read-oriented operator routes.

### Ingest Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/monitor/ingest/metrics` | Receive metric batches from server agent or AppOS self collector |
| POST | `/api/monitor/ingest/heartbeat` | Receive heartbeat and freshness signals |
| POST | `/api/monitor/ingest/runtime-status` | Receive compact runtime summary for host, containers, and app runtime |

### Operator Read Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/monitor/overview` | Return minimal system-wide monitoring summary |
| GET | `/api/monitor/targets/{targetType}/{targetId}` | Return one normalized status snapshot for a target |
| GET | `/api/monitor/targets/{targetType}/{targetId}/series` | Return short-window metric series for charting |
| GET | `/api/monitor/targets/{targetType}/{targetId}/checks` | Return latest active-check results for a target |

### Scheduled Check Execution

Implementation may use cron or worker infrastructure, but the business contract is:

- reachability checks run on AppOS schedule
- credential validation checks run on AppOS schedule
- selected app health probes run on AppOS schedule
- stale heartbeat evaluation runs on AppOS schedule

Exact route placement can still shift during implementation, but the separation between ingest APIs and operator read APIs should remain. Detailed payloads, auth transport, and response fields are owned by Stories 28.2, 28.3, and 28.4.

---

## Story Artifacts

- `story28.1-monitoring-domain-foundation.md`
- `story28.2-agent-ingestion-and-metrics-pipeline.md`
- `story28.3-active-checks-for-resource-and-app-availability.md`
- `story28.4-minimal-operator-surfaces.md`

---

## Integration Notes

- **Epic 20 Servers** provides managed server identity and operational context for the systemd agent path
- **Epic 18 App Management** provides app runtime context and detail surfaces that should consume observability summaries
- **Epic 8 Resources** provides resource identities for reachability and credential validation targets
- **Epic 19 Secrets** remains the source of truth for credential references; monitoring only records validation outcomes, never secret material

The MVP succeeds if AppOS can answer three questions quickly:

1. what is unhealthy now
2. why it is unhealthy
3. whether the problem is in the server, app, resource, or AppOS itself

---

## Recommended Delivery Order

Implement this epic in the following order:

1. `28.1 Monitoring Domain Foundation`
2. `28.2 Agent Ingestion and Metrics Pipeline`
3. `28.3 Active Checks for Resource and App Availability`
4. `28.4 Minimal Operator Surfaces`

Reasoning:

- 28.1 freezes target identity, latest-status projection, and persistence shape.
- 28.2 establishes the first write path and TSDB boundary.
- 28.3 adds AppOS-owned judgment so monitoring does not depend only on self-report.
- 28.4 should consume stable read contracts instead of inventing UI-specific logic.

## First Delivery Slice

Keep the first implementation slice narrower than the full epic.

This slice is not a new story. It is the first execution scope shared by Story 28.1 and Story 28.2.

Recommended first slice:

1. ship `monitor_latest_status` only
2. support `server` and `platform` targets first
3. implement `POST /api/monitor/ingest/heartbeat` before metrics and runtime summary
4. evaluate heartbeat freshness into `healthy`, `offline`, or `unknown`
5. expose one minimal overview list of unhealthy targets

This slice is enough to validate:

- monitoring token bootstrap works
- latest-status projection is stable
- operator can see stale or offline servers quickly

Do not include in the first slice:

- `monitor_check_results`
- credential usability checks
- app health checks
- short-window charts
- resource detail embedding

## Delivery Risks

| Risk | Why it matters | MVP response |
|------|----------------|--------------|
| Agent token lifecycle drifts from server lifecycle | ingest trust becomes hard to rotate or reason about | keep dedicated per-server monitor token and simple rotation flow |
| Status semantics become inconsistent | UI will show contradictory health states | freeze precedence and latest-status rules in Story 28.1 |
| TSDB details leak into app code | hard to change storage behavior later | keep VictoriaMetrics behind a small writer/query adapter |
| Active checks become an unbounded plugin surface | scope and safety explode | allowlist only `reachability`, `credential`, `app_health` in MVP |
| Overview turns into a dashboard project | delivery slows and diagnosis gets noisier | keep 28.4 to one overview plus embedded summaries |
| Raw monitoring payloads are over-persisted | storage and privacy complexity increase early | persist latest status and compact diagnostics only |

## Exit Condition

Epic 28 is complete when:

- agent and AppOS checks both feed one normalized latest-status model
- operators can identify unhealthy targets and likely causes from overview and detail surfaces
- monitoring remains minimal in scope: no logs platform, no tracing, no custom dashboards