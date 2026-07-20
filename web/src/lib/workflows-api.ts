import { pb } from '@/lib/pb'

export type WorkflowDefinitionRecord = {
  id: string
  name: string
  description: string
  is_enabled: boolean
  definition_yaml: string
  default_server_id: string
  trigger_types_json: string
  node_count: number
  has_ai_nodes: boolean
  created_by: string
  created: string
  updated: string
}

export type WorkflowRunRecord = {
  id: string
  workflow_id: string
  definition_yaml: string
  status: string
  trigger_type: string
  execution_owner_id: string
  requested_by: string
  requested_by_email: string
  params_json: string
  resolved_server_id: string
  overlap_policy: string
  started_at: string
  ended_at: string
  error_message: string
  created: string
  updated: string
}

export type WorkflowNodeRunRecord = {
  id: string
  workflow_run_id: string
  node_key: string
  node_type: string
  display_name: string
  depends_on_json: string
  status: string
  retry_count: number
  output_json: string
  error_message: string
  execution_log: string
  execution_log_truncated: boolean
  started_at: string
  ended_at: string
  created: string
  updated: string
}

export type ServerOptionRecord = {
  id: string
  name?: string
  host?: string
  is_enabled?: boolean | string | number | null
}

const noAutoCancel = { requestKey: null }

export async function listWorkflows(): Promise<WorkflowDefinitionRecord[]> {
  const result = await pb.send<WorkflowDefinitionRecord[]>('/api/workflows', {
    ...noAutoCancel,
    method: 'GET',
  })
  return Array.isArray(result) ? result : []
}

export async function createWorkflow(payload: Partial<WorkflowDefinitionRecord>) {
  return pb.send<WorkflowDefinitionRecord>('/api/workflows', {
    ...noAutoCancel,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function updateWorkflow(id: string, payload: Partial<WorkflowDefinitionRecord>) {
  return pb.send<WorkflowDefinitionRecord>(`/api/workflows/${encodeURIComponent(id)}`, {
    ...noAutoCancel,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteWorkflow(id: string) {
  return pb.send<{ ok: boolean }>(`/api/workflows/${encodeURIComponent(id)}`, {
    ...noAutoCancel,
    method: 'DELETE',
  })
}

export async function runWorkflow(id: string, params: Record<string, unknown> = {}) {
  return pb.send<{ accepted: boolean; message?: string; run?: WorkflowRunRecord }>(
    `/api/workflows/${encodeURIComponent(id)}/run`,
    {
      ...noAutoCancel,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params }),
    }
  )
}

export async function listWorkflowRuns(workflowId: string): Promise<WorkflowRunRecord[]> {
  const result = await pb.send<WorkflowRunRecord[]>(
    `/api/workflows/${encodeURIComponent(workflowId)}/runs`,
    {
      ...noAutoCancel,
      method: 'GET',
    }
  )
  return Array.isArray(result) ? result : []
}

export async function listWorkflowNodeRuns(runId: string): Promise<WorkflowNodeRunRecord[]> {
  const result = await pb.send<WorkflowNodeRunRecord[]>(
    `/api/workflow-runs/${encodeURIComponent(runId)}/nodes`,
    {
      ...noAutoCancel,
      method: 'GET',
    }
  )
  return Array.isArray(result) ? result : []
}

export async function getWorkflowRun(runId: string) {
  return pb.send<WorkflowRunRecord>(`/api/workflow-runs/${encodeURIComponent(runId)}`, {
    ...noAutoCancel,
    method: 'GET',
  })
}

export async function listWorkflowServers(): Promise<ServerOptionRecord[]> {
  const result = await pb.send<{ items?: ServerOptionRecord[] }>('/api/servers/connection', {
    ...noAutoCancel,
    method: 'GET',
  })
  return Array.isArray(result?.items) ? result.items : []
}

export async function cancelWorkflowRun(runId: string) {
  return pb.send<WorkflowRunRecord>(`/api/workflow-runs/${encodeURIComponent(runId)}/cancel`, {
    ...noAutoCancel,
    method: 'POST',
  })
}

export async function approveWorkflowNode(runId: string, nodeKey: string) {
  return pb.send<WorkflowNodeRunRecord>(
    `/api/workflow-runs/${encodeURIComponent(runId)}/approve/${encodeURIComponent(nodeKey)}`,
    {
      ...noAutoCancel,
      method: 'POST',
    }
  )
}

export async function rejectWorkflowNode(runId: string, nodeKey: string) {
  return pb.send<WorkflowNodeRunRecord>(
    `/api/workflow-runs/${encodeURIComponent(runId)}/reject/${encodeURIComponent(nodeKey)}`,
    {
      ...noAutoCancel,
      method: 'POST',
    }
  )
}
