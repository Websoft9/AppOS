import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pb } from '@/lib/pb'
import { dockerApiPath, dockerApiUrl } from '@/lib/docker-api'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Download,
  Trash2,
  MoreVertical,
  Eraser,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Search,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { getApiErrorMessage } from '@/lib/api-error'
import { cn } from '@/lib/utils'

const IMAGES_SORT_KEY = 'docker.images.sort'
const DOCKER_PAGE_SIZE_KEY = 'docker.list.page_size'

function loadGlobalPageSize(): 25 | 50 | 100 {
  try {
    const raw = Number(localStorage.getItem(DOCKER_PAGE_SIZE_KEY) || '50')
    if (raw === 25 || raw === 50 || raw === 100) return raw
  } catch {
    return 50
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

interface DockerContainerRow {
  ID: string
  Names?: string
  Image: string
  ImageID?: string
}

interface RegistrySearchItem {
  name: string
  description?: string
  star_count?: number
  is_official?: boolean
}

function parseImages(output: string): DockerImage[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean) as DockerImage[]
}

function parseContainers(output: string): DockerContainerRow[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean) as DockerContainerRow[]
}

function parseRegistrySearch(output: string): RegistrySearchItem[] {
  if (!output.trim()) return []
  return output
    .trim()
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .map((item: any) => ({
      name: String(item.Name || item.name || ''),
      description: String(item.Description || item.description || ''),
      star_count: Number(item.StarCount || item.star_count || 0),
      is_official: Boolean(item.IsOfficial || item.is_official || false),
    }))
    .filter((item: RegistrySearchItem) => !!item.name)
}

function normalizeImageId(id?: string): string {
  if (!id) return ''
  return id
    .replace(/^sha256:/, '')
    .trim()
    .toLowerCase()
}

function imageRef(image: DockerImage): string {
  if (!image.Repository || image.Repository === '<none>') return ''
  if (!image.Tag || image.Tag === '<none>') return image.Repository
  return `${image.Repository}:${image.Tag}`
}

function isImageUsed(image: DockerImage, containers: DockerContainerRow[]): boolean {
  const ref = imageRef(image)
  const targetId = normalizeImageId(image.ID)

  for (const container of containers) {
    const byName = (container.Image || '').toLowerCase()
    if (ref && byName === ref.toLowerCase()) return true

    const byImageId = normalizeImageId(container.ImageID)
    if (
      targetId &&
      byImageId &&
      (targetId.startsWith(byImageId.slice(0, 12)) || byImageId.startsWith(targetId.slice(0, 12)))
    ) {
      return true
    }

    if (targetId && byName.includes(targetId.slice(0, 12))) return true
  }
  return false
}

function relatedContainersForImage(
  image: DockerImage,
  containers: DockerContainerRow[]
): DockerContainerRow[] {
  const ref = imageRef(image)
  const targetId = normalizeImageId(image.ID)

  return containers.filter(container => {
    const byName = (container.Image || '').toLowerCase()
    if (ref && byName === ref.toLowerCase()) return true

    const byImageId = normalizeImageId(container.ImageID)
    if (
      targetId &&
      byImageId &&
      (targetId.startsWith(byImageId.slice(0, 12)) || byImageId.startsWith(targetId.slice(0, 12)))
    ) {
      return true
    }

    return !!(targetId && byName.includes(targetId.slice(0, 12)))
  })
}

export type ImagesTabRef = {
  openPullDialog: (defaultImage?: string) => void
  openPruneDialog: () => void
}

export const ImagesTab = forwardRef<
  ImagesTabRef,
  {
    serverId: string
    refreshSignal?: number
    embeddedInWorkspace?: boolean
    externalFilter?: string
    externalUsageFilter?: 'all' | 'used' | 'unused'
    page?: number
    pageSize?: 25 | 50 | 100
    onPageChange?: (page: number) => void
    onOpenContainerFilter?: (imageName: string, containerNames: string[]) => void
    onSummaryChange?: (summary: {
      totalItems: number
      totalPages: number
      usedItems: number
      unusedItems: number
    }) => void
  }
