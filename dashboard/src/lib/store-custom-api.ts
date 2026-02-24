import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '@/lib/pb'
import type { ProductWithCategories } from '@/lib/store-types'

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
  expand?: {
    created_by?: { id: string; name?: string; email?: string }
  }
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
}

// ─── Query ────────────────────────────────────────────────────────────────────

export const CUSTOM_APPS_KEY = ['store_custom_apps'] as const

export function useCustomApps() {
  return useQuery({
    queryKey: CUSTOM_APPS_KEY,
    queryFn: () =>
      pb.collection('store_custom_apps').getFullList<CustomApp>({
        expand: 'created_by',
      }),
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
  return app.expand?.created_by?.name || app.expand?.created_by?.email || (t ? t('customApp.unknown') : 'Unknown')
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

export function useCreateCustomApp(onError?: (msg: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CustomAppFormData) =>
      pb.collection('store_custom_apps').create<CustomApp>({
        ...data,
        category_keys: data.category_keys,
        created_by: pb.authStore.record?.id ?? '',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CUSTOM_APPS_KEY }),
    onError: () => onError?.('Failed to create custom app. Please try again.'),
  })
}

export function useUpdateCustomApp(onError?: (msg: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CustomAppFormData> }) =>
      pb.collection('store_custom_apps').update<CustomApp>(id, data),
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
