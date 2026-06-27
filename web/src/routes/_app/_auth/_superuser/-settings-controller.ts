import { useState, useEffect, useCallback, useRef } from 'react'
import { pb } from '@/lib/pb'
import {
  SETTINGS_SCHEMA_API_PATH,
  SETTINGS_ENTRIES_API_PATH,
  type SettingsEntryResponse,
  type SettingsEntriesListResponse,
  type SettingsEntryId,
  type SettingsSchemaEntry,
  type SettingsSchemaResponse,
} from '@/lib/settings-api'
import { useToast } from './-settings-sections/shared'
import { useFeedsSettingsController } from './-settings-controller-feeds'
import { useIntegrationSettingsController } from './-settings-controller-integrations'
import { useMonitorSettingsController } from './-settings-controller-monitor'
import { useSystemSettingsController } from './-settings-controller-system'
import { useWorkspaceSimpleSettingsController } from './-settings-controller-workspace-simple'
import {
  AI_SECTION_IDS,
  BASIC_SECTION_IDS,
  BRANDING_SECTION_IDS,
  DEPLOY_SECTION_IDS,
  DOCKER_SECTION_IDS,
  LOGS_SECTION_IDS,
  MONITOR_SECTION_IDS,
  PROXY_SECTION_IDS,
  S3_SECTION_IDS,
  SMTP_SECTION_IDS,
  SPACE_SECTION_IDS,
  TERMINAL_SECTION_IDS,
  TOPIC_SECTION_IDS,
  TUNNEL_SECTION_IDS,
} from './-settings-core/section-ids'

export type SectionId = SettingsEntryId | 'monitor'

const noAutoCancel = { requestKey: null }

function resolveEntryIDsForSection(section: SectionId): SettingsEntryId[] {
  if (AI_SECTION_IDS.includes(section as (typeof AI_SECTION_IDS)[number])) {
    return []
  }
  if (SMTP_SECTION_IDS.includes(section as (typeof SMTP_SECTION_IDS)[number])) {
    return ['smtp']
  }
  if (BASIC_SECTION_IDS.includes(section as (typeof BASIC_SECTION_IDS)[number])) {
    return ['basic']
  }
  if (BRANDING_SECTION_IDS.includes(section as (typeof BRANDING_SECTION_IDS)[number])) {
    return ['branding']
  }
  if (S3_SECTION_IDS.includes(section as (typeof S3_SECTION_IDS)[number])) {
    return ['s3']
  }
  if (LOGS_SECTION_IDS.includes(section as (typeof LOGS_SECTION_IDS)[number])) {
    return ['logs']
  }
  if (SPACE_SECTION_IDS.includes(section as (typeof SPACE_SECTION_IDS)[number])) {
    return ['space-quota']
  }
  if (TERMINAL_SECTION_IDS.includes(section as (typeof TERMINAL_SECTION_IDS)[number])) {
    return ['connect-terminal', 'connect-sftp']
  }
  if (DEPLOY_SECTION_IDS.includes(section as (typeof DEPLOY_SECTION_IDS)[number])) {
    return ['deploy-preflight', 'deploy-runtime', 'deploy-git-defaults']
  }
  if (TUNNEL_SECTION_IDS.includes(section as (typeof TUNNEL_SECTION_IDS)[number])) {
    return ['tunnel-port-range']
  }
  if (TOPIC_SECTION_IDS.includes(section as (typeof TOPIC_SECTION_IDS)[number])) {
    return ['topic-share', 'topic-comment-policy', 'topic-import-policy']
  }
  if (MONITOR_SECTION_IDS.includes(section as (typeof MONITOR_SECTION_IDS)[number])) {
    return [
      'monitor-scheduling',
      'monitor-policy',
      'monitor-platform-self-observation',
      'monitor-managed-collector-policy',
    ]
  }
  if (DOCKER_SECTION_IDS.includes(section as (typeof DOCKER_SECTION_IDS)[number])) {
    return ['docker-mirror']
  }
  if (PROXY_SECTION_IDS.includes(section as (typeof PROXY_SECTION_IDS)[number])) {
    return ['proxy-network', 'proxy-policies', 'proxy-remote-shell']
  }
  return [section as SettingsEntryId]
}

