import { useState, useCallback, useEffect, useMemo } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { PlugZap, Loader2, Cable, Link as LinkIcon, RotateCcw, Power } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResourcePage, type Column, type FieldDef } from '@/components/resources/ResourcePage'
import { TunnelSetupWizard } from '@/components/servers/TunnelSetupWizard'
import { SecretForm, type SecretTemplate } from '@/components/secrets/SecretForm'
import { pb } from '@/lib/pb'
import { checkServerStatus as pingServerStatus, serverPower } from '@/lib/connect-api'

// Template-id → display alias used in the credential dropdown
const TEMPLATE_ALIASES: Record<string, string> = {
  single_value: 'Password',
  ssh_key: 'SSH Key',
}
const ALLOWED_TEMPLATES = new Set(Object.keys(TEMPLATE_ALIASES))

function formatSecretLabel(raw: Record<string, unknown>): string {
  const name = String(raw.name ?? raw.id)
  const tid = String(raw.template_id ?? '')
  const alias = TEMPLATE_ALIASES[tid]
  return alias ? `${name}  (${alias})` : name
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

function ServersPage() {
  const { create, returnGroup, returnType, edit } = Route.useSearch()
  const autoCreate = create === '1' || !!returnGroup
  const navigate = useNavigate()
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

  // ── Create-Secret dialog (reuses SecretForm) ──
  const [secretDialogOpen, setSecretDialogOpen] = useState(false)
  const [secretName, setSecretName] = useState('')
  const [secretTemplateId, setSecretTemplateId] = useState('')
  const [secretPayload, setSecretPayload] = useState<Record<string, string>>({})
  const [secretTemplates, setSecretTemplates] = useState<SecretTemplate[]>([])
  const [secretSaving, setSecretSaving] = useState(false)
  const [secretError, setSecretError] = useState('')
  // callback provided by ResourcePage's addOption
  const [secretAddOption, setSecretAddOption] = useState<
    ((id: string, label: string) => void) | null
  >(null)

  // Load secret templates on mount (only the allowed ones)
  useEffect(() => {
    void (async () => {
      try {
        const data = await pb.send<SecretTemplate[]>('/api/secrets/templates', { method: 'GET' })
        const filtered = (Array.isArray(data) ? data : []).filter(t => ALLOWED_TEMPLATES.has(t.id))
        // Rename labels to user-friendly aliases
        setSecretTemplates(filtered.map(t => ({ ...t, label: TEMPLATE_ALIASES[t.id] ?? t.label })))
      } catch {
        // ignore
      }
    })()
  }, [])

  const openSecretDialog = useCallback(
    (callbacks: { addOption: (id: string, label: string) => void }) => {
      setSecretName('')
      setSecretTemplateId('')
      setSecretPayload({})
      setSecretError('')
      setSecretAddOption(() => callbacks.addOption)
      setSecretDialogOpen(true)
    },
    []
  )

  const handleSecretCreate = useCallback(async () => {
    setSecretSaving(true)
    setSecretError('')
    try {
      const created = await pb.collection('secrets').create({
        name: secretName,
        template_id: secretTemplateId,
        scope: 'global',
        payload: secretPayload,
      })
      const label = formatSecretLabel({
        name: secretName,
        template_id: secretTemplateId,
        id: created.id,
      })
      secretAddOption?.(String(created.id), label)
      setSecretDialogOpen(false)
    } catch (err) {
      setSecretError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSecretSaving(false)
    }
  }, [secretName, secretTemplateId, secretPayload, secretAddOption])

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
            }
          : f
      ),
    [openSecretDialog]
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

  const columns: Column[] = [
    { key: 'name', label: 'Name' },
    {
      key: 'connect_type',
      label: 'Type',
      render: v => <Badge variant="outline">{v === 'tunnel' ? 'Tunnel' : 'Direct'}</Badge>,
    },
    { key: 'host', label: 'Host' },
    { key: 'port', label: 'Port' },
    { key: 'user', label: 'User' },
    {
      key: 'tunnel_status',
      label: 'Status',
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
      render: (v, row) => {
        if (row.connect_type !== 'tunnel') {
          return <span className="text-muted-foreground">—</span>
        }
        type Svc = { service_name: string; tunnel_port: number }
        let services: Svc[] = []
        try {
          if (typeof v === 'string' && v !== '' && v !== 'null') {
            services = JSON.parse(v)
          } else if (Array.isArray(v)) {
            services = v as Svc[]
          }
        } catch {
          /* ignore */
        }
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
          resourceType: 'server',
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
          parentNav: { label: 'Resources', href: '/resources' },
          autoCreate,
          showRefreshButton: true,
          onRefresh: refreshAllStatuses,
          extraActions: renderExtraActions,
          initialEditId: edit,
          onInitialEditHandled: () => {
            if (!edit) return
            void navigate({
              to: '/resources/servers',
              replace: true,
              search: {
                create,
                returnGroup,
                returnType,
                edit: undefined,
              },
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

      {/* Create credential secret dialog – reuses SecretForm */}
      <Dialog open={secretDialogOpen} onOpenChange={setSecretDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Credential Secret</DialogTitle>
            <DialogDescription>Choose a type and fill in the credential details.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={e => {
              e.preventDefault()
              void handleSecretCreate()
            }}
          >
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="secret-name">Name</Label>
                <Input
                  id="secret-name"
                  value={secretName}
                  onChange={e => setSecretName(e.target.value)}
                  placeholder="e.g. my-server-key"
                  required
                />
              </div>

              <SecretForm
                templates={secretTemplates}
                templateId={secretTemplateId}
                payload={secretPayload}
                onTemplateChange={id => {
                  setSecretTemplateId(id)
                  setSecretPayload({})
                }}
                onPayloadChange={(k, v) => setSecretPayload(prev => ({ ...prev, [k]: v }))}
              />

              {secretError && <div className="text-sm text-destructive">{secretError}</div>}
            </div>

            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSecretDialogOpen(false)}
                disabled={secretSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={secretSaving || !secretName.trim()}>
                {secretSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export const Route = createFileRoute('/_app/_auth/resources/servers')({
  component: ServersPage,
  validateSearch: (search: Record<string, unknown>) => ({
    create: typeof search.create === 'string' ? search.create : undefined,
    returnGroup: typeof search.returnGroup === 'string' ? search.returnGroup : undefined,
    returnType: typeof search.returnType === 'string' ? search.returnType : undefined,
    edit: typeof search.edit === 'string' ? search.edit : undefined,
  }),
})
