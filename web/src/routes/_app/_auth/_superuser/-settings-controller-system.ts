import { useCallback, useState } from 'react'
import { ClientResponseError } from 'pocketbase'
import { pb } from '@/lib/pb'
import { settingsActionPath, settingsEntryPath } from '@/lib/settings-api'
import {
  DEFAULT_MONITOR_MANAGED_COLLECTOR_POLICY,
  DEFAULT_MONITOR_POLICY,
  DEFAULT_MONITOR_PLATFORM_SELF_OBSERVATION,
  DEFAULT_MONITOR_SCHEDULING,
  type MonitorManagedCollectorPolicyGroup,
  type MonitorPolicyGroup,
  type MonitorPlatformSelfObservationGroup,
  type MonitorSchedulingGroup,
} from './-settings-sections/types'
import { extractFieldError, type ShowToast } from './-settings-controller-shared'

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

  const [monitorSchedulingForm, setMonitorSchedulingForm] =
    useState<MonitorSchedulingGroup>(DEFAULT_MONITOR_SCHEDULING)
  const [monitorSchedulingSaving, setMonitorSchedulingSaving] = useState(false)
  const [monitorSchedulingErrors, setMonitorSchedulingErrors] = useState<
    Partial<Record<keyof MonitorSchedulingGroup, string>>
  >({})

  const [monitorPolicyForm, setMonitorPolicyForm] =
    useState<MonitorPolicyGroup>(DEFAULT_MONITOR_POLICY)
  const [monitorPolicySaving, setMonitorPolicySaving] = useState(false)
  const [monitorPolicyErrors, setMonitorPolicyErrors] = useState<
    Partial<Record<keyof MonitorPolicyGroup, string>>
  >({})

  const [monitorPlatformSelfObservationForm, setMonitorPlatformSelfObservationForm] =
    useState<MonitorPlatformSelfObservationGroup>(DEFAULT_MONITOR_PLATFORM_SELF_OBSERVATION)
  const [monitorPlatformSelfObservationSaving, setMonitorPlatformSelfObservationSaving] =
    useState(false)
  const [monitorPlatformSelfObservationErrors, setMonitorPlatformSelfObservationErrors] = useState<
    Partial<Record<keyof MonitorPlatformSelfObservationGroup, string>>
  >({})

  const [monitorManagedCollectorPolicyForm, setMonitorManagedCollectorPolicyForm] =
    useState<MonitorManagedCollectorPolicyGroup>(DEFAULT_MONITOR_MANAGED_COLLECTOR_POLICY)
  const [monitorManagedCollectorPolicySaving, setMonitorManagedCollectorPolicySaving] =
    useState(false)
  const [monitorManagedCollectorPolicyErrors, setMonitorManagedCollectorPolicyErrors] = useState<
    Partial<Record<keyof MonitorManagedCollectorPolicyGroup, string>>
  >({})

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

    const monitorScheduling =
      (entryMap.get('monitor-scheduling') as Partial<MonitorSchedulingGroup>) ?? {}
    setMonitorSchedulingForm({
      ...DEFAULT_MONITOR_SCHEDULING,
      ...monitorScheduling,
    })

    const monitorPolicy = (entryMap.get('monitor-policy') as Partial<MonitorPolicyGroup>) ?? {}
    setMonitorPolicyForm({
      ...DEFAULT_MONITOR_POLICY,
      ...monitorPolicy,
    })

    const monitorPlatformSelfObservation =
      (entryMap.get('monitor-platform-self-observation') as Partial<MonitorPlatformSelfObservationGroup>) ?? {}
    setMonitorPlatformSelfObservationForm({
      ...DEFAULT_MONITOR_PLATFORM_SELF_OBSERVATION,
      ...monitorPlatformSelfObservation,
    })

    const monitorManagedCollectorPolicy =
      (entryMap.get('monitor-managed-collector-policy') as Partial<MonitorManagedCollectorPolicyGroup>) ?? {}
    setMonitorManagedCollectorPolicyForm({
      ...DEFAULT_MONITOR_MANAGED_COLLECTOR_POLICY,
      ...monitorManagedCollectorPolicy,
    })
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

  const saveMonitorScheduling = async () => {
    setMonitorSchedulingSaving(true)
    setMonitorSchedulingErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('monitor-scheduling'), {
        method: 'PATCH',
        body: monitorSchedulingForm,
      })) as { value?: Partial<MonitorSchedulingGroup> }
      setMonitorSchedulingForm({
        ...DEFAULT_MONITOR_SCHEDULING,
        ...(res.value ?? monitorSchedulingForm),
      })
      showToast('Monitor scheduling saved')
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 422) {
        const bag =
          err.response?.errors && typeof err.response.errors === 'object'
            ? (err.response.errors as Record<string, unknown>)
            : {}
        setMonitorSchedulingErrors({
          reachabilityIntervalMinutes: extractFieldError(bag.reachabilityIntervalMinutes) ?? undefined,
          metricsFreshnessIntervalMinutes:
            extractFieldError(bag.metricsFreshnessIntervalMinutes) ?? undefined,
          controlReachabilityIntervalMinutes:
            extractFieldError(bag.controlReachabilityIntervalMinutes) ?? undefined,
          runtimeSnapshotIntervalMinutes:
            extractFieldError(bag.runtimeSnapshotIntervalMinutes) ?? undefined,
          credentialSweepIntervalMinutes:
            extractFieldError(bag.credentialSweepIntervalMinutes) ?? undefined,
          appHealthIntervalMinutes: extractFieldError(bag.appHealthIntervalMinutes) ?? undefined,
          factsPullIntervalMinutes: extractFieldError(bag.factsPullIntervalMinutes) ?? undefined,
        })
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setMonitorSchedulingSaving(false)
    }
  }

  const saveMonitorPolicy = async () => {
    setMonitorPolicySaving(true)
    setMonitorPolicyErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('monitor-policy'), {
        method: 'PATCH',
        body: monitorPolicyForm,
      })) as { value?: Partial<MonitorPolicyGroup> }
      setMonitorPolicyForm({
        ...DEFAULT_MONITOR_POLICY,
        ...(res.value ?? monitorPolicyForm),
      })
      showToast('Monitor policy saved')
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 422) {
        const bag =
          err.response?.errors && typeof err.response.errors === 'object'
            ? (err.response.errors as Record<string, unknown>)
            : {}
        setMonitorPolicyErrors({
          metricsFreshnessLookbackSeconds:
            extractFieldError(bag.metricsFreshnessLookbackSeconds) ?? undefined,
          metricsStaleSeconds: extractFieldError(bag.metricsStaleSeconds) ?? undefined,
          metricsMissingSeconds: extractFieldError(bag.metricsMissingSeconds) ?? undefined,
          controlProbeTimeoutSeconds:
            extractFieldError(bag.controlProbeTimeoutSeconds) ?? undefined,
          factsPullTimeoutSeconds: extractFieldError(bag.factsPullTimeoutSeconds) ?? undefined,
          runtimePullTimeoutSeconds: extractFieldError(bag.runtimePullTimeoutSeconds) ?? undefined,
          factsPullConcurrency: extractFieldError(bag.factsPullConcurrency) ?? undefined,
          runtimePullConcurrency: extractFieldError(bag.runtimePullConcurrency) ?? undefined,
        })
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setMonitorPolicySaving(false)
    }
  }

  const saveMonitorPlatformSelfObservation = async () => {
    setMonitorPlatformSelfObservationSaving(true)
    setMonitorPlatformSelfObservationErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('monitor-platform-self-observation'), {
        method: 'PATCH',
        body: monitorPlatformSelfObservationForm,
      })) as { value?: Partial<MonitorPlatformSelfObservationGroup> }
      setMonitorPlatformSelfObservationForm({
        ...DEFAULT_MONITOR_PLATFORM_SELF_OBSERVATION,
        ...(res.value ?? monitorPlatformSelfObservationForm),
      })
      showToast('Platform self-observation saved')
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 422) {
        const bag =
          err.response?.errors && typeof err.response.errors === 'object'
            ? (err.response.errors as Record<string, unknown>)
            : {}
        setMonitorPlatformSelfObservationErrors({
          platformObserverIntervalSeconds:
            extractFieldError(bag.platformObserverIntervalSeconds) ?? undefined,
          platformSchedulerStaleThresholdSeconds:
            extractFieldError(bag.platformSchedulerStaleThresholdSeconds) ?? undefined,
          enableHostTelemetry: extractFieldError(bag.enableHostTelemetry) ?? undefined,
          enableContainerTelemetry: extractFieldError(bag.enableContainerTelemetry) ?? undefined,
        })
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setMonitorPlatformSelfObservationSaving(false)
    }
  }

  const saveMonitorManagedCollectorPolicy = async () => {
  setMonitorManagedCollectorPolicySaving(true)
  setMonitorManagedCollectorPolicyErrors({})
  try {
    const res = (await pb.send(settingsEntryPath('monitor-managed-collector-policy'), {
      method: 'PATCH',
      body: monitorManagedCollectorPolicyForm,
    })) as { value?: Partial<MonitorManagedCollectorPolicyGroup> }
    setMonitorManagedCollectorPolicyForm({
      ...DEFAULT_MONITOR_MANAGED_COLLECTOR_POLICY,
      ...(res.value ?? monitorManagedCollectorPolicyForm),
    })
    showToast('Managed collector policy saved')
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 422) {
      const bag =
        err.response?.errors && typeof err.response.errors === 'object'
          ? (err.response.errors as Record<string, unknown>)
          : {}
      setMonitorManagedCollectorPolicyErrors({
        collectionIntervalSeconds: extractFieldError(bag.collectionIntervalSeconds) ?? undefined,
        flushIntervalSeconds: extractFieldError(bag.flushIntervalSeconds) ?? undefined,
        metricBatchSize: extractFieldError(bag.metricBatchSize) ?? undefined,
        metricBufferLimit: extractFieldError(bag.metricBufferLimit) ?? undefined,
        collectionJitterSeconds: extractFieldError(bag.collectionJitterSeconds) ?? undefined,
        flushJitterSeconds: extractFieldError(bag.flushJitterSeconds) ?? undefined,
      })
    }
    showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
  } finally {
    setMonitorManagedCollectorPolicySaving(false)
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
    monitorSchedulingForm,
    monitorSchedulingSaving,
    monitorSchedulingErrors,
    setMonitorSchedulingForm,
    saveMonitorScheduling,
    monitorPolicyForm,
    monitorPolicySaving,
    monitorPolicyErrors,
    setMonitorPolicyForm,
    saveMonitorPolicy,
    monitorPlatformSelfObservationForm,
    monitorPlatformSelfObservationSaving,
    monitorPlatformSelfObservationErrors,
    setMonitorPlatformSelfObservationForm,
    saveMonitorPlatformSelfObservation,
    monitorManagedCollectorPolicyForm,
    monitorManagedCollectorPolicySaving,
    monitorManagedCollectorPolicyErrors,
    setMonitorManagedCollectorPolicyForm,
    saveMonitorManagedCollectorPolicy,
    hydrateSystemEntries,
  }
}
