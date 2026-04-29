import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FilesPage } from './iac'

const sendMock = vi.fn()
const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => {
    const routeApi = {
      useSearch: () => ({}),
      useNavigate: () => navigateMock,
    }
    return (config: Record<string, unknown>) => Object.assign(routeApi, config)
  },
}))

vi.mock('@monaco-editor/react', () => ({
  default: ({ value }: { value: string }) => <div data-testid="monaco-editor">{value}</div>,
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

describe('FilesPage', () => {
  beforeEach(() => {
    sendMock.mockReset()
    navigateMock.mockReset()
    sendMock.mockImplementation((path: string) => {
      if (path.startsWith('/api/ext/iac?path=')) {
        return Promise.resolve({
          path: 'apps',
          entries: [
            { name: 'demo.yml', type: 'file', size: 10, modified_at: '2026-04-21T12:00:00Z' },
          ],
        })
      }
      return Promise.resolve({
        path: '',
        content: 'services: {}',
        size: 12,
        modified_at: '2026-04-21T12:00:00Z',
      })
    })
  })

  it('renders the orchestration files page header and refresh action', async () => {
    render(<FilesPage />)

    expect(screen.getByText('Orchestration Files')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Browse and edit AppOS orchestration files for apps, workflows, and templates.'
      )
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Refresh orchestration files' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh orchestration files' }))

    await waitFor(() => {
      expect(screen.getByText('Files')).toBeInTheDocument()
    })
  })
})
