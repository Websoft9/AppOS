import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ServiceInstancesPage } from './service-instances'

const sendMock = vi.fn()
const createSecretMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    ({ component }: { component: unknown }) =>
      component,
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: (name: string) => {
      if (name !== 'secrets') {
        throw new Error(`Unexpected collection: ${name}`)
      }
      return {
        create: (...args: unknown[]) => createSecretMock(...args),
      }
    },
  },
}))

describe('ServiceInstancesPage', () => {
  beforeEach(() => {
    sendMock.mockReset()
    createSecretMock.mockReset()
    createSecretMock.mockResolvedValue({ id: 'secret-created' })

    sendMock.mockImplementation(
      (path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
        if (path === '/api/instances/templates') {
          return Promise.resolve([
            {
              id: 'generic-mysql',
              category: 'database',
              kind: 'mysql',
              title: 'Generic MySQL',
              fields: [
                { id: 'database', label: 'Database', type: 'text', required: true },
                { id: 'username', label: 'Username', type: 'text', required: true },
                { id: 'connect_timeout', label: 'Connection Timeout', type: 'number', default: 10 },
                { id: 'ssl_enabled', label: 'Use SSL', type: 'boolean', default: false },
                { id: 'ssl_ca_certificate', label: 'SSL Root CA Certificate', type: 'text' },
              ],
            },
            {
              id: 'aurora-mysql',
              category: 'database',
              kind: 'mysql',
              title: 'Amazon Aurora MySQL',
              fields: [
                { id: 'region', label: 'Region', type: 'text' },
                { id: 'clusterIdentifier', label: 'Cluster Identifier', type: 'text' },
              ],
            },
            {
              id: 'generic-postgres',
              category: 'database',
              kind: 'postgres',
              title: 'Generic PostgreSQL',
              fields: [
                { id: 'database', label: 'Database', type: 'text', required: true },
                { id: 'username', label: 'Username', type: 'text', required: true },
                { id: 'connect_timeout', label: 'Connection Timeout', type: 'number', default: 10 },
                { id: 'ssl_enabled', label: 'Use SSL', type: 'boolean', default: false },
                { id: 'ssl_ca_certificate', label: 'SSL Root CA Certificate', type: 'text' },
              ],
            },
            {
              id: 'generic-redis',
              category: 'cache',
              kind: 'redis',
              title: 'Generic Redis',
              defaultEndpoint: 'redis.internal:6379',
              fields: [{ id: 'database', label: 'Database Index', type: 'number', default: 0 }],
            },
            {
              id: 'generic-kafka',
              category: 'message-queue',
              kind: 'kafka',
              title: 'Generic Kafka',
              defaultEndpoint: 'kafka.internal:9092',
              fields: [{ id: 'clusterId', label: 'Cluster ID', type: 'text' }],
            },
          ])
        }
        if (path === '/api/secrets/templates') {
          return Promise.resolve([
            {
              id: 'single_value',
              label: 'Single Value',
              fields: [{ key: 'value', label: 'Value', type: 'password', required: true }],
            },
          ])
        }
        if (path === '/api/instances' && (!options?.method || options.method === 'GET')) {
          return Promise.resolve([])
        }
        if (path === '/api/instances' && options?.method === 'POST') {
          return Promise.resolve({
            id: 'instance-created',
            name: options.body?.name ?? 'created-instance',
            kind: 'mysql',
            template_id: 'generic-mysql',
            endpoint: options.body?.endpoint ?? 'db.example.com:3306',
            provider_account: options.body?.provider_account ?? '',
            credential: options.body?.credential ?? 'secret-created',
            config: options.body?.config ?? {},
            description: options.body?.description ?? '',
          })
        }
        if (path === '/api/instances/reachability' && options?.method === 'POST') {
          const ids = Array.isArray(options.body?.ids) ? options.body.ids : []
          return Promise.resolve(ids.map(id => ({ id, status: 'online', latency_ms: 12 })))
        }
        if (path === '/api/provider-accounts') {
          return Promise.resolve([])
        }
        if (path.startsWith('/api/collections/secrets/records?filter=')) {
          return Promise.resolve({ items: [{ id: 'secret-1', name: 'db-password' }] })
        }
        if (path === '/api/collections/groups/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === '/api/collections/secrets/records?perPage=500&sort=name') {
          return Promise.resolve({ items: [] })
        }
        if (path === "/api/collections/certificates/records?filter=(status='active')&sort=name") {
          return Promise.resolve({ items: [{ id: 'cert-1', name: 'Demo CA' }] })
        }
        return Promise.resolve([])
      }
    )
  })

  afterEach(() => {
    cleanup()
  })

  it('opens a product picker before showing the selected service instance form', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/instances/templates', { method: 'GET' })
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await screen.findByRole('dialog')

    expect(screen.getByText('Choose a Product')).toBeInTheDocument()
    expect(screen.getByDisplayValue('')).toHaveAttribute(
      'placeholder',
      'Search products like MySQL, Redis, Aurora, PostgreSQL...'
    )
    expect(screen.getByText('MySQL')).toBeInTheDocument()
    expect(screen.getByText('Amazon Aurora MySQL')).toBeInTheDocument()

    fireEvent.change(
      screen.getByPlaceholderText('Search products like MySQL, Redis, Aurora, PostgreSQL...'),
      {
        target: { value: 'aurora' },
      }
    )

    expect(screen.getByText('Amazon Aurora MySQL')).toBeInTheDocument()
    expect(screen.queryByText('MySQL')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Amazon Aurora MySQL/i }))

    await waitFor(() => {
      expect(screen.getByText('Region')).toBeInTheDocument()
      expect(screen.getByText('Cluster Identifier')).toBeInTheDocument()
    })

    expect(screen.queryByText('Selected Product')).not.toBeInTheDocument()
    expect(
      screen.getByText('Create Amazon Aurora MySQL Databases Service Instance')
    ).toBeInTheDocument()
    expect(screen.getByText('Editable')).toBeInTheDocument()

    const formDialog = await screen.findByRole('dialog')
    expect(formDialog.className).toContain('sm:max-w-4xl')
  })

  it('renders a mysql-specific flow with header name editing and advanced optional fields', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: /^MySQL/i }))

    expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument()
    expect(screen.getByTitle('Edit title')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Database/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Username/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search secrets...')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Host/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Port/)).toBeInTheDocument()
    expect(screen.queryByText('Selected Product')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Select a Secret'))
    expect(screen.getByPlaceholderText('Search secrets...')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()

    expect(screen.queryByLabelText('Platform Account')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Connection Timeout/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))

    expect(screen.getByLabelText('Platform Account')).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Connection Timeout/)).toBeInTheDocument()
    expect(screen.getByLabelText('Use SSL')).toBeInTheDocument()
    expect(screen.queryByText('Optional connection, security, and organization settings.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Use SSL'))

    expect(await screen.findByLabelText('SSL Root CA Certificate')).toBeInTheDocument()
  })

  it('reuses the same database-family flow for postgresql', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: /^PostgreSQL/i }))

    expect(await screen.findByLabelText(/^Database/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Username/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Host/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Port/)).toHaveValue(5432)

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
    expect(screen.getByLabelText('Use SSL')).toBeInTheDocument()
  })

  it('creates a password secret inline for mysql', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: /^MySQL/i }))

    fireEvent.click(screen.getByText('Select a Secret'))
    fireEvent.click(screen.getByRole('button', { name: 'New Secret' }))

    expect(
      await screen.findByText(
        'Create a reusable password secret and attach it to this service instance.'
      )
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'mysql-prod-password' } })
    fireEvent.change(screen.getByLabelText('Value *'), { target: { value: 's3cr3t' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Secret' }))

    await waitFor(() => {
      expect(createSecretMock).toHaveBeenCalledWith({
        name: 'mysql-prod-password',
        description: '',
        template_id: 'single_value',
        scope: 'global',
        payload: { value: 's3cr3t' },
      })
    })
  })

  it('stores a generated password in secrets automatically when creating mysql', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: /^MySQL/i }))

    fireEvent.change(screen.getByLabelText(/^Database/), { target: { value: 'appdb' } })
    fireEvent.change(screen.getByLabelText(/^Username/), { target: { value: 'appuser' } })
    fireEvent.change(screen.getByLabelText(/^Host/), { target: { value: 'db.internal' } })
    fireEvent.change(screen.getByLabelText(/^Port/), { target: { value: '3306' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fill Password' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Create' }).at(-1) as HTMLElement)

    await waitFor(() => {
      expect(createSecretMock).toHaveBeenCalledWith(
        expect.objectContaining({
          template_id: 'single_value',
          scope: 'global',
        })
      )
    })

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/instances',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            credential: 'secret-created',
            endpoint: 'db.internal:3306',
          }),
        })
      )
    })
  })

  it('reuses the password-or-secret credential flow for redis and kafka kinds', async () => {
    render(<ServiceInstancesPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Redis/i }))

    expect(await screen.findByLabelText(/^Credential|^Password/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Select a Secret'))
    expect(screen.getByPlaceholderText('Search secrets...')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Kafka/i }))

    expect(await screen.findByLabelText(/^Credential/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Select a Secret'))
    expect(screen.getByPlaceholderText('Search secrets...')).toBeInTheDocument()
  })
})
