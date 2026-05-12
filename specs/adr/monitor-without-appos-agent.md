# ADR: Remove appos-agent from the monitor architecture

**Status**: Proposed  
**Date**: 2026-05-12  
**Context**: Epic 28 Monitoring, Epic 29 Software Delivery

## Decision

AppOS will remove `appos-agent` from the managed-server monitoring architecture.

Managed servers keep Netdata as the only continuous managed-side monitoring agent. AppOS control plane owns non-metric collection through SSH/tunnel pull, temporary collectors where needed, and monitor-domain projection.

## Rationale

Maintaining a second AppOS-owned managed-server agent adds packaging, upgrade, compatibility, and lifecycle complexity. AppOS already has a control path to managed servers through SSH/tunnel, so non-timeseries state can be collected by the control plane without a long-running custom agent.

Netdata remains a good fit for continuous host/container metrics and metrics freshness. It is not the authority for AppOS product status, business lifecycle, component inventory, tunnel manageability, or deployment outcomes.

## Architecture

```text
Managed server
  Netdata agent
    -> continuous metrics
    -> metrics freshness evidence

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

- Existing `appos-agent` ingest, installer, and catalog material becomes legacy and should be retired after replacement paths exist.
- `heartbeat` splits into `metrics_freshness` from Netdata and `control_reachability` from SSH/tunnel pull.
- `runtime-status` becomes a control-plane-collected snapshot, not a pushed agent payload.
- Facts are low-frequency control-plane snapshots, with field naming aligned where practical to OpenTelemetry Resource semantic conventions.
- OTel Collector is not introduced in this phase; it may be reconsidered later for traces or multi-source telemetry routing.

## Implementation order

1. Introduce monitor evidence contracts and projection rules.
2. Add Netdata metrics freshness evidence.
3. Add SSH/tunnel control reachability evidence.
4. Move runtime/facts collection to control-plane pull or temporary collector.
5. Retire `appos-agent` delivery, tokens, setup routes, and ingest routes after compatibility decisions are made.
