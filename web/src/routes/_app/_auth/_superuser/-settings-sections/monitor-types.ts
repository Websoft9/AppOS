export interface MonitorSchedulingGroup {
  reachabilityIntervalMinutes: number
  metricsFreshnessIntervalMinutes: number
  controlReachabilityIntervalMinutes: number
  runtimeSnapshotIntervalMinutes: number
  credentialSweepIntervalMinutes: number
  appHealthIntervalMinutes: number
  factsPullIntervalMinutes: number
}

export interface MonitorPolicyGroup {
  reachabilityProbeTimeoutMs: number
  metricsFreshnessLookbackSeconds: number
  metricsStaleSeconds: number
  metricsMissingSeconds: number
  controlProbeTimeoutSeconds: number
  factsPullTimeoutSeconds: number
  runtimePullTimeoutSeconds: number
  factsPullConcurrency: number
  runtimePullConcurrency: number
}

export interface MonitorPlatformSelfObservationGroup {
  platformObserverIntervalSeconds: number
  platformSchedulerStaleThresholdSeconds: number
  enableHostTelemetry: boolean
  enableContainerTelemetry: boolean
}

export interface MonitorManagedCollectorPolicyGroup {
  collectionIntervalSeconds: number
  flushIntervalSeconds: number
  metricBatchSize: number
  metricBufferLimit: number
  collectionJitterSeconds: number
  flushJitterSeconds: number
}

export const DEFAULT_MONITOR_SCHEDULING: MonitorSchedulingGroup = {
  reachabilityIntervalMinutes: 60,
  metricsFreshnessIntervalMinutes: 1,
  controlReachabilityIntervalMinutes: 1,
  runtimeSnapshotIntervalMinutes: 1,
  credentialSweepIntervalMinutes: 5,
  appHealthIntervalMinutes: 1,
  factsPullIntervalMinutes: 15,
}

export const DEFAULT_MONITOR_POLICY: MonitorPolicyGroup = {
  reachabilityProbeTimeoutMs: 1500,
  metricsFreshnessLookbackSeconds: 300,
  metricsStaleSeconds: 90,
  metricsMissingSeconds: 180,
  controlProbeTimeoutSeconds: 5,
  factsPullTimeoutSeconds: 20,
  runtimePullTimeoutSeconds: 20,
  factsPullConcurrency: 5,
  runtimePullConcurrency: 5,
}

export const DEFAULT_MONITOR_PLATFORM_SELF_OBSERVATION: MonitorPlatformSelfObservationGroup = {
  platformObserverIntervalSeconds: 30,
  platformSchedulerStaleThresholdSeconds: 10,
  enableHostTelemetry: false,
  enableContainerTelemetry: false,
}

export const DEFAULT_MONITOR_MANAGED_COLLECTOR_POLICY: MonitorManagedCollectorPolicyGroup = {
  collectionIntervalSeconds: 10,
  flushIntervalSeconds: 10,
  metricBatchSize: 1000,
  metricBufferLimit: 5000,
  collectionJitterSeconds: 1,
  flushJitterSeconds: 1,
}
