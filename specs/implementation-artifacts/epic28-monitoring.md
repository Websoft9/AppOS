# Epic 28: Monitoring

**Module**: Observability | **Status**: Proposed | **Priority**: P1 | **Depends on**: Epic 8, 18, 19, 20

## Overview

Establish a minimal monitoring domain for AppOS that gives operators one place to judge runtime health across servers, applications, resources, and AppOS itself.

**Scope note**: Monitor observes the runtime state of running software (is it alive, is it healthy). Version detection, install, upgrade, and reinstall of those same software components are owned by Software Delivery (Epic 29), not Monitor.

This epic adopts a Netdata-plus-control-plane-pull model:

- managed servers run Netdata as the only continuous managed-side monitoring agent
- Netdata exports continuous metrics to AppOS and provides metrics freshness evidence
- AppOS control plane collects non-metric evidence through SSH/tunnel pull or temporary collectors
- high-frequency metrics use a dedicated time-series store
- latest status, check results, facts snapshots, and operator-facing summaries remain AppOS-owned business projections

The goal is not to build a full observability platform. The goal is to provide a small, reliable operator signal surface that answers: what is unhealthy, why, and since when.

---

## Scope Boundaries

| In scope | Out of scope |
|----------|-------------|
| Server metrics: CPU, memory, disk, network | Full log platform or centralized log search |
| Container runtime summary and resource metrics | Complex alert routing and notification workflows |
| Application health and manageability summary | Distributed tracing |
| Resource reachability checks | Multi-node monitoring clusters |
| Resource credential usability checks | Per-tenant observability isolation |
| AppOS self metrics and monitor pipeline health | Large historical analytics or BI-style reporting |
| Minimal overview and detail-page observability surfaces | Highly customized dashboards |

---

## Monitoring Model

The epic defines four operator-facing monitoring areas:

1. `Host & Runtime Telemetry`
   - host metrics
   - container metrics
   - container runtime state summary

2. `App Health & Manageability`
   - metrics freshness
   - control reachability
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

Internal implementation should still keep one `monitor` bounded context.
Within that context, the recommended split is:

- shared contract at root: target model, canonical signal event, status semantics, target registry
- `signals`: normalize all incoming monitor signals into one canonical event model
- `status`: consume canonical signal events and own latest-status projection, precedence, and transitions

Inside `signals`, source-specific code stays as adapters such as `netdata`, `probes`, `pull`, and `platform`.
`status` should be the sole writer of the latest-status projection.
The TSDB adapter remains infrastructure, not a monitor subdomain.

Distributed tracing remains out of scope for Epic 28 and should be treated as a future independent observability context rather than a child of `monitor`.

---

## Technical Direction

**Collection model**:

- `Netdata metrics export`: Netdata collects continuous host/container telemetry and exports selected charts to AppOS/VictoriaMetrics
- `metrics freshness`: AppOS evaluates the latest Netdata sample time as one heartbeat-like evidence source
- `control-plane pull`: AppOS collects non-metric facts, runtime snapshots, SSH/tunnel reachability, credential checks, selected service checks, and app health probes over the managed control path
- `temporary collector`: when a single SSH command becomes too brittle, AppOS may upload a short-lived executable or script, read JSON output, and remove it after execution

Active checks are owned by the `monitoring` domain even when target identity comes from resource, app, or server domains.

Primary operating mode is scheduled evaluation with persisted results.
On-demand checks may still exist as supplemental diagnostic actions, but operator surfaces should read the monitoring projection first instead of depending on request-time probes.

**Storage split**:

- time-series metrics: `VictoriaMetrics` single-node
- current status, latest check result, target metadata, and health summaries: existing AppOS business store

**Read model**:

The product should read primarily from normalized status projections rather than query raw time-series data for every page load. Trend charts may query the time-series store directly for short windows.

### High-Level Architecture

