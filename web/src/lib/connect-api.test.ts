import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkServerStatus,
  deleteServerCronJob,
  disableServerCronJob,
  enableServerCronJob,
  getConnectTerminalSettings,
  installMonitorAgent,
  listServerCronJobs,
  listServerPorts,
  listSystemdServices,
  sftpConstraints,
  sftpList,
  sftpSearch,
  sftpStat,
  testServerCronJob,
  updateServerCronJob,
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
    sendMock.mockResolvedValue({ services: [], ports: [], items: [] })

    await listSystemdServices('srv-1')
    await listServerPorts('srv-1', 'all', 'tcp')
    await listServerCronJobs('srv-1')

    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/systemd/services', {
      requestKey: null,
    })
    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/ports?view=all&protocol=tcp', {
      requestKey: null,
    })
    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/cron/jobs', {
      requestKey: null,
    })
  })

  it('disables PocketBase auto-cancellation for SFTP reads used by the files panel', async () => {
    sendMock.mockResolvedValue({ entries: [], results: [], attrs: {}, max_upload_files: 10 })

    await sftpList('srv-1', '/var')
    await sftpSearch('srv-1', '/var', 'log')
    await sftpStat('srv-1', '/var/log')
    await sftpConstraints('srv-1')

    expect(sendMock).toHaveBeenCalledWith('/api/terminal/sftp/srv-1/list?path=%2Fvar', {
      requestKey: null,
    })
    expect(sendMock).toHaveBeenCalledWith('/api/terminal/sftp/srv-1/search?path=%2Fvar&query=log', {
      requestKey: null,
    })
    expect(sendMock).toHaveBeenCalledWith('/api/terminal/sftp/srv-1/stat?path=%2Fvar%2Flog', {
      requestKey: null,
    })
    expect(sendMock).toHaveBeenCalledWith('/api/terminal/sftp/srv-1/constraints', {
      requestKey: null,
    })
  })

  it('uses the expected cron mutation endpoints', async () => {
    sendMock.mockResolvedValue({ entryId: 'cron-1', deleted: true })

    await updateServerCronJob('srv-1', 'cron 1', {
      name: 'backup',
      schedule: '0 2 * * *',
      command: '/opt/bin/backup.sh',
      enabled: true,
      singleRunOnly: false,
    })
    await enableServerCronJob('srv-1', 'cron 1')
    await disableServerCronJob('srv-1', 'cron 1')
    await testServerCronJob('srv-1', 'cron 1')
    await deleteServerCronJob('srv-1', 'cron 1')

    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/cron/jobs/cron%201', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'backup',
        schedule: '0 2 * * *',
        command: '/opt/bin/backup.sh',
        enabled: true,
        singleRunOnly: false,
      }),
    })
    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/cron/jobs/cron%201/enable', {
      method: 'POST',
    })
    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/cron/jobs/cron%201/disable', {
      method: 'POST',
    })
    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/cron/jobs/cron%201/test', {
      method: 'POST',
    })
    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/cron/jobs/cron%201', {
      method: 'DELETE',
    })
  })

  it('uses SSH connectivity checks for direct servers', async () => {
    sendMock.mockResolvedValue({ status: 'online' })

    await expect(
      checkServerStatus({ id: 'srv-1', name: 'alpha', host: '10.0.0.1', connect_type: 'direct' })
    ).resolves.toEqual({ status: 'online', reason: undefined })

    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/ops/connectivity?mode=ssh', {
      method: 'GET',
    })
  })

  it('keeps tunnel connectivity checks on tunnel mode', async () => {
    sendMock.mockResolvedValue({ status: 'online' })

    await checkServerStatus({ id: 'srv-2', name: 'beta', host: '', connect_type: 'tunnel' })

    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-2/ops/connectivity?mode=tunnel', {
      method: 'GET',
    })
  })
})
