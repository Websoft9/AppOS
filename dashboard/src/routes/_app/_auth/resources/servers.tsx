import { useState, useCallback } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PlugZap, Loader2, Cable } from "lucide-react"
import {
  ResourcePage,
  type Column,
  type FieldDef,
} from "@/components/resources/ResourcePage"
import { TunnelSetupWizard } from "@/components/servers/TunnelSetupWizard"
import { pb } from "@/lib/pb"

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
  const [wizardServerId, setWizardServerId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  // Per-server ping results (overrides DB value in Status column)
  const [pingResults, setPingResults] = useState<Record<string, "online" | "offline">>({})

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

        // Local ping result takes priority over DB value
        const local = pingResults[id]
        const status = local ?? (ct === "tunnel" ? (v as string) : undefined)

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

  const handleConnectTest = useCallback(async (item: Record<string, unknown>, refreshList: () => void) => {
    const id = String(item.id)
    setTestingId(id)
    try {
      const res = await pb.send(`/api/ext/resources/servers/${id}/ping`, { method: "GET" }) as { status: string }
      setPingResults(prev => ({ ...prev, [id]: res.status === "online" ? "online" : "offline" }))
      // Refresh to sync tunnel_status in DB for tunnel servers
      if (item.connect_type === "tunnel") refreshList()
    } catch {
      setPingResults(prev => ({ ...prev, [id]: "offline" }))
    }
    setTestingId(null)
  }, [])

  const renderExtraActions = useCallback((item: Record<string, unknown>, refreshList: () => void) => {
    const id = String(item.id)
    const isTunnel = item.connect_type === "tunnel"
    return (
      <>
        <Button
          variant="ghost"
          size="icon"
          title="Test connection"
          disabled={testingId === id}
          onClick={() => handleConnectTest(item, refreshList)}
        >
          {testingId === id
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <PlugZap className="h-4 w-4" />
          }
        </Button>
        {isTunnel && (
          <Button
            variant="ghost"
            size="icon"
            title="Show tunnel setup script"
            onClick={() => setWizardServerId(id)}
          >
            <Cable className="h-4 w-4" />
          </Button>
        )}
      </>
    )
  }, [testingId, handleConnectTest])

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
    </>
  )
}

export const Route = createFileRoute("/_app/_auth/resources/servers")({
  component: ServersPage,
})
