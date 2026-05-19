import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pb } from '@/lib/pb'
import { dockerApiPath } from '@/lib/docker-api'
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
  DropdownMenuSeparator,
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
  FileText,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  CircleHelp,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DockerTextDialog } from '@/components/docker/DockerTextDialog'
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

interface DockerImagePullOperation {
  id: string
  server_id: string
  image_name: string
  normalized_name: string
  phase: 'accepted' | 'executing' | 'succeeded' | 'failed'
  terminal_status: 'none' | 'success' | 'failed' | 'cancelled'
  failure_phase?: string
  failure_reason?: string
  output?: string
  created?: string
  updated?: string
}

interface DockerImagePullOperationListResponse {
  items?: DockerImagePullOperation[]
}

type PullRegistryOption = {
  id: string
  label: string
  officialSearchUrl: (query: string) => string
}

type RegistryStatusResult = {
  available: boolean
  registry?: string
  reason?: string
}

const PULL_REGISTRY_OPTIONS: PullRegistryOption[] = [
  {
    id: 'docker-hub',
    label: 'Docker Hub',
    officialSearchUrl: query => {
      const keyword = query.trim()
      return keyword
        ? `https://hub.docker.com/search?q=${encodeURIComponent(keyword)}`
        : 'https://hub.docker.com/search'
    },
  },
]

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

function parseInspect(output: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed) && parsed[0]) return parsed[0] as Record<string, any>
    return null
  } catch {
    return null
  }
}

function formatImageNames(inspect?: Record<string, any> | null): string[] {
  const repoTags = inspect?.RepoTags
  if (Array.isArray(repoTags)) {
    const values = repoTags.filter((value: unknown): value is string => typeof value === 'string')
    if (values.length > 0) return values
  }
  return []
}

function formatImageRepositories(inspect?: Record<string, any> | null): string[] {
  const repoTags = formatImageNames(inspect)
  const values = repoTags
    .map(tag => {
      const atDigestIndex = tag.indexOf('@')
      const normalized = atDigestIndex === -1 ? tag : tag.slice(0, atDigestIndex)
      const lastSlash = normalized.lastIndexOf('/')
      const lastColon = normalized.lastIndexOf(':')
      return lastColon > lastSlash ? normalized.slice(0, lastColon) : normalized
    })
    .filter(Boolean)
  return Array.from(new Set(values))
}

function formatImageCreated(created?: string): string {
  if (!created) return '-'
  const timestamp = Date.parse(created)
  if (Number.isNaN(timestamp)) return created
  return new Date(timestamp).toLocaleString()
}

