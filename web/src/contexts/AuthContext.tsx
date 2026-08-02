import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import { pb } from '@/lib/pb'
import {
  forceRuntimeSessionExpiry,
  installAuthRuntimeGuards,
  resetRuntimeSessionExpiryState,
} from '@/lib/auth-session'
import type { RecordModel } from 'pocketbase'
import { ClientResponseError } from 'pocketbase'
import { queryClient } from '@/main'

const SESSION_REFRESH_INTERVAL_MS = 5 * 60_000
const SESSION_ACTIVITY_WINDOW_MS = 10 * 60_000

interface AuthContextType {
  user: RecordModel | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

/** Check if a PocketBase SDK error is a network/connection error (status 0). */
function isNetworkError(err: unknown): boolean {
  return err instanceof ClientResponseError && err.status === 0
}

// Try authRefresh on the collection that issued the stored token.
// authStore.record.collectionName tells us which collection the token belongs to.
async function tryAuthRefresh() {
  const collection = pb.authStore.record?.collectionName
  if (collection) {
    return await pb.collection(collection).authRefresh()
  }
  // Fallback: try _superusers first, then users
  try {
    return await pb.collection('_superusers').authRefresh()
  } catch (err) {
    if (isNetworkError(err)) throw err
    return await pb.collection('users').authRefresh()
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<RecordModel | null>(pb.authStore.record)
  const [isLoading, setIsLoading] = useState(true)
  const lastActivityAtRef = useRef(Date.now())

  const handleSessionExpiry = useCallback(() => {
    void queryClient.cancelQueries()
    queryClient.clear()
    setUser(null)
    setIsLoading(false)
    forceRuntimeSessionExpiry()
  }, [])

  useEffect(() => {
    installAuthRuntimeGuards()
  }, [])

  // On mount: verify stored token with server
  useEffect(() => {
    const verify = async () => {
      if (!pb.authStore.isValid) {
        setUser(null)
        setIsLoading(false)
        return
      }
      try {
        const result = await tryAuthRefresh()
        resetRuntimeSessionExpiryState()
        setUser(result.record)
      } catch {
        pb.authStore.clear()
        handleSessionExpiry()
      } finally {
        setIsLoading(false)
      }
    }
    verify()
  }, [])

  // Reactive: sync on any authStore change
  useEffect(() => {
    return pb.authStore.onChange((_token, record) => {
      if (record) {
        resetRuntimeSessionExpiryState()
        lastActivityAtRef.current = Date.now()
      } else if (!isLoading) {
        handleSessionExpiry()
      }
      setUser(record)
    })
  }, [handleSessionExpiry, isLoading])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const markActivity = () => {
      lastActivityAtRef.current = Date.now()
    }

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'focus']
    events.forEach(eventName => window.addEventListener(eventName, markActivity, { passive: true }))

    return () => {
      events.forEach(eventName => window.removeEventListener(eventName, markActivity))
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    let cancelled = false
    const maybeRefreshSession = async () => {
      if (cancelled || !pb.authStore.isValid || document.visibilityState !== 'visible') return
      if (Date.now() - lastActivityAtRef.current > SESSION_ACTIVITY_WINDOW_MS) return

      try {
        const result = await tryAuthRefresh()
        if (cancelled) return
        resetRuntimeSessionExpiryState()
        setUser(result.record)
      } catch {
        if (cancelled) return
        pb.authStore.clear()
        handleSessionExpiry()
      }
    }

    const timer = window.setInterval(() => {
      void maybeRefreshSession()
    }, SESSION_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [handleSessionExpiry])

  // Login: try _superusers first, then users.
  // Distinguish network errors (throw immediately) from auth errors (try next collection).
  const login = useCallback(async (email: string, password: string) => {
    try {
      const result = await pb.collection('_superusers').authWithPassword(email, password)
      setUser(result.record)
      return
    } catch (err) {
      if (isNetworkError(err)) {
        throw new Error('Unable to connect to server')
      }
      // Auth failure (400) → try users collection
    }
    try {
      const result = await pb.collection('users').authWithPassword(email, password)
      setUser(result.record)
    } catch (err) {
      if (isNetworkError(err)) {
        throw new Error('Unable to connect to server')
      }
      throw new Error('Invalid email or password')
    }
  }, [])

  const logout = useCallback(() => {
    pb.authStore.clear()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
