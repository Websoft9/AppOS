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
import { Trash2, MoreVertical, Eraser, ArrowUpDown } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { getApiErrorMessage } from "@/lib/api-error"

const VOLUMES_SORT_KEY = 'docker.volumes.sort'
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

interface Volume {
  Name: string
  Driver: string
  Mountpoint: string
}

interface Container {
  ID: string
  Names: string
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

function parseInspect(output: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed) && parsed[0]) return parsed[0] as Record<string, any>
    return null
  } catch {
    return null
  }
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

export function VolumesTab({
  serverId,
  refreshSignal = 0,
  onOpenContainerFilter,
}: {
  serverId: string
  refreshSignal?: number
  onOpenContainerFilter?: (volumeName: string, containerNames: string[]) => void
}) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState("")
  const [sortKey, setSortKey] = useState<'name' | 'driver' | 'mountpoint' | 'containers'>(() => {
    try {
      const raw = localStorage.getItem(VOLUMES_SORT_KEY)
      if (!raw) return 'name'
      const parsed = JSON.parse(raw) as { key?: 'name' | 'driver' | 'mountpoint' | 'containers' }
      return parsed.key || 'name'
    } catch {
      return 'name'
    }
  })
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    try {
      const raw = localStorage.getItem(VOLUMES_SORT_KEY)
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
    localStorage.setItem(VOLUMES_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])

  useEffect(() => {
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(pageSize))
  }, [pageSize])

  const {
    data: volumesData,
    isLoading: loading,
    error,
  } = useQuery<{ volumes: Volume[]; volumeContainers: Record<string, string[]> }>({
    queryKey: ['docker', 'volumes', serverId, refreshSignal],
    queryFn: async () => {
      const res = await pb.send(`/api/ext/docker/volumes?server_id=${serverId}`, { method: "GET" })
      const nextVolumes = parseVolumes(res.output)

      const containersRes = await pb.send(`/api/ext/docker/containers?server_id=${serverId}`, { method: "GET" })
      const containers = parseContainers(containersRes.output)

      const inspectEntries = await Promise.all(
        containers.map(async (container) => {
          try {
            const inspectRes = await pb.send(`/api/ext/docker/containers/${container.ID}?server_id=${serverId}`, { method: "GET" })
            return [container.Names, parseInspect(inspectRes.output)] as const
          } catch {
            return [container.Names, null] as const
          }
        }),
      )

      const mapping: Record<string, string[]> = {}
      for (const volume of nextVolumes) mapping[volume.Name] = []
      for (const [containerName, inspect] of inspectEntries) {
        const mounts = inspect?.Mounts as Array<{ Name?: string; Source?: string; Type?: string }> | undefined
        if (!Array.isArray(mounts)) continue
        for (const mount of mounts) {
          const mountedVolume = mount.Name
          if (mountedVolume && mapping[mountedVolume]) {
            mapping[mountedVolume].push(containerName)
          }
        }
      }

      return { volumes: nextVolumes, volumeContainers: mapping }
    },
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  })

  const volumes = volumesData?.volumes || []
  const volumeContainers = volumesData?.volumeContainers || {}

  const removeVolume = async (name: string) => {
    try {
      setActionError(null)
      await pb.send(`/api/ext/docker/volumes/${name}?server_id=${serverId}`, { method: "DELETE" })
      await queryClient.invalidateQueries({ queryKey: ['docker', 'volumes', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to remove volume'))
    }
  }

  const pruneVolumes = async () => {
    try {
      setActionError(null)
      await pb.send(`/api/ext/docker/volumes/prune?server_id=${serverId}`, { method: "POST" })
      await queryClient.invalidateQueries({ queryKey: ['docker', 'volumes', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to prune volumes'))
    }
  }

  const loadError = error ? getApiErrorMessage(error, 'Failed to load volumes') : null

  const filtered = volumes.filter((v) =>
    v.Name?.toLowerCase().includes(filter.toLowerCase()),
  )

  const sorted = useMemo(() => {
    const items = [...filtered]
    items.sort((left, right) => {
      const leftValue = (() => {
        switch (sortKey) {
          case 'driver': return left.Driver || ''
          case 'mountpoint': return left.Mountpoint || ''
          case 'containers': return String(volumeContainers[left.Name]?.length || 0)
          default: return left.Name || ''
        }
      })().toLowerCase()
      const rightValue = (() => {
        switch (sortKey) {
          case 'driver': return right.Driver || ''
          case 'mountpoint': return right.Mountpoint || ''
          case 'containers': return String(volumeContainers[right.Name]?.length || 0)
          default: return right.Name || ''
        }
      })().toLowerCase()
      if (leftValue < rightValue) return sortDir === 'asc' ? -1 : 1
      if (leftValue > rightValue) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [filtered, sortDir, sortKey, volumeContainers])

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

  const toggleSort = (key: 'name' | 'driver' | 'mountpoint' | 'containers') => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const SortHead = ({ label, keyName }: { label: string; keyName: 'name' | 'driver' | 'mountpoint' | 'containers' }) => (
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
          placeholder="Filter volumes..."
          className="border rounded-md px-3 py-1.5 text-sm bg-background"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={pruneVolumes}>
          <Eraser className="h-4 w-4 mr-1" /> Prune unused
        </Button>

      </div>
      <div data-docker-scroll-root="true" className="h-0 flex-1 min-h-0 overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead><SortHead label="Name" keyName="name" /></TableHead>
            <TableHead><SortHead label="Driver" keyName="driver" /></TableHead>
            <TableHead><SortHead label="Mountpoint" keyName="mountpoint" /></TableHead>
            <TableHead><SortHead label="Containers" keyName="containers" /></TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.map((v) => (
            <TableRow key={v.Name}>
              <TableCell className="font-mono text-xs">{v.Name}</TableCell>
              <TableCell className="text-xs">{v.Driver}</TableCell>
              <TableCell className="font-mono text-xs truncate max-w-[300px]">
                {v.Mountpoint}
              </TableCell>
              <TableCell className="text-xs">
                {(volumeContainers[v.Name] || []).length > 0 ? (
                  <Button
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => onOpenContainerFilter?.(v.Name, volumeContainers[v.Name] || [])}
                  >
                    {(volumeContainers[v.Name] || []).length} container(s)
                  </Button>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
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
          {!loading && sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No volumes found
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
