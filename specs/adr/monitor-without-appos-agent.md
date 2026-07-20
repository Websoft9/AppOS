# ADR: Standardize on AppOS monitor-agent for the monitor architecture

**Status**: Proposed  
**Date**: 2026-05-12  
**Context**: Epic 28 Monitoring, Epic 29 Software Delivery

## Decision

AppOS will standardize on `monitor-agent` as the managed-server continuous collector for Epic 28.

Managed servers keep the AppOS `monitor-agent` as the continuous managed-side telemetry path. In current implementation, `monitor-agent` is the AppOS product name for the native `telegraf`-based collector. AppOS control plane owns non-metric collection through SSH/tunnel pull, temporary collectors where needed, and monitor-domain projection.

## Rationale

AppOS already has a managed collector path and a control path to managed servers through SSH/tunnel, so continuous telemetry and non-timeseries evidence do not need to be split across unrelated monitoring products.

The managed collector is not the authority for AppOS product status, business lifecycle, component inventory, tunnel manageability, or deployment outcomes. Those remain AppOS monitor-domain and business-domain responsibilities.

AppOS self-observation is a separate AppOS-owned local collector path (`platform observer`), not the managed-server Telegraf path. In restricted local runtime mode, that path is limited to AppOS control-plane roles plus AppOS-container-self telemetry available from inside the AppOS container; it does not imply host or peer-container visibility.

## Architecture

```text
Managed server
  AppOS monitor-agent
    -> native telegraf collector
    -> continuous metrics
    -> metrics freshness evidence

AppOS self
  platform observer
    -> AppOS runtime metrics
    -> control-plane role health
    -> AppOS-container-self CPU, memory, disk, and network telemetry

AppOS control plane
  SSH/tunnel pull or temporary collector
    -> facts snapshots
    -> runtime snapshots
    -> systemd/docker/service evidence
    -> SSH/tunnel manageability evidence

Monitor domain
  evidence normalization
  metrics freshness evaluation
  latest-status projection

Business domains
  interpret monitor evidence according to their own lifecycle semantics
```

## Domain boundary

Monitor answers: what observable evidence exists, how fresh it is, and what normalized latest status should be shown for an observability target.

Business domains answer: what that evidence means for business state.

Examples:

- Monitor may report `ssh_reachability = failed`; Server/Tunnel domains decide remediation and operator actions.
- Monitor may report `container_runtime = exited`; App Lifecycle decides whether an app is failed, degraded, verifying, or attention-required.
- Monitor may report `service_state = inactive`; Software Delivery still owns installed state, detected version, target version, and supported lifecycle actions.

Monitor must not directly write app lifecycle phase, deployment phase, component installed state, or tunnel configuration state.

## Consequences

- Existing `appos-agent`-specific ingest and bootstrap contracts become legacy and should stay retired.
- `metrics_freshness` comes from accepted monitor-agent samples and `control_reachability` from SSH/tunnel pull.
- `runtime-status` becomes a control-plane-collected snapshot, not a pushed agent payload.
- Facts are low-frequency control-plane snapshots, with field naming aligned where practical to OpenTelemetry Resource semantic conventions.
- OTel Collector is not introduced in this phase; it may be reconsidered later for traces or multi-source telemetry routing.

## Implementation order

1. Introduce monitor evidence contracts and projection rules.
2. Add monitor-agent metrics freshness evidence.
3. Add SSH/tunnel control reachability evidence.
4. Move runtime/facts collection to control-plane pull or temporary collector.
5. Retire `appos-agent` delivery, tokens, setup routes, and ingest routes after compatibility decisions are made.
