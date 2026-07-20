import { getApiErrorMessage } from '@/lib/api-error'

const DEFAULT_SERVER_REALTIME_BUSY_RETRY_LIMIT = 3
const DEFAULT_SERVER_REALTIME_BUSY_RETRY_DELAY_MS = 250

function waitForServerRealtimeBusyRetry(delayMs: number) {
  return new Promise(resolve => {
    window.setTimeout(resolve, delayMs)
  })
}

export function isServerRealtimeBusyError(error: unknown) {
  const err = error as {
    status?: unknown
    response?: { status?: unknown; data?: { message?: unknown } }
  }

  const status = Number(err?.status ?? err?.response?.status)
  const message = getApiErrorMessage(error, '').toLowerCase()
  return status === 503 && message.includes('already processing request')
}

export async function runWithServerRealtimeBusyRetry<T>(
  task: () => Promise<T>,
  options?: {
    retries?: number
    delayMs?: number
    shouldRetry?: () => boolean
  }
) {
  const retries = options?.retries ?? DEFAULT_SERVER_REALTIME_BUSY_RETRY_LIMIT
  const delayMs = options?.delayMs ?? DEFAULT_SERVER_REALTIME_BUSY_RETRY_DELAY_MS
  let lastError: unknown

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (!isServerRealtimeBusyError(error) || attempt >= retries - 1) {
        throw error
      }
      if (options?.shouldRetry && !options.shouldRetry()) {
        throw error
      }
      await waitForServerRealtimeBusyRetry(delayMs)
      if (options?.shouldRetry && !options.shouldRetry()) {
        throw error
      }
    }
  }

  throw lastError
}
