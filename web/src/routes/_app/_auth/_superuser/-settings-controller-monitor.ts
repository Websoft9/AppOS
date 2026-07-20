import { useCallback, useState } from 'react'
import { ClientResponseError } from 'pocketbase'
import { pb } from '@/lib/pb'
import { settingsEntryPath } from '@/lib/settings-api'
import {
  DEFAULT_MONITOR_MANAGED_COLLECTOR_POLICY,
  DEFAULT_MONITOR_POLICY,
  DEFAULT_MONITOR_PLATFORM_SELF_OBSERVATION,
  DEFAULT_MONITOR_SCHEDULING,
  type MonitorManagedCollectorPolicyGroup,
  type MonitorPolicyGroup,
  type MonitorPlatformSelfObservationGroup,
  type MonitorSchedulingGroup,
} from './-settings-sections/monitor-types'
import { extractFieldError, type ShowToast } from './-settings-controller-shared'

export function useMonitorSettingsController(showToast: ShowToast) {
  const [monitorSchedulingForm, setMonitorSchedulingForm] = useState<MonitorSchedulingGroup>(
    DEFAULT_MONITOR_SCHEDULING
  )
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

  const hydrateMonitorEntries = useCallback((entryMap: Map<string, unknown>) => {
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
      (entryMap.get(
        'monitor-platform-self-observation'
      ) as Partial<MonitorPlatformSelfObservationGroup>) ?? {}
    setMonitorPlatformSelfObservationForm({
      ...DEFAULT_MONITOR_PLATFORM_SELF_OBSERVATION,
      ...monitorPlatformSelfObservation,
    })

    const monitorManagedCollectorPolicy =
      (entryMap.get(
        'monitor-managed-collector-policy'
      ) as Partial<MonitorManagedCollectorPolicyGroup>) ?? {}
    setMonitorManagedCollectorPolicyForm({
      ...DEFAULT_MONITOR_MANAGED_COLLECTOR_POLICY,
      ...monitorManagedCollectorPolicy,
    })
  }, [])

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
          reachabilityIntervalMinutes:
            extractFieldError(bag.reachabilityIntervalMinutes) ?? undefined,
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
          reachabilityProbeTimeoutMs:
            extractFieldError(bag.reachabilityProbeTimeoutMs) ?? undefined,
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
    hydrateMonitorEntries,
  }
}