function buildSettingsEntriesQueryPath(entryIDs: SettingsEntryId[]): string {
  if (entryIDs.length === 0) {
    return SETTINGS_ENTRIES_API_PATH
  }
  const params = new URLSearchParams()
  params.set('ids', entryIDs.join(','))
  return `${SETTINGS_ENTRIES_API_PATH}?${params.toString()}`
}

export function useSettingsPageController() {
  const { toasts, show: showToast } = useToast()
  const [activeSection, setActiveSection] = useState<SectionId>('basic')
  const [schemaEntries, setSchemaEntries] = useState<SettingsSchemaEntry[]>([])
  const [pbLoading, setPbLoading] = useState(true)
  const [loadingSectionId, setLoadingSectionId] = useState<SectionId | null>(null)
  const feeds = useFeedsSettingsController(showToast)
  const monitor = useMonitorSettingsController(showToast)
  const system = useSystemSettingsController(showToast)
  const workspaceSimple = useWorkspaceSimpleSettingsController(showToast)
  const integrations = useIntegrationSettingsController(showToast)
  const { hydrateFeedsEntries } = feeds
  const { hydrateMonitorEntries } = monitor
  const { hydrateSystemEntries } = system
  const { hydrateWorkspaceSimpleEntries } = workspaceSimple
  const { hydrateIntegrationEntries } = integrations
  const loadedEntryValuesRef = useRef(new Map<string, unknown>())
  const loadedSectionIdsRef = useRef(new Set<string>())
  const inFlightSectionLoadsRef = useRef(new Map<string, Promise<void>>())
  const sectionLoadTokenRef = useRef(0)
  const activeSectionRef = useRef<SectionId>('basic')

  useEffect(() => {
    activeSectionRef.current = activeSection
  }, [activeSection])

  const hydrateLoadedEntries = useCallback(() => {
    const entryMap = new Map(loadedEntryValuesRef.current)
    hydrateFeedsEntries(entryMap)
    hydrateMonitorEntries(entryMap)
    hydrateSystemEntries(entryMap)
    hydrateWorkspaceSimpleEntries(entryMap)
    hydrateIntegrationEntries(entryMap)
  }, [
    hydrateFeedsEntries,
    hydrateIntegrationEntries,
    hydrateMonitorEntries,
    hydrateSystemEntries,
    hydrateWorkspaceSimpleEntries,
  ])

  const loadSectionEntries = useCallback(
    (section: SectionId) => {
      const requestedEntryIDs = resolveEntryIDsForSection(section)
      if (requestedEntryIDs.length === 0) {
        loadedSectionIdsRef.current.add(section)
        return Promise.resolve()
      }

      const missingEntryIDs = requestedEntryIDs.filter(id => !loadedEntryValuesRef.current.has(id))
      if (missingEntryIDs.length === 0) {
        loadedSectionIdsRef.current.add(section)
        return Promise.resolve()
      }

      const inFlightRequest = inFlightSectionLoadsRef.current.get(section)
      if (inFlightRequest) {
        return inFlightRequest
      }

      const token = ++sectionLoadTokenRef.current
      setLoadingSectionId(section)
      const request = (async () => {
        try {
          const response = await pb.send<SettingsEntriesListResponse>(
            buildSettingsEntriesQueryPath(missingEntryIDs),
            { method: 'GET', ...noAutoCancel }
          )
          const items = Array.isArray(response.items) ? response.items : []
          const unresolved = new Set(missingEntryIDs)
          let hasError = false

          for (const item of items as SettingsEntryResponse[]) {
            unresolved.delete(item.id)
            if (item.error) {
              hasError = true
              showToast(`Failed to load ${item.id}: ${item.error}`, false)
              continue
            }
            loadedEntryValuesRef.current.set(item.id, item.value)
          }

          if (unresolved.size > 0) {
            hasError = true
            for (const entryID of unresolved) {
              showToast(`Failed to load ${entryID}: response was missing this entry`, false)
            }
          }

          hydrateLoadedEntries()
          if (!hasError) {
            loadedSectionIdsRef.current.add(section)
          }
        } catch (err) {
          showToast(
            'Failed to load settings section: ' +
              (err instanceof Error ? err.message : String(err)),
            false
          )
        } finally {
          inFlightSectionLoadsRef.current.delete(section)
          if (sectionLoadTokenRef.current === token) {
            setLoadingSectionId(current => (current === section ? null : current))
          }
        }
      })()

      inFlightSectionLoadsRef.current.set(section, request)
      return request
    },
    [hydrateLoadedEntries, showToast]
  )

  const loadSettingsData = useCallback(async () => {
    setPbLoading(true)
    try {
      loadedEntryValuesRef.current = new Map()
      loadedSectionIdsRef.current = new Set()
      inFlightSectionLoadsRef.current = new Map()
      const schemaResult = await pb.send<SettingsSchemaResponse>(SETTINGS_SCHEMA_API_PATH, {
        method: 'GET',
        ...noAutoCancel,
      })

      const movedToSystemIds = new Set([
        'tunnel-port-range',
        'proxy-network',
        'proxy-policies',
        'proxy-remote-shell',
        'docker-mirror',
      ])
      const monitorTailIndex = schemaResult.entries.reduce((lastIndex, entry, index) => {
        return entry.id.startsWith('monitor-') ? index : lastIndex
      }, -1)
      const movedSystemEntries = schemaResult.entries
        .filter(entry => movedToSystemIds.has(entry.id))
        .map(entry => ({ ...entry, section: 'system' as const }))
      const hiddenEntryIds = new Set(['docker-registries'])
      const baseEntries = schemaResult.entries.filter(
        entry => !movedToSystemIds.has(entry.id) && !hiddenEntryIds.has(entry.id)
      )
      const normalizedEntries =
        monitorTailIndex >= 0
          ? [
              ...baseEntries.slice(0, monitorTailIndex + 1),
              ...movedSystemEntries.filter(entry => !hiddenEntryIds.has(entry.id)),
              ...baseEntries.slice(monitorTailIndex + 1),
            ]
          : [...movedSystemEntries.filter(entry => !hiddenEntryIds.has(entry.id)), ...baseEntries]

      // Inject AI nav entry backed by AI Providers so settings can choose the platform default model.
      const aiEntry = {
        id: 'ai' as const,
        title: 'AI',
        description:
          'Choose which AI Provider account AppOS should prefer when one provider has multiple accounts.',
        section: 'workspace',
        source: 'custom' as const,
        fields: [{ id: 'defaultModel', label: 'Default Model', type: 'relation' }],
      }
      const firstWorkspaceIndex = normalizedEntries.findIndex(
        entry => entry.section === 'workspace'
      )
      const allEntries =
        firstWorkspaceIndex >= 0
          ? [
              ...normalizedEntries.slice(0, firstWorkspaceIndex),
              aiEntry,
              ...normalizedEntries.slice(firstWorkspaceIndex),
            ]
          : [...normalizedEntries, aiEntry]
      const nextActiveSection =
        allEntries.some(entry => entry.id === activeSectionRef.current) ||
        (activeSectionRef.current === 'monitor' &&
          allEntries.some(
            entry => entry.id === 'monitor-scheduling' || entry.id === 'monitor-policy'
          ))
          ? activeSectionRef.current
          : allEntries[0]?.id ?? 'basic'
      setSchemaEntries(allEntries)
      setActiveSection(nextActiveSection)
      await loadSectionEntries(nextActiveSection)
    } catch (err) {
      showToast(
        'Failed to load settings: ' + (err instanceof Error ? err.message : String(err)),
        false
      )
    } finally {
      setPbLoading(false)
    }
  }, [
    showToast,
    loadSectionEntries,
  ])

  const loadSettingsDataRef = useRef(loadSettingsData)

  useEffect(() => {
    loadSettingsDataRef.current = loadSettingsData
  }, [loadSettingsData])

  useEffect(() => {
    void loadSettingsDataRef.current()
  }, [])

  useEffect(() => {
    if (schemaEntries.length === 0) {
      return
    }
    if (loadedSectionIdsRef.current.has(activeSection)) {
      return
    }
    void loadSectionEntries(activeSection)
  }, [activeSection, loadSectionEntries, schemaEntries.length])

  return {
    toasts,
    showToast,
    activeSection,
    setActiveSection,
    schemaEntries,
    pbLoading,
    sectionLoading: loadingSectionId === activeSection,
    ...feeds,
    ...monitor,
    ...system,
    ...workspaceSimple,
    ...integrations,
  }
}

export type SettingsPageController = ReturnType<typeof useSettingsPageController>
