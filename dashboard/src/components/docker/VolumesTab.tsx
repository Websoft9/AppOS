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
import { Trash2, MoreVertical, RotateCw, Eraser } from "lucide-react"

interface Volume {
  Name: string
  Driver: string
  Mountpoint: string
}

function parseVolumes(output: string): Volume[] {
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
    .filter(Boolean) as Volume[]
}

export function VolumesTab() {
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [host, setHost] = useState("local")

  const fetchVolumes = useCallback(async () => {
    try {
      setLoading(true)
      const res = await pb.send("/api/ext/docker/volumes", { method: "GET" })
      setVolumes(parseVolumes(res.output))
      if (res.host) setHost(res.host)
    } catch (err) {
      console.error("Failed to fetch volumes:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchVolumes()
  }, [fetchVolumes])

  const removeVolume = async (name: string) => {
    try {
      await pb.send(`/api/ext/docker/volumes/${name}`, { method: "DELETE" })
      fetchVolumes()
    } catch (err) {
      console.error("Failed to remove volume:", err)
    }
  }

  const pruneVolumes = async () => {
    try {
      await pb.send("/api/ext/docker/volumes/prune", { method: "POST" })
      fetchVolumes()
    } catch (err) {
      console.error("Failed to prune volumes:", err)
    }
  }

  const filtered = volumes.filter((v) =>
    v.Name?.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter volumes..."
          className="border rounded-md px-3 py-1.5 text-sm bg-background"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={pruneVolumes}>
          <Eraser className="h-4 w-4 mr-1" /> Prune unused
        </Button>
        <Button variant="outline" size="sm" onClick={fetchVolumes} disabled={loading}>
          <RotateCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Driver</TableHead>
            <TableHead>Mountpoint</TableHead>
            <TableHead>Host</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((v) => (
            <TableRow key={v.Name}>
              <TableCell className="font-mono text-xs">{v.Name}</TableCell>
              <TableCell className="text-xs">{v.Driver}</TableCell>
              <TableCell className="font-mono text-xs truncate max-w-[300px]">
                {v.Mountpoint}
              </TableCell>
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
                      onClick={() => removeVolume(v.Name)}
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
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No volumes found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
