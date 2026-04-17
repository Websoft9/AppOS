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
  DEFAULT_DEPLOY_PREFLIGHT,
  DEFAULT_IAC_FILES,
  DEFAULT_SPACE_QUOTA,
  DEFAULT_TUNNEL_PORT_RANGE,
  EMPTY_PROXY,
  type ConnectSftpGroup,
  type ConnectTerminalGroup,
  type DeployPreflightGroup,
  type IacFilesGroup,
  type ProxyNetwork,
  type SpaceQuota,
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

  const [deployPreflightForm, setDeployPreflightForm] =
    useState<DeployPreflightGroup>(DEFAULT_DEPLOY_PREFLIGHT)
  const [deployPreflightSaving, setDeployPreflightSaving] = useState(false)
  const [deployPreflightErrors, setDeployPreflightErrors] = useState<
    Partial<Record<keyof DeployPreflightGroup, string>>
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
  const [proxySaving, setProxySaving] = useState(false)

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

    const preflight = (entryMap.get('deploy-preflight') as Partial<DeployPreflightGroup>) ?? {}
    const minFreeDiskBytes = Number(preflight.minFreeDiskBytes)
    setDeployPreflightForm({
      minFreeDiskBytes:
        Number.isFinite(minFreeDiskBytes) && minFreeDiskBytes >= 0
          ? Math.floor(minFreeDiskBytes)
          : DEFAULT_DEPLOY_PREFLIGHT.minFreeDiskBytes,
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

    const network = (entryMap.get('proxy-network') as ProxyNetwork) ?? EMPTY_PROXY
    setProxyNetwork(network)
    setProxyForm(network)
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
  }

  const saveProxy = async () => {
    setProxySaving(true)
    try {
      await pb.send(settingsEntryPath('proxy-network'), {
        method: 'PATCH',
        body: proxyForm,
      })
      setProxyNetwork(proxyForm)
      showToast('Proxy settings saved')
    } catch (err) {
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setProxySaving(false)
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

  const validateDeployPreflight = (): boolean => {
    const errors: Partial<Record<keyof DeployPreflightGroup, string>> = {}
    if (
      !Number.isInteger(deployPreflightForm.minFreeDiskBytes) ||
      deployPreflightForm.minFreeDiskBytes < 0
    ) {
      errors.minFreeDiskBytes = 'Must be an integer ≥ 0 bytes'
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
          minFreeDiskBytes: deployPreflightForm.minFreeDiskBytes,
        },
      })) as { value?: Partial<DeployPreflightGroup> }
      const preflight = res.value ?? deployPreflightForm
      setDeployPreflightForm({
        minFreeDiskBytes: Number(
          preflight.minFreeDiskBytes ?? deployPreflightForm.minFreeDiskBytes
        ),
      })
      showToast('Deploy preflight settings saved')
    } catch (err) {
      if (err instanceof ClientResponseError && (err.status === 400 || err.status === 422)) {
        const root = err.response as Record<string, unknown>
        const bag =
          root.errors && typeof root.errors === 'object'
            ? (root.errors as Record<string, unknown>)
            : root
        const nextErrors = {
          minFreeDiskBytes: extractFieldError(bag.minFreeDiskBytes) ?? undefined,
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
    deployPreflightForm,
    deployPreflightSaving,
    deployPreflightErrors,
    setDeployPreflightForm,
    saveDeployPreflight,
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
    proxySaving,
    setProxyForm,
    saveProxy,
    hydrateWorkspaceSimpleEntries,
  }
}
