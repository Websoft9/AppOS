import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ClientResponseError } from 'pocketbase'
import {
  Maximize,
  Minimize,
  Server,
  Cog,
  PenLine,
  Play,
  Square,
  RotateCw,
  Power,
  PowerOff,
  ChevronDown,
  FolderOpen,
  ScrollText,
  Plus,
  Container,
  PanelsLeftRight,
  Search,
  Network,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Checkbox } from '@/components/ui/checkbox'
import { TerminalPanel, type TerminalPanelHandle } from '@/components/connect/TerminalPanel'
import { FileManagerPanel } from '@/components/connect/FileManagerPanel'
import { DockerPanel } from '@/components/connect/DockerPanel'
import {
  listServers,
  listScripts,
  checkServerStatus,
  listSystemdServices,
  listServerPorts,
  releaseServerPort,
  getSystemdStatus,
  getSystemdLogs,
  getSystemdContent,
  getSystemdUnit,
  updateSystemdUnit,
  verifySystemdUnit,
  applySystemdUnit,
  controlSystemdService,
  getConnectTerminalSettings,
  type SystemdControlAction,
  type ConnectTerminalSettings,
  type Server as ServerType,
  type Script,
  type SystemdService,
  type ServerPortItem,
  type ServerPortProtocol,
} from '@/lib/connect-api'
import { clearConnectSession, loadConnectSession, saveConnectSession } from '@/lib/connect-session'
import { cn } from '@/lib/utils'

const CONNECT_SPLIT_KEY = 'connect.split.ratio'
const CONNECT_SESSION_SAVE_DEBOUNCE_MS = 500
const CONNECT_MIN_FEEDBACK_MS = 2000

// Module-level canvas context for text measurement (reused across renders)
let _measureCtx: CanvasRenderingContext2D | null = null
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (_measureCtx) return _measureCtx
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  _measureCtx = canvas.getContext('2d')
  return _measureCtx
}

function loadSplitRatio(): number {
  try {
    const raw = Number(localStorage.getItem(CONNECT_SPLIT_KEY) || '')
    if (Number.isFinite(raw) && raw >= 0 && raw <= 1) {
      return raw
    }
  } catch {
    // ignore invalid local storage
  }
  return 0.5
}

interface TerminalConnectionTab {
  id: string
  serverId: string
  title: string
  reconnectNonce: number
}

function buildDefaultTerminalTabs(serverId: string): TerminalConnectionTab[] {
  return [
    {
      id: `${serverId}-primary`,
      serverId,
      title: serverId,
      reconnectNonce: 0,
    },
  ]
}

function loadInitialTerminalSession(serverId: string): {
  tabs: TerminalConnectionTab[]
  activeTabId: string
} {
  const saved = loadConnectSession()
  if (!saved || saved.tabs.length === 0) {
    const defaults = buildDefaultTerminalTabs(serverId)
    return { tabs: defaults, activeTabId: defaults[0].id }
  }
  // Ensure the URL serverId has a tab in the restored session
  let tabs = saved.tabs
  const hasUrlServer = tabs.some(tab => tab.serverId === serverId)
  if (!hasUrlServer) {
    tabs = [
      ...tabs,
      {
        id: `${serverId}-${Date.now()}`,
        serverId,
        title: serverId,
        reconnectNonce: 0,
      },
    ]
  }
  // Prefer active tab for the URL serverId when session didn't contain it
  // (tabs.find is safe: we just pushed serverId above when !hasUrlServer)
  const activeTabId = hasUrlServer
    ? tabs.some(tab => tab.id === saved.activeTabId)
      ? saved.activeTabId
      : tabs[0].id
    : (tabs.find(tab => tab.serverId === serverId) ?? tabs[tabs.length - 1]).id
  return { tabs, activeTabId }
}

const DEFAULT_CONNECT_SETTINGS: ConnectTerminalSettings = {
  idleTimeoutSeconds: 1800,
  maxConnections: 0,
}

