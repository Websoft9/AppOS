import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Clipboard,
  Eye,
  FileText,
  Loader2,
  MoreVertical,
  PenLine,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  RotateCw,
  ScrollText,
  Star,
  Square,
  SquarePen,
  X,
} from 'lucide-react'

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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  applySystemdUnit,
  controlSystemdService,
  getSystemdLogs,
  getSystemdStatus,
  getSystemdUnit,
  listSystemdServices,
  type SystemdControlAction,
  type SystemdLogsResponse,
  type SystemdService,
  type SystemdUnitResponse,
  updateSystemdUnit,
  verifySystemdUnit,
} from '@/lib/connect-api'
import { getApiErrorMessage, isRequestCancellation } from '@/lib/api-error'
import { listSupportedServerSoftware, type SupportedServerSoftwareEntry } from '@/lib/software-api'
import { cn } from '@/lib/utils'

type SystemdDetailTab = 'overview' | 'logs' | 'unit'
type StatusFilter = 'all' | 'running' | 'exited' | 'failed' | 'inactive'
type SystemdServiceWithBoot = SystemdService & { unit_file_state?: string }
type SortKey = 'name' | 'status' | 'summary'
type SortDirection = 'asc' | 'desc'

type DetailRow = {
  label: string
  value: string
}

const DEFAULT_FOCUS_SERVICES = [
  'docker.service',
  'appos-monitor.service',
  'appos-tunnel.service',
] as const

const PAGE_SIZE = 12
const DETAIL_STATUS_KEYS = new Set([
  'Id',
  'Description',
  'LoadState',
  'ActiveState',
  'SubState',
  'UnitFileState',
  'MainPID',
  'StateChangeTimestamp',
  'FragmentPath',
  'Status',
])

function normalizeQuery(value: string) {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  return trimmed.endsWith('.service') ? trimmed.slice(0, -8) : trimmed
}

function normalizeServiceName(value: string) {
  const lower = normalizeServiceUnitName(value).toLowerCase()
  return lower.endsWith('.service') ? lower.slice(0, -8) : lower
}

function normalizeServiceUnitName(value: string) {
  const trimmed = value.trim().replace(/^[●○*•\s]+/, '')
  return trimmed.toLowerCase().endsWith('.service') ? trimmed : ''
}

function getDisplayName(serviceName: string) {
  return normalizeServiceUnitName(serviceName).replace(/\.service$/i, '')
}

function buildFocusServices(catalog: SupportedServerSoftwareEntry[]): string[] {
  const seen = new Set<string>()
  const focusServices: string[] = []
  for (const serviceName of DEFAULT_FOCUS_SERVICES) {
    const normalized = normalizeServiceUnitName(serviceName)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    focusServices.push(normalized)
  }
  for (const item of catalog) {
    if (!item.favorite_systemd_service || !item.service_name) continue
    const normalized = normalizeServiceUnitName(item.service_name)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    focusServices.push(normalized)
  }
  return focusServices
}

function isFocusService(serviceName: string, focusServices: string[]) {
  return focusServices.includes(normalizeServiceUnitName(serviceName))
}

function shouldHideService(service: SystemdService) {
  const unitName = normalizeServiceUnitName(service.name)
  if (!unitName) return true
  return service.load_state === 'not-found' && !getDisplayName(unitName)
}

function getStatusLabel(service: Pick<SystemdService, 'active_state' | 'sub_state'>) {
  const subState = String(service.sub_state || '')
    .trim()
    .toLowerCase()
  const activeState = String(service.active_state || '')
    .trim()
    .toLowerCase()

  if (subState === 'exited') return 'exited'
  if (subState === 'dead') return 'dead'
  if (activeState === 'failed' || subState === 'failed') return 'failed'
  if (activeState === 'active') {
    return subState || 'running'
  }
  if (activeState === 'inactive') {
    return subState || 'inactive'
  }
  return activeState || subState || 'unknown'
}

