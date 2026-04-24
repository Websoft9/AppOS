import { describe, expect, it } from 'vitest'
import { getServerConnectionPresentation, type ServerConnectionFacts } from './server-connection-presentation'

type DecisionCase = {
  name: string
  facts: ServerConnectionFacts
  expected: {
    state: string
    reason: string
    primaryAction: string
    stateActions: string[]
    toolActions: string[]
  }
}

const baseDirectFacts: ServerConnectionFacts = {
  connect_type: 'direct',
  host: '10.0.0.1',
  port: 22,
  user: 'root',
  credential: 'secret-1',
  credential_type: 'Password',
  created: '2026-04-20T08:00:00Z',
  updated: '2026-04-21T09:00:00Z',
  connection: { state_code: 'awaiting_connection', reason_code: 'verification_pending', config_ready: true },
}

const baseTunnelFacts: ServerConnectionFacts = {
  connect_type: 'tunnel',
  user: 'root',
  credential: 'secret-1',
  credential_type: 'Password',
  created: '2026-04-20T08:00:00Z',
  updated: '2026-04-21T09:00:00Z',
  connection: { state_code: 'awaiting_connection', reason_code: 'waiting_for_first_connect', config_ready: true },
}

const cases: DecisionCase[] = [
  {
    name: 'direct incomplete setup',
    facts: {
      ...baseDirectFacts,
      host: '',
      credential: '',
      connection: { state_code: 'not_configured', reason_code: 'config_incomplete', config_ready: false },
      access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
    },
    expected: {
      state: 'not_configured',
      reason: 'Complete SSH details before verification.',
      primaryAction: 'Complete Setup',
      stateActions: ['View Connection', 'View Details'],
      toolActions: ['Restart', 'Shutdown'],
    },
  },
  {
    name: 'direct awaiting verification',
    facts: {
      ...baseDirectFacts,
      connection: { state_code: 'awaiting_connection', reason_code: 'verification_pending', config_ready: true },
      access: { status: 'unknown', reason: '', checked_at: '', source: 'derived' },
    },
    expected: {
      state: 'awaiting_connection',
      reason: 'Configuration is ready for verification.',
      primaryAction: 'Test Connection',
      stateActions: ['View Connection', 'View Details'],
      toolActions: ['Restart', 'Shutdown'],
    },
  },
  {
    name: 'direct online',
    facts: {
      ...baseDirectFacts,
      connection: { state_code: 'online', reason_code: '', config_ready: true },
      access: { status: 'available', reason: '', checked_at: '2026-04-22T10:00:00Z', source: 'tcp_probe' },
    },
    expected: {
      state: 'online',
      reason: 'SSH access is reachable.',
      primaryAction: 'Open Terminal',
      stateActions: ['View Connection', 'View Details'],
      toolActions: ['Restart', 'Shutdown'],
    },
  },
  {
    name: 'direct unreachable',
    facts: {
      ...baseDirectFacts,
      connection: { state_code: 'needs_attention', reason_code: 'tcp_connect_failed', config_ready: true },
      access: { status: 'unavailable', reason: 'tcp_connect_failed', checked_at: '2026-04-22T10:00:00Z', source: 'tcp_probe' },
    },
    expected: {
      state: 'needs_attention',
      reason: 'AppOS cannot reach this server.',
      primaryAction: 'Fix Configuration',
      stateActions: ['View Connection', 'View Details'],
      toolActions: ['Restart', 'Shutdown'],
    },
  },
  {
    name: 'tunnel setup required',
    facts: {
      ...baseTunnelFacts,
      connection: { state_code: 'not_configured', reason_code: 'tunnel_setup_required', config_ready: true },
      access: { status: 'unavailable', reason: 'waiting_for_first_connect', checked_at: '', source: 'tunnel_runtime' },
      tunnel: { state: 'setup_required', status: 'offline', waiting_for_first_connect: true, services: [] },
    },
    expected: {
      state: 'not_configured',
      reason: 'Tunnel setup has not started.',
      primaryAction: 'Start Setup',
      stateActions: ['View Connection', 'View Checklist'],
      toolActions: ['Restart', 'Shutdown'],
    },
  },
  {
    name: 'tunnel awaiting first callback',
    facts: {
      ...baseTunnelFacts,
      connection: { state_code: 'awaiting_connection', reason_code: 'waiting_for_first_connect', config_ready: true },
      access: { status: 'unavailable', reason: 'waiting_for_first_connect', checked_at: '', source: 'tunnel_runtime' },
      tunnel: { state: 'ready', status: 'offline', waiting_for_first_connect: true, services: [] },
    },
    expected: {
      state: 'awaiting_connection',
      reason: 'Waiting for the first tunnel callback.',
      primaryAction: 'Continue Setup',
      stateActions: ['View Connection', 'View Checklist'],
      toolActions: ['Restart', 'Shutdown'],
    },
  },
  {
    name: 'tunnel paused',
    facts: {
      ...baseTunnelFacts,
      connection: { state_code: 'paused', reason_code: 'paused', config_ready: true },
      access: { status: 'unavailable', reason: 'paused', checked_at: '2026-04-22T10:00:00Z', source: 'tunnel_runtime' },
      tunnel: { state: 'paused', status: 'paused', pause_until: '2026-04-23T10:00:00Z', reason: 'manual_pause', services: [] },
    },
    expected: {
      state: 'paused',
      reason: 'Reconnect is intentionally paused.',
      primaryAction: 'Resume Access',
      stateActions: ['View Connection', 'View Checklist'],
      toolActions: ['Restart', 'Shutdown'],
    },
  },
  {
    name: 'tunnel online',
    facts: {
      ...baseTunnelFacts,
      connection: { state_code: 'online', reason_code: '', config_ready: true },
      access: { status: 'available', reason: '', checked_at: '2026-04-22T10:00:00Z', source: 'tunnel_runtime' },
      tunnel: { state: 'ready', status: 'online', connected_at: '2026-04-22T10:00:00Z', last_seen: '2026-04-22T10:02:00Z', services: [] },
    },
    expected: {
      state: 'online',
      reason: 'Tunnel session is active.',
      primaryAction: 'Open Terminal',
      stateActions: ['View Connection', 'View Details'],
      toolActions: ['Restart', 'Shutdown'],
    },
  },
  {
    name: 'tunnel broken session',
    facts: {
      ...baseTunnelFacts,
      connection: { state_code: 'needs_attention', reason_code: 'tunnel_offline', config_ready: true },
      access: { status: 'unavailable', reason: 'tunnel_offline', checked_at: '2026-04-22T10:00:00Z', source: 'tunnel_runtime' },
      tunnel: { state: 'ready', status: 'offline', reason: 'session expired', waiting_for_first_connect: false, services: [] },
    },
    expected: {
      state: 'needs_attention',
      reason: 'Tunnel session is offline.',
      primaryAction: 'View Issue',
      stateActions: ['View Connection', 'View Checklist'],
      toolActions: ['Restart', 'Shutdown'],
    },
  },
]

describe('server connection presentation decision table', () => {
  it.each(cases)('$name', ({ facts, expected }) => {
    const presentation = getServerConnectionPresentation(facts)

    expect(presentation.state).toBe(expected.state)
    expect(presentation.reason).toBe(expected.reason)
    expect(presentation.primaryAction.label).toBe(expected.primaryAction)
    expect(presentation.stateActions.map(action => action.label)).toEqual(expected.stateActions)
    expect(presentation.toolActions.map(action => action.label)).toEqual(expected.toolActions)
  })

  it('lets local connection checks override aggregated online state', () => {
    const presentation = getServerConnectionPresentation({
      ...baseDirectFacts,
      connection: { state_code: 'online', reason_code: '', config_ready: true },
      access: { status: 'available', reason: '', checked_at: '2026-04-22T10:00:00Z', source: 'tcp_probe' },
      access_status_override: 'offline',
    })

    expect(presentation.state).toBe('needs_attention')
    expect(presentation.primaryAction.label).toBe('Fix Configuration')
  })
})