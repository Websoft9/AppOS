import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLocalSoftwareComponent,
  getSoftwareComponent,
  getSoftwareOperation,
  invokeSoftwareAction,
  listLocalSoftwareComponents,
  listSoftwareCapabilities,
  listSoftwareComponents,
  listSoftwareOperations,
} from './software-api'

const sendMock = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

describe('listSoftwareOperations', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  it('fetches operations for a server without component filter', async () => {
    sendMock.mockResolvedValue({ items: [] })
    await expect(listSoftwareOperations('srv1')).resolves.toEqual([])
    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv1/software/operations', { method: 'GET' })
  })

  it('appends component query param when provided', async () => {
    const op = { id: 'op1', component_key: 'docker', phase: 'succeeded', terminal_status: 'success' }
    sendMock.mockResolvedValue({ items: [op] })
    const result = await listSoftwareOperations('srv1', 'docker')
    expect(result).toHaveLength(1)
    expect(sendMock).toHaveBeenCalledWith(
      '/api/servers/srv1/software/operations?component=docker',
      { method: 'GET' }
    )
  })

  it('returns empty array when items is missing from response', async () => {
    sendMock.mockResolvedValue({})
    await expect(listSoftwareOperations('srv1')).resolves.toEqual([])
  })
})

describe('listSoftwareComponents', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  it('fetches software components for a server', async () => {
    const component = {
      component_key: 'docker',
      label: 'Docker',
      target_type: 'server',
      template_kind: 'package',
      installed_state: 'installed',
      verification_state: 'healthy',
      available_actions: ['upgrade', 'verify'],
    }
    sendMock.mockResolvedValue({ items: [component] })
    await expect(listSoftwareComponents('srv1')).resolves.toEqual([component])
    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv1/software', { method: 'GET' })
  })

  it('returns empty array when items is missing from component response', async () => {
    sendMock.mockResolvedValue({})
    await expect(listSoftwareComponents('srv1')).resolves.toEqual([])
  })
})

describe('getSoftwareComponent', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  it('fetches one component by key', async () => {
    const component = {
      component_key: 'reverse-proxy',
      label: 'Reverse Proxy',
      target_type: 'server',
      template_kind: 'script',
      installed_state: 'unknown',
      verification_state: 'unknown',
      available_actions: ['install'],
    }
    sendMock.mockResolvedValue(component)
    await expect(getSoftwareComponent('srv1', 'reverse-proxy')).resolves.toEqual(component)
    expect(sendMock).toHaveBeenCalledWith(
      '/api/servers/srv1/software/reverse-proxy',
      { method: 'GET' }
    )
  })
})

describe('local software inventory', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  it('fetches local software components', async () => {
    const component = {
      component_key: 'appos',
      label: 'AppOS Backend',
      target_type: 'local',
      template_kind: 'binary',
      installed_state: 'installed',
      verification_state: 'healthy',
      available_actions: ['verify'],
    }
    sendMock.mockResolvedValue({ items: [component] })
    await expect(listLocalSoftwareComponents()).resolves.toEqual([component])
    expect(sendMock).toHaveBeenCalledWith('/api/software/local', { method: 'GET' })
  })

  it('fetches one local software component by key', async () => {
    const component = {
      component_key: 'docker',
      label: 'Docker CLI',
      target_type: 'local',
      template_kind: 'binary',
      installed_state: 'installed',
      verification_state: 'healthy',
      available_actions: ['verify'],
    }
    sendMock.mockResolvedValue(component)
    await expect(getLocalSoftwareComponent('docker')).resolves.toEqual(component)
    expect(sendMock).toHaveBeenCalledWith('/api/software/local/docker', { method: 'GET' })
  })
})

describe('listSoftwareCapabilities', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  it('fetches capability statuses for a server', async () => {
    const capability = {
      capability: 'containers',
      component_key: 'docker',
      installed_state: 'installed',
      ready: true,
      readiness: {
        ok: true,
        os_supported: true,
        privilege_ok: true,
        network_ok: true,
        dependency_ready: true,
      },
    }
    sendMock.mockResolvedValue({ items: [capability] })
    await expect(listSoftwareCapabilities('srv1')).resolves.toEqual([capability])
    expect(sendMock).toHaveBeenCalledWith('/api/servers/srv1/software/capabilities', { method: 'GET' })
  })

  it('returns empty array when items is missing from capability response', async () => {
    sendMock.mockResolvedValue({})
    await expect(listSoftwareCapabilities('srv1')).resolves.toEqual([])
  })
})

describe('getSoftwareOperation', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  it('fetches one operation by id', async () => {
    const op = {
      id: 'op1',
      server_id: 'srv1',
      component_key: 'docker',
      phase: 'succeeded',
      terminal_status: 'success',
    }
    sendMock.mockResolvedValue(op)
    await expect(getSoftwareOperation('srv1', 'op1')).resolves.toEqual(op)
    expect(sendMock).toHaveBeenCalledWith(
      '/api/servers/srv1/software/operations/op1',
      { method: 'GET' }
    )
  })
})

describe('invokeSoftwareAction', () => {
  beforeEach(() => {
    sendMock.mockReset()
  })

  it('posts to the component action endpoint and returns accepted response', async () => {
    const resp = { accepted: true, operation_id: 'op1', phase: 'accepted', message: 'queued' }
    sendMock.mockResolvedValue(resp)
    await expect(invokeSoftwareAction('srv1', 'docker', 'install')).resolves.toMatchObject({
      accepted: true,
      operation_id: 'op1',
    })
    expect(sendMock).toHaveBeenCalledWith(
      '/api/servers/srv1/software/docker/install',
      { method: 'POST' }
    )
  })

  it('encodes component keys that contain special characters', async () => {
    sendMock.mockResolvedValue({ accepted: true })
    await invokeSoftwareAction('srv1', 'reverse-proxy', 'verify')
    expect(sendMock).toHaveBeenCalledWith(
      '/api/servers/srv1/software/reverse-proxy/verify',
      { method: 'POST' }
    )
  })
})
