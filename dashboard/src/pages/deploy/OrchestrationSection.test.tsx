import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { OrchestrationSection } from './OrchestrationSection'

const loadLibraryAppFilesMock = vi.fn()

vi.mock('@/lib/iac-api', () => ({
  iacLoadLibraryAppFiles: (...args: unknown[]) => loadLibraryAppFilesMock(...args),
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    collection: () => ({
      getFullList: vi.fn().mockResolvedValue([]),
    }),
  },
}))

describe('OrchestrationSection', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    loadLibraryAppFilesMock.mockReset()
    loadLibraryAppFilesMock.mockResolvedValue({ compose: 'services:\n  web:\n    image: nginx:alpine\n', env: '' })
  })

  function renderSection() {
    const setCompose = vi.fn()
    const setEnvVars = vi.fn()
    const setProjectName = vi.fn()
    const setSrcFiles = vi.fn()

    render(
      <TooltipProvider>
        <OrchestrationSection
          compose="services:\n  web:\n    image: nginx:alpine\n"
          setCompose={setCompose}
          envVars={[{ key: '', value: '' }]}
          setEnvVars={setEnvVars}
          projectName=""
          setProjectName={setProjectName}
          storeProducts={[
            { key: 'zulu', trademark: 'Zulu' },
            { key: 'alpha', trademark: 'Alpha' },
            { key: 'monkey', trademark: 'Monkey' },
          ]}
          srcFiles={[]}
          setSrcFiles={setSrcFiles}
          srcUploaded={[]}
        />
      </TooltipProvider>
    )
  }

  it('sorts app store templates from A to Z and supports explicit close', async () => {
    renderSection()

    fireEvent.click(screen.getByText('Compose File'))
    fireEvent.click(screen.getByRole('button', { name: 'Import from App Store' }))

    const menu = await screen.findByRole('menu')
    const productButtons = within(menu)
      .getAllByRole('button')
      .map(button => button.textContent?.trim())
      .filter((text): text is string => ['Alpha', 'Monkey', 'Zulu'].includes(text || ''))

    expect(productButtons).toEqual(['Alpha', 'Monkey', 'Zulu'])

    fireEvent.click(screen.getByRole('button', { name: 'Close import menu' }))

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('closes the app store menu when Escape is pressed', async () => {
    renderSection()

    fireEvent.click(screen.getByText('Compose File'))
    fireEvent.click(screen.getByRole('button', { name: 'Import from App Store' }))

    expect(await screen.findByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})