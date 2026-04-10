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

export type SectionId = SettingsEntryId

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

      // Inject LLM providers nav entry (served by connectors API, not settings)
      const allEntries = [
        ...schemaResult.entries,
        {
          id: 'llm-providers' as const,
          title: 'LLM Providers',
          description:
            'Reference-only entry. Create and manage LLM connectors from Resources > Connectors.',
          section: 'workspace',
          source: 'custom' as const,
          fields: [{ id: 'items', label: 'Items', type: 'object-list' }],
        },
      ]
      setSchemaEntries(allEntries)
      if (allEntries.length > 0) {
        setActiveSection(prev =>
          allEntries.some(entry => entry.id === prev) ? prev : allEntries[0].id
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
