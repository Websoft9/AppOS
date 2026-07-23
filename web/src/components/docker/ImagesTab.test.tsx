import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ImagesTab } from './ImagesTab'

const sendMock = vi.fn()
const useQueryMock = vi.fn()
const invalidateQueriesMock = vi.fn()
const mockImages = [
  {
    ID: 'img-1',
    Repository: 'nginx',
    Tag: 'latest',
    Size: '123MB',
    CreatedSince: '2 weeks ago',
  },
  {
    ID: 'img-2',
    Repository: 'ghcr.io/websoft9/appos',
    Tag: '1.0.0',
    Size: '456MB',
    CreatedSince: '1 day ago',
  },
  {
    ID: 'img-3',
    Repository: 'localhost:5000/internal/agent',
    Tag: 'dev',
    Size: '78MB',
    CreatedSince: '3 hours ago',
  },
]
const mockContainers: Array<unknown> = []
const mockPullOperations: Array<unknown> = []

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: (...args: unknown[]) => useQueryMock(...args),
    useQueryClient: () => ({
      invalidateQueries: (...args: unknown[]) => invalidateQueriesMock(...args),
    }),
  }
})

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.defaultValue_other && typeof options?.count === 'number' && options.count !== 1) {
        return String(options.defaultValue_other).replace('{{count}}', String(options.count))
      }
      if (options?.defaultValue_one && options?.count === 1) {
        return String(options.defaultValue_one).replace('{{count}}', String(options.count))
      }
      if (options?.defaultValue) {
        return String(options.defaultValue).replace(/\{\{(\w+)\}\}/g, (_, name) =>
          String(options?.[name] ?? '')
        )
      }
      return key
    },
  }),
}))

vi.mock('@/components/ui/dropdown-menu', () => {
  let _radioOnValueChange: ((v: string) => void) | null = null
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuItem: ({
      children,
      onClick,
      onSelect,
      ...rest
    }: React.ComponentProps<'button'> & { onSelect?: () => void }) => (
      <button
        onClick={event => {
          onClick?.(event)
          onSelect?.()
        }}
        {...rest}
      >
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <div />,
    DropdownMenuRadioGroup: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode
      value?: string
      onValueChange?: (v: string) => void
    }) => {
      _radioOnValueChange = onValueChange ?? null
      return <div role="radiogroup">{children}</div>
    },
    DropdownMenuRadioItem: ({
      children,
      value,
      ...rest
    }: { children: React.ReactNode; value: string } & Omit<
      React.ComponentProps<'button'>,
      'value'
    >) => (
      <button role="radio" onClick={() => _radioOnValueChange?.(value)} {...rest}>
        {children}
      </button>
    ),
  }
})

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, ...rest }: React.ComponentProps<'button'>) => (
    <button {...rest}>{children}</button>
  ),
  AlertDialogCancel: ({ children, ...rest }: React.ComponentProps<'button'>) => (
    <button {...rest}>{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/docker/DockerTextDialog', () => ({
  DockerTextDialog: () => null,
}))

vi.mock('@/components/docker/DockerDependencyAlert', () => ({
  DockerDependencyAlert: () => null,
  getDockerDependencyIssue: () => null,
}))

function renderTab(props?: Partial<React.ComponentProps<typeof ImagesTab>>) {
  return render(
    <TooltipProvider>
      <ImagesTab serverId="srv-1" {...props} />
    </TooltipProvider>
  )
}

describe('ImagesTab pull history labels', () => {
  beforeEach(() => {
    sendMock.mockReset()
    useQueryMock.mockReset()
    invalidateQueriesMock.mockReset()
    localStorage.clear()
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const key = options.queryKey || []
      const scope = key[1]
      const subScope = key[3]

      if (scope === 'images') {
        return {
          data: mockImages,
          isLoading: false,
          error: null,
        }
      }

      if (scope === 'containers') {
        return {
          data: mockContainers,
          isLoading: false,
          error: null,
        }
      }

      if (scope === 'image-pull-operations' && (subScope === 'in_progress' || subScope === 'all')) {
        return {
          data: mockPullOperations,
          isLoading: false,
          error: null,
        }
      }

      return {
        data: mockPullOperations,
        isLoading: false,
        error: null,
      }
    })
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('uses the updated tab labels and removes redundant pending section copy', () => {
    const source = readFileSync('src/components/docker/ImagesTab.tsx', 'utf8')

    expect(source).toContain("t('images.history.pendingTab', { defaultValue: 'Pending' })")
    expect(source).toContain("t('images.history.historyTab', { defaultValue: 'History' })")
    expect(source).toContain("if (operation.phase === 'accepted') return 'Queued'")
    expect(source).toContain("return 'Pulling'")

    expect(source).not.toContain('<TabsTrigger value="pulling">Pulling</TabsTrigger>')
    expect(source).not.toContain('<TabsTrigger value="recents">Recents</TabsTrigger>')
    expect(source).not.toContain('Running now')
    expect(source).not.toContain('These pulls are actively downloading on the target server.')
    expect(source).not.toContain(
      'These pulls are waiting for an available pull slot on this server.'
    )
  })

  it('adds a registry column inferred from repository names', () => {
    const source = readFileSync('src/components/docker/ImagesTab.tsx', 'utf8')

    expect(source).toContain('function inferImageRegistry')
    expect(source).toContain("if (firstSegment === 'localhost') return firstSegment")
    expect(source).toContain("return 'docker.io'")
    expect(source).toContain('Registry')
  })

  it('renders inferred registry values and filters rows by registry', async () => {
    renderTab()

    expect(await screen.findByRole('button', { name: 'Filter by registry' })).toBeInTheDocument()
    const body = document.querySelector('tbody')
    if (!body) {
      throw new Error('expected images table body to be rendered')
    }

    await waitFor(() => {
      expect(within(body).getByText('docker.io')).toBeInTheDocument()
      expect(within(body).getByText('ghcr.io')).toBeInTheDocument()
      expect(within(body).getByText('localhost:5000')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('radio', { name: /ghcr\.io \(1\)/ }))

    await waitFor(() => {
      expect(screen.getAllByText('Registry: ghcr.io')).toHaveLength(2)
      expect(screen.getByText('ghcr.io/websoft9/appos')).toBeInTheDocument()
      expect(screen.queryByText('nginx')).not.toBeInTheDocument()
      expect(screen.queryByText('localhost:5000/internal/agent')).not.toBeInTheDocument()
    })

    const dataRows = within(body)
      .getAllByRole('row')
      .filter(row => within(row).queryByText('ghcr.io/websoft9/appos'))
    expect(dataRows).toHaveLength(1)
  })

  it('filters embedded workspace rows from an external name filter', async () => {
    renderTab({ embeddedInWorkspace: true, externalFilter: 'localhost:5000' })

    const body = document.querySelector('tbody')
    if (!body) {
      throw new Error('expected images table body to be rendered')
    }

    await waitFor(() => {
      expect(screen.getByText('Search: localhost:5000')).toBeInTheDocument()
      expect(within(body).getByText('localhost:5000/internal/agent')).toBeInTheDocument()
      expect(within(body).queryByText('nginx')).not.toBeInTheDocument()
      expect(within(body).queryByText('ghcr.io/websoft9/appos')).not.toBeInTheDocument()
    })
  })
})
