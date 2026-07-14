import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkflowsPage } from './workflows'

const sendMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}))

vi.mock('@/lib/pb', () => ({
  pb: {
    send: (...args: unknown[]) => sendMock(...args),
  },
}))

vi.mock('@/contexts/LayoutContext', () => ({
  useOptionalLayout: () => ({ setHeaderRightStartContent: vi.fn() }),
}))

describe('WorkflowsPage', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    sendMock.mockReset()
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
      if (path === '/api/workflows/wf-1/runs' && options?.method === 'GET') {
        return Promise.resolve([
          {
            id: 'run-1',
            workflow_id: 'wf-1',
            definition_yaml: 'name: Daily Health Check',
            status: 'manual_gate',
            trigger_type: 'manual',
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
        return Promise.resolve({ id: 'run-1', status: 'cancelled' })
      }
      return Promise.resolve({ ok: true })
    })
  })

  it('renders workflow inventory and opens run detail', async () => {
    render(<WorkflowsPage />)

    expect(await screen.findByText('Workflows')).toBeInTheDocument()
    expect(await screen.findByText('Daily Health Check')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'srv-1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Runs' }))

    expect(await screen.findByText(/Workflow Runs/i)).toBeInTheDocument()
    expect(await screen.findByText('approve')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('submits create workflow requests', async () => {
    render(<WorkflowsPage />)
    await screen.findAllByText('Workflows')

    fireEvent.click(screen.getByRole('button', { name: 'Create Workflow' }))
    fireEvent.change(screen.getByLabelText('Definition YAML'), {
      target: { value: 'name: New Workflow\ndefault_server_id: srv-1\nnodes:\n  - key: a\n    type: shell\n    config:\n      command: echo hi\n' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith('/api/workflows', expect.objectContaining({ method: 'POST' }))
    })
  })

  it('opens run dialog and submits params', async () => {
    render(<WorkflowsPage />)
    await screen.findByText('Daily Health Check')

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(
        '/api/workflows/wf-1',
        expect.objectContaining({ method: 'PUT' })
      )
    })
  })
})
