import { MonitorSection } from './-settings-sections/monitor-section'
import { type SettingsPageController } from './-settings-controller'
import { MONITOR_SECTION_IDS, matchesSectionIds } from './-settings-core/section-ids'
import { findSchemaEntry } from './-settings-core/schema-helpers'

export function isMonitorSectionId(sectionId: string) {
  return matchesSectionIds(sectionId, MONITOR_SECTION_IDS)
}

export function getMonitorSectionHelp(controller: SettingsPageController) {
  if (!isMonitorSectionId(controller.activeSection)) {
    return null
  }

  return {
    title: 'Monitor',
    description:
      'Tune monitoring cadence, freshness rules, platform self-observation, and managed collector behavior in one place.',
  }
}

export function renderMonitorSection(controller: SettingsPageController) {
  if (!isMonitorSectionId(controller.activeSection)) {
    return null
  }

  return (
    <MonitorSection
      schedulingEntry={findSchemaEntry(controller, 'monitor-scheduling')}
      schedulingForm={controller.monitorSchedulingForm}
      schedulingErrors={controller.monitorSchedulingErrors}
      schedulingSaving={controller.monitorSchedulingSaving}
      setSchedulingForm={controller.setMonitorSchedulingForm}
      saveScheduling={controller.saveMonitorScheduling}
      policyEntry={findSchemaEntry(controller, 'monitor-policy')}
      policyForm={controller.monitorPolicyForm}
      policyErrors={controller.monitorPolicyErrors}
      policySaving={controller.monitorPolicySaving}
      setPolicyForm={controller.setMonitorPolicyForm}
      savePolicy={controller.saveMonitorPolicy}
      platformSelfObservationEntry={findSchemaEntry(
        controller,
        'monitor-platform-self-observation'
      )}
      platformSelfObservationForm={controller.monitorPlatformSelfObservationForm}
      platformSelfObservationErrors={controller.monitorPlatformSelfObservationErrors}
      platformSelfObservationSaving={controller.monitorPlatformSelfObservationSaving}
      setPlatformSelfObservationForm={controller.setMonitorPlatformSelfObservationForm}
      savePlatformSelfObservation={controller.saveMonitorPlatformSelfObservation}
      managedCollectorPolicyEntry={findSchemaEntry(controller, 'monitor-managed-collector-policy')}
      managedCollectorPolicyForm={controller.monitorManagedCollectorPolicyForm}
      managedCollectorPolicyErrors={controller.monitorManagedCollectorPolicyErrors}
      managedCollectorPolicySaving={controller.monitorManagedCollectorPolicySaving}
      setManagedCollectorPolicyForm={controller.setMonitorManagedCollectorPolicyForm}
      saveManagedCollectorPolicy={controller.saveMonitorManagedCollectorPolicy}
    />
  )
}