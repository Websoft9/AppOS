import { useCallback, useState } from 'react'
import { pb } from '@/lib/pb'
import { settingsActionPath, settingsEntryPath } from '@/lib/settings-api'
import { type ShowToast } from './-settings-controller-shared'

export function useSystemSettingsController(showToast: ShowToast) {
  const [appName, setAppName] = useState('')
  const [appURL, setAppURL] = useState('')
  const [appSaving, setAppSaving] = useState(false)

  const [s3Enabled, setS3Enabled] = useState(false)
  const [s3Bucket, setS3Bucket] = useState('')
  const [s3Region, setS3Region] = useState('')
  const [s3Endpoint, setS3Endpoint] = useState('')
  const [s3AccessKey, setS3AccessKey] = useState('')
  const [s3Secret, setS3Secret] = useState('')
  const [s3ForcePathStyle, setS3ForcePathStyle] = useState(false)
  const [s3Saving, setS3Saving] = useState(false)
  const [s3Testing, setS3Testing] = useState(false)

  const [logsMaxDays, setLogsMaxDays] = useState(7)
  const [logsMinLevel, setLogsMinLevel] = useState(5)
  const [logsLogIP, setLogsLogIP] = useState(false)
  const [logsLogAuthId, setLogsLogAuthId] = useState(false)
  const [logsSaving, setLogsSaving] = useState(false)

  const hydrateSystemEntries = useCallback((entryMap: Map<string, unknown>) => {
    const basic = (entryMap.get('basic') as Partial<{ appName: string; appURL: string }>) ?? {}
    setAppName(basic.appName ?? '')
    setAppURL(basic.appURL ?? '')

    const s3 =
      (entryMap.get('s3') as Partial<{
        enabled: boolean
        bucket: string
        region: string
        endpoint: string
        accessKey: string
        secret: string
        forcePathStyle: boolean
      }>) ?? {}
    setS3Enabled(Boolean(s3.enabled))
    setS3Bucket(s3.bucket ?? '')
    setS3Region(s3.region ?? '')
    setS3Endpoint(s3.endpoint ?? '')
    setS3AccessKey(s3.accessKey ?? '')
    setS3Secret(s3.secret ?? '')
    setS3ForcePathStyle(Boolean(s3.forcePathStyle))

    const logs =
      (entryMap.get('logs') as Partial<{
        maxDays: number
        minLevel: number
        logIP: boolean
        logAuthId: boolean
      }>) ?? {}
    setLogsMaxDays(Number(logs.maxDays ?? 7))
    setLogsMinLevel(Number(logs.minLevel ?? 5))
    setLogsLogIP(Boolean(logs.logIP))
    setLogsLogAuthId(Boolean(logs.logAuthId))
  }, [])

  const saveApp = async () => {
    setAppSaving(true)
    try {
      await pb.send(settingsEntryPath('basic'), {
        method: 'PATCH',
        body: { appName, appURL },
      })
      showToast('Basic settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setAppSaving(false)
    }
  }

  const saveS3 = async () => {
    setS3Saving(true)
    try {
      await pb.send(settingsEntryPath('s3'), {
        method: 'PATCH',
        body: {
          enabled: s3Enabled,
          bucket: s3Bucket,
          region: s3Region,
          endpoint: s3Endpoint,
          accessKey: s3AccessKey,
          secret: s3Secret,
          forcePathStyle: s3ForcePathStyle,
        },
      })
      showToast('S3 settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setS3Saving(false)
    }
  }

  const testS3 = async () => {
    setS3Testing(true)
    try {
      await pb.send(settingsActionPath('test-s3'), { method: 'POST' })
      showToast('S3 connection successful')
    } catch (err) {
      showToast('S3 test failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setS3Testing(false)
    }
  }

  const saveLogs = async () => {
    setLogsSaving(true)
    try {
      await pb.send(settingsEntryPath('logs'), {
        method: 'PATCH',
        body: {
          maxDays: logsMaxDays,
          minLevel: logsMinLevel,
          logIP: logsLogIP,
          logAuthId: logsLogAuthId,
        },
      })
      showToast('Log settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setLogsSaving(false)
    }
  }

  return {
    appName,
    appURL,
    appSaving,
    setAppName,
    setAppURL,
    saveApp,
    s3Enabled,
    s3Bucket,
    s3Region,
    s3Endpoint,
    s3AccessKey,
    s3Secret,
    s3ForcePathStyle,
    s3Saving,
    s3Testing,
    setS3Enabled,
    setS3Bucket,
    setS3Region,
    setS3Endpoint,
    setS3AccessKey,
    setS3Secret,
    setS3ForcePathStyle,
    saveS3,
    testS3,
    logsMaxDays,
    logsMinLevel,
    logsLogIP,
    logsLogAuthId,
    logsSaving,
    setLogsMaxDays,
    setLogsMinLevel,
    setLogsLogIP,
    setLogsLogAuthId,
    saveLogs,
    hydrateSystemEntries,
  }
}
