export type ServerDetailTab = 'overview' | 'connection' | 'monitor' | 'docker' | 'runtime' | 'tunnel' | 'software'

export type ServerConnectionState =
  | 'not_configured'
  | 'awaiting_connection'
  | 'online'
  | 'paused'
  | 'needs_attention'

export type NormalizedConnectionStatus = 'online' | 'offline' | 'unknown'
export type NormalizedTunnelState = 'setup_required' | 'paused' | 'ready' | 'none'

export type ServerConnectionActionId =
  | 'open_terminal'
  | 'test_connection'
  | 'tunnel_setup'
  | 'edit_server'
  | 'view_connection'
  | 'view_details'
  | 'view_checklist'
  | 'restart'
  | 'shutdown'

export type ServerConnectionActionSpec = {
  id: ServerConnectionActionId
  label: string
  tab?: ServerDetailTab
}

export type ServerConnectionTimelineEvent = {
  label: string
  at: string
}

export type ServerConnectionPresentationSpec = {
  state: ServerConnectionState
  stateLabel: string
  reason: string
  modeLabel: 'Direct SSH' | 'Tunnel'
  accessStatus: NormalizedConnectionStatus
  tunnelState: NormalizedTunnelState
  endpointSummary: string
  identitySummary: string
  lastActivityLabel: string
  lastActivityAt: string
  primaryAction: ServerConnectionActionSpec
  primaryActionDescription: string
  secondaryActions: ServerConnectionActionSpec[]
  stateActions: ServerConnectionActionSpec[]
  toolActions: ServerConnectionActionSpec[]
  diagnostics: {
    latestCheckResult: string
    evidenceSource: string
    latestFailureReason: string
    latestTunnelCallbackOrHeartbeat: string
    pauseUntil: string
    currentReason: string
  }
  timeline: ServerConnectionTimelineEvent[]
}

export type ServerConnectionFacts = {
  connect_type?: unknown
  host?: unknown
  port?: unknown
  user?: unknown
  credential?: unknown
  credential_type?: unknown
  created?: unknown
  updated?: unknown
  connection?: unknown
  access?: unknown
  tunnel?: unknown
  access_status_override?: NormalizedConnectionStatus
}

type BackendConnectionState = ServerConnectionState

type BackendConnectionAggregate = {
  stateCode: BackendConnectionState | null
  reasonCode: string
  configReady: boolean | null
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function normalizePort(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null
  }

  return parsed
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return '—'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return String(value)
  }
  return parsed.toLocaleString()
}

function timelineEvent(label: string, at: unknown): ServerConnectionTimelineEvent | null {
  const formatted = formatTimestamp(at)
  if (formatted === '—') {
    return null
  }
  return { label, at: formatted }
}

function connectionStateLabel(state: ServerConnectionState): string {
  switch (state) {
    case 'not_configured':
      return 'Not Configured'
    case 'awaiting_connection':
      return 'Awaiting Connection'
    case 'online':
      return 'Online'
    case 'paused':
      return 'Paused'
    case 'needs_attention':
      return 'Needs Attention'
  }
}

function normalizeConnectionStatus(facts: ServerConnectionFacts): NormalizedConnectionStatus {
  if (facts.access_status_override === 'online' || facts.access_status_override === 'offline') {
    return facts.access_status_override
  }

  const access = asObject(facts.access)
  const raw = String(access?.status ?? '').toLowerCase()
  if (raw === 'available' || raw === 'online') return 'online'
  if (raw === 'unavailable' || raw === 'offline') return 'offline'
  return 'unknown'
}

function normalizeTunnelState(facts: ServerConnectionFacts): NormalizedTunnelState {
  if (String(facts.connect_type ?? '') !== 'tunnel') {
    return 'none'
  }

  const tunnel = asObject(facts.tunnel)
  const raw = String(tunnel?.state ?? '').toLowerCase()
  if (raw === 'setup_required' || raw === 'paused' || raw === 'ready') {
    return raw
  }

  const waiting = Boolean(tunnel?.waiting_for_first_connect)
  return waiting ? 'setup_required' : 'ready'
}

