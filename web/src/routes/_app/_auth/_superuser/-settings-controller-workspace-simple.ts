import { useCallback, useState } from 'react'
import { ClientResponseError } from 'pocketbase'
import { pb } from '@/lib/pb'
import { parseExtListInput } from '@/lib/ext-normalize'
import { settingsEntryPath } from '@/lib/settings-api'
import {
  DEFAULT_SECRET_POLICY,
  normalizeSecretPolicy,
  type SecretPolicy,
} from '@/lib/secrets-policy'
import {
  DEFAULT_CONNECT_SFTP,
  DEFAULT_CONNECT_TERMINAL,
  DEFAULT_DEPLOY_GIT_DEFAULTS,
  DEFAULT_DEPLOY_PREFLIGHT,
  DEFAULT_DEPLOY_RUNTIME,
  DEFAULT_IAC_FILES,
  DEFAULT_SPACE_QUOTA,
  DEFAULT_TOPIC_COMMENT_POLICY,
  DEFAULT_TOPIC_IMPORT_POLICY,
  DEFAULT_TOPIC_SHARE,
  DEFAULT_TUNNEL_PORT_RANGE,
  EMPTY_PROXY,
  EMPTY_PROXY_CONSUMERS,
  EMPTY_PROXY_REMOTE_SHELL,
  type ConnectSftpGroup,
  type ConnectTerminalGroup,
  type DeployGitDefaultsGroup,
  type DeployPreflightGroup,
  type DeployRuntimeGroup,
  type IacFilesGroup,
  type ProxyConsumerDefinition,
  type ProxyConsumerItem,
  type ProxyConsumersSettings,
  type ProxyNetwork,
  type ProxyRemoteShellOverride,
  type ProxyRemoteShellSettings,
  type ProxySource,
  type SpaceQuota,
  type TopicCommentPolicy,
  type TopicImportPolicy,
  type TopicShare,
  type TunnelPortRange,
} from './-settings-sections/types'
import {
  extractFieldError,
  parseConnectTerminalApiErrors,
  parseTunnelPortRangeApiErrors,
  type ShowToast,
} from './-settings-controller-shared'

