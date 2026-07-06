export const REACHABILITY_STALE_MULTIPLIER = 2
export const MIN_REACHABILITY_STALE_MINUTES = 5

export function resolveReachabilityStaleAfterMs(intervalMinutes?: number | null) {
  const normalizedInterval = Math.max(Number(intervalMinutes ?? 0) || 1, 1)
  const staleMinutes = Math.max(
    normalizedInterval * REACHABILITY_STALE_MULTIPLIER,
    MIN_REACHABILITY_STALE_MINUTES
  )
  return staleMinutes * 60 * 1000
}

export function isReachabilityStale(
  checkedAt?: string | null,
  staleAfterMs = resolveReachabilityStaleAfterMs(),
  nowMs = Date.now()
) {
  const normalized = String(checkedAt ?? '').trim()
  if (!normalized) {
    return true
  }
  const checkedAtMs = Date.parse(normalized)
  if (Number.isNaN(checkedAtMs)) {
    return true
  }
  return nowMs-checkedAtMs > staleAfterMs
}

export function shouldBackgroundProbeReachability(
  checkedAt?: string | null,
  staleAfterMs = resolveReachabilityStaleAfterMs(),
  nowMs = Date.now()
) {
  return isReachabilityStale(checkedAt, staleAfterMs, nowMs)
}