import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '@/lib/pb'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UserApp {
  id: string
  user: string
  app_key: string
  is_favorite: boolean
  note: string | null
  created: string
  updated: string
}

interface CatalogPersonalizationItem {
  appKey: string
  isFavorite: boolean
  note?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

interface CatalogPersonalizationListResponse {
  items: CatalogPersonalizationItem[]
}

function toUserApp(item: CatalogPersonalizationItem): UserApp {
  return {
    id: item.appKey,
    user: pb.authStore.record?.id ?? '',
    app_key: item.appKey,
    is_favorite: item.isFavorite,
    note: item.note ?? null,
    created: item.createdAt ?? '',
    updated: item.updatedAt ?? '',
  }
}

// ─── Query ────────────────────────────────────────────────────────────────────

export const USER_APPS_KEY = ['store_user_apps'] as const

export function useUserApps() {
  return useQuery({
    queryKey: USER_APPS_KEY,
    queryFn: async () => {
      const response = await pb.send('/api/catalog/me/apps', {
        method: 'GET',
      }) as CatalogPersonalizationListResponse
      return response.items.map(toUserApp)
    },
    staleTime: Infinity, // loaded once; invalidated on mutations
  })
}

// ─── Toggle Favorite ─────────────────────────────────────────────────────────

export function useToggleFavorite(onError?: (msg: string) => void) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ appKey, userApps }: { appKey: string; userApps: UserApp[] }) => {
      const existing = userApps.find(a => a.app_key === appKey)
      const response = await pb.send(`/api/catalog/me/apps/${encodeURIComponent(appKey)}/favorite`, {
        method: 'PUT',
        body: {
          isFavorite: existing ? !existing.is_favorite : true,
        },
      }) as CatalogPersonalizationItem
      return toUserApp(response)
    },
    // Optimistic update
    onMutate: async ({ appKey, userApps }) => {
      await queryClient.cancelQueries({ queryKey: USER_APPS_KEY })
      const prev = queryClient.getQueryData<UserApp[]>(USER_APPS_KEY)
      const existing = userApps.find(a => a.app_key === appKey)

      queryClient.setQueryData<UserApp[]>(USER_APPS_KEY, (old = []) => {
        if (existing) {
          return old.map(a => (a.app_key === appKey ? { ...a, is_favorite: !a.is_favorite } : a))
        }
        return [
          ...old,
          {
            id: '__optimistic__',
            user: pb.authStore.record?.id ?? '',
            app_key: appKey,
            is_favorite: true,
            note: null,
            created: '',
            updated: '',
          },
        ]
      })
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(USER_APPS_KEY, ctx?.prev)
      onError?.('Failed to update favorite. Please try again.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: USER_APPS_KEY }),
  })
}

// ─── Save Note ────────────────────────────────────────────────────────────────

export function useSaveNote(onError?: (msg: string) => void) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      appKey,
      note,
      userApps: _userApps,
    }: {
      appKey: string
      note: string | null
      userApps: UserApp[]
    }) => {
      if (note === null || note.trim() === '') {
        const response = await pb.send(`/api/catalog/me/apps/${encodeURIComponent(appKey)}/note`, {
          method: 'DELETE',
        }) as CatalogPersonalizationItem
        return toUserApp(response)
      }
      const response = await pb.send(`/api/catalog/me/apps/${encodeURIComponent(appKey)}/note`, {
        method: 'PUT',
        body: { note },
      }) as CatalogPersonalizationItem
      return toUserApp(response)
    },
    onError: () => onError?.('Failed to save note. Please try again.'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: USER_APPS_KEY }),
  })
}
