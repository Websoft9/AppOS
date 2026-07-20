import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerCronPanel } from './ServerCronPanel'

const { translateCronKey } = vi.hoisted(() => {
  const translateCronKey = (key: string, options?: Record<string, unknown>) => {
    const messages: Record<string, string> = {
      'servers.cronTab.title': 'Crontab',
      'servers.cronTab.description': 'Manage AppOS-owned crontab entries for this server.',
      'servers.cronTab.loading': 'Loading cron entries...',
      'servers.cronTab.status.yes': 'Yes',
      'servers.cronTab.status.no': 'No',
      'servers.cronTab.actions.refresh': 'Refresh crontab entries',
      'servers.cronTab.actions.newEntry': 'New Entry',
      'servers.cronTab.actions.edit': 'Edit',
      'servers.cronTab.actions.test': 'Test',
      'servers.cronTab.actions.takeEffective': 'Take Effective',
      'servers.cronTab.actions.removeEffect': 'Remove Effect',
      'servers.cronTab.actions.delete': 'Delete',
      'servers.cronTab.empty.title': 'No managed crontab entries yet',
      'servers.cronTab.empty.description':
        'This list only shows AppOS-managed crontab entries for this server.',
      'servers.cronTab.inventory.ariaLabel': 'Crontab inventory',
      'servers.cronTab.search.placeholder': 'Search',
      'servers.cronTab.pagination.previous': 'Previous page',
      'servers.cronTab.pagination.next': 'Next page',
      'servers.cronTab.sort.asc': 'ascending',
      'servers.cronTab.sort.desc': 'descending',
      'servers.cronTab.columns.name': 'Name',
      'servers.cronTab.columns.schedule': 'Schedule',
      'servers.cronTab.columns.path': 'Path',
      'servers.cronTab.columns.takeEffective': 'Take Effective',
      'servers.cronTab.columns.singleRunOnly': 'Single Run Only',
      'servers.cronTab.columns.actions': 'Actions',
      'servers.cronTab.filters.noResults': 'No crontab entries match the current filters.',
      'servers.cronTab.selected.title': 'Selected Entry',
      'servers.cronTab.selected.selectPrompt': 'Select one entry from the inventory.',
      'servers.cronTab.selected.empty':
        'Choose a crontab entry to inspect its schedule, path, and command details.',
      'servers.cronTab.detailRows.name': 'Name:',
      'servers.cronTab.detailRows.schedule': 'Schedule:',
      'servers.cronTab.detailRows.path': 'Path:',
      'servers.cronTab.detailRows.takeEffective': 'Take Effective:',
      'servers.cronTab.detailRows.singleRunOnly': 'Single Run Only:',
      'servers.cronTab.detailRows.command': 'Command',
      'servers.cronTab.tabs.liveLog': 'Live log',
      'servers.cronTab.tabs.logs': 'Logs',
      'servers.cronTab.liveLog.empty':
        'No operation log yet. Trigger Test, Edit, enable/disable, or delete actions to see live updates here.',
      'servers.cronTab.logsPanel.empty':
        'Entry historical logs are reserved here. Backend log API is not available yet.',
      'servers.cronTab.hints.created': 'Cron entry created.',
      'servers.cronTab.hints.updated': 'Cron entry updated.',
      'servers.cronTab.hints.deleted': 'Cron entry deleted.',
      'servers.cronTab.hints.effectApplied': 'Crontab entry is now effective.',
      'servers.cronTab.hints.effectRemoved': 'Crontab entry removed from effect.',
      'servers.cronTab.hints.tested': 'Crontab entry tested.',
      'servers.cronTab.errors.load': 'Failed to load cron entries',
      'servers.cronTab.errors.save': 'Failed to save cron entry',
      'servers.cronTab.errors.update': 'Failed to update cron entry',
      'servers.cronTab.errors.delete': 'Failed to delete cron entry',
      'servers.cronTab.errors.test': 'Failed to test crontab entry',
      'servers.cronTab.logs.savingChanges': 'Saving entry changes...',
      'servers.cronTab.logs.entryCreated': 'Entry created successfully.',
      'servers.cronTab.logs.entryUpdated': 'Entry updated successfully.',
      'servers.cronTab.logs.removingEffect': 'Removing effect from entry...',
      'servers.cronTab.logs.applyingEffect': 'Applying entry to crontab...',
      'servers.cronTab.logs.entryEffective': 'Entry is now effective.',
      'servers.cronTab.logs.entryEffectRemoved': 'Entry removed from effect.',
      'servers.cronTab.logs.deleting': 'Deleting entry...',
      'servers.cronTab.logs.entryDeleted': 'Entry deleted.',
      'servers.cronTab.logs.runningTest': 'Running test for entry...',
      'servers.cronTab.logs.tested': 'Crontab entry tested.',
      'servers.cronTab.validation.nameRequired': 'Name is required',
      'servers.cronTab.validation.scheduleInvalid':
        'Schedule must be a valid five-field cron expression',
      'servers.cronTab.validation.commandRequired': 'Command is required',
      'servers.cronTab.dialogs.editor.createTitle': 'New Entry',
      'servers.cronTab.dialogs.editor.editTitle': 'Edit Entry',
      'servers.cronTab.dialogs.editor.description':
        'Generate a five-field cron schedule with frequency-specific controls.',
      'servers.cronTab.dialogs.editor.cancel': 'Cancel',
      'servers.cronTab.dialogs.editor.save': 'Save',
      'servers.cronTab.dialogs.delete.title': 'Delete Cron Entry',
      'servers.cronTab.dialogs.delete.descriptionFallback': 'Confirm deletion.',
      'servers.cronTab.dialogs.delete.cancel': 'Cancel',
      'servers.cronTab.dialogs.delete.confirm': 'Delete',
      'servers.cronTab.editor.sections.name': 'Name',
      'servers.cronTab.editor.sections.command': 'Command',
      'servers.cronTab.editor.sections.optional': 'Optional',
      'servers.cronTab.editor.sections.frequencySet': 'Frequency Set',
      'servers.cronTab.editor.sections.cronExpression': 'Cron Expression',
      'servers.cronTab.editor.fields.name': 'Name',
      'servers.cronTab.editor.fields.command': 'Command',
      'servers.cronTab.editor.fields.takeEffective': 'Take Effective',
      'servers.cronTab.editor.fields.singleRunOnly': 'Single Run Only',
      'servers.cronTab.editor.fields.frequency': 'Frequency',
      'servers.cronTab.editor.fields.every': 'Every',
      'servers.cronTab.editor.fields.atTime': 'At time',
      'servers.cronTab.editor.fields.hour': 'Hour',
      'servers.cronTab.editor.fields.minute': 'Minute',
      'servers.cronTab.editor.fields.daysOfWeek': 'Days of week',
      'servers.cronTab.editor.fields.dayOfMonth': 'Day of month',
      'servers.cronTab.editor.fields.customCronFields': 'Custom cron fields',
      'servers.cronTab.editor.fields.dayOfMonthShort': 'Day (M)',
      'servers.cronTab.editor.fields.month': 'Month',
      'servers.cronTab.editor.fields.dayOfWeekShort': 'Day (W)',
      'servers.cronTab.editor.fields.cronExpression': 'Your cron expression',
      'servers.cronTab.editor.actions.copy': 'Copy',
      'servers.cronTab.editor.actions.copied': 'Copied',
      'servers.cronTab.editor.frequencyOptions.minute': 'Every minute',
      'servers.cronTab.editor.frequencyOptions.hour': 'Every hour',
      'servers.cronTab.editor.frequencyOptions.day': 'Every day',
      'servers.cronTab.editor.frequencyOptions.week': 'Every week',
      'servers.cronTab.editor.frequencyOptions.month': 'Every month',
      'servers.cronTab.editor.frequencyOptions.custom': 'Custom',
      'servers.cronTab.editor.units.minutes': 'minute(s)',
      'servers.cronTab.editor.units.hours': 'hour(s)',
      'servers.cronTab.weekdays.sun.short': 'Sun',
      'servers.cronTab.weekdays.sun.label': 'Sunday',
      'servers.cronTab.weekdays.mon.short': 'Mon',
      'servers.cronTab.weekdays.mon.label': 'Monday',
      'servers.cronTab.weekdays.tue.short': 'Tue',
      'servers.cronTab.weekdays.tue.label': 'Tuesday',
      'servers.cronTab.weekdays.wed.short': 'Wed',
      'servers.cronTab.weekdays.wed.label': 'Wednesday',
      'servers.cronTab.weekdays.thu.short': 'Thu',
      'servers.cronTab.weekdays.thu.label': 'Thursday',
      'servers.cronTab.weekdays.fri.short': 'Fri',
      'servers.cronTab.weekdays.fri.label': 'Friday',
      'servers.cronTab.weekdays.sat.short': 'Sat',
      'servers.cronTab.weekdays.sat.label': 'Saturday',
    }

    if (key === 'servers.cronTab.inventory.summary') {
      return `Total ${String(options?.count ?? '')} entries, ${String(options?.failed ?? '')} failed.`
    }
    if (key === 'servers.cronTab.columns.nameSorted') {
      return `Name sorted ${String(options?.direction ?? '')}`
    }
    if (key === 'servers.cronTab.actions.actionsFor') {
      return `Crontab actions for ${String(options?.name ?? '')}`
    }
    if (key === 'servers.cronTab.logs.saveFailed') {
      return `Save failed: ${String(options?.message ?? '')}`
    }
    if (key === 'servers.cronTab.logs.toggleFailed') {
      return `Toggle failed: ${String(options?.message ?? '')}`
    }
    if (key === 'servers.cronTab.logs.deleteFailed') {
      return `Delete failed: ${String(options?.message ?? '')}`
    }
    if (key === 'servers.cronTab.logs.testOutput') {
      return `Test output:\n${String(options?.output ?? '')}`
    }
    if (key === 'servers.cronTab.logs.testFailed') {
      return `Test failed: ${String(options?.message ?? '')}`
    }
    if (key === 'servers.cronTab.dialogs.delete.descriptionWithName') {
      return `Entry: ${String(options?.name ?? '')}. This permanently removes the managed cron row.`
    }

    return messages[key] ?? key
  }

  return { translateCronKey }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translateCronKey,
  }),
}))

