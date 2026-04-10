import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResourceHub } from './ResourceHub'

const navigateMock = vi.fn()
const sendMock = vi.fn()
const getListMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
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

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  ),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
    collection: () => ({
      getList: (...args: unknown[]) => getListMock(...args),
    }),
  },
}))

describe('ResourceHub', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    sendMock.mockReset()
    getListMock.mockReset()

    getListMock.mockResolvedValue({ totalItems: 3 })
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/instances') {
        return Promise.resolve([{ id: 'db-1' }, { id: 'db-2' }])
      }
      if (path === '/api/provider-accounts') {
        return Promise.resolve([{ id: 'acct-1' }])
      }
      if (path === '/api/connectors?kind=rest_api,webhook,mcp,smtp,registry,dns') {
        return Promise.resolve([{ id: 'conn-1' }, { id: 'conn-2' }, { id: 'conn-3' }])
      }
      if (path === '/api/ext/resources/scripts') {
        return Promise.resolve([{ id: 'script-1' }])
      }
      return Promise.resolve([])
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders canonical hub sections and copy', async () => {
    render(<ResourceHub />)

    expect(screen.getByRole('heading', { name: 'Host Infrastructure' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Dependency Infrastructure' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Additional Resources' })).not.toBeInTheDocument()

    expect(screen.getAllByText('Service Instances').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Platform Accounts').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Connectors').length).toBeGreaterThan(0)
    expect(
      screen.getByText('Linux hosts, SSH targets, and deployment nodes where workloads run.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'MySQL, PostgreSQL, Redis, Kafka, S3 storage, and model services your apps depend on.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'AWS, Azure, Google Cloud, GitHub, Cloudflare, and similar platform identities.'
      )
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(
        screen.getAllByText((_, element) => element?.textContent === 'Servers(3)').length
      ).toBeGreaterThan(0)
      expect(
        screen.getAllByText((_, element) => element?.textContent === 'Service Instances(2)').length
      ).toBeGreaterThan(0)
      expect(
        screen.getAllByText((_, element) => element?.textContent === 'Platform Accounts(1)').length
      ).toBeGreaterThan(0)
    })
  })

  it('shows intent-first create actions mapped to current routes', async () => {
    render(<ResourceHub />)

    fireEvent.click(screen.getByRole('button', { name: /Add Resource/i }))

    expect(screen.getByText('Canonical families')).toBeInTheDocument()
    expect(screen.getByText('Add a deployment target')).toBeInTheDocument()
    expect(screen.getByText('Register an application dependency')).toBeInTheDocument()
    expect(screen.getByText('Configure an external connection')).toBeInTheDocument()
    expect(screen.getByText('Save a platform account')).toBeInTheDocument()
    expect(
      screen.getByText('MySQL, PostgreSQL, Redis, Kafka, S3 storage, and model services.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('AWS, Azure, Google Cloud, GitHub, Cloudflare, and similar platforms.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByText('Register an application dependency'))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/resources/service-instances',
      search: { create: '1' },
    })
  })
})