function getStatusText(t: (key: string) => string, status: string) {
  switch (status) {
    case 'running':
      return t('servers.servicesTab.status.running')
    case 'exited':
      return t('servers.servicesTab.status.exited')
    case 'dead':
      return t('servers.servicesTab.status.dead')
    case 'failed':
      return t('servers.servicesTab.status.failed')
    case 'inactive':
      return t('servers.servicesTab.status.inactive')
    case 'unknown':
      return t('servers.servicesTab.status.unknown')
    default:
      return status
  }
}

function getSummary(service: SystemdService) {
  return String(
    service.description || `${service.load_state || 'unknown'} / ${service.sub_state || 'unknown'}`
  )
}

function matchesQuery(service: SystemdService, query: string) {
  if (!query) return true
  return (
    normalizeServiceName(service.name).includes(query) ||
    String(service.description || '')
      .toLowerCase()
      .includes(query)
  )
}

function matchesStatus(service: SystemdService, filter: StatusFilter) {
  if (filter === 'all') return true
  const status = getStatusLabel(service)
  if (filter === 'running') return status === 'running'
  if (filter === 'exited') return status === 'exited'
  if (filter === 'failed') return status === 'failed'
  return status === 'inactive' || status === 'dead'
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'base' })
}

function compareServices(
  left: SystemdServiceWithBoot,
  right: SystemdServiceWithBoot,
  focusServices: string[],
  sortKey: SortKey,
  sortDirection: SortDirection
) {
  const leftFocusIndex = focusServices.indexOf(normalizeServiceUnitName(left.name))
  const rightFocusIndex = focusServices.indexOf(normalizeServiceUnitName(right.name))
  const leftPinned = leftFocusIndex >= 0
  const rightPinned = rightFocusIndex >= 0

  if (leftPinned && rightPinned) {
    return leftFocusIndex - rightFocusIndex
  }
  if (leftPinned) return -1
  if (rightPinned) return 1

  let result = 0
  if (sortKey === 'status') {
    result = compareText(getStatusLabel(left), getStatusLabel(right))
  } else if (sortKey === 'summary') {
    result = compareText(getSummary(left), getSummary(right))
  } else {
    result = compareText(getDisplayName(left.name), getDisplayName(right.name))
  }

  if (result === 0) {
    result = compareText(getDisplayName(left.name), getDisplayName(right.name))
  }

  return sortDirection === 'desc' ? result * -1 : result
}

function buildDetailRows(
  selectedService: SystemdServiceWithBoot,
  statusDetails: Record<string, string>,
  unitPath: string,
  t: (key: string) => string
): DetailRow[] {
  const rows: DetailRow[] = [
    {
      label: t('servers.servicesTab.detailRows.name'),
      value: getDisplayName(selectedService.name) || '—',
    },
    {
      label: t('servers.servicesTab.detailRows.description'),
      value: statusDetails.Description || selectedService.description || '—',
    },
    {
      label: t('servers.servicesTab.detailRows.status'),
      value: getStatusText(
        t,
        getStatusLabel({
          active_state: statusDetails.ActiveState || selectedService.active_state,
          sub_state: statusDetails.SubState || selectedService.sub_state,
        }) || 'unknown'
      ),
    },
    { label: t('servers.servicesTab.detailRows.path'), value: unitPath || '—' },
    { label: t('servers.servicesTab.detailRows.pid'), value: statusDetails.MainPID || '—' },
    {
      label: t('servers.servicesTab.detailRows.loadState'),
      value: statusDetails.LoadState || selectedService.load_state || '—',
    },
    {
      label: t('servers.servicesTab.detailRows.activeState'),
      value: statusDetails.ActiveState || selectedService.active_state || '—',
    },
    {
      label: t('servers.servicesTab.detailRows.subState'),
      value: statusDetails.SubState || selectedService.sub_state || '—',
    },
    {
      label: t('servers.servicesTab.detailRows.unitFileState'),
      value: statusDetails.UnitFileState || '—',
    },
    {
      label: t('servers.servicesTab.detailRows.stateChange'),
      value: statusDetails.StateChangeTimestamp || '—',
    },
  ]

  for (const [key, value] of Object.entries(statusDetails)) {
    if (DETAIL_STATUS_KEYS.has(key)) continue
    rows.push({ label: key, value: value || '—' })
  }

  return rows
}

