import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectorsPage } from './connectors'

const sendMock = vi.fn()
const getOneMock = vi.fn()
const createMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    ({ component }: { component: unknown }) =>
      component,
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode
    to: string
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      getOne: (...args: unknown[]) => getOneMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    }),
  },
}))

describe('ConnectorsPage', () => {
  beforeEach(() => {
    sendMock.mockReset()
    getOneMock.mockReset()
    createMock.mockReset()

    sendMock.mockImplementation((path: string) => {
      if (path === '/api/secrets/templates') {
        return Promise.resolve([{ id: 'single_value', label: 'Single Value' }])
      }
      if (path === '/api/connectors/templates') {
        return Promise.resolve([
          {
            id: 'generic-rest',
            kind: 'rest_api',
            title: 'Generic REST API',
            fields: [{ id: 'endpoint', label: 'Base URL', type: 'url', required: true }],
          },
          {
            id: 'generic-webhook',
            kind: 'webhook',
            title: 'Generic Webhook',
            fields: [{ id: 'endpoint', label: 'Webhook URL', type: 'url', required: true }],
          },
          {
            id: 'generic-mcp',
            kind: 'mcp',
            title: 'Generic MCP',
            fields: [{ id: 'endpoint', label: 'Server URL', type: 'url', required: true }],
          },
          {
            id: 'generic-smtp',
            kind: 'smtp',
            title: 'Generic SMTP',
            defaultAuthScheme: 'basic',
            fields: [
              { id: 'endpoint', label: 'SMTP Endpoint', type: 'string', required: true },
              { id: 'username', label: 'Username', type: 'string', required: true },
              { id: 'credential', label: 'Password Secret', type: 'secret_ref', required: true, secretTemplate: 'single_value' },
            ],
          },
          {
            id: 'ses-smtp',
            kind: 'smtp',
            title: 'Amazon SES SMTP',
            defaultEndpoint: 'smtp://email-smtp.us-east-1.amazonaws.com:587',
            defaultAuthScheme: 'basic',
            fields: [
              { id: 'endpoint', label: 'SMTP Endpoint', type: 'string', required: true },
              { id: 'username', label: 'Username', type: 'string', required: true },
              { id: 'credential', label: 'Password Secret', type: 'secret_ref', required: true, secretTemplate: 'single_value' },
              { id: 'region', label: 'AWS Region', type: 'string', placeholder: 'us-east-1' },
            ],
          },
          {
            id: 'generic-registry',
            kind: 'registry',
            title: 'Generic OCI Registry',
            defaultAuthScheme: 'basic',
            fields: [
              { id: 'endpoint', label: 'Registry URL', type: 'url', required: true },
              { id: 'username', label: 'Username', type: 'string', required: true },
              { id: 'credential', label: 'Password Secret', type: 'secret_ref', required: true, secretTemplate: 'single_value' },
            ],
          },
          {
            id: 'ghcr',
            kind: 'registry',
            title: 'GitHub Container Registry',
            defaultAuthScheme: 'basic',
            fields: [
              { id: 'endpoint', label: 'Registry URL', type: 'url', required: true },
              { id: 'username', label: 'Username', type: 'string', required: true },
              { id: 'credential', label: 'Password Secret', type: 'secret_ref', required: true, secretTemplate: 'single_value' },
            ],
          },
          {
            id: 'generic-dns',
            kind: 'dns',
            title: 'Generic DNS Provider',
            fields: [{ id: 'endpoint', label: 'API Endpoint', type: 'url', required: true }],
          },
          {
            id: 'cloudflare-dns',
            kind: 'dns',
            title: 'Cloudflare DNS',
            fields: [{ id: 'endpoint', label: 'API Endpoint', type: 'url', required: true }],
          },
        ])
      }
      if (path === '/api/connectors?kind=rest_api,webhook,mcp,smtp,registry,dns') {
        return Promise.resolve([])
      }
      if (path === '/api/collections/groups/records?perPage=500&sort=name') {
        return Promise.resolve({ items: [] })
      }
      if (
        path ===
        "/api/collections/secrets/records?filter=(status='active'%26%26(template_id='single_value'))&sort=name"
      ) {
        return Promise.resolve({
          items: [{ id: 'secret-1', name: 'smtp-password', template_id: 'single_value' }],
        })
      }
      return Promise.resolve({ items: [] })
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders connector profile options grouped by kind in the create dialog', async () => {
    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/connectors/templates', { method: 'GET' })
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const dialog = await screen.findByRole('dialog')
    const select = dialog.querySelector('select') as HTMLSelectElement | null
    if (!select) {
      throw new Error('expected profile select to be rendered')
    }

    const groups = Array.from(select.querySelectorAll('optgroup')).map(group => ({
      label: group.label,
      options: Array.from(group.querySelectorAll('option')).map(option =>
        option.textContent?.trim()
      ),
    }))

    expect(groups).toEqual([
      { label: 'REST API', options: ['Generic REST API'] },
      { label: 'Webhook', options: ['Generic Webhook'] },
      { label: 'MCP', options: ['Generic MCP'] },
      { label: 'SMTP', options: ['Generic SMTP', 'Amazon SES SMTP'] },
      { label: 'Registry', options: ['Generic OCI Registry', 'GitHub Container Registry'] },
      { label: 'DNS', options: ['Generic DNS Provider', 'Cloudflare DNS'] },
    ])

    fireEvent.change(select, { target: { value: 'ses-smtp' } })

    expect(select.value).toBe('ses-smtp')
    expect(within(dialog).getByText('AWS Region')).toBeInTheDocument()

    expect(within(dialog).getByText('Create Connector')).toBeInTheDocument()
  })

  it('loads relation options once when opening the create dialog', async () => {
    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    const initialGroupRequests = sendMock.mock.calls.filter(
      ([path]) => path === '/api/collections/groups/records?perPage=500&sort=name'
    )
    expect(initialGroupRequests).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByRole('dialog')

    await waitFor(() => {
      const groupRequests = sendMock.mock.calls.filter(
        ([path]) => path === '/api/collections/groups/records?perPage=500&sort=name'
      )
      expect(groupRequests).toHaveLength(2)
    })
  })

  it('lets the user jump to edit the selected secret from connector credentials', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)

    render(<ConnectorsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    const dialog = await screen.findByRole('dialog')
    const select = dialog.querySelector('select') as HTMLSelectElement | null
    if (!select) {
      throw new Error('expected profile select to be rendered')
    }

    fireEvent.change(select, { target: { value: 'ses-smtp' } })

    fireEvent.click(screen.getByRole('button', { name: 'Password Secret*' }))
    fireEvent.click(await screen.findByRole('button', { name: /smtp-password/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Secret' }))

    expect(openSpy).toHaveBeenCalledWith(
      'http://localhost:3000/secrets?id=secret-1&edit=secret-1',
      '_blank',
      'noopener,noreferrer'
    )

    openSpy.mockRestore()
  })
})
