import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppDetailActionHistoryTable } from './AppDetailActionHistoryTable'

describe('AppDetailActionHistoryTable', () => {
  it('shows cancel and force-fail controls only for eligible actions', () => {
    const onRequestCancel = vi.fn()
    const onRequestForceFail = vi.fn()

    render(
      <AppDetailActionHistoryTable
        actions={[
          {
            id: 'queued-1',
            server_id: 'local',
            source: 'manualops',
            status: 'queued',
            adapter: 'manual',
            compose_project_name: 'ghost-prod',
            project_dir: '/srv/ghost',
            rendered_compose: '',
            error_summary: '',
            created: '2026-03-21T05:00:00Z',
            updated: '2026-03-21T05:00:00Z',
          },
          {
            id: 'running-1',
            server_id: 'local',
            source: 'gitops',
            status: 'running',
            adapter: 'git',
            compose_project_name: 'mysql-prod',
            project_dir: '/srv/mysql',
            rendered_compose: '',
            error_summary: '',
            created: '2026-03-21T07:00:00Z',
            updated: '2026-03-21T07:15:00Z',
          },
          {
            id: 'done-1',
            server_id: 'local',
            source: 'manualops',
            status: 'success',
            adapter: 'manual',
            compose_project_name: 'wordpress-prod',
            project_dir: '/srv/wordpress',
            rendered_compose: '',
            error_summary: '',
            created: '2026-03-21T08:00:00Z',
            updated: '2026-03-21T08:10:00Z',
          },
        ]}
        buildActionDetailHref={actionId => `/activity/${actionId}`}
        onRequestCancel={onRequestCancel}
        onRequestForceFail={onRequestForceFail}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Force Fail' }))

    expect(onRequestCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'queued-1' }))
    expect(onRequestForceFail).toHaveBeenCalledWith(expect.objectContaining({ id: 'running-1' }))
    expect(screen.getAllByRole('link', { name: 'Open Detail' })).toHaveLength(3)
  })
})
