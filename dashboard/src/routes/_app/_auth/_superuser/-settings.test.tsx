import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extSettingsModulePath,
  TUNNEL_SETTINGS_API_PATH,
  SECRETS_SETTINGS_API_PATH,
  SETTINGS_API_PATH,
} from '@/lib/settings-api'
import { SettingsPage } from './settings'

const sendMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () =>
    (config: Record<string, unknown>) => ({
      ...config,
    }),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      create: vi.fn(),
    }),
  },
}))

describe('SettingsPage shared settings paths', () => {
  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path === SETTINGS_API_PATH) {
        return Promise.resolve({
          meta: { appName: 'AppOS', appURL: 'https://appos.test' },
          smtp: { enabled: false, host: '', port: 25, username: '', password: '', authMethod: '', tls: false, localName: '' },
          s3: { enabled: false, bucket: '', region: '', endpoint: '', accessKey: '', secret: '', forcePathStyle: false },
          logs: { maxDays: 7, minLevel: 5, logIP: false, logAuthId: false },
        })
      }
      if (path === extSettingsModulePath('space')) {
        return Promise.resolve({ quota: {} })
      }
      if (path === extSettingsModulePath('connect')) {
        return Promise.resolve({ terminal: {} })
      }
      if (path === extSettingsModulePath('deploy')) {
        return Promise.resolve({ preflight: { minFreeDiskBytes: 536870912 } })
      }
      if (path === TUNNEL_SETTINGS_API_PATH) {
        return Promise.resolve({ port_range: {} })
      }
      if (path === SECRETS_SETTINGS_API_PATH) {
        return Promise.resolve({ policy: {} })
      }
      if (path === extSettingsModulePath('proxy')) {
        return Promise.resolve({ network: {} })
      }
      if (path === extSettingsModulePath('docker')) {
        return Promise.resolve({ mirror: {}, registries: { items: [] } })
      }
      if (path === extSettingsModulePath('llm')) {
        return Promise.resolve({ providers: { items: [] } })
      }
      return Promise.resolve({})
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads system and extension settings via shared path helpers', async () => {
    render(<SettingsPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(SETTINGS_API_PATH, { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(extSettingsModulePath('space'), { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(extSettingsModulePath('connect'), { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(extSettingsModulePath('deploy'), { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(TUNNEL_SETTINGS_API_PATH, { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(SECRETS_SETTINGS_API_PATH, { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(extSettingsModulePath('proxy'), { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(extSettingsModulePath('docker'), { method: 'GET' })
      expect(sendMock).toHaveBeenCalledWith(extSettingsModulePath('llm'), { method: 'GET' })
    })
  })

  it('shows Tunnel under Workspace', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByText('Tunnel')).toBeInTheDocument()
      expect(sendMock).toHaveBeenCalledWith(TUNNEL_SETTINGS_API_PATH, { method: 'GET' })
    })
  })

  it('shows Deploy Preflight under Workspace', async () => {
    const { container } = render(<SettingsPage />)

    await waitFor(() => {
      const nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByText('Deploy Preflight')).toBeInTheDocument()
      expect(sendMock).toHaveBeenCalledWith(extSettingsModulePath('deploy'), { method: 'GET' })
    })
  })

  it('shows Secrets under System and renames the app group to Workspace', async () => {
    const { container } = render(<SettingsPage />)
    let nav: HTMLElement | null = null

    await waitFor(() => {
      nav = container.querySelector('nav') as HTMLElement | null
      expect(nav).toBeTruthy()
      const navQueries = within(nav as HTMLElement)
      expect(navQueries.getByText('System')).toBeInTheDocument()
      expect(navQueries.getByText('Workspace')).toBeInTheDocument()
      expect(navQueries.getByText('Secrets')).toBeInTheDocument()
    })

    expect(screen.queryByText('App')).not.toBeInTheDocument()

    if (!nav) {
      throw new Error('expected settings navigation to be rendered')
    }
    const navQueries = within(nav)
    const secretsButton = navQueries.getByRole('button', { name: 'Secrets' })
    const workspaceHeading = navQueries.getByText('Workspace')
    // DOCUMENT_POSITION_FOLLOWING means workspaceHeading appears *after*
    // secretsButton in DOM order, i.e. Secrets is listed before Workspace.
    expect(
      secretsButton.compareDocumentPosition(workspaceHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})