import { type ConnectTerminalGroup, type TunnelPortRange } from './-settings-sections/types'

export type ShowToast = (message: string, ok?: boolean) => void

export function extractFieldError(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (value && typeof value === 'object') {
    const maybeObj = value as Record<string, unknown>
    if (typeof maybeObj.message === 'string' && maybeObj.message.trim()) {
      return maybeObj.message.trim()
    }
    if (typeof maybeObj.code === 'string' && maybeObj.code.trim()) {
      return maybeObj.code.trim()
    }
  }
  return null
}

export function parseConnectTerminalApiErrors(
  payload: unknown
): Partial<Record<keyof ConnectTerminalGroup, string>> {
  const parsed: Partial<Record<keyof ConnectTerminalGroup, string>> = {}
  if (!payload || typeof payload !== 'object') {
    return parsed
  }

  const root = payload as Record<string, unknown>
  const bag =
    root.errors && typeof root.errors === 'object' ? (root.errors as Record<string, unknown>) : root

  const idleError = extractFieldError(bag.idleTimeoutSeconds)
  if (idleError) {
    parsed.idleTimeoutSeconds = idleError
  }

  const maxError = extractFieldError(bag.maxConnections)
  if (maxError) {
    parsed.maxConnections = maxError
  }

  return parsed
}

export function parseTunnelPortRangeApiErrors(
  payload: unknown
): Partial<Record<keyof TunnelPortRange, string>> {
  const parsed: Partial<Record<keyof TunnelPortRange, string>> = {}
  if (!payload || typeof payload !== 'object') {
    return parsed
  }

  const root = payload as Record<string, unknown>
  const bag =
    root.errors && typeof root.errors === 'object' ? (root.errors as Record<string, unknown>) : root

  const startError = extractFieldError(bag.start)
  if (startError) {
    parsed.start = startError
  }

  const endError = extractFieldError(bag.end)
  if (endError) {
    parsed.end = endError
  }

  return parsed
}
