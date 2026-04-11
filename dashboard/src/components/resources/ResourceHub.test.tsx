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
    onClick,
  }: {
    children: React.ReactNode
    to: string
    className?: string
    onClick?: () => void
  }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}))

vi.mock('@/components/ui/popover', () => {
  function Popover({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }

  function PopoverTrigger({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }

  function PopoverContent({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) {
    return <div className={className}>{children}</div>
  }

  return { Popover, PopoverTrigger, PopoverContent }
})

vi.mock('@/components/ui/collapsible', () => {
  function Collapsible({
    children,
    open,
  }: {
    children: React.ReactNode
    open?: boolean
  }) {
    return <div data-open={open ? 'true' : 'false'}>{children}</div>
  }

  function CollapsibleTrigger({
    children,
  }: {
    children: React.ReactNode
  }) {
    return <div>{children}</div>
  }

  function CollapsibleContent({
    children,
  }: {
    children: React.ReactNode
  }) {
    return <div>{children}</div>
  }

  return { Collapsible, CollapsibleTrigger, CollapsibleContent }
})

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

    expect(
      screen.getByText(
        'Shared platform resources for where workloads run, what they depend on, and how AppOS connects outward.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('2 grouped areas')).toBeInTheDocument()
    expect(screen.getByText('4 canonical families')).toBeInTheDocument()
    expect(
      screen.getByText('Choose a destination first, then manage details inside that family.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('The hub stays orientation-first while counts refresh in the background.')
    ).toBeInTheDocument()
    expect(screen.getByText('Refreshing family counts...')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Runtime Infrastructure' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'External Integrations' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Additional Resources' })).not.toBeInTheDocument()

    expect(screen.getAllByText('Service Instances').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Platform Accounts').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Connectors').length).toBeGreaterThan(0)
    expect(
      screen.getByText('Linux hosts, SSH targets, and deployment nodes where workloads run.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Where applications run and the shared services they depend on.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Long-lived runtime services your apps depend on before or during deployment.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('How AppOS connects to external platforms, APIs, and cloud services.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'AWS, Azure, Google Cloud, GitHub, Cloudflare, and similar platform identities.'
      )
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(
        screen.getAllByText('3 items').length
      ).toBeGreaterThan(0)
      expect(
        screen.getAllByText('2 items').length
      ).toBeGreaterThan(0)
      expect(
        screen.getAllByText('1 items').length
      ).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('Open family').length).toBeGreaterThan(0)

    expect(screen.getByRole('link', { name: /Servers/i })).toHaveAttribute(
      'href',
      '/resources/servers'
    )
    expect(screen.getByRole('link', { name: /Service Instances/i })).toHaveAttribute(
      'href',
      '/resources/service-instances'
    )
    expect(screen.getByRole('link', { name: /Connectors/i })).toHaveAttribute(
      'href',
      '/resources/connectors'
    )
    expect(screen.getByRole('link', { name: /Platform Accounts/i })).toHaveAttribute(
      'href',
      '/resources/platform-accounts'
    )
  })

  it('shows intent-first create actions mapped to current routes', async () => {
    render(<ResourceHub />)

    expect(screen.getByRole('link', { name: /Resource Groups/i })).toHaveAttribute('href', '/groups')
    expect(screen.getByRole('button', { name: /Add Resource/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add Resource/i }))

    expect(screen.getByText('Choose a resource family')).toBeInTheDocument()
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
    expect(screen.getAllByText('Examples').length).toBeGreaterThan(0)

    fireEvent.click(screen.getAllByText('Examples')[0])

    expect(screen.getByText('Database')).toBeInTheDocument()
    expect(screen.getByText('Cache')).toBeInTheDocument()
    expect(screen.getByText('Model Service')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Register an application dependency'))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/resources/service-instances',
      search: { create: '1' },
    })
  })
})
