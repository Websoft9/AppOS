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

// ─── Query ────────────────────────────────────────────────────────────────────

export const USER_APPS_KEY = ['store_user_apps'] as const

export function useUserApps() {
  return useQuery({
    queryKey: USER_APPS_KEY,
    queryFn: () => pb.collection('store_user_apps').getFullList<UserApp>(),
    staleTime: Infinity, // loaded once; invalidated on mutations
  })
}

// ─── Toggle Favorite ─────────────────────────────────────────────────────────

export function useToggleFavorite(onError?: (msg: string) => void) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ appKey, userApps }: { appKey: string; userApps: UserApp[] }) => {
      const existing = userApps.find((a) => a.app_key === appKey)
      if (existing) {
        return pb.collection('store_user_apps').update<UserApp>(existing.id, {
          is_favorite: !existing.is_favorite,
        })
      }
      return pb.collection('store_user_apps').create<UserApp>({
        user: pb.authStore.record?.id ?? '',
        app_key: appKey,
        is_favorite: true,
        note: null,
      })
    },
    // Optimistic update
    onMutate: async ({ appKey, userApps }) => {
      await queryClient.cancelQueries({ queryKey: USER_APPS_KEY })
      const prev = queryClient.getQueryData<UserApp[]>(USER_APPS_KEY)
      const existing = userApps.find((a) => a.app_key === appKey)

      queryClient.setQueryData<UserApp[]>(USER_APPS_KEY, (old = []) => {
        if (existing) {
          return old.map((a) =>
            a.app_key === appKey ? { ...a, is_favorite: !a.is_favorite } : a,
          )
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
      userApps,
    }: {
      appKey: string
      note: string | null
      userApps: UserApp[]
    }) => {
      const existing = userApps.find((a) => a.app_key === appKey)
      if (existing) {
        return pb.collection('store_user_apps').update<UserApp>(existing.id, { note })
      }
      return pb.collection('store_user_apps').create<UserApp>({
        user: pb.authStore.record?.id ?? '',
        app_key: appKey,
        is_favorite: false,
        note,
      })
    },
    onError: () => onError?.('Failed to save note. Please try again.'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: USER_APPS_KEY }),
  })
}
