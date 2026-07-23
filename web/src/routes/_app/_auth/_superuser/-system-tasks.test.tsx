import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemCronsContent } from './system-tasks'

const translationMap: Record<string, string> = {
  'crons.title': 'Platform Crons',
  'crons.description':
    'Review platform scheduled jobs across PocketBase core tasks and AppOS platform tasks.',
  'crons.refreshAria': 'Refresh platform crons',
  'crons.table.type': 'Type',
  'crons.table.effectiveInterval': 'Effective Interval',
  'crons.status.success': 'Success',
  'crons.type.core': 'Core',
  'crons.type.platform': 'Platform',
  'common:refresh': 'Refresh',
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translationMap[key] ?? key,
  }),
}))

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
          { id: 'monitor_instance_reachability_checks', expression: '0 * * * *' },
        ])
      }
      if (path === '/api/settings/entries/monitor-scheduling') {
        return Promise.resolve({
          id: 'monitor-scheduling',
          value: {
            reachabilityIntervalMinutes: 60,
            metricsFreshnessIntervalMinutes: 1,
            controlReachabilityIntervalMinutes: 1,
            runtimeSnapshotIntervalMinutes: 1,
            credentialSweepIntervalMinutes: 5,
            appHealthIntervalMinutes: 1,
            factsPullIntervalMinutes: 15,
          },
        })
      }
      if (path === '/api/crons/monitor_instance_reachability_checks/logs') {
        return Promise.resolve({
          jobId: 'monitor_instance_reachability_checks',
          lastRun: '2026-07-08T01:00:00Z',
          lastStatus: 'success',
          lastDurationMs: 25,
          items: [],
        })
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
    expect(screen.getByText('Effective Interval')).toBeInTheDocument()
    expect(screen.getByText('Core')).toBeInTheDocument()
    expect(screen.getByText('Platform')).toBeInTheDocument()
    expect(await screen.findByText('60 min')).toBeInTheDocument()
    expect(await screen.findByText('Success')).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/crons', { method: 'GET' })
    })
  })

  it('falls back to parsed cron expressions when monitor scheduling settings are unavailable', async () => {
    sendMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path === '/api/crons') {
        return Promise.resolve([
          { id: 'feeds_poll', expression: '*/5 * * * *' },
          { id: 'monitor_instance_reachability_checks', expression: '0 * * * *' },
        ])
      }
      if (path === '/api/settings/entries/monitor-scheduling') {
        return Promise.reject(new Error('settings unavailable'))
      }
      if (path === '/api/crons/feeds_poll/logs') {
        return Promise.resolve({
          jobId: 'feeds_poll',
          lastRun: null,
          lastStatus: null,
          lastDurationMs: null,
          items: [],
        })
      }
      if (path === '/api/crons/monitor_instance_reachability_checks/logs') {
        return Promise.resolve({
          jobId: 'monitor_instance_reachability_checks',
          lastRun: null,
          lastStatus: null,
          lastDurationMs: null,
          items: [],
        })
      }
      return Promise.resolve({ items: [] })
    })

    render(<SystemCronsContent />)

    expect(await screen.findByText('60 min')).toBeInTheDocument()
    expect(await screen.findByText('5 min')).toBeInTheDocument()
  })
})
