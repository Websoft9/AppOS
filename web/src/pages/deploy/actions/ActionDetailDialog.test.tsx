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
        />
      </TooltipProvider>
    )

    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText(/Total duration 7m 0s/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /more metadata/i }))
    expect(screen.getByText('Operation ID')).toBeInTheDocument()
    expect(screen.getByText('Server Target')).toBeInTheDocument()
    expect(screen.getByText('act_1')).toBeInTheDocument()
    expect(screen.getAllByText('Demo Server').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /explain error/i }))
    expect(screen.getByRole('tab', { name: 'Steps' })).toBeInTheDocument()

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

  it('auto-expands the running stage and shows pull progress without a separate active panel', () => {
    render(
      <TooltipProvider>
        <ActionDetailContent
          operation={{
            id: 'act_running_1',
            server_id: 'srv_1',
            server_label: 'Demo Server',
            server_host: '10.0.0.8',
            source: 'manualops',
            status: 'running',
            adapter: 'manual',
            compose_project_name: 'ghost-prod',
            project_dir: '/srv/ghost',
            rendered_compose: '',
            error_summary: '',
            created: '2026-03-26T08:00:00Z',
            updated: '2026-03-26T08:08:00Z',
            started_at: '2026-03-26T08:01:00Z',
            user_email: 'admin@example.com',
            pipeline: {
              id: 'pipe_running_1',
              operation_id: 'act_running_1',
              family: 'provision',
              definition_key: 'provision.install.manual_compose',
              status: 'active',
              current_phase: 'executing',
              selector: { operation_type: 'install', source: 'manualops', adapter: 'manual' },
              steps: [],
            },
            pipeline_family: 'provision',
            pipeline_definition_key: 'provision.install.manual_compose',
            pipeline_selector: {
              operation_type: 'install',
              source: 'manualops',
              adapter: 'manual',
            },
            lifecycle: [],
            steps: [
              {
                key: 'pull_runtime_images',
                label: 'Pull Runtime Images',
                status: 'running',
                started_at: '2026-03-26T08:06:00Z',
                execution_log:
                  '2026-03-26T08:06:00Z docker runtime pull: Image postgres:16 Pulling\n2026-03-26T08:06:03Z docker runtime pull: abcd1234ef56 Downloading 12.4MB\n2026-03-26T08:06:10Z docker runtime pull: abcd1234ef56 Pull complete 12.4MB',
              },
            ],
          }}
          loading={false}
          streamStatus="live"
          logText="2026-03-26T08:06:00Z step started: Pull Runtime Images\n2026-03-26T08:06:00Z docker runtime pull: Image postgres:16 Pulling"
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
        />
      </TooltipProvider>
    )

    expect(screen.getByText('Pull progress')).toBeInTheDocument()
    expect(screen.getByText('1/1 layers complete')).toBeInTheDocument()
    expect(screen.getByText('postgres:16: Pulling')).toBeInTheDocument()
    expect(screen.getByText('Pull Runtime Images')).toBeInTheDocument()
    expect(screen.getAllByText('Node execution log').length).toBeGreaterThan(0)
  })
})
