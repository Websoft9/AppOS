export const SETTINGS_SCHEMA_API_PATH = '/api/settings/schema'
export const SETTINGS_ENTRIES_API_PATH = '/api/settings/entries'
export const SETTINGS_ACTIONS_API_PATH = '/api/settings/actions'

export type SettingsSection = 'system' | 'workspace'
export type SettingsSource = 'pocketbase' | 'app_settings'
export type SettingsActionId = 'test-email' | 'test-s3'

export type SettingsEntryId =
  | 'basic'
  | 'smtp'
  | 's3'
  | 'logs'
  | 'secrets-policy'
  | 'space-quota'
  | 'connect-terminal'
  | 'deploy-preflight'
  | 'iac-files'
  | 'tunnel-port-range'
  | 'proxy-network'
  | 'docker-mirror'
  | 'docker-registries'
  | 'llm-providers'

export interface SettingsFieldSchema {
  id: string
  label: string
  type: string
  sensitive?: boolean
  helpText?: string
}

export interface SettingsSchemaEntry {
  id: SettingsEntryId
  title: string
  section: SettingsSection
  source: SettingsSource
  fields: SettingsFieldSchema[]
  actions?: SettingsActionId[]
}

export interface SettingsSchemaResponse {
  entries: SettingsSchemaEntry[]
  actions: Array<{ id: SettingsActionId; title: string; entryId?: SettingsEntryId }>
}

export interface SettingsEntryResponse<T = unknown> {
  id: SettingsEntryId
  value: T
}

export interface SettingsEntriesListResponse {
  items: SettingsEntryResponse[]
}

export function settingsEntryPath(entryId: SettingsEntryId): string {
  return `${SETTINGS_ENTRIES_API_PATH}/${entryId}`
}

export function settingsActionPath(actionId: SettingsActionId): string {
  return `${SETTINGS_ACTIONS_API_PATH}/${actionId}`
}