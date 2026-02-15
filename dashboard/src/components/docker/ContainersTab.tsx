import { useState, useEffect, useCallback } from "react"
import { pb } from "@/lib/pb"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Play, Square, RotateCw, Trash2, MoreVertical } from "lucide-react"

interface Container {
  ID: string
  Names: string
  Image: string
  State: string
  Status: string
  Ports: string
}

function parseContainers(output: string): Container[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean) as Container[]
}

function statusBadge(state: string) {
  const variant = state === "running" ? "default" : "secondary"
  return <Badge variant={variant}>{state}</Badge>
}

export function ContainersTab() {
  const [containers, setContainers] = useState<Container[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [host, setHost] = useState("local")

  const fetchContainers = useCallback(async () => {
    try {
      setLoading(true)
      const res = await pb.send("/api/ext/docker/containers", { method: "GET" })
      setContainers(parseContainers(res.output))
      if (res.host) setHost(res.host)
    } catch (err) {
      console.error("Failed to fetch containers:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchContainers()
  }, [fetchContainers])

  const action = async (id: string, act: string) => {
    try {
      if (act === "remove") {
        await pb.send(`/api/ext/docker/containers/${id}`, { method: "DELETE" })
      } else {
        await pb.send(`/api/ext/docker/containers/${id}/${act}`, { method: "POST" })
      }
      fetchContainers()
    } catch (err) {
      console.error(`Failed to ${act} container:`, err)
    }
  }

  const filtered = containers.filter(
    (c) =>
      c.Names?.toLowerCase().includes(filter.toLowerCase()) ||
      c.Image?.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <input
          type="text"
          placeholder="Filter containers..."
          className="border rounded-md px-3 py-1.5 text-sm bg-background"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Button variant="outline" size="sm" onClick={fetchContainers} disabled={loading}>
          <RotateCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Image</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Ports</TableHead>
            <TableHead>Host</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((c) => (
            <TableRow key={c.ID}>
              <TableCell className="font-mono text-xs">{c.Names}</TableCell>
              <TableCell className="text-xs">{c.Image}</TableCell>
              <TableCell>{statusBadge(c.State)}</TableCell>
              <TableCell className="text-xs">{c.Status}</TableCell>
              <TableCell className="text-xs">{c.Ports}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{host}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => action(c.ID, "start")}>
                      <Play className="h-4 w-4 mr-2" /> Start
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => action(c.ID, "stop")}>
                      <Square className="h-4 w-4 mr-2" /> Stop
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => action(c.ID, "restart")}>
                      <RotateCw className="h-4 w-4 mr-2" /> Restart
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => action(c.ID, "remove")}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
          {!loading && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No containers found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
