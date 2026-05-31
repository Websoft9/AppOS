import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerCronPanel } from './ServerCronPanel'

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
    expect(screen.getByText('No managed crontab entries yet')).toBeInTheDocument()
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
