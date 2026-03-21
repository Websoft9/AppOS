import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getConnectTerminalSettings } from './connect-api'
import { extSettingsModulePath } from './settings-api'

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
      terminal: {
        idleTimeoutSeconds: 900,
        maxConnections: 8,
      },
    })

    await expect(getConnectTerminalSettings()).resolves.toEqual({
      idleTimeoutSeconds: 900,
      maxConnections: 8,
    })

    expect(sendMock).toHaveBeenCalledWith(extSettingsModulePath('connect'), {
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
})