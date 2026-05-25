import { useCallback, useState } from 'react'
import { pb } from '@/lib/pb'
import { settingsEntryPath } from '@/lib/settings-api'
import { type DockerMirror } from './-settings-sections/types'
import { type ShowToast } from './-settings-controller-shared'

export function useIntegrationSettingsController(showToast: ShowToast) {
  const [mirrors, setMirrors] = useState<string[]>([])
  const [allowInsecureRegistries, setAllowInsecureRegistries] = useState(false)
  const [mirrorsSaving, setMirrorsSaving] = useState(false)

  const hydrateIntegrationEntries = useCallback((entryMap: Map<string, unknown>) => {
    const mirror = (entryMap.get('docker-mirror') as Partial<DockerMirror>) ?? {}
    setMirrors(Array.isArray(mirror.mirrors) ? mirror.mirrors : [])
    setAllowInsecureRegistries(Boolean(mirror.allowInsecureRegistries))
  }, [])

  const saveDockerMirrors = async () => {
    setMirrorsSaving(true)
    try {
      await pb.send(settingsEntryPath('docker-mirror'), {
        method: 'PATCH',
        body: {
          mirrors: mirrors.filter(Boolean),
          allowInsecureRegistries,
        },
      })
      showToast('Docker mirror settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setMirrorsSaving(false)
    }
  }

  return {
    mirrors,
    allowInsecureRegistries,
    mirrorsSaving,
    setMirrors,
    setAllowInsecureRegistries,
    saveDockerMirrors,
    hydrateIntegrationEntries,
  }
}
