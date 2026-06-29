import { ClientResponseError } from 'pocketbase'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerServicesPanel } from './ServerServicesPanel'

const { translateServicesKey } = vi.hoisted(() => {
  const translateServicesKey = (key: string, options?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      'servers.servicesTab.title': 'Systemd',
      'servers.servicesTab.description':
        'Inspect service status, open logs, and work with unit files from a single view.',
      'servers.servicesTab.loading': 'Loading services...',
      'servers.servicesTab.loadingDetails': 'Loading details...',
      'servers.servicesTab.inventory.ariaLabel': 'Systemd inventory',
      'servers.servicesTab.inventory.focusService': 'AppOS focus service',
      'servers.servicesTab.search.placeholder': 'Search',
      'servers.servicesTab.filters.status': 'Status filter',
      'servers.servicesTab.pagination.previous': 'Previous page',
      'servers.servicesTab.pagination.next': 'Next page',
      'servers.servicesTab.sort.asc': 'ascending',
      'servers.servicesTab.sort.desc': 'descending',
      'servers.servicesTab.columns.name': 'Name',
      'servers.servicesTab.columns.nameSortable': 'Name sortable',
      'servers.servicesTab.columns.status': 'Status',
      'servers.servicesTab.columns.summary': 'Summary',
      'servers.servicesTab.columns.summarySortable': 'Summary sortable',
      'servers.servicesTab.columns.actions': 'Actions',
      'servers.servicesTab.selected.title': 'Selected Service',
      'servers.servicesTab.selected.selectPrompt': 'Select one service from the inventory.',
      'servers.servicesTab.selected.empty':
        'Choose a service to inspect its status, logs, and unit details.',
      'servers.servicesTab.detailRows.name': 'Name',
      'servers.servicesTab.detailRows.description': 'Description',
      'servers.servicesTab.detailRows.status': 'Status',
      'servers.servicesTab.detailRows.path': 'Path',
      'servers.servicesTab.detailRows.pid': 'PID',
      'servers.servicesTab.detailRows.loadState': 'Load State',
      'servers.servicesTab.detailRows.activeState': 'Active State',
      'servers.servicesTab.detailRows.subState': 'Sub State',
      'servers.servicesTab.detailRows.unitFileState': 'Unit File State',
      'servers.servicesTab.detailRows.stateChange': 'State Change',
      'servers.servicesTab.status.running': 'running',
      'servers.servicesTab.status.exited': 'exited',
      'servers.servicesTab.status.dead': 'dead',
      'servers.servicesTab.status.failed': 'failed',
      'servers.servicesTab.status.inactive': 'inactive',
      'servers.servicesTab.status.unknown': 'unknown',
      'servers.servicesTab.tabs.overview': 'Overview',
      'servers.servicesTab.tabs.logs': 'Logs',
      'servers.servicesTab.logs.title': 'Logs',
      'servers.servicesTab.unit.title': 'Unit',
      'servers.servicesTab.unit.empty': 'No unit content.',
      'servers.servicesTab.unit.placeholder': '[Unit]\nDescription=...',
      'servers.servicesTab.unit.validatePassed': 'Validate passed.',
      'servers.servicesTab.unit.applyCompleted': 'Apply completed.',
      'servers.servicesTab.actions.refresh': 'Refresh systemd data',
      'servers.servicesTab.actions.openOverview': 'Open overview',
      'servers.servicesTab.actions.openLogs': 'Open logs',
      'servers.servicesTab.actions.openUnit': 'Open unit',
      'servers.servicesTab.actions.editUnit': 'Edit unit',
      'servers.servicesTab.actions.start': 'Start',
      'servers.servicesTab.actions.restart': 'Restart',
      'servers.servicesTab.actions.stop': 'Stop',
      'servers.servicesTab.actions.enable': 'Enable',
      'servers.servicesTab.actions.disable': 'Disable',
      'servers.servicesTab.actions.copy': 'Copy',
      'servers.servicesTab.actions.validate': 'Validate',
      'servers.servicesTab.actions.apply': 'Apply',
      'servers.servicesTab.actions.cancelEdit': 'Cancel edit',
      'servers.servicesTab.empty.noMatches': 'No services match the current filters.',
      'servers.servicesTab.hints.logsCopied': 'Logs copied.',
      'servers.servicesTab.errors.loadServices': 'Failed to load services',
      'servers.servicesTab.errors.operationFailed': 'Operation failed',
      'servers.servicesTab.errors.copyLogs': 'Failed to copy logs',
      'servers.servicesTab.errors.validateUnit': 'Failed to validate unit file',
      'servers.servicesTab.errors.applyUnit': 'Failed to apply unit file',
      'servers.servicesTab.confirm.validateTitle': 'Validate unit file?',
      'servers.servicesTab.confirm.applyTitle': 'Apply unit changes?',
      'servers.servicesTab.confirm.actionTitle': 'Confirm service action?',
      'servers.servicesTab.confirm.cancel': 'Cancel',
      'servers.servicesTab.confirm.confirm': 'Confirm',
    }

    if (key === 'servers.servicesTab.inventory.summary') {
      return `Total ${String(options?.count ?? '')} services, ${String(options?.failed ?? '')} failed.`
    }
    if (key === 'servers.servicesTab.filterOptions.all') {
      return `All status (${String(options?.count ?? '')})`
    }
    if (key === 'servers.servicesTab.filterOptions.running') {
      return `Running (${String(options?.count ?? '')})`
    }
    if (key === 'servers.servicesTab.filterOptions.exited') {
      return `Exited (${String(options?.count ?? '')})`
    }
    if (key === 'servers.servicesTab.filterOptions.failed') {
      return `Failed (${String(options?.count ?? '')})`
    }
    if (key === 'servers.servicesTab.filterOptions.inactive') {
      return `Inactive (${String(options?.count ?? '')})`
    }
    if (key === 'servers.servicesTab.columns.nameSorted') {
      return `Name sorted ${String(options?.direction ?? '')}`
    }
    if (key === 'servers.servicesTab.columns.summarySorted') {
      return `Summary sorted ${String(options?.direction ?? '')}`
    }
    if (key === 'servers.servicesTab.logs.entries') {
      return `${String(options?.count ?? '')} entries`
    }
    if (key === 'servers.servicesTab.actions.serviceActionsFor') {
      return `Service actions for ${String(options?.name ?? '')}`
    }
    if (key === 'servers.servicesTab.hints.actionApplied') {
      return `Action ${String(options?.action ?? '')} applied. Next: check status or logs.`
    }
    if (key === 'servers.servicesTab.confirm.validateDescription') {
      return `Service: ${String(options?.service ?? '')}\nThis will run systemd-analyze verify.`
    }
    if (key === 'servers.servicesTab.confirm.applyDescription') {
      return `Service: ${String(options?.service ?? '')}\nThis will save current editor content, then run daemon-reload and try-restart.`
    }
    if (key === 'servers.servicesTab.confirm.actionDescription') {
      return `Service: ${String(options?.service ?? '')}\nAction: ${String(options?.action ?? '')}`
    }

    return messages[key] ?? key
  }

  return { translateServicesKey }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translateServicesKey,
  }),
}))

