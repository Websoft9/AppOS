import type { RecordModel } from 'pocketbase'

/** Auth record as returned by PocketBase list / view endpoints. */
export interface AuthRecord extends RecordModel {
  email: string
  name?: string
  avatar?: string
  verified: boolean
  emailVisibility?: boolean
  collectionName: string
}

/** Escape a value for use inside a PocketBase filter string. */
export function escapeFilter(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