```text
signal sources
   - Netdata metrics export
   - AppOS SSH/tunnel pull
   - temporary collectors
  - AppOS probes
  - AppOS platform observer
         |
         v
      signals
  - source adapters
  - canonical normalization
     |                  |
     v                  v
 status            TSDB adapter
  - precedence          |
  - transitions         v
  - latest-status   time-series store
    projection
     |
     v
business store + overview/detail surfaces
```

### Collection Substrate

AppOS runs as a single container that includes PocketBase, Asynq, VictoriaMetrics, a reverse proxy, and one local Netdata agent under one process supervisor.

Within that shape, Netdata is acceptable as a collection substrate, but not as the monitoring authority.

- managed-server Netdata remains the primary collector for remote host, container, and application-adjacent continuous telemetry
- low-frequency host facts are collected by the AppOS control plane through SSH/tunnel pull or temporary collectors, not by a long-running AppOS-owned managed-server agent
- control-plane Netdata is required for AppOS self-observation and is limited to probes against targets that are local to the control-plane environment
- both collectors write raw telemetry into `VictoriaMetrics`
- the AppOS monitoring domain keeps ownership of target identity, signal normalization, status adjudication, latest-status projection, and notification orchestration

Operational constraints:

- local Netdata in the AppOS container is required and starts by default with AppOS
- Netdata local alerts, notifications, and cloud claim should be disabled
- Netdata should be treated as collector and exporter only; business status does not come from Netdata alarm state
- low-frequency host facts should use AppOS-owned canonical fields aligned where practical to OpenTelemetry Resource semantic conventions

Netdata usage red lines:

- AppOS depends on Netdata for collection and probe execution in the single-container runtime, but not for operator-facing status semantics
- AppOS must not expose Netdata chart names, alarm states, dashboard concepts, or plugin model as product-level API
- host facts stored in AppOS must use AppOS-owned field names and live on the canonical server record rather than in collector-specific storage
- latest-status projection, overview grouping, and status precedence remain AppOS-owned logic even when raw telemetry comes from Netdata

### Current Server Metrics Chain

The current server-metric implementation is intentionally narrow and push-first:

- Netdata runs on each managed server under systemd
- Netdata collects selected time-series telemetry on the managed server
- AppOS evaluates Netdata sample freshness as metrics heartbeat evidence
- AppOS collects facts and runtime snapshots through SSH/tunnel pull or temporary collectors
- AppOS runs one local Netdata process inside the single control-plane container for self-observation
- Netdata exports selected host charts by Prometheus remote write
- managed servers push to AppOS `/api/monitor/write` using per-server Basic Auth credentials
- AppOS validates the server identity and monitor agent token before forwarding accepted payloads to embedded VictoriaMetrics
- AppOS monitor APIs query VictoriaMetrics for short-window CPU, memory, disk, and network trends

Low-frequency host facts are not treated as TSDB series. After control-plane collection and normalization, they are stored on the server business record such as `server.facts_json`.

This keeps AppOS as the control and presentation plane while Netdata remains the collector layer.

### Minimal Domain Flow

```text
Netdata freshness / AppOS pull / AppOS checker
   ↓
raw signal ingest
   ↓
signal normalization
   ↓
latest status projection
   ↓
overview + detail surfaces
```

### Minimal Signal Semantics

The MVP uses four operator-facing signal types. They should be collected independently where practical, but interpreted together when producing one latest status.

| Signal | Answers | Primary concern |
|--------|---------|-----------------|
| `app_health` | Is the application service itself behaving correctly? | serving health |
| `metrics_freshness` | Is the target still reporting fresh Netdata metrics? | observability freshness |
| `control_reachability` | Can AppOS still manage the target over SSH/tunnel? | manageability |
| `reachability` | Can AppOS reach the target over the expected network path? | connectivity |
| `credential` | Can AppOS complete one minimal safe authenticated action? | authenticated access |

Signal relationship rules:

- signals should not require strict execution chaining; each may be collected on its own schedule
- signal interpretation is contextual; one failed lower-layer signal may limit what a higher-layer result means
- final target status must be resolved by precedence, not by whichever signal arrived last

### Minimal Status Adjudication

