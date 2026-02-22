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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Trash2, MoreVertical, Plus } from "lucide-react"

interface Network {
  ID: string
  Name: string
  Driver: string
  Scope: string
}

function parseNetworks(output: string): Network[] {
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
    .filter(Boolean) as Network[]
}

export function NetworksTab({ serverId, refreshSignal = 0 }: { serverId: string; refreshSignal?: number }) {
  const [networks, setNetworks] = useState<Network[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [newName, setNewName] = useState("")
  const [host, setHost] = useState("local")

  const fetchNetworks = useCallback(async () => {
    try {
      setLoading(true)
      const res = await pb.send(`/api/ext/docker/networks?server_id=${serverId}`, { method: "GET" })
      setNetworks(parseNetworks(res.output))
      if (res.host) setHost(res.host)
    } catch (err) {
      console.error("Failed to fetch networks:", err)
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    fetchNetworks()
  }, [fetchNetworks, refreshSignal])

  const removeNetwork = async (id: string) => {
    try {
      await pb.send(`/api/ext/docker/networks/${id}?server_id=${serverId}`, { method: "DELETE" })
      fetchNetworks()
    } catch (err) {
      console.error("Failed to remove network:", err)
    }
  }

  const createNetwork = async () => {
    if (!newName.trim()) return
    try {
      await pb.send(`/api/ext/docker/networks?server_id=${serverId}`, {
        method: "POST",
        body: { name: newName.trim() },
      })
      setNewName("")
      fetchNetworks()
    } catch (err) {
      console.error("Failed to create network:", err)
    }
  }

  const filtered = networks.filter((n) =>
    n.Name?.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter networks..."
          className="border rounded-md px-3 py-1.5 text-sm bg-background"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex-1" />
        <input
          type="text"
          placeholder="Network name"
          className="border rounded-md px-3 py-1.5 text-sm bg-background w-48"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createNetwork()}
        />
        <Button variant="outline" size="sm" onClick={createNetwork}>
          <Plus className="h-4 w-4 mr-1" /> Create
        </Button>

      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Host</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((n) => (
            <TableRow key={n.ID}>
              <TableCell className="font-mono text-xs">{n.Name}</TableCell>
              <TableCell className="font-mono text-xs">{n.ID?.substring(0, 12)}</TableCell>
              <TableCell className="text-xs">{n.Driver}</TableCell>
              <TableCell className="text-xs">{n.Scope}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{host}</TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => removeNetwork(n.ID)}
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
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No networks found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
