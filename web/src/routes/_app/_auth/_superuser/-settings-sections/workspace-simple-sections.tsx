import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { HelpCircle, Loader2 } from 'lucide-react'
import { ProxyConnectorDialog } from '@/components/connectors/ProxyConnectorDialog'
import { listServers, type Server } from '@/lib/connect-api'
import { pb } from '@/lib/pb'
import { type SettingsSchemaEntry } from '@/lib/settings-api'
import type { SecretPolicy } from '@/lib/secrets-policy'
import { SECRET_ACCESS_MODE_OPTIONS } from '@/lib/secrets-policy'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SaveButton, Toggle, selectClass } from './shared'
import type {
  ConnectSftpGroup,
  ConnectTerminalGroup,
  DeployGitDefaultsGroup,
  DeployPreflightGroup,
  DeployRuntimeGroup,
  IacFilesGroup,
  ProxyConsumerDefinition,
  ProxyConsumerItem,
  ProxyNetwork,
  ProxyRemoteShellOverride,
  ProxySource,
  SecretPolicyErrors,
  SpaceQuota,
  TopicCommentPolicy,
  TopicImportPolicy,
  TopicShare,
  TunnelPortRange,
} from './types'

type SchemaNumberFieldOptions = {
  inputId: string
  min?: number
  max?: number
  step?: number
  helpText?: string
}

type SchemaTextFieldOptions = {
  inputId: string
  placeholder?: string
  helpText?: string
}