| Condition | Latest status | Why |
|----------|---------------|-----|
| metrics are fresh and control reachability succeeds | `healthy` or lower-severity app/resource result | both observation and manageability are available |
| metrics are fresh and control reachability fails | `unreachable` or `observable_not_manageable` | target is observable but AppOS cannot manage it |
| metrics are stale and control reachability succeeds | `degraded` or `monitoring_stale` | target is manageable but monitoring data is stale |
| metrics are stale and control reachability fails | `offline` | neither observability nor manageability is currently reliable |
| control reachability succeeds but credential fails | `credential_invalid` | authenticated access failed after connectivity succeeded |
| app health fails | `degraded` | service is reachable but not behaving correctly |
| no reliable signal is available | `unknown` | no trustworthy current judgment |
| relevant signals succeed | `healthy` | current checks support a healthy operator view |

### Storage Responsibilities

| Concern | Store | Notes |
|---------|-------|-------|
| host metrics | VictoriaMetrics | append-only metric series |
| container metrics | VictoriaMetrics | append-only metric series |
| AppOS self metrics | VictoriaMetrics | append-only metric series |
| low-frequency host facts | server business record | normalized facts such as OS, kernel, architecture, CPU, and total memory |
| latest metrics freshness | business store | one latest state per target |
| latest control reachability | business store | one latest state per target |
| latest health result | business store | includes reason and transition time |
| reachability result | business store | current state first, history optional later |
| credential validation result | business store | store outcome only, never secret payload |

### Minimal Data Placement

| Data kind | Goes to | Notes |
|----------|---------|-------|
| raw host, container, process, and probe telemetry | VictoriaMetrics | raw append-only series from managed-server or local collectors |
| normalized low-frequency host facts | canonical server record in business store | persisted as AppOS-owned facts such as `server.facts_json`, not TSDB samples |
| normalized current target state | latest-status projection in business store | operator-facing `healthy`, `degraded`, `offline`, `unreachable`, `credential_invalid`, `unknown` |
| compact diagnosis fields | latest-status projection in business store | reason, last checked at, last success, last failure, consecutive failures |
| Netdata chart, alarm, and cloud-specific metadata | not promoted into business monitoring store | collector-internal detail, not AppOS business status |

### Domain Guardrails

- Monitoring stores validation outcomes, not secret material.
- Monitoring reads canonical target identity from existing domains; it does not create parallel server, app, or resource registries.
- `signals` adapters must resolve raw source IDs to canonical target identities before emitting events to `status`.
- Check scheduling stays entirely within `signals` adapters; `status` remains a passive, schedule-ignorant consumer.
- Logs and traces are not required for epic completion.
- Historical check history may be shallow in MVP as long as the latest status is reliable.
- Detailed target taxonomy, status fields, persistence schema, and precedence rules are owned by Story 28.1.

---

## Stories

### 28.1 Monitoring Domain Foundation

- Define canonical monitor target types: `server`, `app`, `resource`, `platform`
- Define canonical signal types: `app_health`, `metrics_freshness`, `control_reachability`, `reachability`, `credential`
- Define normalized status projection with states such as `healthy`, `degraded`, `offline`, `unreachable`, `credential_invalid`
- Persist latest status snapshot and last failure reason per target

### 28.2 Netdata Metrics and Control-Plane Evidence Pipeline

- Standardize the managed-server metrics collector contract with Netdata running under systemd
- Evaluate Netdata sample freshness as `metrics_freshness` evidence
- Replace agent-pushed heartbeat and runtime summary with AppOS control-plane pull evidence
- Store host and container metrics in `VictoriaMetrics`
- Store normalized host facts on the canonical server record such as `server.facts_json` after control-plane collection
- Record metrics freshness, control reachability, and runtime snapshot evidence in the business store

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

### 28.5 Platform Status Frontend Page

- Converge `System > Status` into one platform-first operator page
- Lead with one explicit platform availability conclusion
- Keep infrastructure trends and active services visible on the main page
- Keep platform targets as supporting control-plane evidence, not the main surface

