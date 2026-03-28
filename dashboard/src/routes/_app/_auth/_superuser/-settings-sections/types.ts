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

export interface RegistryItem {
  host: string
  username: string
  password: string
}

export interface DockerRegistries {
  items: RegistryItem[]
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

export interface LLMProviderItem {
  name: string
  endpoint: string
  apiKey: string
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

export const LLM_VENDORS: { label: string; endpoint: string }[] = [
  { label: 'OpenAI', endpoint: 'https://api.openai.com/v1' },
  { label: 'Anthropic', endpoint: 'https://api.anthropic.com' },
  { label: 'Google Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta' },
  { label: 'Mistral', endpoint: 'https://api.mistral.ai/v1' },
  { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1' },
  { label: 'Groq', endpoint: 'https://api.groq.com/openai/v1' },
  { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1' },
  {
    label: 'Azure OpenAI',
    endpoint: 'https://{resource}.openai.azure.com/openai/deployments/{model}',
  },
  { label: 'Ollama', endpoint: 'http://localhost:11434/v1' },
  { label: 'Custom', endpoint: '' },
]

export type SecretPolicyErrors = Partial<Record<keyof SecretPolicy, string>>
