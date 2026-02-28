import { useState, useCallback } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Badge } from "@/components/ui/badge"
import { PlugZap, Loader2, Cable, Link as LinkIcon, RotateCcw, Power } from "lucide-react"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  ResourcePage,
  type Column,
  type FieldDef,
} from "@/components/resources/ResourcePage"
import { TunnelSetupWizard } from "@/components/servers/TunnelSetupWizard"
import { pb } from "@/lib/pb"
import { checkServerStatus as pingServerStatus, serverPower } from "@/lib/connect-api"

const fields: FieldDef[] = [
  {
    key: "connect_type",
    label: "Connection Type",
    type: "select",
    options: [
      { label: "Direct SSH", value: "direct" },
      { label: "Reverse Tunnel", value: "tunnel" },
    ],
    defaultValue: "direct",
  },
  { key: "name", label: "Name", type: "text", required: true, placeholder: "my-server" },
  { key: "host", label: "Host", type: "text", placeholder: "192.168.1.1" },
  { key: "port", label: "Port", type: "number", defaultValue: 22 },
  { key: "user", label: "User", type: "text", placeholder: "root" },
  {
    key: "auth_type",
    label: "Auth Type",
    type: "select",
    options: [
      { label: "Password", value: "password" },
      { label: "SSH Key", value: "key" },
    ],
  },
  {
    key: "credential",
    label: "Credential (Secret)",
    type: "relation",
    relationApiPath: "/api/ext/resources/secrets",
    relationCreate: {
      label: "New Credential Secret",
      apiPath: "/api/ext/resources/secrets",
      fields: [
        { key: "name", label: "Name", type: "text", required: true, placeholder: "my-server-cred" },
        {
          key: "type",
          label: "Type",
          type: "select",
          required: true,
          options: [
            { label: "Password", value: "password" },
            { label: "Username + Password", value: "username_password" },
            { label: "SSH Key", value: "ssh_key" },
          ],
        },
        {
          key: "username",
          label: "Username",
          type: "text",
          placeholder: "root",
          showWhen: { field: "type", values: ["username_password"] },
        },
        {
          key: "value",
          label: "Password / Key",
          type: "password",
          required: true,
          dynamicType: { field: "type", values: ["ssh_key"], as: "file-textarea" },
          fileAccept: ".pem,.key,.txt",
        },
        { key: "description", label: "Description (optional)", type: "text" },
      ],
    },
  },
  { key: "description", label: "Description", type: "textarea" },
  {
    key: "groups",
    label: "Groups",
    type: "relation",
    multiSelect: true,
    relationAutoSelectDefault: true,
    relationApiPath: "/api/ext/resources/groups",
    relationLabelKey: "name",
    defaultValue: [],
  },
]

