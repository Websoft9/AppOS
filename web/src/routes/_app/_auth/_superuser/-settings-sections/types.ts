import type { SecretPolicy } from '@/lib/secrets-policy'

export interface SpaceQuota {
  maxSizeMB: number
  maxPerUser: number
  maxUploadFiles: number
  shareMaxMinutes: number
  shareDefaultMinutes: number
  uploadAllowExts: string[]
  uploadDenyExts: string[]
  disallowedFolderNames: string[]
}

export interface ProxyNetwork {
  httpProxy: string
  httpsProxy: string
  noProxy: string
  username: string
  password: string
}

export interface DockerMirror {
  mirrors: string[]
  allowInsecureRegistries: boolean
}

export interface ConnectTerminalGroup {
  idleTimeoutSeconds: number
  maxConnections: number
}

export interface ConnectSftpGroup {
  maxUploadFiles: number
}

export interface TunnelPortRange {
  start: number
  end: number
}

export interface DeployPreflightGroup {
  minFreeDiskBytes: number
}

export interface IacFilesGroup {
  maxSizeMB: number
  maxZipSizeMB: number
  extensionBlacklist: string
}

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

export const DEFAULT_SPACE_QUOTA: SpaceQuota = {
  maxSizeMB: 10,
  maxPerUser: 100,
  maxUploadFiles: 50,
  shareMaxMinutes: 60,
  shareDefaultMinutes: 30,
  uploadAllowExts: [],
  uploadDenyExts: [],
  disallowedFolderNames: [],
}

export const EMPTY_PROXY: ProxyNetwork = {
  httpProxy: '',
  httpsProxy: '',
  noProxy: '',
  username: '',
  password: '',
}

export const DEFAULT_CONNECT_TERMINAL: ConnectTerminalGroup = {
  idleTimeoutSeconds: 1800,
  maxConnections: 0,
}

export const DEFAULT_CONNECT_SFTP: ConnectSftpGroup = {
  maxUploadFiles: 10,
}

export const DEFAULT_TUNNEL_PORT_RANGE: TunnelPortRange = {
  start: 40000,
  end: 49999,
}

export const DEFAULT_DEPLOY_PREFLIGHT: DeployPreflightGroup = {
  minFreeDiskBytes: 512 * 1024 * 1024,
}

export const DEFAULT_IAC_FILES: IacFilesGroup = {
  maxSizeMB: 10,
  maxZipSizeMB: 50,
  extensionBlacklist: '.exe,.dll,.so,.bin,.deb,.rpm,.apk,.msi,.dmg,.pkg',
}

export const DEFAULT_MONITOR_SCHEDULING: MonitorSchedulingGroup = {
  reachabilityIntervalMinutes: 1,
  metricsFreshnessIntervalMinutes: 1,
  controlReachabilityIntervalMinutes: 1,
  runtimeSnapshotIntervalMinutes: 1,
  credentialSweepIntervalMinutes: 5,
  appHealthIntervalMinutes: 1,
  factsPullIntervalMinutes: 15,
}

export const DEFAULT_MONITOR_POLICY: MonitorPolicyGroup = {
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

export type SecretPolicyErrors = Partial<Record<keyof SecretPolicy, string>>
