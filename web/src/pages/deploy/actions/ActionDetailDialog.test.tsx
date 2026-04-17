import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ActionDetailContent } from './ActionDetailDialog'

describe('ActionDetailContent', () => {
  it('renders overview and stage details without the old execution timeline', () => {
    render(
      <TooltipProvider>
        <ActionDetailContent
          operation={{
            id: 'act_1',
            server_id: 'srv_1',
            server_label: 'Demo Server',
            server_host: '10.0.0.8',
            source: 'manualops',
            status: 'failed',
            adapter: 'manual',
            compose_project_name: 'wordpress-prod',
            project_dir: '/srv/wordpress',
            rendered_compose: '',
            error_summary: 'health check failed',
            created: '2026-03-26T08:00:00Z',
            updated: '2026-03-26T08:08:00Z',
            started_at: '2026-03-26T08:01:00Z',
            finished_at: '2026-03-26T08:08:00Z',
            user_email: 'admin@example.com',
            pipeline: {
              id: 'pipe_1',
              operation_id: 'act_1',
              family: 'provision',
              family_internal: 'ProvisionPipeline',
              definition_key: 'provision.install.manual_compose',
              version: 'v1',
              status: 'failed',
              current_phase: 'verifying',
              node_count: 5,
              completed_node_count: 3,
              failed_node_key: 'verify_runtime_health',
              started_at: '2026-03-26T08:01:00Z',
              finished_at: '2026-03-26T08:08:00Z',
              selector: { operation_type: 'install', source: 'manualops', adapter: 'manual' },
              steps: [],
            },
            pipeline_family: 'provision',
            pipeline_family_internal: 'ProvisionPipeline',
            pipeline_definition_key: 'provision.install.manual_compose',
            pipeline_version: 'v1',
            pipeline_selector: {
              operation_type: 'install',
              source: 'manualops',
              adapter: 'manual',
            },
            lifecycle: [],
            steps: [
              {
                key: 'prepare_workspace',
                label: 'Prepare Workspace',
                status: 'success',
                started_at: '2026-03-26T08:02:00Z',
                finished_at: '2026-03-26T08:03:00Z',
              },
              {
                key: 'verify_runtime_health',
                label: 'Verify Runtime Health',
                status: 'failed',
                detail: 'Container probe failed',
                started_at: '2026-03-26T08:06:00Z',
                finished_at: '2026-03-26T08:08:00Z',
              },
            ],
          }}
          loading={false}
          streamStatus="closed"
          logText={
            '2026-03-26T08:02:00Z step started: Prepare Workspace\n2026-03-26T08:02:02Z workspace ready\n2026-03-26T08:03:00Z step completed: Prepare Workspace\n2026-03-26T08:06:00Z step started: Verify Runtime Health\n2026-03-26T08:07:00Z error: probe failed\n2026-03-26T08:08:00Z step completed: Verify Runtime Health'
          }
          logUpdatedAt="2026-03-26T08:08:00Z"
          logTruncated={false}
          logViewportRef={{ current: null }}
          onLogScroll={vi.fn()}
          autoScrollEnabled
          onAutoScrollChange={vi.fn()}
          getUserLabel={item => item.user_email || '-'}
          getServerLabel={item => item.server_label || item.server_id}
          getServerHost={item => item.server_host || '-'}
          formatTime={value => value || '-'}
          onRefresh={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(screen.queryByText('Overview')).not.toBeInTheDocument()
    expect(screen.queryByText('Execution Stages')).not.toBeInTheDocument()
    expect(screen.queryByText('Execution Timeline')).not.toBeInTheDocument()
    expect(screen.queryByText('Full Execution Log')).not.toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/Total duration 7m 0s/i)).toBeInTheDocument()
    expect(screen.queryByText('Operation ID')).not.toBeInTheDocument()
    expect(screen.queryByText('Server Target')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More metadata' }))
    expect(screen.getByText('Operation ID')).toBeInTheDocument()
    expect(screen.getByText('Server Target')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /explain error/i }))
    expect(screen.getByText('Error Log')).toBeInTheDocument()
    expect(screen.getByText('Show all logs')).toBeInTheDocument()
    expect(screen.getByText('2026-03-26T08:07:00Z error: probe failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /prepare workspace/i }))
    expect(screen.getByText('Node execution log')).toBeInTheDocument()
    expect(screen.getByText(/workspace ready/i)).toBeInTheDocument()

    expect(screen.getByText('Verify Runtime Health')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /verify runtime health/i }))
    expect(screen.getByText('Node execution log')).toBeInTheDocument()
    expect(screen.getAllByText(/error: probe failed/i).length).toBeGreaterThan(0)
  })

  it('shows source-build attribution when the action spec includes source_build metadata', () => {
    render(
      <TooltipProvider>
        <ActionDetailContent
          operation={{
            id: 'act_source_build_1',
            server_id: 'local',
            server_label: 'Local Server',
            server_host: 'local',
            source: 'manualops',
            status: 'success',
            adapter: 'source_build',
            compose_project_name: 'source-build-demo',
            project_dir: '/srv/source-build-demo',
            rendered_compose: '',
            error_summary: '',
            created: '2026-04-01T08:00:00Z',
            updated: '2026-04-01T08:05:00Z',
            started_at: '2026-04-01T08:00:10Z',
            finished_at: '2026-04-01T08:05:00Z',
            spec: {
              source_build: {
                source_kind: 'uploaded-package',
                source_ref: 'upload://source-build-demo.tar.gz',
                builder_strategy: 'buildpacks',
                deploy_inputs: {
                  service_name: 'web',
                },
                artifact_publication: {
                  mode: 'local',
                  image_name: 'apps/source-build-demo',
                },
                build_result: {
                  local_image_ref: 'apps/source-build-demo:candidate',
                },
                publication_result: {
                  local_image_ref: 'apps/source-build-demo:candidate',
                },
              },
            },
            pipeline: {
              id: 'pipe_source_build_1',
              operation_id: 'act_source_build_1',
              family: 'provision',
              definition_key: 'provision.install.source_build',
              status: 'success',
              current_phase: 'completed',
              selector: { operation_type: 'install', source: 'manualops', adapter: 'source_build' },
              steps: [],
            },
            pipeline_family: 'provision',
            pipeline_definition_key: 'provision.install.source_build',
            pipeline_selector: {
              operation_type: 'install',
              source: 'manualops',
              adapter: 'source_build',
            },
            lifecycle: [],
            steps: [],
          }}
          loading={false}
          streamStatus="closed"
          logText=""
          logUpdatedAt="2026-04-01T08:05:00Z"
          logTruncated={false}
          logViewportRef={{ current: null }}
          onLogScroll={vi.fn()}
          autoScrollEnabled
          onAutoScrollChange={vi.fn()}
          getUserLabel={item => item.user_email || '-'}
          getServerLabel={item => item.server_label || item.server_id}
          getServerHost={item => item.server_host || '-'}
          formatTime={value => value || '-'}
          onRefresh={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(screen.getByText('Source Build')).toBeInTheDocument()
    expect(screen.getByText('uploaded-package')).toBeInTheDocument()
    expect(screen.getByText('buildpacks')).toBeInTheDocument()
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('upload://source-build-demo.tar.gz')).toBeInTheDocument()
    expect(screen.getByText('apps/source-build-demo:candidate')).toBeInTheDocument()
    expect(screen.getByText('web')).toBeInTheDocument()
  })
})
