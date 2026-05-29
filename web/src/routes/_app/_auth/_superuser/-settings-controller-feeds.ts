import { useCallback, useState } from 'react'
import { ClientResponseError } from 'pocketbase'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { settingsEntryPath } from '@/lib/settings-api'
import {
  DEFAULT_FEEDS_POLICY,
  type FeedsPolicyGroup,
} from './-settings-sections/feeds-types'
import { extractFieldError, type ShowToast } from './-settings-controller-shared'

function clampDeleteCount(value: number, maxCount: number): number {
  if (!Number.isFinite(value)) {
    return maxCount > 0 ? 1 : 0
  }
  if (maxCount <= 0) {
    return 0
  }
  return Math.max(1, Math.min(maxCount, Math.floor(value)))
}

export function useFeedsSettingsController(showToast: ShowToast) {
  const [feedsPolicyForm, setFeedsPolicyForm] = useState<FeedsPolicyGroup>(DEFAULT_FEEDS_POLICY)
  const [feedsPolicySaving, setFeedsPolicySaving] = useState(false)
  const [feedsPolicyErrors, setFeedsPolicyErrors] = useState<
    Partial<Record<keyof FeedsPolicyGroup, string>>
  >({})
  const [feedsDeleteDialogOpen, setFeedsDeleteDialogOpen] = useState(false)
  const [feedsDeleteLoading, setFeedsDeleteLoading] = useState(false)
  const [feedsDeleteExecuting, setFeedsDeleteExecuting] = useState(false)
  const [feedsDeleteCount, setFeedsDeleteCount] = useState(0)
  const [feedsDeleteMaxCount, setFeedsDeleteMaxCount] = useState(0)

  const hydrateFeedsEntries = useCallback((entryMap: Map<string, unknown>) => {
    const feedsPolicy = (entryMap.get('feeds-policy') as Partial<FeedsPolicyGroup>) ?? {}
    setFeedsPolicyForm({
      ...DEFAULT_FEEDS_POLICY,
      ...feedsPolicy,
    })
  }, [])

  const saveFeedsPolicy = async () => {
    setFeedsPolicySaving(true)
    setFeedsPolicyErrors({})
    try {
      const res = (await pb.send(settingsEntryPath('feeds-policy'), {
        method: 'PATCH',
        body: feedsPolicyForm,
      })) as { value?: Partial<FeedsPolicyGroup> }
      setFeedsPolicyForm({
        ...DEFAULT_FEEDS_POLICY,
        ...(res.value ?? feedsPolicyForm),
      })
        showToast('Feeds saved')
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 422) {
        const bag =
          err.response?.errors && typeof err.response.errors === 'object'
            ? (err.response.errors as Record<string, unknown>)
            : {}
        setFeedsPolicyErrors({
          pollIntervalHours: extractFieldError(bag.pollIntervalHours) ?? undefined,
          failureBackoffMaxHours: extractFieldError(bag.failureBackoffMaxHours) ?? undefined,
          perSourceRetentionCap: extractFieldError(bag.perSourceRetentionCap) ?? undefined,
          globalRetentionCap: extractFieldError(bag.globalRetentionCap) ?? undefined,
        })
      }
      showToast('Failed: ' + (err instanceof Error ? err.message : String(err)), false)
    } finally {
      setFeedsPolicySaving(false)
    }
  }

  const openFeedsDeleteDialog = useCallback(async () => {
  setFeedsDeleteLoading(true)
  try {
    const response = await pb.send<{ totalItems: number }>('/api/feeds/summary', { method: 'GET' })
    const totalItems = response.totalItems ?? 0
    setFeedsDeleteMaxCount(totalItems)
    setFeedsDeleteCount(totalItems)
    setFeedsDeleteDialogOpen(true)
  } catch (err) {
    showToast(getApiErrorMessage(err, 'Failed to load current feed article totals'), false)
  } finally {
    setFeedsDeleteLoading(false)
  }
  }, [showToast])

  const closeFeedsDeleteDialog = useCallback(() => {
  setFeedsDeleteDialogOpen(false)
  setFeedsDeleteCount(0)
  }, [])

  const updateFeedsDeleteCount = useCallback((nextValue: number) => {
  setFeedsDeleteCount(current => {
    const base = Number.isFinite(nextValue) ? nextValue : current
    return clampDeleteCount(base, feedsDeleteMaxCount)
  })
  }, [feedsDeleteMaxCount])

  const executeFeedsDelete = useCallback(async () => {
  const requestedCount = clampDeleteCount(feedsDeleteCount, feedsDeleteMaxCount)
  if (requestedCount <= 0) {
    showToast('No feed articles available to delete.', false)
    return
  }

  setFeedsDeleteExecuting(true)
  try {
    const result = await pb.send<{ deleted_count: number }>('/api/feeds/delete', {
      method: 'POST',
      body: { count: requestedCount },
    })
    closeFeedsDeleteDialog()
    setFeedsDeleteMaxCount(current => Math.max(0, current - (result.deleted_count ?? 0)))
    showToast(
      result.deleted_count > 0
        ? `Deleted ${result.deleted_count} oldest feed article${result.deleted_count === 1 ? '' : 's'}.`
        : 'No feed articles were deleted.'
    )
  } catch (err) {
    showToast(getApiErrorMessage(err, 'Failed to delete feed articles'), false)
  } finally {
    setFeedsDeleteExecuting(false)
  }
  }, [closeFeedsDeleteDialog, feedsDeleteCount, feedsDeleteMaxCount, showToast])

  return {
    feedsPolicyForm,
    feedsPolicySaving,
    feedsPolicyErrors,
    setFeedsPolicyForm,
    saveFeedsPolicy,
    hydrateFeedsEntries,
  feedsDeleteDialogOpen,
  feedsDeleteLoading,
  feedsDeleteExecuting,
  feedsDeleteCount,
  feedsDeleteMaxCount,
  openFeedsDeleteDialog,
  closeFeedsDeleteDialog,
  setFeedsDeleteCount: updateFeedsDeleteCount,
  executeFeedsDelete,
  }
}