import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerServicesPanel } from './ServerServicesPanel'

const listSystemdServicesMock = vi.fn()
const getSystemdStatusMock = vi.fn()
const getSystemdLogsMock = vi.fn()
const getSystemdContentMock = vi.fn()
const getSystemdUnitMock = vi.fn()
const updateSystemdUnitMock = vi.fn()
const verifySystemdUnitMock = vi.fn()
const applySystemdUnitMock = vi.fn()
const controlSystemdServiceMock = vi.fn()

vi.mock('@/lib/connect-api', () => ({
  listSystemdServices: (...args: unknown[]) => listSystemdServicesMock(...args),
  getSystemdStatus: (...args: unknown[]) => getSystemdStatusMock(...args),
  getSystemdLogs: (...args: unknown[]) => getSystemdLogsMock(...args),
  getSystemdContent: (...args: unknown[]) => getSystemdContentMock(...args),
  getSystemdUnit: (...args: unknown[]) => getSystemdUnitMock(...args),
  updateSystemdUnit: (...args: unknown[]) => updateSystemdUnitMock(...args),
  verifySystemdUnit: (...args: unknown[]) => verifySystemdUnitMock(...args),
  applySystemdUnit: (...args: unknown[]) => applySystemdUnitMock(...args),
  controlSystemdService: (...args: unknown[]) => controlSystemdServiceMock(...args),
}))

afterEach(() => {
  cleanup()
})

