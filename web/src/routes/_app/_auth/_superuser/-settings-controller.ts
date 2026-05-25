import { useState, useEffect, useCallback } from 'react'
import { pb } from '@/lib/pb'
import {
  SETTINGS_SCHEMA_API_PATH,
  SETTINGS_ENTRIES_API_PATH,
  type SettingsEntriesListResponse,
  type SettingsEntryId,
  type SettingsSchemaEntry,
  type SettingsSchemaResponse,
} from '@/lib/settings-api'
import { useToast } from './-settings-sections/shared'
import { useIntegrationSettingsController } from './-settings-controller-integrations'
import { useSystemSettingsController } from './-settings-controller-system'
import { useWorkspaceSimpleSettingsController } from './-settings-controller-workspace-simple'

export type SectionId = SettingsEntryId | 'monitor'

export function useSettingsPageController() {
  const { toasts, show: showToast } = useToast()
  const [activeSection, setActiveSection] = useState<SectionId>('basic')
  const [schemaEntries, setSchemaEntries] = useState<SettingsSchemaEntry[]>([])
  const [pbLoading, setPbLoading] = useState(true)
  const system = useSystemSettingsController(showToast)
  const workspaceSimple = useWorkspaceSimpleSettingsController(showToast)
  const integrations = useIntegrationSettingsController(showToast)
  const { hydrateSystemEntries } = system
  const { hydrateWorkspaceSimpleEntries } = workspaceSimple
  const { hydrateIntegrationEntries } = integrations

  const loadSettingsData = useCallback(async () => {
    setPbLoading(true)
    try {
      const [schemaResult, entriesResult] = await Promise.all([
        pb.send<SettingsSchemaResponse>(SETTINGS_SCHEMA_API_PATH, { method: 'GET' }),
        pb.send<SettingsEntriesListResponse>(SETTINGS_ENTRIES_API_PATH, { method: 'GET' }),
      ])

      const movedToSystemIds = new Set([
        'tunnel-port-range',
        'proxy-network',
        'docker-mirror',
        'docker-registries',
      ])
      const monitorTailIndex = schemaResult.entries.reduce((lastIndex, entry, index) => {
        return entry.id.startsWith('monitor-') ? index : lastIndex
      }, -1)
      const movedSystemEntries = schemaResult.entries
        .filter(entry => movedToSystemIds.has(entry.id))
        .map(entry => ({ ...entry, section: 'system' as const }))
      const baseEntries = schemaResult.entries.filter(entry => !movedToSystemIds.has(entry.id))
      const normalizedEntries =
        monitorTailIndex >= 0
          ? [
              ...baseEntries.slice(0, monitorTailIndex + 1),
              ...movedSystemEntries,
              ...baseEntries.slice(monitorTailIndex + 1),
            ]
          : [...movedSystemEntries, ...baseEntries]

      // Inject AI nav entry backed by AI Providers so settings can choose the platform default model.
      const aiEntry = {
        id: 'ai' as const,
        title: 'AI',
        description:
          'Choose the platform default AI model and manage AI providers from one place.',
        section: 'workspace',
        source: 'custom' as const,
        fields: [{ id: 'defaultModel', label: 'Default Model', type: 'relation' }],
      }
      const firstWorkspaceIndex = normalizedEntries.findIndex(entry => entry.section === 'workspace')
      const allEntries =
        firstWorkspaceIndex >= 0
          ? [
              ...normalizedEntries.slice(0, firstWorkspaceIndex),
              aiEntry,
              ...normalizedEntries.slice(firstWorkspaceIndex),
            ]
          : [...normalizedEntries, aiEntry]
      setSchemaEntries(allEntries)
      if (allEntries.length > 0) {
        setActiveSection(prev =>
          allEntries.some(entry => entry.id === prev) ||
            (prev === 'monitor' &&
              allEntries.some(
                entry => entry.id === 'monitor-scheduling' || entry.id === 'monitor-policy'
              ))
            ? prev
            : allEntries[0].id
        )
      }

      const entryMap = new Map(entriesResult.items.map(item => [item.id, item.value]))
      hydrateSystemEntries(entryMap)
      hydrateWorkspaceSimpleEntries(entryMap)
      hydrateIntegrationEntries(entryMap)
    } catch (err) {
      showToast(
        'Failed to load settings: ' + (err instanceof Error ? err.message : String(err)),
        false
      )
    } finally {
      setPbLoading(false)
    }
  }, [showToast, hydrateIntegrationEntries, hydrateSystemEntries, hydrateWorkspaceSimpleEntries])

  useEffect(() => {
    loadSettingsData()
  }, [loadSettingsData])

  return {
    toasts,
    showToast,
    activeSection,
    setActiveSection,
    schemaEntries,
    pbLoading,
    ...system,
    ...workspaceSimple,
    ...integrations,
  }
}

export type SettingsPageController = ReturnType<typeof useSettingsPageController>
