import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SupportedSoftwarePage } from './SupportedSoftwarePage'

const listSupportedServerSoftwareMock = vi.fn()
const getSupportedServerSoftwareMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode
    to: string
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/software-api', () => ({
  listSupportedServerSoftware: (...args: unknown[]) => listSupportedServerSoftwareMock(...args),
  getSupportedServerSoftware: (...args: unknown[]) => getSupportedServerSoftwareMock(...args),
}))

describe('SupportedSoftwarePage', () => {
  beforeEach(() => {
    listSupportedServerSoftwareMock.mockReset()
    getSupportedServerSoftwareMock.mockReset()

    listSupportedServerSoftwareMock.mockResolvedValue([
      {
        component_key: 'docker',
        label: 'Docker',
        capability: 'container_runtime',
        template_kind: 'package',
        supported_actions: ['install', 'upgrade', 'verify'],
        description:
          'Docker is supported by AppOS for the container runtime capability using the package delivery template.',
      },
      {
        component_key: 'reverse-proxy',
        label: 'Nginx',
        capability: 'reverse_proxy',
        template_kind: 'package',
        supported_actions: ['install', 'upgrade', 'verify'],
        description:
          'Nginx is supported by AppOS for the reverse proxy capability using the package delivery template.',
      },
    ])
    getSupportedServerSoftwareMock.mockImplementation(async (componentKey: string) => {
      if (componentKey === 'reverse-proxy') {
        return {
          component_key: 'reverse-proxy',
          label: 'Nginx',
          capability: 'reverse_proxy',
          template_kind: 'package',
          supported_actions: ['install', 'upgrade', 'verify'],
          description:
            'Nginx is supported by AppOS for the reverse proxy capability using the package delivery template.',
        }
      }
      return {
        component_key: 'docker',
        label: 'Docker',
        capability: 'container_runtime',
        template_kind: 'package',
        supported_actions: ['install', 'upgrade', 'verify'],
        description:
          'Docker is supported by AppOS for the container runtime capability using the package delivery template.',
      }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders a read-only supported software catalog and points actions to servers', async () => {
    render(<SupportedSoftwarePage />)

    expect(screen.getByRole('link', { name: '< Resources' })).toHaveAttribute('href', '/resources')
    expect(screen.getByRole('heading', { name: 'Supported Software' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'Pick a software family to inspect what AppOS can deliver to connected servers.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh supported software' })).toBeInTheDocument()
    expect(
      screen.queryByText(
        /Lifecycle actions still belong to server-scoped software surfaces/i
      )
    ).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getAllByText('Docker').length).toBeGreaterThan(0)
    })

    expect(screen.getByAltText('Docker logo')).toBeInTheDocument()
    expect(screen.getByAltText('Nginx logo')).toBeInTheDocument()

    expect(screen.getByText('Capability')).toBeInTheDocument()
    expect(screen.getByText('Template')).toBeInTheDocument()
    expect(screen.getByText('Supported Actions')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Detail' }).length).toBeGreaterThan(0)
  })

  it('loads detail in a drawer when another supported software entry is selected', async () => {
    render(<SupportedSoftwarePage />)

    await waitFor(() => {
      expect(screen.getByText('Nginx')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Detail' })[1])

    await waitFor(() => {
      expect(screen.getByText('Read-only delivery metadata for the selected supported software entry.')).toBeInTheDocument()
      expect(screen.getByText('Mapped capability')).toBeInTheDocument()
      expect(screen.getByText(/reverse proxy capability/i)).toBeInTheDocument()
    })

    expect(screen.getAllByAltText('Nginx logo').length).toBeGreaterThan(1)
  })
})
