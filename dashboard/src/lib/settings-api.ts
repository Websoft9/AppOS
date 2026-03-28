export const SETTINGS_SCHEMA_API_PATH = '/api/settings/schema'
export const SETTINGS_ENTRIES_API_PATH = '/api/settings/entries'
export const SETTINGS_ACTIONS_API_PATH = '/api/settings/actions'

export type SettingsSection = string
export type SettingsSource = 'native' | 'custom'
export type SettingsActionId = string
export type SettingsEntryId = string

export interface SettingsFieldSchema {
  id: string
  label: string
  type: string
  sensitive?: boolean
  helpText?: string
}

export interface SettingsActionMeta {
  title: string
  entryId?: SettingsEntryId
}

export interface SettingsEntryMeta {
  title: string
  section: SettingsSection
  source: SettingsSource
  fields: readonly SettingsFieldSchema[]
  actions?: readonly SettingsActionId[]
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
