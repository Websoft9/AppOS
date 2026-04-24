import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { PlugZap, Loader2, Cable, Link as LinkIcon, RotateCcw, Power, RefreshCw, CircleHelp, PanelRight, MoreVertical, SlidersHorizontal, Activity } from 'lucide-react'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
import {
  getServerConnectionPresentation,
  type ServerConnectionActionId,
  type ServerConnectionActionSpec,
  type ServerConnectionPresentationSpec,
  type ServerDetailTab,
} from '@/components/servers/server-connection-presentation'
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
const SERVER_STATUS_REFRESH_BATCH_SIZE = 5

function buildDefaultCredentialSecretName() {
  return `server-credential-${Date.now().toString().slice(-6)}`
}

function buildDefaultServerName() {
  return `server-${Date.now().toString().slice(-6)}`
}

async function runBatched<T>(items: T[], batchSize: number, worker: (item: T) => Promise<void>) {
  if (batchSize < 1) {
    throw new Error('batchSize must be at least 1')
  }

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    await Promise.all(batch.map(item => worker(item)))
  }
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

type ServerFactsView = {
  operatingSystem: string
  kernelRelease: string
  architecture: string
  cpuCores: string
  memoryTotal: string
  observedAt: string
  hasFacts: boolean
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function formatBytes(value: unknown): string {
  const bytes = asNumber(value)
  if (bytes === null || bytes < 0) {
    return '—'
  }
  if (bytes === 0) {
    return '0 B'
  }

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const digits = size >= 10 || unitIndex === 0 ? 0 : 1
  return `${size.toFixed(digits)} ${units[unitIndex]}`
}

function normalizeServerFacts(item: Record<string, unknown>): ServerFactsView {
  const facts = asObject(item.facts_json)
  const osFacts = asObject(facts?.os)
  const kernelFacts = asObject(facts?.kernel)
  const cpuFacts = asObject(facts?.cpu)
  const memoryFacts = asObject(facts?.memory)

  const osParts = [
    String(osFacts?.distribution ?? '').trim(),
    String(osFacts?.version ?? '').trim(),
  ].filter(Boolean)
  const operatingSystem = osParts.length > 0
    ? osParts.join(' ')
    : String(osFacts?.family ?? '').trim() || '—'

  const cpuCores = asNumber(cpuFacts?.cores)
  const observedAtRaw = String(item.facts_observed_at ?? '').trim()
  const hasFacts = Boolean(
    facts && Object.keys(facts).length > 0 || observedAtRaw
  )

  return {
    operatingSystem,
    kernelRelease: String(kernelFacts?.release ?? '').trim() || '—',
    architecture: String(facts?.architecture ?? '').trim() || '—',
    cpuCores: cpuCores === null ? '—' : String(cpuCores),
    memoryTotal: formatBytes(memoryFacts?.total_bytes),
    observedAt: formatTimestamp(observedAtRaw),
    hasFacts,
  }
}

function compactHostFactsSummary(item: Record<string, unknown>): string {
  const facts = normalizeServerFacts(item)
  if (!facts.hasFacts) {
    return ''
  }

  const parts = [facts.operatingSystem, facts.architecture].filter(value => value && value !== '—')
  return parts.join(' · ')
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

function hostSummary(item: Record<string, unknown>): string {
  if (String(item.connect_type ?? '') === 'tunnel') {
    return 'via AppOS tunnel'
  }
  return String(item.host ?? '').trim() || '—'
}

type MonitorLatestStatusRecord = {
  target_id?: string
  status?: string
  reason?: string | null
  last_checked_at?: string | null
}

function buildServerConnectionFacts(item: Record<string, unknown>, accessStatusOverride?: 'online' | 'offline') {
  return {
    connect_type: item.connect_type,
    host: item.host,
    port: item.port,
    user: item.user,
    credential: item.credential,
    credential_type: item.credential_type,
    created: item.created,
    updated: item.updated,
    connection: item.connection,
    access: item.access,
    tunnel: item.tunnel,
    access_status_override: accessStatusOverride,
  }
}

function readCachedConnectionPresentation(item: Record<string, unknown>): ServerConnectionPresentationSpec | null {
  const cached = asObject(item.connection_presentation)
  if (!cached) {
    return null
  }

  return cached as unknown as ServerConnectionPresentationSpec
}

function mapServerListItem(
  item: Record<string, unknown>,
  currentUserId: string | undefined,
  currentUserEmail: string | undefined,
  monitorByTargetId: Map<string, MonitorLatestStatusRecord>
) {
  const createdBy = String(item.created_by ?? '')
  const createdByName = String(item.created_by_name ?? '').trim()
  const serverId = String(item.id ?? '').trim()
  const monitor = serverId ? monitorByTargetId.get(serverId) : undefined
  const credentialType = String(item.credential_type ?? '').trim()
  const connectionPresentation = getServerConnectionPresentation(buildServerConnectionFacts(item))

  return {
    ...item,
    created_by_display:
      createdByName || formatCreator(createdBy, currentUserId, currentUserEmail),
    connection_presentation: connectionPresentation,
    connection_state: connectionPresentation.state,
    connection_state_label: connectionPresentation.stateLabel,
    connection_reason: connectionPresentation.reason,
    connection_last_activity_at: connectionPresentation.lastActivityAt,
    connection_last_activity_label: connectionPresentation.lastActivityLabel,
    secret_type_label: credentialType,
    monitor_status: String(monitor?.status ?? ''),
    monitor_reason: String(monitor?.reason ?? ''),
    monitor_last_checked_at: String(monitor?.last_checked_at ?? ''),
  }
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
  const [serverPageSize, setServerPageSize] = useState(10)
  const [visibleOptionalColumns, setVisibleOptionalColumns] = useState<Set<string>>(
    () => new Set(['host_summary', 'monitor_status', 'user', 'secret_type_label'])
  )
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

  const getConnectionPresentation = useCallback(
    (item: Record<string, unknown>) => {
      const id = String(item.id ?? '')
      const override = pingResults[id]
      if (!override) {
        const cached = readCachedConnectionPresentation(item)
        if (cached) {
          return cached
        }
      }

      return getServerConnectionPresentation(buildServerConnectionFacts(item, override))
    },
    [pingResults]
  )

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

  const executePrimaryAction = useCallback(
    (item: Record<string, unknown>, kind: ServerConnectionActionId) => {
      if (kind === 'open_terminal') {
        void handleConnect(item)
        return
      }
      if (kind === 'test_connection') {
        void checkServerStatus(item)
        return
      }
      if (kind === 'tunnel_setup') {
        setWizardServerId(String(item.id ?? ''))
        return
      }
      if (kind === 'edit_server') {
        handleEditServer(item)
        return
      }
      handleOpenServer(item, 'connection')
    },
    [checkServerStatus, handleConnect, handleEditServer, handleOpenServer]
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

  const listItems = useCallback(async () => {
    const [serverResponse, monitorResponse] = await Promise.all([
      pb.send<{ items?: Array<Record<string, unknown>> }>('/api/servers/connection', {
        method: 'GET',
      }),
      pb.send<{ items?: MonitorLatestStatusRecord[] }>(
        `/api/collections/monitor_latest_status/records?${new URLSearchParams({
          perPage: '500',
          sort: '-updated',
          fields: 'target_id,status,reason,last_checked_at',
          filter: `(target_type='server')`,
        }).toString()}`,
        { method: 'GET' }
      ),
    ])

    const items = serverResponse.items ?? []

    const monitorByTargetId = new Map(
      Array.isArray(monitorResponse?.items)
        ? monitorResponse.items
            .map(record => [String(record.target_id ?? '').trim(), record] as const)
            .filter(([targetId]) => Boolean(targetId))
        : []
    )

    return items.map(item =>
      mapServerListItem(item, user?.id, String(user?.email ?? ''), monitorByTargetId)
    )
  }, [user?.email, user?.id])

  const allColumns = useMemo<Column[]>(
    () => [
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
        filterValue: row => String(row.connection_state ?? '').trim() || getConnectionPresentation(row).state,
        render: (_value, row) => {
          const id = String(row.id ?? '')
          const override = pingResults[id]
          const presentation = !override
            ? {
                state: String(row.connection_state ?? '').trim() || 'awaiting_connection',
                stateLabel: String(row.connection_state_label ?? '').trim() || 'Awaiting Connection',
                reason: String(row.connection_reason ?? '').trim() || 'Configuration is ready for verification.',
              }
            : getConnectionPresentation(row)
          const state = presentation.state
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
                <Badge variant={badgeVariant}>{presentation.stateLabel}</Badge>
                <div className="max-w-56 text-xs text-muted-foreground">{presentation.reason}</div>
              </div>
            </button>
          )
        },
      },
      {
        key: 'monitor_status',
        label: 'Monitor',
        sortable: true,
        sortValue: row => String(row.monitor_last_checked_at ?? row.monitor_status ?? ''),
        render: (value, row) => {
          const status = String(value ?? '').trim()
          if (!status) {
            return <span className="text-muted-foreground">-</span>
          }

          const name = String(row.name || row.id || 'server')
          const reason = String(row.monitor_reason ?? '').trim()
          return (
            <button
              type="button"
              className="inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
              aria-label={`Open monitor for ${name}`}
              title={reason ? `Monitoring active: ${status}. ${reason}` : `Monitoring active: ${status}`}
              onClick={event => {
                event.stopPropagation()
                handleOpenServer(row, 'monitor')
              }}
            >
              <Activity className="h-4 w-4" />
            </button>
          )
        },
      },
      {
        key: 'host_summary',
        label: 'Host',
        searchable: true,
        render: (_value, row) => {
          const factsSummary = compactHostFactsSummary(row)
          return (
            <div className="space-y-1">
              <div>{hostSummary(row)}</div>
              {factsSummary ? (
                <div className="text-xs text-muted-foreground">{factsSummary}</div>
              ) : null}
            </div>
          )
        },
      },
      {
        key: 'user',
        label: 'User',
        searchable: true,
        filterValue: row => String(row.user ?? '').trim() || null,
        render: value => <span>{String(value || '—')}</span>,
      },
      {
        key: 'secret_type_label',
        label: 'Secret Type',
        searchable: true,
        filterValue: row => String(row.secret_type_label ?? '').trim() || null,
        render: value => {
          const secretType = String(value ?? '').trim()

          if (!secretType) {
            return <span className="text-muted-foreground">—</span>
          }

          return <span>{secretType}</span>
        },
      },
      {
        key: 'last_activity',
        label: 'Last Activity',
        sortable: true,
        sortValue: row => String(row.connection_last_activity_at ?? '').trim() || getConnectionPresentation(row).lastActivityAt,
        render: (_value, row) => {
          const id = String(row.id ?? '')
          const override = pingResults[id]
          const label = !override
            ? String(row.connection_last_activity_label ?? '').trim() || '—'
            : getConnectionPresentation(row).lastActivityLabel
          return <span>{label}</span>
        },
      },
    ],
    [getConnectionPresentation, handleOpenServer, pingResults, server]
  )

  const columns = useMemo(
    () =>
      allColumns.filter(column => {
        if (
          column.key === 'host_summary' ||
          column.key === 'monitor_status' ||
          column.key === 'user' ||
          column.key === 'secret_type_label'
        ) {
          return visibleOptionalColumns.has(column.key)
        }
        return true
      }),
    [allColumns, visibleOptionalColumns]
  )

  const toggleOptionalColumn = useCallback((columnKey: 'host_summary' | 'monitor_status' | 'user' | 'secret_type_label', checked: boolean) => {
    setVisibleOptionalColumns(prev => {
      const next = new Set(prev)
      if (checked) {
        next.add(columnKey)
      } else {
        next.delete(columnKey)
      }
      return next
    })
  }, [])

  const renderListSettings = useCallback(
    ({ pageSize, setPageSize }: { pageSize: number; setPageSize: (pageSize: number) => void }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" title="List settings" aria-label="List settings">
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Rows per page</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(pageSize)} onValueChange={value => setPageSize(Number(value))}>
            {[10, 50, 100].map(option => (
              <DropdownMenuRadioItem key={option} value={String(option)}>
                {option} / page
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Columns</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={visibleOptionalColumns.has('host_summary')}
            onCheckedChange={checked => toggleOptionalColumn('host_summary', checked === true)}
          >
            Host
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={visibleOptionalColumns.has('monitor_status')}
            onCheckedChange={checked => toggleOptionalColumn('monitor_status', checked === true)}
          >
            Monitor
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={visibleOptionalColumns.has('user')}
            onCheckedChange={checked => toggleOptionalColumn('user', checked === true)}
          >
            User
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={visibleOptionalColumns.has('secret_type_label')}
            onCheckedChange={checked => toggleOptionalColumn('secret_type_label', checked === true)}
          >
            Secret Type
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [toggleOptionalColumn, visibleOptionalColumns]
  )

  const renderDetailPanel = useCallback(
    (item: Record<string, unknown>) => {
      const isTunnel = item.connect_type === 'tunnel'
      const requestedTab = tab ?? 'overview'
      const detailTab =
        requestedTab === 'tunnel' ? 'connection' :
        requestedTab === 'detail' ? 'overview' : requestedTab
      const tunnel = asObject(item.tunnel)
      const services = parseTunnelServices(tunnel?.services ?? item.tunnel_services)
      const status = getStatusValue(item)
      const tunnelState = getTunnelValue(item)
      const presentation = getConnectionPresentation(item)
      const facts = normalizeServerFacts(item)
      const credentialType = String(item.credential_type || '—')
      const credentialId = String(item.credential || '')
      const createdBy = String(item.created_by_display || item.created_by || '—')
      const detailTabTriggerClassName =
        'mb-[-1px] h-10 flex-none rounded-none border-0 border-b-2 border-b-transparent px-0 pb-3 pt-1 text-sm text-muted-foreground shadow-none after:hidden hover:bg-transparent hover:text-foreground data-[state=active]:border-b-foreground data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground'
      const id = String(item.id || '')
      const isTunnelAction = item.connect_type === 'tunnel'
      return (
        <div className="space-y-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">
              {String(item.name || 'Unnamed Server')}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{id}</p>
          </div>

          <Tabs
            value={detailTab}
            onValueChange={value => {
              void navigate({
                to: '/resources/servers',
                search: prev => ({ ...prev, tab: value as ServerDetailTab }),
              })
            }}
            className="gap-4"
          >
            <div className="flex items-end justify-between gap-4 border-b border-border/40">
              <TabsList
                variant="line"
                className="h-auto w-full justify-start gap-7 rounded-none border-0 px-0 pb-0"
              >
                <TabsTrigger value="overview" className={detailTabTriggerClassName}>
                  Overview
                </TabsTrigger>
                <TabsTrigger value="connection" className={detailTabTriggerClassName}>
                  Connection
                </TabsTrigger>
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="mb-2 shrink-0" aria-label="Server actions" title="Server actions">
                    <MoreVertical className="h-4 w-4" />
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
                {facts.hasFacts ? (
                  <>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Operating System</dt>
                      <dd className="mt-1">{facts.operatingSystem}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Kernel</dt>
                      <dd className="mt-1">{facts.kernelRelease}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Architecture</dt>
                      <dd className="mt-1">{facts.architecture}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">CPU Cores</dt>
                      <dd className="mt-1">{facts.cpuCores}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Memory</dt>
                      <dd className="mt-1">{facts.memoryTotal}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Facts Observed</dt>
                      <dd className="mt-1">{facts.observedAt}</dd>
                    </div>
                  </>
                ) : null}
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
                    <CardDescription>{presentation.reason}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Mode</div>
                      <div className="mt-1">{presentation.modeLabel}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Connection Status</div>
                      <div className="mt-1">
                        <Badge variant={presentation.state === 'online' ? 'default' : presentation.state === 'paused' || presentation.state === 'needs_attention' ? 'secondary' : 'outline'}>
                          {presentation.stateLabel}
                        </Badge>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Last Check or Last Seen</div>
                      <div className="mt-1">{presentation.lastActivityLabel}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Primary Action</div>
                      <div className="mt-1">
                        <Button size="sm" onClick={() => executePrimaryAction(item, presentation.primaryAction.id)}>
                          {presentation.primaryAction.label}
                        </Button>
                      </div>
                    </div>
                    <div className="sm:col-span-2 xl:col-span-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Endpoint</div>
                      <div className="mt-1">{presentation.endpointSummary}</div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Primary Next Step</CardTitle>
                    <CardDescription>{presentation.primaryActionDescription}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => executePrimaryAction(item, presentation.primaryAction.id)}>
                        {presentation.primaryAction.label}
                      </Button>
                      {presentation.secondaryActions.map(action => (
                        <Button
                          key={action.label}
                          variant="outline"
                          onClick={() => handleOpenServer(item, action.tab)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Mode-Specific Setup or Recovery</CardTitle>
                    <CardDescription>
                      {isTunnel
                        ? 'Tunnel lifecycle guidance covers setup, runtime session, and recovery.'
                        : 'Direct SSH lifecycle guidance covers configuration, verification, and recovery.'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 lg:grid-cols-3">
                    {isTunnel ? (
                      <>
                        <div className="rounded-xl border p-4 text-sm">
                          <div className="font-medium">Setup</div>
                          <div className="mt-2 text-muted-foreground">{presentation.state === 'not_configured' ? 'Tunnel setup has not started yet.' : 'Tunnel setup is already prepared in AppOS.'}</div>
                        </div>
                        <div className="rounded-xl border p-4 text-sm">
                          <div className="font-medium">Runtime Session</div>
                          <div className="mt-2 text-muted-foreground">State: {tunnelStateLabel(tunnelState)} · Last seen: {formatTimestamp(tunnel?.last_seen)}</div>
                        </div>
                        <div className="rounded-xl border p-4 text-sm">
                          <div className="font-medium">Recovery</div>
                          <div className="mt-2 text-muted-foreground">{String(tunnel?.reason ?? '').trim() || 'No tunnel-specific recovery issue is currently reported.'}</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="rounded-xl border p-4 text-sm">
                          <div className="font-medium">Configuration</div>
                          <div className="mt-2 text-muted-foreground">Host {String(item.host || '—')} · Port {String(item.port || '22')} · User {String(item.user || '—')}</div>
                        </div>
                        <div className="rounded-xl border p-4 text-sm">
                          <div className="font-medium">Verification</div>
                          <div className="mt-2 text-muted-foreground">Latest check: {presentation.lastActivityLabel} · Source: {presentation.diagnostics.evidenceSource}</div>
                        </div>
                        <div className="rounded-xl border p-4 text-sm">
                          <div className="font-medium">Recovery</div>
                          <div className="mt-2 text-muted-foreground">{presentation.state === 'needs_attention' ? presentation.reason : 'No SSH recovery action is currently required.'}</div>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {isTunnel ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>Tunnel Services</CardTitle>
                      <CardDescription>Service mappings exposed through this tunnel connection.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {services.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No tunnel service mapping exposed for this server.</div>
                      ) : (
                        <div className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                          {services.map(service => (
                            <div key={`${service.service_name}:${service.tunnel_port}`}>
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">{service.service_name}</div>
                              <div className="mt-1 font-medium">Port {service.tunnel_port}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : null}

                <Card>
                  <CardHeader>
                    <CardTitle>Diagnostics</CardTitle>
                    <CardDescription>Evidence that supports the current recommendation.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Latest Check Result</div>
                      <div className="mt-1">{presentation.diagnostics.latestCheckResult}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Evidence Source</div>
                      <div className="mt-1">{presentation.diagnostics.evidenceSource}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Latest Failure Reason</div>
                      <div className="mt-1">{presentation.diagnostics.latestFailureReason}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Latest Tunnel Callback or Heartbeat</div>
                      <div className="mt-1">{presentation.diagnostics.latestTunnelCallbackOrHeartbeat}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Pause Until</div>
                      <div className="mt-1">{presentation.diagnostics.pauseUntil}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Reason</div>
                      <div className="mt-1">{presentation.diagnostics.currentReason}</div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Activity Timeline</CardTitle>
                    <CardDescription>Compact lifecycle milestones for this server.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {presentation.timeline.length === 0 ? (
                      <div className="text-sm text-muted-foreground">No lifecycle events are available yet.</div>
                    ) : (
                      <div className="space-y-3">
                        {presentation.timeline.map(event => (
                          <div key={`${event.label}:${event.at}`} className="flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm">
                            <div className="font-medium">{event.label}</div>
                            <div className="text-muted-foreground">{event.at}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

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
    [checkingIds, checkServerStatus, executePrimaryAction, getConnectionPresentation, getStatusValue, getTunnelValue, handleConnect, handleOpenServer, handlePowerRequest, navigate, tab]
  )

  const renderConnectionActionItem = useCallback(
    (item: Record<string, unknown>, action: ServerConnectionActionSpec) => {
      const id = String(item.id ?? '')
      const checking = action.id === 'test_connection' && checkingIds.has(id)

      if (action.id === 'test_connection') {
        return (
          <DropdownMenuItem
            key={action.id}
            disabled={checking}
            onClick={() => {
              executePrimaryAction(item, action.id)
            }}
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlugZap className="h-4 w-4" />
            )}
            {action.label}
          </DropdownMenuItem>
        )
      }

      if (action.id === 'view_connection' || action.id === 'view_details') {
        return (
          <DropdownMenuItem
            key={action.id}
            onClick={() => {
              handleOpenServer(item, action.tab ?? 'overview')
            }}
          >
            <PanelRight className="h-4 w-4" />
            {action.label}
          </DropdownMenuItem>
        )
      }

      if (action.id === 'view_checklist' || action.id === 'tunnel_setup') {
        return (
          <DropdownMenuItem
            key={action.id}
            onClick={() => {
              executePrimaryAction(item, 'tunnel_setup')
            }}
          >
            <Cable className="h-4 w-4" />
            {action.label}
          </DropdownMenuItem>
        )
      }

      if (action.id === 'restart' || action.id === 'shutdown') {
        const powerAction = action.id
        return (
          <DropdownMenuItem
            key={powerAction}
            onClick={() => {
              handlePowerRequest(item, powerAction)
            }}
          >
            {powerAction === 'restart' ? <RotateCcw className="h-4 w-4" /> : <Power className="h-4 w-4" />}
            {action.label}
          </DropdownMenuItem>
        )
      }

      return (
        <DropdownMenuItem
          key={action.id}
          onClick={() => {
            executePrimaryAction(item, action.id)
          }}
        >
          <LinkIcon className="h-4 w-4" />
          {action.label}
        </DropdownMenuItem>
      )
    },
    [checkingIds, executePrimaryAction, handleOpenServer, handlePowerRequest]
  )

  const renderExtraActions = useCallback(
    (item: Record<string, unknown>) => {
      const presentation = getConnectionPresentation(item)
      return (
        <>
          {presentation.stateActions.map(action => renderConnectionActionItem(item, action))}
          {presentation.toolActions.length > 0 ? <DropdownMenuSeparator /> : null}
          {presentation.toolActions.map(action => renderConnectionActionItem(item, action))}
        </>
      )
    },
    [getConnectionPresentation, renderConnectionActionItem]
  )

  const renderPrimaryAction = useCallback(
    (item: Record<string, unknown>) => {
      const presentation = getConnectionPresentation(item)

      return (
        <Button
          variant="link"
          size="sm"
          className="h-auto justify-start px-0 py-0 text-left"
          onClick={event => {
            event.stopPropagation()
            executePrimaryAction(item, presentation.primaryAction.id)
          }}
        >
          {presentation.primaryAction.label}
        </Button>
      )
    },
    [executePrimaryAction, getConnectionPresentation]
  )

  const refreshAllStatuses = useCallback(
    async ({
      items,
      refreshList,
    }: {
      items: Record<string, unknown>[]
      refreshList: () => Promise<void>
    }) => {
      await runBatched(items, SERVER_STATUS_REFRESH_BATCH_SIZE, checkServerStatus)
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
          pageSizeValue: serverPageSize,
          onPageSizeChange: setServerPageSize,
          pageSizeOptions: [10, 50, 100],
          defaultSort: { key: 'name', dir: 'asc' },
          headerFilters: true,
          listControlsBorder: false,
          listControlsShowReset: false,
          pageSizeSelectorPlacement: 'none',
          paginationPlacement: 'header',
          paginationVariant: 'minimal',
          paginationSummary: false,
          headerTrailingControls: renderListSettings,
          paginationTotalLabel: totalCount =>
            `Total ${totalCount} items`,
          dialogContentClassName: 'sm:max-w-4xl',
          resourceType: 'server',
          actionsAlign: 'left',
          actionsMenuAlign: 'start',
          parentNav: { label: 'Resources', href: '/resources' },
          listItems,
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
