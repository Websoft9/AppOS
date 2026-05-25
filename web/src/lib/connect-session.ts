const CONNECT_SESSION_KEY = 'connect.session.v1'
const CONNECT_WORKSPACE_KEY = 'connect.workspace.v1'
const CONNECT_SESSION_TTL_MS = 10 * 60 * 1000

export interface PersistedTerminalTab {
  id: string
  serverId: string
  title: string
  reconnectNonce: number
}

export interface ConnectSessionSnapshot {
  tabs: PersistedTerminalTab[]
  activeTabId: string
  updatedAt: number
}

export interface PersistedWorkspaceTab {
  sessionId: string
  serverId: string
  title: string
}

export interface PersistedWorkspaceState {
  panel?: 'files'
  path?: string
  lockedRoot?: string
  split?: number
}

export interface RestoreWorkspaceSession extends PersistedWorkspaceTab, PersistedWorkspaceState {}

export interface ConnectWorkspaceSnapshot {
  tabs: PersistedWorkspaceTab[]
  activeSessionId?: string
  workspaceBySessionId: Record<string, PersistedWorkspaceState>
  updatedAt: number
}

function isValidTab(value: unknown): value is PersistedTerminalTab {
  if (!value || typeof value !== 'object') return false
  const tab = value as Partial<PersistedTerminalTab>
  return (
    typeof tab.id === 'string' &&
    typeof tab.serverId === 'string' &&
    typeof tab.title === 'string' &&
    typeof tab.reconnectNonce === 'number'
  )
}

function isValidWorkspaceTab(value: unknown): value is PersistedWorkspaceTab {
  if (!value || typeof value !== 'object') return false
  const tab = value as Partial<PersistedWorkspaceTab>
  return (
    typeof tab.sessionId === 'string' &&
    typeof tab.serverId === 'string' &&
    typeof tab.title === 'string'
  )
}

function normalizeWorkspaceState(value: unknown): PersistedWorkspaceState | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Record<string, unknown>
  return {
    panel: state.panel === 'files' ? 'files' : undefined,
    path: typeof state.path === 'string' && state.path.trim() ? state.path : undefined,
    lockedRoot:
      typeof state.lockedRoot === 'string' && state.lockedRoot.trim() ? state.lockedRoot : undefined,
    split:
      typeof state.split === 'number' && Number.isFinite(state.split)
        ? state.split
        : typeof state.split === 'string' && Number.isFinite(Number(state.split))
          ? Number(state.split)
          : undefined,
  }
}

export function loadConnectSession(): ConnectSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(CONNECT_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ConnectSessionSnapshot>
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null
    const tabs = parsed.tabs.filter(isValidTab)
    if (tabs.length === 0) return null
    const activeTabId =
      typeof parsed.activeTabId === 'string' && tabs.some(tab => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : tabs[0].id
    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
    if (Date.now() - updatedAt > CONNECT_SESSION_TTL_MS) {
      clearConnectSession()
      return null
    }
    return { tabs, activeTabId, updatedAt }
  } catch {
    return null
  }
}

export function saveConnectSession(snapshot: ConnectSessionSnapshot): void {
  try {
    localStorage.setItem(CONNECT_SESSION_KEY, JSON.stringify(snapshot))
  } catch {
    // Ignore storage errors
  }
}

export function loadConnectWorkspaceSnapshot(): ConnectWorkspaceSnapshot | null {
  try {
    const raw = localStorage.getItem(CONNECT_WORKSPACE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ConnectWorkspaceSnapshot>
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null
    const tabs = parsed.tabs.filter(isValidWorkspaceTab)
    if (tabs.length === 0) return null
    const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now()
    if (Date.now() - updatedAt > CONNECT_SESSION_TTL_MS) {
      clearConnectWorkspaceSnapshot()
      return null
    }
    const activeSessionId =
      typeof parsed.activeSessionId === 'string' &&
      tabs.some(tab => tab.sessionId === parsed.activeSessionId)
        ? parsed.activeSessionId
        : undefined
    const workspaceBySessionId = Object.entries(parsed.workspaceBySessionId ?? {}).reduce<
      Record<string, PersistedWorkspaceState>
    >((acc, [sessionId, value]) => {
      if (!sessionId.trim()) return acc
      const state = normalizeWorkspaceState(value)
      if (state) {
        acc[sessionId] = state
      }
      return acc
    }, {})
    return { tabs, activeSessionId, workspaceBySessionId, updatedAt }
  } catch {
    return null
  }
}

export function saveConnectWorkspaceSnapshot(snapshot: ConnectWorkspaceSnapshot): void {
  try {
    localStorage.setItem(CONNECT_WORKSPACE_KEY, JSON.stringify(snapshot))
  } catch {
    // Ignore storage errors
  }
}

export function clearConnectWorkspaceSnapshot(): void {
  try {
    localStorage.removeItem(CONNECT_WORKSPACE_KEY)
  } catch {
    // Ignore storage errors
  }
}

export function clearConnectSession(): void {
  try {
    localStorage.removeItem(CONNECT_SESSION_KEY)
  } catch {
    // Ignore storage errors
  }
}