---

## Acceptance Criteria

- [ ] AppOS accepts Netdata remote-write metrics from managed servers and evaluates metrics freshness without requiring `appos-agent`
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
| POST | `/api/monitor/write` | Receive Netdata remote-write metrics through the AppOS backend after per-server agent authentication |

### Operator Read Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/monitor/overview` | Return minimal system-wide monitoring summary |
| GET | `/api/monitor/targets/{targetType}/{targetId}` | Return one normalized status snapshot for a target |
| GET | `/api/monitor/targets/{targetType}/{targetId}/series` | Return short-window metric series for charting |
| GET | `/api/monitor/targets/{targetType}/{targetId}/checks` | Return latest active-check results for a target |

### Scheduled Check Execution

Implementation may use cron or worker infrastructure, but the business contract is:

- metrics freshness evaluation runs on AppOS schedule
- reachability checks run on AppOS schedule
- credential validation checks run on AppOS schedule
- selected app health probes run on AppOS schedule
- stale metrics-freshness evaluation runs on AppOS schedule

Recommended MVP implementation:

- PocketBase cron triggers monitoring check batches on schedule
- Asynq worker executes individual checks and retries where needed
- manual or on-demand probes remain optional diagnostic helpers, not the primary monitoring path

Exact route placement can still shift during implementation, but the separation between ingest APIs and operator read APIs should remain. Detailed payloads, auth transport, and response fields are owned by Stories 28.2, 28.3, and 28.4.

---

## Story Artifacts

- `story28.1-monitor-foundation.md`
- `story28.2-agent-ingestion.md` (legacy title; scope is superseded by Netdata metrics and control-plane evidence pipeline)
- `story28.3-active-checks.md`
- `story28.4-operator-surfaces.md`
- `story28.5-platform-status-frontend.md`

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
2. `28.2 Netdata Metrics and Control-Plane Evidence Pipeline`
3. `28.3 Active Checks for Resource and App Availability`
4. `28.4 Minimal Operator Surfaces`
5. `28.5 Platform Status Frontend Page`

Reasoning:

- 28.1 freezes target identity, latest-status projection, and persistence shape.
- 28.2 establishes the Netdata metrics boundary and the first non-agent evidence paths.
- 28.3 adds AppOS-owned judgment so monitoring does not depend only on self-report.
- 28.4 should consume stable read contracts instead of inventing UI-specific logic.
- 28.5 converges the operator-facing platform status experience into one simple page after the monitor contracts are stable.

## First Delivery Slice

Keep the first implementation slice narrower than the full epic.

This slice is not a new story. It is the first execution scope shared by Story 28.1 and Story 28.2.

Recommended first slice:

1. ship `monitor_latest_status` only
2. support `server` and `platform` targets first
3. implement Netdata metrics freshness evaluation before runtime snapshot collection
4. evaluate metrics freshness and control reachability into `healthy`, `degraded`, `offline`, or `unknown`
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
| Legacy agent contracts remain active too long | status semantics split across push and pull paths | retire `appos-agent` setup and ingest routes after replacement paths exist |
| Status semantics become inconsistent | UI will show contradictory health states | freeze precedence and latest-status rules in Story 28.1 |
| TSDB details leak into app code | hard to change storage behavior later | keep VictoriaMetrics behind a small writer/query adapter |
| Active checks become an unbounded plugin surface | scope and safety explode | allowlist only `reachability`, `credential`, `app_health` in MVP |
| Overview turns into a dashboard project | delivery slows and diagnosis gets noisier | keep 28.4 to one overview plus embedded summaries |
| Raw monitoring payloads are over-persisted | storage and privacy complexity increase early | persist latest status and compact diagnostics only |

## Exit Condition

Epic 28 is complete when:

- Netdata metrics freshness and AppOS checks both feed one normalized latest-status model
- operators can identify unhealthy targets and likely causes from overview and detail surfaces
- monitoring remains minimal in scope: no logs platform, no tracing, no custom dashboards