function normalizeBackendConnectionAggregate(facts: ServerConnectionFacts): BackendConnectionAggregate {
  const connection = asObject(facts.connection)
  const rawState = String(connection?.state_code ?? '').toLowerCase()
  const stateCode: BackendConnectionState | null =
    rawState === 'not_configured' ||
    rawState === 'awaiting_connection' ||
    rawState === 'online' ||
    rawState === 'paused' ||
    rawState === 'needs_attention'
      ? rawState
      : null

  return {
    stateCode,
    reasonCode: String(connection?.reason_code ?? '').trim(),
    configReady: typeof connection?.config_ready === 'boolean' ? connection.config_ready : null,
  }
}

function getLegacyConnectionState(facts: ServerConnectionFacts): ServerConnectionState {
  const isTunnel = String(facts.connect_type ?? '') === 'tunnel'
  const access = asObject(facts.access)
  const status = normalizeConnectionStatus(facts)
  const tunnelState = normalizeTunnelState(facts)

  if (isTunnel) {
    if (tunnelState === 'setup_required') return 'not_configured'
    if (tunnelState === 'paused') return 'paused'
    if (status === 'online') return 'online'
    if (String(access?.reason ?? '') === 'waiting_for_first_connect') return 'awaiting_connection'
    return 'needs_attention'
  }

  const hasConfig =
    String(facts.host ?? '').trim() !== '' &&
    normalizePort(facts.port) !== null &&
    String(facts.user ?? '').trim() !== '' &&
    String(facts.credential ?? '').trim() !== ''

  if (!hasConfig) return 'not_configured'
  if (status === 'online') return 'online'
  if (status === 'offline') return 'needs_attention'
  return 'awaiting_connection'
}

function getConnectionState(facts: ServerConnectionFacts): ServerConnectionState {
  const aggregate = normalizeBackendConnectionAggregate(facts)
  const override = facts.access_status_override

  if (aggregate.stateCode) {
    if (aggregate.stateCode !== 'not_configured' && aggregate.stateCode !== 'paused') {
      if (override === 'online') return 'online'
      if (override === 'offline') return 'needs_attention'
    }
    return aggregate.stateCode
  }

  if (aggregate.configReady === false) {
    return 'not_configured'
  }

  return getLegacyConnectionState(facts)
}

function reasonMessageFromCode(
  facts: ServerConnectionFacts,
  state: ServerConnectionState,
  reasonCode: string
): string {
  const isTunnel = String(facts.connect_type ?? '') === 'tunnel'

  if (state === 'not_configured') {
    return isTunnel ? 'Tunnel setup has not started.' : 'Complete SSH details before verification.'
  }
  if (state === 'awaiting_connection') {
    if (reasonCode === 'waiting_for_first_connect' && isTunnel) {
      return 'Waiting for the first tunnel callback.'
    }
    return 'Configuration is ready for verification.'
  }
  if (state === 'online') {
    return isTunnel ? 'Tunnel session is active.' : 'SSH access is reachable.'
  }
  if (state === 'paused') {
    return 'Reconnect is intentionally paused.'
  }
  if (reasonCode === 'tcp_connect_failed' || reasonCode === 'connectivity_check_failed') {
    return 'AppOS cannot reach this server.'
  }
  if (reasonCode === 'server_host_empty') return 'Server host is missing.'
  if (reasonCode === 'tunnel_offline') return 'Tunnel session is offline.'
  return 'This connection needs attention.'
}

