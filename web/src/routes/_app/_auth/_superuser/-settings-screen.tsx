import { useState } from 'react'
import { Info, Loader2, X } from 'lucide-react'
import { parseExtListInput } from '@/lib/ext-normalize'
import { type SettingsSection } from '@/lib/settings-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConnectorReferenceSection, sectionLabel } from './-settings-sections/shared'
import { AISettingsSection } from './-settings-sections/ai-section'
import {
  BasicSection,
  LogsSection,
  MonitorSection,
  S3Section,
} from './-settings-sections/system-sections'
import {
  ConnectSftpSection,
  ConnectTerminalSection,
  DeployPreflightSection,
  IacFilesSection,
  ProxySection,
  SecretsSection,
  SpaceQuotaSection,
  TunnelSection,
} from './-settings-sections/workspace-simple-sections'
import { DockerMirrorsSection } from './-settings-sections/workspace-list-sections'
import { type SettingsPageController } from './-settings-controller'

type SettingsScreenProps = {
  controller: SettingsPageController
}

function terminalSettingsEntries(controller: SettingsPageController) {
  return {
    terminal: findSchemaEntry(controller, 'connect-terminal'),
    sftp: findSchemaEntry(controller, 'connect-sftp'),
  }
}

function dockerSettingsEntries(controller: SettingsPageController) {
  return {
    mirrors: findSchemaEntry(controller, 'docker-mirror'),
    registries: findSchemaEntry(controller, 'docker-registries'),
  }
}

function findSchemaEntry(controller: SettingsPageController, entryId: string) {
  return controller.schemaEntries.find(entry => entry.id === entryId)
}

function connectorSectionDescription(
  controller: SettingsPageController,
  entryId: string,
  fallback: string
) {
  return findSchemaEntry(controller, entryId)?.description ?? fallback
}

function activeSectionHelp(controller: SettingsPageController) {
  switch (controller.activeSection) {
    case 'monitor':
    case 'monitor-scheduling':
    case 'monitor-policy':
    case 'monitor-platform-self-observation':
    case 'monitor-managed-collector-policy':
      return {
        title: 'Monitor',
        description:
          'Tune monitoring cadence, freshness rules, platform self-observation, and managed collector behavior in one place.',
      }
    case 'terminal':
    case 'connect-terminal':
    case 'connect-sftp':
      return {
        title: 'Terminal',
        description:
          'Control terminal and SFTP session limits without leaving the shared settings surface.',
      }
    case 'docker-mirror':
    case 'docker-registries':
      return {
        title: 'Docker',
        description:
          'Configure AppOS image pull acceleration and review registry connectors used for authenticated pulls.',
      }
    case 'ai':
      return {
        title: 'AI',
        description:
          'Choose the platform default AI model and manage provider records from the same workflow.',
      }
    default: {
      const entry = findSchemaEntry(controller, controller.activeSection)
      return {
        title:
          controller.activeSection === 'space-quota'
            ? 'Space'
            : entry?.title ?? 'Settings',
        description:
          entry?.description ??
          'Select a setting from the menu to review its current purpose and controls.',
      }
    }
  }
}

function SettingsHelpPanel({
  title,
  description,
  onClose,
}: {
  title: string
  description: string
  onClose: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 text-muted-foreground">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            <span className="text-sm font-medium">Help for:</span>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground">
          Click a setting in the menu to update this help panel.
        </p>
      </CardContent>
    </Card>
  )
}

function isMonitorEntry(entryId: string) {
  return (
    entryId === 'monitor-scheduling' ||
    entryId === 'monitor-policy' ||
	entryId === 'monitor-platform-self-observation' ||
	entryId === 'monitor-managed-collector-policy'
  )
}

function navigationItems(controller: SettingsPageController, group: SettingsSection) {
  const items = controller.schemaEntries.filter(entry => entry.section === group)
  if (group !== 'system') {
    const result: Array<{ id: string; title: string }> = []
    let terminalAdded = false
    let dockerAdded = false

    for (const item of items) {
      if (item.id === 'space-quota') {
        result.push({ id: item.id, title: 'Space' })
        continue
      }

      if (item.id === 'connect-terminal' || item.id === 'connect-sftp') {
        if (!terminalAdded) {
          result.push({ id: 'terminal', title: 'Terminal' })
          terminalAdded = true
        }
        continue
      }

      if (item.id === 'docker-mirror' || item.id === 'docker-registries') {
        if (!dockerAdded) {
          result.push({ id: 'docker-mirror', title: 'Docker' })
          dockerAdded = true
        }
        continue
      }

      result.push({ id: item.id, title: item.title })
    }

    return result
  }

  const result: Array<{ id: string; title: string }> = []
  let monitorAdded = false
  let dockerAdded = false
  for (const item of items) {
    if (isMonitorEntry(item.id)) {
      if (!monitorAdded) {
        result.push({ id: 'monitor', title: 'Monitor' })
        monitorAdded = true
      }
      continue
    }

    if (item.id === 'docker-mirror' || item.id === 'docker-registries') {
      if (!dockerAdded) {
        result.push({ id: 'docker-mirror', title: 'Docker' })
        dockerAdded = true
      }
      continue
    }

    result.push({ id: item.id, title: item.title })
  }
  return result
}

