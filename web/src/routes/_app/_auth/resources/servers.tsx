import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { PlugZap, Loader2, Cable, Link as LinkIcon, RotateCcw, Power, RefreshCw, CircleHelp, PanelRight, MoreVertical } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ResourcePage, type Column, type FieldDef } from '@/components/resources/ResourcePage'
import { TunnelSetupWizard } from '@/components/servers/TunnelSetupWizard'
import { SecretCreateDialog } from '@/components/secrets/SecretCreateDialog'
import { SecretForm, type SecretTemplate } from '@/components/secrets/SecretForm'
import { MonitorTargetPanel } from '@/components/monitor/MonitorTargetPanel'
import { ServerSoftwarePanel } from '@/components/servers/ServerSoftwarePanel'
import { useAuth } from '@/contexts/AuthContext'
import { formatCreator } from '@/lib/groups'
import { pb } from '@/lib/pb'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  checkServerStatus as pingServerStatus,
  getLocalDockerBridgeAddress,
  getSystemdStatus,
  installMonitorAgent,
  serverPower,
  updateMonitorAgent,
} from '@/lib/connect-api'

// Template-id → display alias used in the credential dropdown
const TEMPLATE_ALIASES: Record<string, string> = {
  single_value: 'Password',
  ssh_key: 'SSH Key',
}
const ALLOWED_TEMPLATES = new Set(Object.keys(TEMPLATE_ALIASES))

function buildDefaultCredentialSecretName() {
  return `server-credential-${Date.now().toString().slice(-6)}`
}

function buildDefaultServerName() {
  return `server-${Date.now().toString().slice(-6)}`
}

function HelpPopoverButton({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-5 w-5 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        className="w-64 text-xs leading-5"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

function normalizePort(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null
  }

  return parsed
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function isNonEmptyDateValue(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : Boolean(value)
}

function tunnelNeedsSetup(item: Record<string, unknown>): boolean {
  if (item.connect_type !== 'tunnel') return false
  const tunnel = asObject(item.tunnel)
  if (tunnel) {
    return String(tunnel.state ?? '') === 'setup_required'
  }
  return !isNonEmptyDateValue(item.tunnel_connected_at) &&
    !isNonEmptyDateValue(item.tunnel_last_seen) &&
    !isNonEmptyDateValue(item.tunnel_disconnect_at)
}

function accessLabel(status: string): string {
  if (status === 'online') return 'Available'
  if (status === 'offline') return 'Unavailable'
  return 'Unknown'
}

function formatSecretLabel(raw: Record<string, unknown>): string {
  const name = String(raw.name ?? raw.id)
  const tid = String(raw.template_id ?? '')
  const alias = TEMPLATE_ALIASES[tid]
  return alias ? `${name}  (${alias})` : name
}

function tunnelStateLabel(state: string): string {
  if (state === 'setup_required') return 'Setup Required'
  if (state === 'paused') return 'Paused'
  return 'Ready'
}

type ServerConnectionState =
  | 'not_configured'
  | 'awaiting_connection'
  | 'online'
  | 'paused'
  | 'needs_attention'

function connectionStateLabel(state: ServerConnectionState): string {
  switch (state) {
    case 'not_configured':
      return 'Not Configured'
    case 'awaiting_connection':
      return 'Awaiting Connection'
    case 'online':
      return 'Online'
    case 'paused':
      return 'Paused'
    case 'needs_attention':
      return 'Needs Attention'
  }
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return '—'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return String(value)
  }
  return parsed.toLocaleString()
}

function parseTunnelServices(value: unknown): Array<{ service_name: string; tunnel_port: number }> {
  try {
    if (typeof value === 'string' && value !== '' && value !== 'null') {
      return JSON.parse(value) as Array<{ service_name: string; tunnel_port: number }>
    }
    if (Array.isArray(value)) {
      return value as Array<{ service_name: string; tunnel_port: number }>
    }
  } catch {
    return []
  }
  return []
}

async function listServerItems(currentUserId?: string, currentUserEmail?: string) {
  const response = await pb.send<{ items?: Array<Record<string, unknown>> }>('/api/servers/connection', {
	method: 'GET',
  })
  return (response.items ?? []).map(item => {
    const createdBy = String(item.created_by ?? '')
    const createdByName = String(item.created_by_name ?? '').trim()
    return {
      ...item,
      created_by_display:
        createdByName || formatCreator(createdBy, currentUserId, currentUserEmail),
    }
  })
}

const fields: FieldDef[] = [
  {
    key: 'connect_type',
    label: 'Connection Type',
    type: 'select',
    hideLabel: true,
    options: [
      { label: 'Direct SSH', value: 'direct' },
      { label: 'Reverse Tunnel', value: 'tunnel' },
    ],
    defaultValue: 'direct',
    render: ({ field, value, setValue, updateField }) => {
      const options = field.options ?? []
      const currentValue = String(value || field.defaultValue || 'direct')
      const descriptions: Record<string, string> = {
        direct: 'AppOS reaches this server over SSH.',
        tunnel: 'Server connects back from a private network.',
      }

      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-foreground">Connection Type</label>
            <HelpPopoverButton label="Connection type help">
              Choose how the managed server connects to AppOS.
            </HelpPopoverButton>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {options.map(option => {
              const selected = option.value === currentValue
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cn(
                    'cursor-pointer select-none rounded-2xl border px-4 py-4 text-left transition-colors',
                    selected
                      ? 'border-foreground bg-accent/40 shadow-sm'
                      : 'border-border bg-background hover:bg-muted/50'
                  )}
                  onMouseDown={event => event.preventDefault()}
                  onClick={event => {
                    if (option.value !== 'direct') {
                      updateField('use_local_host', false)
                    }
                    setValue(option.value)
                    event.currentTarget.blur()
                  }}
                >
                  <div className="flex items-center gap-3 text-sm font-medium text-foreground">
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full border',
                        selected ? 'border-foreground' : 'border-muted-foreground/50'
                      )}
                    >
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full bg-foreground transition-opacity',
                          selected ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                    </span>
                    {option.label}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground md:whitespace-nowrap">
                    {descriptions[option.value]}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      )
    },
  },
  { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'my-server' },
  { key: 'host', label: 'Host', type: 'text', placeholder: '192.168.1.1', showWhen: { field: 'connect_type', values: ['direct'] } },
  { key: 'use_local_host', label: 'Use local host', type: 'boolean', hidden: true, defaultValue: false },
  { key: 'port', label: 'Port', type: 'number', defaultValue: 22, showWhen: { field: 'connect_type', values: ['direct'] } },
  { key: 'user', label: 'User', type: 'text', required: true, placeholder: 'root' },
  {
    key: 'credential',
    label: 'Credential (Secret)',
    type: 'relation',
    relationApiPath:
      "/api/collections/secrets/records?filter=(status='active'%26%26(template_id='single_value'||template_id='ssh_key'))&sort=name",
    relationLabelKey: 'name',
    relationFormatLabel: formatSecretLabel,
  },
  { key: 'description', label: 'Description', type: 'textarea' },
]

