import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { pb } from '@/lib/pb'
import { settingsEntryPath, type SettingsEntryId } from '@/lib/settings-api'
import {
  type DockerMirror,
  type DockerRegistries,
  type LLMProviderItem,
  type RegistryItem,
} from './-settings-sections/types'
import { type ShowToast } from './-settings-controller-shared'

export function useIntegrationSettingsController(
  showToast: ShowToast,
  activeSection: SettingsEntryId
) {
  const [mirrors, setMirrors] = useState<string[]>([])
  const [insecureRegs, setInsecureRegs] = useState<string[]>([])
  const [mirrorsSaving, setMirrorsSaving] = useState(false)

  const [dockerRegistries, setDockerRegistries] = useState<RegistryItem[]>([])
  const [regsSaving, setRegsSaving] = useState(false)

  const [llmItems, setLlmItems] = useState<LLMProviderItem[]>([])
  const [llmSaving, setLlmSaving] = useState(false)

  const [secretPickerItems, setSecretPickerItems] = useState<{ id: string; name: string }[]>([])

  const [llmSecretCreateOpen, setLlmSecretCreateOpen] = useState(false)
  const [llmSecretCreateIdx, setLlmSecretCreateIdx] = useState(-1)
  const [llmSecretCreateName, setLlmSecretCreateName] = useState('')
  const [llmSecretCreateKey, setLlmSecretCreateKey] = useState('')
  const [llmSecretCreateSaving, setLlmSecretCreateSaving] = useState(false)
  const [llmSecretCreateError, setLlmSecretCreateError] = useState('')

  const hydrateIntegrationEntries = useCallback((entryMap: Map<string, unknown>) => {
    const mirror = (entryMap.get('docker-mirror') as Partial<DockerMirror>) ?? {}
    setMirrors(Array.isArray(mirror.mirrors) ? mirror.mirrors : [])
    setInsecureRegs(Array.isArray(mirror.insecureRegistries) ? mirror.insecureRegistries : [])

    const registries = (entryMap.get('docker-registries') as Partial<DockerRegistries>) ?? {
      items: [],
    }
    setDockerRegistries(Array.isArray(registries.items) ? registries.items : [])
  }, [])

  const loadLlmProviders = useCallback(async () => {
    try {
      const res = await pb.send<{ items: LLMProviderItem[] }>('/api/llm/providers', {
        method: 'GET',
      })
      setLlmItems(Array.isArray(res.items) ? res.items : [])
    } catch {
      // ignore — will show empty list
    }
  }, [])

  const loadSecretPickerItems = useCallback(async () => {
    try {
      const res = await pb.send<{ items: { id: string; name: string }[] }>(
        '/api/collections/secrets/records?sort=name&fields=id,name&filter=(status=%27active%27)',
        { method: 'GET' }
      )
      setSecretPickerItems(res.items ?? [])
    } catch {
      // ignore — picker just won't show options
    }
  }, [])

  useEffect(() => {
    if (activeSection !== 'llm-providers') return
    void loadSecretPickerItems()
  }, [activeSection, loadSecretPickerItems])

  const handleLlmSecretCreate = async (e: FormEvent) => {
    e.preventDefault()
    setLlmSecretCreateSaving(true)
    setLlmSecretCreateError('')
    try {
      const created = await pb.collection('secrets').create({
        name: llmSecretCreateName,
        template_id: 'api_key',
        scope: 'global',
        payload: { api_key: llmSecretCreateKey },
      })
      await loadSecretPickerItems()
      const idx = llmSecretCreateIdx
      setLlmItems(prev =>
        prev.map((item, itemIndex) =>
          itemIndex === idx ? { ...item, apiKey: `secretRef:${created.id}` } : item
        )
      )
      setLlmSecretCreateOpen(false)
    } catch (err) {
      setLlmSecretCreateError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setLlmSecretCreateSaving(false)
    }
  }

  const saveDockerMirrors = async () => {
    setMirrorsSaving(true)
    try {
      await pb.send(settingsEntryPath('docker-mirror'), {
        method: 'PATCH',
        body: {
          mirrors: mirrors.filter(Boolean),
          insecureRegistries: insecureRegs.filter(Boolean),
        },
      })
      showToast('Docker mirror settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setMirrorsSaving(false)
    }
  }

  const saveDockerRegistries = async () => {
    setRegsSaving(true)
    try {
      await pb.send(settingsEntryPath('docker-registries'), {
        method: 'PATCH',
        body: { items: dockerRegistries },
      })
      showToast('Docker registries saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setRegsSaving(false)
    }
  }

  const saveLlm = async () => {
    setLlmSaving(true)
    try {
      await pb.send('/api/llm/providers', {
        method: 'PATCH',
        body: { items: llmItems },
      })
      showToast('LLM providers saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setLlmSaving(false)
    }
  }

  return {
    mirrors,
    insecureRegs,
    mirrorsSaving,
    setMirrors,
    setInsecureRegs,
    saveDockerMirrors,
    dockerRegistries,
    regsSaving,
    setDockerRegistries,
    saveDockerRegistries,
    llmItems,
    llmSaving,
    secretPickerItems,
    llmSecretCreateOpen,
    llmSecretCreateName,
    llmSecretCreateKey,
    llmSecretCreateSaving,
    llmSecretCreateError,
    setLlmItems,
    setLlmSecretCreateOpen,
    setLlmSecretCreateIdx,
    setLlmSecretCreateName,
    setLlmSecretCreateKey,
    setLlmSecretCreateError,
    handleLlmSecretCreate,
    saveLlm,
    loadLlmProviders,
    hydrateIntegrationEntries,
  }
}
