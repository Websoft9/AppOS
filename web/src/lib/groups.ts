/**
 * Shared types and helpers for the Groups module.
 */

import { getLocale } from '@/lib/i18n'

// ─── Types ───────────────────────────────────────────────

export interface GroupRecord {
  id: string
  name: string
  description: string
  created_by: string
  created: string
  updated: string
}

export interface GroupItemRecord {
  id: string
  group_id: string
  object_type: string
  object_id: string
  created: string
  updated: string
}

/** Generic PocketBase list response */
export interface PBList<T> {
  items: T[]
  totalItems: number
}

// ─── Helpers ─────────────────────────────────────────────

/** Format ISO date string to locale-aware short date */
export function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const bcp47 = getLocale() === 'zh' ? 'zh-CN' : 'en-US'
  return d.toLocaleDateString(bcp47, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Display creator — show email for current user, truncated ID for others */
export function formatCreator(
  createdBy: string | undefined,
  currentUserId: string | undefined,
  currentUserEmail: string | undefined
): string {
  if (!createdBy) return '—'
  if (currentUserId === createdBy) return currentUserEmail ?? '—'
  return createdBy.slice(0, 8) + '…'
}

/**
 * Escape a value for use inside a PocketBase filter expression.
 * Replaces single quotes with escaped quotes to prevent filter injection.
 */
export function pbFilterValue(value: string): string {
  return value.replace(/'/g, "\\'")
}

/** Build detail link from route template */
export function buildDetailLink(detailRoute: string, objectId: string): string {
  return detailRoute.replace('$id', objectId)
}
