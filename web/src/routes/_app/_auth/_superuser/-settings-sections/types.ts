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
  source: ProxySource
  enabled: boolean
  socks5ConnectorId: string
  httpConnectorId: string
  httpsConnectorId: string
}

export type ProxySource = 'none' | 'external' | 'self'

export interface ProxyNetworkErrors {
  form?: string
  consumers?: string
  socks5ConnectorId?: string
  httpConnectorId?: string
  httpsConnectorId?: string
}

export type ProxyConsumerMode = 'disabled' | 'always'

export interface ProxyConsumerItem {
  consumerKey: string
  mode: ProxyConsumerMode
}

export interface ProxyConsumerDefinition {
  key: string
  title: string
  description?: string
  location: 'local' | 'remote'
  moduleKey?: string
  scope: string
  adapter: string
  trafficClass: string
  support: string
  defaultMode: ProxyConsumerMode
  allowedModes: ProxyConsumerMode[]
  enrollable: boolean
  tags?: string[]
}

export interface ProxyConsumersSettings {
  items: ProxyConsumerItem[]
  definitions: ProxyConsumerDefinition[]
}

export interface ProxyRemoteShellOverride {
  serverId: string
  mode: ProxyConsumerMode
}

export interface ProxyRemoteShellSettings {
  items: ProxyRemoteShellOverride[]
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

export interface TopicShare {
  shareMaxMinutes: number
  shareDefaultMinutes: number
}

export interface TopicCommentPolicy {
  allowGuestComments: boolean
  defaultGuestName: string
  maxGuestNameLength: number
  maxCommentBodyLength: number
}

export interface TopicImportPolicy {
  maxDescriptionImportKB: number
  textOnly: boolean
}

export interface TunnelPortRange {
  start: number
  end: number
}

export interface DeployPreflightGroup {
  minFreeDiskGiB: number
}

export interface DeployRuntimeGroup {
  imagePullTimeoutSeconds: number
  composeUpTimeoutSeconds: number
  healthCheckTimeoutSeconds: number
  runtimePullIdleHeartbeatSeconds: number
}

export interface DeployGitDefaultsGroup {
  defaultRef: string
  defaultComposePath: string
}

export interface IacFilesGroup {
  maxSizeMB: number
  maxZipSizeMB: number
  extensionBlacklist: string
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
  source: 'none',
  enabled: false,
  socks5ConnectorId: '',
  httpConnectorId: '',
  httpsConnectorId: '',
}

export const EMPTY_PROXY_CONSUMERS: ProxyConsumersSettings = {
  items: [],
  definitions: [],
}

export const EMPTY_PROXY_REMOTE_SHELL: ProxyRemoteShellSettings = {
  items: [],
}

export const DEFAULT_CONNECT_TERMINAL: ConnectTerminalGroup = {
  idleTimeoutSeconds: 1800,
  maxConnections: 0,
}

export const DEFAULT_CONNECT_SFTP: ConnectSftpGroup = {
  maxUploadFiles: 10,
}

export const DEFAULT_TOPIC_SHARE: TopicShare = {
  shareMaxMinutes: 60,
  shareDefaultMinutes: 30,
}

export const DEFAULT_TOPIC_COMMENT_POLICY: TopicCommentPolicy = {
  allowGuestComments: true,
  defaultGuestName: 'Guest',
  maxGuestNameLength: 100,
  maxCommentBodyLength: 10000,
}

export const DEFAULT_TOPIC_IMPORT_POLICY: TopicImportPolicy = {
  maxDescriptionImportKB: 2,
  textOnly: true,
}

export const DEFAULT_TUNNEL_PORT_RANGE: TunnelPortRange = {
  start: 40000,
  end: 49999,
}

export const DEFAULT_DEPLOY_PREFLIGHT: DeployPreflightGroup = {
  minFreeDiskGiB: 1,
}

export const DEFAULT_DEPLOY_RUNTIME: DeployRuntimeGroup = {
  imagePullTimeoutSeconds: 180,
  composeUpTimeoutSeconds: 600,
  healthCheckTimeoutSeconds: 120,
  runtimePullIdleHeartbeatSeconds: 20,
}

export const DEFAULT_DEPLOY_GIT_DEFAULTS: DeployGitDefaultsGroup = {
  defaultRef: 'main',
  defaultComposePath: 'docker-compose.yml',
}

export const DEFAULT_IAC_FILES: IacFilesGroup = {
  maxSizeMB: 10,
  maxZipSizeMB: 50,
  extensionBlacklist: '.exe,.dll,.so,.bin,.deb,.rpm,.apk,.msi,.dmg,.pkg',
}

export type SecretPolicyErrors = Partial<Record<keyof SecretPolicy, string>>