export function ServersPage() {
  const { create, returnGroup, returnType, edit, server, tab } = Route.useSearch()
  const { user } = useAuth()
  const autoCreate = create === '1' || !!returnGroup
  const navigate = Route.useNavigate()
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const [wizardServerId, setWizardServerId] = useState<string | null>(null)
  const [selectedServerId, setSelectedServerId] = useState<string | undefined>(server)
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set())
  const [connectingOpen, setConnectingOpen] = useState(false)
  const [connectingTarget, setConnectingTarget] = useState('')
  const [connectingPhase, setConnectingPhase] = useState<'checking' | 'offline'>('checking')
  const [connectingDetail, setConnectingDetail] = useState('')
  const [powerDialogOpen, setPowerDialogOpen] = useState(false)
  const [powerTarget, setPowerTarget] = useState<Record<string, unknown> | null>(null)
  const [powerAction, setPowerAction] = useState<'restart' | 'shutdown'>('restart')
  const [powerSubmitting, setPowerSubmitting] = useState(false)
  const [powerError, setPowerError] = useState('')
  const [pingResults, setPingResults] = useState<Record<string, 'online' | 'offline'>>({})

  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [dockerBridgeHost, setDockerBridgeHost] = useState('')
  const [dockerBridgeLoading, setDockerBridgeLoading] = useState(false)
  const [dockerBridgeError, setDockerBridgeError] = useState('')
  const [secretAddOption, setSecretAddOption] = useState<
    ((id: string, label: string) => void) | null
  >(null)
  const [secretEditOpen, setSecretEditOpen] = useState(false)
  const [secretEditLoading, setSecretEditLoading] = useState(false)
  const [secretEditSaving, setSecretEditSaving] = useState(false)
  const [secretEditError, setSecretEditError] = useState('')
  const [secretEditId, setSecretEditId] = useState('')
  const [secretEditName, setSecretEditName] = useState('')
  const [secretEditDescription, setSecretEditDescription] = useState('')
  const [secretEditTemplateId, setSecretEditTemplateId] = useState('')
  const [secretEditPayload, setSecretEditPayload] = useState<Record<string, string>>({})
  const [secretEditTemplates, setSecretEditTemplates] = useState<SecretTemplate[]>([])
  const defaultCredentialSecretName = useCallback(() => buildDefaultCredentialSecretName(), [])

  const loadAllowedSecretTemplates = useCallback(async () => {
    const data = await pb.send<SecretTemplate[]>('/api/secrets/templates', { method: 'GET' })
    return (Array.isArray(data) ? data : [])
      .filter(template => ALLOWED_TEMPLATES.has(template.id))
      .map(template => ({
        ...template,
        label: TEMPLATE_ALIASES[template.id] ?? template.label,
      }))
  }, [])

  const loadDockerBridgeHost = useCallback(async () => {
    setDockerBridgeLoading(true)
    setDockerBridgeError('')
    try {
      const address = await getLocalDockerBridgeAddress()
      setDockerBridgeHost(address)
      return address
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load docker0 address'
      setDockerBridgeError(message)
      return ''
    } finally {
      setDockerBridgeLoading(false)
    }
  }, [])

  function sanitizeServerPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const next = { ...payload }
    delete next.use_local_host
      if (String(next.connect_type ?? 'direct') === 'tunnel') {
        delete next.host
        delete next.port
      }
    return next
  }

  const getStatusValue = useCallback(
    (item: Record<string, unknown>) => {
      const id = String(item.id ?? '')
      if (pingResults[id]) return pingResults[id]
      const access = asObject(item.access)
      const raw = String(access?.status ?? '').toLowerCase()
      if (raw === 'available') return 'online'
      if (raw === 'unavailable') return 'offline'
      return item.connect_type === 'tunnel' ? 'offline' : 'unknown'
    },
    [pingResults]
  )

  const getTunnelValue = useCallback((item: Record<string, unknown>) => {
    if (item.connect_type !== 'tunnel') return 'none'
    const tunnel = asObject(item.tunnel)
    const raw = String(tunnel?.state ?? '').toLowerCase()
    if (raw === 'setup_required' || raw === 'paused' || raw === 'ready') return raw
    return tunnelNeedsSetup(item) ? 'setup_required' : 'ready'
  }, [])

  const getConnectionState = useCallback(
    (item: Record<string, unknown>): ServerConnectionState => {
      const isTunnel = item.connect_type === 'tunnel'
      const access = asObject(item.access)
      const status = getStatusValue(item)
      const tunnelState = getTunnelValue(item)

      if (isTunnel) {
        if (tunnelState === 'setup_required') return 'not_configured'
        if (tunnelState === 'paused') return 'paused'
        if (status === 'online') return 'online'
        if (String(access?.reason ?? '') === 'waiting_for_first_connect') return 'awaiting_connection'
        return 'needs_attention'
      }

      const hasConfig =
        String(item.host ?? '').trim() !== '' &&
        normalizePort(item.port) !== null &&
        String(item.user ?? '').trim() !== '' &&
        String(item.credential ?? '').trim() !== ''

      if (!hasConfig) return 'not_configured'
      if (status === 'online') return 'online'
      if (status === 'offline') return 'needs_attention'
      return 'awaiting_connection'
    },
    [getStatusValue, getTunnelValue]
  )

  const getConnectionReason = useCallback(
    (item: Record<string, unknown>) => {
      const state = getConnectionState(item)
      const access = asObject(item.access)
      const tunnel = asObject(item.tunnel)
      const reason = String(access?.reason ?? '')

      if (state === 'not_configured') {
        return item.connect_type === 'tunnel'
          ? 'Tunnel setup has not started.'
          : 'Complete SSH details before verification.'
      }
      if (state === 'awaiting_connection') {
        return item.connect_type === 'tunnel'
          ? 'Waiting for the first tunnel callback.'
          : 'Configuration is ready for verification.'
      }
      if (state === 'online') {
        return item.connect_type === 'tunnel'
          ? 'Tunnel session is active.'
          : 'SSH access is reachable.'
      }
      if (state === 'paused') {
        return 'Reconnect is intentionally paused.'
      }

      if (reason === 'tcp_connect_failed') return 'AppOS cannot reach this server.'
      if (reason === 'server_host_empty') return 'Server host is missing.'
      if (reason === 'tunnel_offline') return 'Tunnel session is offline.'

      return String(tunnel?.reason ?? '').trim() || 'This connection needs attention.'
    },
    [getConnectionState]
  )

  const getEndpointSummary = useCallback((item: Record<string, unknown>) => {
    if (item.connect_type === 'tunnel') {
      return 'via AppOS tunnel'
    }
    const host = String(item.host ?? '').trim()
    const port = normalizePort(item.port)
    if (!host) return '—'
    return `${host}:${port ?? 22}`
  }, [])

  const getIdentitySummary = useCallback((item: Record<string, unknown>) => {
    const user = String(item.user ?? '').trim() || '—'
    const credentialType = String(item.credential_type ?? '').trim() || (item.connect_type === 'tunnel' ? 'Tunnel' : 'Credential')
    return `${user} · ${credentialType}`
  }, [])

  const getLastActivityLabel = useCallback((item: Record<string, unknown>) => {
    const access = asObject(item.access)
    const tunnel = asObject(item.tunnel)
    return formatTimestamp(access?.checked_at ?? tunnel?.last_seen ?? tunnel?.connected_at)
  }, [])

  const openSecretDialog = useCallback(
    (callbacks: { addOption: (id: string, label: string) => void }) => {
      setSecretAddOption(() => callbacks.addOption)
      setSecretDialogOpen(true)
    },
    []
  )

  const openSecretEditor = useCallback(
    async (secretId: string) => {
      setSecretEditOpen(true)
      setSecretEditLoading(true)
      setSecretEditSaving(false)
      setSecretEditError('')
      setSecretEditId(secretId)
      setSecretEditPayload({})

      try {
        const [secret, templates] = await Promise.all([
          pb.collection('secrets').getOne(secretId),
          loadAllowedSecretTemplates(),
        ])

        setSecretEditTemplates(templates)
        setSecretEditName(String(secret.name ?? ''))
        setSecretEditDescription(String(secret.description ?? ''))
        setSecretEditTemplateId(String(secret.template_id ?? ''))
      } catch (error) {
        setSecretEditError(error instanceof Error ? error.message : 'Failed to load secret')
      } finally {
        setSecretEditLoading(false)
      }
    },
    [loadAllowedSecretTemplates]
  )

  const closeSecretEditor = useCallback((open: boolean) => {
    setSecretEditOpen(open)
    if (!open) {
      setSecretEditLoading(false)
      setSecretEditSaving(false)
      setSecretEditError('')
      setSecretEditId('')
      setSecretEditName('')
      setSecretEditDescription('')
      setSecretEditTemplateId('')
      setSecretEditPayload({})
      setSecretEditTemplates([])
    }
  }, [])

  const handleSecretEditSave = useCallback(async () => {
    if (!secretEditId) {
      return
    }
    if (!secretEditName.trim()) {
      setSecretEditError('Name is required')
      return
    }

    setSecretEditSaving(true)
    setSecretEditError('')
    try {
      await pb.collection('secrets').update(secretEditId, {
        name: secretEditName.trim(),
        description: secretEditDescription.trim(),
      })

      const payloadHasValues = Object.values(secretEditPayload).some(value => value.trim() !== '')
      if (payloadHasValues) {
        await pb.send(`/api/secrets/${secretEditId}/payload`, {
          method: 'PUT',
          body: { payload: secretEditPayload },
        })
      }

      closeSecretEditor(false)
    } catch (error) {
      setSecretEditError(error instanceof Error ? error.message : 'Failed to update secret')
    } finally {
      setSecretEditSaving(false)
    }
  }, [closeSecretEditor, secretEditDescription, secretEditId, secretEditName, secretEditPayload])

  // Build fields (credential's create button needs component-level handler)
  const serverFields = useMemo<FieldDef[]>(
    () =>
      fields.map(f =>
        f.key === 'credential'
          ? {
              ...f,
              relationCreateButton: {
                label: 'New credential',
                onClick: openSecretDialog,
              },
              relationEditButton: {
                label: 'Edit Secret',
                onClick: openSecretEditor,
              },
            }
          : f.key === 'host'
            ? {
                ...f,
                hideLabel: true,
                render: ({ inputId, value, formData, setValue, updateField }) => {
                  const isDirect = String(formData.connect_type ?? 'direct') === 'direct'
                  const useLocalHost = Boolean(formData.use_local_host)
                  const hostRequired = !String(formData.connect_type ?? 'direct').startsWith('tunnel')

                  return (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <label htmlFor={inputId} className="text-sm font-medium text-foreground">
                            {f.label}
                            {hostRequired ? <span className="ml-1 text-destructive">*</span> : null}
                          </label>
                          <HelpPopoverButton label="Host help">
                            Enter the IP address or domain name of the server managed by AppOS.
                          </HelpPopoverButton>
                        </div>
                        {isDirect ? (
                          <label className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-input"
                              checked={useLocalHost}
                              onChange={async event => {
                                const checked = event.target.checked
                                updateField('use_local_host', checked)
                                if (!checked) {
                                  setDockerBridgeError('')
                                  return
                                }
                                const address = dockerBridgeHost || (await loadDockerBridgeHost())
                                if (address) {
                                  setValue(address)
                                } else {
                                  updateField('use_local_host', false)
                                }
                              }}
                            />
                            <span>{dockerBridgeLoading ? 'Loading...' : 'Local host'}</span>
                          </label>
                        ) : null}
                      </div>

                      <input
                        id={inputId}
                        type="text"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        value={String(value ?? '')}
                        onChange={event => setValue(event.target.value)}
                        placeholder={f.placeholder}
                        required={hostRequired}
                      />

                      {isDirect && dockerBridgeError ? (
                        <p className="text-xs text-destructive">{dockerBridgeError}</p>
                      ) : null}
                    </div>
                  )
                },
              }
          : f
      ),
    [dockerBridgeError, dockerBridgeHost, dockerBridgeLoading, loadDockerBridgeHost, openSecretDialog, openSecretEditor]
  )
  const checkServerStatus = useCallback(async (item: Record<string, unknown>) => {
    const id = String(item.id)
    const mode = item.connect_type === 'tunnel' ? 'tunnel' : 'tcp'
    setCheckingIds(prev => new Set(prev).add(id))
    try {
      const res = (await pb.send(
        `/api/servers/${id}/ops/connectivity?mode=${encodeURIComponent(mode)}`,
        {
          method: 'GET',
        }
      )) as {
        status?: string
      }
      setPingResults(prev => ({ ...prev, [id]: res.status === 'online' ? 'online' : 'offline' }))
    } catch {
      setPingResults(prev => ({ ...prev, [id]: 'offline' }))
    } finally {
      setCheckingIds(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  const handleConnect = useCallback(
    async (item: Record<string, unknown>) => {
      const id = String(item.id || '')
      if (!id || connectingOpen) return
      const label = String(item.name || item.host || id)

      setConnectingTarget(label)
      setConnectingPhase('checking')
      setConnectingDetail('Running connectivity check...')
      setConnectingOpen(true)

      const status = await pingServerStatus({
        id,
        name: String(item.name || ''),
        host: String(item.host || ''),
        connect_type: String(item.connect_type || 'direct'),
      })

      if (status.status === 'offline') {
        setConnectingPhase('offline')
        setConnectingDetail(status.reason || 'Server is offline.')
        return
      }

      setConnectingOpen(false)
      await navigate({ to: '/terminal/server/$serverId', params: { serverId: id }, search: {} })
    },
    [connectingOpen, navigate]
  )

  const handlePowerRequest = useCallback(
    (item: Record<string, unknown>, action: 'restart' | 'shutdown') => {
      setPowerTarget(item)
      setPowerAction(action)
      setPowerError('')
      setPowerDialogOpen(true)
    },
    []
  )

  const handlePowerConfirm = useCallback(async () => {
    if (!powerTarget) return
    const id = String(powerTarget.id || '')
    if (!id) return
    setPowerSubmitting(true)
    setPowerError('')
    try {
      await serverPower(id, powerAction)
      setPowerDialogOpen(false)
      void checkServerStatus(powerTarget)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operation failed'
      setPowerError(message)
    } finally {
      setPowerSubmitting(false)
    }
  }, [checkServerStatus, powerAction, powerTarget])

  const handleOpenServer = useCallback(
    (item: Record<string, unknown> | null, nextTab: 'overview' | 'connection' | 'monitor' | 'runtime' | 'tunnel' | 'software' = 'overview') => {
      const nextServerId = item ? String(item.id ?? '') : ''
      const opening = nextServerId !== ''
      setSelectedServerId(opening ? nextServerId : undefined)
      void navigate({
        to: '/resources/servers',
        search: prev => ({
          ...prev,
          server: opening ? nextServerId : undefined,
          tab: opening ? nextTab : undefined,
        }),
      })
    },
    [navigate]
  )

  const handleEditServer = useCallback(
    (item: Record<string, unknown>) => {
      const id = String(item.id ?? '')
      if (!id) return
      void navigate({
        to: '/resources/servers',
        search: prev => ({
          ...prev,
          edit: id,
        }),
      })
    },
    [navigate]
  )

  const handleSelectServer = useCallback(
    (item: Record<string, unknown> | null) => {
      const currentServerId = selectedServerId ?? server
      if (item === null || String(item.id ?? '') === currentServerId) {
        handleOpenServer(null)
        return
      }
      handleOpenServer(item, 'overview')
    },
    [handleOpenServer, selectedServerId, server]
  )

  useEffect(() => {
    setSelectedServerId(server)
  }, [server])

  const columns: Column[] = [
    {
      key: 'name',
      label: 'Name',
      searchable: true,
      sortable: true,
      render: (value, row) => {
        const id = String(row.id ?? '')
        const selected = server === id
        return (
          <button
            type="button"
            className="cursor-pointer text-left font-medium text-primary underline-offset-4 hover:underline"
            onClick={event => {
              event.stopPropagation()
              handleOpenServer(row, 'overview')
            }}
          >
            <span>{String(value || '—')}</span>
            <span className="sr-only">{selected ? 'Overview already open' : 'Open overview'}</span>
          </button>
        )
      },
    },
    {
      key: 'connect_type',
      label: 'Mode',
      filterOptions: [
        { label: 'Direct SSH', value: 'direct' },
        { label: 'Reverse Tunnel', value: 'tunnel' },
      ],
      render: v => <Badge variant="outline">{v === 'tunnel' ? 'Tunnel' : 'Direct SSH'}</Badge>,
    },
    {
      key: 'connection',
      label: 'Connection',
      filterOptions: [
        { label: 'Not Configured', value: 'not_configured' },
        { label: 'Awaiting Connection', value: 'awaiting_connection' },
        { label: 'Online', value: 'online' },
        { label: 'Paused', value: 'paused' },
        { label: 'Needs Attention', value: 'needs_attention' },
      ],
      filterValue: row => getConnectionState(row),
      render: (_value, row) => {
        const state = getConnectionState(row)
        const reason = getConnectionReason(row)
        const badgeVariant = state === 'online' ? 'default' : state === 'paused' || state === 'needs_attention' ? 'secondary' : 'outline'

        return (
          <button
            type="button"
            className="inline-flex text-left"
            title="Open connection details"
            onClick={event => {
              event.stopPropagation()
              handleOpenServer(row, 'connection')
            }}
          >
            <div className="space-y-1">
              <Badge variant={badgeVariant}>{connectionStateLabel(state)}</Badge>
              <div className="max-w-56 text-xs text-muted-foreground">{reason}</div>
            </div>
          </button>
        )
      },
    },
    {
      key: 'endpoint',
      label: 'Endpoint',
      searchable: true,
      render: (_value, row) => <span>{getEndpointSummary(row)}</span>,
    },
    {
      key: 'identity',
      label: 'Identity',
      searchable: true,
      render: (_value, row) => <span>{getIdentitySummary(row)}</span>,
    },
    {
      key: 'last_activity',
      label: 'Last Activity',
      sortable: true,
      sortValue: row => String(asObject(row.access)?.checked_at ?? asObject(row.tunnel)?.last_seen ?? asObject(row.tunnel)?.connected_at ?? ''),
      render: (_value, row) => <span>{getLastActivityLabel(row)}</span>,
    },
  ]

  const renderDetailPanel = useCallback(
    (item: Record<string, unknown>) => {
      const isTunnel = item.connect_type === 'tunnel'
      const requestedTab = tab ?? 'overview'
      const detailTab =
        requestedTab === 'tunnel' && !isTunnel ? 'overview' :
        requestedTab === 'detail' ? 'overview' : requestedTab
      const tunnel = asObject(item.tunnel)
      const services = parseTunnelServices(tunnel?.services ?? item.tunnel_services)
      const status = getStatusValue(item)
      const tunnelState = getTunnelValue(item)
      const connectionState = getConnectionState(item)
      const connectionReason = getConnectionReason(item)
      const endpointSummary = getEndpointSummary(item)
      const lastActivity = getLastActivityLabel(item)
      const credentialType = String(item.credential_type || '—')
      const credentialId = String(item.credential || '')
      const createdBy = String(item.created_by_display || item.created_by || '—')
      const detailTabTriggerClassName =
        'mb-[-1px] h-10 flex-none rounded-none border-0 border-b-2 border-b-transparent px-0 pb-3 pt-1 text-sm text-muted-foreground shadow-none after:hidden hover:bg-transparent hover:text-foreground data-[state=active]:border-b-foreground data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground'
      const id = String(item.id || '')
      const isTunnelAction = item.connect_type === 'tunnel'
      return (
        <div className="space-y-4">
          {/* Sheet header: name + actions */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-tight">
                {String(item.name || 'Unnamed Server')}
              </h2>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">{id}</p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0 gap-1.5">
                  <MoreVertical className="h-4 w-4" />
                  Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { void handleConnect(item) }}>
                  <LinkIcon className="h-4 w-4" />
                  Open Terminal
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={checkingIds.has(id)}
                  onClick={() => { void checkServerStatus(item) }}
                >
                  {checkingIds.has(id) ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlugZap className="h-4 w-4" />
                  )}
                  Test Connection
                </DropdownMenuItem>
                {isTunnelAction && (
                  <DropdownMenuItem onClick={() => setWizardServerId(id)}>
                    <Cable className="h-4 w-4" />
                    Tunnel Setup
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => handlePowerRequest(item, 'restart')}>
                  <RotateCcw className="h-4 w-4" />
                  Restart
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlePowerRequest(item, 'shutdown')}>
                  <Power className="h-4 w-4" />
                  Shutdown
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Tabs
            value={detailTab}
            onValueChange={value => {
              void navigate({
                to: '/resources/servers',
                search: prev => ({ ...prev, tab: value as 'overview' | 'monitor' | 'runtime' | 'tunnel' | 'software' }),
              })
            }}
            className="gap-4"
          >
            <TabsList
              variant="line"
              className="h-auto w-full justify-start gap-7 rounded-none border-b border-border/40 px-0 pb-0"
            >
              <TabsTrigger value="overview" className={detailTabTriggerClassName}>
                Overview
              </TabsTrigger>
              <TabsTrigger value="connection" className={detailTabTriggerClassName}>
                Connection
              </TabsTrigger>
              {isTunnel ? (
                <TabsTrigger value="tunnel" className={detailTabTriggerClassName}>
                  Tunnel
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="monitor" className={detailTabTriggerClassName}>
                Monitor
              </TabsTrigger>
              <TabsTrigger value="runtime" className={detailTabTriggerClassName}>
                Runtime
              </TabsTrigger>
              <TabsTrigger value="software" className={detailTabTriggerClassName}>
                Software
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4">
              <dl className="grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
                {/* ID — first */}
                <div className="sm:col-span-2 xl:col-span-3">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">ID</dt>
                  <dd className="mt-1 break-all font-mono text-xs">{id || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Name</dt>
                  <dd className="mt-1 break-all">{String(item.name || '—')}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Connection Type</dt>
                  <dd className="mt-1">
                    <Badge variant="outline">{isTunnel ? 'Tunnel' : 'Direct'}</Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Access</dt>
                  <dd className="mt-1">
                    {status === 'online' ? (
                      <Badge variant="default">{accessLabel(status)}</Badge>
                    ) : status === 'offline' ? (
                      <Badge variant="secondary">{accessLabel(status)}</Badge>
                    ) : (
                      <Badge variant="outline">{accessLabel(status)}</Badge>
                    )}
                  </dd>
                </div>
                {isTunnel ? (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Tunnel State</dt>
                    <dd className="mt-1">
                      <Badge variant="outline">{tunnelStateLabel(tunnelState)}</Badge>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Host</dt>
                  <dd className="mt-1 break-all font-mono text-xs">{String(item.host || '—')}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Port</dt>
                  <dd className="mt-1">{String(item.port || '22')}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">User</dt>
                  <dd className="mt-1">{String(item.user || 'root')}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Credential</dt>
                  <dd className="mt-1 flex items-center gap-2">
                    {credentialType !== '—' && (
                      <Badge variant="secondary">{credentialType}</Badge>
                    )}
                    {credentialId ? (
                      <Link
                        to="/secrets"
                        search={{ id: credentialId, edit: undefined, returnGroup: undefined, returnType: undefined }}
                        className="font-mono text-xs text-primary underline-offset-4 hover:underline"
                      >
                        {credentialId}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Created by</dt>
                  <dd className="mt-1">{createdBy}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Created</dt>
                  <dd className="mt-1">{String(item.created || '—')}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Updated</dt>
                  <dd className="mt-1">{String(item.updated || '—')}</dd>
                </div>
                {item.description ? (
                  <div className="sm:col-span-2 xl:col-span-3">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Description</dt>
                    <dd className="mt-1 text-muted-foreground">{String(item.description)}</dd>
                  </div>
                ) : null}
              </dl>
            </TabsContent>

            <TabsContent value="connection" className="pt-4">
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Connection Summary</CardTitle>
                    <CardDescription>{connectionReason}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Mode</div>
                      <div className="mt-1">{isTunnel ? 'Tunnel' : 'Direct SSH'}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Connection Status</div>
                      <div className="mt-1">
                        <Badge variant={connectionState === 'online' ? 'default' : connectionState === 'paused' || connectionState === 'needs_attention' ? 'secondary' : 'outline'}>
                          {connectionStateLabel(connectionState)}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Last Check or Last Seen</div>
                      <div className="mt-1">{lastActivity}</div>
                    </div>
                    <div className="sm:col-span-2 xl:col-span-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Endpoint</div>
                      <div className="mt-1">{endpointSummary}</div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {isTunnel ? (
              <TabsContent value="tunnel" className="pt-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                  <div>
                    <h3 className="text-sm font-semibold">Tunnel</h3>
                    <dl className="mt-4 space-y-4 text-sm">
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">Connection Mode</dt>
                        <dd className="mt-1">Reverse Tunnel</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">Access</dt>
                        <dd className="mt-1">{accessLabel(status)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">State</dt>
                        <dd className="mt-1">{tunnelStateLabel(tunnelState)}</dd>
                      </div>
                    </dl>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">Tunnel Services</h3>
                    {services.length === 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">No tunnel service mapping exposed for this server.</p>
                    ) : (
                      <div className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                        {services.map(service => (
                          <div key={`${service.service_name}:${service.tunnel_port}`}>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">{service.service_name}</div>
                            <div className="mt-1 font-medium">Port {service.tunnel_port}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
            ) : null}

            <TabsContent value="monitor" className="pt-4">
              <div className="space-y-4">
                <ServerMonitorAgentCard
                  serverId={String(item.id || '')}
                  serverName={String(item.name || item.id || '')}
                />
                <MonitorTargetPanel
                  targetType="server"
                  targetId={String(item.id || '')}
                  emptyMessage={`No monitoring data available yet for ${String(item.name || item.id)}. Current connectivity status is ${status}.`}
                />
              </div>
            </TabsContent>

            <TabsContent value="runtime" className="pt-4">
              <div className="text-sm text-muted-foreground">
                Runtime details can later include active sessions, deployed workloads, and process information for {String(item.name || item.id)}.
              </div>
            </TabsContent>

            <TabsContent value="software" className="pt-4">
              <ServerSoftwarePanel serverId={String(item.id || '')} />
            </TabsContent>
          </Tabs>
        </div>
      )
    },
    [checkingIds, checkServerStatus, getConnectionReason, getConnectionState, getEndpointSummary, getLastActivityLabel, getStatusValue, getTunnelValue, handleConnect, handlePowerRequest, navigate, tab]
  )

  const renderExtraActions = useCallback(
    (item: Record<string, unknown>) => {
      const id = String(item.id)
      const isTunnel = item.connect_type === 'tunnel'
      return (
        <>
          <DropdownMenuItem onClick={() => handleSelectServer(item)}>
            <PanelRight className="h-4 w-4" />
            Detail
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void handleConnect(item)
            }}
          >
            <LinkIcon className="h-4 w-4" />
            Open Terminal
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={checkingIds.has(id)}
            onClick={() => {
              void checkServerStatus(item)
            }}
          >
            {checkingIds.has(id) ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlugZap className="h-4 w-4" />
            )}
            Test Connection
          </DropdownMenuItem>
          {isTunnel && (
            <DropdownMenuItem onClick={() => setWizardServerId(id)}>
              <Cable className="h-4 w-4" />
              Tunnel Setup
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => handlePowerRequest(item, 'restart')}>
            <RotateCcw className="h-4 w-4" />
            Restart
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handlePowerRequest(item, 'shutdown')}>
            <Power className="h-4 w-4" />
            Shutdown
          </DropdownMenuItem>
        </>
      )
    },
    [checkingIds, checkServerStatus, handleConnect, handlePowerRequest, handleSelectServer]
  )

  const renderPrimaryAction = useCallback(
    (item: Record<string, unknown>) => {
      const state = getConnectionState(item)
      const isTunnel = item.connect_type === 'tunnel'
      const label = (() => {
        if (state === 'online') return 'Open Terminal'
        if (state === 'paused') return 'Resume Access'
        if (state === 'not_configured') return isTunnel ? 'Start Setup' : 'Complete Setup'
        if (state === 'awaiting_connection') return isTunnel ? 'Continue Setup' : 'Test Connection'
        return isTunnel ? 'View Issue' : 'Fix Configuration'
      })()

      return (
        <Button
          size="sm"
          onClick={event => {
            event.stopPropagation()
            if (state === 'online') {
              void handleConnect(item)
              return
            }
            if (isTunnel && (state === 'not_configured' || state === 'awaiting_connection' || state === 'paused')) {
              setWizardServerId(String(item.id ?? ''))
              return
            }
            if (!isTunnel && (state === 'not_configured' || state === 'needs_attention')) {
              handleEditServer(item)
              return
            }
            if (!isTunnel && state === 'awaiting_connection') {
              void checkServerStatus(item)
              return
            }
            handleOpenServer(item, 'connection')
          }}
        >
          {label}
        </Button>
      )
    },
    [checkServerStatus, getConnectionState, handleConnect, handleEditServer, handleOpenServer]
  )

  const refreshAllStatuses = useCallback(
    async ({
      items,
      refreshList,
    }: {
      items: Record<string, unknown>[]
      refreshList: () => Promise<void>
    }) => {
      await Promise.all(items.map(item => checkServerStatus(item)))
      await refreshList()
    },
    [checkServerStatus]
  )

  return (
    <>
      <ResourcePage
        config={{
          title: 'Servers',
          description: 'SSH deployment targets',
          apiPath: '/api/collections/servers/records',
          favoriteStorageKey: 'resource-page:favorites:servers',
          favoritesFilterLabel: 'Favorites only',
          createButtonLabel: 'Add Server',
          createButtonShowIcon: false,
          searchPlaceholder: 'Search server',
          searchContainerClassName: 'w-full sm:w-52',
          pageSize: 10,
          pageSizeOptions: [10, 50, 100],
          defaultSort: { key: 'name', dir: 'asc' },
          headerFilters: true,
          listControlsBorder: false,
          listControlsShowReset: false,
          pageSizeSelectorPlacement: 'header',
          paginationPlacement: 'header',
          paginationVariant: 'minimal',
          paginationSummary: false,
          paginationTotalLabel: totalCount =>
            `Total ${totalCount} server${totalCount === 1 ? '' : 's'}`,
          dialogContentClassName: 'sm:max-w-4xl',
          resourceType: 'server',
          parentNav: { label: 'Resources', href: '/resources' },
          listItems: () => listServerItems(user?.id, String(user?.email ?? '')),
          createItem: async payload =>
            await pb.collection('servers').create({
              ...sanitizeServerPayload(payload),
              created_by: String(user?.id ?? ''),
            }),
          updateItem: async (id, payload) => {
            await pb.collection('servers').update(id, sanitizeServerPayload(payload))
          },
          deleteItem: async id => {
            await pb.collection('servers').delete(id)
          },
          refreshKey: listRefreshKey,
          columns,
          fields: serverFields,
          initialCreateData: () => ({
            name: buildDefaultServerName(),
            connect_type: 'direct',
            use_local_host: false,
          }),
          validateForm: ({ formData }) => {
            const isTunnel = String(formData.connect_type ?? 'direct') === 'tunnel'
            const name = String(formData.name ?? '').trim()
            const user = String(formData.user ?? '').trim()
            const host = String(formData.host ?? '').trim()
            const port = normalizePort(formData.port)

            if (!name) return 'Name is required'
            if (!user) return 'User is required'
            if (!isTunnel && !host) return 'Host is required for Direct SSH connections'
            if (!isTunnel && port === null) return 'Port is required for Direct SSH connections'
            return null
          },
          resolveFields: ({ formData }) => {
            const isTunnel = String(formData.connect_type ?? 'direct') === 'tunnel'
            return serverFields.map(field => {
              if (field.key === 'host') {
                return {
                  ...field,
                  required: !isTunnel,
                }
              }
              if (field.key === 'port') {
                return {
                  ...field,
                  required: !isTunnel,
                }
              }
              return field
            })
          },
          autoCreate,
          showRefreshButton: true,
          wrapTableInCard: false,
          onRefresh: refreshAllStatuses,
          favoriteActionPlacement: 'afterExtraActions',
          primaryAction: renderPrimaryAction,
          extraActions: renderExtraActions,
          selectedItemId: selectedServerId,
          onSelectItem: handleSelectServer,
          renderDetailPanel: item => renderDetailPanel(item),
          detailPresentation: 'drawer',
          detailDrawerTier: 'lg',
          detailDrawerTitle: 'Server Detail',
          initialEditId: edit,
          dialogHeader: ({ editingItem, title, description }) => ({
            title: editingItem ? title : 'Add Server',
            description,
          }),
          onInitialEditHandled: () => {
            if (!edit) return
            void navigate({
              to: '/resources/servers',
              replace: true,
              search: prev => ({
                ...prev,
                create,
                returnGroup,
                returnType,
                edit: undefined,
                server: prev.server,
                tab: prev.tab,
              }),
            })
          },
          onCreateSuccess: record => {
            if (returnGroup) {
              navigate({
                to: '/groups/$id',
                params: { id: returnGroup },
                search: { addOpen: returnType ?? 'server', newItem: String(record.id) },
              })
            } else if (record.connect_type === 'tunnel') {
              setWizardServerId(String(record.id))
            }
          },
        }}
      />
      {wizardServerId && (
        <TunnelSetupWizard
          serverId={wizardServerId}
          onConnected={() => setListRefreshKey(current => current + 1)}
          onClose={() => setWizardServerId(null)}
        />
      )}

      <Dialog open={connectingOpen} onOpenChange={setConnectingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connecting...</DialogTitle>
            <DialogDescription>
              {connectingTarget ? `Target: ${connectingTarget}` : 'Preparing connection'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 text-sm">
            {connectingPhase === 'checking' ? (
              <div className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Running connectivity check...
              </div>
            ) : (
              <div className="text-destructive">{connectingDetail}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectingOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={powerDialogOpen} onOpenChange={setPowerDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {powerAction === 'restart' ? 'Restart Server' : 'Shutdown Server'}
            </DialogTitle>
            <DialogDescription>
              {powerTarget
                ? `Target: ${String(powerTarget.name || powerTarget.host || powerTarget.id)}`
                : 'Confirm server operation'}
            </DialogDescription>
          </DialogHeader>
          {powerError && <div className="text-sm text-destructive">{powerError}</div>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPowerDialogOpen(false)}
              disabled={powerSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                void handlePowerConfirm()
              }}
              disabled={powerSubmitting}
            >
              {powerSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SecretCreateDialog
        open={secretDialogOpen}
        onOpenChange={setSecretDialogOpen}
        title="Create Credential"
        description="Create a reusable credential and attach it to this server."
        allowedTemplateIds={Array.from(ALLOWED_TEMPLATES)}
        templateLabels={TEMPLATE_ALIASES}
        defaultTemplateId="single_value"
        defaultName={defaultCredentialSecretName}
        onCreated={({ id, name, templateId }) => {
          const label = formatSecretLabel({ name, template_id: templateId, id })
          secretAddOption?.(id, label)
        }}
      />

      <Dialog open={secretEditOpen} onOpenChange={closeSecretEditor}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Credential</DialogTitle>
            <DialogDescription>Update the selected Secret without leaving server editing.</DialogDescription>
          </DialogHeader>

          {secretEditLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading secret...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="server-secret-edit-name" className="text-sm font-medium text-foreground">
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  id="server-secret-edit-name"
                  type="text"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={secretEditName}
                  onChange={event => setSecretEditName(event.target.value)}
                  required
                />
              </div>

              <SecretForm
                templates={secretEditTemplates}
                templateId={secretEditTemplateId}
                payload={secretEditPayload}
                onTemplateChange={() => {}}
                onPayloadChange={(key, value) => {
                  setSecretEditPayload(prev => ({ ...prev, [key]: value }))
                }}
                disableTemplateChange
              />

              <div className="space-y-2">
                <label
                  htmlFor="server-secret-edit-description"
                  className="text-sm font-medium text-foreground"
                >
                  Description
                </label>
                <input
                  id="server-secret-edit-description"
                  type="text"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  value={secretEditDescription}
                  onChange={event => setSecretEditDescription(event.target.value)}
                />
              </div>

              {secretEditError ? <p className="text-sm text-destructive">{secretEditError}</p> : null}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => closeSecretEditor(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleSecretEditSave()
              }}
              disabled={secretEditLoading || secretEditSaving}
            >
              {secretEditSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Credential
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ServerMonitorAgentCard({
  serverId,
  serverName,
}: {
  serverId: string
  serverName: string
}) {
  const [status, setStatus] = useState<Record<string, string> | null>(null)
  const [statusText, setStatusText] = useState('')
  const [statusError, setStatusError] = useState('')
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [actionLoading, setActionLoading] = useState<'install' | 'update' | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')

  const loadStatus = useCallback(async () => {
    if (!serverId) return
    setLoadingStatus(true)
    setStatusError('')
    try {
      const response = await getSystemdStatus(serverId, 'netdata')
      setStatus(response.status)
      setStatusText(response.status_text)
    } catch (error) {
      setStatus(null)
      setStatusText('')
      setStatusError(
        error instanceof Error ? error.message : 'Unable to read Netdata service status'
      )
    } finally {
      setLoadingStatus(false)
    }
  }, [serverId])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const runAction = useCallback(
    async (action: 'install' | 'update') => {
      if (!serverId) return
      setActionLoading(action)
      setActionError('')
      setActionMessage('')
      try {
        const response =
          action === 'install'
            ? await installMonitorAgent(serverId)
            : await updateMonitorAgent(serverId)
        setActionMessage(
          `${action === 'install' ? 'Install' : 'Update'} completed for ${serverName}.${response.packaged_version ? ` Netdata version: ${response.packaged_version.trim()}.` : ''}`
        )
        if (response.systemd) {
          setStatus(response.systemd)
        }
        if (response.status_text) {
          setStatusText(response.status_text)
        }
        await loadStatus()
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Netdata action failed')
      } finally {
        setActionLoading(null)
      }
    },
    [loadStatus, serverId, serverName]
  )

  const activeState = String(status?.ActiveState || '').toLowerCase()
  const subState = String(status?.SubState || '')
  const unitState = String(status?.UnitFileState || '')
  const isActive = activeState === 'active'

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Netdata Agent</CardTitle>
          <CardDescription>
            Install or update Netdata using the official native-package installer, then confirm the remote netdata service state without leaving this tab.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadStatus()}
            disabled={loadingStatus || !!actionLoading}
          >
            {loadingStatus ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh Status
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runAction('update')}
            disabled={!!actionLoading}
          >
            {actionLoading === 'update' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update Netdata
          </Button>
          <Button size="sm" onClick={() => void runAction('install')} disabled={!!actionLoading}>
            {actionLoading === 'install' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Install Netdata
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Active State</div>
            <div className="mt-1 font-medium">{loadingStatus ? 'Loading...' : activeState || 'Unknown'}</div>
          </div>
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Sub State</div>
            <div className="mt-1 font-medium">{loadingStatus ? 'Loading...' : subState || '—'}</div>
          </div>
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Unit File</div>
            <div className="mt-1 font-medium">{loadingStatus ? 'Loading...' : unitState || '—'}</div>
          </div>
        </div>

        {statusError ? (
          <Alert>
            <AlertDescription>
              Netdata service is not readable yet. It is usually not installed on {serverName} yet, or the remote systemd unit has not been created. {statusError}
            </AlertDescription>
          </Alert>
        ) : null}

        {actionError ? (
          <Alert>
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null}

        {actionMessage ? (
          <Alert>
            <AlertDescription>{actionMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-md border bg-muted/10 p-3 text-sm text-muted-foreground">
          {isActive
            ? 'Service is active. Netdata is now collecting host metrics on the remote server.'
            : 'Install Netdata downloads the official kickstart installer and forces native package installation. Update Netdata reruns the same installer in reinstall mode and restarts the service.'}
        </div>

        {statusText ? (
          <div className="rounded-md border bg-background p-3">
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              systemctl status
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap text-xs">{statusText}</pre>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export const Route = createFileRoute('/_app/_auth/resources/servers')({
  component: ServersPage,
  validateSearch: (search: Record<string, unknown>) => ({
    create: typeof search.create === 'string' ? search.create : undefined,
    returnGroup: typeof search.returnGroup === 'string' ? search.returnGroup : undefined,
    returnType: typeof search.returnType === 'string' ? search.returnType : undefined,
    edit: typeof search.edit === 'string' ? search.edit : undefined,
    server: typeof search.server === 'string' ? search.server : undefined,
    tab:
      search.tab === 'overview' || search.tab === 'connection' || search.tab === 'detail' || search.tab === 'monitor' || search.tab === 'runtime' || search.tab === 'tunnel' || search.tab === 'software'
        ? search.tab
        : undefined,
  }),
})