function isRowKeyboardActivation(event: { key: string }) {
  return event.key === 'Enter' || event.key === ' '
}

export function ServerServicesPanel({ serverId }: { serverId: string }) {
  const { t } = useTranslation('resources')
  const requestSeqRef = useRef(0)
  const [supportedCatalog, setSupportedCatalog] = useState<SupportedServerSoftwareEntry[]>([])
  const [services, setServices] = useState<SystemdServiceWithBoot[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState('')
  const [detailTab, setDetailTab] = useState<SystemdDetailTab>('overview')
  const [statusDetails, setStatusDetails] = useState<Record<string, string>>({})
  const [logs, setLogs] = useState<string[]>([])
  const [unitPath, setUnitPath] = useState('')
  const [unitContent, setUnitContent] = useState('')
  const [unitResult, setUnitResult] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [error, setError] = useState('')
  const [hint, setHint] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmService, setConfirmService] = useState('')
  const [confirmAction, setConfirmAction] = useState<
    SystemdControlAction | 'verify-unit' | 'apply-unit' | null
  >(null)

  const loadInventory = useCallback(async () => {
    const requestSeq = requestSeqRef.current + 1
    requestSeqRef.current = requestSeq
    setInventoryLoading(true)
    setError('')
    try {
      const response = await listSystemdServices(serverId, '')
      if (requestSeqRef.current !== requestSeq) return
      setServices(response)
    } catch (loadError) {
      if (requestSeqRef.current !== requestSeq || isRequestCancellation(loadError)) return
      setError(getApiErrorMessage(loadError, t('servers.servicesTab.errors.loadServices')))
    } finally {
      if (requestSeqRef.current === requestSeq) {
        setInventoryLoading(false)
      }
    }
  }, [serverId, t])

  useEffect(() => {
    void loadInventory()
  }, [loadInventory])

  useEffect(() => {
    let cancelled = false
    void listSupportedServerSoftware()
      .then(items => {
        if (!cancelled) {
          setSupportedCatalog(items)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSupportedCatalog([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setPage(1)
  }, [query, statusFilter])

  const visibleServices = useMemo(
    () => services.filter(service => !shouldHideService(service)),
    [services]
  )

  const focusServices = useMemo(() => buildFocusServices(supportedCatalog), [supportedCatalog])

  const searchMatchedServices = useMemo(() => {
    const normalizedQuery = normalizeQuery(query)
    return visibleServices.filter(service => matchesQuery(service, normalizedQuery))
  }, [query, visibleServices])

  const filteredServices = useMemo(() => {
    return [...searchMatchedServices]
      .filter(service => matchesStatus(service, statusFilter))
      .sort((left, right) => compareServices(left, right, focusServices, sortKey, sortDirection))
  }, [focusServices, searchMatchedServices, sortDirection, sortKey, statusFilter])

  const statusOptionCounts = useMemo(() => {
    let running = 0
    let exited = 0
    let failed = 0
    let inactive = 0

    for (const service of searchMatchedServices) {
      const status = getStatusLabel(service)
      if (status === 'running') {
        running += 1
      } else if (status === 'exited') {
        exited += 1
      } else if (status === 'failed') {
        failed += 1
      } else if (status === 'inactive' || status === 'dead') {
        inactive += 1
      }
    }

    return {
      all: searchMatchedServices.length,
      running,
      exited,
      failed,
      inactive,
    }
  }, [searchMatchedServices])

  const totalPages = Math.max(1, Math.ceil(filteredServices.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)

  const pagedServices = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredServices.slice(start, start + PAGE_SIZE)
  }, [currentPage, filteredServices])

  const selectedService = useMemo(
    () => visibleServices.find(service => service.name === selected) ?? null,
    [selected, visibleServices]
  )

  const loadServiceContext = useCallback(
    async (serviceName: string, nextTab: SystemdDetailTab = 'overview', editUnit = false) => {
      const requestSeq = requestSeqRef.current + 1
      requestSeqRef.current = requestSeq
      setSelected(serviceName)
      setDetailTab(nextTab)
      setEditMode(nextTab === 'unit' && editUnit)
      setActionLoading(true)
      setError('')
      setHint('')
      if (nextTab !== 'logs') {
        setLogs([])
      }
      if (nextTab !== 'unit') {
        setUnitResult('')
      }
      try {
        const statusResponse = await getSystemdStatus(serverId, serviceName)
        if (requestSeqRef.current !== requestSeq) return
        const nextStatusDetails = statusResponse.status || {}

        let unitResponse: SystemdUnitResponse | null = null
        let logsResponse: SystemdLogsResponse | null = null

        if (nextTab === 'unit' || (nextTab === 'overview' && !nextStatusDetails.FragmentPath)) {
          unitResponse = await getSystemdUnit(serverId, serviceName).catch(() => null)
          if (requestSeqRef.current !== requestSeq) return
        }

        if (nextTab === 'logs') {
          logsResponse = await getSystemdLogs(serverId, serviceName, 200)
          if (requestSeqRef.current !== requestSeq) return
        }

        if (requestSeqRef.current !== requestSeq) return
        setStatusDetails(nextStatusDetails)
        setUnitPath(unitResponse?.path || nextStatusDetails.FragmentPath || '')
        setUnitContent(unitResponse?.content || '')
        setLogs(Array.isArray(logsResponse?.entries) ? logsResponse.entries : [])
        setDetailTab(nextTab)
        setEditMode(nextTab === 'unit' && editUnit)
      } catch (loadError) {
        if (requestSeqRef.current !== requestSeq || isRequestCancellation(loadError)) return
        setError(getApiErrorMessage(loadError, t('servers.servicesTab.errors.operationFailed')))
      } finally {
        if (requestSeqRef.current === requestSeq) {
          setActionLoading(false)
        }
      }
    },
    [serverId, t]
  )

  useEffect(() => {
    if (selected && !visibleServices.some(service => service.name === selected)) {
      setSelected('')
      setStatusDetails({})
      setLogs([])
      setUnitPath('')
      setUnitContent('')
      setUnitResult('')
      setEditMode(false)
    }
  }, [selected, visibleServices])

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const changeSort = useCallback((nextSortKey: SortKey) => {
    setSortKey(currentKey => {
      if (currentKey === nextSortKey) {
        setSortDirection(currentDirection => (currentDirection === 'asc' ? 'desc' : 'asc'))
        return currentKey
      }
      setSortDirection('asc')
      return nextSortKey
    })
  }, [])

  const refreshPanel = useCallback(async () => {
    await loadInventory()
    if (selected) {
      await loadServiceContext(selected, detailTab, editMode)
    }
  }, [detailTab, editMode, loadInventory, loadServiceContext, selected])

  const copyLogs = useCallback(async () => {
    const text = logs.join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setHint(t('servers.servicesTab.hints.logsCopied'))
    } catch {
      setError(t('servers.servicesTab.errors.copyLogs'))
    }
  }, [logs, t])

  const runControlActionForService = useCallback(
    async (serviceName: string, action: SystemdControlAction) => {
      setSelected(serviceName)
      setActionLoading(true)
      setError('')
      setHint('')
      try {
        await controlSystemdService(serverId, serviceName, action)
        setHint(t('servers.servicesTab.hints.actionApplied', { action }))
        const inventoryResponse = await listSystemdServices(serverId, '')
        setServices(inventoryResponse)
        await loadServiceContext(serviceName, 'overview')
      } catch (actionError) {
        setError(
          actionError instanceof Error
            ? actionError.message
            : t('servers.servicesTab.errors.operationFailed')
        )
        setActionLoading(false)
      }
    },
    [loadServiceContext, serverId, t]
  )

  const validateUnit = useCallback(async () => {
    if (!selected) return
    setActionLoading(true)
    setError('')
    setHint('')
    try {
      const saveResponse = await updateSystemdUnit(serverId, selected, unitContent)
      const verifyResponse = await verifySystemdUnit(serverId, selected)
      setUnitResult(
        [saveResponse.output, verifyResponse.verify_output].filter(Boolean).join('\n\n') ||
          t('servers.servicesTab.unit.validatePassed')
      )
      setDetailTab('unit')
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('servers.servicesTab.errors.validateUnit')
      )
    } finally {
      setActionLoading(false)
    }
  }, [selected, serverId, t, unitContent])

  const applyUnit = useCallback(async () => {
    if (!selected) return
    setActionLoading(true)
    setError('')
    setHint('')
    try {
      const saveResponse = await updateSystemdUnit(serverId, selected, unitContent)
      const applyResponse = await applySystemdUnit(serverId, selected)
      const inventoryResponse = await listSystemdServices(serverId, '')
      setServices(inventoryResponse)
      setUnitResult(
        [saveResponse.output, applyResponse.reload_output, applyResponse.apply_output]
          .filter(Boolean)
          .join('\n\n') || t('servers.servicesTab.unit.applyCompleted')
      )
      setEditMode(false)
      await loadServiceContext(selected, 'overview')
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : t('servers.servicesTab.errors.applyUnit')
      )
      setActionLoading(false)
    }
  }, [loadServiceContext, selected, serverId, t, unitContent])

  const requestConfirm = useCallback(
    (serviceName: string, action: SystemdControlAction | 'verify-unit' | 'apply-unit') => {
      setConfirmService(serviceName)
      setConfirmAction(action)
      setConfirmOpen(true)
    },
    []
  )

  const executeConfirm = useCallback(async () => {
    const action = confirmAction
    const serviceName = confirmService
    setConfirmOpen(false)
    if (!action || !serviceName) return
    if (action === 'verify-unit') {
      await validateUnit()
      return
    }
    if (action === 'apply-unit') {
      await applyUnit()
      return
    }
    await runControlActionForService(serviceName, action)
  }, [applyUnit, confirmAction, confirmService, runControlActionForService, validateUnit])

  const detailRows = useMemo(() => {
    if (!selectedService) return []
    return buildDetailRows(selectedService, statusDetails, unitPath, t)
  }, [selectedService, statusDetails, t, unitPath])

  const renderSortIcon = useCallback(
    (column: SortKey) => {
      if (sortKey !== column) {
        return <ArrowUpDown className="h-3.5 w-3.5" />
      }
      return sortDirection === 'asc' ? (
        <ArrowUp className="h-3.5 w-3.5" />
      ) : (
        <ArrowDown className="h-3.5 w-3.5" />
      )
    },
    [sortDirection, sortKey]
  )

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{t('servers.servicesTab.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('servers.servicesTab.description')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => void refreshPanel()}
              disabled={inventoryLoading || actionLoading}
              aria-label={t('servers.servicesTab.actions.refresh')}
              title={t('servers.servicesTab.actions.refresh')}
            >
              {inventoryLoading || actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section
          className="space-y-4 rounded-md border p-4"
          aria-label={t('servers.servicesTab.inventory.ariaLabel')}
        >
          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-center gap-3 whitespace-nowrap">
              <span className="text-sm text-muted-foreground">
                {t('servers.servicesTab.inventory.summary', {
                  count: visibleServices.length,
                  failed: visibleServices.filter(service => getStatusLabel(service) === 'failed')
                    .length,
                })}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={t('servers.servicesTab.search.placeholder')}
                  className="h-8 w-[clamp(6ch,15vw,15ch)] min-w-0 rounded-md border bg-background px-2 text-sm"
                />
                <select
                  aria-label={t('servers.servicesTab.filters.status')}
                  value={statusFilter}
                  onChange={event => setStatusFilter(event.target.value as StatusFilter)}
                  className="h-8 w-36 shrink-0 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="all">
                    {t('servers.servicesTab.filterOptions.all', { count: statusOptionCounts.all })}
                  </option>
                  <option value="running">
                    {t('servers.servicesTab.filterOptions.running', {
                      count: statusOptionCounts.running,
                    })}
                  </option>
                  <option value="exited">
                    {t('servers.servicesTab.filterOptions.exited', {
                      count: statusOptionCounts.exited,
                    })}
                  </option>
                  <option value="failed">
                    {t('servers.servicesTab.filterOptions.failed', {
                      count: statusOptionCounts.failed,
                    })}
                  </option>
                  <option value="inactive">
                    {t('servers.servicesTab.filterOptions.inactive', {
                      count: statusOptionCounts.inactive,
                    })}
                  </option>
                </select>
                <div className="flex items-center gap-0.5 text-sm text-muted-foreground">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={currentPage <= 1}
                    aria-label={t('servers.servicesTab.pagination.previous')}
                    onClick={() => setPage(prev => Math.max(1, prev - 1))}
                  >
                    {'<'}
                  </Button>
                  <span className="px-1 text-center font-medium text-foreground">
                    {currentPage}/{totalPages}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    disabled={currentPage >= totalPages}
                    aria-label={t('servers.servicesTab.pagination.next')}
                    onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                  >
                    {'>'}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="grid grid-cols-[minmax(0,0.9fr)_5.5rem_minmax(0,1.7fr)_3rem] gap-2 px-3 py-2 text-sm font-medium text-muted-foreground">
              <button
                type="button"
                onClick={() => changeSort('name')}
                className="inline-flex items-center gap-1 py-1 text-left transition-colors hover:text-foreground"
                aria-label={
                  sortKey === 'name'
                    ? t('servers.servicesTab.columns.nameSorted', {
                        direction:
                          sortDirection === 'asc'
                            ? t('servers.servicesTab.sort.asc')
                            : t('servers.servicesTab.sort.desc'),
                      })
                    : t('servers.servicesTab.columns.nameSortable')
                }
              >
                <span>{t('servers.servicesTab.columns.name')}</span>
                {renderSortIcon('name')}
              </button>
              <span className="py-1 text-left">{t('servers.servicesTab.columns.status')}</span>
              <button
                type="button"
                onClick={() => changeSort('summary')}
                className="inline-flex items-center gap-1 py-1 text-left transition-colors hover:text-foreground"
                aria-label={
                  sortKey === 'summary'
                    ? t('servers.servicesTab.columns.summarySorted', {
                        direction:
                          sortDirection === 'asc'
                            ? t('servers.servicesTab.sort.asc')
                            : t('servers.servicesTab.sort.desc'),
                      })
                    : t('servers.servicesTab.columns.summarySortable')
                }
              >
                <span>{t('servers.servicesTab.columns.summary')}</span>
                {renderSortIcon('summary')}
              </button>
              <span className="py-1 text-left">{t('servers.servicesTab.columns.actions')}</span>
            </div>

            {error ? <div className="px-3 py-2 text-sm text-destructive">{error}</div> : null}

            {inventoryLoading ? (
              <div className="inline-flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('servers.servicesTab.loading')}
              </div>
            ) : pagedServices.length === 0 ? (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                {t('servers.servicesTab.empty.noMatches')}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {pagedServices.map(service => {
                  const serviceDisplayName = getDisplayName(service.name)
                  const focusService = isFocusService(service.name, focusServices)
                  return (
                    <div
                      key={service.name}
                      role="button"
                      tabIndex={0}
                      onClick={() => void loadServiceContext(service.name, 'overview')}
                      onKeyDown={event => {
                        if (!isRowKeyboardActivation(event)) return
                        event.preventDefault()
                        void loadServiceContext(service.name, 'overview')
                      }}
                      aria-label={serviceDisplayName}
                      className={cn(
                        'grid grid-cols-[minmax(0,0.9fr)_5.5rem_minmax(0,1.7fr)_3rem] items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent/30 focus-visible:bg-accent/30 focus-visible:outline-none',
                        selected === service.name && 'bg-accent/40'
                      )}
                    >
                      <div className="min-w-0 text-left">
                        <span className="flex min-w-0 items-center gap-1.5">
                          {focusService ? (
                            <Star
                              className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400"
                              aria-label={t('servers.servicesTab.inventory.focusService')}
                            />
                          ) : null}
                          <span className="block truncate font-medium leading-5">
                            {serviceDisplayName}
                          </span>
                        </span>
                      </div>
                      <span className="truncate py-1 text-left">
                        {getStatusText(t, getStatusLabel(service))}
                      </span>
                      <span className="truncate py-1 text-left text-muted-foreground">
                        {getSummary(service)}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 justify-self-start"
                            disabled={actionLoading}
                            aria-label={t('servers.servicesTab.actions.serviceActionsFor', {
                              name: serviceDisplayName,
                            })}
                            onClick={event => event.stopPropagation()}
                            onPointerDown={event => event.stopPropagation()}
                            onKeyDown={event => event.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onClick={event => event.stopPropagation()}
                          onPointerDown={event => event.stopPropagation()}
                          onKeyDown={event => event.stopPropagation()}
                        >
                          <DropdownMenuItem
                            onClick={() => void loadServiceContext(service.name, 'overview')}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            {t('servers.servicesTab.actions.openOverview')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void loadServiceContext(service.name, 'logs')}
                          >
                            <ScrollText className="mr-2 h-4 w-4" />
                            {t('servers.servicesTab.actions.openLogs')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void loadServiceContext(service.name, 'unit')}
                          >
                            <FileText className="mr-2 h-4 w-4" />
                            {t('servers.servicesTab.actions.openUnit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void loadServiceContext(service.name, 'unit', true)}
                          >
                            <PenLine className="mr-2 h-4 w-4" />
                            {t('servers.servicesTab.actions.editUnit')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => requestConfirm(service.name, 'start')}>
                            <Play className="mr-2 h-4 w-4" />
                            {t('servers.servicesTab.actions.start')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => requestConfirm(service.name, 'restart')}>
                            <RotateCw className="mr-2 h-4 w-4" />
                            {t('servers.servicesTab.actions.restart')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => requestConfirm(service.name, 'stop')}>
                            <Square className="mr-2 h-4 w-4" />
                            {t('servers.servicesTab.actions.stop')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => requestConfirm(service.name, 'enable')}>
                            <Power className="mr-2 h-4 w-4" />
                            {t('servers.servicesTab.actions.enable')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => requestConfirm(service.name, 'disable')}>
                            <PowerOff className="mr-2 h-4 w-4" />
                            {t('servers.servicesTab.actions.disable')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <section
          className="max-h-[calc(100vh-50px)] self-start overflow-auto space-y-4 rounded-md border p-4"
          aria-labelledby="selected-service-heading"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 id="selected-service-heading" className="text-sm font-semibold">
                {t('servers.servicesTab.selected.title')}
              </h3>
              <p className="text-xs text-muted-foreground">
                {selectedService
                  ? getDisplayName(selectedService.name)
                  : t('servers.servicesTab.selected.selectPrompt')}
              </p>
            </div>
            {selectedService ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={detailTab === 'overview' && !editMode ? 'default' : 'outline'}
                  onClick={() => void loadServiceContext(selectedService.name, 'overview')}
                  disabled={actionLoading}
                >
                  {t('servers.servicesTab.tabs.overview')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={detailTab === 'logs' ? 'default' : 'outline'}
                  onClick={() => void loadServiceContext(selectedService.name, 'logs')}
                  disabled={actionLoading}
                >
                  {t('servers.servicesTab.tabs.logs')}
                </Button>
              </div>
            ) : null}
          </div>

          {actionLoading ? (
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('servers.servicesTab.loadingDetails')}
            </div>
          ) : !selectedService ? (
            <div className="text-sm text-muted-foreground">
              {t('servers.servicesTab.selected.empty')}
            </div>
          ) : (
            <>
              {detailTab === 'overview' ? (
                <div className="space-y-2 text-sm">
                  {detailRows.map(row => (
                    <div key={row.label} className="flex flex-col gap-1 sm:flex-row sm:gap-2">
                      <span className="shrink-0 font-medium text-foreground">{row.label}:</span>
                      <span className="break-words text-muted-foreground">{row.value}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {detailTab === 'logs' ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {t('servers.servicesTab.logs.title')}
                    </span>
                    <div className="flex items-center gap-2">
                      <span>{t('servers.servicesTab.logs.entries', { count: logs.length })}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2"
                        onClick={() => void copyLogs()}
                        disabled={logs.length === 0}
                      >
                        <Clipboard className="mr-1 h-3.5 w-3.5" />
                        {t('servers.servicesTab.actions.copy')}
                      </Button>
                    </div>
                  </div>
                  <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/20 px-3 py-2 font-mono text-[11px] leading-5">
                    {logs.length ? logs.join('\n') : t('servers.servicesTab.logs.empty')}
                  </pre>
                </div>
              ) : null}

              {detailTab === 'unit' ? (
                <div className="space-y-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1.5">
                      <div className="text-sm font-medium text-foreground">
                        {t('servers.servicesTab.unit.title')}
                      </div>
                      <div className="mt-1 break-all text-xs text-muted-foreground">
                        {unitPath || '-'}
                      </div>
                    </div>
                    {!editMode ? (
                      <button
                        type="button"
                        onClick={() => setEditMode(true)}
                        className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
                      >
                        <SquarePen className="h-3.5 w-3.5" />
                        {t('servers.servicesTab.actions.editUnit')}
                      </button>
                    ) : null}
                  </div>
                  {!editMode ? (
                    <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/10 px-3 py-2 font-mono text-[11px] leading-5">
                      {unitContent || t('servers.servicesTab.unit.empty')}
                    </pre>
                  ) : (
                    <div className="space-y-3">
                      <textarea
                        value={unitContent}
                        onChange={event => setUnitContent(event.target.value)}
                        className="min-h-[28rem] w-full overflow-auto rounded-md border bg-background p-3 font-mono text-[11px] leading-5"
                        placeholder={t('servers.servicesTab.unit.placeholder')}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => requestConfirm(selectedService.name, 'verify-unit')}
                        >
                          <Check className="mr-2 h-4 w-4" />
                          {t('servers.servicesTab.actions.validate')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => requestConfirm(selectedService.name, 'apply-unit')}
                        >
                          <Check className="mr-2 h-4 w-4" />
                          {t('servers.servicesTab.actions.apply')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditMode(false)}
                        >
                          <X className="mr-2 h-4 w-4" />
                          {t('servers.servicesTab.actions.cancelEdit')}
                        </Button>
                      </div>
                    </div>
                  )}
                  {unitResult ? (
                    <pre className="rounded-md border bg-background px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap break-words">
                      {unitResult}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </>
          )}

          {hint ? <div className="text-xs text-emerald-600">{hint}</div> : null}
        </section>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'verify-unit'
                ? t('servers.servicesTab.confirm.validateTitle')
                : confirmAction === 'apply-unit'
                  ? t('servers.servicesTab.confirm.applyTitle')
                  : t('servers.servicesTab.confirm.actionTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'verify-unit'
                ? t('servers.servicesTab.confirm.validateDescription', {
                    service: confirmService || '-',
                  })
                : confirmAction === 'apply-unit'
                  ? t('servers.servicesTab.confirm.applyDescription', {
                      service: confirmService || '-',
                    })
                  : t('servers.servicesTab.confirm.actionDescription', {
                      service: confirmService || '-',
                      action: confirmAction || '-',
                    })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('servers.servicesTab.confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void executeConfirm()
              }}
            >
              {t('servers.servicesTab.confirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