const listServerCronJobsMock = vi.fn()
const createServerCronJobMock = vi.fn()
const updateServerCronJobMock = vi.fn()
const enableServerCronJobMock = vi.fn()
const disableServerCronJobMock = vi.fn()
const deleteServerCronJobMock = vi.fn()
const testServerCronJobMock = vi.fn()

vi.mock('@/lib/connect-api', () => ({
  listServerCronJobs: (...args: unknown[]) => listServerCronJobsMock(...args),
  createServerCronJob: (...args: unknown[]) => createServerCronJobMock(...args),
  updateServerCronJob: (...args: unknown[]) => updateServerCronJobMock(...args),
  enableServerCronJob: (...args: unknown[]) => enableServerCronJobMock(...args),
  disableServerCronJob: (...args: unknown[]) => disableServerCronJobMock(...args),
  deleteServerCronJob: (...args: unknown[]) => deleteServerCronJobMock(...args),
  testServerCronJob: (...args: unknown[]) => testServerCronJobMock(...args),
}))

afterEach(() => {
  cleanup()
})

describe('ServerCronPanel', () => {
  beforeEach(() => {
    listServerCronJobsMock.mockReset()
    createServerCronJobMock.mockReset()
    updateServerCronJobMock.mockReset()
    enableServerCronJobMock.mockReset()
    disableServerCronJobMock.mockReset()
    deleteServerCronJobMock.mockReset()
    testServerCronJobMock.mockReset()
  })

  it('shows the empty state when no managed cron entries exist', async () => {
    listServerCronJobsMock.mockResolvedValue({ items: [] })

    render(<ServerCronPanel serverId="server-1" />)

    await waitFor(() => {
      expect(listServerCronJobsMock).toHaveBeenCalledWith('server-1')
    })

    expect(screen.getByRole('heading', { name: 'Crontab' })).toBeInTheDocument()
    expect(await screen.findByText('No managed crontab entries yet')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'New Entry' })).toHaveLength(2)
  })

  it('supports editing an existing cron entry', async () => {
    listServerCronJobsMock.mockResolvedValue({
      items: [
        {
          entryId: 'cron-1',
          name: 'nightly-backup',
          schedule: '0 2 * * *',
          command: '/opt/bin/backup.sh',
          path: '/etc/cron.d/appos-managed-cron-cron-1',
          enabled: true,
          singleRunOnly: false,
          source: 'managed',
        },
      ],
    })
    updateServerCronJobMock.mockResolvedValue({
      entryId: 'cron-1',
      name: 'nightly-backup',
      schedule: '0 3 * * *',
      command: '/opt/bin/backup.sh --full',
      path: '/etc/cron.d/appos-managed-cron-cron-1',
      enabled: false,
      singleRunOnly: true,
      source: 'managed',
    })

    render(<ServerCronPanel serverId="server-1" />)

    expect(await screen.findByText('nightly-backup')).toBeInTheDocument()
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Crontab actions for nightly-backup' })
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    const scheduleInput = await screen.findByLabelText('Your cron expression')
    const commandInput = screen.getByLabelText('Command')
    const takeEffectiveInput = screen.getByLabelText('Take Effective')
    const singleRunOnlyInput = screen.getByLabelText('Single Run Only')

    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'day' } })
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '03' } })
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '00' } })
    fireEvent.change(commandInput, { target: { value: '/opt/bin/backup.sh --full' } })
    fireEvent.click(takeEffectiveInput)
    fireEvent.click(singleRunOnlyInput)
    expect(scheduleInput).toHaveValue('0 3 * * *')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(updateServerCronJobMock).toHaveBeenCalledWith('server-1', 'cron-1', {
        name: 'nightly-backup',
        schedule: '0 3 * * *',
        command: '/opt/bin/backup.sh --full',
        enabled: false,
        singleRunOnly: true,
      })
    })

    expect(await screen.findByText('Cron entry updated.')).toBeInTheDocument()
    expect(screen.getAllByText('No').length).toBeGreaterThan(0)
  })

  it('creates a cron entry from a minute cadence preset', async () => {
    listServerCronJobsMock.mockResolvedValue({ items: [] })
    createServerCronJobMock.mockResolvedValue({
      entryId: 'cron-2',
      name: 'poller',
      schedule: '*/7 * * * *',
      command: '/opt/bin/poll.sh',
      path: '/etc/cron.d/appos-managed-cron-cron-2',
      enabled: true,
      singleRunOnly: false,
      source: 'managed',
    })

    render(<ServerCronPanel serverId="server-1" />)

    fireEvent.click(
      await screen.findAllByRole('button', { name: 'New Entry' }).then(buttons => buttons[0])
    )
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'poller' } })
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'minute' } })
    fireEvent.change(screen.getByLabelText('Every'), { target: { value: '7' } })
    expect(screen.getByLabelText('Your cron expression')).toHaveValue('*/7 * * * *')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: '/opt/bin/poll.sh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(createServerCronJobMock).toHaveBeenCalledWith('server-1', {
        name: 'poller',
        schedule: '*/7 * * * *',
        command: '/opt/bin/poll.sh',
        enabled: true,
        singleRunOnly: false,
      })
    })
  })

  it('supports custom cron field editing', async () => {
    listServerCronJobsMock.mockResolvedValue({ items: [] })
    createServerCronJobMock.mockResolvedValue({
      entryId: 'cron-3',
      name: 'custom-job',
      schedule: '15 4 1 */2 1',
      command: '/opt/bin/custom.sh',
      path: '/etc/cron.d/appos-managed-cron-cron-3',
      enabled: true,
      singleRunOnly: true,
      source: 'managed',
    })

    render(<ServerCronPanel serverId="server-1" />)

    fireEvent.click(
      await screen.findAllByRole('button', { name: 'New Entry' }).then(buttons => buttons[0])
    )
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'custom-job' } })
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '15' } })
    fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Day (M)'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '*/2' } })
    fireEvent.change(screen.getByLabelText('Day (W)'), { target: { value: '1' } })
    fireEvent.click(screen.getByLabelText('Single Run Only'))
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: '/opt/bin/custom.sh' } })
    expect(screen.getByLabelText('Your cron expression')).toHaveValue('15 4 1 */2 1')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(createServerCronJobMock).toHaveBeenCalledWith('server-1', {
        name: 'custom-job',
        schedule: '15 4 1 */2 1',
        command: '/opt/bin/custom.sh',
        enabled: true,
        singleRunOnly: true,
      })
    })
  })

  it('confirms before deleting a cron entry', async () => {
    listServerCronJobsMock.mockResolvedValue({
      items: [
        {
          entryId: 'cron-1',
          name: 'nightly-backup',
          schedule: '0 2 * * *',
          command: '/opt/bin/backup.sh',
          path: '/etc/cron.d/appos-managed-cron-cron-1',
          enabled: true,
          singleRunOnly: false,
          source: 'managed',
        },
      ],
    })
    deleteServerCronJobMock.mockResolvedValue({ entryId: 'cron-1', deleted: true })

    render(<ServerCronPanel serverId="server-1" />)

    expect(await screen.findByText('nightly-backup')).toBeInTheDocument()
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Crontab actions for nightly-backup' })
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Entry: nightly-backup/i)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteServerCronJobMock).toHaveBeenCalledWith('server-1', 'cron-1')
    })
    await waitFor(() => {
      expect(screen.queryByText('nightly-backup')).toBeNull()
    })
  })

  it('supports sorting by name and immediate test execution', async () => {
    listServerCronJobsMock.mockResolvedValue({
      items: [
        {
          entryId: 'cron-b',
          name: 'zeta-job',
          schedule: '0 2 * * *',
          command: '/opt/bin/zeta.sh',
          path: '/etc/cron.d/appos-managed-cron-cron-b',
          enabled: true,
          singleRunOnly: false,
          source: 'managed',
        },
        {
          entryId: 'cron-a',
          name: 'alpha-job',
          schedule: '0 3 * * *',
          command: '/opt/bin/alpha.sh',
          path: '/etc/cron.d/appos-managed-cron-cron-a',
          enabled: false,
          singleRunOnly: true,
          source: 'managed',
        },
      ],
    })
    testServerCronJobMock.mockResolvedValue({ entryId: 'cron-a', output: 'test ok' })

    render(<ServerCronPanel serverId="server-1" />)

    await screen.findByText('alpha-job')
    const nameButtons = screen.getAllByRole('button', { name: /Name sorted/i })
    fireEvent.click(nameButtons[0])

    const rows = screen.getAllByRole('row')
    expect(within(rows[1]).getByText('zeta-job')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Crontab actions for alpha-job' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Test' }))

    await waitFor(() => {
      expect(testServerCronJobMock).toHaveBeenCalledWith('server-1', 'cron-a')
    })
    fireEvent.click(screen.getByText('alpha-job'))
    expect(await screen.findAllByText(/Test output:/)).toHaveLength(2)
    expect(screen.getByText(/Running test for entry/)).toBeInTheDocument()
    expect(screen.getAllByText('/etc/cron.d/appos-managed-cron-cron-a').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Yes').length).toBeGreaterThan(0)
  })

  it('shows inventory stats, search, pagination, and selected entry details', async () => {
    listServerCronJobsMock.mockResolvedValue({
      items: Array.from({ length: 13 }, (_, index) => ({
        entryId: `cron-${index + 1}`,
        name: index === 0 ? 'alpha-job' : `job-${String(index + 1).padStart(2, '0')}`,
        schedule: `${index} * * * *`,
        command: `/opt/bin/job-${index + 1}.sh`,
        path: `/etc/cron.d/appos-managed-cron-cron-${index + 1}`,
        enabled: index % 2 === 0,
        singleRunOnly: index % 3 === 0,
        source: 'managed',
      })),
    })

    render(<ServerCronPanel serverId="server-1" />)

    expect(await screen.findByText('Total 13 entries, 0 failed.')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Next page'))
    expect(await screen.findByText('2/2')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search'), { target: { value: 'alpha' } })
    expect(await screen.findByText('Total 1 entries, 0 failed.')).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('alpha-job'))
    const selectedHeading = await screen.findByText('Selected Entry')
    const detailPanel = selectedHeading.closest('section')
    expect(detailPanel).not.toBeNull()
    expect(
      within(detailPanel as HTMLElement).getByText('/etc/cron.d/appos-managed-cron-cron-1')
    ).toBeInTheDocument()
    expect(within(detailPanel as HTMLElement).getByText('/opt/bin/job-1.sh')).toBeInTheDocument()
    expect(
      within(detailPanel as HTMLElement).getByRole('tab', { name: 'Live log' })
    ).toBeInTheDocument()
    expect(
      within(detailPanel as HTMLElement).getByRole('tab', { name: 'Logs' })
    ).toBeInTheDocument()
    expect(within(detailPanel as HTMLElement).getByText(/No operation log yet/)).toBeInTheDocument()
  })
})
