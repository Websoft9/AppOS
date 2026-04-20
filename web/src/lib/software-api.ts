// Software delivery API client — operation queries and component action triggers.
// Backend: /api/servers/{serverId}/software

import { pb } from '@/lib/pb'

// ─── Types ────────────────────────────────────────────────────────────────────

export type SoftwareActionType = 'install' | 'upgrade' | 'verify' | 'repair'
export type InstalledState = 'installed' | 'not_installed' | 'unknown'
export type VerificationState = 'healthy' | 'degraded' | 'unknown'
export type TemplateKind = 'package' | 'script' | 'binary'

export type OperationPhase =
  | 'accepted'
  | 'preflight'
  | 'executing'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'attention_required'

export type TerminalStatusType = 'none' | 'success' | 'failed'

export interface SoftwareLastAction {
  action: string
  result: string
  at: string
}

export interface SoftwareLastOperation {
  action: SoftwareActionType
  phase: OperationPhase
  terminal_status: TerminalStatusType
  failure_reason?: string
  updated_at: string
}

export interface TargetReadinessResult {
  ok: boolean
  os_supported: boolean
  privilege_ok: boolean
  network_ok: boolean
  dependency_ready: boolean
  issues?: string[]
}

export interface SoftwareVerificationResult {
  state: VerificationState
  checked_at: string
  reason?: string
  details?: Record<string, unknown>
}

export interface SoftwareOperation {
  id: string
  server_id: string
  component_key: string
  action: SoftwareActionType
  phase: OperationPhase
  terminal_status: TerminalStatusType
  failure_reason: string
  created: string
  updated: string
}

export interface SoftwareComponentSummary {
  component_key: string
  label: string
  target_type: 'server' | 'local'
  template_kind: TemplateKind
  installed_state: InstalledState
  detected_version?: string
  packaged_version?: string
  verification_state: VerificationState
  available_actions: SoftwareActionType[]
  last_action?: SoftwareLastAction
  last_operation?: SoftwareLastOperation
  preflight?: TargetReadinessResult
}

export interface SoftwareComponentDetail extends SoftwareComponentSummary {
  service_name?: string
  binary_path?: string
  config_path?: string
  verification?: SoftwareVerificationResult
}

export interface CapabilityStatus {
  capability: string
  component_key: string
  installed_state: InstalledState
  ready: boolean
  readiness: TargetReadinessResult
}

export interface AsyncCommandResponse {
  accepted: boolean
  operation_id?: string
  phase?: OperationPhase
  message?: string
}

// ─── Path Helpers ─────────────────────────────────────────────────────────────

function softwareBasePath(serverId: string): string {
  return `/api/servers/${serverId}/software`
}

function localSoftwareBasePath(): string {
  return '/api/software/local'
}

// ─── API Functions ────────────────────────────────────────────────────────────

export async function listSoftwareOperations(
  serverId: string,
  componentKey?: string
): Promise<SoftwareOperation[]> {
  const base = `${softwareBasePath(serverId)}/operations`
  const url = componentKey ? `${base}?component=${encodeURIComponent(componentKey)}` : base
  const response = await pb.send<{ items: SoftwareOperation[] }>(url, { method: 'GET' })
  return response.items ?? []
}

export async function listSoftwareComponents(serverId: string): Promise<SoftwareComponentSummary[]> {
  const response = await pb.send<{ items: SoftwareComponentSummary[] }>(
    softwareBasePath(serverId),
    { method: 'GET' }
  )
  return response.items ?? []
}

export async function getSoftwareComponent(
  serverId: string,
  componentKey: string
): Promise<SoftwareComponentDetail> {
  return pb.send<SoftwareComponentDetail>(
    `${softwareBasePath(serverId)}/${encodeURIComponent(componentKey)}`,
    { method: 'GET' }
  )
}

export async function listLocalSoftwareComponents(): Promise<SoftwareComponentSummary[]> {
  const response = await pb.send<{ items: SoftwareComponentSummary[] }>(localSoftwareBasePath(), {
    method: 'GET',
  })
  return response.items ?? []
}

export async function getLocalSoftwareComponent(componentKey: string): Promise<SoftwareComponentDetail> {
  return pb.send<SoftwareComponentDetail>(
    `${localSoftwareBasePath()}/${encodeURIComponent(componentKey)}`,
    { method: 'GET' }
  )
}

export async function listSoftwareCapabilities(serverId: string): Promise<CapabilityStatus[]> {
  const response = await pb.send<{ items: CapabilityStatus[] }>(
    `${softwareBasePath(serverId)}/capabilities`,
    { method: 'GET' }
  )
  return response.items ?? []
}

export async function getSoftwareOperation(
  serverId: string,
  operationId: string
): Promise<SoftwareOperation> {
  return pb.send<SoftwareOperation>(
    `${softwareBasePath(serverId)}/operations/${operationId}`,
    { method: 'GET' }
  )
}

export async function invokeSoftwareAction(
  serverId: string,
  componentKey: string,
  action: SoftwareActionType
): Promise<AsyncCommandResponse> {
  return pb.send<AsyncCommandResponse>(
    `${softwareBasePath(serverId)}/${encodeURIComponent(componentKey)}/${action}`,
    { method: 'POST' }
  )
}