function getConnectionReason(facts: ServerConnectionFacts, state: ServerConnectionState): string {
  const aggregate = normalizeBackendConnectionAggregate(facts)
  const access = asObject(facts.access)
  const tunnel = asObject(facts.tunnel)
  const reason = String(access?.reason ?? '')
  const isTunnel = String(facts.connect_type ?? '') === 'tunnel'

  if (aggregate.reasonCode !== '') {
    return reasonMessageFromCode(facts, state, aggregate.reasonCode)
  }

  if (state === 'not_configured') {
    return isTunnel ? 'Tunnel setup has not started.' : 'Complete SSH details before verification.'
  }
  if (state === 'awaiting_connection') {
    return isTunnel ? 'Waiting for the first tunnel callback.' : 'Configuration is ready for verification.'
  }
  if (state === 'online') {
    return isTunnel ? 'Tunnel session is active.' : 'SSH access is reachable.'
  }
  if (state === 'paused') {
    return 'Reconnect is intentionally paused.'
  }

  if (reason === 'tcp_connect_failed') return 'AppOS cannot reach this server.'
  if (reason === 'server_host_empty') return 'Server host is missing.'
  if (reason === 'tunnel_offline') return 'Tunnel session is offline.'

  return String(tunnel?.reason ?? '').trim() || 'This connection needs attention.'
}

function getPrimaryAction(facts: ServerConnectionFacts, state: ServerConnectionState): {
  primaryAction: ServerConnectionActionSpec
  primaryActionDescription: string
  secondaryActions: ServerConnectionActionSpec[]
  stateActions: ServerConnectionActionSpec[]
} {
  const isTunnel = String(facts.connect_type ?? '') === 'tunnel'

  const viewConnection: ServerConnectionActionSpec = { id: 'view_connection', label: 'View Connection', tab: 'connection' }
  const viewDetails: ServerConnectionActionSpec = { id: 'view_details', label: 'View Details', tab: 'overview' }
  const viewChecklist: ServerConnectionActionSpec = { id: 'view_checklist', label: 'View Checklist' }

  if (state === 'online') {
    return {
      primaryAction: { id: 'open_terminal', label: 'Open Terminal' },
      primaryActionDescription: 'The server is usable now. Open the remote workspace directly.',
      secondaryActions: [viewConnection, viewDetails],
      stateActions: [viewConnection, viewDetails],
    }
  }

  if (state === 'paused') {
    return {
      primaryAction: { id: 'tunnel_setup', label: 'Resume Access' },
      primaryActionDescription: 'Reconnect is paused. Review the tunnel setup and resume access.',
      secondaryActions: [viewConnection, viewChecklist],
      stateActions: [viewConnection, viewChecklist],
    }
  }

  if (state === 'not_configured') {
    return {
      primaryAction: isTunnel
        ? { id: 'tunnel_setup', label: 'Start Setup' }
        : { id: 'edit_server', label: 'Complete Setup' },
      primaryActionDescription: isTunnel
        ? 'Begin the tunnel setup flow so this server can call back to AppOS.'
        : 'Add or correct the required SSH fields before verification can run.',
      secondaryActions: isTunnel ? [viewConnection, viewChecklist] : [viewConnection, viewDetails],
      stateActions: isTunnel ? [viewConnection, viewChecklist] : [viewConnection, viewDetails],
    }
  }

  if (state === 'awaiting_connection') {
    return {
      primaryAction: isTunnel
        ? { id: 'tunnel_setup', label: 'Continue Setup' }
        : { id: 'test_connection', label: 'Test Connection' },
      primaryActionDescription: isTunnel
        ? 'The tunnel is prepared but still waiting for the first callback from the server.'
        : 'The SSH configuration looks ready. Run a verification check now.',
      secondaryActions: isTunnel ? [viewConnection, viewChecklist] : [viewConnection, viewDetails],
      stateActions: isTunnel ? [viewConnection, viewChecklist] : [viewConnection, viewDetails],
    }
  }

  return {
    primaryAction: isTunnel
      ? { id: 'view_connection', label: 'View Issue', tab: 'connection' }
      : { id: 'edit_server', label: 'Fix Configuration' },
    primaryActionDescription: isTunnel
      ? 'Inspect the latest tunnel failure evidence before taking recovery steps.'
      : 'The last check failed. Review the SSH configuration and correct the blocking issue.',
    secondaryActions: isTunnel ? [viewConnection, viewChecklist] : [viewConnection, viewDetails],
    stateActions: isTunnel ? [viewConnection, viewChecklist] : [viewConnection, viewDetails],
  }
}

