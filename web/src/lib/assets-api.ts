import { pb } from '@/lib/pb'
import type { ScriptLanguage } from '@/lib/assets-script-languages'

export type AssetKind = 'script' | 'skill'
export type AssetStorageKind = 'file' | 'folder'
export type AssetSourceKind = 'local' | 'reference'
export type { ScriptLanguage } from '@/lib/assets-script-languages'

export interface AssetRecord {
  id: string
  name: string
  description?: string
  kind: AssetKind
  storage_kind: AssetStorageKind
  source_kind: AssetSourceKind
  language?: ScriptLanguage | ''
  script_extension?: string
  reference?: string
  path: string
  entrypoint: string
  created?: string
  updated?: string
}

export interface AssetWriteRequest {
  name: string
  description?: string
  kind: AssetKind
  storage_kind: AssetStorageKind
  source_kind?: AssetSourceKind
  language?: ScriptLanguage
  script_extension?: string
  reference?: string
  path?: string
  entrypoint?: string
  content?: string
  files?: Record<string, string>
}

export interface AssetFileContentResponse {
  id: string
  storage_kind: 'file'
  path: string
  entrypoint: string
  content: string
}

export interface AssetFolderContentItem {
  path: string
  content: string
}

export interface AssetFolderContentResponse {
  id: string
  storage_kind: 'folder'
  path: string
  entrypoint: string
  files: AssetFolderContentItem[]
}

export type AssetContentResponse = AssetFileContentResponse | AssetFolderContentResponse

export interface ScriptPullResponse {
  content: string
}

export interface SkillPullResponse {
  entrypoint: string
  files: AssetFolderContentItem[]
}

const noAutoCancel = { requestKey: null }

export async function listAssets(): Promise<AssetRecord[]> {
  const result = await pb.send<AssetRecord[]>('/api/assets', noAutoCancel)
  return Array.isArray(result) ? result : []
}

export async function createAsset(payload: AssetWriteRequest): Promise<AssetRecord> {
  return pb.send<AssetRecord>('/api/assets', {
    ...noAutoCancel,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function updateAsset(id: string, payload: AssetWriteRequest): Promise<AssetRecord> {
  return pb.send<AssetRecord>(`/api/assets/${encodeURIComponent(id)}`, {
    ...noAutoCancel,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteAsset(id: string): Promise<void> {
  await pb.send(`/api/assets/${encodeURIComponent(id)}`, { ...noAutoCancel, method: 'DELETE' })
}

export async function getAssetContent(id: string): Promise<AssetContentResponse> {
  return pb.send<AssetContentResponse>(
    `/api/assets/${encodeURIComponent(id)}/content`,
    noAutoCancel
  )
}

export async function pullScriptReference(reference: string): Promise<ScriptPullResponse> {
  return pb.send<ScriptPullResponse>('/api/assets/script/pull', {
    ...noAutoCancel,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference }),
  })
}

export async function pullSkillReference(reference: string): Promise<SkillPullResponse> {
  return pb.send<SkillPullResponse>('/api/assets/skill/pull', {
    ...noAutoCancel,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference }),
  })
}
