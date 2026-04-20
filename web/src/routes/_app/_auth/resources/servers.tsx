import { useState, useCallback, useEffect, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { PlugZap, Loader2, Cable, Link as LinkIcon, RotateCcw, Power, RefreshCw } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
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
import { MonitorTargetPanel } from '@/components/monitor/MonitorTargetPanel'
import { ServerSoftwarePanel } from '@/components/servers/ServerSoftwarePanel'
import { pb } from '@/lib/pb'
import {
  checkServerStatus as pingServerStatus,
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

function formatSecretLabel(raw: Record<string, unknown>): string {
  const name = String(raw.name ?? raw.id)
  const tid = String(raw.template_id ?? '')
  const alias = TEMPLATE_ALIASES[tid]
  return alias ? `${name}  (${alias})` : name
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

const fields: FieldDef[] = [
  {
    key: 'connect_type',
    label: 'Connection Type',
    type: 'select',
    options: [
      { label: 'Direct SSH', value: 'direct' },
      { label: 'Reverse Tunnel', value: 'tunnel' },
    ],
    defaultValue: 'direct',
  },
  { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'my-server' },
  { key: 'host', label: 'Host', type: 'text', placeholder: '192.168.1.1' },
  { key: 'port', label: 'Port', type: 'number', defaultValue: 22 },
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
  const autoCreate = create === '1' || !!returnGroup
  const navigate = Route.useNavigate()
  const [wizardServerId, setWizardServerId] = useState<string | null>(null)
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
  const [secretAddOption, setSecretAddOption] = useState<
    ((id: string, label: string) => void) | null
  >(null)
  const defaultCredentialSecretName = useCallback(() => buildDefaultCredentialSecretName(), [])

  const getStatusValue = useCallback(
    (item: Record<string, unknown>) => {
      const id = String(item.id ?? '')
      if (pingResults[id]) return pingResults[id]
      const raw = String(item.tunnel_status ?? '').toLowerCase()
      if (raw === 'online' || raw === 'offline') return raw
      return item.connect_type === 'tunnel' ? 'offline' : 'unknown'
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

  const openSecretEditor = useCallback((secretId: string) => {
    const targetUrl = new URL('/secrets', window.location.origin)
    targetUrl.searchParams.set('id', secretId)
    targetUrl.searchParams.set('edit', secretId)
    const opened = window.open(targetUrl.toString(), '_blank', 'noopener,noreferrer')
    if (!opened) {
      window.location.assign(targetUrl.toString())
    }
  }, [])

  // Build fields (credential's create button needs component-level handler)
  const serverFields = useMemo<FieldDef[]>(
    () =>
      fields.map(f =>
        f.key === 'credential'
          ? {
              ...f,
              relationCreateButton: {
                label: 'Create new credential secret',
                onClick: openSecretDialog,
              },
              relationEditButton: {
                label: 'Edit Secret',
                onClick: openSecretEditor,
              },
            }
          : f
      ),
    [openSecretDialog, openSecretEditor]
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

  const handleSelectServer = useCallback(
    (item: Record<string, unknown> | null) => {
      void navigate({
        to: '/resources/servers',
        search: prev => ({
          ...prev,
          server:
            item && String(item.id) !== prev.server ? String(item.id) : undefined,
          tab:
            item && String(item.id) !== prev.server ? prev.tab ?? 'detail' : undefined,
        }),
      })
    },
    [navigate]
  )

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
              void handleSelectServer(row)
            }}
          >
            <span>{String(value || '—')}</span>
            <span className="sr-only">{selected ? 'Hide detail' : 'Show detail'}</span>
          </button>
        )
      },
    },
    {
      key: 'connect_type',
      label: 'Type',
      filterOptions: [
        { label: 'Direct SSH', value: 'direct' },
        { label: 'Reverse Tunnel', value: 'tunnel' },
      ],
      render: v => <Badge variant="outline">{v === 'tunnel' ? 'Tunnel' : 'Direct'}</Badge>,
    },
    { key: 'host', label: 'Host', searchable: true, sortable: true },
    {
      key: 'port',
      label: 'Port',
      sortable: true,
      sortValue: row => Number(row.port ?? 0),
    },
    { key: 'user', label: 'User', searchable: true, sortable: true },
    {
      key: 'tunnel_status',
      label: 'Status',
      filterOptions: [
        { label: 'Online', value: 'online' },
        { label: 'Offline', value: 'offline' },
        { label: 'Unknown', value: 'unknown' },
      ],
      filterValue: row => getStatusValue(row),
      render: (v, row) => {
        const id = String(row.id ?? '')
        const ct = row.connect_type
        const checking = checkingIds.has(id)

        // Local ping result takes priority over DB value
        const local = pingResults[id]
        const status = local ?? (ct === 'tunnel' ? (v as string) : undefined)

        if (ct === 'tunnel') {
          return (
            <button
              type="button"
              className="inline-flex"
              title="Click to check status"
              onClick={() => {
                void checkServerStatus(row)
              }}
              disabled={checking}
            >
              {checking ? (
                <Badge variant="outline">
                  <Loader2 className="h-3 w-3 animate-spin" />
                </Badge>
              ) : status === 'online' ? (
                <Badge variant="default">Online</Badge>
              ) : (
                <Badge variant="secondary">Offline</Badge>
              )}
            </button>
          )
        }

        if (status === 'online') {
          return <Badge variant="default">Online</Badge>
        }
        if (status === 'offline') {
          return <Badge variant="secondary">Offline</Badge>
        }
        return <span className="text-muted-foreground">—</span>
      },
    },
    {
      key: 'tunnel_services',
      label: 'Tunnel Ports',
      searchable: true,
      render: (v, row) => {
        if (row.connect_type !== 'tunnel') {
          return <span className="text-muted-foreground">—</span>
        }
        const services = parseTunnelServices(v)
        if (!services.length) {
          return <span className="text-muted-foreground">—</span>
        }
        return (
          <span className="text-xs tabular-nums">
            {services.map(s => `${s.service_name}:${s.tunnel_port}`).join('  ')}
          </span>
        )
      },
    },
  ]

  const renderDetailPanel = useCallback(
    (item: Record<string, unknown>) => {
      const isTunnel = item.connect_type === 'tunnel'
      const requestedTab = tab ?? 'detail'
      const detailTab = requestedTab === 'tunnel' && !isTunnel ? 'detail' : requestedTab
      const services = parseTunnelServices(item.tunnel_services)
      const status = getStatusValue(item)
      const recordFields = [
        ['ID', String(item.id || '—')],
        ['Created', String(item.created || '—')],
        ['Updated', String(item.updated || '—')],
      ]
      return (
        <div className="space-y-4">
          <div className="border-b pb-4">
            <h2 className="text-xl font-semibold tracking-tight">
              {String(item.name || 'Unnamed Server')}
              <span className="ml-2 text-sm font-normal text-muted-foreground">{String(item.id || '')}</span>
            </h2>
          </div>

          <Tabs
            value={detailTab}
            onValueChange={value => {
              void navigate({
                to: '/resources/servers',
                search: prev => ({ ...prev, tab: value as 'detail' | 'monitor' | 'runtime' | 'tunnel' | 'software' }),
              })
            }}
          >
            <TabsList>
              <TabsTrigger value="detail">Detail</TabsTrigger>
              {isTunnel ? <TabsTrigger value="tunnel">Tunnel</TabsTrigger> : null}
              <TabsTrigger value="monitor">Monitor</TabsTrigger>
              <TabsTrigger value="runtime">Runtime</TabsTrigger>
              <TabsTrigger value="software">Software</TabsTrigger>
            </TabsList>

            <TabsContent value="detail" className="mt-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border bg-muted/10 p-4">
                  <h3 className="text-sm font-semibold">Overview</h3>
                  <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Connection Type</dt>
                      <dd className="mt-1">{isTunnel ? 'Reverse Tunnel' : 'Direct SSH'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
                      <dd className="mt-1">{status === 'unknown' ? 'Unknown' : status === 'online' ? 'Online' : 'Offline'}</dd>
                    </div>
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
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Server Name</dt>
                      <dd className="mt-1 break-all">{String(item.name || '—')}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-lg border bg-muted/10 p-4">
                  <h3 className="text-sm font-semibold">Access & Notes</h3>
                  <dl className="mt-4 space-y-4 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Credential Secret</dt>
                      <dd className="mt-1 break-all font-mono text-xs">{String(item.credential || '—')}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Description</dt>
                      <dd className="mt-1 text-muted-foreground">{String(item.description || '—')}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-lg border bg-muted/10 p-4 lg:col-span-2">
                  <h3 className="text-sm font-semibold">Record Fields</h3>
                  <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                    {recordFields.map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                        <dd className="mt-1 break-all">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </TabsContent>

            {isTunnel ? (
              <TabsContent value="tunnel" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
                  <div className="rounded-lg border bg-muted/10 p-4">
                    <h3 className="text-sm font-semibold">Tunnel Status</h3>
                    <dl className="mt-4 space-y-4 text-sm">
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">Connection Mode</dt>
                        <dd className="mt-1">Reverse Tunnel</dd>
                      </div>
                      <div>
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
                        <dd className="mt-1">{status === 'online' ? 'Online' : 'Offline'}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="rounded-lg border bg-muted/10 p-4">
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

            <TabsContent value="monitor" className="mt-4">
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

            <TabsContent value="runtime" className="mt-4">
              <div className="rounded-lg border bg-muted/10 p-4 text-sm text-muted-foreground">
                Runtime details can later include active sessions, deployed workloads, and process information for {String(item.name || item.id)}.
              </div>
            </TabsContent>

            <TabsContent value="software" className="mt-4">
              <ServerSoftwarePanel serverId={String(item.id || '')} />
            </TabsContent>
          </Tabs>
        </div>
      )
    },
    [getStatusValue, navigate, tab]
  )

  const renderExtraActions = useCallback(
    (item: Record<string, unknown>) => {
      const id = String(item.id)
      const isTunnel = item.connect_type === 'tunnel'
      return (
        <>
          <DropdownMenuItem
            onClick={() => {
              void handleConnect(item)
            }}
          >
            <LinkIcon className="h-4 w-4" />
            Connect
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
            Check Status
          </DropdownMenuItem>
          {isTunnel && (
            <DropdownMenuItem onClick={() => setWizardServerId(id)}>
              <Cable className="h-4 w-4" />
              Connect Setup
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
    [checkingIds, checkServerStatus, handleConnect, handlePowerRequest]
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
          searchPlaceholder: 'Search servers by name, host, or user...',
          pageSize: 10,
          pageSizeOptions: [10, 20, 50],
          defaultSort: { key: 'name', dir: 'asc' },
          headerFilters: true,
          listControlsBorder: false,
          listControlsShowReset: false,
          pageSizeSelectorPlacement: 'footer',
          paginationSummary: false,
          resourceType: 'server',
          parentNav: { label: 'Resources', href: '/resources' },
          listItems: async () => await pb.collection('servers').getFullList({ sort: 'name' }),
          createItem: async payload => await pb.collection('servers').create(payload),
          updateItem: async (id, payload) => {
            await pb.collection('servers').update(id, payload)
          },
          deleteItem: async id => {
            await pb.collection('servers').delete(id)
          },
          columns,
          fields: serverFields,
          autoCreate,
          showRefreshButton: true,
          wrapTableInCard: false,
          onRefresh: refreshAllStatuses,
          favoriteActionPlacement: 'afterExtraActions',
          extraActions: renderExtraActions,
          selectedItemId: server,
          onSelectItem: handleSelectServer,
          renderDetailPanel,
          initialEditId: edit,
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
        <TunnelSetupWizard serverId={wizardServerId} onClose={() => setWizardServerId(null)} />
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
        title="Create Credential Secret"
        description="Choose a type and fill in the credential details."
        allowedTemplateIds={Array.from(ALLOWED_TEMPLATES)}
        templateLabels={TEMPLATE_ALIASES}
        defaultTemplateId="single_value"
        defaultName={defaultCredentialSecretName}
        onCreated={({ id, name, templateId }) => {
          const label = formatSecretLabel({ name, template_id: templateId, id })
          secretAddOption?.(id, label)
        }}
      />
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
      search.tab === 'detail' || search.tab === 'monitor' || search.tab === 'runtime' || search.tab === 'tunnel' || search.tab === 'software'
        ? search.tab
        : undefined,
  }),
})
