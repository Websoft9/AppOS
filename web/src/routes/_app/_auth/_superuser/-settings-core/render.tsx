import {
  DeployPreflightSection,
  IacFilesSection,
  ProxySection,
  SecretsSection,
  SpaceQuotaSection,
  TopicsSection,
  ConnectSftpSection,
  ConnectTerminalSection,
  TunnelSection,
} from '../-settings-sections/workspace-simple-sections'
import { DockerMirrorsSection } from '../-settings-sections/workspace-list-sections'
import { ConnectorReferenceSection } from '../-settings-sections/shared'
import { AISettingsSection } from '../-settings-sections/ai-section'
import {
  BasicSection,
  BrandingSection,
  LogsSection,
  S3Section,
} from '../-settings-sections/system-sections'
import { type SettingsPageController } from '../-settings-controller'
import { renderActiveDomainSection } from './domains'
import {
  AI_SECTION_IDS,
  BASIC_SECTION_IDS,
  BRANDING_SECTION_IDS,
  DEPLOY_PREFLIGHT_SECTION_IDS,
  DOCKER_SECTION_IDS,
  IAC_FILES_SECTION_IDS,
  LOGS_SECTION_IDS,
  PROXY_SECTION_IDS,
  S3_SECTION_IDS,
  SECRETS_POLICY_SECTION_IDS,
  SMTP_SECTION_IDS,
  SPACE_SECTION_IDS,
  TERMINAL_SECTION_IDS,
  TOPIC_SECTION_IDS,
  TUNNEL_SECTION_IDS,
} from './section-ids'
import { connectorSectionDescription, findSchemaEntry } from './schema-helpers'

type RegisteredSectionRenderOptions = {
  onOpenHelp?: () => void
  parseExtListInput?: (value: string) => string[]
}

type RegisteredSectionRenderer = {
  matchesActiveSection: (activeSection: string) => boolean
  render: (
    controller: SettingsPageController,
    options?: RegisteredSectionRenderOptions
  ) => React.ReactNode | null
}

function matchesAnySection(activeSection: string, sectionIds: string[]) {
  return sectionIds.includes(activeSection)
}

function createRegisteredRenderer({
  sectionIds,
  render,
}: {
  sectionIds: string[]
  render: (
    controller: SettingsPageController,
    options?: RegisteredSectionRenderOptions
  ) => React.ReactNode | null
}): RegisteredSectionRenderer {
  return {
    matchesActiveSection: activeSection => matchesAnySection(activeSection, sectionIds),
    render,
  }
}

function renderTerminalSection(
  controller: SettingsPageController,
  _options?: RegisteredSectionRenderOptions
) {
  const terminalEntry = findSchemaEntry(controller, 'connect-terminal')
  const sftpEntry = findSchemaEntry(controller, 'connect-sftp')
  if (!terminalEntry && !sftpEntry) {
    return null
  }

  return (
    <div className="space-y-4">
      {terminalEntry ? (
        <ConnectTerminalSection
          entry={terminalEntry}
          form={controller.connectTerminalForm}
          errors={controller.connectTerminalErrors}
          saving={controller.connectTerminalSaving}
          setForm={controller.setConnectTerminalForm}
          save={controller.saveConnectTerminal}
        />
      ) : null}
      {sftpEntry ? (
        <ConnectSftpSection
          entry={sftpEntry}
          form={controller.connectSftpForm}
          errors={controller.connectSftpErrors}
          saving={controller.connectSftpSaving}
          setForm={controller.setConnectSftpForm}
          save={controller.saveConnectSftp}
        />
      ) : null}
    </div>
  )
}

function renderDockerSection(
  controller: SettingsPageController,
  options?: RegisteredSectionRenderOptions
) {
  const mirrorsEntry = findSchemaEntry(controller, 'docker-mirror')
  if (!mirrorsEntry) {
    return null
  }

  return (
    <DockerMirrorsSection
      mirrors={controller.mirrors}
      allowInsecureRegistries={controller.allowInsecureRegistries}
      mirrorsSaving={controller.mirrorsSaving}
      setMirrors={controller.setMirrors}
      setAllowInsecureRegistries={controller.setAllowInsecureRegistries}
      saveDockerMirrors={controller.saveDockerMirrors}
      onOpenHelp={options?.onOpenHelp}
    />
  )
}

