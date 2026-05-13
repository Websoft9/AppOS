import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getConnectTerminalSettings,
  installMonitorAgent,
  listServerPorts,
  listSystemdServices,
} from './connect-api'
import { settingsEntryPath } from './settings-api'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

describe('getConnectTerminalSettings', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  it('loads connect terminal settings via the shared workspace helper path', async () => {
    sendMock.mockResolvedValue({
      value: {
        idleTimeoutSeconds: 900,
        maxConnections: 8,
      },
    })

    await expect(getConnectTerminalSettings()).resolves.toEqual({
      idleTimeoutSeconds: 900,
      maxConnections: 8,
    })

    expect(sendMock).toHaveBeenCalledWith(settingsEntryPath('connect-terminal'), {
      method: 'GET',
    })
  })

  it('falls back to defaults when the request fails', async () => {
    sendMock.mockRejectedValue(new Error('network down'))

    await expect(getConnectTerminalSettings()).resolves.toEqual({
      idleTimeoutSeconds: 1800,
      maxConnections: 0,
    })
  })

  it('sends apposBaseUrl when installing monitor agent', async () => {
    sendMock.mockResolvedValue({ status: 'installed' })

    await installMonitorAgent('srv-1', {
      apposBaseUrl: 'https://console.example.com:8443',
    })

    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/monitor-agent/install', {
      method: 'POST',
      body: { apposBaseUrl: 'https://console.example.com:8443' },
    })
  })

  it('disables PocketBase auto-cancellation for realtime SSH list requests', async () => {
    sendMock.mockResolvedValue({ services: [], ports: [] })

    await listSystemdServices('srv-1')
    await listServerPorts('srv-1', 'all', 'tcp')

    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/systemd/services', {
      requestKey: null,
    })
    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/ports?view=all&protocol=tcp', {
      requestKey: null,
    })
  })
})
