import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerPortsPanel } from './ServerPortsPanel'

const listServerPortsMock = vi.fn()
const releaseServerPortMock = vi.fn()

vi.mock('@/lib/connect-api', () => ({
  listServerPorts: (...args: unknown[]) => listServerPortsMock(...args),
  releaseServerPort: (...args: unknown[]) => releaseServerPortMock(...args),
}))

afterEach(() => {
  cleanup()
})

describe('ServerPortsPanel', () => {
  beforeEach(() => {
    listServerPortsMock.mockReset()
    releaseServerPortMock.mockReset()

    listServerPortsMock.mockResolvedValue({
      server_id: 'server-1',
      protocol: 'tcp',
      view: 'all',
      detected_at: '2026-05-09T09:00:00Z',
      ports: [
        {
          port: 8080,
          occupancy: {
            occupied: true,
            process: { name: 'nginx', pid: 101 },
            pids: [101, 102],
            listeners: [
              {
                state: 'LISTEN',
                local_address: '0.0.0.0:8080',
                peer_address: '*:*',
                raw: 'tcp LISTEN 0 128 0.0.0.0:8080 *:*',
                process: { name: 'nginx', pid: 101 },
                pids: [101, 102],
              },
            ],
          },
          reservation: {
            reserved: true,
            sources: [{ type: 'docker', confidence: 'high', matches: [] }],
            container_probe: { available: true, status: 'ok' },
          },
        },
        {
          port: 5432,
          occupancy: {
            occupied: false,
            listeners: [],
          },
          reservation: {
            reserved: true,
            sources: [{ type: 'compose', confidence: 'medium', matches: [] }],
            container_probe: { available: true, status: 'ok' },
          },
        },
        {
          port: 80,
          occupancy: {
            occupied: true,
            process: { name: 'apache', pid: 80 },
            pids: [80],
            listeners: [
              {
                state: 'LISTEN',
                local_address: '0.0.0.0:80',
                peer_address: '*:*',
                raw: 'tcp LISTEN 0 128 0.0.0.0:80 *:*',
                process: { name: 'apache', pid: 80 },
                pids: [80],
              },
            ],
          },
          reservation: {
            reserved: false,
            sources: [],
            container_probe: { available: true, status: 'ok' },
          },
        },
      ],
      total: 3,
      reservation_meta: {
        container_probe: { available: true, status: 'ok' },
      },
    })

    releaseServerPortMock.mockResolvedValue({
      server_id: 'server-1',
      port: 8080,
      protocol: 'tcp',
      mode: 'graceful',
      owner_type: 'host_process',
      action_taken: 'stopped process',
      pid_targets: [101],
      released: true,
    })
  })

  it('shows list and detail layout with empty selected-port state', async () => {
    render(<ServerPortsPanel serverId="server-1" />)

    await waitFor(() => {
      expect(listServerPortsMock).toHaveBeenCalledWith('server-1', 'all', 'tcp')
    })

    expect(screen.getByRole('heading', { name: 'Ports' })).toBeInTheDocument()
    expect(screen.getByText(/Review occupied and reserved ports/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh ports data' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Selected Port' })).toBeInTheDocument()
    expect(screen.getByText('Choose a port to inspect occupancy, reservation sources, and release options.')).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Port inventory' })
    expect(within(inventory).getByLabelText('Port protocol')).toBeInTheDocument()
    expect(within(inventory).getByPlaceholderText('Search')).toBeInTheDocument()
    expect(within(inventory).getByLabelText('Status filter')).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'All status (3)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Occupied (2)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Reserved (2)' })).toBeInTheDocument()
    expect(within(inventory).getByText('Total 3 ports, 2 occupied, 2 reserved.')).toBeInTheDocument()
    expect(within(inventory).getByText('1/1')).toBeInTheDocument()
    expect(within(inventory).getByRole('button', { name: /Port sorted ascending/i })).toBeInTheDocument()
    expect(within(inventory).getByRole('button', { name: /Status sortable/i })).toBeInTheDocument()
    expect(within(inventory).getByText('PIDs')).toBeInTheDocument()
    expect(within(inventory).getByRole('button', { name: /^80$/ })).toBeInTheDocument()
    expect(within(inventory).getByRole('button', { name: /^5432$/ })).toBeInTheDocument()
    expect(within(inventory).getByRole('button', { name: /^8080$/ })).toBeInTheDocument()
    expect(within(inventory).getByText('101, 102')).toBeInTheDocument()
    expect(within(inventory).getByRole('button', { name: /Port actions for 8080/i })).toBeInTheDocument()
  })

  it('filters the inventory and opens selected-port details', async () => {
    render(<ServerPortsPanel serverId="server-1" />)

    const inventory = await screen.findByRole('region', { name: 'Port inventory' })

    fireEvent.change(within(inventory).getByPlaceholderText('Search'), {
      target: { value: 'nginx' },
    })

    await waitFor(() => {
      expect(within(inventory).getByRole('button', { name: /^8080$/ })).toBeInTheDocument()
    })

    expect(within(inventory).queryByRole('button', { name: /^80$/ })).toBeNull()
    expect(within(inventory).getByRole('option', { name: 'All status (1)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Occupied (1)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Reserved (1)' })).toBeInTheDocument()

    fireEvent.click(within(inventory).getByRole('button', { name: /^8080$/ }))

    const detailSection = screen.getByRole('heading', { name: 'Selected Port' }).closest('section')
    if (!detailSection) {
      throw new Error('Expected selected port section')
    }

    expect(within(detailSection).getByText('Port:')).toBeInTheDocument()
    expect(within(detailSection).getByText('8080')).toBeInTheDocument()
    expect(within(detailSection).getByText('Protocol:')).toBeInTheDocument()
    expect(within(detailSection).getByText('TCP')).toBeInTheDocument()
    expect(within(detailSection).getByText('Status:')).toBeInTheDocument()
    expect(within(detailSection).getAllByText('Occupied').length).toBeGreaterThan(0)
    expect(within(detailSection).getByText('Process:')).toBeInTheDocument()
    expect(within(detailSection).getByText('nginx')).toBeInTheDocument()
    expect(within(detailSection).getByText('PIDs:')).toBeInTheDocument()
    expect(within(detailSection).getByText('101, 102')).toBeInTheDocument()
    expect(within(detailSection).getByText('Listeners')).toBeInTheDocument()
    expect(within(detailSection).getByText('0.0.0.0:8080')).toBeInTheDocument()
    expect(within(detailSection).getByText('Reservation Sources')).toBeInTheDocument()
    expect(within(detailSection).getByText('docker')).toBeInTheDocument()
    expect(within(detailSection).getByRole('button', { name: 'Release' })).toBeInTheDocument()

    fireEvent.change(within(inventory).getByLabelText('Status filter'), { target: { value: 'reserved' } })
    expect(within(inventory).getByRole('button', { name: /^8080$/ })).toBeInTheDocument()
    expect(within(inventory).queryByRole('button', { name: /^5432$/ })).toBeNull()
    expect(within(inventory).queryByRole('button', { name: /^80$/ })).toBeNull()
  })
})