function renderSchemaNumberFields<T extends object, K extends keyof T & string>({
  entry,
  form,
  errors,
  setForm,
  fieldOptions,
}: {
  entry: SettingsSchemaEntry
  form: T
  errors: Partial<Record<K, string>>
  setForm: React.Dispatch<React.SetStateAction<T>>
  fieldOptions: Partial<Record<K, SchemaNumberFieldOptions>>
}) {
  return entry.fields.map(field => {
    const fieldKey = field.id as K
    const options = fieldOptions[fieldKey]
    if (!options) {
      return null
    }

    const error = errors[fieldKey]
    const value = form[fieldKey] as number

    return (
      <div key={field.id} className="space-y-1">
        <Label htmlFor={options.inputId}>{field.label}</Label>
        <Input
          id={options.inputId}
          type="number"
          min={options.min}
          max={options.max}
          step={options.step ?? 1}
          value={value}
          onChange={event =>
            setForm(
              current =>
                ({
                  ...current,
                  [fieldKey]: Number(event.target.value),
                }) as T
            )
          }
        />
        {(field.helpText || options.helpText) && (
          <p className="text-xs text-muted-foreground">{field.helpText ?? options.helpText}</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  })
}

function renderSchemaTextFields<T extends object, K extends keyof T & string>({
  entry,
  form,
  errors,
  setForm,
  fieldOptions,
}: {
  entry: SettingsSchemaEntry
  form: T
  errors: Partial<Record<K, string>>
  setForm: React.Dispatch<React.SetStateAction<T>>
  fieldOptions: Partial<Record<K, SchemaTextFieldOptions>>
}) {
  return entry.fields.map(field => {
    const fieldKey = field.id as K
    const options = fieldOptions[fieldKey]
    if (!options) {
      return null
    }

    const error = errors[fieldKey]
    const value = form[fieldKey] as string

    return (
      <div key={field.id} className="space-y-1">
        <Label htmlFor={options.inputId}>{field.label}</Label>
        <Input
          id={options.inputId}
          value={value}
          placeholder={options.placeholder}
          onChange={event =>
            setForm(
              current =>
                ({
                  ...current,
                  [fieldKey]: event.target.value,
                }) as T
            )
          }
        />
        {(field.helpText || options.helpText) && (
          <p className="text-xs text-muted-foreground">{field.helpText ?? options.helpText}</p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  })
}

export function SpaceQuotaSection({
  form,
  errors,
  allowExtsText,
  denyExtsText,
  disallowedFolderNamesText,
  saving,
  parseExtListInput,
  setForm,
  setAllowExtsText,
  setDenyExtsText,
  setDisallowedFolderNamesText,
  save,
}: {
  form: SpaceQuota
  errors: Partial<Record<keyof SpaceQuota, string>>
  allowExtsText: string
  denyExtsText: string
  disallowedFolderNamesText: string
  saving: boolean
  parseExtListInput: (value: string) => string[]
  setForm: React.Dispatch<React.SetStateAction<SpaceQuota>>
  setAllowExtsText: (value: string) => void
  setDenyExtsText: (value: string) => void
  setDisallowedFolderNamesText: (value: string) => void
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Space</CardTitle>
        <CardDescription>Per-user private space limits</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="maxSizeMB">Max File Size (MB)</Label>
            <Input
              id="maxSizeMB"
              type="number"
              min={1}
              value={form.maxSizeMB}
              onChange={e => setForm(f => ({ ...f, maxSizeMB: Number(e.target.value) }))}
            />
            {errors.maxSizeMB && <p className="text-xs text-destructive">{errors.maxSizeMB}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxPerUser">Max Items per User</Label>
            <Input
              id="maxPerUser"
              type="number"
              min={1}
              value={form.maxPerUser}
              onChange={e => setForm(f => ({ ...f, maxPerUser: Number(e.target.value) }))}
            />
            {errors.maxPerUser && <p className="text-xs text-destructive">{errors.maxPerUser}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="maxUploadFiles">Max Files per Upload</Label>
            <Input
              id="maxUploadFiles"
              type="number"
              min={1}
              max={200}
              value={form.maxUploadFiles}
              onChange={e => setForm(f => ({ ...f, maxUploadFiles: Number(e.target.value) }))}
            />
            {errors.maxUploadFiles && (
              <p className="text-xs text-destructive">{errors.maxUploadFiles}</p>
            )}
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="shareDefaultMinutes">Share Default Duration (min)</Label>
              <Input
                id="shareDefaultMinutes"
                type="number"
                min={1}
                value={form.shareDefaultMinutes}
                onChange={e =>
                  setForm(f => ({ ...f, shareDefaultMinutes: Number(e.target.value) }))
                }
              />
              {errors.shareDefaultMinutes && (
                <p className="text-xs text-destructive">{errors.shareDefaultMinutes}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="shareMaxMinutes">Share Max Duration (min)</Label>
              <Input
                id="shareMaxMinutes"
                type="number"
                min={1}
                value={form.shareMaxMinutes}
                onChange={e => setForm(f => ({ ...f, shareMaxMinutes: Number(e.target.value) }))}
              />
              {errors.shareMaxMinutes && (
                <p className="text-xs text-destructive">{errors.shareMaxMinutes}</p>
              )}
            </div>
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="uploadAllowExts">Upload Allowlist (extensions, comma-separated)</Label>
            <Input
              id="uploadAllowExts"
              value={allowExtsText}
              onChange={e => setAllowExtsText(e.target.value)}
              onBlur={() => {
                const parsed = parseExtListInput(allowExtsText)
                setAllowExtsText(parsed.join(', '))
                setForm(f => ({ ...f, uploadAllowExts: parsed }))
              }}
              placeholder="yaml, yml, json, python"
            />
            <p className="text-xs text-muted-foreground">
              Examples: yaml, yml, json, python (python will be normalized to py).
            </p>
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="uploadDenyExts">Upload Denylist (extensions, comma-separated)</Label>
            <Input
              id="uploadDenyExts"
              value={denyExtsText}
              onChange={e => setDenyExtsText(e.target.value)}
              onBlur={() => {
                const parsed = parseExtListInput(denyExtsText)
                setDenyExtsText(parsed.join(', '))
                setForm(f => ({ ...f, uploadDenyExts: parsed }))
              }}
              placeholder="exe, dll, bat"
              disabled={parseExtListInput(allowExtsText).length > 0}
            />
            <p className="text-xs text-muted-foreground">Examples: exe, dll, bat, cmd.</p>
            {parseExtListInput(allowExtsText).length > 0 && (
              <p className="text-xs text-muted-foreground">
                Allowlist is set, so denylist is ignored.
              </p>
            )}
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="disallowedFolderNames">Disallowed Folder Names (comma-separated)</Label>
            <Input
              id="disallowedFolderNames"
              value={disallowedFolderNamesText}
              onChange={e => setDisallowedFolderNamesText(e.target.value)}
              placeholder="e.g. private, tmp, archive"
            />
            <p className="text-xs text-muted-foreground">
              Folder names users are not allowed to create at any level. Case-sensitive.
            </p>
          </div>
        </div>
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function ProxySection({
  proxyForm,
  proxyConsumers,
  proxyConsumerDefinitions,
  proxyRemoteShellOverrides,
  proxyNetworkSaving,
  proxyConsumersSaving,
  proxyRemoteShellSaving,
  proxyErrors,
  setProxyForm,
  setProxyConsumers,
  setProxyRemoteShellOverrides,
  saveProxyNetwork,
  saveProxyConsumers,
  saveProxyRemoteShell,
  onOpenHelp,
}: {
  proxyForm: ProxyNetwork
  proxyConsumers: ProxyConsumerItem[]
  proxyConsumerDefinitions: ProxyConsumerDefinition[]
  proxyRemoteShellOverrides: ProxyRemoteShellOverride[]
  proxyNetworkSaving: boolean
  proxyConsumersSaving: boolean
  proxyRemoteShellSaving: boolean
  proxyErrors: Partial<Record<'form' | 'consumers' | 'remoteShell' | keyof ProxyNetwork, string>>
  setProxyForm: React.Dispatch<React.SetStateAction<ProxyNetwork>>
  setProxyConsumers: React.Dispatch<React.SetStateAction<ProxyConsumerItem[]>>
  setProxyRemoteShellOverrides: React.Dispatch<React.SetStateAction<ProxyRemoteShellOverride[]>>
  saveProxyNetwork: (draft?: ProxyNetwork) => Promise<void>
  saveProxyConsumers: () => Promise<void>
  saveProxyRemoteShell: () => Promise<void>
  onOpenHelp?: () => void
}) {
  type ProxyConnectorOption = {
    id: string
    name: string
    is_enabled?: boolean
    endpoint?: string
    config?: Record<string, unknown>
  }

  const [connectors, setConnectors] = useState<ProxyConnectorOption[]>([])
  const [connectorsLoading, setConnectorsLoading] = useState(false)
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false)

  const loadConnectors = useCallback(async () => {
    setConnectorsLoading(true)
    try {
      const result = await pb.send<ProxyConnectorOption[]>('/api/connectors?kind=proxy', {
        method: 'GET',
      })
      setConnectors(Array.isArray(result) ? result : [])
    } catch {
      setConnectors([])
    } finally {
      setConnectorsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConnectors()
  }, [loadConnectors])

  const connectorOptions = useMemo(
    () =>
      connectors.map(connector => {
        const protocol =
          typeof connector.config?.protocol === 'string'
            ? connector.config.protocol.toUpperCase()
            : 'PROXY'
        const endpoint = typeof connector.endpoint === 'string' ? connector.endpoint : ''
        const enabled = connector.is_enabled !== false
        const disabledLabel = enabled ? '' : ' (disabled)'
        return {
          id: connector.id,
          protocol,
          label: endpoint
            ? `${connector.name}${disabledLabel} · ${protocol} · ${endpoint}`
            : `${connector.name}${disabledLabel} · ${protocol}`,
        }
      }),
    [connectors]
  )

  const validConnectorIDs = useMemo(
    () => new Set(connectorOptions.map(option => option.id)),
    [connectorOptions]
  )
  const socks5Options = useMemo(
    () => connectorOptions.filter(option => option.protocol === 'SOCKS5'),
    [connectorOptions]
  )
  const httpOptions = useMemo(
    () => connectorOptions.filter(option => option.protocol !== 'SOCKS5'),
    [connectorOptions]
  )
  const httpsOptions = useMemo(
    () => connectorOptions.filter(option => option.protocol !== 'SOCKS5'),
    [connectorOptions]
  )
  const missingSelections = {
    socks5ConnectorId:
      proxyForm.socks5ConnectorId && !validConnectorIDs.has(proxyForm.socks5ConnectorId)
        ? proxyForm.socks5ConnectorId
        : '',
    httpConnectorId:
      proxyForm.httpConnectorId && !validConnectorIDs.has(proxyForm.httpConnectorId)
        ? proxyForm.httpConnectorId
        : '',
    httpsConnectorId:
      proxyForm.httpsConnectorId && !validConnectorIDs.has(proxyForm.httpsConnectorId)
        ? proxyForm.httpsConnectorId
        : '',
  }
  const hasMissingSelections = Object.values(missingSelections).some(Boolean)
  const consumerModeMap = useMemo(
    () => new Map(proxyConsumers.map(item => [item.consumerKey, item.mode])),
    [proxyConsumers]
  )

  const buildOptionsForValue = (
    baseOptions: Array<{ id: string; label: string }>,
    missingValue: string
  ) => {
    if (!missingValue) {
      return baseOptions
    }
    return [{ id: missingValue, label: 'Previously selected resource was deleted' }, ...baseOptions]
  }

  const saveCurrentNetwork = () => {
    const draft: ProxyNetwork = {
      ...proxyForm,
      socks5ConnectorId: validConnectorIDs.has(proxyForm.socks5ConnectorId)
        ? proxyForm.socks5ConnectorId
        : '',
      httpConnectorId: validConnectorIDs.has(proxyForm.httpConnectorId)
        ? proxyForm.httpConnectorId
        : '',
      httpsConnectorId: validConnectorIDs.has(proxyForm.httpsConnectorId)
        ? proxyForm.httpsConnectorId
        : '',
    }
    void saveProxyNetwork(draft)
  }

  const updateProxySource = (source: ProxySource) => {
    setProxyForm(current => ({
      ...current,
      source,
      enabled: source === 'external' ? current.enabled : false,
    }))
  }

  const setConsumerMode = (consumerKey: string, mode: ProxyConsumerItem['mode']) => {
    setProxyConsumers(current => {
      const next = current.filter(item => item.consumerKey !== consumerKey)
      next.push({ consumerKey, mode })
      next.sort((left, right) => left.consumerKey.localeCompare(right.consumerKey))
      return next
    })
  }

  const configurableProxyConsumerDefinitions = proxyConsumerDefinitions.filter(
    definition => definition.enrollable
  )
  const remoteShellDefinition = proxyConsumerDefinitions.find(
    definition => definition.key === 'remote_shell.global'
  )
  const moduleProxyDefinitions = configurableProxyConsumerDefinitions.filter(
    definition => definition.key !== 'remote_shell.global'
  )
  const globalRemoteShellMode =
    (remoteShellDefinition && consumerModeMap.get(remoteShellDefinition.key)) ??
    remoteShellDefinition?.defaultMode ??
    'disabled'
  const [availableServers, setAvailableServers] = useState<Server[]>([])
  const [serversLoading, setServersLoading] = useState(true)
  const [serverToOverride, setServerToOverride] = useState('')

  const normalizeHost = (value: string) => {
    const trimmed = value.trim().toLowerCase()
    const withoutScheme = trimmed.replace(/^[a-z]+:\/\//, '')
    return withoutScheme.split('/')[0]?.split(':')[0] ?? ''
  }

  const isLoopbackHost = (value: string) => {
    const host = normalizeHost(value)
    return host === 'local' || host === 'localhost' || host === '127.0.0.1' || host === '::1'
  }

  const isLocalServer = useCallback((server: Server) => {
    if (server.id === 'local') {
      return true
    }
    if (typeof server.host === 'string' && isLoopbackHost(server.host)) {
      return true
    }
    const marker = server.is_local
    if (typeof marker === 'boolean') {
      return marker && (!server.host || isLoopbackHost(server.host))
    }
    if (typeof marker === 'string') {
      return marker.toLowerCase() === 'true' && (!server.host || isLoopbackHost(server.host))
    }
    return false
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const items = await listServers()
        if (active) {
          setAvailableServers(items)
        }
      } finally {
        if (active) {
          setServersLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const remoteServers = useMemo(
    () =>
      availableServers
        .filter(server => server.id && !isLocalServer(server))
        .sort((left, right) =>
          (left.name || left.host || left.id).localeCompare(right.name || right.host || right.id)
        ),
    [availableServers, isLocalServer]
  )
  const remoteShellOverrideMap = new Map(proxyRemoteShellOverrides.map(item => [item.serverId, item.mode]))
  const overrideableServers = remoteServers.filter(server => !remoteShellOverrideMap.has(server.id))

  useEffect(() => {
    if (serverToOverride && !overrideableServers.some(server => server.id === serverToOverride)) {
      setServerToOverride('')
    }
  }, [overrideableServers, serverToOverride])

  const addRemoteShellOverride = () => {
    const nextServerId = serverToOverride.trim()
    if (!nextServerId) return
    setProxyRemoteShellOverrides(current => {
      if (current.some(item => item.serverId === nextServerId)) {
        return current
      }
      return [...current, { serverId: nextServerId, mode: globalRemoteShellMode }].sort((left, right) => left.serverId.localeCompare(right.serverId))
    })
    setServerToOverride('')
  }

  const updateRemoteShellOverride = (serverId: string, mode: ProxyRemoteShellOverride['mode']) => {
    setProxyRemoteShellOverrides(current => current.map(item => (item.serverId === serverId ? { ...item, mode } : item)))
  }

  const removeRemoteShellOverride = (serverId: string) => {
    setProxyRemoteShellOverrides(current => current.filter(item => item.serverId !== serverId))
  }

  const formatServerOptionLabel = (server: Server) => {
    const name = String(server.name ?? '').trim()
    const host = String(server.host ?? '').trim()
    if (name && host) {
      return `${name} (${host})`
    }
    return name || host || server.id
  }

  const formatServerDisplay = (server: Server | undefined, fallbackServerId: string) => {
    const name = String(server?.name ?? '').trim()
    const host = String(server?.host ?? '').trim()
    return {
      name: name || host || fallbackServerId,
      host: name && host ? host : '',
    }
  }

  const modeLabel = (mode: string) => {
    switch (mode) {
      case 'always':
        return 'Always use proxy'
      default:
        return 'Disabled'
    }
  }

  const showExternalResources = proxyForm.source === 'external'
  const showModuleProxy = proxyForm.source === 'external'
  const showRemoteShell = proxyForm.source === 'external' || proxyForm.source === 'self'

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">Proxy resource from</h3>
            {onOpenHelp ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="Open Proxy help"
                onClick={onOpenHelp}
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="proxy-enabled-switch" className="text-sm text-muted-foreground">
              Proxy enabled
            </Label>
            <Toggle
              id="proxy-enabled-switch"
              ariaLabel="Toggle proxy enabled"
              checked={proxyForm.source !== 'none'}
              onChange={checked => updateProxySource(checked ? (proxyForm.source === 'none' ? 'external' : proxyForm.source) : 'none')}
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Choose where proxy capability comes from before configuring policy domains or remote shell behavior.
        </p>
      </div>

      <div className="rounded-lg border border-border/40 bg-background">
        <div className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            {[
              {
                value: 'external' as const,
                title: 'External Proxy',
                description: 'Apply external proxy resources to AppOS policy domains and remote shell.',
              },
              {
                value: 'self' as const,
                title: 'Self Proxy',
                description: 'Route remote shell through AppOS self-managed egress.',
              },
            ].map(option => {
              const active = proxyForm.source === option.value
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    active ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-foreground/30'
                  }`}
                >
                  <input
                    type="radio"
                    name="proxy-source"
                    className="mt-0.5 h-4 w-4 shrink-0"
                    checked={active}
                    onChange={() => updateProxySource(option.value)}
                  />
                  <span className="space-y-1">
                    <span className="block text-sm font-medium text-foreground">{option.title}</span>
                    <span className="block text-xs text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              )
            })}
          </div>

          {proxyForm.source === 'none' ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              Proxy is currently off. Choose External Proxy or Self Proxy to enable policy-based egress.
            </div>
          ) : null}

          {showExternalResources ? (
            <div className="space-y-4 px-1 py-1">
              {proxyErrors.form ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {proxyErrors.form}
                </div>
              ) : null}

              {hasMissingSelections ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                  One or more saved proxy resources were deleted. Choose available proxy options before saving.
                </div>
              ) : null}

              <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="socks5ConnectorId">SOCKS5 Proxy</Label>
                      <select
                        id="socks5ConnectorId"
                        className={selectClass}
                        value={proxyForm.socks5ConnectorId}
                        onChange={event => {
                          setProxyForm(current => ({
                            ...current,
                            socks5ConnectorId: event.target.value,
                          }))
                        }}
                        disabled={connectorsLoading || socks5Options.length === 0}
                      >
                        <option value="">No SOCKS5 proxy</option>
                        {buildOptionsForValue(socks5Options, missingSelections.socks5ConnectorId).map(
                          option => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          )
                        )}
                      </select>
                      <p className="text-xs text-muted-foreground">
                        When set, all outbound traffic uses SOCKS5 before any per-protocol proxy choice.
                      </p>
                      {proxyErrors.socks5ConnectorId ? (
                        <p className="text-xs text-destructive">{proxyErrors.socks5ConnectorId}</p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="httpConnectorId">HTTP Proxy</Label>
                      <select
                        id="httpConnectorId"
                        className={selectClass}
                        value={proxyForm.httpConnectorId}
                        onChange={event => {
                          setProxyForm(current => ({ ...current, httpConnectorId: event.target.value }))
                        }}
                        disabled={connectorsLoading || httpOptions.length === 0}
                      >
                        <option value="">No HTTP proxy</option>
                        {buildOptionsForValue(httpOptions, missingSelections.httpConnectorId).map(
                          option => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          )
                        )}
                      </select>
                      {proxyErrors.httpConnectorId ? (
                        <p className="text-xs text-destructive">{proxyErrors.httpConnectorId}</p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="httpsConnectorId">HTTPS Proxy</Label>
                      <select
                        id="httpsConnectorId"
                        className={selectClass}
                        value={proxyForm.httpsConnectorId}
                        onChange={event => {
                          setProxyForm(current => ({
                            ...current,
                            httpsConnectorId: event.target.value,
                          }))
                        }}
                        disabled={connectorsLoading || httpsOptions.length === 0}
                      >
                        <option value="">No HTTPS proxy</option>
                        {buildOptionsForValue(httpsOptions, missingSelections.httpsConnectorId).map(
                          option => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          )
                        )}
                      </select>
                      {proxyErrors.httpsConnectorId ? (
                        <p className="text-xs text-destructive">{proxyErrors.httpsConnectorId}</p>
                      ) : null}
                    </div>
              </div>

              {connectorsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading proxy connectors...
                </div>
              ) : connectorOptions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                  No proxy connectors yet. Use Add external proxy to create one.
                </div>
              ) : null}
            </div>
          ) : proxyForm.source === 'self' ? (
            <div className="px-1 py-1 text-sm text-muted-foreground">
              Self Proxy currently applies to remote shell egress policies.
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {showExternalResources ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 px-4"
                onClick={() => setProxyDialogOpen(true)}
              >
                Add external proxy
              </Button>
            ) : null}
            <Button type="button" className="h-9 px-4" onClick={saveCurrentNetwork} disabled={proxyNetworkSaving}>
              {proxyNetworkSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </div>

      {showModuleProxy ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-foreground">Proxy Policies</h3>
            <p className="text-xs text-muted-foreground">Configure AppOS policy domains that can use external proxy egress.</p>
          </div>
          <div className="rounded-lg border border-border/40 bg-background">
            <div className="space-y-4 p-4">
            {proxyErrors.consumers ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {proxyErrors.consumers}
              </div>
            ) : null}

            <div>
            <div className="grid grid-cols-[minmax(0,1.4fr)_180px_220px] gap-4 border-b border-border/80 bg-muted/45 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-foreground/70">
              <span>Name</span>
              <span>Default</span>
              <span>Setting</span>
            </div>
            {moduleProxyDefinitions.map(definition => {
              const currentMode = consumerModeMap.get(definition.key) ?? 'disabled'
              return (
                <div
                  key={definition.key}
                  className="grid grid-cols-[minmax(0,1.4fr)_180px_220px] items-center gap-4 border-t border-border/60 px-4 py-3 first:border-t-0"
                >
                  <div className="min-w-0 pr-4">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm font-medium text-foreground cursor-help">{definition.title}</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p>{definition.description}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="text-sm text-muted-foreground">{modeLabel(definition.defaultMode)}</div>
                  <div className="w-full max-w-[220px]">
                    <select
                      id={`proxy-consumer-${definition.key}`}
                      className={selectClass}
                      value={currentMode}
                      onChange={event =>
                        setConsumerMode(
                          definition.key,
                          event.target.value as ProxyConsumerItem['mode']
                        )
                      }
                    >
                      {definition.allowedModes.map(mode => (
                        <option key={mode} value={mode}>
                          {modeLabel(mode)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
            </div>

            <SaveButton onClick={() => void saveProxyConsumers()} saving={proxyConsumersSaving} compact />
            </div>
          </div>
        </div>
      ) : null}

      {showRemoteShell ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-foreground">Remote Shell Proxy</h3>
            <p className="text-xs text-muted-foreground">Proxy configurations for remote server shell execution</p>
          </div>
          <div className="rounded-lg border border-border/40 bg-background">
            <div className="space-y-4 p-4">
            <div className="space-y-4 bg-muted/20 px-4 py-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Global remote shell policy</p>
                  <p className="text-xs text-muted-foreground">
                    Applies to all remote servers unless a server-specific override is configured below.
                  </p>
                </div>
                <div className="max-w-[320px]">
                  <select
                    id="proxy-remote-shell-global"
                    className={selectClass}
                    value={globalRemoteShellMode}
                    onChange={event => setConsumerMode('remote_shell.global', event.target.value as ProxyConsumerItem['mode'])}
                  >
                    {(remoteShellDefinition?.allowedModes ?? ['disabled', 'always']).map(mode => (
                      <option key={mode} value={mode}>
                        {modeLabel(mode)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {proxyErrors.remoteShell ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {proxyErrors.remoteShell}
              </div>
            ) : null}

            <div className="space-y-4 bg-muted/20 px-4 py-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Server-specific overrides</p>
                  <p className="text-xs text-muted-foreground">
                    Choose individual servers to override the global remote shell proxy policy. Per-server overrides take precedence.
                  </p>
                </div>

                <div className="flex flex-col gap-2 lg:flex-row">
                  <select
                    id="proxy-remote-shell-server-select"
                    className={selectClass}
                    aria-label="Select a server"
                    value={serverToOverride}
                    onChange={event => setServerToOverride(event.target.value)}
                    disabled={serversLoading || overrideableServers.length === 0}
                  >
                    <option value="">-- Select a server --</option>
                    {overrideableServers.map(server => (
                      <option key={server.id} value={server.id}>
                        {formatServerOptionLabel(server)}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="outline" className="h-9 px-4" onClick={addRemoteShellOverride} disabled={!serverToOverride}>
                    Add override
                  </Button>
                </div>

                {!serversLoading && remoteServers.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                    No remote servers are available yet.
                  </div>
                ) : null}

                {serversLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading servers...
                  </div>
                ) : null}

                {proxyRemoteShellOverrides.length > 0 ? (
                  <div className="divide-y divide-border/60">
                    {proxyRemoteShellOverrides.map(item => {
                      const server = remoteServers.find(candidate => candidate.id === item.serverId)
                      const serverDisplay = formatServerDisplay(server, item.serverId)
                      return (
                        <div key={item.serverId} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 space-y-1 pr-4">
                            <p className="text-sm font-semibold text-foreground">
                              {serverDisplay.name}
                            </p>
                            {serverDisplay.host ? (
                              <p className="text-sm text-muted-foreground">{serverDisplay.host}</p>
                            ) : null}
                          </div>
                          <div className="flex w-full max-w-[320px] gap-2">
                            <select
                              className={selectClass}
                              value={item.mode}
                              onChange={event => updateRemoteShellOverride(item.serverId, event.target.value as ProxyRemoteShellOverride['mode'])}
                            >
                              {(remoteShellDefinition?.allowedModes ?? ['disabled', 'always']).map(mode => (
                                <option key={mode} value={mode}>
                                  {modeLabel(mode)}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-9 border-border/70 bg-background/80 px-3 text-muted-foreground hover:border-foreground/20 hover:bg-muted/40 hover:text-foreground"
                              onClick={() => removeRemoteShellOverride(item.serverId)}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                    No server-specific overrides yet. Global remote shell policy applies to all remote servers.
                  </div>
                )}
              </div>
            </div>
            <SaveButton onClick={() => void saveProxyRemoteShell()} saving={proxyRemoteShellSaving} compact />
            </div>
          </div>
        </div>
      ) : null}

      <ProxyConnectorDialog
        open={proxyDialogOpen}
        onOpenChange={setProxyDialogOpen}
        initialProtocol="http"
        onCreated={connector => {
          setConnectors(current => {
            const next = current.filter(item => item.id !== connector.id)
            next.push({
              id: connector.id,
              name: String(connector.name ?? ''),
              is_enabled:
                typeof connector.is_enabled === 'boolean' ? connector.is_enabled : true,
              endpoint: typeof connector.endpoint === 'string' ? connector.endpoint : '',
              config:
                connector.config && typeof connector.config === 'object'
                  ? (connector.config as Record<string, unknown>)
                  : {},
            })
            next.sort((left, right) => left.name.localeCompare(right.name))
            return next
          })
          void loadConnectors()
        }}
      />
    </div>
  )
}

export function TopicsSection({
  shareEntry,
  commentPolicyEntry,
  importPolicyEntry,
  shareForm,
  shareErrors,
  shareSaving,
  setShareForm,
  saveShare,
  commentPolicyForm,
  commentPolicyErrors,
  commentPolicySaving,
  setCommentPolicyForm,
  saveCommentPolicy,
  importPolicyForm,
  importPolicyErrors,
  importPolicySaving,
  setImportPolicyForm,
  saveImportPolicy,
}: {
  shareEntry: SettingsSchemaEntry
  commentPolicyEntry: SettingsSchemaEntry
  importPolicyEntry: SettingsSchemaEntry
  shareForm: TopicShare
  shareErrors: Partial<Record<keyof TopicShare, string>>
  shareSaving: boolean
  setShareForm: React.Dispatch<React.SetStateAction<TopicShare>>
  saveShare: () => void
  commentPolicyForm: TopicCommentPolicy
  commentPolicyErrors: Partial<Record<keyof TopicCommentPolicy, string>>
  commentPolicySaving: boolean
  setCommentPolicyForm: React.Dispatch<React.SetStateAction<TopicCommentPolicy>>
  saveCommentPolicy: () => void
  importPolicyForm: TopicImportPolicy
  importPolicyErrors: Partial<Record<keyof TopicImportPolicy, string>>
  importPolicySaving: boolean
  setImportPolicyForm: React.Dispatch<React.SetStateAction<TopicImportPolicy>>
  saveImportPolicy: () => void
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Topic Share</CardTitle>
          <CardDescription>
            Control the default and maximum lifetime of public topic share links.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {renderSchemaNumberFields<TopicShare, keyof TopicShare & string>({
              entry: shareEntry,
              form: shareForm,
              errors: shareErrors,
              setForm: setShareForm,
              fieldOptions: {
                shareDefaultMinutes: { inputId: 'topicShareDefaultMinutes', min: 1 },
                shareMaxMinutes: { inputId: 'topicShareMaxMinutes', min: 1 },
              },
            })}
          </div>
          <SaveButton onClick={saveShare} saving={shareSaving} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Topic Comment Policy</CardTitle>
          <CardDescription>
            Configure guest comment availability and text limits for shared topics.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="space-y-1">
                <Label htmlFor="topicAllowGuestComments">Allow Guest Comments</Label>
              </div>
              <Toggle
                id="topicAllowGuestComments"
                ariaLabel="Allow Guest Comments"
                checked={commentPolicyForm.allowGuestComments}
                onChange={checked =>
                  setCommentPolicyForm(current => ({ ...current, allowGuestComments: checked }))
                }
              />
            </div>
            {commentPolicyErrors.allowGuestComments && (
              <p className="text-xs text-destructive">{commentPolicyErrors.allowGuestComments}</p>
            )}
            {renderSchemaTextFields<TopicCommentPolicy, keyof TopicCommentPolicy & string>({
              entry: commentPolicyEntry,
              form: commentPolicyForm,
              errors: commentPolicyErrors,
              setForm: setCommentPolicyForm,
              fieldOptions: {
                defaultGuestName: {
                  inputId: 'topicDefaultGuestName',
                  placeholder: 'Guest',
                },
              },
            })}
            <div className="grid grid-cols-2 gap-4">
              {renderSchemaNumberFields<TopicCommentPolicy, keyof TopicCommentPolicy & string>({
                entry: commentPolicyEntry,
                form: commentPolicyForm,
                errors: commentPolicyErrors,
                setForm: setCommentPolicyForm,
                fieldOptions: {
                  maxGuestNameLength: { inputId: 'topicMaxGuestNameLength', min: 1 },
                  maxCommentBodyLength: { inputId: 'topicMaxCommentBodyLength', min: 1 },
                },
              })}
            </div>
          </div>
          <SaveButton onClick={saveCommentPolicy} saving={commentPolicySaving} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Topic Description Import</CardTitle>
          <CardDescription>
            Control the maximum imported file size and whether topic description imports must stay
            text-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              {renderSchemaNumberFields<TopicImportPolicy, keyof TopicImportPolicy & string>({
                entry: importPolicyEntry,
                form: importPolicyForm,
                errors: importPolicyErrors,
                setForm: setImportPolicyForm,
                fieldOptions: {
                  maxDescriptionImportKB: {
                    inputId: 'topicMaxDescriptionImportKB',
                    min: 1,
                  },
                },
              })}
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="space-y-1">
                <Label htmlFor="topicImportTextOnly">Text-only Imports</Label>
              </div>
              <Toggle
                id="topicImportTextOnly"
                ariaLabel="Text-only Imports"
                checked={importPolicyForm.textOnly}
                onChange={checked =>
                  setImportPolicyForm(current => ({ ...current, textOnly: checked }))
                }
              />
            </div>
            {importPolicyErrors.textOnly && (
              <p className="text-xs text-destructive">{importPolicyErrors.textOnly}</p>
            )}
          </div>
          <SaveButton onClick={saveImportPolicy} saving={importPolicySaving} />
        </CardContent>
      </Card>
    </div>
  )
}

export function ConnectTerminalSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: ConnectTerminalGroup
  errors: Partial<Record<keyof ConnectTerminalGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<ConnectTerminalGroup>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>Connection policy for Connect terminal sessions</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {renderSchemaNumberFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              idleTimeoutSeconds: {
                inputId: 'connectIdleTimeout',
                min: 60,
              },
              maxConnections: {
                inputId: 'connectMaxConnections',
                min: 0,
              },
            },
          })}
        </div>
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function ConnectSftpSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: ConnectSftpGroup
  errors: Partial<Record<keyof ConnectSftpGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<ConnectSftpGroup>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>File upload limits for SFTP connections</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {renderSchemaNumberFields({
          entry,
          form,
          errors,
          setForm,
          fieldOptions: {
            maxUploadFiles: {
              inputId: 'sftpMaxUploadFiles',
              min: 1,
            },
          },
        })}
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function DeployPreflightSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: DeployPreflightGroup
  errors: Partial<Record<keyof DeployPreflightGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<DeployPreflightGroup>>
  save: () => void
}) {
  const minFreeDiskField = entry.fields.find(field => field.id === 'minFreeDiskGiB')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>Reserve free disk before deploy starts.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm space-y-1">
          <Label htmlFor="deployMinFreeDiskGiB">
            {minFreeDiskField?.label ?? 'Minimum Free Disk (GiB)'}
          </Label>
          <Input
            id="deployMinFreeDiskGiB"
            type="number"
            min={0.5}
            step={0.1}
            value={form.minFreeDiskGiB}
            onChange={event =>
              setForm(current => ({
                ...current,
                minFreeDiskGiB: Number(event.target.value),
              }))
            }
          />
          <p className="text-xs text-muted-foreground">
            {minFreeDiskField?.helpText ?? 'Floor 0.5 GiB. Default 1 GiB.'}
          </p>
          {errors.minFreeDiskGiB && (
            <p className="text-xs text-destructive">{errors.minFreeDiskGiB}</p>
          )}
        </div>
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function DeployRuntimeSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: DeployRuntimeGroup
  errors: Partial<Record<keyof DeployRuntimeGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<DeployRuntimeGroup>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>Set pull, startup, and health-check waits.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {renderSchemaNumberFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              imagePullTimeoutSeconds: { inputId: 'imagePullTimeoutSeconds', min: 1 },
              composeUpTimeoutSeconds: { inputId: 'composeUpTimeoutSeconds', min: 1 },
              healthCheckTimeoutSeconds: { inputId: 'healthCheckTimeoutSeconds', min: 1 },
              runtimePullIdleHeartbeatSeconds: {
                inputId: 'runtimePullIdleHeartbeatSeconds',
                min: 1,
              },
            },
          })}
        </div>
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function DeployGitDefaultsSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: DeployGitDefaultsGroup
  errors: Partial<Record<keyof DeployGitDefaultsGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<DeployGitDefaultsGroup>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>Set the default ref and compose path.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {renderSchemaTextFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              defaultRef: { inputId: 'defaultRef', placeholder: 'main' },
              defaultComposePath: {
                inputId: 'defaultComposePath',
                placeholder: 'docker-compose.yml',
              },
            },
          })}
        </div>
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function IacFilesSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: IacFilesGroup
  errors: Partial<Record<keyof IacFilesGroup, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<IacFilesGroup>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>
          Limits for IaC file reading and uploads in the workspace browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4">
          {renderSchemaNumberFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              maxSizeMB: {
                inputId: 'iac-max-size-mb',
                min: 1,
              },
              maxZipSizeMB: {
                inputId: 'iac-max-zip-size-mb',
                min: 1,
              },
            },
          })}
          {renderSchemaTextFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              extensionBlacklist: {
                inputId: 'iac-extension-blacklist',
                placeholder: '.exe,.dll,.so',
              },
            },
          })}
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function TunnelSection({
  entry,
  form,
  errors,
  saving,
  setForm,
  save,
}: {
  entry: SettingsSchemaEntry
  form: TunnelPortRange
  errors: Partial<Record<keyof TunnelPortRange, string>>
  saving: boolean
  setForm: React.Dispatch<React.SetStateAction<TunnelPortRange>>
  save: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{entry.title}</CardTitle>
        <CardDescription>Port pool range for reverse tunnel allocation</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {renderSchemaNumberFields({
            entry,
            form,
            errors,
            setForm,
            fieldOptions: {
              start: {
                inputId: 'tunnelPortRangeStart',
                min: 1,
                max: 65535,
              },
              end: {
                inputId: 'tunnelPortRangeEnd',
                min: 1,
                max: 65535,
              },
            },
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Changes affect future startup and allocation behavior only. Active tunnel sessions are not
          reconfigured in place.
        </p>
        <SaveButton onClick={save} saving={saving} />
      </CardContent>
    </Card>
  )
}

export function SecretsSection({
  secretPolicy,
  secretPolicyErrors,
  secretPolicySaving,
  setSecretPolicy,
  saveSecretPolicy,
}: {
  secretPolicy: SecretPolicy
  secretPolicyErrors: SecretPolicyErrors
  secretPolicySaving: boolean
  setSecretPolicy: React.Dispatch<React.SetStateAction<SecretPolicy>>
  saveSecretPolicy: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Secrets</CardTitle>
        <CardDescription>Global reveal restrictions and default secret behavior</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Toggle
            id="secretsRevealDisabled"
            checked={secretPolicy.revealDisabled}
            onChange={revealDisabled => setSecretPolicy(policy => ({ ...policy, revealDisabled }))}
          />
          <Label htmlFor="secretsRevealDisabled">Disable all reveal actions</Label>
        </div>
        {secretPolicyErrors.revealDisabled && (
          <p className="text-xs text-destructive">{secretPolicyErrors.revealDisabled}</p>
        )}

        <div className="space-y-1">
          <Label htmlFor="secretsDefaultAccessMode">Default Access Mode</Label>
          <select
            id="secretsDefaultAccessMode"
            className={selectClass}
            value={secretPolicy.defaultAccessMode}
            onChange={e =>
              setSecretPolicy(policy => ({ ...policy, defaultAccessMode: e.target.value }))
            }
          >
            {SECRET_ACCESS_MODE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {secretPolicyErrors.defaultAccessMode && (
            <p className="text-xs text-destructive">{secretPolicyErrors.defaultAccessMode}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="clipboardClearSeconds">Clipboard Clear Delay (seconds)</Label>
          <Input
            id="clipboardClearSeconds"
            type="number"
            min={0}
            value={secretPolicy.clipboardClearSeconds}
            onChange={e =>
              setSecretPolicy(policy => ({
                ...policy,
                clipboardClearSeconds: Number(e.target.value),
              }))
            }
          />
          <p className="text-xs text-muted-foreground">0 disables automatic clipboard clearing.</p>
          {secretPolicyErrors.clipboardClearSeconds && (
            <p className="text-xs text-destructive">{secretPolicyErrors.clipboardClearSeconds}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="maxAgeDays">Max Age (days)</Label>
          <Input
            id="maxAgeDays"
            type="number"
            min={0}
            value={secretPolicy.maxAgeDays}
            onChange={e =>
              setSecretPolicy(policy => ({ ...policy, maxAgeDays: Number(e.target.value) }))
            }
          />
          <p className="text-xs text-muted-foreground">
            0 means secrets never expire. When set, new secrets will automatically receive an expiry
            date.
          </p>
          {secretPolicyErrors.maxAgeDays && (
            <p className="text-xs text-destructive">{secretPolicyErrors.maxAgeDays}</p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="warnBeforeExpiryDays">Expiry Warning (days)</Label>
          <Input
            id="warnBeforeExpiryDays"
            type="number"
            min={0}
            value={secretPolicy.warnBeforeExpiryDays}
            onChange={e =>
              setSecretPolicy(policy => ({
                ...policy,
                warnBeforeExpiryDays: Number(e.target.value),
              }))
            }
          />
          <p className="text-xs text-muted-foreground">
            Show an expiry warning this many days before a secret expires. 0 disables the warning.
          </p>
          {secretPolicyErrors.warnBeforeExpiryDays && (
            <p className="text-xs text-destructive">{secretPolicyErrors.warnBeforeExpiryDays}</p>
          )}
        </div>

        <SaveButton onClick={saveSecretPolicy} saving={secretPolicySaving} />
      </CardContent>
    </Card>
  )
}
