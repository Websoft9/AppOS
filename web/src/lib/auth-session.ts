import { ClientResponseError } from 'pocketbase'
import { pb } from '@/lib/pb'

export const SESSION_EXPIRED_REASON = 'session-expired'
const SESSION_EXPIRED_MESSAGE = 'Session expired. Please sign in again.'

export class SessionExpiredError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE) {
    super(message)
    this.name = 'SessionExpiredError'
  }
}

export function isSessionExpiredError(error: unknown): error is SessionExpiredError {
  return (
    error instanceof SessionExpiredError ||
    (error instanceof Error && error.name === 'SessionExpiredError')
  )
}

type SessionExpiryHandlerDeps = {
  clearAuth: () => void
  getCurrentPath: () => string
  assign: (url: string) => void
}

type PatchedFetch = typeof fetch & {
  __apposAuthPatched?: boolean
}

export function authenticatedHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers)
  if (pb.authStore.token) {
    merged.set('Authorization', pb.authStore.token)
  }
  return merged
}

export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    headers: authenticatedHeaders(init?.headers),
  })
}

function trimPath(value: string): string {
  return value.trim()
}

export function getSessionExpiredMessage(): string {
  return SESSION_EXPIRED_MESSAGE
}

export function buildSessionExpiryLoginUrl(currentPath: string): string {
  const params = new URLSearchParams()
  params.set('reason', SESSION_EXPIRED_REASON)

  const normalizedPath = trimPath(currentPath)
  if (normalizedPath !== '' && !normalizedPath.startsWith('/login')) {
    params.set('redirect', normalizedPath)
  }

  return `/login?${params.toString()}`
}

export function isUnauthorizedResponseStatus(status: number): boolean {
  return status === 401
}

export function isSessionExpiredPocketBaseError(error: unknown): boolean {
  if (!(error instanceof ClientResponseError) || error.isAbort) {
    return false
  }
  if (error.status === 401) {
    return true
  }

  const responseText = (() => {
    try {
      return JSON.stringify(error.response ?? {})
    } catch {
      return ''
    }
  })()
  const haystack = `${error.message} ${responseText}`.toLowerCase()
  return haystack.includes('valid record authorization token')
}

export function createSessionExpiryHandler(deps: SessionExpiryHandlerDeps) {
  let inProgress = false

  return {
    handle(): boolean {
      if (inProgress) {
        return false
      }

      inProgress = true
      const currentPath = deps.getCurrentPath()
      const loginURL = buildSessionExpiryLoginUrl(currentPath)
      deps.clearAuth()
      deps.assign(loginURL)
      return true
    },
    isInProgress(): boolean {
      return inProgress
    },
    reset() {
      inProgress = false
    },
  }
}

function currentBrowserPath(): string {
  if (typeof window === 'undefined') {
    return ''
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

let sessionExpiryNavigationAdapter = (url: string) => {
  if (typeof window === 'undefined') {
    return
  }
  window.location.assign(url)
}

const browserSessionExpiryHandler = createSessionExpiryHandler({
  clearAuth: () => {
    pb.authStore.clear()
  },
  getCurrentPath: () => currentBrowserPath(),
  assign: url => {
    const currentPath = currentBrowserPath()
    if (currentPath === url) {
      return
    }
    sessionExpiryNavigationAdapter(url)
  },
})

function toHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const merged = new Headers()

  if (typeof Request !== 'undefined' && input instanceof Request) {
    input.headers.forEach((value, key) => merged.set(key, value))
  }
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => merged.set(key, value))
  }

  return merged
}

function requestUsesAuthToken(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (!pb.authStore.token) {
    return false
  }
  const authorization = toHeaders(input, init).get('Authorization')
  return typeof authorization === 'string' && authorization.trim() !== ''
}

export function handleRuntimeSessionExpiry(): boolean {
  return browserSessionExpiryHandler.handle()
}

export function resetRuntimeSessionExpiryState() {
  browserSessionExpiryHandler.reset()
}

export function setSessionExpiryNavigationAdapterForTests(assign: (url: string) => void) {
  sessionExpiryNavigationAdapter = assign
}

export function resetSessionExpiryNavigationAdapterForTests() {
  sessionExpiryNavigationAdapter = url => {
    if (typeof window === 'undefined') {
      return
    }
    window.location.assign(url)
  }
}

export function installAuthRuntimeGuards() {
  const sendRef = pb.send as (typeof pb.send & { __apposAuthPatched?: boolean }) | undefined
  if (typeof sendRef === 'function' && !sendRef.__apposAuthPatched) {
    const originalSend = pb.send.bind(pb)
    const wrappedSend = (async (...args: Parameters<typeof pb.send>) => {
      try {
        return await originalSend(...args)
      } catch (error) {
        if (isSessionExpiredPocketBaseError(error)) {
          handleRuntimeSessionExpiry()
          throw new SessionExpiredError()
        }
        throw error
      }
    }) as typeof pb.send & { __apposAuthPatched?: boolean }
    wrappedSend.__apposAuthPatched = true
    pb.send = wrappedSend
  }

  if (typeof window === 'undefined' || typeof globalThis.fetch !== 'function') {
    return
  }

  const currentFetch = globalThis.fetch as PatchedFetch
  if (currentFetch.__apposAuthPatched) {
    return
  }

  const originalFetch = currentFetch.bind(globalThis)
  const wrappedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init)
    if (requestUsesAuthToken(input, init) && isUnauthorizedResponseStatus(response.status)) {
      handleRuntimeSessionExpiry()
      throw new SessionExpiredError()
    }
    return response
  }) as PatchedFetch
  wrappedFetch.__apposAuthPatched = true
  globalThis.fetch = wrappedFetch
}