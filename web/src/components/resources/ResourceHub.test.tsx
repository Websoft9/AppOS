import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

vi.mock('@/components/ui/tooltip', () => {
  function Tooltip({ children }: { children: React.ReactNode }) {
    return <>{children}</>
  }

  function TooltipTrigger({ children }: { children: React.ReactNode }) {
    return <>{children}</>
  }

  function TooltipContent() {
    return null
  }

  return { Tooltip, TooltipTrigger, TooltipContent }
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
      if (path === '/api/ai-providers') {
        return Promise.resolve([{ id: 'provider-1' }, { id: 'provider-2' }])
      }
      if (path === '/api/provider-accounts') {
        return Promise.resolve([{ id: 'acct-1' }])
      }
      if (path === '/api/software/local') {
        return Promise.resolve({ items: [{ id: 'local-1' }, { id: 'local-2' }] })
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
        'Shared platform resources for where Applications run, what they depend on, and how AppOS connects outward.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('2 grouped areas')).toBeInTheDocument()
    expect(screen.getByText('6 canonical families')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Runtime Infrastructure' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'External Integrations' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Additional Resources' })).not.toBeInTheDocument()

    expect(screen.getAllByText('Service Instances').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Local Software').length).toBeGreaterThan(0)
    expect(screen.getAllByText('AI Providers').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Platform Accounts').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Connectors').length).toBeGreaterThan(0)
    expect(
      screen.getByText('Linux hosts, SSH targets, and deployment nodes where workloads run.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Where applications run and the startup-critical dependencies they cannot run without.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Runtime dependencies required for application startup, including databases, middleware, and storage instances such as MySQL, PostgreSQL, Redis, Kafka, and S3.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('AppOS-local runtime binaries and supervisord-managed components installed on this host.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('How platform connects to AI providers, external platforms, APIs, and cloud services.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Hosted and local AI capability sources such as OpenAI, Anthropic, OpenRouter, and Ollama endpoints.'
      )
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
    expect(screen.getByRole('link', { name: /Local Software/i })).toHaveAttribute(
      'href',
      '/resources/local-software'
    )
    expect(screen.getByRole('link', { name: /AI Providers/i })).toHaveAttribute(
      'href',
      '/resources/ai-providers'
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

    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByRole('heading', { name: 'Add Resource' })).toBeInTheDocument()
    expect(
      within(dialog).queryByText(/Choose the canonical resource family first/i)
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByText(
        'Where applications run and the startup-critical dependencies they cannot run without.'
      )
    ).not.toBeInTheDocument()
    expect(within(dialog).getByText('Runtime Infrastructure')).toBeInTheDocument()
    expect(within(dialog).getByText('External Integrations')).toBeInTheDocument()
    expect(within(dialog).getByText('Servers')).toBeInTheDocument()
    expect(within(dialog).getByText('Service Instances')).toBeInTheDocument()
    expect(within(dialog).getByText('Local Software')).toBeInTheDocument()
    expect(within(dialog).getByText('AI Providers')).toBeInTheDocument()
    expect(within(dialog).getByText('Connectors')).toBeInTheDocument()
    expect(within(dialog).getByText('Platform Accounts')).toBeInTheDocument()
    expect(within(dialog).getByText('Linux hosts, SSH targets, and deployment nodes.')).toBeInTheDocument()
    expect(
      within(dialog).getByText('MySQL, PostgreSQL, Redis, Kafka, and S3-backed application dependencies.')
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('Built-in runtimes, bundled binaries, and supervisord-managed services on the AppOS host.')
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('OpenAI, Anthropic, OpenRouter, Ollama, and similar AI providers.')
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText('AWS, Azure, Google Cloud, GitHub, Cloudflare, and similar platforms.')
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Database')).toBeInTheDocument()
    expect(within(dialog).getByText('Cache')).toBeInTheDocument()
    expect(within(dialog).getByText('Docker CLI')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Add Now/i })).toBeNull()

    const serviceInstanceCard = within(dialog)
      .getByText('Service Instances')
      .closest('button')

    expect(serviceInstanceCard).not.toBeNull()

    fireEvent.click(serviceInstanceCard as HTMLElement)

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/resources/service-instances',
      search: { create: '1' },
    })
  })
})