const listSystemdServicesMock = vi.fn()
const getSystemdStatusMock = vi.fn()
const getSystemdLogsMock = vi.fn()
const getSystemdContentMock = vi.fn()
const getSystemdUnitMock = vi.fn()
const updateSystemdUnitMock = vi.fn()
const verifySystemdUnitMock = vi.fn()
const applySystemdUnitMock = vi.fn()
const controlSystemdServiceMock = vi.fn()
const listSupportedServerSoftwareMock = vi.fn()

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

vi.mock('@/lib/software-api', () => ({
  listSupportedServerSoftware: (...args: unknown[]) => listSupportedServerSoftwareMock(...args),
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
    listSupportedServerSoftwareMock.mockReset()

    listSupportedServerSoftwareMock.mockResolvedValue([
      {
        component_key: 'telegraf',
        label: 'Monitor Agent (Native Telegraf)',
        template_kind: 'script',
        artifact_kind: 'binary',
        supported_actions: ['install', 'upgrade', 'reinstall'],
        description: 'Native Telegraf agent for AppOS metrics collector.',
        readiness_requirements: [],
        visibility: ['server_operations', 'supported_software_discovery'],
        favorite_systemd_service: true,
        service_name: 'appos-monitor.service',
      },
    ])

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
        name: 'appos-monitor.service',
        load_state: 'loaded',
        active_state: 'active',
        sub_state: 'running',
        description: 'Native Telegraf agent for AppOS metrics collector',
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
    expect(within(inventory).getByText('appos-monitor')).toBeInTheDocument()
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
      'appos-monitor',
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
      'appos-monitor',
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
    await waitFor(() => {
      expect(getSystemdUnitMock).toHaveBeenCalledWith('server-1', 'docker.service')
    })
    expect(within(detailSection).getByRole('button', { name: 'Edit unit' })).toBeInTheDocument()

    fireEvent.click(within(detailSection).getByRole('button', { name: 'Edit unit' }))
    expect(await within(detailSection).findByRole('textbox')).toBeInTheDocument()
    expect(within(detailSection).getByRole('button', { name: 'Validate' })).toBeInTheDocument()
    expect(within(detailSection).getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(within(detailSection).getByRole('button', { name: 'Cancel edit' })).toBeInTheDocument()
  })

  it('opens overview from non-actions row clicks and keeps actions isolated', async () => {
    render(<ServerServicesPanel serverId="server-1" />)

    const inventory = await screen.findByRole('region', { name: 'Systemd inventory' })

    fireEvent.click(within(inventory).getByText('Docker Application Container Engine'))

    await waitFor(() => {
      expect(getSystemdStatusMock).toHaveBeenCalledWith('server-1', 'docker.service')
    })

    const detailSection = screen
      .getByRole('heading', { name: 'Selected Service' })
      .closest('section')
    if (!detailSection) {
      throw new Error('Expected selected service section')
    }

    expect(within(detailSection).getAllByText('docker').length).toBeGreaterThan(0)

    fireEvent.pointerDown(
      within(inventory).getByRole('button', { name: /service actions for appos-monitor/i })
    )

    expect(await screen.findByRole('menuitem', { name: 'Open overview' })).toBeInTheDocument()
    expect(within(detailSection).queryByText('appos-monitor')).toBeNull()
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

  it('retries transient busy errors for inventory and detail loads', async () => {
    const inventoryBusyError = new ClientResponseError({
      url: '/api/servers/server-1/ops/systemd/services',
      status: 503,
      response: { message: 'server already processing request' },
    })

    listSystemdServicesMock
      .mockRejectedValueOnce(inventoryBusyError)
      .mockResolvedValueOnce([
        {
          name: 'docker.service',
          load_state: 'loaded',
          active_state: 'active',
          sub_state: 'running',
          description: 'Docker Application Container Engine',
        },
      ])

    render(<ServerServicesPanel serverId="server-1" />)

    await waitFor(() => {
      expect(listSystemdServicesMock).toHaveBeenCalledTimes(2)
    })

    const detailBusyError = new ClientResponseError({
      url: '/api/servers/server-1/ops/systemd/services/docker.service/status',
      status: 503,
      response: { message: 'server already processing request' },
    })

    getSystemdStatusMock.mockReset()
    getSystemdStatusMock
      .mockRejectedValueOnce(detailBusyError)
      .mockResolvedValueOnce({
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

    fireEvent.click(await screen.findByRole('button', { name: /^docker$/i }))

    await waitFor(() => {
      expect(getSystemdStatusMock).toHaveBeenCalledTimes(2)
    })

    expect(screen.queryByText('server already processing request')).toBeNull()
    const detailSection = screen
      .getByRole('heading', { name: 'Selected Service' })
      .closest('section')
    if (!detailSection) {
      throw new Error('Expected selected service section')
    }
    expect(
      await within(detailSection).findByText('Docker Application Container Engine')
    ).toBeInTheDocument()
  })
})
