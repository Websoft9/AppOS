import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Server,
  ChevronDown,
} from "lucide-react"
import { pb } from "@/lib/pb"
import { DockerPanel } from '@/components/connect/DockerPanel'

interface HostEntry {
  id: string
  label: string
  status: "online" | "offline"
  reason?: string
}

interface DockerPageProps {
  serverFromUrl?: string
}

export function DockerPage({ serverFromUrl }: DockerPageProps) {
  const [hosts, setHosts] = useState<HostEntry[]>([
    { id: "local", label: "local", status: "online" },
  ])

  const [serverId, setServerId] = useState(serverFromUrl || "local")
  const activeHost = hosts.find((h) => h.id === serverId) ?? hosts[0]

  useEffect(() => {
    if (serverFromUrl && hosts.length > 0) {
      const match = hosts.find((h) => h.id === serverFromUrl)
      if (match) setServerId(match.id)
    }
  }, [hosts, serverFromUrl])

  useEffect(() => {
    pb.send("/api/ext/docker/servers", { method: "GET" })
      .then((res) => {
        if (Array.isArray(res)) setHosts(res)
      })
      .catch(() => {})
  }, [])

  const toggleHost = useCallback((hostId: string) => {
    setServerId(hostId)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Docker</h1>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Server className="h-4 w-4" />
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  activeHost?.status === "online" ? "bg-green-500" : "bg-gray-400"
                }`}
              />
              {activeHost?.label ?? serverId}
              <ChevronDown className="h-3.5 w-3.5 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {hosts.map((h) => (
              <DropdownMenuCheckboxItem
                key={h.id}
                checked={serverId === h.id}
                onCheckedChange={() => toggleHost(h.id)}
              >
                <span
                  className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                    h.status === "online" ? "bg-green-500" : "bg-gray-400"
                  }`}
                />
                {h.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DockerPanel serverId={serverId} />
    </div>
  )
}
