# Story 28.9: Monitor Settings

**Epic**: Epic 28 - Monitoring
**Priority**: P1
**Status**: Proposed

## Goal

Keep all platform monitor tuning on one shared settings surface:

- `Settings > System > Monitor`
- one nav item
- four independently saved cards

Cards:

1. `Monitor Scheduling`
2. `Monitor Policy`
3. `Platform Self-Observation`
4. `Managed Collector Policy`

This story absorbs the follow-on settings split that had been drafted separately in 28.10, 28.11, and the managed collector policy slice.

## Settings Entries

- `monitor-scheduling`
- `monitor-policy`
- `monitor-platform-self-observation`
- `monitor-managed-collector-policy`

## Default Shape

`monitor-scheduling`

```json
{
  "reachabilityIntervalMinutes": 1,
  "metricsFreshnessIntervalMinutes": 1,
  "controlReachabilityIntervalMinutes": 1,
  "runtimeSnapshotIntervalMinutes": 1,
  "credentialSweepIntervalMinutes": 5,
  "appHealthIntervalMinutes": 1,
  "factsPullIntervalMinutes": 15
}
```

`monitor-policy`

```json
{
  "metricsFreshnessLookbackSeconds": 300,
  "metricsStaleSeconds": 90,
  "metricsMissingSeconds": 180,
  "controlProbeTimeoutSeconds": 5,
  "factsPullTimeoutSeconds": 20,
  "runtimePullTimeoutSeconds": 20,
  "factsPullConcurrency": 5,
  "runtimePullConcurrency": 5
}
```

`monitor-platform-self-observation`

```json
{
  "platformObserverIntervalSeconds": 30,
  "platformSchedulerStaleThresholdSeconds": 10,
  "enableHostTelemetry": false,
  "enableContainerTelemetry": false
}
```

`monitor-managed-collector-policy`

```json
{
  "collectionIntervalSeconds": 10,
  "flushIntervalSeconds": 10,
  "metricBatchSize": 1000,
  "metricBufferLimit": 5000,
  "collectionJitterSeconds": 1,
  "flushJitterSeconds": 1
}
```

## Boundary

In scope:

- global monitor scheduling
- global monitor policy
- AppOS-local platform self-observation settings
- managed collector / Telegraf runtime policy

Out of scope:

- per-server overrides
- alert routing
- exposing implementation-specific collector vocabulary

## Validation

- all numeric fields must be integers in safe ranges
- interval fields must be `>= 1` minute where applicable
- timeout fields must remain in bounded ranges
- `metricsFreshnessLookbackSeconds >= metricsMissingSeconds`
- `metricsStaleSeconds < metricsMissingSeconds`
- `platformSchedulerStaleThresholdSeconds < metricsMissingSeconds`
- freshness thresholds should remain comfortably above observer cadence

## Runtime Direction

- cron-based monitor dispatch reads `monitor-scheduling`
- freshness, timeout, and concurrency policy reads `monitor-policy`
- AppOS self-observation reads `monitor-platform-self-observation`
- managed collector config generation reads `monitor-managed-collector-policy`
- missing rows fall back to the documented defaults

## Acceptance

- `Settings > System > Monitor` remains a single page.
- The page exposes `Monitor Scheduling`, `Monitor Policy`, `Platform Self-Observation`, and `Managed Collector Policy` as separate cards.
- Persisted settings replace hardcoded defaults for monitor cadence, policy, AppOS self-observation, and managed collector runtime policy.
- Managed collector config generation and install-script fallback stay aligned with the persisted managed collector policy.

## File Touchpoints

- `backend/domain/config/sysconfig/catalog/catalog.go`
- `backend/domain/routes/settings_rules.go`
- `backend/domain/routes/settings_handlers.go`
- `backend/cmd/appos/bootstrap/cron.go`
- `backend/domain/monitor/**`
- `backend/domain/worker/software_delivery.go`
- `backend/domain/software/scripts/telegraf-install.sh`
- `web/src/routes/_app/_auth/_superuser/-settings-screen.tsx`
- `web/src/routes/_app/_auth/_superuser/-settings-controller-system.ts`
- `web/src/routes/_app/_auth/_superuser/-settings-sections/system-sections.tsx`
- `web/src/routes/_app/_auth/_superuser/-settings-sections/types.ts`