function formatImageBytes(bytes?: unknown): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) return '-'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const digits = value >= 10 || index === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[index]}`
}

function formatImagePorts(inspect?: Record<string, any> | null): string[] {
  const ports = inspect?.Config?.ExposedPorts
  if (!ports || typeof ports !== 'object') return []
  return Object.keys(ports as Record<string, unknown>).sort((left, right) => left.localeCompare(right))
}

function metadataValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '-'
  return value && value.trim() ? value : '-'
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

function splitImageReference(reference: string): { name: string; tag: string } {
  const cleaned = reference.trim()
  if (!cleaned) return { name: '', tag: '' }
  if (cleaned.includes('@')) {
    return { name: cleaned, tag: '' }
  }

  const lastSlash = cleaned.lastIndexOf('/')
  const lastColon = cleaned.lastIndexOf(':')
  if (lastColon > lastSlash) {
    return {
      name: cleaned.slice(0, lastColon),
      tag: cleaned.slice(lastColon + 1),
    }
  }

  return { name: cleaned, tag: '' }
}

function parseImageReferenceParts(reference: string): {
  name: string
  tag: string
  namespace: string
  imageName: string
} {
  const parsed = splitImageReference(reference)
  const segments = parsed.name.split('/').filter(Boolean)
  return {
    name: parsed.name,
    tag: parsed.tag,
    namespace: segments.slice(0, -1).join('/'),
    imageName: segments.at(-1) || parsed.name,
  }
}

function normalizeReferenceInput(reference: string): string {
  return reference.trim()
}

function formatPullOperationTimestamp(value?: string): string {
  if (!value) return '-'
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return value
  return new Date(parsed).toLocaleString()
}

function pullOperationTone(operation: DockerImagePullOperation): 'default' | 'secondary' | 'destructive' {
  if (operation.terminal_status === 'failed') return 'destructive'
  if (operation.terminal_status === 'cancelled') return 'secondary'
  if (operation.terminal_status === 'success') return 'secondary'
  return 'default'
}

function pullOperationLabel(operation: DockerImagePullOperation): string {
  if (operation.terminal_status === 'cancelled') return 'Cancelled'
  if (operation.terminal_status === 'failed') return 'Failed'
  if (operation.terminal_status === 'success') return 'Completed'
  if (operation.phase === 'accepted') return 'Queued'
  return 'Pulling'
}

function canCancelPullOperation(operation: DockerImagePullOperation): boolean {
  return operation.phase === 'accepted' && operation.terminal_status === 'none'
}

function pullOperationStatusHint(operation: DockerImagePullOperation): string {
  if (operation.terminal_status === 'cancelled') return 'Cancelled before execution started.'
  if (operation.terminal_status === 'failed') {
    return operation.failure_reason || 'Pull failed.'
  }
  if (operation.terminal_status === 'success') return 'Pull completed successfully.'
  if (operation.phase === 'accepted') return 'Queued and waiting for an available pull slot on this server.'
  return 'Actively pulling on the target server.'
}

function scoreReferenceMatch(reference: string, input: string): number {
  const normalizedReference = reference.toLowerCase()
  const normalizedInput = input.trim().toLowerCase()
  if (!normalizedInput) return 0

  if (normalizedReference === normalizedInput) return 100

  const parsedInput = parseImageReferenceParts(normalizedInput)
  const parsedReference = parseImageReferenceParts(normalizedReference)

  if (parsedInput.name && parsedInput.tag) {
    if (parsedReference.name === parsedInput.name && parsedReference.tag === parsedInput.tag)
      return 95
    if (parsedReference.name === parsedInput.name && parsedReference.tag.startsWith(parsedInput.tag))
      return 90
    if (
      parsedReference.imageName === parsedInput.imageName &&
      parsedReference.tag.startsWith(parsedInput.tag)
    ) {
      return 88
    }
    if (normalizedReference.startsWith(normalizedInput)) return 82
    if (
      parsedReference.name.includes(parsedInput.name) &&
      parsedReference.tag.includes(parsedInput.tag)
    ) {
      return 72
    }
    return 0
  }

  if (parsedReference.name === parsedInput.name) return 90
  if (parsedReference.imageName === parsedInput.imageName) return 89
  if (parsedReference.namespace === parsedInput.name) return 88
  if (parsedReference.imageName.startsWith(parsedInput.imageName)) return 86
  if (parsedReference.name.startsWith(parsedInput.name)) return 84
  if (parsedReference.namespace.startsWith(parsedInput.name)) return 82
  if (normalizedReference.startsWith(normalizedInput)) return 78
  if (parsedReference.namespace.includes(parsedInput.name)) return 76
  if (parsedReference.imageName.includes(parsedInput.imageName)) return 74
  if (parsedReference.name.includes(parsedInput.name)) return 72
  if (normalizedReference.includes(normalizedInput)) return 56
  return 0
}

export type ImagesTabRef = {
  openPullDialog: (defaultImage?: string) => void
  openPullHistory: (tab?: 'pulling' | 'recents') => void
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
    onPullActivityChange?: (summary: {
      activeCount: number
      recentFailedCount: number
      hasRecentHistory: boolean
    }) => void
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
  onPullActivityChange,
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
  const [inspectDialogImage, setInspectDialogImage] = useState<DockerImage | null>(null)

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
  const [selectedRegistryId, setSelectedRegistryId] = useState(PULL_REGISTRY_OPTIONS[0]?.id ?? 'docker-hub')
  const [pullImageInput, setPullImageInput] = useState('')
  const [pulling, setPulling] = useState(false)
  const [pullLog, setPullLog] = useState('')
  const [pullOperationId, setPullOperationId] = useState<string | null>(null)
  const [pullHistoryOpen, setPullHistoryOpen] = useState(false)
  const [pullHistoryTab, setPullHistoryTab] = useState<'pulling' | 'recents'>('recents')
  const [selectedPullOperation, setSelectedPullOperation] =
    useState<DockerImagePullOperation | null>(null)
  const [pullOperationActionId, setPullOperationActionId] = useState<string | null>(null)
  const [clearPullHistoryOpen, setClearPullHistoryOpen] = useState(false)
  const [clearingPullHistory, setClearingPullHistory] = useState(false)
  const [pullSuggestionsDismissed, setPullSuggestionsDismissed] = useState(false)
  const [registryStatus, setRegistryStatus] = useState<RegistryStatusResult | null>(null)
  const [checkingRegistry, setCheckingRegistry] = useState(false)

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

  const { data: activePullOperations = [] } = useQuery<DockerImagePullOperation[]>({
    queryKey: ['docker', 'image-pull-operations', serverId, 'in_progress'],
    queryFn: async () => {
      const response = (await pb.send(
        dockerApiPath(serverId, '/image-pull-operations?status=in_progress&limit=6'),
        { method: 'GET' }
      )) as DockerImagePullOperationListResponse
      return Array.isArray(response.items) ? response.items : []
    },
    enabled: !!serverId,
    refetchInterval: query => {
      const items = query.state.data ?? []
      return items.length > 0 || !!pullOperationId ? 3000 : false
    },
    placeholderData: previousData => previousData,
    staleTime: 2_000,
    gcTime: 5 * 60_000,
  })

  const { data: recentPullOperations = [] } = useQuery<DockerImagePullOperation[]>({
    queryKey: ['docker', 'image-pull-operations', serverId, 'all'],
    queryFn: async () => {
      const response = (await pb.send(
        dockerApiPath(serverId, '/image-pull-operations?status=all&limit=10'),
        { method: 'GET' }
      )) as DockerImagePullOperationListResponse
      return Array.isArray(response.items) ? response.items : []
    },
    enabled: !!serverId,
    refetchInterval: pullOperationId ? 3000 : false,
    placeholderData: previousData => previousData,
    staleTime: 5_000,
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
    if (!id || inspectMap[id] || inspectLoadingMap[id]) return inspectMap[id] || ''
    setInspectLoadingMap(state => ({ ...state, [id]: true }))
    try {
      const res = await pb.send(dockerApiPath(serverId, `/images/${id}/inspect`), {
        method: 'GET',
      })
      const output = String(res.output || '')
      setInspectMap(state => ({ ...state, [id]: output }))
      return output
    } catch (err) {
      const message = getApiErrorMessage(err, 'Failed to inspect image')
      setInspectMap(state => ({
        ...state,
        [id]: message,
      }))
      return message
    } finally {
      setInspectLoadingMap(state => ({ ...state, [id]: false }))
    }
  }

  const openInspectDialog = (image: DockerImage) => {
    setInspectDialogImage(image)
    void loadImageInspect(image.ID)
  }

  const openPullOperationViewer = async (operation: DockerImagePullOperation) => {
    setSelectedPullOperation(operation)
    setPullHistoryOpen(true)
    try {
      const response = (await pb.send(
        dockerApiPath(serverId, `/image-pull-operations/${operation.id}`),
        { method: 'GET' }
      )) as DockerImagePullOperation
      setSelectedPullOperation(response)
    } catch (err) {
      setSelectedPullOperation({
        ...operation,
        output: getApiErrorMessage(err, 'Failed to load pull operation'),
      })
    }
  }

  const refreshPullOperations = async () => {
    await queryClient.invalidateQueries({ queryKey: ['docker', 'image-pull-operations', serverId] })
  }

  const deletePullOperationRecord = async (operation: DockerImagePullOperation) => {
    try {
      setActionError(null)
      setPullOperationActionId(operation.id)
      await pb.send(dockerApiPath(serverId, `/image-pull-operations/${operation.id}`), { method: 'DELETE' })
      if (selectedPullOperation?.id === operation.id) {
        setSelectedPullOperation(null)
      }
      await refreshPullOperations()
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to delete pull record'))
    } finally {
      setPullOperationActionId(current => (current === operation.id ? null : current))
    }
  }

  const clearPullOperationHistory = async () => {
    try {
      setActionError(null)
      setClearingPullHistory(true)
      await pb.send(dockerApiPath(serverId, '/image-pull-operations'), { method: 'DELETE' })
      setSelectedPullOperation(null)
      setClearPullHistoryOpen(false)
      await refreshPullOperations()
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to clear pull history'))
    } finally {
      setClearingPullHistory(false)
    }
  }

  const cancelQueuedPullOperation = async (operation: DockerImagePullOperation) => {
    try {
      setActionError(null)
      setPullOperationActionId(operation.id)
      const response = (await pb.send(
        dockerApiPath(serverId, `/image-pull-operations/${operation.id}/cancel`),
        { method: 'POST' }
      )) as DockerImagePullOperation
      if (selectedPullOperation?.id === operation.id) {
        setSelectedPullOperation(response)
      }
      await refreshPullOperations()
    } catch (err) {
      setActionError(getApiErrorMessage(err, 'Failed to cancel queued pull'))
    } finally {
      setPullOperationActionId(current => (current === operation.id ? null : current))
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

  const openPullDialog = (prefill?: string) => {
    setPullDialogOpen(true)
    setSelectedRegistryId(PULL_REGISTRY_OPTIONS[0]?.id ?? 'docker-hub')
    setPullImageInput(prefill || '')
    setPullLog('')
    setPullOperationId(null)
    setPulling(false)
    setPullSuggestionsDismissed(false)
    setRegistryStatus(null)
  }

  useImperativeHandle(ref, () => ({
    openPullDialog: (defaultImage?: string) => openPullDialog(defaultImage),
    openPullHistory: (tab = 'recents') => {
      setSelectedPullOperation(null)
      setPullHistoryTab(tab)
      setPullHistoryOpen(true)
    },
    openPruneDialog: () => setPruneConfirmOpen(true),
  }))

  const selectedRegistry = useMemo(
    () =>
      PULL_REGISTRY_OPTIONS.find(option => option.id === selectedRegistryId) ||
      PULL_REGISTRY_OPTIONS[0],
    [selectedRegistryId]
  )

  const resolvedPullImage = useMemo(() => {
    return normalizeReferenceInput(pullImageInput)
  }, [pullImageInput])

  const referenceKeyword = useMemo(() => {
    return normalizeReferenceInput(pullImageInput)
  }, [pullImageInput])

  const openOfficialSearch = () => {
    if (typeof window === 'undefined') return
    window.open(selectedRegistry.officialSearchUrl(referenceKeyword), '_blank', 'noopener,noreferrer')
  }

  const useReference = (reference: string) => {
    setPullImageInput(reference)
    setPullSuggestionsDismissed(true)
  }

  useEffect(() => {
    if (!pullOperationId) return

    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      try {
        const response = (await pb.send(
          dockerApiPath(serverId, `/image-pull-operations/${pullOperationId}`),
          { method: 'GET' }
        )) as DockerImagePullOperation
        if (cancelled) return

        const nextLog = String(response.output || '').trim()
        setPullLog(nextLog || `Pull ${response.phase}...`)

        if (response.terminal_status === 'none') {
          setPulling(true)
          timer = window.setTimeout(() => {
            void poll()
          }, 1500)
          return
        }

        setPulling(false)
        setPullOperationId(null)

        if (response.terminal_status === 'success') {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['docker', 'images', serverId] }),
            queryClient.invalidateQueries({
              queryKey: ['docker', 'containers', 'for-images', serverId],
            }),
            queryClient.invalidateQueries({
              queryKey: ['docker', 'image-pull-operations', serverId],
            }),
          ])
          return
        }

        setActionError(response.failure_reason || 'Failed to pull image')
      } catch (err) {
        if (cancelled) return
        setPulling(false)
        setPullOperationId(null)
        setPullLog(getApiErrorMessage(err, 'Failed to load pull operation'))
      }
    }

    void poll()

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [pullOperationId, queryClient, serverId])

  const checkRegistryReachable = async () => {
    try {
      setCheckingRegistry(true)
      setRegistryStatus(null)
      const response = await pb.send(dockerApiPath(serverId, '/images/registry/status'), {
        method: 'GET',
      })
      setRegistryStatus({
        available: !!response.available,
        registry: typeof response.registry === 'string' ? response.registry : selectedRegistry.label,
        reason: typeof response.reason === 'string' ? response.reason : undefined,
      })
    } catch (err) {
      setRegistryStatus({
        available: false,
        registry: selectedRegistry.label,
        reason: getApiErrorMessage(err, 'Failed to check registry reachability'),
      })
    } finally {
      setCheckingRegistry(false)
    }
  }

  const pullSelectedImage = async () => {
    const name = resolvedPullImage.trim()
    if (!name) return
    try {
      setActionError(null)
      setPulling(true)
      setPullLog(`Submitting pull for ${name}...`)
      const res = await pb.send(dockerApiPath(serverId, '/images/pull'), {
        method: 'POST',
        body: { name },
      })
      const operationId = typeof res.operation_id === 'string' ? res.operation_id : ''
      setPullOperationId(operationId || null)
      setPullLog(String(res.message || `Pull accepted for ${name}.`))
      setPulling(!!operationId)
      await queryClient.invalidateQueries({
        queryKey: ['docker', 'image-pull-operations', serverId],
      })
    } catch (err) {
      setPullOperationId(null)
      setPulling(false)
      setPullLog(getApiErrorMessage(err, 'Failed to pull image'))
    }
  }

  const loadError = error ? getApiErrorMessage(error, 'Failed to load images') : null

  const recentCompletedPulls = useMemo(
    () => recentPullOperations.filter(operation => operation.terminal_status !== 'none').slice(0, 6),
    [recentPullOperations]
  )
  const executingPullOperations = useMemo(
    () => activePullOperations.filter(operation => operation.phase !== 'accepted'),
    [activePullOperations]
  )
  const queuedPullOperations = useMemo(
    () => activePullOperations.filter(operation => operation.phase === 'accepted'),
    [activePullOperations]
  )
  const recentFailedPullCount = useMemo(
    () => recentCompletedPulls.filter(operation => operation.terminal_status === 'failed').length,
    [recentCompletedPulls]
  )

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

  useEffect(() => {
    onPullActivityChange?.({
      activeCount: activePullOperations.length,
      recentFailedCount: recentFailedPullCount,
      hasRecentHistory: recentCompletedPulls.length > 0,
    })
  }, [
    activePullOperations.length,
    onPullActivityChange,
    recentCompletedPulls.length,
    recentFailedPullCount,
  ])

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
  const referenceItems = useMemo(() => {
    const keyword = referenceKeyword.trim().toLowerCase()
    if (!keyword) return []

    const ranked = images
      .filter(image => image.Repository && image.Repository !== '<none>')
      .map(image => {
        const ref = imageRef(image) || image.Repository
        const score = scoreReferenceMatch(ref, keyword)
        return { image, ref, score }
      })
      .filter(item => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score
        return left.ref.localeCompare(right.ref)
      })

    const candidates = ranked.slice(0, 8)

    return candidates.map(({ image, ref }) => {
      const linkedCount = relatedContainersMap[image.ID]?.length || 0
      const parsed = parseImageReferenceParts(ref)
      return {
        id: image.ID,
        ref,
        displayRef: parsed.tag ? `${parsed.name}:${parsed.tag}` : parsed.name || ref,
        organizationLabel: parsed.namespace || 'library',
        usageLabel: usageMap[image.ID]
          ? `Used by ${linkedCount} container${linkedCount > 1 ? 's' : ''}`
          : 'Unused locally',
      }
    })
  }, [images, referenceKeyword, relatedContainersMap, usageMap])
  const allSelectableChecked =
    selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id))
  const someSelectableChecked = selectableIds.some(id => selectedIds.includes(id))
  const hasActiveFilters = filter.trim().length > 0 || usageFilter !== 'all'

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
              className={cn(
                'h-9 rounded-md border bg-background px-3 text-sm',
                usageFilter !== 'all' && 'border-primary/40 bg-primary/5 text-primary'
              )}
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
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border border-dashed bg-muted/10 px-3 py-2 shrink-0">
          {filter.trim() ? <Badge variant="outline">Search: {filter.trim()}</Badge> : null}
          {usageFilter === 'used' ? <Badge variant="outline">Only used images</Badge> : null}
          {usageFilter === 'unused' ? <Badge variant="outline">Only unused images</Badge> : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFilter('')
              setUsageFilter('all')
            }}
          >
            Clear filters
          </Button>
        </div>
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
                <TableHead className="w-[160px] min-w-[160px] text-left text-xs font-medium text-foreground">
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
                const inspect = parseInspect(inspectMap[img.ID] || '')
                const imageNames = formatImageNames(inspect)
                const repositories = formatImageRepositories(inspect)
                const imagePorts = formatImagePorts(inspect)
                const createdAt = formatImageCreated(
                  typeof inspect?.Created === 'string' ? inspect.Created : undefined
                )
                const imageSize = formatImageBytes(inspect?.Size)
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
                            className="group inline-flex min-h-8 min-w-0 items-center text-left"
                            title={img.Repository}
                            onClick={() => toggleImageExpansion(img.ID)}
                          >
                            <span className="truncate text-xs font-semibold leading-tight text-foreground group-hover:underline">
                              {img.Repository}
                            </span>
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 font-mono text-xs" title={img.ID}>
                        {img.ID?.substring(0, 12)}
                      </TableCell>
                      <TableCell className="py-3 text-xs">{img.Tag}</TableCell>
                      <TableCell className="w-[160px] min-w-[160px] py-3 text-left text-xs align-middle">
                        <div className="flex h-8 items-center">
                          {linkedContainers.length > 0 ? (
                            <button
                              type="button"
                              className="inline-flex h-8 w-full items-center justify-start gap-1 text-left text-xs text-primary hover:underline"
                              title={linkedContainers.join(', ')}
                              onClick={() => onOpenContainerFilter?.(imageRef(img) || img.Repository, linkedContainers)}
                            >
                              <span className="truncate">{linkedContainers.length} container{linkedContainers.length > 1 ? 's' : ''}</span>
                              <ExternalLink className="ml-1 h-3 w-3" />
                            </button>
                          ) : (
                            <span className="inline-flex h-8 items-center text-muted-foreground">-</span>
                          )}
                        </div>
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
                              onSelect={() => setTimeout(() => openInspectDialog(img), 0)}
                            >
                              <FileText className="h-4 w-4 mr-2" /> Inspect
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
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
                        <TableCell colSpan={7} className="bg-muted/20 px-3 py-3">
                          {inspectLoadingMap[img.ID] ? (
                            <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" /> Loading inspect...
                            </div>
                          ) : (
                            <div className="space-y-4 rounded-lg bg-background/80 p-3 text-xs">
                              <div className="text-sm font-medium">Image Details</div>

                              <div className="overflow-hidden rounded-md border">
                                <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">Metadata</div>
                                <div className="grid gap-x-6 gap-y-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                                  <div className="space-y-1">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">ID</div>
                                    <div className="font-mono text-foreground" title={inspect?.Id || img.ID || ''}>
                                      {img.ID?.substring(0, 12) || '-'}
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Names</div>
                                    <div className="break-all text-foreground">{metadataValue(imageNames)}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Repository</div>
                                    <div className="break-all text-foreground">{metadataValue(repositories.length > 0 ? repositories : [img.Repository].filter(Boolean))}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Size</div>
                                    <div className="text-foreground">{imageSize !== '-' ? imageSize : img.Size || '-'}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Created</div>
                                    <div className="text-foreground">{createdAt !== '-' ? createdAt : img.CreatedSince || '-'}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Workdir</div>
                                    <div className="break-all text-foreground">{metadataValue(typeof inspect?.Config?.WorkingDir === 'string' ? inspect.Config.WorkingDir : undefined)}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Architecture</div>
                                    <div className="text-foreground">{metadataValue(typeof inspect?.Architecture === 'string' ? inspect.Architecture : undefined)}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">OS</div>
                                    <div className="text-foreground">{metadataValue(typeof inspect?.Os === 'string' ? inspect.Os : undefined)}</div>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Ports</div>
                                    <div className="break-all text-foreground">{metadataValue(imagePorts)}</div>
                                  </div>
                                </div>
                              </div>

                              {inspect && inspectMap[img.ID] && (
                                <div className="flex justify-end">
                                  <Button
                                    type="button"
                                    variant="link"
                                    size="sm"
                                    className="h-auto px-0 text-xs"
                                    onClick={() => openInspectDialog(img)}
                                  >
                                    <FileText className="mr-1 h-3.5 w-3.5" /> View full inspect
                                  </Button>
                                </div>
                              )}
                            </div>
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

      <Dialog
        open={pullDialogOpen}
        onOpenChange={open => {
          setPullDialogOpen(open)
          if (!open) {
            if (!pullOperationId) {
              setPullLog('')
            }
            setRegistryStatus(null)
            setPullSuggestionsDismissed(false)
          }
        }}
      >
        <DialogContent className="max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Pull image</DialogTitle>
            <DialogDescription>
              Pull directly from the selected registry. Search/reference is optional.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Registry</label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={selectedRegistryId}
                  onChange={event => {
                    setSelectedRegistryId(event.target.value)
                    setRegistryStatus(null)
                  }}
                >
                  {PULL_REGISTRY_OPTIONS.map(option => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  className="sm:shrink-0"
                  onClick={() => void checkRegistryReachable()}
                  disabled={checkingRegistry}
                >
                  {checkingRegistry ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Checking...
                    </>
                  ) : (
                    'Check reachable'
                  )}
                </Button>
              </div>
              {registryStatus && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant={registryStatus.available ? 'secondary' : 'destructive'}>
                    {registryStatus.available ? 'Reachable from target server' : 'Not reachable from target server'}
                  </Badge>
                  {registryStatus.reason && (
                    <span className="break-all text-muted-foreground">{registryStatus.reason}</span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium">Image</label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Image input help"
                    >
                      <CircleHelp className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className="max-w-[260px] leading-5">
                    Use name:tag when you know the exact reference, for example wordpress:latest.
                    Leave tag empty only when you want the registry default.
                  </TooltipContent>
                </Tooltip>
              </div>
              <input
                type="text"
                placeholder="wordpress:latest"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={pullImageInput}
                onChange={event => {
                  setPullImageInput(event.target.value)
                  setPullSuggestionsDismissed(false)
                }}
              />
              <div className="flex items-center justify-end">
                <Button variant="link" size="sm" className="h-auto px-0" onClick={openOfficialSearch}>
                  <ExternalLink className="mr-1 h-4 w-4" /> Online search
                </Button>
              </div>
              {referenceKeyword && !pullSuggestionsDismissed && (
                <div className="max-h-[220px] overflow-auto rounded-md border">
                  {referenceItems.length > 0 ? (
                    <div className="divide-y">
                      {referenceItems.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/30"
                          onClick={() => useReference(item.ref)}
                        >
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                              <Badge variant="outline" className="text-[10px] font-normal">LOCAL</Badge>
                              <span className="truncate">{item.displayRef}</span>
                            </div>
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              <span className="truncate">Organization: {item.organizationLabel}</span>
                              <span className="hidden sm:inline">·</span>
                              <span>{item.usageLabel}</span>
                            </div>
                          </div>
                          <span className="text-xs text-primary">Use</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No precise local matches</div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="rounded-md border bg-muted/20 p-3 max-h-[200px] overflow-auto">
                <pre className="break-all text-xs font-mono whitespace-pre-wrap">
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
              disabled={pulling || !resolvedPullImage.trim()}
            >
              {pulling ? 'Pulling...' : 'Pull'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pullHistoryOpen}
        onOpenChange={open => {
          setPullHistoryOpen(open)
          if (!open) {
            setSelectedPullOperation(null)
          }
        }}
      >
        <DialogContent className="max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>{selectedPullOperation ? 'Image pull details' : 'Image pull activity'}</DialogTitle>
            <DialogDescription>
              {selectedPullOperation
                ? selectedPullOperation.image_name || 'Selected image pull operation'
                : 'Review currently running pulls and recent completed history.'}
            </DialogDescription>
          </DialogHeader>
          {selectedPullOperation ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setSelectedPullOperation(null)}>
                  <ChevronLeft className="mr-1 h-4 w-4" /> Back to list
                </Button>
                {canCancelPullOperation(selectedPullOperation) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    disabled={pullOperationActionId === selectedPullOperation.id}
                    onClick={() => void cancelQueuedPullOperation(selectedPullOperation)}
                  >
                    {pullOperationActionId === selectedPullOperation.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Cancel queued pull
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={pullOperationTone(selectedPullOperation)}>
                  {pullOperationLabel(selectedPullOperation)}
                </Badge>
                <span>Started {formatPullOperationTimestamp(selectedPullOperation.created)}</span>
                <span>Updated {formatPullOperationTimestamp(selectedPullOperation.updated)}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {pullOperationStatusHint(selectedPullOperation)}
              </p>
              {selectedPullOperation.failure_reason && (
                <Alert variant={selectedPullOperation.terminal_status === 'failed' ? 'destructive' : 'default'}>
                  <AlertDescription>{selectedPullOperation.failure_reason}</AlertDescription>
                </Alert>
              )}
              <ScrollArea className="h-[320px] rounded-md border bg-muted/30 p-3">
                <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-5">
                  {selectedPullOperation.output || 'No output available.'}
                </pre>
              </ScrollArea>
            </div>
          ) : (
            <Tabs
              value={pullHistoryTab}
              onValueChange={value => setPullHistoryTab(value as 'pulling' | 'recents')}
              className="min-h-0 flex flex-1 flex-col"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="pulling">Pulling</TabsTrigger>
                <TabsTrigger value="recents">Recents</TabsTrigger>
              </TabsList>

              <TabsContent value="pulling" className="mt-4 min-h-0 flex-1">
                <ScrollArea className="h-[360px] pr-3">
                  <div className="space-y-4 pr-2">
                    {activePullOperations.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No active pull operations.</p>
                    ) : (
                      <>
                        {executingPullOperations.length > 0 ? (
                          <div className="space-y-2">
                            <div>
                              <p className="text-sm font-medium">Running now</p>
                              <p className="text-xs text-muted-foreground">These pulls are actively downloading on the target server.</p>
                            </div>
                            {executingPullOperations.map(operation => (
                              <div
                                key={operation.id}
                                className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2"
                              >
                                <button
                                  type="button"
                                  onClick={() => void openPullOperationViewer(operation)}
                                  className="min-w-0 flex-1 text-left hover:text-primary"
                                >
                                  <div className="truncate text-sm font-medium">{operation.image_name}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {pullOperationStatusHint(operation)} Updated {formatPullOperationTimestamp(operation.updated)}
                                  </div>
                                </button>
                                <div className="flex shrink-0 items-center gap-2 self-center">
                                  <Badge variant={pullOperationTone(operation)}>{pullOperationLabel(operation)}</Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {queuedPullOperations.length > 0 ? (
                          <div className="space-y-2">
                            <div>
                              <p className="text-sm font-medium">Queued</p>
                              <p className="text-xs text-muted-foreground">These pulls are waiting for an available pull slot on this server.</p>
                            </div>
                            {queuedPullOperations.map(operation => (
                              <div
                                key={operation.id}
                                className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2"
                              >
                                <button
                                  type="button"
                                  onClick={() => void openPullOperationViewer(operation)}
                                  className="min-w-0 flex-1 text-left hover:text-primary"
                                >
                                  <div className="truncate text-sm font-medium">{operation.image_name}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {pullOperationStatusHint(operation)} Updated {formatPullOperationTimestamp(operation.updated)}
                                  </div>
                                </button>
                                <div className="flex shrink-0 items-center gap-2 self-center">
                                  <Badge variant={pullOperationTone(operation)}>{pullOperationLabel(operation)}</Badge>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2 text-xs"
                                    disabled={pullOperationActionId === operation.id}
                                    onClick={() => void cancelQueuedPullOperation(operation)}
                                  >
                                    {pullOperationActionId === operation.id ? (
                                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                    ) : null}
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="recents" className="mt-4 min-h-0 flex-1">
                <div className="mb-3 flex items-center justify-end">
                  {recentCompletedPulls.length > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setClearPullHistoryOpen(true)}
                    >
                      Clear all
                    </Button>
                  ) : null}
                </div>
                <ScrollArea className="h-[320px] pr-3">
                  <div className="space-y-2 pr-2">
                    {recentCompletedPulls.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No recent pull history.</p>
                    ) : (
                      recentCompletedPulls.map(operation => (
                        <div
                          key={operation.id}
                          className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => void openPullOperationViewer(operation)}
                            className="min-w-0 flex-1 text-left hover:text-primary"
                          >
                            <div className="truncate text-sm font-medium">{operation.image_name}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {operation.failure_reason || `Updated ${formatPullOperationTimestamp(operation.updated)}`}
                            </div>
                          </button>
                          <div className="flex shrink-0 items-center gap-2 self-center">
                            <Badge variant={pullOperationTone(operation)}>{pullOperationLabel(operation)}</Badge>
                            {operation.terminal_status === 'failed' ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 px-2 text-xs"
                                onClick={() => {
                                  setPullHistoryOpen(false)
                                  openPullDialog(operation.image_name)
                                }}
                              >
                                Retry pull
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 px-0 text-muted-foreground"
                              disabled={pullOperationActionId === operation.id}
                              onClick={() => void deletePullOperationRecord(operation)}
                              aria-label={`Delete pull record for ${operation.image_name}`}
                              title="Delete pull record"
                            >
                              {pullOperationActionId === operation.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={clearPullHistoryOpen} onOpenChange={setClearPullHistoryOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear recent pull history?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes pull records for this server only. It does not remove any images.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingPullHistory}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={event => {
                event.preventDefault()
                void clearPullOperationHistory()
              }}
            >
              {clearingPullHistory ? 'Clearing...' : 'Clear all'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DockerTextDialog
        open={!!inspectDialogImage}
        onOpenChange={open => !open && setInspectDialogImage(null)}
        title={`Image Inspect: ${inspectDialogImage ? imageRef(inspectDialogImage) || inspectDialogImage.Repository || inspectDialogImage.ID.slice(0, 12) : ''}`}
        description="Structured docker inspect output for this image."
        content={inspectDialogImage ? inspectMap[inspectDialogImage.ID] || '' : ''}
        loading={!!(inspectDialogImage && inspectLoadingMap[inspectDialogImage.ID])}
        loadingText="Loading inspect..."
        emptyText="(no output)"
        onRefresh={inspectDialogImage ? () => {
          setInspectMap(state => {
            const next = { ...state }
            delete next[inspectDialogImage.ID]
            return next
          })
          return void loadImageInspect(inspectDialogImage.ID)
        } : undefined}
        refreshDisabled={!inspectDialogImage}
        downloadBaseName={`${inspectDialogImage ? (imageRef(inspectDialogImage) || inspectDialogImage.Repository || 'image').replace(/[^a-zA-Z0-9._-]+/g, '-') : 'image'}-inspect`}
        downloadExtension="json"
        copySuccessText="Inspect copied"
        copyFailureText="Failed to copy inspect"
        downloadFailureText="Failed to download inspect"
      />
    </div>
  )
})
