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
        return Promise.resolve([{ id: 'cleanup', expression: '0 * * * *' }])
      }
      return Promise.resolve({ items: [] })
    })
  })

  it('renders the page heading with the refresh action aligned in the same header row', async () => {
    render(<SystemCronsContent />)

    expect(await screen.findByText('System Crons')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Native cron jobs registered in PocketBase. Manage schedules via PocketBase Admin.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh system crons' })).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/crons', { method: 'GET' })
    })
  })
})
