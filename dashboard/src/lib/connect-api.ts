// Connect API client — helpers for terminal-backed file operations on remote servers
// Backend: /api/terminal/sftp/:serverId/* and /api/terminal/ssh/:serverId
// Requires superuser auth; callers should handle 401/403 gracefully.

import { pb } from '@/lib/pb'
import { settingsEntryPath } from '@/lib/settings-api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DirEntry {
  name: string
  type: 'file' | 'dir' | 'symlink'
  size: number
  mode: string
  modified_at: string
}

export interface SFTPListResponse {
  path: string
  entries: DirEntry[]
}

export interface SearchResult {
  path: string // full remote path
  name: string // base filename
  type: 'file' | 'dir' | 'symlink'
  size: number
  mode: string
  modified_at: string
}

export interface FileAttrs {
  path: string
  type: 'file' | 'dir' | 'symlink'
  mode: string
  owner: number
  group: number
  owner_name?: string
  group_name?: string
  size: number
  accessed_at: string
  modified_at: string
  created_at: string
}

export interface SFTPSearchResponse {
  path: string // search base path
  query: string
  results: SearchResult[]
}

export interface Server {
  id: string
  name: string
  host: string
  connect_type?: 'direct' | 'tunnel' | string
  [key: string]: unknown
}

export interface SystemdService {
  name: string
  load_state: string
  active_state: string
  sub_state: string
  description: string
}

export interface SystemdStatusResponse {
  server_id: string
  service: string
  status: Record<string, string>
  status_text: string
}

export interface SystemdLogsResponse {
  server_id: string
  service: string
  lines: number
  entries: string[]
  raw: string
}

export interface SystemdContentResponse {
  server_id: string
  service: string
  content: string
}

export interface SystemdUnitResponse {
  server_id: string
  service: string
  path: string
  content: string
}

export interface SystemdUnitApplyResponse {
  server_id: string
  service: string
  path?: string
  status: string
  output?: string
  verify_output?: string
  reload_output?: string
  apply_output?: string
}

export type SystemdControlAction = 'start' | 'stop' | 'restart' | 'enable' | 'disable'

export type ServerPortProtocol = 'tcp' | 'udp'
export type ServerPortView = 'occupancy' | 'reservation' | 'all'

export interface ServerPortProcess {
  name?: string
  pid?: number
}

export interface ServerPortListener {
  state: string
  local_address: string
  peer_address: string
  raw: string
  process?: ServerPortProcess
  processes?: ServerPortProcess[]
  pids?: number[]
}

export interface ServerPortOccupancy {
  occupied: boolean
  listeners: ServerPortListener[]
  process?: ServerPortProcess
  pids?: number[]
}

export interface ServerPortReservationSource {
  type: string
  confidence: 'high' | 'medium' | 'low'
  matches: Record<string, unknown>[]
}

export interface ServerPortContainerProbe {
  available: boolean
  status: 'ok' | 'not_available' | 'error'
}

export interface ServerPortReservation {
  reserved: boolean
  sources: ServerPortReservationSource[]
  container_probe?: ServerPortContainerProbe
}

export interface ServerPortItem {
  port: number
  occupancy?: ServerPortOccupancy
  reservation?: ServerPortReservation
}

export interface ServerPortsResponse {
  server_id: string
  protocol: ServerPortProtocol
  view: ServerPortView
  detected_at: string
  ports: ServerPortItem[]
  total: number
  reservation_meta?: {
    container_probe?: ServerPortContainerProbe
  }
}

export interface ReleaseServerPortResponse {
  server_id: string
  port: number
  protocol: ServerPortProtocol
  mode: 'graceful' | 'force'
  owner_type: 'container' | 'host_process' | string
  action_taken: string
  pid_targets: number[]
  container_owner?: Record<string, unknown>
  container_probe?: ServerPortContainerProbe
  released: boolean
  before?: ServerPortOccupancy
  after?: ServerPortOccupancy
}

// ─── SFTP operations ──────────────────────────────────────────────────────────

function terminalSftpBasePath(serverId: string): string {
  return `/api/terminal/sftp/${serverId}`
}

