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
  insecureRegistries: string[]
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

export type SecretPolicyErrors = Partial<Record<keyof SecretPolicy, string>>