export function useWorkspaceSimpleSettingsController(showToast: ShowToast) {
  const [spaceQuotaForm, setSpaceQuotaForm] = useState<SpaceQuota>(DEFAULT_SPACE_QUOTA)
  const [spaceQuotaSaving, setSpaceQuotaSaving] = useState(false)
  const [spaceQuotaErrors, setSpaceQuotaErrors] = useState<
    Partial<Record<keyof SpaceQuota, string>>
  >({})
  const [allowExtsText, setAllowExtsText] = useState('')
  const [denyExtsText, setDenyExtsText] = useState('')
  const [disallowedFolderNamesText, setDisallowedFolderNamesText] = useState('')

  const [connectTerminalForm, setConnectTerminalForm] =
    useState<ConnectTerminalGroup>(DEFAULT_CONNECT_TERMINAL)
  const [connectTerminalSaving, setConnectTerminalSaving] = useState(false)
  const [connectTerminalErrors, setConnectTerminalErrors] = useState<
    Partial<Record<keyof ConnectTerminalGroup, string>>
  >({})

  const [connectSftpForm, setConnectSftpForm] = useState<ConnectSftpGroup>(DEFAULT_CONNECT_SFTP)
  const [connectSftpSaving, setConnectSftpSaving] = useState(false)
  const [connectSftpErrors, setConnectSftpErrors] = useState<
    Partial<Record<keyof ConnectSftpGroup, string>>
  >({})

  const [topicShareForm, setTopicShareForm] = useState<TopicShare>(DEFAULT_TOPIC_SHARE)
  const [topicShareSaving, setTopicShareSaving] = useState(false)
  const [topicShareErrors, setTopicShareErrors] = useState<
    Partial<Record<keyof TopicShare, string>>
  >({})

  const [topicCommentPolicyForm, setTopicCommentPolicyForm] = useState<TopicCommentPolicy>(
    DEFAULT_TOPIC_COMMENT_POLICY
  )
  const [topicCommentPolicySaving, setTopicCommentPolicySaving] = useState(false)
  const [topicCommentPolicyErrors, setTopicCommentPolicyErrors] = useState<
    Partial<Record<keyof TopicCommentPolicy, string>>
  >({})

  const [topicImportPolicyForm, setTopicImportPolicyForm] = useState<TopicImportPolicy>(
    DEFAULT_TOPIC_IMPORT_POLICY
  )
  const [topicImportPolicySaving, setTopicImportPolicySaving] = useState(false)
  const [topicImportPolicyErrors, setTopicImportPolicyErrors] = useState<
    Partial<Record<keyof TopicImportPolicy, string>>
  >({})

  const [deployPreflightForm, setDeployPreflightForm] =
    useState<DeployPreflightGroup>(DEFAULT_DEPLOY_PREFLIGHT)
  const [deployPreflightSaving, setDeployPreflightSaving] = useState(false)
  const [deployPreflightErrors, setDeployPreflightErrors] = useState<
    Partial<Record<keyof DeployPreflightGroup, string>>
  >({})

  const [deployRuntimeForm, setDeployRuntimeForm] =
    useState<DeployRuntimeGroup>(DEFAULT_DEPLOY_RUNTIME)
  const [deployRuntimeSaving, setDeployRuntimeSaving] = useState(false)
  const [deployRuntimeErrors, setDeployRuntimeErrors] = useState<
    Partial<Record<keyof DeployRuntimeGroup, string>>
  >({})

  const [deployGitDefaultsForm, setDeployGitDefaultsForm] = useState<DeployGitDefaultsGroup>(
    DEFAULT_DEPLOY_GIT_DEFAULTS
  )
  const [deployGitDefaultsSaving, setDeployGitDefaultsSaving] = useState(false)
  const [deployGitDefaultsErrors, setDeployGitDefaultsErrors] = useState<
    Partial<Record<keyof DeployGitDefaultsGroup, string>>
  >({})

  const [iacFilesForm, setIacFilesForm] = useState<IacFilesGroup>(DEFAULT_IAC_FILES)
  const [iacFilesSaving, setIacFilesSaving] = useState(false)
  const [iacFilesErrors, setIacFilesErrors] = useState<
    Partial<Record<keyof IacFilesGroup, string>>
  >({})

  const [tunnelPortRangeForm, setTunnelPortRangeForm] =
    useState<TunnelPortRange>(DEFAULT_TUNNEL_PORT_RANGE)
  const [tunnelPortRangeSaving, setTunnelPortRangeSaving] = useState(false)
  const [tunnelPortRangeErrors, setTunnelPortRangeErrors] = useState<
    Partial<Record<keyof TunnelPortRange, string>>
  >({})

  const [secretPolicy, setSecretPolicy] = useState<SecretPolicy>(DEFAULT_SECRET_POLICY)
  const [secretPolicySaving, setSecretPolicySaving] = useState(false)
  const [secretPolicyErrors, setSecretPolicyErrors] = useState<
    Partial<Record<keyof SecretPolicy, string>>
  >({})

  const [proxyNetwork, setProxyNetwork] = useState<ProxyNetwork>(EMPTY_PROXY)
  const [proxyForm, setProxyForm] = useState<ProxyNetwork>(EMPTY_PROXY)
  const [proxyConsumers, setProxyConsumers] = useState<ProxyConsumerItem[]>(
    EMPTY_PROXY_CONSUMERS.items
  )
  const [proxyConsumerDefinitions, setProxyConsumerDefinitions] = useState<
    ProxyConsumerDefinition[]
  >(EMPTY_PROXY_CONSUMERS.definitions)
  const [proxyRemoteShellOverrides, setProxyRemoteShellOverrides] = useState<
    ProxyRemoteShellOverride[]
  >(EMPTY_PROXY_REMOTE_SHELL.items)
  const [proxySavingSection, setProxySavingSection] = useState<'network' | 'consumers' | null>(null)
  const [proxyErrors, setProxyErrors] = useState<
    Partial<Record<'form' | 'consumers' | 'remoteShell' | keyof ProxyNetwork, string>>
  >({})

  const normalizeProxySource = (value: unknown): ProxySource | null => {
    if (value === 'external' || value === 'self' || value === 'none') {
      return value
    }
    return null
  }

  const normalizeProxyConsumerItem = (value: unknown): ProxyConsumerItem | null => {
    if (!value || typeof value !== 'object') return null
    const item = value as Record<string, unknown>
    const consumerKey = typeof item.consumerKey === 'string' ? item.consumerKey.trim() : ''
    const mode = typeof item.mode === 'string' ? item.mode.trim() : ''
    if (consumerKey === '' || (mode !== 'disabled' && mode !== 'always')) {
      return null
    }
    return { consumerKey, mode }
  }

  const normalizeProxyConsumerDefinition = (value: unknown): ProxyConsumerDefinition | null => {
    if (!value || typeof value !== 'object') return null
    const item = value as Record<string, unknown>
    const key = typeof item.key === 'string' ? item.key.trim() : ''
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (key === '' || title === '') return null
    const allowedModes = Array.isArray(item.allowedModes)
      ? item.allowedModes.filter(
          (entry): entry is 'disabled' | 'always' => entry === 'disabled' || entry === 'always'
        )
      : []
    return {
      key,
      title,
      description: typeof item.description === 'string' ? item.description : undefined,
      location: item.location === 'remote' ? 'remote' : 'local',
      moduleKey: typeof item.moduleKey === 'string' ? item.moduleKey : undefined,
      scope: typeof item.scope === 'string' ? item.scope : 'action',
      adapter: typeof item.adapter === 'string' ? item.adapter : 'http_client',
      trafficClass: typeof item.trafficClass === 'string' ? item.trafficClass : 'public_egress',
      support: typeof item.support === 'string' ? item.support : 'proxy_capable',
      defaultMode:
        item.defaultMode === 'disabled' || item.defaultMode === 'always'
          ? item.defaultMode
          : 'disabled',
      allowedModes,
      enrollable: Boolean(item.enrollable),
      tags: Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === 'string')
        : undefined,
    }
  }

  const normalizeProxyRemoteShellOverride = (value: unknown): ProxyRemoteShellOverride | null => {
    if (!value || typeof value !== 'object') return null
    const item = value as Record<string, unknown>
    const serverId = typeof item.serverId === 'string' ? item.serverId.trim() : ''
    const mode = typeof item.mode === 'string' ? item.mode.trim() : ''
    if (serverId === '' || (mode !== 'disabled' && mode !== 'always')) {
      return null
    }
    return { serverId, mode }
  }

  const inferProxySource = ({
    network,
    consumers,
    definitions,
    remoteShellOverrides,
  }: {
    network: ProxyNetwork
    consumers: ProxyConsumerItem[]
    definitions: ProxyConsumerDefinition[]
    remoteShellOverrides: ProxyRemoteShellOverride[]
  }): ProxySource => {
    const explicit = normalizeProxySource((network as Partial<ProxyNetwork>).source)
    if (explicit) {
      return explicit
    }

    if (
      network.enabled ||
      network.socks5ConnectorId !== '' ||
      network.httpConnectorId !== '' ||
      network.httpsConnectorId !== '' ||
      consumers.some(item => item.consumerKey !== 'remote_shell.global' && item.mode !== 'disabled')
    ) {
      return 'external'
    }

    const remoteShellDefinition = definitions.find(
      definition => definition.key === 'remote_shell.global'
    )
    const savedRemoteShellMode = consumers.find(
      item => item.consumerKey === 'remote_shell.global'
    )?.mode
    const effectiveRemoteShellMode =
      savedRemoteShellMode ?? remoteShellDefinition?.defaultMode ?? 'disabled'
    if (remoteShellOverrides.length > 0 || effectiveRemoteShellMode !== 'disabled') {
      return 'self'
    }

    return 'none'
  }

  const buildProxyNetworkPayload = (source: ProxyNetwork): ProxyNetwork => ({
    source: source.source,
    enabled:
      source.source === 'external'
        ? [source.socks5ConnectorId, source.httpConnectorId, source.httpsConnectorId].some(
            value => value.trim() !== ''
          )
        : false,
    socks5ConnectorId: source.source === 'external' ? source.socks5ConnectorId.trim() : '',
    httpConnectorId: source.source === 'external' ? source.httpConnectorId.trim() : '',
    httpsConnectorId: source.source === 'external' ? source.httpsConnectorId.trim() : '',
  })

  const hydrateWorkspaceSimpleEntries = useCallback((entryMap: Map<string, unknown>) => {
    const quota = (entryMap.get('space-quota') as Partial<SpaceQuota>) ?? {}
    const mergedQuota = {
      ...DEFAULT_SPACE_QUOTA,
      ...quota,
      uploadAllowExts: Array.isArray(quota.uploadAllowExts) ? quota.uploadAllowExts : [],
      uploadDenyExts: Array.isArray(quota.uploadDenyExts) ? quota.uploadDenyExts : [],
      disallowedFolderNames: Array.isArray(quota.disallowedFolderNames)
        ? quota.disallowedFolderNames
        : [],
    }
    setSpaceQuotaForm(mergedQuota)
    setAllowExtsText(mergedQuota.uploadAllowExts.join(', '))
    setDenyExtsText(mergedQuota.uploadDenyExts.join(', '))
    setDisallowedFolderNamesText(mergedQuota.disallowedFolderNames.join(', '))

    const terminal = (entryMap.get('connect-terminal') as Partial<ConnectTerminalGroup>) ?? {}
    const idleTimeoutSeconds = Number(terminal.idleTimeoutSeconds)
    const maxConnections = Number(terminal.maxConnections)
    setConnectTerminalForm({
      idleTimeoutSeconds:
        Number.isFinite(idleTimeoutSeconds) && idleTimeoutSeconds >= 60
          ? Math.floor(idleTimeoutSeconds)
          : DEFAULT_CONNECT_TERMINAL.idleTimeoutSeconds,
      maxConnections:
        Number.isFinite(maxConnections) && maxConnections >= 0
          ? Math.floor(maxConnections)
          : DEFAULT_CONNECT_TERMINAL.maxConnections,
    })

    const sftp = (entryMap.get('connect-sftp') as Partial<ConnectSftpGroup>) ?? {}
    const sftpMaxUploadFiles = Number(sftp.maxUploadFiles)
    setConnectSftpForm({
      maxUploadFiles:
        Number.isFinite(sftpMaxUploadFiles) && sftpMaxUploadFiles >= 1
          ? Math.floor(sftpMaxUploadFiles)
          : DEFAULT_CONNECT_SFTP.maxUploadFiles,
    })

    const topicShare = (entryMap.get('topic-share') as Partial<TopicShare>) ?? {}
    const topicShareMaxMinutes = Number(topicShare.shareMaxMinutes)
    const topicShareDefaultMinutes = Number(topicShare.shareDefaultMinutes)
    setTopicShareForm({
      shareMaxMinutes:
        Number.isFinite(topicShareMaxMinutes) && topicShareMaxMinutes >= 1
          ? Math.floor(topicShareMaxMinutes)
          : DEFAULT_TOPIC_SHARE.shareMaxMinutes,
      shareDefaultMinutes:
        Number.isFinite(topicShareDefaultMinutes) && topicShareDefaultMinutes >= 1
          ? Math.floor(topicShareDefaultMinutes)
          : DEFAULT_TOPIC_SHARE.shareDefaultMinutes,
    })

    const topicCommentPolicy =
      (entryMap.get('topic-comment-policy') as Partial<TopicCommentPolicy>) ?? {}
    const maxGuestNameLength = Number(topicCommentPolicy.maxGuestNameLength)
    const maxCommentBodyLength = Number(topicCommentPolicy.maxCommentBodyLength)
    setTopicCommentPolicyForm({
      allowGuestComments:
        typeof topicCommentPolicy.allowGuestComments === 'boolean'
          ? topicCommentPolicy.allowGuestComments
          : DEFAULT_TOPIC_COMMENT_POLICY.allowGuestComments,
      defaultGuestName:
        typeof topicCommentPolicy.defaultGuestName === 'string' &&
        topicCommentPolicy.defaultGuestName.trim().length > 0
          ? topicCommentPolicy.defaultGuestName
          : DEFAULT_TOPIC_COMMENT_POLICY.defaultGuestName,
      maxGuestNameLength:
        Number.isFinite(maxGuestNameLength) && maxGuestNameLength >= 1
          ? Math.floor(maxGuestNameLength)
          : DEFAULT_TOPIC_COMMENT_POLICY.maxGuestNameLength,
      maxCommentBodyLength:
        Number.isFinite(maxCommentBodyLength) && maxCommentBodyLength >= 1
          ? Math.floor(maxCommentBodyLength)
          : DEFAULT_TOPIC_COMMENT_POLICY.maxCommentBodyLength,
    })

    const topicImportPolicy =
      (entryMap.get('topic-import-policy') as Partial<TopicImportPolicy>) ?? {}
    const maxDescriptionImportKB = Number(topicImportPolicy.maxDescriptionImportKB)
    const legacyMaxDescriptionImportBytes = Number(
      (topicImportPolicy as { maxDescriptionImportBytes?: number }).maxDescriptionImportBytes
    )
    setTopicImportPolicyForm({
      maxDescriptionImportKB:
        Number.isFinite(maxDescriptionImportKB) && maxDescriptionImportKB >= 1
          ? Math.floor(maxDescriptionImportKB)
          : Number.isFinite(legacyMaxDescriptionImportBytes) &&
              legacyMaxDescriptionImportBytes >= 1024
            ? Math.ceil(legacyMaxDescriptionImportBytes / 1024)
            : DEFAULT_TOPIC_IMPORT_POLICY.maxDescriptionImportKB,
      textOnly:
        typeof topicImportPolicy.textOnly === 'boolean'
          ? topicImportPolicy.textOnly
          : DEFAULT_TOPIC_IMPORT_POLICY.textOnly,
    })

    const preflight = (entryMap.get('deploy-preflight') as Partial<DeployPreflightGroup>) ?? {}
    const minFreeDiskGiB = Number(preflight.minFreeDiskGiB)
    const legacyMinFreeDiskBytes = Number(
      (preflight as { minFreeDiskBytes?: number }).minFreeDiskBytes
    )
    setDeployPreflightForm({
      minFreeDiskGiB:
        Number.isFinite(minFreeDiskGiB) && minFreeDiskGiB >= 0.5
          ? minFreeDiskGiB
          : Number.isFinite(legacyMinFreeDiskBytes) && legacyMinFreeDiskBytes >= 0
            ? Math.max(0.5, legacyMinFreeDiskBytes / (1024 * 1024 * 1024))
            : DEFAULT_DEPLOY_PREFLIGHT.minFreeDiskGiB,
    })

    const runtime = (entryMap.get('deploy-runtime') as Partial<DeployRuntimeGroup>) ?? {}
    const imagePullTimeoutSeconds = Number(runtime.imagePullTimeoutSeconds)
    const composeUpTimeoutSeconds = Number(runtime.composeUpTimeoutSeconds)
    const healthCheckTimeoutSeconds = Number(runtime.healthCheckTimeoutSeconds)
    const runtimePullIdleHeartbeatSeconds = Number(runtime.runtimePullIdleHeartbeatSeconds)
    setDeployRuntimeForm({
      imagePullTimeoutSeconds:
        Number.isFinite(imagePullTimeoutSeconds) && imagePullTimeoutSeconds >= 1
          ? Math.floor(imagePullTimeoutSeconds)
          : DEFAULT_DEPLOY_RUNTIME.imagePullTimeoutSeconds,
      composeUpTimeoutSeconds:
        Number.isFinite(composeUpTimeoutSeconds) && composeUpTimeoutSeconds >= 1
          ? Math.floor(composeUpTimeoutSeconds)
          : DEFAULT_DEPLOY_RUNTIME.composeUpTimeoutSeconds,
      healthCheckTimeoutSeconds:
        Number.isFinite(healthCheckTimeoutSeconds) && healthCheckTimeoutSeconds >= 1
          ? Math.floor(healthCheckTimeoutSeconds)
          : DEFAULT_DEPLOY_RUNTIME.healthCheckTimeoutSeconds,
      runtimePullIdleHeartbeatSeconds:
        Number.isFinite(runtimePullIdleHeartbeatSeconds) && runtimePullIdleHeartbeatSeconds >= 1
          ? Math.floor(runtimePullIdleHeartbeatSeconds)
          : DEFAULT_DEPLOY_RUNTIME.runtimePullIdleHeartbeatSeconds,
    })

    const gitDefaults =
      (entryMap.get('deploy-git-defaults') as Partial<DeployGitDefaultsGroup>) ?? {}
    setDeployGitDefaultsForm({
      defaultRef:
        typeof gitDefaults.defaultRef === 'string' && gitDefaults.defaultRef.trim().length > 0
          ? gitDefaults.defaultRef
          : DEFAULT_DEPLOY_GIT_DEFAULTS.defaultRef,
      defaultComposePath:
        typeof gitDefaults.defaultComposePath === 'string' &&
        gitDefaults.defaultComposePath.trim().length > 0
          ? gitDefaults.defaultComposePath
          : DEFAULT_DEPLOY_GIT_DEFAULTS.defaultComposePath,
    })

    const iacFiles = (entryMap.get('iac-files') as Partial<IacFilesGroup>) ?? {}
    const iacMaxSizeMB = Number(iacFiles.maxSizeMB)
    const iacMaxZipSizeMB = Number(iacFiles.maxZipSizeMB)
    setIacFilesForm({
      maxSizeMB:
        Number.isFinite(iacMaxSizeMB) && iacMaxSizeMB >= 1
          ? Math.floor(iacMaxSizeMB)
          : DEFAULT_IAC_FILES.maxSizeMB,
      maxZipSizeMB:
        Number.isFinite(iacMaxZipSizeMB) && iacMaxZipSizeMB >= 1
          ? Math.floor(iacMaxZipSizeMB)
          : DEFAULT_IAC_FILES.maxZipSizeMB,
      extensionBlacklist:
        typeof iacFiles.extensionBlacklist === 'string'
          ? iacFiles.extensionBlacklist
          : DEFAULT_IAC_FILES.extensionBlacklist,
    })

    const portRange = (entryMap.get('tunnel-port-range') as Partial<TunnelPortRange>) ?? {}
    const start = Number(portRange.start)
    const end = Number(portRange.end)
    setTunnelPortRangeForm({
      start:
        Number.isFinite(start) && start >= 1 ? Math.floor(start) : DEFAULT_TUNNEL_PORT_RANGE.start,
      end: Number.isFinite(end) && end >= 1 ? Math.floor(end) : DEFAULT_TUNNEL_PORT_RANGE.end,
    })

    setSecretPolicy(normalizeSecretPolicy(entryMap.get('secrets-policy')))

    const network = (entryMap.get('proxy-network') as Partial<ProxyNetwork>) ?? {}
    const consumersEntry =
      (entryMap.get('proxy-policies') as Partial<ProxyConsumersSettings> | undefined) ??
      EMPTY_PROXY_CONSUMERS
    const normalizedDefinitions = Array.isArray(consumersEntry.definitions)
      ? consumersEntry.definitions
          .map(normalizeProxyConsumerDefinition)
          .filter((definition): definition is ProxyConsumerDefinition => definition !== null)
      : []
    const normalizedItems = Array.isArray(consumersEntry.items)
      ? consumersEntry.items
          .map(normalizeProxyConsumerItem)
          .filter((item): item is ProxyConsumerItem => item !== null)
      : []
    const normalizedConsumerRemoteShellItems = Array.isArray(consumersEntry.serverOverrides)
      ? consumersEntry.serverOverrides
          .map(normalizeProxyRemoteShellOverride)
          .filter((item): item is ProxyRemoteShellOverride => item !== null)
      : []

    const remoteShellEntry =
      (entryMap.get('proxy-remote-shell') as Partial<ProxyRemoteShellSettings> | undefined) ??
      EMPTY_PROXY_REMOTE_SHELL
    const normalizedRemoteShellItems = Array.isArray(remoteShellEntry.items)
      ? remoteShellEntry.items
          .map(normalizeProxyRemoteShellOverride)
          .filter((item): item is ProxyRemoteShellOverride => item !== null)
      : []
    const effectiveRemoteShellItems =
      normalizedConsumerRemoteShellItems.length > 0
        ? normalizedConsumerRemoteShellItems
        : normalizedRemoteShellItems

    const mergedProxyBase = {
      ...EMPTY_PROXY,
      ...network,
      source: normalizeProxySource(network.source) ?? EMPTY_PROXY.source,
      enabled: Boolean(network.enabled),
      socks5ConnectorId:
        typeof network.socks5ConnectorId === 'string'
          ? network.socks5ConnectorId
          : EMPTY_PROXY.socks5ConnectorId,
      httpConnectorId:
        typeof network.httpConnectorId === 'string'
          ? network.httpConnectorId
          : EMPTY_PROXY.httpConnectorId,
      httpsConnectorId:
        typeof network.httpsConnectorId === 'string'
          ? network.httpsConnectorId
          : EMPTY_PROXY.httpsConnectorId,
    }
    const mergedProxy = {
      ...mergedProxyBase,
      source: inferProxySource({
        network: mergedProxyBase,
        consumers: normalizedItems,
        definitions: normalizedDefinitions,
        remoteShellOverrides: effectiveRemoteShellItems,
      }),
    }
    setProxyNetwork(mergedProxy)
    setProxyForm(mergedProxy)
    setProxyConsumerDefinitions(normalizedDefinitions)
    setProxyConsumers(normalizedItems)
    setProxyRemoteShellOverrides(effectiveRemoteShellItems)
  }, [])

  const validateSpaceQuota = (): boolean => {
    const errs: Partial<Record<keyof SpaceQuota, string>> = {}
    if (!spaceQuotaForm.maxSizeMB || spaceQuotaForm.maxSizeMB < 1) errs.maxSizeMB = 'Must be ≥ 1'
    if (!spaceQuotaForm.maxPerUser || spaceQuotaForm.maxPerUser < 1) errs.maxPerUser = 'Must be ≥ 1'
    if (
      !spaceQuotaForm.maxUploadFiles ||
      spaceQuotaForm.maxUploadFiles < 1 ||
      spaceQuotaForm.maxUploadFiles > 200
    ) {
      errs.maxUploadFiles = 'Must be between 1 and 200'
    }
    if (!spaceQuotaForm.shareMaxMinutes || spaceQuotaForm.shareMaxMinutes < 1) {
      errs.shareMaxMinutes = 'Must be ≥ 1'
    }
    if (!spaceQuotaForm.shareDefaultMinutes || spaceQuotaForm.shareDefaultMinutes < 1) {
      errs.shareDefaultMinutes = 'Must be ≥ 1'
    }
    if (spaceQuotaForm.shareDefaultMinutes > spaceQuotaForm.shareMaxMinutes) {
      errs.shareDefaultMinutes = 'Cannot exceed max duration'
    }
    setSpaceQuotaErrors(errs)
    return Object.keys(errs).length === 0
  }

  const saveSpaceQuota = async () => {
    if (!validateSpaceQuota()) return
    setSpaceQuotaSaving(true)
    const payload: SpaceQuota = {
      ...spaceQuotaForm,
      uploadAllowExts: parseExtListInput(allowExtsText),
      uploadDenyExts: parseExtListInput(denyExtsText),
      disallowedFolderNames: disallowedFolderNamesText
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    }
    try {
      const res = (await pb.send(settingsEntryPath('space-quota'), {
        method: 'PATCH',
        body: payload,
      })) as { value?: Partial<SpaceQuota> }
      const quota = res.value ?? payload
      const merged = {
        ...DEFAULT_SPACE_QUOTA,
        ...quota,
        uploadAllowExts: Array.isArray(quota.uploadAllowExts) ? quota.uploadAllowExts : [],
        uploadDenyExts: Array.isArray(quota.uploadDenyExts) ? quota.uploadDenyExts : [],
        disallowedFolderNames: Array.isArray(quota.disallowedFolderNames)
          ? quota.disallowedFolderNames
          : [],
      }
      setSpaceQuotaForm(merged)
      setAllowExtsText(merged.uploadAllowExts.join(', '))
      setDenyExtsText(merged.uploadDenyExts.join(', '))
      setDisallowedFolderNamesText(merged.disallowedFolderNames.join(', '))
      showToast('Space quota saved')
    } catch (err: unknown) {
      showToast('Failed: ' + ((err as { message?: string })?.message ?? String(err)), false)
    } finally {
      setSpaceQuotaSaving(false)
    }
    setProxyErrors({})
  }

  const parseProxyApiErrors = (
    payload: unknown,
    scope: 'network' | 'consumers' | 'remoteShell' = 'network'
  ): Partial<Record<'form' | 'consumers' | 'remoteShell' | keyof ProxyNetwork, string>> => {
    const parsed: Partial<
      Record<'form' | 'consumers' | 'remoteShell' | keyof ProxyNetwork, string>
    > = {}
    if (!payload || typeof payload !== 'object') {
      return parsed
    }

    const root = payload as Record<string, unknown>
    const bag =
      root.errors && typeof root.errors === 'object'
        ? (root.errors as Record<string, unknown>)
        : root

    const formError = extractFieldError(root.message) ?? extractFieldError(root.data)
    if (formError) {
      parsed.form = formError
    }

    const socks5Error = extractFieldError(bag.socks5ConnectorId)
    if (socks5Error) {
      parsed.socks5ConnectorId = socks5Error
    }
    const httpError = extractFieldError(bag.httpConnectorId)
    if (httpError) {
      parsed.httpConnectorId = httpError
    }
    const httpsError = extractFieldError(bag.httpsConnectorId)
    if (httpsError) {
      parsed.httpsConnectorId = httpsError
    }
    const consumersError = extractFieldError(bag.items)
    if (consumersError) {
      if (scope === 'remoteShell') {
        parsed.remoteShell = consumersError
      } else {
        parsed.consumers = consumersError
      }
    }
    const remoteShellOverridesError = extractFieldError(bag.serverOverrides)
    if (remoteShellOverridesError) {
      parsed.remoteShell = remoteShellOverridesError
    }

    return parsed
  }

  const saveProxyNetwork = async (draft?: ProxyNetwork) => {
    setProxySavingSection('network')
    setProxyErrors({})
    try {
      const payload = buildProxyNetworkPayload(draft ?? proxyForm)
      if (payload.source === 'external' && !payload.enabled) {
        setProxyErrors({
          form: 'Select at least one external proxy connector before saving External Proxy.',
        })
        showToast('Please select at least one external proxy connector.', false)
        return
      }

      const res = (await pb.send(settingsEntryPath('proxy-network'), {
        method: 'PATCH',
        body: payload,
      })) as { value?: Partial<ProxyNetwork> }
      const savedNetwork = {
        ...payload,
        ...res.value,
        source: normalizeProxySource(res.value?.source) ?? payload.source,
        enabled: Boolean(res.value?.enabled ?? payload.enabled),
        socks5ConnectorId: String(res.value?.socks5ConnectorId ?? payload.socks5ConnectorId),
        httpConnectorId: String(res.value?.httpConnectorId ?? payload.httpConnectorId),
        httpsConnectorId: String(res.value?.httpsConnectorId ?? payload.httpsConnectorId),
      }

      setProxyNetwork(savedNetwork)
      setProxyForm(savedNetwork)
      setProxyErrors({})
      showToast('Proxy resource settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const inlineErrors = parseProxyApiErrors(err.response, 'network')
        if (Object.keys(inlineErrors).length > 0) {
          setProxyErrors(inlineErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setProxySavingSection(null)
    }
  }

  const saveProxyConsumers = async () => {
    setProxySavingSection('consumers')
    setProxyErrors(current => ({ ...current, consumers: undefined }))
    try {
      const consumerPayload = {
        items: proxyConsumers.map(item => ({
          consumerKey: item.consumerKey.trim(),
          mode: item.mode,
        })),
        serverOverrides: proxyRemoteShellOverrides.map(item => ({
          serverId: item.serverId.trim(),
          mode: item.mode,
        })),
      }
      const consumerRes = (await pb.send(settingsEntryPath('proxy-policies'), {
        method: 'PATCH',
        body: consumerPayload,
      })) as { value?: Partial<ProxyConsumersSettings> }
      const savedConsumers = Array.isArray(consumerRes.value?.items)
        ? consumerRes.value.items
            .map(normalizeProxyConsumerItem)
            .filter((item): item is ProxyConsumerItem => item !== null)
        : consumerPayload.items
      const savedRemoteShellOverrides = Array.isArray(consumerRes.value?.serverOverrides)
        ? consumerRes.value.serverOverrides
            .map(normalizeProxyRemoteShellOverride)
            .filter((item): item is ProxyRemoteShellOverride => item !== null)
        : consumerPayload.serverOverrides

      setProxyConsumers(savedConsumers)
      setProxyRemoteShellOverrides(savedRemoteShellOverrides)
      if (Array.isArray(consumerRes.value?.definitions)) {
        setProxyConsumerDefinitions(
          consumerRes.value.definitions
            .map(normalizeProxyConsumerDefinition)
            .filter((definition): definition is ProxyConsumerDefinition => definition !== null)
        )
      }
      setProxyErrors(current => ({ ...current, consumers: undefined, remoteShell: undefined }))
      showToast('Proxy policy settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const inlineErrors = parseProxyApiErrors(err.response, 'consumers')
        if (Object.keys(inlineErrors).length > 0) {
          setProxyErrors(current => ({ ...current, ...inlineErrors }))
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setProxySavingSection(null)
    }
  }

  const validateConnectTerminal = (): boolean => {
    const errors: Partial<Record<keyof ConnectTerminalGroup, string>> = {}
    if (
      !Number.isInteger(connectTerminalForm.idleTimeoutSeconds) ||
      connectTerminalForm.idleTimeoutSeconds < 60
    ) {
      errors.idleTimeoutSeconds = 'Must be an integer ≥ 60 seconds'
    }
    if (
      !Number.isInteger(connectTerminalForm.maxConnections) ||
      connectTerminalForm.maxConnections < 0
    ) {
      errors.maxConnections = 'Must be an integer ≥ 0 (0 means unlimited)'
    }
    setConnectTerminalErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveConnectTerminal = async () => {
    if (!validateConnectTerminal()) return
    setConnectTerminalSaving(true)
    setConnectTerminalErrors({})
    try {
      await pb.send(settingsEntryPath('connect-terminal'), {
        method: 'PATCH',
        body: {
          idleTimeoutSeconds: connectTerminalForm.idleTimeoutSeconds,
          maxConnections: connectTerminalForm.maxConnections,
        },
      })
      showToast('Connect terminal settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const inlineErrors = parseConnectTerminalApiErrors(err.response)
        if (Object.keys(inlineErrors).length > 0) {
          setConnectTerminalErrors(inlineErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setConnectTerminalSaving(false)
    }
  }

  const validateConnectSftp = (): boolean => {
    const errors: Partial<Record<keyof ConnectSftpGroup, string>> = {}
    if (!Number.isInteger(connectSftpForm.maxUploadFiles) || connectSftpForm.maxUploadFiles < 1) {
      errors.maxUploadFiles = 'Must be an integer ≥ 1'
    }
    setConnectSftpErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveConnectSftp = async () => {
    if (!validateConnectSftp()) return
    setConnectSftpSaving(true)
    setConnectSftpErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('connect-sftp'), {
        method: 'PATCH',
        body: { maxUploadFiles: connectSftpForm.maxUploadFiles },
      })) as { value?: Partial<ConnectSftpGroup> }
      const next = res.value ?? connectSftpForm
      setConnectSftpForm({
        maxUploadFiles: Number(next.maxUploadFiles ?? connectSftpForm.maxUploadFiles),
      })
      showToast('Connect SFTP settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          maxUploadFiles: extractFieldError(bag.maxUploadFiles) ?? undefined,
        }
        if (Object.values(nextErrors).some(Boolean)) {
          setConnectSftpErrors(nextErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setConnectSftpSaving(false)
    }
  }

  const validateTopicShare = (): boolean => {
    const errors: Partial<Record<keyof TopicShare, string>> = {}
    if (
      !Number.isInteger(topicShareForm.shareDefaultMinutes) ||
      topicShareForm.shareDefaultMinutes < 1
    ) {
      errors.shareDefaultMinutes = 'Must be an integer ≥ 1'
    }
    if (!Number.isInteger(topicShareForm.shareMaxMinutes) || topicShareForm.shareMaxMinutes < 1) {
      errors.shareMaxMinutes = 'Must be an integer ≥ 1'
    }
    if (
      !errors.shareDefaultMinutes &&
      !errors.shareMaxMinutes &&
      topicShareForm.shareDefaultMinutes > topicShareForm.shareMaxMinutes
    ) {
      errors.shareDefaultMinutes = 'Cannot exceed max duration'
    }
    setTopicShareErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveTopicShare = async () => {
    if (!validateTopicShare()) return
    setTopicShareSaving(true)
    setTopicShareErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('topic-share'), {
        method: 'PATCH',
        body: {
          shareMaxMinutes: topicShareForm.shareMaxMinutes,
          shareDefaultMinutes: topicShareForm.shareDefaultMinutes,
        },
      })) as { value?: Partial<TopicShare> }
      const next = res.value ?? topicShareForm
      setTopicShareForm({
        shareMaxMinutes: Number(next.shareMaxMinutes ?? topicShareForm.shareMaxMinutes),
        shareDefaultMinutes: Number(next.shareDefaultMinutes ?? topicShareForm.shareDefaultMinutes),
      })
      showToast('Topic share settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          shareMaxMinutes: extractFieldError(bag.shareMaxMinutes) ?? undefined,
          shareDefaultMinutes: extractFieldError(bag.shareDefaultMinutes) ?? undefined,
        }
        if (Object.values(nextErrors).some(Boolean)) {
          setTopicShareErrors(nextErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setTopicShareSaving(false)
    }
  }

  const validateTopicCommentPolicy = (): boolean => {
    const errors: Partial<Record<keyof TopicCommentPolicy, string>> = {}
    const trimmedDefaultGuestName = topicCommentPolicyForm.defaultGuestName.trim()

    if (trimmedDefaultGuestName.length === 0) {
      errors.defaultGuestName = 'Must not be empty'
    }
    if (
      !Number.isInteger(topicCommentPolicyForm.maxGuestNameLength) ||
      topicCommentPolicyForm.maxGuestNameLength < 1
    ) {
      errors.maxGuestNameLength = 'Must be an integer ≥ 1'
    }
    if (
      !Number.isInteger(topicCommentPolicyForm.maxCommentBodyLength) ||
      topicCommentPolicyForm.maxCommentBodyLength < 1
    ) {
      errors.maxCommentBodyLength = 'Must be an integer ≥ 1'
    }
    if (
      !errors.defaultGuestName &&
      !errors.maxGuestNameLength &&
      trimmedDefaultGuestName.length > topicCommentPolicyForm.maxGuestNameLength
    ) {
      errors.defaultGuestName = 'Must be within Max Guest Name Length'
    }

    setTopicCommentPolicyErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveTopicCommentPolicy = async () => {
    if (!validateTopicCommentPolicy()) return
    setTopicCommentPolicySaving(true)
    setTopicCommentPolicyErrors({})
    try {
      const payload: TopicCommentPolicy = {
        ...topicCommentPolicyForm,
        defaultGuestName: topicCommentPolicyForm.defaultGuestName.trim(),
      }
      const res = (await pb.send(settingsEntryPath('topic-comment-policy'), {
        method: 'PATCH',
        body: payload,
      })) as { value?: Partial<TopicCommentPolicy> }
      const next = res.value ?? payload
      setTopicCommentPolicyForm({
        allowGuestComments: Boolean(next.allowGuestComments ?? payload.allowGuestComments),
        defaultGuestName:
          typeof next.defaultGuestName === 'string'
            ? next.defaultGuestName
            : payload.defaultGuestName,
        maxGuestNameLength: Number(next.maxGuestNameLength ?? payload.maxGuestNameLength),
        maxCommentBodyLength: Number(next.maxCommentBodyLength ?? payload.maxCommentBodyLength),
      })
      showToast('Topic comment policy saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          allowGuestComments: extractFieldError(bag.allowGuestComments) ?? undefined,
          defaultGuestName: extractFieldError(bag.defaultGuestName) ?? undefined,
          maxGuestNameLength: extractFieldError(bag.maxGuestNameLength) ?? undefined,
          maxCommentBodyLength: extractFieldError(bag.maxCommentBodyLength) ?? undefined,
        }
        if (Object.values(nextErrors).some(Boolean)) {
          setTopicCommentPolicyErrors(nextErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setTopicCommentPolicySaving(false)
    }
  }

  const validateTopicImportPolicy = (): boolean => {
    const errors: Partial<Record<keyof TopicImportPolicy, string>> = {}
    if (
      !Number.isInteger(topicImportPolicyForm.maxDescriptionImportKB) ||
      topicImportPolicyForm.maxDescriptionImportKB < 1 ||
      topicImportPolicyForm.maxDescriptionImportKB > 10 * 1024
    ) {
      errors.maxDescriptionImportKB = 'Must be an integer between 1 and 10240'
    }
    setTopicImportPolicyErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveTopicImportPolicy = async () => {
    if (!validateTopicImportPolicy()) return
    setTopicImportPolicySaving(true)
    setTopicImportPolicyErrors({})
    try {
      const payload: TopicImportPolicy = {
        ...topicImportPolicyForm,
      }
      const res = (await pb.send(settingsEntryPath('topic-import-policy'), {
        method: 'PATCH',
        body: payload,
      })) as { value?: Partial<TopicImportPolicy> }
      const next = res.value ?? payload
      setTopicImportPolicyForm({
        maxDescriptionImportKB: Number(
          next.maxDescriptionImportKB ?? payload.maxDescriptionImportKB
        ),
        textOnly: Boolean(next.textOnly ?? payload.textOnly),
      })
      showToast('Topic import policy saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          maxDescriptionImportKB: extractFieldError(bag.maxDescriptionImportKB) ?? undefined,
          textOnly: extractFieldError(bag.textOnly) ?? undefined,
        }
        if (Object.values(nextErrors).some(Boolean)) {
          setTopicImportPolicyErrors(nextErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setTopicImportPolicySaving(false)
    }
  }

  const validateDeployPreflight = (): boolean => {
    const errors: Partial<Record<keyof DeployPreflightGroup, string>> = {}
    if (
      !Number.isFinite(deployPreflightForm.minFreeDiskGiB) ||
      deployPreflightForm.minFreeDiskGiB < 0.5
    ) {
      errors.minFreeDiskGiB = 'Must be at least 0.5 GiB'
    }
    setDeployPreflightErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveDeployPreflight = async () => {
    if (!validateDeployPreflight()) return
    setDeployPreflightSaving(true)
    setDeployPreflightErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('deploy-preflight'), {
        method: 'PATCH',
        body: {
          minFreeDiskGiB: deployPreflightForm.minFreeDiskGiB,
        },
      })) as { value?: Partial<DeployPreflightGroup> }
      const preflight = res.value ?? deployPreflightForm
      setDeployPreflightForm({
        minFreeDiskGiB: Number(preflight.minFreeDiskGiB ?? deployPreflightForm.minFreeDiskGiB),
      })
      showToast('Deploy checks saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          minFreeDiskGiB: extractFieldError(bag.minFreeDiskGiB) ?? undefined,
        }
        if (Object.values(nextErrors).some(Boolean)) {
          setDeployPreflightErrors(nextErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setDeployPreflightSaving(false)
    }
  }

  const validateDeployRuntime = (): boolean => {
    const errors: Partial<Record<keyof DeployRuntimeGroup, string>> = {}
    const integerFields: Array<keyof DeployRuntimeGroup> = [
      'imagePullTimeoutSeconds',
      'composeUpTimeoutSeconds',
      'healthCheckTimeoutSeconds',
      'runtimePullIdleHeartbeatSeconds',
    ]
    for (const field of integerFields) {
      if (!Number.isInteger(deployRuntimeForm[field]) || deployRuntimeForm[field] < 1) {
        errors[field] = 'Must be an integer ≥ 1 second'
      }
    }
    setDeployRuntimeErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveDeployRuntime = async () => {
    if (!validateDeployRuntime()) return
    setDeployRuntimeSaving(true)
    setDeployRuntimeErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('deploy-runtime'), {
        method: 'PATCH',
        body: { ...deployRuntimeForm },
      })) as { value?: Partial<DeployRuntimeGroup> }
      const runtime = res.value ?? deployRuntimeForm
      setDeployRuntimeForm({
        imagePullTimeoutSeconds: Number(
          runtime.imagePullTimeoutSeconds ?? deployRuntimeForm.imagePullTimeoutSeconds
        ),
        composeUpTimeoutSeconds: Number(
          runtime.composeUpTimeoutSeconds ?? deployRuntimeForm.composeUpTimeoutSeconds
        ),
        healthCheckTimeoutSeconds: Number(
          runtime.healthCheckTimeoutSeconds ?? deployRuntimeForm.healthCheckTimeoutSeconds
        ),
        runtimePullIdleHeartbeatSeconds: Number(
          runtime.runtimePullIdleHeartbeatSeconds ??
            deployRuntimeForm.runtimePullIdleHeartbeatSeconds
        ),
      })
      showToast('Deploy runtime settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          imagePullTimeoutSeconds: extractFieldError(bag.imagePullTimeoutSeconds) ?? undefined,
          composeUpTimeoutSeconds: extractFieldError(bag.composeUpTimeoutSeconds) ?? undefined,
          healthCheckTimeoutSeconds: extractFieldError(bag.healthCheckTimeoutSeconds) ?? undefined,
          runtimePullIdleHeartbeatSeconds:
            extractFieldError(bag.runtimePullIdleHeartbeatSeconds) ?? undefined,
        }
        if (Object.values(nextErrors).some(Boolean)) {
          setDeployRuntimeErrors(nextErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setDeployRuntimeSaving(false)
    }
  }

  const validateDeployGitDefaults = (): boolean => {
    const errors: Partial<Record<keyof DeployGitDefaultsGroup, string>> = {}
    if (deployGitDefaultsForm.defaultRef.trim().length === 0) {
      errors.defaultRef = 'Must not be empty'
    }
    if (deployGitDefaultsForm.defaultComposePath.trim().length === 0) {
      errors.defaultComposePath = 'Must not be empty'
    }
    setDeployGitDefaultsErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveDeployGitDefaults = async () => {
    if (!validateDeployGitDefaults()) return
    setDeployGitDefaultsSaving(true)
    setDeployGitDefaultsErrors({})
    try {
      const payload: DeployGitDefaultsGroup = {
        defaultRef: deployGitDefaultsForm.defaultRef.trim(),
        defaultComposePath: deployGitDefaultsForm.defaultComposePath.trim(),
      }
      const res = (await pb.send(settingsEntryPath('deploy-git-defaults'), {
        method: 'PATCH',
        body: payload,
      })) as { value?: Partial<DeployGitDefaultsGroup> }
      const gitDefaults = res.value ?? payload
      setDeployGitDefaultsForm({
        defaultRef:
          typeof gitDefaults.defaultRef === 'string' ? gitDefaults.defaultRef : payload.defaultRef,
        defaultComposePath:
          typeof gitDefaults.defaultComposePath === 'string'
            ? gitDefaults.defaultComposePath
            : payload.defaultComposePath,
      })
      showToast('Deploy Git defaults saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          defaultRef: extractFieldError(bag.defaultRef) ?? undefined,
          defaultComposePath: extractFieldError(bag.defaultComposePath) ?? undefined,
        }
        if (Object.values(nextErrors).some(Boolean)) {
          setDeployGitDefaultsErrors(nextErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setDeployGitDefaultsSaving(false)
    }
  }

  const validateIacFiles = (): boolean => {
    const errors: Partial<Record<keyof IacFilesGroup, string>> = {}
    if (!Number.isInteger(iacFilesForm.maxSizeMB) || iacFilesForm.maxSizeMB < 1) {
      errors.maxSizeMB = 'Must be an integer >= 1'
    }
    if (!Number.isInteger(iacFilesForm.maxZipSizeMB) || iacFilesForm.maxZipSizeMB < 1) {
      errors.maxZipSizeMB = 'Must be an integer >= 1'
    }
    if (
      !errors.maxSizeMB &&
      !errors.maxZipSizeMB &&
      iacFilesForm.maxZipSizeMB < iacFilesForm.maxSizeMB
    ) {
      errors.maxZipSizeMB = 'Must be >= Max File Size MB'
    }
    if (typeof iacFilesForm.extensionBlacklist !== 'string') {
      errors.extensionBlacklist = 'Must be a string'
    }
    setIacFilesErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveIacFiles = async () => {
    if (!validateIacFiles()) return
    setIacFilesSaving(true)
    setIacFilesErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('iac-files'), {
        method: 'PATCH',
        body: {
          maxSizeMB: iacFilesForm.maxSizeMB,
          maxZipSizeMB: iacFilesForm.maxZipSizeMB,
          extensionBlacklist: iacFilesForm.extensionBlacklist,
        },
      })) as { value?: Partial<IacFilesGroup> }
      const next = res.value ?? iacFilesForm
      setIacFilesForm({
        maxSizeMB: Number(next.maxSizeMB ?? iacFilesForm.maxSizeMB),
        maxZipSizeMB: Number(next.maxZipSizeMB ?? iacFilesForm.maxZipSizeMB),
        extensionBlacklist:
          typeof next.extensionBlacklist === 'string'
            ? next.extensionBlacklist
            : iacFilesForm.extensionBlacklist,
      })
      showToast('IaC file limits saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          maxSizeMB: extractFieldError(bag.maxSizeMB) ?? undefined,
          maxZipSizeMB: extractFieldError(bag.maxZipSizeMB) ?? undefined,
          extensionBlacklist: extractFieldError(bag.extensionBlacklist) ?? undefined,
        }
        if (Object.values(nextErrors).some(Boolean)) {
          setIacFilesErrors(nextErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setIacFilesSaving(false)
    }
  }

  const validateTunnelPortRange = (): boolean => {
    const errors: Partial<Record<keyof TunnelPortRange, string>> = {}
    if (
      !Number.isInteger(tunnelPortRangeForm.start) ||
      tunnelPortRangeForm.start < 1 ||
      tunnelPortRangeForm.start > 65535
    ) {
      errors.start = 'Must be an integer between 1 and 65535'
    }
    if (
      !Number.isInteger(tunnelPortRangeForm.end) ||
      tunnelPortRangeForm.end < 1 ||
      tunnelPortRangeForm.end > 65535
    ) {
      errors.end = 'Must be an integer between 1 and 65535'
    }
    if (Object.keys(errors).length === 0 && tunnelPortRangeForm.start >= tunnelPortRangeForm.end) {
      errors.end = 'Must be greater than start'
    }
    if (
      Object.keys(errors).length === 0 &&
      tunnelPortRangeForm.start <= 2222 &&
      2222 <= tunnelPortRangeForm.end
    ) {
      errors.start = 'Range must not include tunnel SSH port 2222'
      errors.end = 'Range must not include tunnel SSH port 2222'
    }
    setTunnelPortRangeErrors(errors)
    return Object.keys(errors).length === 0
  }

  const saveTunnelPortRange = async () => {
    if (!validateTunnelPortRange()) return
    setTunnelPortRangeSaving(true)
    setTunnelPortRangeErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('tunnel-port-range'), {
        method: 'PATCH',
        body: {
          start: tunnelPortRangeForm.start,
          end: tunnelPortRangeForm.end,
        },
      })) as { value?: Partial<TunnelPortRange> }
      const portRange = res.value ?? tunnelPortRangeForm
      setTunnelPortRangeForm({
        start: Number(portRange.start ?? tunnelPortRangeForm.start),
        end: Number(portRange.end ?? tunnelPortRangeForm.end),
      })
      showToast('Tunnel settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const inlineErrors = parseTunnelPortRangeApiErrors(err.response)
        if (Object.keys(inlineErrors).length > 0) {
          setTunnelPortRangeErrors(inlineErrors)
          showToast('Please fix validation errors and try again.', false)
          return
        }
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setTunnelPortRangeSaving(false)
    }
  }

  const saveSecretPolicy = async () => {
    setSecretPolicySaving(true)
    setSecretPolicyErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('secrets-policy'), {
        method: 'PATCH',
        body: secretPolicy,
      })) as { value?: unknown }
      setSecretPolicy(normalizeSecretPolicy(res.value))
      showToast('Secrets policy saved')
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 422) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        setSecretPolicyErrors({
          revealDisabled: extractFieldError(bag.revealDisabled) ?? undefined,
          defaultAccessMode: extractFieldError(bag.defaultAccessMode) ?? undefined,
          clipboardClearSeconds: extractFieldError(bag.clipboardClearSeconds) ?? undefined,
          maxAgeDays: extractFieldError(bag.maxAgeDays) ?? undefined,
          warnBeforeExpiryDays: extractFieldError(bag.warnBeforeExpiryDays) ?? undefined,
        })
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setSecretPolicySaving(false)
    }
  }

  return {
    spaceQuotaForm,
    spaceQuotaSaving,
    spaceQuotaErrors,
    allowExtsText,
    denyExtsText,
    disallowedFolderNamesText,
    setSpaceQuotaForm,
    setAllowExtsText,
    setDenyExtsText,
    setDisallowedFolderNamesText,
    saveSpaceQuota,
    connectTerminalForm,
    connectTerminalSaving,
    connectTerminalErrors,
    setConnectTerminalForm,
    saveConnectTerminal,
    connectSftpForm,
    connectSftpSaving,
    connectSftpErrors,
    setConnectSftpForm,
    saveConnectSftp,
    topicShareForm,
    topicShareSaving,
    topicShareErrors,
    setTopicShareForm,
    saveTopicShare,
    topicCommentPolicyForm,
    topicCommentPolicySaving,
    topicCommentPolicyErrors,
    setTopicCommentPolicyForm,
    saveTopicCommentPolicy,
    topicImportPolicyForm,
    topicImportPolicySaving,
    topicImportPolicyErrors,
    setTopicImportPolicyForm,
    saveTopicImportPolicy,
    deployPreflightForm,
    deployPreflightSaving,
    deployPreflightErrors,
    setDeployPreflightForm,
    saveDeployPreflight,
    deployRuntimeForm,
    deployRuntimeSaving,
    deployRuntimeErrors,
    setDeployRuntimeForm,
    saveDeployRuntime,
    deployGitDefaultsForm,
    deployGitDefaultsSaving,
    deployGitDefaultsErrors,
    setDeployGitDefaultsForm,
    saveDeployGitDefaults,
    iacFilesForm,
    iacFilesSaving,
    iacFilesErrors,
    setIacFilesForm,
    saveIacFiles,
    tunnelPortRangeForm,
    tunnelPortRangeSaving,
    tunnelPortRangeErrors,
    setTunnelPortRangeForm,
    saveTunnelPortRange,
    secretPolicy,
    secretPolicyErrors,
    secretPolicySaving,
    setSecretPolicy,
    saveSecretPolicy,
    proxyNetwork,
    proxyForm,
    proxyConsumers,
    proxyConsumerDefinitions,
    proxyRemoteShellOverrides,
    proxySaving: proxySavingSection !== null,
    proxyNetworkSaving: proxySavingSection === 'network',
    proxyConsumersSaving: proxySavingSection === 'consumers',
    proxyErrors,
    setProxyForm,
    setProxyConsumers,
    setProxyRemoteShellOverrides,
    saveProxyNetwork,
    saveProxyConsumers,
    hydrateWorkspaceSimpleEntries,
  }
}