export async function sftpList(serverId: string, path: string): Promise<SFTPListResponse> {
  return pb.send<SFTPListResponse>(
    `${terminalSftpBasePath(serverId)}/list?path=${encodeURIComponent(path)}`,
    {}
  )
}

export function sftpDownloadUrl(serverId: string, path: string): string {
  return `${terminalSftpBasePath(serverId)}/download?path=${encodeURIComponent(path)}`
}

// sftpUpload uploads a single file to the given remote DIRECTORY.
// The backend appends the file's original name to form the final path.
export async function sftpUpload(serverId: string, remoteDir: string, file: File): Promise<void> {
  const formData = new FormData()
  formData.append('file', file)
  await pb.send(`${terminalSftpBasePath(serverId)}/upload?path=${encodeURIComponent(remoteDir)}`, {
    method: 'POST',
    body: formData,
  })
}

export async function sftpMkdir(serverId: string, path: string): Promise<void> {
  await pb.send(`${terminalSftpBasePath(serverId)}/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function sftpRename(
  serverId: string,
  oldPath: string,
  newPath: string
): Promise<void> {
  await pb.send(`${terminalSftpBasePath(serverId)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Backend expects { from, to } — matches routes/terminal.go handleSFTPRename
    body: JSON.stringify({ from: oldPath, to: newPath }),
  })
}

export async function sftpDelete(serverId: string, path: string): Promise<void> {
  await pb.send(`${terminalSftpBasePath(serverId)}/delete?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  })
}

export async function sftpReadFile(
  serverId: string,
  path: string
): Promise<{ path: string; content: string }> {
  return pb.send<{ path: string; content: string }>(
    `${terminalSftpBasePath(serverId)}/read?path=${encodeURIComponent(path)}`,
    {}
  )
}

export async function sftpWriteFile(
  serverId: string,
  path: string,
  content: string
): Promise<void> {
  await pb.send(`${terminalSftpBasePath(serverId)}/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  })
}

export async function sftpSearch(
  serverId: string,
  basePath: string,
  query: string
): Promise<SFTPSearchResponse> {
  return pb.send<SFTPSearchResponse>(
    `${terminalSftpBasePath(serverId)}/search?path=${encodeURIComponent(basePath)}&query=${encodeURIComponent(query)}`,
    {}
  )
}

export async function sftpConstraints(serverId: string): Promise<{ max_upload_files: number }> {
  return pb.send<{ max_upload_files: number }>(`${terminalSftpBasePath(serverId)}/constraints`, {})
}

export async function sftpStat(serverId: string, path: string): Promise<{ attrs: FileAttrs }> {
  return pb.send<{ attrs: FileAttrs }>(
    `${terminalSftpBasePath(serverId)}/stat?path=${encodeURIComponent(path)}`,
    {}
  )
}

export async function sftpChmod(
  serverId: string,
  path: string,
  mode: string,
  recursive = false
): Promise<void> {
  await pb.send(`${terminalSftpBasePath(serverId)}/chmod`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, mode, recursive }),
  })
}

export async function sftpChown(
  serverId: string,
  path: string,
  owner: string,
  group: string
): Promise<void> {
  await pb.send(`${terminalSftpBasePath(serverId)}/chown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, owner, group }),
  })
}

export async function sftpSymlink(
  serverId: string,
  target: string,
  linkPath: string
): Promise<void> {
  await pb.send(`${terminalSftpBasePath(serverId)}/symlink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, link_path: linkPath }),
  })
}

export async function sftpCopy(serverId: string, from: string, to: string): Promise<void> {
  await pb.send(`${terminalSftpBasePath(serverId)}/copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })
}

export async function sftpMove(serverId: string, from: string, to: string): Promise<void> {
  await pb.send(`${terminalSftpBasePath(serverId)}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  })
}

