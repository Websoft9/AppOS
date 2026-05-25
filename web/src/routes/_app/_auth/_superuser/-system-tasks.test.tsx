import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemCronsContent } from './system-tasks'

const sendMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetClose: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('SystemCronsContent', () => {
  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/crons') {
        return Promise.resolve([
          { id: '__pb_logs_cleanup__', expression: '0 0 * * *' },
          { id: 'monitor_reachability_checks', expression: '*/1 * * * *' },
        ])
      }
      return Promise.resolve({ items: [] })
    })
  })

  it('renders the page heading with the refresh action aligned in the same header row', async () => {
    render(<SystemCronsContent />)

    expect(await screen.findByText('Platform Crons')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Review platform scheduled jobs across PocketBase core tasks and AppOS platform tasks.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh platform crons' })).toBeInTheDocument()

    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByText('Core')).toBeInTheDocument()
    expect(screen.getByText('Platform')).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/crons', { method: 'GET' })
    })
  })
})
