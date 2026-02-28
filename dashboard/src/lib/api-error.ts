type ErrorPayload = {
  message?: unknown
  data?: {
    error?: unknown
    message?: unknown
  }
}

function normalizeString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const err = error as {
    message?: unknown
    response?: ErrorPayload
    data?: ErrorPayload['data']
    status?: unknown
    originalError?: unknown
  }

  const topMessage = normalizeString(err?.message)
  const responseMessage = normalizeString(err?.response?.message)
  const responseDataMessage = normalizeString(err?.response?.data?.message)
  const dataMessage = normalizeString(err?.data?.message)
  const detail = normalizeString(err?.response?.data?.error || err?.data?.error)
  const statusText = normalizeString(err?.status)

  const baseMessage = responseMessage || responseDataMessage || dataMessage || topMessage

  if (baseMessage && detail && !baseMessage.includes(detail)) {
    return `${baseMessage}: ${detail}`
  }
  if (baseMessage) return baseMessage
  if (detail) return detail

  if (error instanceof Error && error.message) {
    return error.message
  }

  if (statusText) {
    return `${fallback} (status ${statusText})`
  }

  return fallback
}