export function sftpCopyStreamUrl(serverId: string, from: string, to: string): string {
  return `${terminalSftpBasePath(serverId)}/copy-stream?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
}

// ─── Server list ──────────────────────────────────────────────────────────────

export async function listServers(): Promise<Server[]> {
  const result = await pb.collection('servers').getFullList<Server>({ sort: 'name' })
  return result
}

// ─── Server ops (Story 15.5) ─────────────────────────────────────────────────

export async function serverPower(serverId: string, action: 'restart' | 'shutdown'): Promise<void> {
  await pb.send(`/api/servers/${serverId}/ops/power`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
}

export async function listServerPorts(
  serverId: string,
  view: ServerPortView = 'all',
  protocol: ServerPortProtocol = 'tcp'
): Promise<ServerPortsResponse> {
  return pb.send<ServerPortsResponse>(
    `/api/servers/${serverId}/ops/ports?view=${encodeURIComponent(view)}&protocol=${encodeURIComponent(protocol)}`,
    {}
  )
}

export async function releaseServerPort(
  serverId: string,
  port: number,
  protocol: ServerPortProtocol = 'tcp',
  mode: 'graceful' | 'force' = 'graceful'
): Promise<ReleaseServerPortResponse> {
  return pb.send<ReleaseServerPortResponse>(
    `/api/servers/${serverId}/ops/ports/${port}/release?protocol=${encodeURIComponent(protocol)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }
  )
}

export async function listSystemdServices(
  serverId: string,
  keyword = ''
): Promise<SystemdService[]> {
  const query = keyword.trim() ? `?keyword=${encodeURIComponent(keyword.trim())}` : ''
  const response = await pb.send<{ services?: SystemdService[] }>(
    `/api/servers/${serverId}/ops/systemd/services${query}`,
    {}
  )
  return Array.isArray(response?.services) ? response.services : []
}

export async function getSystemdStatus(
  serverId: string,
  service: string
): Promise<SystemdStatusResponse> {
  return pb.send<SystemdStatusResponse>(
    `/api/servers/${serverId}/ops/systemd/${encodeURIComponent(service)}/status`,
    {}
  )
}

export async function getSystemdLogs(
  serverId: string,
  service: string,
  lines = 200
): Promise<SystemdLogsResponse> {
  return pb.send<SystemdLogsResponse>(
    `/api/servers/${serverId}/ops/systemd/${encodeURIComponent(service)}/logs?lines=${Math.max(20, Math.min(1000, lines))}`,
    {}
  )
}

export async function getSystemdContent(
  serverId: string,
  service: string
): Promise<SystemdContentResponse> {
  return pb.send<SystemdContentResponse>(
    `/api/servers/${serverId}/ops/systemd/${encodeURIComponent(service)}/content`,
    {}
  )
}

export async function controlSystemdService(
  serverId: string,
  service: string,
  action: SystemdControlAction
): Promise<void> {
  await pb.send(
    `/api/servers/${serverId}/ops/systemd/${encodeURIComponent(service)}/action`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }
  )
}

export async function getSystemdUnit(
  serverId: string,
  service: string
): Promise<SystemdUnitResponse> {
  return pb.send<SystemdUnitResponse>(
    `/api/servers/${serverId}/ops/systemd/${encodeURIComponent(service)}/unit`,
    {}
  )
}

export async function updateSystemdUnit(
  serverId: string,
  service: string,
  content: string
): Promise<SystemdUnitApplyResponse> {
  return pb.send<SystemdUnitApplyResponse>(
    `/api/servers/${serverId}/ops/systemd/${encodeURIComponent(service)}/unit`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }
  )
}

export async function verifySystemdUnit(
  serverId: string,
  service: string
): Promise<SystemdUnitApplyResponse> {
  return pb.send<SystemdUnitApplyResponse>(
    `/api/servers/${serverId}/ops/systemd/${encodeURIComponent(service)}/unit/verify`,
    { method: 'POST' }
  )
}

export async function applySystemdUnit(
  serverId: string,
  service: string
): Promise<SystemdUnitApplyResponse> {
  return pb.send<SystemdUnitApplyResponse>(
    `/api/servers/${serverId}/ops/systemd/${encodeURIComponent(service)}/unit/apply`,
    { method: 'POST' }
  )
}

// ─── Server connectivity check ────────────────────────────────────────────────

export interface ServerStatusResult {
  status: 'online' | 'offline'
  reason?: string
}