function renderProxySection(
  controller: SettingsPageController,
  options?: RegisteredSectionRenderOptions
) {
  return (
    <ProxySection
      proxyForm={controller.proxyForm}
      proxySaving={controller.proxySaving}
      setProxyForm={controller.setProxyForm}
      saveProxy={controller.saveProxy}
      onOpenHelp={options?.onOpenHelp}
    />
  )
}

function renderAISection(controller: SettingsPageController, _options?: RegisteredSectionRenderOptions) {
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
}

function renderSMTPSection(
  controller: SettingsPageController,
  _options?: RegisteredSectionRenderOptions
) {
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
}

function renderDeployPreflightSection(
  controller: SettingsPageController,
  _options?: RegisteredSectionRenderOptions
) {
  const entry = findSchemaEntry(controller, 'deploy-preflight')
  if (!entry) {
    return null
  }

  return (
    <DeployPreflightSection
      entry={entry}
      form={controller.deployPreflightForm}
      errors={controller.deployPreflightErrors}
      saving={controller.deployPreflightSaving}
      setForm={controller.setDeployPreflightForm}
      save={controller.saveDeployPreflight}
    />
  )
}

function renderIacFilesSection(
  controller: SettingsPageController,
  _options?: RegisteredSectionRenderOptions
) {
  const entry = findSchemaEntry(controller, 'iac-files')
  if (!entry) {
    return null
  }

  return (
    <IacFilesSection
      entry={entry}
      form={controller.iacFilesForm}
      errors={controller.iacFilesErrors}
      saving={controller.iacFilesSaving}
      setForm={controller.setIacFilesForm}
      save={controller.saveIacFiles}
    />
  )
}

function renderTunnelPortRangeSection(
  controller: SettingsPageController,
  _options?: RegisteredSectionRenderOptions
) {
  const entry = findSchemaEntry(controller, 'tunnel-port-range')
  if (!entry) {
    return null
  }

  return (
    <TunnelSection
      entry={entry}
      form={controller.tunnelPortRangeForm}
      errors={controller.tunnelPortRangeErrors}
      saving={controller.tunnelPortRangeSaving}
      setForm={controller.setTunnelPortRangeForm}
      save={controller.saveTunnelPortRange}
    />
  )
}

function renderBasicSection(
  controller: SettingsPageController,
  _options?: RegisteredSectionRenderOptions
) {
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
}

function renderBrandingSection(
  controller: SettingsPageController,
  _options?: RegisteredSectionRenderOptions
) {
  return (
    <BrandingSection
      appName={controller.appName}
      logoUrl={controller.logoUrl}
      wordmark={controller.wordmark}
      useLogoAsFavicon={controller.useLogoAsFavicon}
      faviconUrl={controller.faviconUrl}
      brandingSaving={controller.brandingSaving}
      setLogoMediaId={controller.setLogoMediaId}
      setLogoUrl={controller.setLogoUrl}
      setWordmark={controller.setWordmark}
      setUseLogoAsFavicon={controller.setUseLogoAsFavicon}
      setFaviconMediaId={controller.setFaviconMediaId}
      setFaviconUrl={controller.setFaviconUrl}
      saveBranding={controller.saveBranding}
    />
  )
}

function renderS3Section(controller: SettingsPageController, _options?: RegisteredSectionRenderOptions) {
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
}

function renderLogsSection(
  controller: SettingsPageController,
  _options?: RegisteredSectionRenderOptions
) {
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
}

function renderSpaceQuotaSection(
  controller: SettingsPageController,
  options?: RegisteredSectionRenderOptions
) {
  if (!options?.parseExtListInput) {
    return null
  }

  return (
    <SpaceQuotaSection
      form={controller.spaceQuotaForm}
      errors={controller.spaceQuotaErrors}
      allowExtsText={controller.allowExtsText}
      denyExtsText={controller.denyExtsText}
      disallowedFolderNamesText={controller.disallowedFolderNamesText}
      saving={controller.spaceQuotaSaving}
      parseExtListInput={options.parseExtListInput}
      setForm={controller.setSpaceQuotaForm}
      setAllowExtsText={controller.setAllowExtsText}
      setDenyExtsText={controller.setDenyExtsText}
      setDisallowedFolderNamesText={controller.setDisallowedFolderNamesText}
      save={controller.saveSpaceQuota}
    />
  )
}

