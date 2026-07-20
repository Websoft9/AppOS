import { pb } from '@/lib/pb'

export type MediaCategory = 'branding' | 'avatar' | 'general'
export type MediaScope = 'public' | 'private'
export type MediaOwnerType = 'system' | 'user' | 'other'

export type MediaRecord = {
  id: string
  category: MediaCategory
  scope: MediaScope
  owner_type: MediaOwnerType
  owner_id: string
  original_name: string
  content_type: string
  size: number
  storage_path: string
  public_url: string
  created_by: string
  created: string
  updated: string
}

export async function uploadMedia(params: {
  file: File
  category: MediaCategory
  scope?: MediaScope
  ownerType?: MediaOwnerType
  ownerId?: string
}) {
  const form = new FormData()
  form.append('file', params.file)
  form.append('category', params.category)
  form.append('scope', params.scope ?? 'public')
  form.append('owner_type', params.ownerType ?? 'other')
  if (params.ownerId) {
    form.append('owner_id', params.ownerId)
  }
  return (await pb.send('/api/media', {
    method: 'POST',
    body: form,
  })) as MediaRecord
}