>(function ImagesTab({
  serverId,
  refreshSignal = 0,
  embeddedInWorkspace = false,
  externalFilter,
  externalUsageFilter,
  page: externalPage,
  pageSize: externalPageSize,
  onPageChange,
  onOpenContainerFilter,
  onSummaryChange,
}, ref) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [usageFilter, setUsageFilter] = useState<'all' | 'used' | 'unused'>('all')
  const [sortKey, setSortKey] = useState<'repo' | 'size' | 'created'>(() => {
    try {
      const raw = localStorage.getItem(IMAGES_SORT_KEY)
      if (!raw) return 'repo'
      const parsed = JSON.parse(raw) as { key?: 'repo' | 'tag' | 'id' | 'size' | 'created' }
      return parsed.key === 'repo' || parsed.key === 'size' || parsed.key === 'created'
        ? parsed.key
        : 'repo'
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
  const [internalPageSize, setInternalPageSize] = useState<25 | 50 | 100>(loadGlobalPageSize)
  const [internalPage, setInternalPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)

  const effectivePage = externalPage ?? internalPage
  const effectivePageSize = externalPageSize ?? internalPageSize

  const changePage = (p: number) => {
    setInternalPage(p)
    onPageChange?.(p)
  }

  const [expandedImageId, setExpandedImageId] = useState<string | null>(null)
  const [inspectMap, setInspectMap] = useState<Record<string, string>>({})
  const [inspectLoadingMap, setInspectLoadingMap] = useState<Record<string, boolean>>({})

  const changePageSize = (size: 25 | 50 | 100) => {
    if (externalPageSize !== undefined) return
    setInternalPageSize(size)
    localStorage.setItem(DOCKER_PAGE_SIZE_KEY, String(size))
    setInternalPage(1)
  }

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [pruneConfirmOpen, setPruneConfirmOpen] = useState(false)
  const [mockPruneNotice, setMockPruneNotice] = useState<string | null>(null)

  const [pullDialogOpen, setPullDialogOpen] = useState(false)
  const [registryName, setRegistryName] = useState('Docker Hub')
  const [registryAvailable, setRegistryAvailable] = useState<boolean | null>(null)
  const [registryChecking, setRegistryChecking] = useState(false)
  const [registryReason, setRegistryReason] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<RegistrySearchItem[]>([])
  const [selectedPullImage, setSelectedPullImage] = useState('')
  const [pulling, setPulling] = useState(false)
  const [pullLog, setPullLog] = useState('')

  const toggleImageExpansion = (imageId: string) => {
    setExpandedImageId(current => {
      const next = current === imageId ? null : imageId
      if (next === imageId) {
        void loadImageInspect(imageId)
      }
      return next
    })
  }

  useEffect(() => {
    if (externalFilter !== undefined) setFilter(externalFilter)
  }, [externalFilter])
  useEffect(() => {
    if (externalUsageFilter !== undefined) setUsageFilter(externalUsageFilter)
  }, [externalUsageFilter])

  useEffect(() => {
    localStorage.setItem(IMAGES_SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
  }, [sortDir, sortKey])

  const {
    data: images = [],
    isLoading: loading,
    error,
  } = useQuery<DockerImage[]>({
    queryKey: ['docker', 'images', serverId, refreshSignal],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/images'), { method: 'GET' })
      return parseImages(res.output)
    },
    placeholderData: previousData => previousData,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
  })

  const { data: containers = [] } = useQuery<DockerContainerRow[]>({
    queryKey: ['docker', 'containers', 'for-images', serverId, refreshSignal],
    queryFn: async () => {
      const res = await pb.send(dockerApiPath(serverId, '/containers'), {
        method: 'GET',
      })
      return parseContainers(res.output)
    },
    placeholderData: previousData => previousData,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
  })

  const usageMap = useMemo(() => {
    const next: Record<string, boolean> = {}
    for (const img of images) {
      next[img.ID] = isImageUsed(img, containers)
    }
    return next
  }, [containers, images])

  const usedCount = useMemo(
    () => images.filter(image => !!usageMap[image.ID]).length,
    [images, usageMap]
  )
  const unusedCount = images.length - usedCount

  useEffect(() => {
    setSelectedIds(current => current.filter(id => !usageMap[id]))
  }, [usageMap])

  const loadImageInspect = async (id: string) => {
    if (!id || inspectMap[id] || inspectLoadingMap[id]) return
    setInspectLoadingMap(state => ({ ...state, [id]: true }))
    try {
      const res = await pb.send(dockerApiPath(serverId, `/images/${id}/inspect`), {
        method: 'GET',
      })
      setInspectMap(state => ({ ...state, [id]: String(res.output || '') }))
    } catch (err) {
      setInspectMap(state => ({
        ...state,
        [id]: getApiErrorMessage(err, 'Failed to inspect image'),
      }))
    } finally {
      setInspectLoadingMap(state => ({ ...state, [id]: false }))
    }
  }

  const removeImage = async (id: string) => {
    try {
      setActionError(null)
      await pb.send(dockerApiPath(serverId, `/images/${id}`), { method: 'DELETE' })
      setSelectedIds(state => state.filter(item => item !== id))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] }),
        queryClient.invalidateQueries({
          queryKey: ['docker', 'containers', 'for-images', serverId],
        }),
      ])
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to remove image'))
    }
  }

  const removeSelectedUnused = async () => {
    if (selectedIds.length === 0) return
    try {
      setActionError(null)
      const results = await Promise.allSettled(
        selectedIds.map(async id => {
          await pb.send(dockerApiPath(serverId, `/images/${id}`), { method: 'DELETE' })
          return id
        })
      )
      const succeeded = results
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map(r => r.value)
      const failed = results.filter(r => r.status === 'rejected')
      setSelectedIds(state => state.filter(id => !succeeded.includes(id)))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] }),
        queryClient.invalidateQueries({
          queryKey: ['docker', 'containers', 'for-images', serverId],
        }),
      ])
      if (failed.length > 0) {
        setActionError(`${failed.length} of ${selectedIds.length} images failed to remove`)
      }
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to remove selected images'))
    }
  }

  const pruneImages = async () => {
    try {
      setActionError(null)
      setMockPruneNotice(null)
      await pb.send(dockerApiPath(serverId, '/images/prune'), { method: 'POST' })
      setMockPruneNotice('Prune completed.')
      setSelectedIds([])
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] }),
        queryClient.invalidateQueries({
          queryKey: ['docker', 'containers', 'for-images', serverId],
        }),
      ])
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to prune images'))
    }
  }

  const checkRegistry = async () => {
    setRegistryChecking(true)
    setRegistryReason('')
    setRegistryAvailable(null)
    try {
      const res = (await pb.send(dockerApiPath(serverId, '/images/registry/status'), {
        method: 'GET',
      })) as { available?: boolean; registry?: string; reason?: string }
      setRegistryAvailable(!!res.available)
      setRegistryName(res.registry || 'Docker Hub')
      setRegistryReason(res.reason || '')
    } catch (err) {
      setRegistryAvailable(false)
      setRegistryReason(getApiErrorMessage(err, 'Registry check failed'))
    } finally {
      setRegistryChecking(false)
    }
  }

  const openPullDialog = (prefill?: string) => {
    setPullDialogOpen(true)
    setSearchResults([])
    setSearchQuery(prefill || '')
    setSelectedPullImage(prefill || '')
    setPullLog('')
    void checkRegistry()
  }

  useImperativeHandle(ref, () => ({
    openPullDialog: (defaultImage?: string) => openPullDialog(defaultImage),
    openPruneDialog: () => setPruneConfirmOpen(true),
  }))

  const searchRegistry = async () => {
    const keyword = searchQuery.trim()
    if (!keyword) return
    setSearching(true)
    setSearchResults([])
    try {
      const res = await pb.send(dockerApiUrl(serverId, '/images/registry/search', { q: keyword, limit: 30 }), {
        method: 'GET',
      })
      setSearchResults(parseRegistrySearch(String(res.output || '')))
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to search registry'))
    } finally {
      setSearching(false)
    }
  }

  const pullSelectedImage = async () => {
    const name = selectedPullImage.trim()
    if (!name) return
    try {
      setActionError(null)
      setPulling(true)
      setPullLog(`Pulling ${name}...`)
      const res = await pb.send(dockerApiPath(serverId, '/images/pull'), {
        method: 'POST',
        body: { name },
      })
      setPullLog(String(res.output || '(no output)'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] }),
        queryClient.invalidateQueries({
          queryKey: ['docker', 'containers', 'for-images', serverId],
        }),
      ])
    } catch (err) {
      setPullLog(getApiErrorMessage(err, 'Failed to pull image'))
    } finally {
      setPulling(false)
    }
  }

  const loadError = error ? getApiErrorMessage(error, 'Failed to load images') : null

  const filtered = images.filter(image => {
    const textMatched =
      image.Repository?.toLowerCase().includes(filter.toLowerCase()) ||
      image.Tag?.toLowerCase().includes(filter.toLowerCase())
    if (!textMatched) return false

    const used = !!usageMap[image.ID]
    if (usageFilter === 'used') return used
    if (usageFilter === 'unused') return !used
    return true
  })

  const sorted = useMemo(() => {
    const items = [...filtered]
    items.sort((left, right) => {
      const leftValue = (() => {
        switch (sortKey) {
          case 'size':
            return left.Size || ''
          case 'created':
            return left.CreatedSince || ''
          default:
            return left.Repository || ''
        }
      })().toLowerCase()
      const rightValue = (() => {
        switch (sortKey) {
          case 'size':
            return right.Size || ''
          case 'created':
            return right.CreatedSince || ''
          default:
            return right.Repository || ''
        }
      })().toLowerCase()
      if (leftValue < rightValue) return sortDir === 'asc' ? -1 : 1
      if (leftValue > rightValue) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [filtered, sortDir, sortKey])

  const totalPages = Math.max(1, Math.ceil(sorted.length / effectivePageSize))
  const paged = useMemo(() => {
    const start = (effectivePage - 1) * effectivePageSize
    return sorted.slice(start, start + effectivePageSize)
  }, [effectivePage, effectivePageSize, sorted])

  useEffect(() => {
    changePage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, usageFilter, sortDir, sortKey, effectivePageSize, serverId])

  useEffect(() => {
    if (effectivePage > totalPages) changePage(totalPages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePage, totalPages])

  useEffect(() => {
    onSummaryChange?.({
      totalItems: sorted.length,
      totalPages,
      usedItems: usedCount,
      unusedItems: unusedCount,
    })
  }, [onSummaryChange, sorted.length, totalPages, unusedCount, usedCount])

  const toggleSort = (key: 'repo' | 'size' | 'created') => {
    if (sortKey === key) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDir('asc')
  }

  const toggleImageSelect = (image: DockerImage) => {
    if (usageMap[image.ID]) return
    setSelectedIds(state =>
      state.includes(image.ID) ? state.filter(id => id !== image.ID) : [...state, image.ID]
    )
  }

  const selectableIds = useMemo(
    () => sorted.filter(image => !usageMap[image.ID]).map(image => image.ID),
    [sorted, usageMap]
  )
  const relatedContainersMap = useMemo(() => {
    const next: Record<string, string[]> = {}
    for (const image of images) {
      next[image.ID] = relatedContainersForImage(image, containers)
        .map(container => (container.Names || '').trim())
        .filter(Boolean)
    }
    return next
  }, [containers, images])
  const allSelectableChecked =
    selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id))
  const someSelectableChecked = selectableIds.some(id => selectedIds.includes(id))

  const toggleSelectAll = () => {
    if (selectableIds.length === 0) return
    setSelectedIds(current => {
      if (allSelectableChecked) {
        return current.filter(id => !selectableIds.includes(id))
      }
      const next = new Set(current)
      selectableIds.forEach(id => next.add(id))
      return Array.from(next)
    })
  }

  const SortHead = ({
    label,
    keyName,
  }: {
    label: string
    keyName: 'repo' | 'size' | 'created'
  }) => (
    <button
      type="button"
      className="inline-flex h-7 cursor-pointer items-center gap-1 rounded px-0 text-xs font-medium text-muted-foreground/80 transition-colors hover:text-foreground"
      onClick={() => toggleSort(keyName)}
    >
      {label}
      {sortKey !== keyName ? (
        <ArrowUpDown className="h-3 w-3" />
      ) : sortDir === 'asc' ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )}
    </button>
  )

  return (
    <div
      className={cn(
        'h-full min-h-0 flex flex-col gap-4',
        embeddedInWorkspace ? 'pt-0' : 'pt-4'
      )}
    >
      {(loadError || actionError) && (
        <Alert variant="destructive" className="shrink-0">
          <AlertDescription>{loadError || actionError}</AlertDescription>
        </Alert>
      )}
      {!embeddedInWorkspace && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-3 shrink-0">
            <input
              type="text"
              placeholder="Filter images..."
              className="h-9 min-w-[14rem] rounded-md border bg-background px-3 text-sm"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={usageFilter}
              onChange={e => setUsageFilter(e.target.value as 'all' | 'used' | 'unused')}
            >
              <option value="all">All images</option>
              <option value="used">Used ({usedCount})</option>
              <option value="unused">Unused ({unusedCount})</option>
            </select>

            <div className="flex-1" />

            <Button variant="link" size="sm" onClick={() => openPullDialog()}>
              Pull image
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={selectedIds.length === 0}
              onClick={() => setBatchDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Remove selected ({selectedIds.length})
            </Button>

            <Button variant="outline" size="sm" onClick={() => setPruneConfirmOpen(true)}>
              <Eraser className="h-4 w-4 mr-1" /> Prune
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/10 px-3 py-2 shrink-0">
            {usageFilter === 'unused' && <Badge variant="outline">Only unused images</Badge>}
            {usageFilter === 'used' && <Badge variant="outline">Only used images</Badge>}
            {mockPruneNotice && <Badge variant="secondary">{mockPruneNotice}</Badge>}
          </div>
        </>
      )}
      {embeddedInWorkspace && selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 shrink-0 pb-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBatchDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-1" /> Remove selected ({selectedIds.length})
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg bg-background">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
              <TableRow>
                <TableHead className="w-[26%] min-w-[220px] pl-4 pr-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={allSelectableChecked ? true : someSelectableChecked ? 'indeterminate' : false}
                      disabled={selectableIds.length === 0}
                      onCheckedChange={() => toggleSelectAll()}
                      aria-label="Select all unused images"
                    />
                    <SortHead label="Repository" keyName="repo" />
                  </div>
                </TableHead>
                <TableHead className="min-w-[110px] text-xs font-medium text-foreground">
                  ID
                </TableHead>
                <TableHead className="min-w-[100px] text-xs font-medium text-foreground">
                  Tag
                </TableHead>
                <TableHead className="min-w-[150px] text-xs font-medium text-foreground">
                  Containers
                </TableHead>
                <TableHead className="min-w-[80px]">
                  <div className="flex items-center">
                    <SortHead label="Size" keyName="size" />
                  </div>
                </TableHead>
                <TableHead className="min-w-[120px]">
                  <div className="flex items-center">
                    <SortHead label="Created" keyName="created" />
                  </div>
                </TableHead>
                <TableHead className="w-[52px] text-xs font-medium text-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {paged.map(img => {
                const used = !!usageMap[img.ID]
                const isExpanded = expandedImageId === img.ID
                const linkedContainers = relatedContainersMap[img.ID] || []
                return (
                  <Fragment key={img.ID}>
                    <TableRow className={cn(used && 'opacity-60', isExpanded && 'bg-muted/20')}>
                      <TableCell
                        className="cursor-pointer pl-4 pr-3 py-3 text-xs"
                        onClick={event => {
                          const target = event.target as HTMLElement
                          if (target.closest('button,input,[role="checkbox"]')) return
                          toggleImageExpansion(img.ID)
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Checkbox
                            checked={selectedIds.includes(img.ID)}
                            disabled={used}
                            onCheckedChange={() => toggleImageSelect(img)}
                          />
                          <button
                            type="button"
                            className="min-w-0 truncate text-left font-mono text-xs font-semibold leading-tight text-foreground hover:underline"
                            title={img.Repository}
                            onClick={() => toggleImageExpansion(img.ID)}
                          >
                            {img.Repository}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 font-mono text-xs" title={img.ID}>
                        {img.ID?.substring(0, 12)}
                      </TableCell>
                      <TableCell className="py-3 text-xs">{img.Tag}</TableCell>
                      <TableCell className="py-3 text-xs">
                        {linkedContainers.length > 0 ? (
                          <Button
                            variant="link"
                            className="h-auto p-0 text-left text-xs"
                            title={linkedContainers.join(', ')}
                            onClick={() => onOpenContainerFilter?.(imageRef(img) || img.Repository, linkedContainers)}
                          >
                            <span className="truncate">{linkedContainers.length} container{linkedContainers.length > 1 ? 's' : ''}</span>
                            <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="py-3 text-xs">{img.Size}</TableCell>
                      <TableCell className="py-3 text-xs text-muted-foreground">{img.CreatedSince}</TableCell>
                      <TableCell className="py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => setTimeout(() => openPullDialog(imageRef(img) || img.Repository), 0)}
                            >
                              <Download className="h-4 w-4 mr-2" /> Pull
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setTimeout(() => removeImage(img.ID), 0)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow>
                          <TableCell colSpan={7} className="bg-muted/20 px-0 py-3">
                          {inspectLoadingMap[img.ID] ? (
                            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" /> Loading inspect...
                            </div>
                          ) : (
                            <pre className="max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-xs">
                              {inspectMap[img.ID] || '(empty output)'}
                            </pre>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
              {!loading && sorted.length === 0 && (
                <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No images found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {!embeddedInWorkspace && (
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="text-xs text-muted-foreground">
            {sorted.length === 0
              ? '0 items'
              : `${(effectivePage - 1) * effectivePageSize + 1}–${Math.min(effectivePage * effectivePageSize, sorted.length)} of ${sorted.length}`}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <select
              className="h-8 rounded-md border bg-background px-2 text-xs"
              value={String(effectivePageSize)}
              onChange={event => changePageSize(Number(event.target.value) as 25 | 50 | 100)}
            >
              <option value="25">25 / page</option>
              <option value="50">50 / page</option>
              <option value="100">100 / page</option>
            </select>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 px-0.5"
              onClick={() => changePage(Math.max(1, effectivePage - 1))}
              disabled={effectivePage <= 1}
              aria-label="Previous images page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-center font-medium tabular-nums">{effectivePage}/{totalPages}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 min-w-0 px-0.5"
              onClick={() => changePage(Math.min(totalPages, effectivePage + 1))}
              disabled={effectivePage >= totalPages}
              aria-label="Next images page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove selected unused images?</AlertDialogTitle>
            <AlertDialogDescription>
              Selected: {selectedIds.length}. Images in use are not selectable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void removeSelectedUnused()}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pruneConfirmOpen} onOpenChange={setPruneConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Prune unused images?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all dangling images not referenced by any container. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setPruneConfirmOpen(false)
                void pruneImages()
              }}
            >
              Prune
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={pullDialogOpen} onOpenChange={setPullDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Pull image</DialogTitle>
            <DialogDescription>
              Connect to default registry and search images to pull.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">Registry: {registryName}</div>
              {registryChecking && (
                <div className="text-xs text-muted-foreground mt-1">Checking connectivity...</div>
              )}
              {!registryChecking && registryAvailable === true && (
                <div className="text-xs text-green-600 mt-1">Registry is reachable.</div>
              )}
              {!registryChecking && registryAvailable === false && (
                <div className="text-xs text-destructive mt-1">
                  Registry is not reachable. {registryReason}
                </div>
              )}
            </div>

            {registryAvailable && (
              <>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Search image in registry..."
                    className="border rounded-md px-3 py-1.5 text-sm bg-background flex-1"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e =>
                      e.key === 'Enter' && (e.preventDefault(), void searchRegistry())
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void searchRegistry()}
                    disabled={searching || !searchQuery.trim()}
                  >
                    <Search className="h-4 w-4 mr-1" /> Search
                  </Button>
                </div>

                <div className="rounded-md border max-h-[220px] overflow-auto">
                  {searching ? (
                    <div className="px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Searching...
                    </div>
                  ) : searchResults.length > 0 ? (
                    <div className="divide-y">
                      {searchResults.map(item => (
                        <button
                          key={item.name}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-muted/30"
                          onClick={() => setSelectedPullImage(item.name)}
                        >
                          <div className="text-sm font-medium flex items-center gap-2">
                            {item.name}
                            {item.is_official && <Badge variant="secondary">Official</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {item.description || '-'}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
                  )}
                </div>
              </>
            )}

            <div className="space-y-2">
              <input
                type="text"
                placeholder="Selected image name"
                className="border rounded-md px-3 py-1.5 text-sm bg-background w-full"
                value={selectedPullImage}
                onChange={e => setSelectedPullImage(e.target.value)}
              />
              <div className="rounded-md border bg-muted/20 p-3 max-h-[200px] overflow-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap">
                  {pullLog || 'Pull logs will appear here.'}
                </pre>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPullDialogOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => void pullSelectedImage()}
              disabled={pulling || !selectedPullImage.trim() || registryAvailable === false}
            >
              {pulling ? 'Pulling...' : 'Pull'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
})