function renderSecretsPolicySection(
  controller: SettingsPageController,
  _options?: RegisteredSectionRenderOptions
) {
  return (
    <SecretsSection
      secretPolicy={controller.secretPolicy}
      secretPolicyErrors={controller.secretPolicyErrors}
      secretPolicySaving={controller.secretPolicySaving}
      setSecretPolicy={controller.setSecretPolicy}
      saveSecretPolicy={controller.saveSecretPolicy}
    />
  )
}

function renderTopicsSection(
  controller: SettingsPageController,
  _options?: RegisteredSectionRenderOptions
) {
  const shareEntry = findSchemaEntry(controller, 'topic-share')
  const commentPolicyEntry = findSchemaEntry(controller, 'topic-comment-policy')
  const importPolicyEntry = findSchemaEntry(controller, 'topic-import-policy')
  if (!shareEntry || !commentPolicyEntry || !importPolicyEntry) {
    return null
  }

  return (
    <TopicsSection
      shareEntry={shareEntry}
      commentPolicyEntry={commentPolicyEntry}
      importPolicyEntry={importPolicyEntry}
      shareForm={controller.topicShareForm}
      shareErrors={controller.topicShareErrors}
      shareSaving={controller.topicShareSaving}
      setShareForm={controller.setTopicShareForm}
      saveShare={controller.saveTopicShare}
      commentPolicyForm={controller.topicCommentPolicyForm}
      commentPolicyErrors={controller.topicCommentPolicyErrors}
      commentPolicySaving={controller.topicCommentPolicySaving}
      setCommentPolicyForm={controller.setTopicCommentPolicyForm}
      saveCommentPolicy={controller.saveTopicCommentPolicy}
      importPolicyForm={controller.topicImportPolicyForm}
      importPolicyErrors={controller.topicImportPolicyErrors}
      importPolicySaving={controller.topicImportPolicySaving}
      setImportPolicyForm={controller.setTopicImportPolicyForm}
      saveImportPolicy={controller.saveTopicImportPolicy}
    />
  )
}

const registeredSectionRenderers: RegisteredSectionRenderer[] = [
  {
    matchesActiveSection: () => true,
    render: (controller, _options) => renderActiveDomainSection(controller) ?? null,
  },
  createRegisteredRenderer({ sectionIds: [...BASIC_SECTION_IDS], render: renderBasicSection }),
  createRegisteredRenderer({ sectionIds: [...BRANDING_SECTION_IDS], render: renderBrandingSection }),
  createRegisteredRenderer({ sectionIds: [...S3_SECTION_IDS], render: renderS3Section }),
  createRegisteredRenderer({ sectionIds: [...LOGS_SECTION_IDS], render: renderLogsSection }),
  createRegisteredRenderer({ sectionIds: [...SPACE_SECTION_IDS], render: renderSpaceQuotaSection }),
  createRegisteredRenderer({ sectionIds: [...TOPIC_SECTION_IDS], render: renderTopicsSection }),
  createRegisteredRenderer({
    sectionIds: [...SECRETS_POLICY_SECTION_IDS],
    render: renderSecretsPolicySection,
  }),
  createRegisteredRenderer({ sectionIds: [...TERMINAL_SECTION_IDS], render: renderTerminalSection }),
  createRegisteredRenderer({ sectionIds: [...DOCKER_SECTION_IDS], render: renderDockerSection }),
  createRegisteredRenderer({ sectionIds: [...PROXY_SECTION_IDS], render: renderProxySection }),
  createRegisteredRenderer({ sectionIds: [...AI_SECTION_IDS], render: renderAISection }),
  createRegisteredRenderer({ sectionIds: [...SMTP_SECTION_IDS], render: renderSMTPSection }),
  createRegisteredRenderer({
    sectionIds: [...DEPLOY_PREFLIGHT_SECTION_IDS],
    render: renderDeployPreflightSection,
  }),
  createRegisteredRenderer({ sectionIds: [...IAC_FILES_SECTION_IDS], render: renderIacFilesSection }),
  createRegisteredRenderer({ sectionIds: [...TUNNEL_SECTION_IDS], render: renderTunnelPortRangeSection }),
]

export function renderRegisteredSection(
  controller: SettingsPageController,
  options?: RegisteredSectionRenderOptions
) {
  for (const renderer of registeredSectionRenderers) {
    if (!renderer.matchesActiveSection(controller.activeSection)) {
      continue
    }
    const section = renderer.render(controller, options)
    if (section) {
      return section
    }
  }
  return null
}