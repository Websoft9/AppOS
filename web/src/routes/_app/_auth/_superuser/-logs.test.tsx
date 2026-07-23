import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let LogsPage: typeof import('./logs').LogsPage

const sendMock = vi.fn()

function interpolate(template: string, values?: Record<string, unknown>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values?.[key] ?? ''))
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'logsPage.title': 'Logs',
        'logsPage.description': 'Browse runtime and request logs.',
        'logsPage.actions.refresh': 'Refresh logs',
        'logsPage.actions.refreshAria': 'Refresh logs',
        'logsPage.filters.allLevels': 'All levels',
        'logsPage.filters.allStatus': 'All status',
        'logsPage.filters.noStatus': 'No status',
        'logsPage.filters.searchPlaceholder': 'Search logs',
        'logsPage.pagination.perPage': '{{count}} / page',
        'logsPage.pagination.previous': 'Previous page',
        'logsPage.pagination.next': 'Next page',
        'logsPage.table.time': 'Time',
        'logsPage.table.level': 'Level',
        'logsPage.table.messageUrl': 'Message / URL',
        'logsPage.table.status': 'Status',
        'logsPage.table.exec': 'Exec',
        'logsPage.table.loading': 'Loading...',
        'logsPage.table.empty': 'No log entries found.',
        'logsPage.row.messageLabel': 'message:',
      }
      const template = translations[key] || options?.defaultValue || key
      return interpolate(String(template), options)
    },
  }),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

describe('LogsPage', () => {
  beforeEach(() => {
    vi.useRealTimers()
    return import('./logs').then(module => {
      LogsPage = module.LogsPage
    })
  })

  beforeEach(() => {
    sendMock.mockReset()
    sendMock.mockImplementation(() =>
      Promise.resolve({
        page: 1,
        perPage: 20,
        totalItems: 3,
        totalPages: 3,
        items: [
          {
            id: 'log-1',
            created: '2026-04-21T12:00:00Z',
            level: 0,
            message: 'Newest request',
            data: { type: 'request', method: 'GET', url: '/health', status: 200, execTime: 22.5 },
          },
          {
            id: 'log-2',
            created: '2026-04-21T11:00:00Z',
            level: 8,
            message: 'Server error',
            data: { type: 'request', method: 'POST', url: '/deploy', status: 503, execTime: 3.5 },
          },
          {
            id: 'log-3',
            created: '2026-04-21T10:00:00Z',
            level: -4,
            message: 'Background note',
            data: { execTime: 11.1 },
          },
        ],
      })
    )
  })

  it('shows the simplified header and supports status filtering and time/exec sorting', async () => {
    render(<LogsPage />)

    expect(await screen.findByText('Logs')).toBeInTheDocument()
    expect(await screen.findByText('GET /health')).toBeInTheDocument()
    expect(screen.getByText('Browse runtime and request logs.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh logs' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search logs')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()

    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[1], { target: { value: '5xx' } })
    expect(screen.getByText('POST /deploy')).toBeInTheDocument()
    expect(screen.queryByText('GET /health')).not.toBeInTheDocument()

    fireEvent.change(selects[1], { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: /Exec/i }))

    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('POST /deploy')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Time/i }))
    fireEvent.click(screen.getByRole('button', { name: /Time/i }))

    const reorderedRows = screen.getAllByRole('row')
    expect(within(reorderedRows[1]).getByText('Background note')).toBeInTheDocument()

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalled()
    })
  })
})