export function ConnectServerPage({ serverId }: { serverId: string }) {
  const initialSessionRef = useRef(loadInitialTerminalSession(serverId))
  const initialSession = initialSessionRef.current
  const opButtonClass = 'h-8 w-[116px] justify-start'
  const navigate = useNavigate()
  const [servers, setServers] = useState<ServerType[]>([])
  const [scripts, setScripts] = useState<Script[]>([])
  const [serverQuery, setServerQuery] = useState('')
  const [serverMenuOpen, setServerMenuOpen] = useState(false)
  const [connectingOpen, setConnectingOpen] = useState(false)
  const [connectingTarget, setConnectingTarget] = useState('')
  const [connectingPhase, setConnectingPhase] = useState<'checking' | 'offline' | 'limit' | 'safe-exit'>(
    'checking'
  )
  const [connectingDetail, setConnectingDetail] = useState('')
  const [connectSettings, setConnectSettings] =
    useState<ConnectTerminalSettings>(DEFAULT_CONNECT_SETTINGS)
  const [duplicateConnectConfirmOpen, setDuplicateConnectConfirmOpen] = useState(false)
  const [duplicateConnectTarget, setDuplicateConnectTarget] = useState<ServerType | null>(null)
  const [tabRailCollapsed, setTabRailCollapsed] = useState(false)
  const [safeExitingTabId, setSafeExitingTabId] = useState<string | null>(null)
  const [lastActivityAt, setLastActivityAt] = useState<number>(Date.now())
  const [terminalTabs, setTerminalTabs] = useState<TerminalConnectionTab[]>(initialSession.tabs)
  const [activeTabId, setActiveTabId] = useState<string>(initialSession.activeTabId)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [sidePanel, setSidePanel] = useState<'none' | 'files' | 'docker'>('none')
  const [filePanelPresets, setFilePanelPresets] = useState<
    Record<string, { path: string; lockedRoot: string | null; nonce: number }>
  >({})
  const [splitRatio, setSplitRatio] = useState(loadSplitRatio)
  const [isResizing, setIsResizing] = useState(false)
  const [systemdOpen, setSystemdOpen] = useState(false)
  const [systemdQuery, setSystemdQuery] = useState('')
  const [systemdLoading, setSystemdLoading] = useState(false)
  const [systemdError, setSystemdError] = useState('')
  const [systemdHint, setSystemdHint] = useState('')
  const [systemdServices, setSystemdServices] = useState<SystemdService[]>([])
  const [systemdSelected, setSystemdSelected] = useState<string>('')
  const [systemdView, setSystemdView] = useState<'none' | 'status' | 'cat' | 'logs'>('none')
  const [systemdStatusDetails, setSystemdStatusDetails] = useState<Record<string, string>>({})
  const [systemdContentText, setSystemdContentText] = useState('')
  const [systemdLogs, setSystemdLogs] = useState<string[]>([])
  const [systemdUnitPath, setSystemdUnitPath] = useState('')
  const [systemdUnitContent, setSystemdUnitContent] = useState('')
  const [systemdUnitResult, setSystemdUnitResult] = useState('')
  const [systemdEditMode, setSystemdEditMode] = useState(false)
  const [systemdConfirmOpen, setSystemdConfirmOpen] = useState(false)
  const [systemdConfirmAction, setSystemdConfirmAction] = useState<
    SystemdControlAction | 'verify-unit' | 'apply-unit' | null
  >(null)
  const [systemdActionLoading, setSystemdActionLoading] = useState(false)
  const [portsOpen, setPortsOpen] = useState(false)
  const [portsLoading, setPortsLoading] = useState(false)
  const [portsReleasingPort, setPortsReleasingPort] = useState<number | null>(null)
  const [portsReleaseConfirmOpen, setPortsReleaseConfirmOpen] = useState(false)
  const [portsReleaseForce, setPortsReleaseForce] = useState(false)
  const [portsReleaseSubmitting, setPortsReleaseSubmitting] = useState(false)
  const [portsError, setPortsError] = useState('')
  const [portsHint, setPortsHint] = useState('')
  const [portsRows, setPortsRows] = useState<ServerPortItem[]>([])
  const [portsDetectedAt, setPortsDetectedAt] = useState('')
  const [portsProtocol, setPortsProtocol] = useState<ServerPortProtocol>('tcp')
  const [portsSortBy, setPortsSortBy] = useState<'port' | 'status' | 'sources'>('port')
  const [portsSortDirection, setPortsSortDirection] = useState<'asc' | 'desc'>('asc')
  const [portsContainerProbe, setPortsContainerProbe] = useState<string>('')
  const terminalRefs = useRef<Record<string, TerminalPanelHandle | null>>({})
  const safeExitTimerRef = useRef<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const serverSearchRef = useRef<HTMLInputElement>(null)
  const systemdSelectRequestSeq = useRef(0)
  const saveSessionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    listServers()
      .then(setServers)
      .catch(() => {})
    listScripts()
      .then(setScripts)
      .catch(() => {})
    getConnectTerminalSettings()
      .then(setConnectSettings)
      .catch(() => {})
  }, [])

  useEffect(() => {
    setTerminalTabs(prev => {
      if (prev.some(tab => tab.serverId === serverId)) {
        return prev
      }
      return [
        ...prev,
        {
          id: `${serverId}-${Date.now()}`,
          serverId,
          title: serverId,
          reconnectNonce: 0,
        },
      ]
    })
  }, [serverId])

  useEffect(() => {
    setLastActivityAt(Date.now())
  }, [activeTabId])

  useEffect(() => {
    if (terminalTabs.length === 0) {
      clearConnectSession()
      if (saveSessionTimerRef.current) window.clearTimeout(saveSessionTimerRef.current)
      return
    }
    if (saveSessionTimerRef.current) window.clearTimeout(saveSessionTimerRef.current)
    saveSessionTimerRef.current = window.setTimeout(() => {
      const normalizedActiveTabId = terminalTabs.some(tab => tab.id === activeTabId)
        ? activeTabId
        : terminalTabs[0].id
      saveConnectSession({
        tabs: terminalTabs,
        activeTabId: normalizedActiveTabId,
        updatedAt: Date.now(),
      })
    }, CONNECT_SESSION_SAVE_DEBOUNCE_MS)
    return () => {
      if (saveSessionTimerRef.current) window.clearTimeout(saveSessionTimerRef.current)
    }
  }, [activeTabId, terminalTabs])

  useEffect(() => {
    const touchActivity = () => setLastActivityAt(Date.now())
    window.addEventListener('keydown', touchActivity)
    window.addEventListener('mousedown', touchActivity)
    window.addEventListener('touchstart', touchActivity)
    return () => {
      window.removeEventListener('keydown', touchActivity)
      window.removeEventListener('mousedown', touchActivity)
      window.removeEventListener('touchstart', touchActivity)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (safeExitTimerRef.current) {
        window.clearTimeout(safeExitTimerRef.current)
      }
    }
  }, [])

  const activeTab = useMemo(
    () => terminalTabs.find(tab => tab.id === activeTabId) ?? terminalTabs[0],
    [activeTabId, terminalTabs]
  )
  const activeServerId = activeTab?.serverId ?? serverId
  const tabServerIds = useMemo(
    () => Array.from(new Set(terminalTabs.map(tab => tab.serverId))),
    [terminalTabs]
  )

  useEffect(() => {
    const activeServerSet = new Set(tabServerIds)
    setFilePanelPresets(state => {
      let changed = false
      const next: Record<string, { path: string; lockedRoot: string | null; nonce: number }> = {}
      for (const [serverKey, preset] of Object.entries(state)) {
        if (activeServerSet.has(serverKey)) {
          next[serverKey] = preset
        } else {
          changed = true
        }
      }
      return changed ? next : state
    })
  }, [tabServerIds])
  const serverMap = useMemo(() => {
    const map = new Map<string, ServerType>()
    for (const server of servers) {
      map.set(String(server.id), server)
    }
    return map
  }, [servers])
  const filteredServers = useMemo(() => {
    const keyword = serverQuery.trim().toLowerCase()
    if (!keyword) return servers
    return servers.filter(server => {
      const connectType = String(server.connect_type || 'direct')
      const label =
        `${server.name || ''} ${server.host || ''} ${server.id} ${connectType}`.toLowerCase()
      return label.includes(keyword)
    })
  }, [serverQuery, servers])

  const connectTypeLabel = useCallback((server: ServerType) => {
    const raw = String(server.connect_type || 'direct').toLowerCase()
    return raw === 'tunnel' ? 'Tunnel' : 'Direct SSH'
  }, [])

  const duplicateSessionCount = useMemo(() => {
    if (!duplicateConnectTarget) return 0
    const targetId = String(duplicateConnectTarget.id)
    return terminalTabs.filter(tab => tab.serverId === targetId).length
  }, [duplicateConnectTarget, terminalTabs])

  const tabRailExpandedWidth = useMemo(() => {
    const context = getMeasureContext()
    if (!context) {
      return 220
    }

    const bodyStyle = window.getComputedStyle(document.body)
    const fontFamily = bodyStyle.fontFamily || 'sans-serif'
    context.font = `400 14px ${fontFamily}`

    const maxLabelPx = terminalTabs.reduce((max, tab) => {
      const name = serverMap.get(tab.serverId)?.name || tab.title || tab.serverId
      const width = context.measureText(name).width
      return Math.max(max, width)
    }, 0)

    const measured = Math.ceil(maxLabelPx) + 36
    return Math.min(340, Math.max(128, measured))
  }, [serverMap, terminalTabs])

  const handleServerSwitch = useCallback(
    async (targetServer: ServerType, options?: { forceNewSession?: boolean }) => {
      if (connectingOpen) return
      const id = String(targetServer.id)
      const hasExistingSession = terminalTabs.some(tab => tab.serverId === id)

      if (hasExistingSession && !options?.forceNewSession) {
        setDuplicateConnectTarget(targetServer)
        setDuplicateConnectConfirmOpen(true)
        return
      }

      if (
        connectSettings.maxConnections > 0 &&
        terminalTabs.length >= connectSettings.maxConnections
      ) {
        setConnectingTarget(targetServer.name || targetServer.host || id)
        setConnectingPhase('limit')
        setConnectingDetail(`Reached max connections limit (${connectSettings.maxConnections}).`)
        setConnectingOpen(true)
        return
      }

      const targetLabel = targetServer.name || id
      setConnectingTarget(targetLabel)
      setConnectingPhase('checking')
      setConnectingDetail('Establishing secure connection...')
      setConnectingOpen(true)

      const minDelay = new Promise<void>(resolve =>
        window.setTimeout(resolve, CONNECT_MIN_FEEDBACK_MS)
      )
      const [status] = await Promise.all([checkServerStatus(targetServer), minDelay])
      if (status?.status === 'offline') {
        setConnectingPhase('offline')
        setConnectingDetail(status.reason || 'Server is offline.')
        return
      }
      const tabId = `${id}-${Date.now()}`
      setTerminalTabs(prev => [
        ...prev,
        {
          id: tabId,
          serverId: id,
          title: targetLabel,
          reconnectNonce: 0,
        },
      ])
      setActiveTabId(tabId)
      setLastActivityAt(Date.now())
      setConnectingOpen(false)
    },
    [connectSettings.maxConnections, connectingOpen, terminalTabs]
  )

  const closeTabAfterSafeExit = useCallback(
    (tabId: string) => {
      const willLeavePage = terminalTabs.length <= 1
      setSafeExitingTabId(tabId)
      setConnectingTarget(terminalTabs.find(tab => tab.id === tabId)?.title || 'Session')
      setConnectingPhase('safe-exit')
      setConnectingDetail('Safely disconnecting...')
      setConnectingOpen(true)
      if (safeExitTimerRef.current) {
        window.clearTimeout(safeExitTimerRef.current)
      }
      safeExitTimerRef.current = window.setTimeout(() => {
        setTerminalTabs(prev => {
          const next = prev.filter(tab => tab.id !== tabId)
          const fallback = next[0]
          if (!next.some(tab => tab.id === activeTabId) && fallback) {
            setActiveTabId(fallback.id)
          }
          return next
        })
        setSafeExitingTabId(null)
        delete terminalRefs.current[tabId]
        setConnectingOpen(false)
        if (willLeavePage) {
          navigate({ to: '/connect' })
        }
      }, 2000)
    },
    [activeTabId, navigate, terminalTabs]
  )

  useEffect(() => {
    if (!activeTabId || safeExitingTabId) return
    const timeoutSeconds = Math.max(0, Number(connectSettings.idleTimeoutSeconds) || 0)
    if (timeoutSeconds < 60) return

    const remainingMs = Math.max(0, timeoutSeconds * 1000 - (Date.now() - lastActivityAt))
    const timer = window.setTimeout(() => {
      closeTabAfterSafeExit(activeTabId)
    }, remainingMs)
    return () => window.clearTimeout(timer)
  }, [
    activeTabId,
    closeTabAfterSafeExit,
    connectSettings.idleTimeoutSeconds,
    lastActivityAt,
    safeExitingTabId,
  ])

  useEffect(() => {
    const handleFSChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleFSChange)
    return () => document.removeEventListener('fullscreenchange', handleFSChange)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const el = document.getElementById('connect-container')
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      // Fullscreen not supported or denied
    }
  }, [])

  const handleRunScript = useCallback(
    (script: Script) => {
      if (!activeTabId) return
      const terminal = terminalRefs.current[activeTabId]
      if (!terminal) return
      terminal.sendData(script.code + '\n')
    },
    [activeTabId]
  )

  const openPortsDialog = useCallback(() => {
    setPortsOpen(true)
    setPortsError('')
    setPortsHint('')
  }, [])

  const openSystemdDialog = useCallback(() => {
    setSystemdOpen(true)
    setSystemdQuery('')
    setSystemdServices([])
    setSystemdSelected('')
    setSystemdView('none')
    setSystemdError('')
    setSystemdHint('')
    setSystemdStatusDetails({})
    setSystemdContentText('')
    setSystemdLogs([])
    setSystemdUnitPath('')
    setSystemdUnitContent('')
    setSystemdUnitResult('')
    setSystemdEditMode(false)
  }, [])

  useEffect(() => {
    if (!isResizing) return
    const onMove = (event: MouseEvent) => {
      const container = contentRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      const ratio = (event.clientX - rect.left) / rect.width
      const clamped = Math.min(1, Math.max(0, ratio))
      setSplitRatio(clamped)
    }
    const onUp = () => setIsResizing(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isResizing])

  useEffect(() => {
    localStorage.setItem(CONNECT_SPLIT_KEY, String(splitRatio))
  }, [splitRatio])

  useEffect(() => {
    if (isResizing) return
    const t1 = window.setTimeout(() => {
      Object.values(terminalRefs.current).forEach(terminal => terminal?.requestFit())
    }, 0)
    const t2 = window.setTimeout(() => {
      Object.values(terminalRefs.current).forEach(terminal => terminal?.requestFit())
    }, 140)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [sidePanel, splitRatio, isFullscreen, isResizing, activeTabId])

  const applySplitPreset = useCallback((ratio: number) => {
    const clamped = Math.min(1, Math.max(0, ratio))
    setSplitRatio(clamped)
  }, [])

  useEffect(() => {
    if (!systemdOpen) return

    const keyword = systemdQuery.trim()
    if (keyword === '') {
      setSystemdLoading(false)
      setSystemdError('')
      setSystemdServices([])
      setSystemdSelected('')
      setSystemdUnitPath('')
      setSystemdUnitContent('')
      setSystemdUnitResult('')
      setSystemdEditMode(false)
      return
    }

    let cancelled = false
    setSystemdLoading(true)
    setSystemdError('')
    const timer = window.setTimeout(async () => {
      try {
        const services = await listSystemdServices(activeServerId, keyword)
        if (cancelled) return
        setSystemdServices(services)
      } catch (error) {
        if (cancelled) return
        setSystemdError(error instanceof Error ? error.message : 'Failed to load services')
      } finally {
        if (!cancelled) {
          setSystemdLoading(false)
        }
      }
    }, 300)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeServerId, systemdOpen, systemdQuery])

  const loadPorts = useCallback(async () => {
    setPortsLoading(true)
    setPortsError('')
    try {
      const response = await listServerPorts(activeServerId, 'all', portsProtocol)
      setPortsRows(Array.isArray(response.ports) ? response.ports : [])
      setPortsDetectedAt(response.detected_at || '')
      const probe = response.reservation_meta?.container_probe
      if (probe) {
        setPortsContainerProbe(`Docker probe: ${probe.status}`)
      } else {
        setPortsContainerProbe('')
      }
    } catch (error) {
      setPortsError(error instanceof Error ? error.message : 'Failed to load ports')
    } finally {
      setPortsLoading(false)
    }
  }, [activeServerId, portsProtocol])

  const releaseOccupiedPort = useCallback(
    async (port: number) => {
      setPortsReleaseConfirmOpen(false)
      setPortsReleaseSubmitting(true)
      setPortsReleasingPort(port)
      setPortsError('')
      setPortsHint('')
      try {
        const mode = portsReleaseForce ? 'force' : 'graceful'
        const result = await releaseServerPort(activeServerId, port, portsProtocol, mode)
        if (!result.released) {
          setPortsError(`Port ${port} is still occupied after ${mode} release.`)
        } else {
          setPortsHint(`Port ${port} released by ${result.action_taken}.`)
        }
        await loadPorts()
      } catch (error) {
        if (error instanceof ClientResponseError && error.status === 409) {
          const forceHint = !portsReleaseForce ? ' Try enabling force mode.' : ''
          setPortsError(`Port ${port} is still occupied after release.${forceHint}`)
          await loadPorts()
        } else {
          setPortsError(error instanceof Error ? error.message : 'Failed to release port')
        }
      } finally {
        setPortsReleaseSubmitting(false)
        setPortsReleaseForce(false)
        setPortsReleasingPort(null)
      }
    },
    [activeServerId, loadPorts, portsProtocol, portsReleaseForce]
  )

  const requestReleaseOccupiedPort = useCallback((port: number) => {
    setPortsReleasingPort(port)
    setPortsReleaseForce(false)
    setPortsReleaseConfirmOpen(true)
    setPortsError('')
    setPortsHint('')
  }, [])

  const sortedPortsRows = useMemo(() => {
    const rows = [...portsRows]
    const direction = portsSortDirection === 'asc' ? 1 : -1
    const statusRank = (row: ServerPortItem) => {
      const occupied = !!row.occupancy?.occupied
      const reserved = !!row.reservation?.reserved
      if (occupied) return 0
      if (reserved) return 1
      return 2
    }
    rows.sort((left, right) => {
      if (portsSortBy === 'status') {
        const rankDiff = statusRank(left) - statusRank(right)
        if (rankDiff !== 0) return rankDiff * direction
        return (left.port - right.port) * direction
      }
      if (portsSortBy === 'sources') {
        const leftCount = left.reservation?.sources?.length || 0
        const rightCount = right.reservation?.sources?.length || 0
        if (leftCount !== rightCount) return (leftCount - rightCount) * direction
        return (left.port - right.port) * direction
      }
      return (left.port - right.port) * direction
    })
    return rows
  }, [portsRows, portsSortBy, portsSortDirection])

  const portsSummary = useMemo(() => {
    let occupied = 0
    let reservedOnly = 0
    for (const row of portsRows) {
      const isOccupied = !!row.occupancy?.occupied
      const isReserved = !!row.reservation?.reserved
      if (isOccupied) {
        occupied += 1
        continue
      }
      if (isReserved) {
        reservedOnly += 1
      }
    }
    return {
      occupied,
      reserved: reservedOnly,
      total: portsRows.length,
    }
  }, [portsRows])

  const togglePortsSort = useCallback((column: 'port' | 'status' | 'sources') => {
    setPortsSortBy(current => {
      if (current === column) {
        setPortsSortDirection(direction => (direction === 'asc' ? 'desc' : 'asc'))
        return current
      }
      setPortsSortDirection('asc')
      return column
    })
  }, [])

  useEffect(() => {
    if (!portsOpen) return
    void loadPorts()
  }, [loadPorts, portsOpen])

  const runSystemdAction = useCallback(
    async (mode: 'status' | 'cat' | 'logs') => {
      if (!systemdSelected) return
      setSystemdActionLoading(true)
      setSystemdError('')
      setSystemdHint('')
      setSystemdUnitResult('')
      setSystemdEditMode(false)
      try {
        if (mode === 'logs') {
          const response = await getSystemdLogs(activeServerId, systemdSelected, 200)
          setSystemdLogs(Array.isArray(response.entries) ? response.entries : [])
          setSystemdView('logs')
          return
        }

        if (mode === 'cat') {
          const response = await getSystemdContent(activeServerId, systemdSelected)
          setSystemdContentText(response.content || '')
          setSystemdView('cat')
          return
        }

        const response = await getSystemdStatus(activeServerId, systemdSelected)
        setSystemdStatusDetails(response.status || {})
        setSystemdView(mode)
      } catch (error) {
        setSystemdError(error instanceof Error ? error.message : 'Operation failed')
      } finally {
        setSystemdActionLoading(false)
      }
    },
    [activeServerId, systemdSelected]
  )

  const runSystemdControlAction = useCallback(
    async (action: SystemdControlAction) => {
      if (!systemdSelected) return
      setSystemdActionLoading(true)
      setSystemdError('')
      setSystemdHint('')
      setSystemdUnitResult('')
      try {
        await controlSystemdService(activeServerId, systemdSelected, action)
        setSystemdHint(`Action ${action} applied. Next: check Status or Logs.`)
        const response = await getSystemdStatus(activeServerId, systemdSelected)
        setSystemdStatusDetails(response.status || {})
        setSystemdView('status')
      } catch (error) {
        setSystemdError(error instanceof Error ? error.message : 'Operation failed')
      } finally {
        setSystemdActionLoading(false)
      }
    },
    [activeServerId, systemdSelected]
  )

  const openSystemdUnitEditor = useCallback(async () => {
    if (!systemdSelected) return
    setSystemdActionLoading(true)
    setSystemdError('')
    setSystemdHint('')
    setSystemdUnitResult('')
    try {
      const response = await getSystemdUnit(activeServerId, systemdSelected)
      setSystemdUnitPath(response.path || '')
      setSystemdUnitContent(response.content || '')
      setSystemdEditMode(true)
      setSystemdView('cat')
    } catch (error) {
      setSystemdError(error instanceof Error ? error.message : 'Failed to load unit file')
    } finally {
      setSystemdActionLoading(false)
    }
  }, [activeServerId, systemdSelected])

  const validateSystemdUnitFromEditor = useCallback(async () => {
    if (!systemdSelected) return
    setSystemdActionLoading(true)
    setSystemdError('')
    setSystemdHint('')
    setSystemdUnitResult('')
    try {
      const saveRes = await updateSystemdUnit(activeServerId, systemdSelected, systemdUnitContent)
      const verifyRes = await verifySystemdUnit(activeServerId, systemdSelected)
      const output =
        [saveRes.output, verifyRes.verify_output].filter(Boolean).join('\n\n') || 'Validate passed.'
      setSystemdUnitResult(output)
      setSystemdView('cat')
    } catch (error) {
      setSystemdError(error instanceof Error ? error.message : 'Failed to validate unit file')
    } finally {
      setSystemdActionLoading(false)
    }
  }, [activeServerId, systemdSelected, systemdUnitContent])

  const applySystemdUnitFromEditor = useCallback(async () => {
    if (!systemdSelected) return
    setSystemdActionLoading(true)
    setSystemdError('')
    setSystemdHint('')
    setSystemdUnitResult('')
    try {
      const saveRes = await updateSystemdUnit(activeServerId, systemdSelected, systemdUnitContent)
      const applyRes = await applySystemdUnit(activeServerId, systemdSelected)
      const output =
        [saveRes.output, applyRes.reload_output, applyRes.apply_output]
          .filter(Boolean)
          .join('\n\n') || 'Apply completed.'
      setSystemdUnitResult(output)
      const statusRes = await getSystemdStatus(activeServerId, systemdSelected)
      setSystemdStatusDetails(statusRes.status || {})
      setSystemdEditMode(false)
      setSystemdView('status')
    } catch (error) {
      setSystemdError(error instanceof Error ? error.message : 'Failed to apply unit file')
    } finally {
      setSystemdActionLoading(false)
    }
  }, [activeServerId, systemdSelected, systemdUnitContent])

  const requestSystemdConfirm = useCallback(
    (action: SystemdControlAction | 'verify-unit' | 'apply-unit') => {
      setSystemdConfirmAction(action)
      setSystemdConfirmOpen(true)
    },
    []
  )

  const executeSystemdConfirm = useCallback(async () => {
    const action = systemdConfirmAction
    setSystemdConfirmOpen(false)
    if (!action) return
    if (action === 'verify-unit') {
      await validateSystemdUnitFromEditor()
      return
    }
    if (action === 'apply-unit') {
      await applySystemdUnitFromEditor()
      return
    }
    await runSystemdControlAction(action)
  }, [
    applySystemdUnitFromEditor,
    runSystemdControlAction,
    systemdConfirmAction,
    validateSystemdUnitFromEditor,
  ])

  useEffect(() => {
    if (!serverMenuOpen) {
      setServerQuery('')
      return
    }
    const timer = window.setTimeout(() => {
      serverSearchRef.current?.focus()
      serverSearchRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [serverMenuOpen])

  return (
    <div
      id="connect-container"
      className={cn(
        'flex flex-col h-full min-h-0 overflow-hidden',
        isFullscreen && 'bg-background'
      )}
    >
      <div className="flex items-start gap-2 px-3 py-2 border-b shrink-0">
        <div className="mr-1">
          <h1 className="text-2xl font-bold tracking-tight leading-none">Connect Servers</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage terminal sessions, files, and containers for selected servers
          </p>
        </div>

        <div className="flex-1" />

        <Button
          variant={sidePanel === 'none' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 h-7"
          onClick={() => setSidePanel('none')}
        >
          Terminal
        </Button>

        <Button
          variant={sidePanel === 'files' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 h-7"
          onClick={() => {
            if (sidePanel === 'files') {
              setSidePanel('none')
              return
            }
            setTabRailCollapsed(true)
            setFilePanelPresets(state => {
              if (state[activeServerId]) return state
              return {
                ...state,
                [activeServerId]: { path: '/', lockedRoot: null, nonce: 0 },
              }
            })
            setSidePanel('files')
          }}
        >
          <FolderOpen className="h-4 w-4" />
          Files
        </Button>

        <Button
          variant={sidePanel === 'docker' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 h-7"
          onClick={() => {
            setSidePanel(value => {
              const next = value === 'docker' ? 'none' : 'docker'
              if (next !== 'none') {
                setTabRailCollapsed(true)
              }
              return next
            })
          }}
        >
          <Container className="h-4 w-4" />
          Docker
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 h-7">
              Action
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ScrollText className="h-4 w-4" />
                Run Script
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-[360px] max-h-[300px] overflow-y-auto">
                <DropdownMenuLabel className="text-xs">Run script in terminal</DropdownMenuLabel>
                {scripts.map(s => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => handleRunScript(s)}
                    className="flex items-start gap-2 py-2"
                  >
                    <ScrollText className="h-4 w-4 mt-0.5 shrink-0" />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate font-medium">{s.name}</span>
                      {s.description && (
                        <span className="text-xs text-muted-foreground line-clamp-2">
                          {s.description}
                        </span>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
                {scripts.length === 0 && <DropdownMenuItem disabled>No scripts</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href="/resources/scripts?create=1">
                    <Plus className="h-4 w-4 mr-2" />
                    New Script
                  </a>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={openPortsDialog}>
              <Network className="h-4 w-4 mr-2" />
              Inspect Ports
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openSystemdDialog}>
              <Cog className="h-4 w-4 mr-2" />
              Manage Services
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {sidePanel !== 'none' && (
          <Tooltip>
            <DropdownMenu>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 relative"
                    aria-label="Layout presets"
                  >
                    <PanelsLeftRight className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <DropdownMenuContent align="end">
                <div className="grid grid-cols-1 gap-1 p-1 min-w-[160px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => applySplitPreset(0.3)}
                  >
                    30 / 70
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => applySplitPreset(0)}
                  >
                    0 / 100
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => applySplitPreset(0.5)}
                  >
                    50 / 50
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => applySplitPreset(0.7)}
                  >
                    70 / 30
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => applySplitPreset(0.5)}
                  >
                    Reset
                  </Button>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipContent>
              Layout {Math.round(splitRatio * 100)} / {Math.round((1 - splitRatio) * 100)}
            </TooltipContent>
          </Tooltip>
        )}

        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      </div>

      <Dialog
        open={connectingOpen}
        onOpenChange={open => {
          if (connectingPhase === 'safe-exit' && !open) return
          if (connectingPhase === 'checking' && !open) return
          setConnectingOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {connectingPhase === 'safe-exit'
                ? 'Disconnecting...'
                : connectingPhase === 'limit'
                  ? 'Connection Limit Reached'
                  : 'Connecting...'}
            </DialogTitle>
            <DialogDescription>
              {connectingTarget ? `Target: ${connectingTarget}` : 'Preparing connection'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 text-sm">
            {connectingPhase === 'checking' ? (
              <div className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {connectingDetail || 'Establishing secure connection...'}
              </div>
            ) : connectingPhase === 'safe-exit' ? (
              <div className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {connectingDetail || 'Safely disconnecting...'}
              </div>
            ) : (
              <div className="text-destructive">{connectingDetail}</div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConnectingOpen(false)}
              disabled={connectingPhase === 'safe-exit' || connectingPhase === 'checking'}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={duplicateConnectConfirmOpen} onOpenChange={setDuplicateConnectConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open another session?</AlertDialogTitle>
            <AlertDialogDescription>
              {duplicateConnectTarget
                ? `Server ${duplicateConnectTarget.name || duplicateConnectTarget.host || duplicateConnectTarget.id} already has ${duplicateSessionCount} active session(s). Open a new one anyway?`
                : 'This server already has active session(s). Open a new one anyway?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDuplicateConnectTarget(null)
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = duplicateConnectTarget
                setDuplicateConnectConfirmOpen(false)
                setDuplicateConnectTarget(null)
                if (target) {
                  void handleServerSwitch(target, { forceNewSession: true })
                }
              }}
            >
              Open New Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div
        ref={contentRef}
        className={cn(
          'flex-1 flex min-h-0 overflow-hidden',
          isResizing && 'select-none cursor-col-resize'
        )}
      >
        <div
          className={cn(
            'h-full border-r bg-muted/20 shrink-0 flex flex-col',
            tabRailCollapsed && 'w-10 cursor-pointer'
          )}
          style={tabRailCollapsed ? undefined : { width: `${tabRailExpandedWidth}px` }}
          title={tabRailCollapsed ? 'Click or double-click to expand Connections' : undefined}
          onClick={event => {
            if (!tabRailCollapsed) return
            if (event.target === event.currentTarget) {
              setTabRailCollapsed(false)
            }
          }}
          onDoubleClick={event => {
            if (!tabRailCollapsed) return
            if (event.target === event.currentTarget) {
              setTabRailCollapsed(false)
            }
          }}
        >
          <div className="h-10 px-1.5 flex items-center justify-between border-b gap-1">
            <DropdownMenu open={serverMenuOpen} onOpenChange={setServerMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={tabRailCollapsed ? 'ghost' : serverMenuOpen ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn(
                    'h-7 min-w-0 px-1.5',
                    tabRailCollapsed ? 'w-7' : 'flex-1 justify-start gap-1.5 text-sm font-medium'
                  )}
                >
                  {tabRailCollapsed ? (
                    <Server className="h-3.5 w-3.5" />
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">New</span>
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[320px]">
                <DropdownMenuLabel className="pb-2">
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      ref={serverSearchRef}
                      value={serverQuery}
                      onChange={event => setServerQuery(event.target.value)}
                      onKeyDown={event => event.stopPropagation()}
                      placeholder="Search server..."
                      className="w-full h-8 rounded-md border bg-background pl-7 pr-2 text-xs font-normal"
                    />
                  </div>
                </DropdownMenuLabel>
                {filteredServers.map(s => (
                  <DropdownMenuItem
                    key={s.id}
                    onClick={() => handleServerSwitch(s)}
                    className={cn('items-start py-2', s.id === activeServerId && 'bg-accent')}
                  >
                    <div className="min-w-0 flex flex-col gap-0.5">
                      <span
                        className={cn('text-sm truncate', s.id === activeServerId && 'font-medium')}
                      >
                        {s.name || s.id}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">
                        {(s.host || '-') + ' · ' + connectTypeLabel(s)}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
                {filteredServers.length === 0 && (
                  <DropdownMenuItem disabled>No servers</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href="/resources/servers?create=1">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Server
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!tabRailCollapsed && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setTabRailCollapsed(true)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div
            className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1"
            title={tabRailCollapsed ? 'Click or double-click to expand Connections' : undefined}
            onClick={event => {
              if (!tabRailCollapsed) return
              if (event.target === event.currentTarget) {
                setTabRailCollapsed(false)
              }
            }}
            onDoubleClick={event => {
              if (!tabRailCollapsed) return
              if (event.target === event.currentTarget) {
                setTabRailCollapsed(false)
              }
            }}
            style={tabRailCollapsed ? { cursor: 'pointer' } : undefined}
          >
            {terminalTabs.map((tab, index) => {
              const isActive = tab.id === activeTabId
              const isSafeExiting = tab.id === safeExitingTabId
              const tabServer = serverMap.get(tab.serverId)
              const tabTitle = tabServer?.name || tab.title || tab.serverId
              const tabMeta = `${tabServer?.host || '-'} · ${tabServer ? connectTypeLabel(tabServer) : 'Direct SSH'}`
              return (
                <div
                  key={tab.id}
                  className={cn(
                    'group w-full min-h-9 rounded-md border px-2 py-1.5 transition-colors flex items-center gap-2',
                    isActive
                      ? 'bg-accent border-border shadow-sm'
                      : 'bg-background/60 border-border/60 hover:bg-accent/40'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTabId(tab.id)
                      setLastActivityAt(Date.now())
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={`${tabTitle}\n${tabMeta}`}
                  >
                    {tabRailCollapsed ? (
                      <span className="text-xs text-muted-foreground mx-auto">{index + 1}</span>
                    ) : (
                      <>
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full shrink-0',
                            isActive ? 'bg-primary' : 'bg-primary/70'
                          )}
                          aria-hidden="true"
                        />
                        <span className="text-sm truncate flex-1">{tabTitle}</span>
                      </>
                    )}
                  </button>
                  {!tabRailCollapsed &&
                    (isSafeExiting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : isActive ? (
                      <button
                        type="button"
                        aria-label={`Close ${tabTitle}`}
                        onClick={() => closeTabAfterSafeExit(tab.id)}
                        className="inline-flex h-5 w-0 overflow-hidden items-center justify-center rounded opacity-0 transition-all group-hover:w-5 group-hover:opacity-100 hover:bg-muted"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null)}
                </div>
              )
            })}
          </div>
        </div>

        <div
          className={cn(
            'h-full min-w-0 overflow-hidden flex flex-col relative',
            sidePanel === 'none' && 'flex-1'
          )}
          style={sidePanel === 'none' ? undefined : { width: `${Math.round(splitRatio * 100)}%` }}
        >
          {terminalTabs.map(tab => {
            const isActive = tab.id === activeTabId
            return (
              <div key={tab.id} className={cn('h-full min-h-0', isActive ? 'block' : 'hidden')}>
                <TerminalPanel
                  key={`${tab.id}-${tab.reconnectNonce}`}
                  ref={instance => {
                    terminalRefs.current[tab.id] = instance
                  }}
                  serverId={tab.serverId}
                  className="h-full"
                  isActive={isActive}
                />
              </div>
            )
          })}
        </div>

        {sidePanel !== 'none' && (
          <>
            <div
              className="w-1 h-full border-l border-r bg-border/60 hover:bg-border cursor-col-resize"
              onMouseDown={event => {
                event.preventDefault()
                setIsResizing(true)
              }}
            />
            <div
              data-connect-side-panel="true"
              className="h-full min-h-0 min-w-0 overflow-hidden"
              style={{ width: `${Math.round((1 - splitRatio) * 100)}%` }}
            >
              {sidePanel === 'files'
                ? tabServerIds.map(tabServerId => {
                    const preset = filePanelPresets[tabServerId]
                    return (
                      <div
                        key={`files-wrap-${tabServerId}`}
                        className={cn(
                          'h-full min-h-0',
                          tabServerId === activeServerId ? 'block' : 'hidden'
                        )}
                      >
                        <FileManagerPanel
                          key={`files-${tabServerId}-${preset?.nonce ?? 0}`}
                          serverId={tabServerId}
                          initialPath={preset?.path || '/'}
                          lockedRootPath={preset?.lockedRoot || undefined}
                          className="h-full"
                        />
                      </div>
                    )
                  })
                : tabServerIds.map(tabServerId => (
                    <div
                      key={`docker-wrap-${tabServerId}`}
                      className={cn(
                        'h-full min-h-0',
                        tabServerId === activeServerId ? 'block' : 'hidden'
                      )}
                    >
                      <DockerPanel
                        serverId={tabServerId}
                        className="h-full p-3"
                        onOpenFilesAtPath={(targetPath, lockedRootPath) => {
                          setFilePanelPresets(state => {
                            const current = state[tabServerId] || {
                              path: '/',
                              lockedRoot: null,
                              nonce: 0,
                            }
                            return {
                              ...state,
                              [tabServerId]: {
                                path: targetPath,
                                lockedRoot: lockedRootPath,
                                nonce: current.nonce + 1,
                              },
                            }
                          })
                          setTabRailCollapsed(true)
                          setSidePanel('files')
                        }}
                      />
                    </div>
                  ))}
            </div>
          </>
        )}
      </div>

      <Dialog open={portsOpen} onOpenChange={setPortsOpen}>
        <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Port Inspector</DialogTitle>
            <DialogDescription>List occupied and reserved ports.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            <div className="shrink-0 border rounded-md p-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={portsProtocol}
                  onChange={event => setPortsProtocol(event.target.value as ServerPortProtocol)}
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
                <Button size="sm" variant="outline" onClick={() => void loadPorts()}>
                  Refresh
                </Button>
                {portsDetectedAt && (
                  <span className="text-xs text-muted-foreground">
                    Detected at: {portsDetectedAt}
                  </span>
                )}
              </div>
              {portsContainerProbe && (
                <div className="mt-2 text-xs text-muted-foreground">{portsContainerProbe}</div>
              )}
              <div className="mt-2 text-xs text-muted-foreground">
                Status rule: Occupied = already in use; Reserved = reserved but not currently
                occupied.
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Total: {portsSummary.total} · Occupied: {portsSummary.occupied} · Reserved:{' '}
                {portsSummary.reserved}
              </div>
              {portsHint && <div className="mt-2 text-xs text-emerald-600">{portsHint}</div>}
            </div>

            <div className="flex-1 min-h-0 border rounded-md overflow-auto">
              {portsLoading ? (
                <div className="p-3 text-sm text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading ports...
                </div>
              ) : portsRows.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground">
                  No occupied or reserved ports.
                </div>
              ) : (
                <div className="w-full">
                  <div className="grid grid-cols-[64px_88px_minmax(0,1fr)_120px_minmax(0,1fr)_84px] gap-2 px-2 py-2 text-xs font-medium border-b bg-muted/20">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => togglePortsSort('port')}
                    >
                      Port{' '}
                      {portsSortBy === 'port' ? (portsSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => togglePortsSort('status')}
                    >
                      Status{' '}
                      {portsSortBy === 'status' ? (portsSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                    <span>Process</span>
                    <span>PID</span>
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => togglePortsSort('sources')}
                    >
                      Sources{' '}
                      {portsSortBy === 'sources' ? (portsSortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                    <span>Action</span>
                  </div>
                  <div className="divide-y">
                    {sortedPortsRows.map(row => {
                      const process = row.occupancy?.process
                      const pidList = row.occupancy?.pids || []
                      const processLabel = process?.name || '-'
                      const pidLabel = pidList.length
                        ? pidList.join(',')
                        : process?.pid
                          ? String(process.pid)
                          : '-'
                      const sourceLabel =
                        row.reservation?.sources?.map(source => source.type).join(', ') || '-'
                      const occupied = !!row.occupancy?.occupied
                      const reserved = !!row.reservation?.reserved
                      const statusLabel = occupied ? 'Occupied' : reserved ? 'Reserved' : '-'
                      const statusClass = occupied
                        ? 'text-emerald-600'
                        : reserved
                          ? 'text-amber-600'
                          : 'text-muted-foreground'
                      return (
                        <div
                          key={`${row.port}`}
                          className="grid grid-cols-[64px_88px_minmax(0,1fr)_120px_minmax(0,1fr)_84px] gap-2 px-2 py-2 text-sm"
                        >
                          <span className="font-medium">{row.port}</span>
                          <span className={statusClass}>{statusLabel}</span>
                          <span className="truncate" title={processLabel}>
                            {processLabel}
                          </span>
                          <span className="truncate" title={pidLabel}>
                            {pidLabel}
                          </span>
                          <span className="truncate" title={sourceLabel}>
                            {sourceLabel}
                          </span>
                          <div>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !occupied ||
                                portsLoading ||
                                portsReleaseSubmitting ||
                                portsReleasingPort === row.port
                              }
                              onClick={() => requestReleaseOccupiedPort(row.port)}
                              className="h-7 px-2 text-xs"
                            >
                              {portsReleaseSubmitting && portsReleasingPort === row.port ? (
                                <>
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  Releasing...
                                </>
                              ) : (
                                'Release'
                              )}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {portsError && <div className="text-sm text-destructive">{portsError}</div>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPortsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={portsReleaseConfirmOpen}
        onOpenChange={open => {
          if (portsReleaseSubmitting) return
          setPortsReleaseConfirmOpen(open)
          if (!open) {
            setPortsReleasingPort(null)
            setPortsReleaseForce(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release port {portsReleasingPort ?? '-'}</AlertDialogTitle>
            <AlertDialogDescription>
              This operation stops the current owner of this port. Use with caution.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={portsReleaseForce}
                disabled={portsReleaseSubmitting}
                onCheckedChange={checked => setPortsReleaseForce(checked === true)}
              />
              <span>
                Force release (non-graceful). This may terminate processes or containers
                immediately.
              </span>
            </label>

            {portsReleaseForce && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive inline-flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5" />
                <span>
                  Dangerous operation: force mode may cause service interruption or data loss.
                </span>
              </div>
            )}

            {portsReleaseSubmitting && (
              <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Releasing port owner... please wait.
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={portsReleaseSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={portsReleaseSubmitting || portsReleasingPort == null}
              onClick={() => {
                if (portsReleasingPort == null) return
                void releaseOccupiedPort(portsReleasingPort)
              }}
            >
              {portsReleaseSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Releasing...
                </>
              ) : (
                'Confirm Release'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={systemdOpen} onOpenChange={setSystemdOpen}>
        <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Service Manager</DialogTitle>
            <DialogDescription>Search service and run operations.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            <div className="shrink-0 space-y-2">
              <input
                value={systemdQuery}
                onChange={event => setSystemdQuery(event.target.value)}
                placeholder="Search service keyword..."
                className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              />
              <div className="border rounded-md max-h-[210px] overflow-auto">
                {systemdLoading ? (
                  <div className="p-3 text-sm text-muted-foreground inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading services...
                  </div>
                ) : systemdQuery.trim() === '' ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    Enter keyword to search services.
                  </div>
                ) : systemdServices.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No matched services.</div>
                ) : (
                  <div className="p-1 space-y-1 min-w-0">
                    {systemdServices.map(service => (
                      <button
                        type="button"
                        key={service.name}
                        onClick={() => {
                          const requestSeq = systemdSelectRequestSeq.current + 1
                          systemdSelectRequestSeq.current = requestSeq
                          setSystemdSelected(service.name)
                          setSystemdView('none')
                          setSystemdError('')
                          setSystemdHint('')
                          setSystemdStatusDetails({})
                          setSystemdContentText('')
                          setSystemdLogs([])
                          setSystemdUnitPath('')
                          setSystemdUnitContent('')
                          setSystemdUnitResult('')
                          setSystemdEditMode(false)
                          setSystemdActionLoading(true)
                          void getSystemdStatus(activeServerId, service.name)
                            .then(response => {
                              if (systemdSelectRequestSeq.current !== requestSeq) return
                              setSystemdStatusDetails(response.status || {})
                              setSystemdView('status')
                            })
                            .catch(error => {
                              if (systemdSelectRequestSeq.current !== requestSeq) return
                              setSystemdError(
                                error instanceof Error ? error.message : 'Operation failed'
                              )
                            })
                            .finally(() => {
                              if (systemdSelectRequestSeq.current !== requestSeq) return
                              setSystemdActionLoading(false)
                            })
                        }}
                        className={cn(
                          'w-full text-left rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                          systemdSelected === service.name && 'bg-accent'
                        )}
                      >
                        <div className="font-medium truncate">{service.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {service.description}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="shrink-0 border rounded-md p-2">
              <div className="flex flex-wrap gap-2 items-center">
                <Button
                  size="sm"
                  variant="outline"
                  className={opButtonClass}
                  disabled={!systemdSelected || systemdActionLoading}
                  onClick={() => void runSystemdAction('cat')}
                >
                  <PenLine className="h-4 w-4 mr-1" />
                  Cat
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={opButtonClass}
                  disabled={!systemdSelected || systemdActionLoading}
                  onClick={() => void runSystemdAction('logs')}
                >
                  <ScrollText className="h-4 w-4 mr-1" />
                  Logs
                </Button>
                {systemdView === 'cat' && !systemdEditMode && (
                  <Button
                    size="sm"
                    className={opButtonClass}
                    disabled={!systemdSelected || systemdActionLoading}
                    onClick={() => void openSystemdUnitEditor()}
                  >
                    <Cog className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className={opButtonClass}
                      disabled={!systemdSelected || systemdActionLoading}
                    >
                      Service Action
                      <ChevronDown className="h-3 w-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => requestSystemdConfirm('start')}>
                      <Play className="h-4 w-4 mr-2" />
                      Start
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => requestSystemdConfirm('restart')}>
                      <RotateCw className="h-4 w-4 mr-2" />
                      Restart
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => requestSystemdConfirm('stop')}
                    >
                      <Square className="h-4 w-4 mr-2" />
                      Stop
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => requestSystemdConfirm('enable')}>
                      <Power className="h-4 w-4 mr-2" />
                      Enable
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => requestSystemdConfirm('disable')}
                    >
                      <PowerOff className="h-4 w-4 mr-2" />
                      Disable
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="flex-1 min-h-0 border rounded-md p-3 overflow-auto">
              {systemdActionLoading && (
                <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              )}

              {!systemdActionLoading && systemdView === 'status' && (
                <div className="space-y-1 text-sm">
                  {Object.keys(systemdStatusDetails).length === 0 ? (
                    <div className="text-muted-foreground">No status output.</div>
                  ) : (
                    Object.entries(systemdStatusDetails).map(([key, value]) => (
                      <div key={key} className="grid grid-cols-[160px_1fr] gap-2">
                        <span className="text-muted-foreground truncate">{key}</span>
                        <span className="break-words">{value || '-'}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {!systemdActionLoading && systemdView === 'cat' && (
                <div className="space-y-3">
                  {!systemdEditMode ? (
                    <>
                      <pre className="text-xs whitespace-pre-wrap break-words">
                        {systemdContentText || 'No service content.'}
                      </pre>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-xs text-muted-foreground">
                        Unit file: {systemdUnitPath || '-'}
                      </div>
                      <textarea
                        value={systemdUnitContent}
                        onChange={event => setSystemdUnitContent(event.target.value)}
                        className="w-full min-h-[260px] rounded-md border bg-background p-3 text-xs font-mono overflow-auto"
                        placeholder="[Unit]\nDescription=..."
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!systemdSelected || systemdActionLoading}
                          onClick={() => requestSystemdConfirm('verify-unit')}
                        >
                          Validate
                        </Button>
                        <Button
                          size="sm"
                          disabled={!systemdSelected || systemdActionLoading}
                          onClick={() => requestSystemdConfirm('apply-unit')}
                        >
                          Apply
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={systemdActionLoading}
                          onClick={() => setSystemdEditMode(false)}
                        >
                          Cancel Edit
                        </Button>
                      </div>
                      {systemdUnitResult && (
                        <pre className="text-xs whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3">
                          {systemdUnitResult}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!systemdActionLoading && systemdView === 'logs' && (
                <pre className="text-xs whitespace-pre-wrap break-words">
                  {systemdLogs.length ? systemdLogs.join('\n') : 'No logs.'}
                </pre>
              )}

              {!systemdActionLoading && systemdView === 'none' && systemdSelected && (
                <div className="text-sm text-muted-foreground">
                  Choose one operation above to continue.
                </div>
              )}
              {systemdHint && <div className="mt-3 text-xs text-emerald-600">{systemdHint}</div>}
            </div>

            {systemdError && <div className="text-sm text-destructive">{systemdError}</div>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSystemdOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={systemdConfirmOpen} onOpenChange={setSystemdConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {systemdConfirmAction === 'verify-unit'
                ? 'Validate unit file?'
                : systemdConfirmAction === 'apply-unit'
                  ? 'Apply unit changes?'
                  : 'Confirm service action?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {systemdConfirmAction === 'verify-unit'
                ? `Service: ${systemdSelected || '-'}\nThis will run systemd-analyze verify.`
                : systemdConfirmAction === 'apply-unit'
                  ? `Service: ${systemdSelected || '-'}\nThis will save current editor content, then run daemon-reload and try-restart.`
                  : `Service: ${systemdSelected || '-'}\nAction: ${systemdConfirmAction || '-'}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void executeSystemdConfirm()
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