function renderSection(controller: SettingsPageController, options?: { onOpenHelp?: () => void }) {
  const terminalEntries = terminalSettingsEntries(controller)
  const dockerEntries = dockerSettingsEntries(controller)

  switch (controller.activeSection) {
    case 'basic':
      return (
        <BasicSection
          appName={controller.appName}
          appURL={controller.appURL}
          appSaving={controller.appSaving}
          setAppName={controller.setAppName}
          setAppURL={controller.setAppURL}
          saveApp={controller.saveApp}
        />
      )
    case 'smtp':
      return (
        <ConnectorReferenceSection
          title="SMTP"
          description={connectorSectionDescription(
            controller,
            'smtp',
            'Outgoing email delivery is managed as reusable connectors.'
          )}
          connectorKinds="SMTP connectors"
        />
      )
    case 's3':
      return (
        <S3Section
          s3Enabled={controller.s3Enabled}
          s3Bucket={controller.s3Bucket}
          s3Region={controller.s3Region}
          s3Endpoint={controller.s3Endpoint}
          s3AccessKey={controller.s3AccessKey}
          s3Secret={controller.s3Secret}
          s3ForcePathStyle={controller.s3ForcePathStyle}
          s3Saving={controller.s3Saving}
          s3Testing={controller.s3Testing}
          setS3Enabled={controller.setS3Enabled}
          setS3Bucket={controller.setS3Bucket}
          setS3Region={controller.setS3Region}
          setS3Endpoint={controller.setS3Endpoint}
          setS3AccessKey={controller.setS3AccessKey}
          setS3Secret={controller.setS3Secret}
          setS3ForcePathStyle={controller.setS3ForcePathStyle}
          saveS3={controller.saveS3}
          testS3={controller.testS3}
        />
      )
    case 'logs':
      return (
        <LogsSection
          logsMaxDays={controller.logsMaxDays}
          logsMinLevel={controller.logsMinLevel}
          logsLogIP={controller.logsLogIP}
          logsLogAuthId={controller.logsLogAuthId}
          logsSaving={controller.logsSaving}
          setLogsMaxDays={controller.setLogsMaxDays}
          setLogsMinLevel={controller.setLogsMinLevel}
          setLogsLogIP={controller.setLogsLogIP}
          setLogsLogAuthId={controller.setLogsLogAuthId}
          saveLogs={controller.saveLogs}
        />
      )
    case 'monitor':
    case 'monitor-scheduling':
    case 'monitor-policy':
    case 'monitor-platform-self-observation':
    case 'monitor-managed-collector-policy':
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
    case 'space-quota':
      return (
        <SpaceQuotaSection
          form={controller.spaceQuotaForm}
          errors={controller.spaceQuotaErrors}
          allowExtsText={controller.allowExtsText}
          denyExtsText={controller.denyExtsText}
          disallowedFolderNamesText={controller.disallowedFolderNamesText}
          saving={controller.spaceQuotaSaving}
          parseExtListInput={parseExtListInput}
          setForm={controller.setSpaceQuotaForm}
          setAllowExtsText={controller.setAllowExtsText}
          setDenyExtsText={controller.setDenyExtsText}
          setDisallowedFolderNamesText={controller.setDisallowedFolderNamesText}
          save={controller.saveSpaceQuota}
        />
      )
    case 'terminal':
    case 'connect-terminal':
    case 'connect-sftp':
      return terminalEntries.terminal || terminalEntries.sftp ? (
        <div className="space-y-4">
          {terminalEntries.terminal ? (
            <ConnectTerminalSection
              entry={terminalEntries.terminal}
              form={controller.connectTerminalForm}
              errors={controller.connectTerminalErrors}
              saving={controller.connectTerminalSaving}
              setForm={controller.setConnectTerminalForm}
              save={controller.saveConnectTerminal}
            />
          ) : null}
          {terminalEntries.sftp ? (
            <ConnectSftpSection
              entry={terminalEntries.sftp}
              form={controller.connectSftpForm}
              errors={controller.connectSftpErrors}
              saving={controller.connectSftpSaving}
              setForm={controller.setConnectSftpForm}
              save={controller.saveConnectSftp}
            />
          ) : null}
        </div>
      ) : null
    case 'deploy-preflight':
      return findSchemaEntry(controller, 'deploy-preflight') ? (
        <DeployPreflightSection
          entry={findSchemaEntry(controller, 'deploy-preflight')!}
          form={controller.deployPreflightForm}
          errors={controller.deployPreflightErrors}
          saving={controller.deployPreflightSaving}
          setForm={controller.setDeployPreflightForm}
          save={controller.saveDeployPreflight}
        />
      ) : null
    case 'iac-files':
      return findSchemaEntry(controller, 'iac-files') ? (
        <IacFilesSection
          entry={findSchemaEntry(controller, 'iac-files')!}
          form={controller.iacFilesForm}
          errors={controller.iacFilesErrors}
          saving={controller.iacFilesSaving}
          setForm={controller.setIacFilesForm}
          save={controller.saveIacFiles}
        />
      ) : null
    case 'tunnel-port-range':
      return findSchemaEntry(controller, 'tunnel-port-range') ? (
        <TunnelSection
          entry={findSchemaEntry(controller, 'tunnel-port-range')!}
          form={controller.tunnelPortRangeForm}
          errors={controller.tunnelPortRangeErrors}
          saving={controller.tunnelPortRangeSaving}
          setForm={controller.setTunnelPortRangeForm}
          save={controller.saveTunnelPortRange}
        />
      ) : null
    case 'secrets-policy':
      return (
        <SecretsSection
          secretPolicy={controller.secretPolicy}
          secretPolicyErrors={controller.secretPolicyErrors}
          secretPolicySaving={controller.secretPolicySaving}
          setSecretPolicy={controller.setSecretPolicy}
          saveSecretPolicy={controller.saveSecretPolicy}
        />
      )
    case 'proxy-network':
      return (
        <ProxySection
          proxyNetwork={controller.proxyNetwork}
          proxyForm={controller.proxyForm}
          proxySaving={controller.proxySaving}
          setProxyForm={controller.setProxyForm}
          saveProxy={controller.saveProxy}
        />
      )
    case 'docker-mirror':
    case 'docker-registries':
      return (
        <div className="space-y-4">
          {dockerEntries.mirrors ? (
            <DockerMirrorsSection
              mirrors={controller.mirrors}
              allowInsecureRegistries={controller.allowInsecureRegistries}
              mirrorsSaving={controller.mirrorsSaving}
              setMirrors={controller.setMirrors}
              setAllowInsecureRegistries={controller.setAllowInsecureRegistries}
              saveDockerMirrors={controller.saveDockerMirrors}
              onOpenHelp={options?.onOpenHelp}
            />
          ) : null}
          {dockerEntries.registries ? (
            <ConnectorReferenceSection
              title="Docker Registries"
              description={connectorSectionDescription(
                controller,
                'docker-registries',
                'Private registry access is managed as reusable connectors.'
              )}
              connectorKinds="registry connectors"
            />
          ) : null}
        </div>
      )
    case 'ai':
      return (
        <AISettingsSection
          title="AI"
          description={connectorSectionDescription(
            controller,
            'ai',
            'Choose the platform default AI model and create new AI providers without leaving Settings.'
          )}
          showToast={controller.showToast}
        />
      )
    default:
      return (
        <div className="text-sm text-muted-foreground">No editor available for this entry.</div>
      )
  }
}