describe('ServerServicesPanel', () => {
  beforeEach(() => {
    listSystemdServicesMock.mockReset()
    getSystemdStatusMock.mockReset()
    getSystemdLogsMock.mockReset()
    getSystemdContentMock.mockReset()
    getSystemdUnitMock.mockReset()
    updateSystemdUnitMock.mockReset()
    verifySystemdUnitMock.mockReset()
    applySystemdUnitMock.mockReset()
    controlSystemdServiceMock.mockReset()

    listSystemdServicesMock.mockResolvedValue([
      {
        name: '',
        load_state: 'not-found',
        active_state: 'inactive',
        sub_state: 'dead',
        description: '',
      },
      {
        name: '●',
        load_state: 'not-found',
        active_state: 'not-found',
        sub_state: 'inactive',
        description: 'dead auditd.service',
      },
      {
        name: 'auditd.service',
        load_state: 'not-found',
        active_state: 'inactive',
        sub_state: 'dead',
        description: 'auditd.service',
      },
      {
        name: 'docker.service',
        load_state: 'loaded',
        active_state: 'active',
        sub_state: 'running',
        description: 'Docker Application Container Engine',
      },
      {
        name: 'netdata.service',
        load_state: 'loaded',
        active_state: 'active',
        sub_state: 'running',
        description: 'Netdata Agent',
      },
      {
        name: 'appos-tunnel.service',
        load_state: 'loaded',
        active_state: 'failed',
        sub_state: 'failed',
        description: 'AppOS Tunnel',
      },
      {
        name: 'connman.service',
        load_state: 'loaded',
        active_state: 'inactive',
        sub_state: 'dead',
        description: '',
      },
      {
        name: 'backup-task.service',
        load_state: 'loaded',
        active_state: 'active',
        sub_state: 'exited',
        description: 'Backup task',
      },
    ])

    getSystemdStatusMock.mockResolvedValue({
      server_id: 'server-1',
      service: 'docker.service',
      status: {
        Id: 'docker.service',
        Description: 'Docker Application Container Engine',
        ActiveState: 'active',
        SubState: 'running',
        UnitFileState: 'enabled',
        MainPID: '2184',
        FragmentPath: '/etc/systemd/system/docker.service',
      },
      status_text: 'active (running)',
    })
    getSystemdLogsMock.mockResolvedValue({
      server_id: 'server-1',
      service: 'docker.service',
      lines: 200,
      entries: ['Jul 09 09:41:22 dockerd started'],
      raw: 'Jul 09 09:41:22 dockerd started',
    })
    getSystemdContentMock.mockResolvedValue({
      server_id: 'server-1',
      service: 'docker.service',
      content: '[Unit]\nDescription=Docker',
    })
    getSystemdUnitMock.mockResolvedValue({
      server_id: 'server-1',
      service: 'docker.service',
      path: '/etc/systemd/system/docker.service',
      content: '[Unit]\nDescription=Docker',
    })
    updateSystemdUnitMock.mockResolvedValue({ output: 'saved' })
    verifySystemdUnitMock.mockResolvedValue({ verify_output: 'ok' })
    applySystemdUnitMock.mockResolvedValue({ reload_output: 'reloaded', apply_output: 'applied' })
    controlSystemdServiceMock.mockResolvedValue({})
  })

  it('shows the page header controls and supports inventory sorting', async () => {
    render(<ServerServicesPanel serverId="server-1" />)

    await waitFor(() => {
      expect(listSystemdServicesMock).toHaveBeenCalledWith('server-1', '')
    })

    expect(screen.getByRole('heading', { name: 'Systemd' })).toBeInTheDocument()
    expect(
      screen.getByText(/Inspect service status, open logs, and work with unit files/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh systemd data' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Selected Service' })).toBeInTheDocument()
    expect(
      screen.getByText('Choose a service to inspect its status, logs, and unit details.')
    ).toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: 'Systemd inventory' })
    expect(within(inventory).queryByRole('button', { name: 'Refresh systemd data' })).toBeNull()
    expect(within(inventory).getByPlaceholderText('Search')).toBeInTheDocument()
    expect(within(inventory).getByLabelText('Status filter')).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'All status (6)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Running (2)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Exited (1)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Failed (1)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Inactive (2)' })).toBeInTheDocument()
    expect(within(inventory).getByText('Total 6 services, 1 failed.')).toBeInTheDocument()
    expect(within(inventory).getByText('1/1')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'AppOS Focus Services' })).toBeNull()
    expect(screen.queryByLabelText('Boot filter')).toBeNull()
    expect(
      within(inventory).getByRole('button', { name: /Name sorted ascending/i })
    ).toBeInTheDocument()
    expect(within(inventory).getByRole('button', { name: /Summary sortable/i })).toBeInTheDocument()
    expect(within(inventory).queryByText('A-Z')).toBeNull()
    expect(within(inventory).queryByText('Sort')).toBeNull()
    expect(within(inventory).getByText('docker')).toBeInTheDocument()
    expect(within(inventory).getByText('netdata')).toBeInTheDocument()
    expect(within(inventory).getByText('appos-tunnel')).toBeInTheDocument()
    expect(within(inventory).getByText('auditd')).toBeInTheDocument()
    expect(within(inventory).getByText('connman')).toBeInTheDocument()
    expect(within(inventory).getByText('backup-task')).toBeInTheDocument()
    expect(within(inventory).queryByRole('button', { name: '' })).toBeNull()
    expect(within(inventory).queryByText('dead auditd.service')).toBeNull()
    expect(within(inventory).getAllByText('dead').length).toBeGreaterThan(0)
    expect(within(inventory).getByText('exited')).toBeInTheDocument()
    expect(within(inventory).queryByText('docker.service')).toBeNull()
    expect(within(inventory).getByText('Actions')).toBeInTheDocument()
    expect(within(inventory).getByText('1/1')).toBeInTheDocument()

    expect(within(inventory).getByRole('button', { name: /^docker$/i })).toBeInTheDocument()
    expect(
      within(inventory).getByRole('button', { name: /service actions for docker/i })
    ).toBeInTheDocument()

    const getRowLabels = () =>
      within(inventory)
        .getAllByRole('button')
        .map(button => button.getAttribute('aria-label'))
        .filter(
          (label): label is string =>
            typeof label === 'string' &&
            !label.startsWith('Service actions for ') &&
            !['Previous page', 'Next page', 'Refresh systemd data'].includes(label) &&
            !label.startsWith('Name ') &&
            !label.startsWith('Status ') &&
            !label.startsWith('Summary ')
        )

    expect(getRowLabels()).toEqual([
      'docker',
      'netdata',
      'appos-tunnel',
      'auditd',
      'backup-task',
      'connman',
    ])

    fireEvent.click(within(inventory).getByRole('button', { name: /Name sorted ascending/i }))

    expect(
      within(inventory).getByRole('button', { name: /Name sorted descending/i })
    ).toBeInTheDocument()
    expect(within(inventory).queryByText('Z-A')).toBeNull()
    expect(getRowLabels()).toEqual([
      'docker',
      'netdata',
      'appos-tunnel',
      'connman',
      'backup-task',
      'auditd',
    ])

    fireEvent.change(within(inventory).getByLabelText('Status filter'), {
      target: { value: 'failed' },
    })
    expect(within(inventory).getByText('appos-tunnel')).toBeInTheDocument()
    expect(within(inventory).queryByText('docker')).toBeNull()
  })

  it('shows Overview only on the overview view and keeps actions in the inventory menu', async () => {
    render(<ServerServicesPanel serverId="server-1" />)

    expect(await screen.findByText('connman')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search'), {
      target: { value: 'docker' },
    })

    const inventory = screen.getByRole('region', { name: 'Systemd inventory' })
    await waitFor(() => {
      expect(within(inventory).getByText('docker')).toBeInTheDocument()
    })
    expect(within(inventory).getByRole('option', { name: 'All status (1)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Running (1)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Exited (0)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Failed (0)' })).toBeInTheDocument()
    expect(within(inventory).getByRole('option', { name: 'Inactive (0)' })).toBeInTheDocument()
    expect(within(inventory).queryByText('connman')).toBeNull()

    fireEvent.click(within(inventory).getByLabelText(/^docker$/i))

    await waitFor(() => {
      expect(getSystemdStatusMock).toHaveBeenCalledWith('server-1', 'docker.service')
    })
    expect(getSystemdUnitMock).not.toHaveBeenCalled()

    const detailHeading = await screen.findByRole('heading', { name: 'Selected Service' })
    expect(detailHeading).toBeInTheDocument()

    const detailSection = detailHeading.closest('section')
    if (!detailSection) {
      throw new Error('Expected selected service section')
    }

    expect(
      within(detailSection).queryByRole('button', { name: /selected service actions/i })
    ).toBeNull()
    expect(within(detailSection).getAllByText('docker').length).toBeGreaterThan(0)
    expect(within(detailSection).getAllByText('running').length).toBeGreaterThan(0)
    expect(within(detailSection).getByText('Name:')).toBeInTheDocument()
    expect(within(detailSection).getByText('Description:')).toBeInTheDocument()
    expect(within(detailSection).getByText('Status:')).toBeInTheDocument()
    expect(within(detailSection).getByText('Path:')).toBeInTheDocument()
    expect(
      within(detailSection).getByText('/etc/systemd/system/docker.service')
    ).toBeInTheDocument()
    expect(
      within(detailSection).getByText('Docker Application Container Engine')
    ).toBeInTheDocument()
    expect(within(detailSection).getAllByText('enabled').length).toBeGreaterThan(0)
    expect(within(detailSection).getAllByText('2184').length).toBeGreaterThan(0)
    expect(within(detailSection).queryByRole('button', { name: 'Start' })).toBeNull()
    expect(within(detailSection).queryByRole('button', { name: 'Restart' })).toBeNull()
    expect(within(detailSection).getByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(within(detailSection).getByRole('button', { name: 'Logs' })).toBeInTheDocument()
    expect(within(detailSection).queryByRole('button', { name: 'Unit' })).toBeNull()
    expect(within(detailSection).queryByRole('button', { name: 'Edit unit' })).toBeNull()

    fireEvent.click(within(detailSection).getByRole('button', { name: 'Logs' }))
    expect(
      await within(detailSection).findByText('Jul 09 09:41:22 dockerd started')
    ).toBeInTheDocument()
    expect(within(detailSection).getByRole('button', { name: /Copy/i })).toBeInTheDocument()
    expect(within(detailSection).queryByText('Name:')).toBeNull()
    expect(within(detailSection).queryByText('Service Path:')).toBeNull()

    fireEvent.pointerDown(
      within(inventory).getByRole('button', { name: /service actions for docker/i })
    )
    expect(await screen.findByRole('menuitem', { name: 'Open overview' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open logs' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open unit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Edit unit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Enable' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Disable' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open unit' }))
    expect(await within(detailSection).findByText('Unit')).toBeInTheDocument()
    expect(within(detailSection).getByRole('button', { name: 'Edit unit' })).toBeInTheDocument()

    fireEvent.click(within(detailSection).getByRole('button', { name: 'Edit unit' }))
    expect(await within(detailSection).findByRole('textbox')).toBeInTheDocument()
    expect(within(detailSection).getByRole('button', { name: 'Validate' })).toBeInTheDocument()
    expect(within(detailSection).getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(within(detailSection).getByRole('button', { name: 'Cancel edit' })).toBeInTheDocument()
  })

  it('renders load errors inside the systemd inventory', async () => {
    listSystemdServicesMock.mockRejectedValue(new Error('ssh failed'))

    render(<ServerServicesPanel serverId="server-1" />)

    const inventory = screen.getByRole('region', { name: 'Systemd inventory' })
    expect(await within(inventory).findByText('ssh failed')).toBeInTheDocument()

    const detailSection = screen
      .getByRole('heading', { name: 'Selected Service' })
      .closest('section')
    if (!detailSection) {
      throw new Error('Expected selected service section')
    }

    expect(within(detailSection).queryByText('ssh failed')).toBeNull()
  })
})
