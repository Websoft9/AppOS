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

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      switch (key) {
        case 'hub.title':
          return 'Resources'
        case 'hub.subtitle':
          return 'Shared platform resources for where applications run, what they depend on, and how AppOS connects outward.'
        case 'hub.groupCount':
          return `${options?.count ?? 0} groups`
        case 'hub.addResource':
          return 'Add Resource'
        case 'hub.addNow':
          return 'Add now'
        case 'hub.refresh':
          return 'Refresh'
        case 'hub.dialogDescription':
          return 'Search for the resource you want, then jump into its list page with the create dialog open.'
        case 'hub.resourceSearchPlaceholder':
          return 'Search resources like mysql, webhook, OpenAI, or server...'
        case 'hub.noResourceMatches':
          return 'No matching resources found.'
        case 'hub.openFamily':
          return 'Open family'
        case 'hub.refreshingCount':
          return 'Refreshing count'
        case 'hub.itemsCount':
          return `${options?.count ?? 0} items`
        case 'hub.cancel':
          return 'Cancel'
        case 'sections.runtimeInfrastructure.title':
          return 'Runtime Infrastructure'
        case 'sections.runtimeInfrastructure.description':
          return 'Where applications run and the startup-critical dependencies they cannot run without.'
        case 'sections.externalIntegrations.title':
          return 'External Integrations'
        case 'sections.externalIntegrations.description':
          return 'How platform connects to AI providers, external platforms, APIs, and cloud services.'
        case 'resources.servers.title':
          return 'Servers'
        case 'resources.servers.description':
          return 'Linux hosts, SSH targets, and deployment nodes where workloads run.'
        case 'resources.servers.createDescription':
          return 'Linux hosts, SSH targets, and deployment nodes.'
        case 'resources.serviceInstances.title':
          return 'Runtime Instances'
        case 'resources.serviceInstances.description':
          return 'Runtime dependencies required for application startup, including database, cache, messaging, storage, traffic gateway, artifact, and model service instances.'
        case 'resources.serviceInstances.createDescription':
          return 'Runtime dependencies such as Postgres, Kafka, and S3-backed services.'
        case 'resources.serviceInstances.examples.database':
          return 'Database'
        case 'resources.serviceInstances.examples.cache':
          return 'Cache'
        case 'resources.serviceInstances.examples.queue':
          return 'Queue'
        case 'resources.serviceInstances.examples.objectStorage':
          return 'Object Storage'
        case 'resources.aiProviders.title':
          return 'AI Providers'
        case 'resources.aiProviders.description':
          return 'Hosted and local AI capability sources such as OpenAI, Anthropic, OpenRouter, and Ollama endpoints.'
        case 'resources.aiProviders.createDescription':
          return 'OpenAI, Anthropic, OpenRouter, Ollama, and similar AI providers.'
        case 'resources.aiProviders.examples.openai':
          return 'OpenAI'
        case 'resources.aiProviders.examples.anthropic':
          return 'Anthropic'
        case 'resources.aiProviders.examples.openrouter':
          return 'OpenRouter'
        case 'resources.aiProviders.examples.ollama':
          return 'Ollama'
        case 'resources.connectors.title':
          return 'External Services'
        case 'resources.connectors.description':
          return 'SMTP, DNS, webhook, MCP, proxy, registry, and other reusable external service connections.'
        case 'resources.connectors.createDescription':
          return 'SMTP, DNS, webhook, MCP, proxy, registry, and other reusable external services.'
        case 'resources.connectors.examples.restApi':
          return 'REST API'
        case 'resources.connectors.examples.webhook':
          return 'Webhook'
        case 'resources.connectors.examples.mcp':
          return 'MCP'
        case 'resources.connectors.examples.proxy':
          return 'Proxy'
        case 'resources.connectors.examples.smtp':
          return 'SMTP'
        case 'resources.connectors.examples.registry':
          return 'Registry'
        case 'resources.connectors.examples.dns':
          return 'DNS'
        case 'resources.platformAccounts.title':
          return 'Platform Accounts'
        case 'resources.platformAccounts.description':
          return 'AWS, Azure, Google Cloud, GitHub, Cloudflare, and similar platform identities.'
        case 'resources.platformAccounts.createDescription':
          return 'AWS, Azure, Google Cloud, GitHub, Cloudflare, and similar platforms.'
        case 'resources.platformAccounts.examples.cloudAccount':
          return 'Cloud Account'
        case 'resources.platformAccounts.examples.subscription':
          return 'Subscription'
        case 'resources.platformAccounts.examples.tenant':
          return 'Tenant'
        case 'resources.platformAccounts.examples.installation':
          return 'Installation'
        case 'dialog.title':
          return 'Add Resource'
        default:
          return key
      }
    },
  }),
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
      if (path === '/api/software/server-catalog') {
        return Promise.resolve({
          items: [
            { id: 'supported-1' },
            { id: 'supported-2' },
            { id: 'supported-3' },
            { id: 'supported-4' },
          ],
        })
      }
      if (path === '/api/connectors?kind=rest_api,webhook,mcp,proxy,smtp,registry,dns') {
        return Promise.resolve([{ id: 'conn-1' }, { id: 'conn-2' }, { id: 'conn-3' }])
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
        'Shared platform resources for where applications run, what they depend on, and how AppOS connects outward.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Runtime Infrastructure' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Shared Configuration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Software Delivery' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'External Integrations' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Additional Resources' })).not.toBeInTheDocument()

    expect(screen.getAllByText('Runtime Instances').length).toBeGreaterThan(0)
    expect(screen.queryByText('Shared Envs')).not.toBeInTheDocument()
    expect(screen.queryByText('Supported Software')).not.toBeInTheDocument()
    expect(screen.getAllByText('AI Providers').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Platform Accounts').length).toBeGreaterThan(0)
    expect(screen.getAllByText('External Services').length).toBeGreaterThan(0)
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
        'Runtime dependencies required for application startup, including database, cache, messaging, storage, traffic gateway, artifact, and model service instances.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Reusable shared configuration layers that support multiple applications.')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'Reusable shared environment sets and variables that can be mapped across apps.'
      )
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'How platform connects to AI providers, external platforms, APIs, and cloud services.'
      )
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
      expect(screen.getByRole('link', { name: '3 groups' })).toHaveAttribute('href', '/groups')
      expect(screen.getAllByText('3 items').length).toBeGreaterThan(0)
      expect(screen.getAllByText('2 items').length).toBeGreaterThan(0)
      expect(screen.getAllByText('2 items').length).toBeGreaterThan(0)
      expect(screen.getAllByText('1 items').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('Open family').length).toBeGreaterThan(0)

    expect(screen.getByRole('link', { name: /Servers/i })).toHaveAttribute(
      'href',
      '/resources/servers'
    )
    expect(screen.getByRole('link', { name: /Runtime Instances/i })).toHaveAttribute(
      'href',
      '/resources/service-instances'
    )
    expect(screen.queryByRole('link', { name: /Shared Envs/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Supported Software/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /AI Providers/i })).toHaveAttribute(
      'href',
      '/resources/ai-providers'
    )
    expect(screen.getByRole('link', { name: /External Services/i })).toHaveAttribute(
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

    await waitFor(() => {
      expect(screen.getByRole('link', { name: '3 groups' })).toHaveAttribute('href', '/groups')
    })
    expect(screen.getByRole('button', { name: /Add Resource/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add Resource/i }))

    const dialog = screen.getByRole('dialog')

    expect(within(dialog).getByRole('heading', { name: 'Add Resource' })).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Search for the resource you want, then jump into its list page with the create dialog open.'
      )
    ).toBeInTheDocument()
    expect(
      within(dialog).getByRole('textbox', {
        name: 'Search resources like mysql, webhook, OpenAI, or server...',
      })
    ).toBeInTheDocument()
    expect(within(dialog).queryByText('Runtime Infrastructure')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('External Integrations')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Servers')).toBeInTheDocument()
    expect(within(dialog).getByText('Runtime Instances')).toBeInTheDocument()
    expect(within(dialog).queryByText('Shared Envs')).toBeNull()
    expect(within(dialog).queryByText('Scripts')).toBeNull()
    expect(within(dialog).queryByText('Supported Software')).toBeNull()
    expect(within(dialog).getByText('AI Providers')).toBeInTheDocument()
    expect(within(dialog).getByText('External Services')).toBeInTheDocument()
    expect(within(dialog).getByText('Platform Accounts')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Linux hosts, SSH targets, and deployment nodes.')
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Runtime dependencies such as Postgres, Kafka, and S3-backed services.'
      )
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByText(
        'Reusable environment variable sets shared across apps and workflows.'
      )
    ).toBeNull()
    expect(
      within(dialog).getByText('OpenAI, Anthropic, OpenRouter, Ollama, and similar AI providers.')
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'AWS, Azure, Google Cloud, GitHub, Cloudflare, and similar platforms.'
      )
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Database')).toBeInTheDocument()
    expect(within(dialog).getByText('Cache')).toBeInTheDocument()
    expect(within(dialog).queryByText('Health Check')).toBeNull()
    expect(within(dialog).getAllByText('Add now').length).toBeGreaterThan(0)

    fireEvent.change(
      within(dialog).getByRole('textbox', {
        name: 'Search resources like mysql, webhook, OpenAI, or server...',
      }),
      { target: { value: 'mysql' } }
    )

    expect(within(dialog).getByText('Runtime Instances')).toBeInTheDocument()
    expect(within(dialog).queryByText('AI Providers')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('External Services')).not.toBeInTheDocument()

    const serviceInstanceCard = within(dialog).getByText('Runtime Instances').closest('button')

    expect(serviceInstanceCard).not.toBeNull()

    fireEvent.click(serviceInstanceCard as HTMLElement)

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/resources/service-instances',
      search: { create: '1' },
    })
  })
})
