const CONNECT_SESSION_KEY = 'connect.session.v1'
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

export function clearConnectSession(): void {
  try {
    localStorage.removeItem(CONNECT_SESSION_KEY)
  } catch {
    // Ignore storage errors
  }
}
