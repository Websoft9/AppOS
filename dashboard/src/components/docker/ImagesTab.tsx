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
import { Download, Trash2, MoreVertical, RotateCw, Eraser } from "lucide-react"

interface DockerImage {
  ID: string
  Repository: string
  Tag: string
  Size: string
  CreatedSince: string
}

function parseImages(output: string): DockerImage[] {
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
    .filter(Boolean) as DockerImage[]
}

export function ImagesTab() {
  const [images, setImages] = useState<DockerImage[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [pullName, setPullName] = useState("")
  const [host, setHost] = useState("local")

  const fetchImages = useCallback(async () => {
    try {
      setLoading(true)
      const res = await pb.send("/api/ext/docker/images", { method: "GET" })
      setImages(parseImages(res.output))
      if (res.host) setHost(res.host)
    } catch (err) {
      console.error("Failed to fetch images:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchImages()
  }, [fetchImages])

  const removeImage = async (id: string) => {
    try {
      await pb.send(`/api/ext/docker/images/${id}`, { method: "DELETE" })
      fetchImages()
    } catch (err) {
      console.error("Failed to remove image:", err)
    }
  }

  const pruneImages = async () => {
    try {
      await pb.send("/api/ext/docker/images/prune", { method: "POST" })
      fetchImages()
    } catch (err) {
      console.error("Failed to prune images:", err)
    }
  }

  const pullImage = async () => {
    if (!pullName.trim()) return
    try {
      await pb.send("/api/ext/docker/images/pull", {
        method: "POST",
        body: { name: pullName.trim() },
      })
      setPullName("")
      fetchImages()
    } catch (err) {
      console.error("Failed to pull image:", err)
    }
  }

  const filtered = images.filter(
    (i) =>
      i.Repository?.toLowerCase().includes(filter.toLowerCase()) ||
      i.Tag?.toLowerCase().includes(filter.toLowerCase()),
  )

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter images..."
          className="border rounded-md px-3 py-1.5 text-sm bg-background"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex-1" />
        <input
          type="text"
          placeholder="image:tag"
          className="border rounded-md px-3 py-1.5 text-sm bg-background w-48"
          value={pullName}
          onChange={(e) => setPullName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && pullImage()}
        />
        <Button variant="outline" size="sm" onClick={pullImage}>
          <Download className="h-4 w-4 mr-1" /> Pull
        </Button>
        <Button variant="outline" size="sm" onClick={pruneImages}>
          <Eraser className="h-4 w-4 mr-1" /> Prune
        </Button>
        <Button variant="outline" size="sm" onClick={fetchImages} disabled={loading}>
          <RotateCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Repository</TableHead>
            <TableHead>Tag</TableHead>
            <TableHead>ID</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Host</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((img) => (
            <TableRow key={img.ID}>
              <TableCell className="font-mono text-xs">{img.Repository}</TableCell>
              <TableCell className="text-xs">{img.Tag}</TableCell>
              <TableCell className="font-mono text-xs">{img.ID?.substring(0, 12)}</TableCell>
              <TableCell className="text-xs">{img.Size}</TableCell>
              <TableCell className="text-xs">{img.CreatedSince}</TableCell>
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
                      onClick={() => removeImage(img.ID)}
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
                No images found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
