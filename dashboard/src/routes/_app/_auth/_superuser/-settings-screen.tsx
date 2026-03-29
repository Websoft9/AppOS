import { Loader2 } from 'lucide-react'
import { parseExtListInput } from '@/lib/ext-normalize'
import { type SettingsSection } from '@/lib/settings-api'
import { sectionLabel } from './-settings-sections/shared'
import {
  BasicSection,
  LogsSection,
  S3Section,
  SmtpSection,
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
import {
  DockerMirrorsSection,
  DockerRegistriesSection,
  LlmSection,
} from './-settings-sections/workspace-list-sections'
import { type SettingsPageController } from './-settings-controller'

type SettingsScreenProps = {
  controller: SettingsPageController
}

function findSchemaEntry(controller: SettingsPageController, entryId: string) {
  return controller.schemaEntries.find(entry => entry.id === entryId)
}

function renderSection(controller: SettingsPageController) {
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
        <SmtpSection
          smtpEnabled={controller.smtpEnabled}
          smtpHost={controller.smtpHost}
          smtpPort={controller.smtpPort}
          smtpUsername={controller.smtpUsername}
          smtpPassword={controller.smtpPassword}
          smtpAuthMethod={controller.smtpAuthMethod}
          smtpTls={controller.smtpTls}
          smtpLocalName={controller.smtpLocalName}
          smtpSaving={controller.smtpSaving}
          testEmailRecipient={controller.testEmailRecipient}
          testEmailSending={controller.testEmailSending}
          setSmtpEnabled={controller.setSmtpEnabled}
          setSmtpHost={controller.setSmtpHost}
          setSmtpPort={controller.setSmtpPort}
          setSmtpUsername={controller.setSmtpUsername}
          setSmtpPassword={controller.setSmtpPassword}
          setSmtpAuthMethod={controller.setSmtpAuthMethod}
          setSmtpTls={controller.setSmtpTls}
          setSmtpLocalName={controller.setSmtpLocalName}
          setTestEmailRecipient={controller.setTestEmailRecipient}
          saveSmtp={controller.saveSmtp}
          sendTestEmail={controller.sendTestEmail}
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
    case 'connect-terminal':
      return findSchemaEntry(controller, 'connect-terminal') ? (
        <ConnectTerminalSection
          entry={findSchemaEntry(controller, 'connect-terminal')!}
          form={controller.connectTerminalForm}
          errors={controller.connectTerminalErrors}
          saving={controller.connectTerminalSaving}
          setForm={controller.setConnectTerminalForm}
          save={controller.saveConnectTerminal}
        />
      ) : null
    case 'connect-sftp':
      return findSchemaEntry(controller, 'connect-sftp') ? (
        <ConnectSftpSection
          entry={findSchemaEntry(controller, 'connect-sftp')!}
          form={controller.connectSftpForm}
          errors={controller.connectSftpErrors}
          saving={controller.connectSftpSaving}
          setForm={controller.setConnectSftpForm}
          save={controller.saveConnectSftp}
        />
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
      return (
        <DockerMirrorsSection
          mirrors={controller.mirrors}
          insecureRegs={controller.insecureRegs}
          mirrorsSaving={controller.mirrorsSaving}
          setMirrors={controller.setMirrors}
          setInsecureRegs={controller.setInsecureRegs}
          saveDockerMirrors={controller.saveDockerMirrors}
        />
      )
    case 'docker-registries':
      return (
        <DockerRegistriesSection
          dockerRegistries={controller.dockerRegistries}
          regsSaving={controller.regsSaving}
          setDockerRegistries={controller.setDockerRegistries}
          saveDockerRegistries={controller.saveDockerRegistries}
        />
      )
    case 'llm-providers':
      return (
        <LlmSection
          llmItems={controller.llmItems}
          llmSaving={controller.llmSaving}
          secretPickerItems={controller.secretPickerItems}
          llmSecretCreateOpen={controller.llmSecretCreateOpen}
          llmSecretCreateName={controller.llmSecretCreateName}
          llmSecretCreateKey={controller.llmSecretCreateKey}
          llmSecretCreateSaving={controller.llmSecretCreateSaving}
          llmSecretCreateError={controller.llmSecretCreateError}
          setLlmItems={controller.setLlmItems}
          setLlmSecretCreateOpen={controller.setLlmSecretCreateOpen}
          setLlmSecretCreateIdx={controller.setLlmSecretCreateIdx}
          setLlmSecretCreateName={controller.setLlmSecretCreateName}
          setLlmSecretCreateKey={controller.setLlmSecretCreateKey}
          setLlmSecretCreateError={controller.setLlmSecretCreateError}
          handleLlmSecretCreate={controller.handleLlmSecretCreate}
          saveLlm={controller.saveLlm}
        />
      )
    default:
      return (
        <div className="text-sm text-muted-foreground">
          No editor available for this entry.
        </div>
      )
  }
}

export function SettingsScreen({ controller }: SettingsScreenProps) {
  const groups = controller.schemaEntries.reduce<SettingsSection[]>((acc, entry) => {
    if (!acc.includes(entry.section)) {
      acc.push(entry.section)
    }
    return acc
  }, [])

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
        <div className="flex gap-6 max-w-4xl">
          <nav className="w-44 shrink-0 space-y-4">
            {groups.map(group => (
              <div key={group}>
                <p className="px-3 mb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {sectionLabel(group)}
                </p>
                <div className="space-y-0.5">
                  {controller.schemaEntries
                    .filter(entry => entry.section === group)
                    .map(item => (
                      <button
                        key={item.id}
                        onClick={() => controller.setActiveSection(item.id)}
                        className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                          controller.activeSection === item.id
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

          <div className="flex-1 min-w-0">{renderSection(controller)}</div>
        </div>
      )}
    </div>
  )
}
