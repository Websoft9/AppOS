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
import { Trash2, MoreVertical, Plus, ArrowUpDown } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { getApiErrorMessage } from "@/lib/api-error"

const NETWORKS_SORT_KEY = 'docker.networks.sort'
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
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState("")
  const [newName, setNewName] = useState("")
  const [sortKey, setSortKey] = useState<'name' | 'id' | 'driver' | 'scope'>(() => {
    try {
      const raw = localStorage.getItem(NETWORKS_SORT_KEY)
      if (!raw) return 'name'
      const parsed = JSON.parse(raw) as { key?: 'name' | 'id' | 'driver' | 'scope' }
      return parsed.key || 'name'
    } catch {
      return 'name'
    }
  })
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => {
    try {
      const raw = localStorage.getItem(NETWORKS_SORT_KEY)
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
    localStorage.setItem(NETWORKS_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])

  useEffect(() => {
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(pageSize))
  }, [pageSize])

  const {
    data: networks = [],
    isLoading: loading,
    error,
  } = useQuery<Network[]>({
    queryKey: ['docker', 'networks', serverId, refreshSignal],
    queryFn: async () => {
      const res = await pb.send(`/api/ext/docker/networks?server_id=${serverId}`, { method: "GET" })
      return parseNetworks(res.output)
    },
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  })

  const removeNetwork = async (id: string) => {
    try {
      setActionError(null)
      await pb.send(`/api/ext/docker/networks/${id}?server_id=${serverId}`, { method: "DELETE" })
      await queryClient.invalidateQueries({ queryKey: ['docker', 'networks', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to remove network'))
    }
  }

  const createNetwork = async () => {
    if (!newName.trim()) return
    try {
      setActionError(null)
      await pb.send(`/api/ext/docker/networks?server_id=${serverId}`, {
        method: "POST",
        body: { name: newName.trim() },
      })
      setNewName("")
      await queryClient.invalidateQueries({ queryKey: ['docker', 'networks', serverId] })
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to create network'))
    }
  }

  const loadError = error ? getApiErrorMessage(error, 'Failed to load networks') : null

  const filtered = networks.filter((n) =>
    n.Name?.toLowerCase().includes(filter.toLowerCase()),
  )

  const sorted = useMemo(() => {
    const items = [...filtered]
    items.sort((left, right) => {
      const leftValue = (() => {
        switch (sortKey) {
          case 'id': return left.ID || ''
          case 'driver': return left.Driver || ''
          case 'scope': return left.Scope || ''
          default: return left.Name || ''
        }
      })().toLowerCase()
      const rightValue = (() => {
        switch (sortKey) {
          case 'id': return right.ID || ''
          case 'driver': return right.Driver || ''
          case 'scope': return right.Scope || ''
          default: return right.Name || ''
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

  const toggleSort = (key: 'name' | 'id' | 'driver' | 'scope') => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const SortHead = ({ label, keyName }: { label: string; keyName: 'name' | 'id' | 'driver' | 'scope' }) => (
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
      <div data-docker-scroll-root="true" className="h-0 flex-1 min-h-0 overflow-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 bg-background z-10">
          <TableRow>
            <TableHead><SortHead label="Name" keyName="name" /></TableHead>
            <TableHead><SortHead label="ID" keyName="id" /></TableHead>
            <TableHead><SortHead label="Driver" keyName="driver" /></TableHead>
            <TableHead><SortHead label="Scope" keyName="scope" /></TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {paged.map((n) => (
            <TableRow key={n.ID}>
              <TableCell className="font-mono text-xs">{n.Name}</TableCell>
              <TableCell className="font-mono text-xs">{n.ID?.substring(0, 12)}</TableCell>
              <TableCell className="text-xs">{n.Driver}</TableCell>
              <TableCell className="text-xs">{n.Scope}</TableCell>
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
          {!loading && sorted.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No networks found
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