async function withTimeout<T>(task: Promise<T>, timeoutMs = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Ping timeout after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Checks whether a server is online by pinging the appropriate endpoint.
 * Handles both 'direct' and 'tunnel' connect types with a 5s timeout.
 */
export async function checkServerStatus(server: Server): Promise<ServerStatusResult> {
  const id = String(server.id)
  const connectType = String(server.connect_type || 'direct').toLowerCase()

  try {
    const mode = connectType === 'tunnel' ? 'tunnel' : 'tcp'
    const response = await withTimeout(
      pb.send(`/api/servers/${id}/ops/connectivity?mode=${encodeURIComponent(mode)}`, {
        method: 'GET',
      }) as Promise<{
        status?: string
        reason?: string
      }>,
      5000
    )

    return {
      status: response?.status === 'online' ? 'online' : 'offline',
      reason: typeof response?.reason === 'string' ? response.reason : undefined,
    }
  } catch (error) {
    const timeoutMessage =
      error instanceof Error && /Ping timeout after\s*5000ms/i.test(error.message)
        ? 'Timed out after 5s. Server is not reachable.'
        : undefined
    return {
      status: 'offline',
      reason: timeoutMessage || (error instanceof Error ? error.message : 'server unreachable'),
    }
  }
}

// ─── Scripts ──────────────────────────────────────────────────────────────────

export interface Script {
  id: string
  name: string
  language: string
  code: string
  description?: string
  [key: string]: unknown
}

export async function listScripts(): Promise<Script[]> {
  const result = await pb.collection('scripts').getFullList<Script>({ sort: 'name' })
  return result
}

export interface ConnectTerminalSettings {
  idleTimeoutSeconds: number
  maxConnections: number
}

const DEFAULT_CONNECT_TERMINAL_SETTINGS: ConnectTerminalSettings = {
  idleTimeoutSeconds: 1800,
  maxConnections: 0,
}

export async function getConnectTerminalSettings(): Promise<ConnectTerminalSettings> {
  try {
    const response = (await pb.send(settingsEntryPath('connect-terminal'), {
      method: 'GET',
    })) as { value?: Partial<ConnectTerminalSettings> }
    const terminal = response?.value ?? {}
    const idleTimeoutSeconds = Number(terminal.idleTimeoutSeconds)
    const maxConnections = Number(terminal.maxConnections)
    return {
      idleTimeoutSeconds:
        Number.isFinite(idleTimeoutSeconds) && idleTimeoutSeconds >= 60
          ? Math.floor(idleTimeoutSeconds)
          : DEFAULT_CONNECT_TERMINAL_SETTINGS.idleTimeoutSeconds,
      maxConnections:
        Number.isFinite(maxConnections) && maxConnections >= 0
          ? Math.floor(maxConnections)
          : DEFAULT_CONNECT_TERMINAL_SETTINGS.maxConnections,
    }
  } catch {
    return { ...DEFAULT_CONNECT_TERMINAL_SETTINGS }
  }
}

// ─── WebSocket URL helper ─────────────────────────────────────────────────────

export function sshWebSocketUrl(serverId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/terminal/ssh/${serverId}`
}

export function dockerWebSocketUrl(containerId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/terminal/docker/${containerId}`
}

// ─── Preferences ──────────────────────────────────────────────────────────────

const PREFS_KEY = 'connect.preferences'

export interface ConnectPreferences {
  terminal_font_size: number
  terminal_scrollback: number
  sftp_show_hidden: boolean
  sftp_view_mode: 'list' | 'grid'
  connect_terminal_idle_timeout_seconds: number
  connect_terminal_max_connections: number
}

const DEFAULT_PREFS: ConnectPreferences = {
  terminal_font_size: 14,
  terminal_scrollback: 1000,
  sftp_show_hidden: false,
  sftp_view_mode: 'list',
  connect_terminal_idle_timeout_seconds: 1800,
  connect_terminal_max_connections: 0,
}

export function loadPreferences(): ConnectPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePreferences(prefs: Partial<ConnectPreferences>): void {
  const current = loadPreferences()
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...prefs }))
}
