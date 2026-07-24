import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkflowsPage } from './workflows'

const sendMock = vi.fn()
const saveDraftHandoffMock = vi.fn()
const windowOpenMock = vi.fn()

async function openRowActions() {
  fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
}

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <div />,
}))

vi.mock('@/contexts/LayoutContext', () => ({
  useOptionalLayout: () => ({ setHeaderRightStartContent: vi.fn() }),
}))

vi.mock('@/lib/ai-copilot-draft-handoff', () => ({
  saveAICopilotDraftHandoff: (...args: unknown[]) => saveDraftHandoffMock(...args),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'workflows.page.title': 'Workflows',
        'workflows.page.create': 'Create Workflow',
        'workflows.table.actions': 'Actions',
        'workflows.menu.runs': 'Runs',
        'workflows.menu.run': 'Run',
        'workflows.runs.title': 'Workflow Runs',
        'workflows.runs.titleWithName': 'Workflow Runs · {{name}}',
        'workflows.runs.approve': 'Approve',
        'workflows.editor.targetServerHint':
          'Target server only applies to shell and docker nodes. New workflows start with a server-based shell step so the selected server has an immediate effect.',
        'workflows.editor.definitionYaml': 'Definition YAML',
        'common:save': 'Save',
        'workflows.editor.triggerType': 'Trigger Type',
        'workflows.editor.cron': 'Cron',
        'workflows.editor.cronSchedule': 'Cron Schedule',
        'workflows.editor.draftRequest': 'AI Workflow Request',
        'workflows.editor.openInAICopilot': 'Open In AI Copilot',
        'workflows.runDialog.parameters': 'Run Parameters JSON',
        'workflows.runDialog.runNow': 'Run Now',
        'workflows.toggle.enabled': 'Enabled',
        'common:refresh': 'Refresh',
        'workflows.runs.cancelRun': 'Cancel Run',
        'workflows.errors.yamlLine': '{{reason}} line {{line}}',
      }
      const template = translations[key] ?? key
      return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) => String(values?.[token] ?? ''))
    },
  }),
}))

