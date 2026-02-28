import { useState, useEffect, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
import { Download, Trash2, MoreVertical, Eraser, ArrowUpDown } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { getApiErrorMessage } from "@/lib/api-error"

const IMAGES_SORT_KEY = 'docker.images.sort'
const DOCKER_PAGE_SIZE_KEY = 'docker.list.page_size'

function loadGlobalPageSize(): 25 | 50 | 100 {
  try {
    const raw = Number(localStorage.getItem(DOCKER_PAGE_SIZE_KEY) || '50')
    if (raw === 25 || raw === 50 || raw === 100) return raw
  } catch {
    // ignore invalid local storage
  }
  return 50
}

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

export function ImagesTab({ serverId }: { serverId: string }) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState("")
  const [pullName, setPullName] = useState("")
  const [sortKey, setSortKey] = useState<'repo' | 'tag' | 'id' | 'size' | 'created'>(() => {
    try {
      const raw = localStorage.getItem(IMAGES_SORT_KEY)
      if (!raw) return 'repo'
      const parsed = JSON.parse(raw) as { key?: 'repo' | 'tag' | 'id' | 'size' | 'created' }
      return parsed.key || 'repo'
    } catch {
      return 'repo'
    }
  })
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    try {
      const raw = localStorage.getItem(IMAGES_SORT_KEY)
      if (!raw) return 'asc'
      const parsed = JSON.parse(raw) as { dir?: 'asc' | 'desc' }
      return parsed.dir || 'asc'
    } catch {
      return 'asc'
    }
  })
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [page, setPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem(IMAGES_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])

  useEffect(() => {
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(pageSize))
  }, [pageSize])

  const {
    data: images = [],
    isLoading: loading,
    error,
  } = useQuery<DockerImage[]>({
    queryKey: ['docker', 'images', serverId],
    queryFn: async () => {
      const res = await pb.send(`/api/ext/docker/images?server_id=${serverId}`, { method: "GET" })
      return parseImages(res.output)
    },
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  })

  const removeImage = async (id: string) => {
    try {
      setActionError(null)
      await pb.send(`/api/ext/docker/images/${id}?server_id=${serverId}`, { method: "DELETE" })
      await queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to remove image'))
    }
  }

  const pruneImages = async () => {
    try {
      setActionError(null)
      await pb.send(`/api/ext/docker/images/prune?server_id=${serverId}`, { method: "POST" })
      await queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to prune images'))
    }
  }

  const pullImage = async () => {
    if (!pullName.trim()) return
    try {
      setActionError(null)
      await pb.send(`/api/ext/docker/images/pull?server_id=${serverId}`, {
        method: "POST",
        body: { name: pullName.trim() },
      })
      setPullName("")
      await queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to pull image'))
    }
  }

  const loadError = error ? getApiErrorMessage(error, 'Failed to load images') : null

  const filtered = images.filter(
    (i) =>
      i.Repository?.toLowerCase().includes(filter.toLowerCase()) ||
      i.Tag?.toLowerCase().includes(filter.toLowerCase()),
  )

  const sorted = useMemo(() => {
    const items = [...filtered]
    items.sort((left, right) => {
      const leftValue = (() => {
        switch (sortKey) {
          case 'tag': return left.Tag || ''
          case 'id': return left.ID || ''
          case 'size': return left.Size || ''
          case 'created': return left.CreatedSince || ''
          default: return left.Repository || ''
        }
      })().toLowerCase()
      const rightValue = (() => {
        switch (sortKey) {
          case 'tag': return right.Tag || ''
          case 'id': return right.ID || ''
          case 'size': return right.Size || ''
          case 'created': return right.CreatedSince || ''
          default: return right.Repository || ''
        }
      })().toLowerCase()
      if (leftValue < rightValue) return sortDir === 'asc' ? -1 : 1
      if (leftValue > rightValue) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [filtered, sortDir, sortKey])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return sorted.slice(start, start + pageSize)
  }, [page, pageSize, sorted])

  useEffect(() => {
    setPage(1)
  }, [filter, sortDir, sortKey, pageSize, serverId])

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const toggleSort = (key: 'repo' | 'tag' | 'id' | 'size' | 'created') => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const SortHead = ({ label, keyName }: { label: string; keyName: 'repo' | 'tag' | 'id' | 'size' | 'created' }) => (
    <Button variant="ghost" size="sm" className="h-7 -ml-2 px-2 text-xs" onClick={() => toggleSort(keyName)}>
      {label}
      <ArrowUpDown className="h-3 w-3 ml-1" />
    </Button>
  )

  return (
    <div className="h-full min-h-0 flex flex-col gap-4 pt-4">
      {(loadError || actionError) && (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>{loadError || actionError}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center gap-2 shrink-0">
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

      </div>
      <div data-docker-scroll-root="true" className="h-0 flex-1 min-h-0 overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead><SortHead label="Repository" keyName="repo" /></TableHead>
            <TableHead><SortHead label="Tag" keyName="tag" /></TableHead>
            <TableHead><SortHead label="ID" keyName="id" /></TableHead>
            <TableHead><SortHead label="Size" keyName="size" /></TableHead>
            <TableHead><SortHead label="Created" keyName="created" /></TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.map((img) => (
            <TableRow key={img.ID}>
              <TableCell className="font-mono text-xs">{img.Repository}</TableCell>
              <TableCell className="text-xs">{img.Tag}</TableCell>
              <TableCell className="font-mono text-xs" title={img.ID}>{img.ID?.substring(0, 12)}</TableCell>
              <TableCell className="text-xs">{img.Size}</TableCell>
              <TableCell className="text-xs">{img.CreatedSince}</TableCell>
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
          {!loading && sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No images found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="text-xs text-muted-foreground">
          {sorted.length === 0 ? '0 items' : `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, sorted.length)} of ${sorted.length}`}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={pageSize}
            onChange={(e) => {
              const next = Number(e.target.value) as 25 | 50 | 100
              setPageSize(next)
              setPage(1)
            }}
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Prev
          </Button>
          <span className="text-xs text-muted-foreground w-16 text-center">{page} / {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