export function SettingsScreen({ controller }: SettingsScreenProps) {
  const [helpOpen, setHelpOpen] = useState(false)
  const groups = controller.schemaEntries.reduce<SettingsSection[]>((acc, entry) => {
    if (!acc.includes(entry.section)) {
      acc.push(entry.section)
    }
    return acc
  }, [])
  const help = activeSectionHelp(controller)

  return (
    <div className="p-6">
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {controller.toasts.map(t => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded-md shadow text-sm text-white ${t.ok ? 'bg-green-600' : 'bg-red-600'}`}
          >
            {t.msg}
          </div>
        ))}
      </div>

      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {controller.pbLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div
          className={`grid gap-6 max-w-[1360px] ${
            helpOpen
              ? 'lg:grid-cols-[200px_minmax(0,760px)] xl:grid-cols-[220px_minmax(0,820px)] 2xl:grid-cols-[220px_minmax(0,820px)_320px]'
              : 'lg:grid-cols-[200px_minmax(0,760px)] xl:grid-cols-[220px_minmax(0,820px)]'
          }`}
        >
          <nav className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            {groups.map(group => (
              <div key={group}>
                <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {sectionLabel(group)}
                </p>
                <div className="space-y-0.5">
                  {navigationItems(controller, group).map(item => (
                      <button
                        key={item.id}
                        onClick={() => controller.setActiveSection(item.id)}
                        className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                          controller.activeSection === item.id ||
                          (item.id === 'terminal' &&
                            (controller.activeSection === 'connect-terminal' ||
                              controller.activeSection === 'connect-sftp')) ||
                          (item.id === 'docker-mirror' &&
                            (controller.activeSection === 'docker-mirror' ||
                              controller.activeSection === 'docker-registries')) ||
                          (item.id === 'monitor' && isMonitorEntry(controller.activeSection))
                            ? 'bg-accent text-accent-foreground font-medium'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                        }`}
                      >
                        {item.title}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="min-w-0 lg:max-w-[760px] xl:max-w-[820px] space-y-4">
            {renderSection(controller, { onOpenHelp: () => setHelpOpen(true) })}
          </div>

          {helpOpen ? (
            <div className="min-w-0 lg:col-start-2 lg:row-start-2 2xl:col-start-3 2xl:row-start-1 2xl:sticky 2xl:top-6 2xl:self-start">
              <SettingsHelpPanel
                title={help.title}
                description={help.description}
                onClose={() => setHelpOpen(false)}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
