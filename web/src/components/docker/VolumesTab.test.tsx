import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VolumesTab } from './VolumesTab'

const sendMock = vi.fn()
const fileManagerPropsSpy = vi.fn()

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/components/connect/FileManagerPanel', () => ({
  FileManagerPanel: (props: unknown) => {
    fileManagerPropsSpy(props)
    return <div data-testid="file-manager-panel" />
  },
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
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
  DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioItem: ({ children, onClick, ...rest }: React.ComponentProps<'button'>) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}))

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <VolumesTab serverId="srv-1" />
    </QueryClientProvider>
  )
}

describe('VolumesTab', () => {
  beforeEach(() => {
    sendMock.mockReset()
    fileManagerPropsSpy.mockReset()
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/servers/srv-1/docker/volumes' && options?.method === 'GET') {
        return Promise.resolve({
          output: [
            JSON.stringify({
              Name: 'used-data',
              Driver: 'local',
              Mountpoint: '/var/lib/docker/volumes/used-data/_data',
            }),
            JSON.stringify({
              Name: 'unused-cache',
              Driver: 'local',
              Mountpoint: '/var/lib/docker/volumes/unused-cache/_data',
            }),
          ].join('\n'),
        })
      }

      if (path === '/api/servers/srv-1/docker/containers' && options?.method === 'GET') {
        return Promise.resolve({
          output: [
            JSON.stringify({
              ID: 'ctr-1',
              Names: 'demo-app',
            }),
          ].join('\n'),
        })
      }

      if (path === '/api/servers/srv-1/docker/containers/ctr-1' && options?.method === 'GET') {
        return Promise.resolve({
          output: JSON.stringify([
            {
              State: { Running: true },
              Mounts: [
                {
                  Name: 'used-data',
                  Type: 'volume',
                },
              ],
            },
          ]),
        })
      }

      if (path === '/api/servers/srv-1/docker/volumes/prune' && options?.method === 'POST') {
        return Promise.resolve({})
      }

      return Promise.reject(new Error(`Unexpected request: ${path}`))
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('reviews unused volumes and requires a confirmation phrase before prune', async () => {
    renderTab()

    const openButton = await screen.findByRole('button', { name: 'Prune unused' })
    await waitFor(() => expect(openButton).toBeEnabled())

    fireEvent.click(openButton)

    const dialogTitle = await screen.findByText('Review unused volumes')
    const dialog = dialogTitle.closest('[role="alertdialog"], [role="dialog"]') as HTMLElement
    expect(dialogTitle).toBeInTheDocument()
    expect(dialog).toBeTruthy()
    expect(within(dialog).getByText('1 unused volume will be removed.')).toBeInTheDocument()
    expect(within(dialog).getByText('unused-cache')).toBeInTheDocument()
    expect(within(dialog).queryByText('used-data')).toBeNull()

    const pruneButton = within(dialog).getByRole('button', { name: 'Prune' })
    expect(pruneButton).toBeDisabled()

    fireEvent.change(
      within(dialog).getByLabelText(/Type prune unused volumes to enable prune\./i),
      {
        target: { value: 'wrong phrase' },
      }
    )
    expect(pruneButton).toBeDisabled()

    fireEvent.change(
      within(dialog).getByLabelText(/Type prune unused volumes to enable prune\./i),
      {
        target: { value: 'prune unused volumes' },
      }
    )
    expect(pruneButton).toBeEnabled()

    fireEvent.click(pruneButton)

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/docker/volumes/prune', {
        method: 'POST',
      })
    })
  })

  it('opens a local volume files dialog with a locked root and live-volume warning', async () => {
    renderTab()

    const usedVolumeCell = await screen.findByText('used-data')
    const usedVolumeRow = usedVolumeCell.closest('tr') as HTMLElement
    fireEvent.click(within(usedVolumeRow).getByRole('button', { name: /open in files/i }))

    expect(await screen.findByText('Volume files')).toBeInTheDocument()
    expect(await screen.findByTestId('file-manager-panel')).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/servers/srv-1/docker/containers/ctr-1', {
        method: 'GET',
      })
    })

    await waitFor(() => {
      expect(screen.getByText(/Editing may affect the running app\./i)).toBeInTheDocument()
    })
    expect(screen.getByText(/demo-app/i)).toBeInTheDocument()

    expect(fileManagerPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        serverId: 'srv-1',
        initialPath: '/var/lib/docker/volumes/used-data/_data',
        lockedRootPath: '/var/lib/docker/volumes/used-data/_data',
        showCurrentPathInStatusBar: false,
      })
    )
  })
})
