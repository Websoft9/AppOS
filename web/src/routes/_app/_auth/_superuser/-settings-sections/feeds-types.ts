export interface FeedsPolicyGroup {
  pollIntervalHours: number
  failureBackoffMaxHours: number
  perSourceRetentionCap: number
  globalRetentionCap: number
}

export const DEFAULT_FEEDS_POLICY: FeedsPolicyGroup = {
  pollIntervalHours: 3,
  failureBackoffMaxHours: 24,
  perSourceRetentionCap: 100,
  globalRetentionCap: 10000,
}