describe('WorkflowsPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    sendMock.mockReset()
    saveDraftHandoffMock.mockReset()
    windowOpenMock.mockReset()
    window.open = windowOpenMock as typeof window.open
    Element.prototype.scrollIntoView = vi.fn()
    sendMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/workflows' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'wf-1',
            name: 'Daily Health Check',
            description: 'Checks one server every morning',
            is_enabled: true,
            definition_yaml: 'name: Daily Health Check',
            default_server_id: 'srv-1',
            trigger_types_json: '["cron"]',
            node_count: 2,
            has_ai_nodes: true,
            created_by: 'su-1',
            created: '2026-07-13T08:00:00Z',
            updated: '2026-07-13T08:05:00Z',
          },
        ])
      }
      if (path === '/api/servers/connection' && options?.method === 'GET') {
        return Promise.resolve({
          items: [
            { id: 'srv-1', name: 'Primary Server', host: '10.0.0.10', is_enabled: true },
            { id: 'srv-2', name: 'Backup Server', host: '10.0.0.11', is_enabled: true },
          ],
        })
      }
      if (path === '/api/workflows/wf-1/runs' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'run-1',
            workflow_id: 'wf-1',
            definition_yaml: 'name: Daily Health Check',
            status: 'manual_gate',
            trigger_type: 'manual',
            execution_owner_id: 'su-1',
            requested_by: 'su-1',
            requested_by_email: 'admin@websoft9.com',
            params_json: '{}',
            resolved_server_id: 'srv-1',
            overlap_policy: 'skip',
            started_at: '2026-07-13T08:10:00Z',
            ended_at: '',
            error_message: '',
            created: '2026-07-13T08:10:00Z',
            updated: '2026-07-13T08:10:00Z',
          },
        ])
      }
      if (path === '/api/workflow-runs/run-1' && options?.method === 'GET') {
        return Promise.resolve({
          id: 'run-1',
          workflow_id: 'wf-1',
          definition_yaml: 'name: Daily Health Check',
          status: 'manual_gate',
          trigger_type: 'manual',
          execution_owner_id: 'su-1',
          requested_by: 'su-1',
          requested_by_email: 'admin@websoft9.com',
          params_json: '{}',
          resolved_server_id: 'srv-1',
          overlap_policy: 'skip',
          started_at: '2026-07-13T08:10:00Z',
          ended_at: '',
          error_message: '',
          created: '2026-07-13T08:10:00Z',
          updated: '2026-07-13T08:10:00Z',
        })
      }
      if (path === '/api/workflow-runs/run-1/nodes' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'node-1',
            workflow_run_id: 'run-1',
            node_key: 'approve',
            node_type: 'manual_gate',
            display_name: 'approve',
            depends_on_json: '[]',
            status: 'manual_gate',
            retry_count: 0,
            output_json: '{}',
            error_message: '',
            execution_log: '',
            execution_log_truncated: false,
            started_at: '2026-07-13T08:10:00Z',
            ended_at: '',
            created: '2026-07-13T08:10:00Z',
            updated: '2026-07-13T08:10:00Z',
          },
        ])
      }
      if (path === '/api/workflows' && options?.method === 'POST') {
        return Promise.resolve({ id: 'wf-2' })
      }
      if (path === '/api/workflows/wf-1' && options?.method === 'PUT') {
        return Promise.resolve({ id: 'wf-1' })
      }
      if (path === '/api/workflows/wf-1/run' && options?.method === 'POST') {
        return Promise.resolve({ accepted: true, run: { id: 'run-1' } })
      }
      if (path === '/api/workflow-runs/run-1/approve/approve' && options?.method === 'POST') {
        return Promise.resolve({ id: 'node-1', status: 'succeeded' })
      }
      if (path === '/api/workflow-runs/run-1/cancel' && options?.method === 'POST') {
        return Promise.resolve({
          id: 'run-1',
          status: 'cancelled',
          ended_at: '2026-07-13T08:12:00Z',
        })
      }
      return Promise.resolve({ ok: true })
    })
  })

  it('renders workflow inventory and opens run detail', async () => {
    render(<WorkflowsPage />)

    expect(await screen.findByText('Workflows')).toBeInTheDocument()
    expect(await screen.findByText('Daily Health Check')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Primary Server' })).toBeInTheDocument()

    await openRowActions()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Runs' }))

    expect(await screen.findByText(/Workflow Runs/i)).toBeInTheDocument()
    expect(await screen.findByText('approve')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByText('admin@websoft9.com')).toBeInTheDocument()
  })

  it('submits create workflow requests', async () => {
    render(<WorkflowsPage />)
    await screen.findAllByText('Workflows')

    fireEvent.click(screen.getByRole('button', { name: 'Create Workflow' }))
    expect(screen.getByText(/target server only applies to/i)).toBeInTheDocument()
    const definitionValue = String(
      (screen.getByLabelText('Definition YAML') as HTMLTextAreaElement).value
    )
    expect(definitionValue).toContain('type: shell')
    expect(definitionValue).toContain('command: hostname')
    fireEvent.change(screen.getByLabelText('Definition YAML'), {
      target: {
        value:
          'name: New Workflow\ndescription: Test workflow\ndefault_server_id: srv-1\nnodes:\n  - key: a\n    type: shell\n    config:\n      command: echo hi\n',
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/workflows',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('syncs trigger controls back into yaml', async () => {
    render(<WorkflowsPage />)
    await screen.findAllByText('Workflows')

    fireEvent.click(screen.getByRole('button', { name: 'Create Workflow' }))
    fireEvent.click(screen.getByLabelText('Trigger Type'))
    fireEvent.click(await screen.findByRole('option', { name: 'Cron' }))

    const cronInput = await screen.findByLabelText('Cron Schedule')
    fireEvent.change(cronInput, { target: { value: '0 6 * * *' } })

    const definitionValue = String(
      (screen.getByLabelText('Definition YAML') as HTMLTextAreaElement).value
    )
    expect(definitionValue).toContain('type: cron')
    expect(definitionValue).toContain('schedule: 0 6 * * *')
  })

  it('opens ai copilot with a prepared workflow drafting prompt', async () => {
    render(<WorkflowsPage />)
    await screen.findAllByText('Workflows')

    fireEvent.click(screen.getByRole('button', { name: 'Create Workflow' }))
    fireEvent.change(screen.getByLabelText('AI Workflow Request'), {
      target: { value: 'Create a daily disk usage workflow.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open In AI Copilot' }))

    expect(saveDraftHandoffMock).toHaveBeenCalledTimes(1)
    expect(String(saveDraftHandoffMock.mock.calls[0][0])).toContain(
      'Create a daily disk usage workflow.'
    )
    expect(String(saveDraftHandoffMock.mock.calls[0][0])).toContain('Return YAML only')
    expect(windowOpenMock).toHaveBeenCalledWith('/ai-copilot', '_blank', 'noopener,noreferrer')
  })

  it('blocks save on invalid yaml with actionable feedback', async () => {
    render(<WorkflowsPage />)
    await screen.findAllByText('Workflows')

    fireEvent.click(screen.getByRole('button', { name: 'Create Workflow' }))
    fireEvent.change(screen.getByLabelText('Definition YAML'), {
      target: { value: 'name: Broken Workflow\nnodes: [' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText(/unexpected end of the stream|end of the stream/i)
    ).toBeInTheDocument()
    expect(sendMock).not.toHaveBeenCalledWith(
      '/api/workflows',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('opens run dialog and submits params', async () => {
    render(<WorkflowsPage />)
    await screen.findByText('Daily Health Check')

    await openRowActions()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Run' }))
    fireEvent.change(screen.getByLabelText('Run Parameters JSON'), {
      target: { value: '{"dry_run":false}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run Now' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/workflows/wf-1/run',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  it('sends enable disable updates', async () => {
    render(<WorkflowsPage />)
    await screen.findByText('Daily Health Check')

    fireEvent.click(screen.getByRole('button', { name: 'Enabled' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/workflows/wf-1',
        expect.objectContaining({ method: 'PUT' })
      )
    })
  })

  it('refreshes and cancels run detail against persisted truth', async () => {
    render(<WorkflowsPage />)
    await screen.findByText('Daily Health Check')

    await openRowActions()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Runs' }))
    expect(await screen.findByRole('button', { name: 'Refresh' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/workflow-runs/run-1',
        expect.objectContaining({ method: 'GET' })
      )
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Run' }))
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/workflow-runs/run-1/cancel',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })
})