function ServersPage() {
  const autoCreate = new URLSearchParams(window.location.search).get("create") === "1"
  const navigate = useNavigate()
  const [wizardServerId, setWizardServerId] = useState<string | null>(null)
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set())
  const [connectingOpen, setConnectingOpen] = useState(false)
  const [connectingTarget, setConnectingTarget] = useState("")
  const [connectingPhase, setConnectingPhase] = useState<"checking" | "offline">("checking")
  const [connectingDetail, setConnectingDetail] = useState("")
  const [powerDialogOpen, setPowerDialogOpen] = useState(false)
  const [powerTarget, setPowerTarget] = useState<Record<string, unknown> | null>(null)
  const [powerAction, setPowerAction] = useState<"restart" | "shutdown">("restart")
  const [powerSubmitting, setPowerSubmitting] = useState(false)
  const [powerError, setPowerError] = useState("")
  // Per-server ping results (overrides DB value in Status column)
  const [pingResults, setPingResults] = useState<Record<string, "online" | "offline">>({})

  const checkServerStatus = useCallback(async (item: Record<string, unknown>) => {
    const id = String(item.id)
    setCheckingIds((prev) => new Set(prev).add(id))
    try {
      if (item.connect_type === "tunnel") {
        const res = await pb.send(`/api/ext/tunnel/servers/${id}/status`, { method: "GET" }) as { status?: string }
        setPingResults(prev => ({ ...prev, [id]: res.status === "online" ? "online" : "offline" }))
      } else {
        const res = await pb.send(`/api/ext/resources/servers/${id}/ping`, { method: "GET" }) as { status?: string }
        setPingResults(prev => ({ ...prev, [id]: res.status === "online" ? "online" : "offline" }))
      }
    } catch {
      setPingResults(prev => ({ ...prev, [id]: "offline" }))
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  const handleConnect = useCallback(async (item: Record<string, unknown>) => {
    const id = String(item.id || "")
    if (!id || connectingOpen) return
    const label = String(item.name || item.host || id)

    setConnectingTarget(label)
    setConnectingPhase("checking")
    setConnectingDetail("Running connectivity check...")
    setConnectingOpen(true)

    const status = await pingServerStatus({
      id,
      name: String(item.name || ""),
      host: String(item.host || ""),
      connect_type: String(item.connect_type || "direct"),
    })

    if (status.status === "offline") {
      setConnectingPhase("offline")
      setConnectingDetail(status.reason || "Server is offline.")
      return
    }

    setConnectingOpen(false)
    await navigate({ to: "/connect/server/$serverId", params: { serverId: id } })
  }, [connectingOpen, navigate])

  const handlePowerRequest = useCallback((item: Record<string, unknown>, action: "restart" | "shutdown") => {
    setPowerTarget(item)
    setPowerAction(action)
    setPowerError("")
    setPowerDialogOpen(true)
  }, [])

  const handlePowerConfirm = useCallback(async () => {
    if (!powerTarget) return
    const id = String(powerTarget.id || "")
    if (!id) return
    setPowerSubmitting(true)
    setPowerError("")
    try {
      await serverPower(id, powerAction)
      setPowerDialogOpen(false)
      void checkServerStatus(powerTarget)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Operation failed"
      setPowerError(message)
    } finally {
      setPowerSubmitting(false)
    }
  }, [checkServerStatus, powerAction, powerTarget])

  const columns: Column[] = [
    { key: "name", label: "Name" },
    {
      key: "connect_type",
      label: "Type",
      render: (v) => (
        <Badge variant="outline">
          {v === "tunnel" ? "Tunnel" : "Direct"}
        </Badge>
      ),
    },
    { key: "host", label: "Host" },
    { key: "port", label: "Port" },
    { key: "user", label: "User" },
    {
      key: "tunnel_status",
      label: "Status",
      render: (v, row) => {
        const id = String(row.id ?? "")
        const ct = row.connect_type
        const checking = checkingIds.has(id)

        // Local ping result takes priority over DB value
        const local = pingResults[id]
        const status = local ?? (ct === "tunnel" ? (v as string) : undefined)

        if (ct === "tunnel") {
          return (
            <button
              type="button"
              className="inline-flex"
              title="Click to check status"
              onClick={() => { void checkServerStatus(row) }}
              disabled={checking}
            >
              {checking
                ? <Badge variant="outline"><Loader2 className="h-3 w-3 animate-spin" /></Badge>
                : status === "online"
                  ? <Badge variant="default">Online</Badge>
                  : <Badge variant="secondary">Offline</Badge>
              }
            </button>
          )
        }

        if (status === "online") {
          return <Badge variant="default">Online</Badge>
        }
        if (status === "offline") {
          return <Badge variant="secondary">Offline</Badge>
        }
        return <span className="text-muted-foreground">—</span>
      },
    },
    {
      key: "tunnel_services",
      label: "Tunnel Ports",
      render: (v, row) => {
        if (row.connect_type !== "tunnel") {
          return <span className="text-muted-foreground">—</span>
        }
        type Svc = { service_name: string; tunnel_port: number }
        let services: Svc[] = []
        try {
          if (typeof v === "string" && v !== "" && v !== "null") {
            services = JSON.parse(v)
          } else if (Array.isArray(v)) {
            services = v as Svc[]
          }
        } catch { /* ignore */ }
        if (!services.length) {
          return <span className="text-muted-foreground">—</span>
        }
        return (
          <span className="text-xs tabular-nums">
            {services.map((s) => `${s.service_name}:${s.tunnel_port}`).join("  ")}
          </span>
        )
      },
    },
  ]

  const renderExtraActions = useCallback((item: Record<string, unknown>) => {
    const id = String(item.id)
    const isTunnel = item.connect_type === "tunnel"
    return (
      <>
        <DropdownMenuItem onClick={() => { void handleConnect(item) }}>
          <LinkIcon className="h-4 w-4" />
          Connect
        </DropdownMenuItem>
        <DropdownMenuItem disabled={checkingIds.has(id)} onClick={() => { void checkServerStatus(item) }}>
          {checkingIds.has(id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          Check Status
        </DropdownMenuItem>
        {isTunnel && (
          <DropdownMenuItem onClick={() => setWizardServerId(id)}>
            <Cable className="h-4 w-4" />
            Connect Setup
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => handlePowerRequest(item, "restart")}>
          <RotateCcw className="h-4 w-4" />
          Restart
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handlePowerRequest(item, "shutdown")}>
          <Power className="h-4 w-4" />
          Shutdown
        </DropdownMenuItem>
      </>
    )
  }, [checkingIds, checkServerStatus, handleConnect, handlePowerRequest])

  const refreshAllStatuses = useCallback(async ({
    items,
    refreshList,
  }: {
    items: Record<string, unknown>[]
    refreshList: () => Promise<void>
  }) => {
    await Promise.all(items.map((item) => checkServerStatus(item)))
    await refreshList()
  }, [checkServerStatus])

  return (
    <>
      <ResourcePage
        config={{
          title: "Servers",
          description: "SSH deployment targets",
          apiPath: "/api/ext/resources/servers",
          columns,
          fields,
          parentNav: { label: "Resources", href: "/resources" },
          autoCreate,
          enableGroupAssign: true,
          showRefreshButton: true,
          onRefresh: refreshAllStatuses,
          extraActions: renderExtraActions,
          onCreateSuccess: (record) => {
            if (record.connect_type === "tunnel") {
              setWizardServerId(String(record.id))
            }
          },
        }}
      />
      {wizardServerId && (
        <TunnelSetupWizard
          serverId={wizardServerId}
          onClose={() => setWizardServerId(null)}
        />
      )}

      <Dialog open={connectingOpen} onOpenChange={setConnectingOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connecting...</DialogTitle>
            <DialogDescription>
              {connectingTarget ? `Target: ${connectingTarget}` : "Preparing connection"}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 text-sm">
            {connectingPhase === "checking" ? (
              <div className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Running connectivity check...
              </div>
            ) : (
              <div className="text-destructive">{connectingDetail}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectingOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={powerDialogOpen} onOpenChange={setPowerDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{powerAction === "restart" ? "Restart Server" : "Shutdown Server"}</DialogTitle>
            <DialogDescription>
              {powerTarget
                ? `Target: ${String(powerTarget.name || powerTarget.host || powerTarget.id)}`
                : "Confirm server operation"}
            </DialogDescription>
          </DialogHeader>
          {powerError && <div className="text-sm text-destructive">{powerError}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPowerDialogOpen(false)} disabled={powerSubmitting}>Cancel</Button>
            <Button onClick={() => { void handlePowerConfirm() }} disabled={powerSubmitting}>
              {powerSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export const Route = createFileRoute("/_app/_auth/resources/servers")({
  component: ServersPage,
})
