import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '@/lib/pb'
import type { ProductWithCategories } from '@/lib/store-types'
import { iacLibraryCopy, iacEnsureCustomAppTemplate, iacUploadExtraFiles } from '@/lib/iac-api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomApp {
  id: string
  key: string
  trademark: string
  logo_url: string | null
  overview: string
  description: string | null
  category_keys: string[] | null
  compose_yaml: string
  env_text: string | null
  visibility: 'private' | 'shared'
  created_by: string
  created: string
  updated: string
}

export interface CustomAppFormData {
  key: string
  trademark: string
  logo_url: string
  overview: string
  description: string
  category_keys: string[]
  compose_yaml: string
  env_text: string
  visibility: 'private' | 'shared'
  /** When creating from an existing library app, pass the source app key so we copy the entire folder first */
  basedOnKey?: string
  /** Extra files to upload to templates/{key}/ via IAC — NOT stored in PocketBase */
  extraFiles?: File[]
}

// ─── Query ────────────────────────────────────────────────────────────────────

export const CUSTOM_APPS_KEY = ['store_custom_apps'] as const

export function useCustomApps() {
  return useQuery({
    queryKey: CUSTOM_APPS_KEY,
    queryFn: () =>
      pb.collection('store_custom_apps').getFullList<CustomApp>(),
    staleTime: 60 * 1000,
  })
}

// ─── Creator display name ─────────────────────────────────────────────────────

export function getCreatorName(
  app: CustomApp,
  currentUserId: string,
  t?: (key: string) => string,
): string {
  if (app.created_by === currentUserId) return t ? t('customApp.you') : 'You'
  // created_by is a plain ID string; no expand available
  return t ? t('customApp.unknown') : 'Unknown'
}

// Adapter: convert CustomApp to ProductWithCategories so AppDetailModal can be reused
export function customAppToProduct(app: CustomApp): ProductWithCategories {
  return {
    sys: { id: app.id },
    key: app.key,
    trademark: app.trademark,
    overview: app.overview,
    summary: app.overview,
    description: app.description ?? undefined,
    logo: app.logo_url ? { imageurl: app.logo_url } : undefined,
    catalogCollection: { items: [] },
    primaryCategoryKey: null,
    secondaryCategoryKeys: [],
  } as unknown as ProductWithCategories
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateCustomApp(
  onError?: (msg: string) => void,
  onIacError?: (msg: string) => void,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (data: CustomAppFormData) => {
      const { extraFiles, basedOnKey, ...pbData } = data
      const app = await pb.collection('store_custom_apps').create<CustomApp>({
        ...pbData,
        category_keys: pbData.category_keys,
        created_by: pb.authStore.record?.id ?? '',
      })
      // Write files to templates/{key}/ via IAC (best-effort — non-blocking on failure)
      try {
        if (basedOnKey) {
          // Copy the whole library/apps/{basedOnKey}/ → templates/{app.key}/
          await iacLibraryCopy(basedOnKey, app.key)
        }
        // Overlay user-modified compose & env (creates dir if library copy was skipped)
        await iacEnsureCustomAppTemplate(app.key, pbData.compose_yaml, pbData.env_text)
        if (extraFiles && extraFiles.length > 0) {
          const failed = await iacUploadExtraFiles(app.key, extraFiles)
          if (failed.length > 0) {
            onIacError?.(`Failed to upload: ${failed.join(', ')}`)
          }
        }
      } catch {
        onIacError?.('Template directory could not be created (superuser access required).')
      }
      return app
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CUSTOM_APPS_KEY }),
    onError: () => onError?.('Failed to create custom app. Please try again.'),
  })
}

export function useUpdateCustomApp(
  onError?: (msg: string) => void,
  onIacError?: (msg: string) => void,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CustomAppFormData> }) => {
      const { extraFiles, basedOnKey: _, ...pbData } = data
      const app = await pb.collection('store_custom_apps').update<CustomApp>(id, pbData)
      // Sync files to templates/apps/{key}/ via IAC (best-effort)
      try {
        await iacEnsureCustomAppTemplate(app.key, pbData.compose_yaml, pbData.env_text)
        if (extraFiles && extraFiles.length > 0) {
          const failed = await iacUploadExtraFiles(app.key, extraFiles)
          if (failed.length > 0) {
            onIacError?.(`Failed to upload: ${failed.join(', ')}`)
          }
        }
      } catch {
        onIacError?.('Template files could not be updated (superuser access required).')
      }
      return app
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CUSTOM_APPS_KEY }),
    onError: () => onError?.('Failed to update custom app. Please try again.'),
  })
}

export function useDeleteCustomApp(onError?: (msg: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => pb.collection('store_custom_apps').delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CUSTOM_APPS_KEY }),
    onError: () => onError?.('Failed to delete custom app. Please try again.'),
  })
}