function getEndpointSummary(facts: ServerConnectionFacts): string {
  if (String(facts.connect_type ?? '') === 'tunnel') {
    return 'via AppOS tunnel'
  }
  const host = String(facts.host ?? '').trim()
  if (!host) return '—'
  return host
}

function getIdentitySummary(facts: ServerConnectionFacts): string {
  const user = String(facts.user ?? '').trim() || '—'
  const credentialType =
    String(facts.credential_type ?? '').trim() ||
    (String(facts.connect_type ?? '') === 'tunnel' ? 'Tunnel' : 'Credential')
  return `${user} · ${credentialType}`
}

function getLastActivityAt(facts: ServerConnectionFacts): string {
  const access = asObject(facts.access)
  const tunnel = asObject(facts.tunnel)
  return String(access?.checked_at ?? tunnel?.last_seen ?? tunnel?.connected_at ?? '')
}

function buildTimeline(facts: ServerConnectionFacts): ServerConnectionTimelineEvent[] {
  const access = asObject(facts.access)
  const tunnel = asObject(facts.tunnel)
  const events = [
    timelineEvent('Server created', facts.created),
    facts.credential ? timelineEvent('Credential attached', facts.updated) : null,
    String(facts.connect_type ?? '') === 'tunnel' ? timelineEvent('Setup started', facts.created) : null,
    timelineEvent('Verification or callback observed', access?.checked_at ?? tunnel?.connected_at),
    timelineEvent('Last healthy seen', tunnel?.last_seen),
    timelineEvent('Pause window updated', tunnel?.pause_until),
    String(access?.reason ?? '').trim() !== '' ? timelineEvent('Last failure observed', access?.checked_at) : null,
    timelineEvent('Record updated', facts.updated),
  ].filter((event): event is ServerConnectionTimelineEvent => event !== null)

  const deduped: ServerConnectionTimelineEvent[] = []
  for (const event of events) {
    if (!deduped.some(existing => existing.label === event.label && existing.at === event.at)) {
      deduped.push(event)
    }
  }
  return deduped
}

export function getServerConnectionPresentation(
  facts: ServerConnectionFacts
): ServerConnectionPresentationSpec {
  const state = getConnectionState(facts)
  const reason = getConnectionReason(facts, state)
  const { primaryAction, primaryActionDescription, secondaryActions, stateActions } = getPrimaryAction(facts, state)
  const access = asObject(facts.access)
  const tunnel = asObject(facts.tunnel)
  const lastActivityAt = getLastActivityAt(facts)

  return {
    state,
    stateLabel: connectionStateLabel(state),
    reason,
    modeLabel: String(facts.connect_type ?? '') === 'tunnel' ? 'Tunnel' : 'Direct SSH',
    accessStatus: normalizeConnectionStatus(facts),
    tunnelState: normalizeTunnelState(facts),
    endpointSummary: getEndpointSummary(facts),
    identitySummary: getIdentitySummary(facts),
    lastActivityLabel: formatTimestamp(lastActivityAt),
    lastActivityAt,
    primaryAction,
    primaryActionDescription,
    secondaryActions,
    stateActions,
    toolActions: [
      { id: 'restart', label: 'Restart' },
      { id: 'shutdown', label: 'Shutdown' },
    ],
    diagnostics: {
      latestCheckResult: String(access?.status || 'unknown'),
      evidenceSource: String(access?.source || 'derived'),
      latestFailureReason: String(access?.reason || tunnel?.reason || '—'),
      latestTunnelCallbackOrHeartbeat: formatTimestamp(tunnel?.last_seen ?? tunnel?.connected_at),
      pauseUntil: formatTimestamp(tunnel?.pause_until),
      currentReason: reason,
    },
    timeline: buildTimeline(facts),
  }
}