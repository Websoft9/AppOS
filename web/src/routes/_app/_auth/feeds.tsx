import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Star,
  Trash2,
  Undo2,
  X,
  ArrowDownToLine,
} from 'lucide-react'
import { getApiErrorMessage } from '@/lib/api-error'
import { pb } from '@/lib/pb'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface PBList<T> {
  items?: T[]
}

interface FeedSourceRecord {
  id: string
  name: string
  url: string
  format: 'rss' | 'atom'
  status: 'active' | 'paused' | 'archived'
  poll_interval_minutes: number
  last_fetched_at?: string
  last_success_at?: string
  last_error?: string
  created?: string
  updated?: string
}

interface FeedItemRecord {
  id: string
  source_id?: string
  origin_type: 'feed' | 'bookmark'
  external_id: string
  title: string
  link: string
  published_at?: string
  summary?: string
  keywords_json?: string[]
  tags_json?: string[]
  read_state: 'unread' | 'read'
  is_starred: boolean
  created?: string
  updated?: string
  expand?: {
    source_id?: FeedSourceRecord
  }
}

interface FeedPollSummary {
  ProcessedSources: number
  DueSources: number
  FailedSources: number
  CreatedItems: number
  UpdatedItems: number
}

interface FeedSourceAnalysis {
  name?: string
  feed_url?: string
  site_url?: string
  site_title?: string
  format?: FeedSourceRecord['format']
}

interface BookmarkCreateResponse {
  id: string
  origin_type: 'bookmark'
  title: string
  link: string
  read_state: 'unread' | 'read'
  is_starred: boolean
  source_id?: string
  summary?: string
}

interface PendingBookmarkUndo {
  title: string
  link: string
  summary: string
}

interface BookmarkConflictError {
  code?: string
  message?: string
  existing?: {
    id?: string
    title?: string
    link?: string
  }
}

const INITIAL_VISIBLE_ITEMS = 20
const BOOKMARKS_PER_PAGE = 10

function formatRelativeTime(value?: string): string {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const diffMs = Date.now() - date.getTime()
  if (diffMs < 0) return 'Just now'

  const diffMinutes = Math.floor(diffMs / (60 * 1000))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`

  const diffYears = Math.floor(diffMonths / 12)
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`
}

function getFaviconUrl(feedUrl: string): string {
  try {
    const parsed = new URL(feedUrl)
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`
  } catch {
    return ''
  }
}

function getSiteOrigin(feedUrl: string): string {
  try {
    const parsed = new URL(feedUrl)
    return parsed.origin
  } catch {
    return ''
  }
}

function getHostLabel(rawURL: string): string {
  try {
    return new URL(rawURL).hostname
  } catch {
    return rawURL
  }
}

function getSourcePullStatus(source: FeedSourceRecord): string {
  if (source.last_error?.trim()) {
    const attemptedAt = source.last_fetched_at || source.updated
    const attemptedLabel = attemptedAt ? formatRelativeTime(attemptedAt) : 'recently'
    return `Last pull failed ${attemptedLabel}: ${source.last_error.trim()}`
  }

  if (source.last_success_at) {
    return `Last pull succeeded ${formatRelativeTime(source.last_success_at)}`
  }

  if (source.last_fetched_at) {
    return `Last pull attempted ${formatRelativeTime(source.last_fetched_at)}`
  }

  return 'Not pulled yet'
}

function SourceFavicon({ name, url }: { name: string; url: string }) {
  const [failed, setFailed] = useState(false)
  const faviconUrl = getFaviconUrl(url)
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part.slice(0, 1))
    .join('')
    .toUpperCase() || 'S'

  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-linear-to-br from-sky-500/20 via-teal-500/15 to-emerald-500/20 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-700 ring-1 ring-border/70 dark:text-slate-200">
      <span aria-hidden="true">{initials}</span>
      {!failed && faviconUrl ? (
        <img
          src={faviconUrl}
          alt={`${name} favicon`}
          className="absolute inset-0 h-full w-full rounded-md bg-background object-cover"
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  )
}

function StepBadge({
  index,
  title,
  description,
  state,
}: {
  index: number
  title: string
  description: string
  state: 'upcoming' | 'active' | 'complete'
}) {
  const circleClassName =
    state === 'complete'
      ? 'border-primary bg-primary text-primary-foreground'
      : state === 'active'
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border/80 bg-muted/60 text-muted-foreground'

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold shadow-sm ${circleClassName}`}>
        {state === 'complete' ? <Check className="h-5 w-5" /> : index}
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-semibold ${state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground'}`}>
          {title}
        </div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  )
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/35 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-foreground/85">{value}</div>
    </div>
  )
}

function WebsiteMetaCard({ title, url }: { title: string; url: string }) {
  return (
    <div className="rounded-xl bg-muted/35 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Website</div>
      <div className="mt-2 flex items-start gap-3">
        <div className="pt-0.5">
          <SourceFavicon name={title || url || 'W'} url={url} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground/90">{title || 'Unknown site'}</div>
          <div className="truncate text-xs text-muted-foreground">{url || 'Not available'}</div>
        </div>
      </div>
    </div>
  )
}

function getFeedSourceSaveErrorMessage(error: unknown): string {
  const message = getApiErrorMessage(error, 'Failed to save feed source')
  const normalized = message.toLowerCase()

  if (
    normalized.includes('feed_sources.url') ||
    normalized.includes('idx_feed_sources_url') ||
    (normalized.includes('unique') && normalized.includes('url')) ||
    normalized.includes('already exists')
  ) {
    return 'This RSS or Atom URL has already been added.'
  }

  return message
}

function getBookmarkSaveErrorMessage(error: unknown): string {
  const maybe = error as { response?: { data?: BookmarkConflictError } }
  if (maybe?.response?.data?.code === 'bookmark_exists') {
    return 'This bookmark already exists.'
  }

  const message = getApiErrorMessage(error, 'Unable to save bookmark. Check the URL and try again.')
  if (message.toLowerCase().includes('failed to create bookmark')) {
    return 'Unable to save bookmark. Check the URL and try again.'
  }

  return message
}

function normalizeBookmarkKey(rawURL: string): string {
  return rawURL.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
}

function FeedsPage() {
  const { user } = useAuth()
  const isSuperuser = user?.collectionName === '_superusers'

  const [sources, setSources] = useState<FeedSourceRecord[]>([])
  const [items, setItems] = useState<FeedItemRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [pollingNow, setPollingNow] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [itemSourceFilter, setItemSourceFilter] = useState<'all' | 'bookmark' | 'starred' | string>('all')
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [sourcePollingId, setSourcePollingId] = useState<'all' | string>('')
  const [itemUpdatingId, setItemUpdatingId] = useState('')
  const [visibleItemCount, setVisibleItemCount] = useState(INITIAL_VISIBLE_ITEMS)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [bookmarkSearchQuery, setBookmarkSearchQuery] = useState('')
  const [bookmarkPage, setBookmarkPage] = useState(1)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSource, setEditingSource] = useState<FeedSourceRecord | null>(null)
  const [createStep, setCreateStep] = useState<'url' | 'details'>('url')
  const [analyzeURL, setAnalyzeURL] = useState('')
  const [analyzedSiteURL, setAnalyzedSiteURL] = useState('')
  const [analyzedSiteTitle, setAnalyzedSiteTitle] = useState('')
  const [formName, setFormName] = useState('')
  const [formURL, setFormURL] = useState('')
  const [formFormat, setFormFormat] = useState<FeedSourceRecord['format']>('rss')
  const [formStatus, setFormStatus] = useState<FeedSourceRecord['status']>('active')
  const [formInterval, setFormInterval] = useState('60')
  const [formError, setFormError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'complete'>('idle')
  const [saving, setSaving] = useState(false)
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false)
  const [bookmarkURL, setBookmarkURL] = useState('')
  const [bookmarkTitle, setBookmarkTitle] = useState('')
  const [bookmarkSummary, setBookmarkSummary] = useState('')
  const [bookmarkSaving, setBookmarkSaving] = useState(false)
  const [bookmarkError, setBookmarkError] = useState('')
  const [pendingBookmarkUndo, setPendingBookmarkUndo] = useState<PendingBookmarkUndo | null>(null)
  const [deleteSourceTarget, setDeleteSourceTarget] = useState<FeedSourceRecord | null>(null)
  const [deletingSource, setDeletingSource] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const [sourcesResponse, itemsResponse] = await Promise.all([
        pb.send<PBList<FeedSourceRecord>>(
          '/api/collections/feed_sources/records?perPage=500&sort=-updated',
          {}
        ),
        pb.send<PBList<FeedItemRecord>>(
          '/api/collections/feed_items/records?perPage=200&sort=-published_at,-created&expand=source_id',
          {}
        ),
      ])
      setSources(sourcesResponse.items ?? [])
      setItems(itemsResponse.items ?? [])
      setError('')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load feeds workspace'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const sourceNameByID = useMemo(() => {
    return new Map(sources.map(source => [source.id, source.name]))
  }, [sources])

  const sourceItemCount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      if (item.origin_type !== 'feed' || !item.source_id) continue
      counts.set(item.source_id, (counts.get(item.source_id) ?? 0) + 1)
    }
    return counts
  }, [items])

  const feedItems = useMemo(
    () => items.filter(item => item.origin_type === 'feed'),
    [items]
  )

  const bookmarkItems = useMemo(
    () => items.filter(item => item.origin_type === 'bookmark'),
    [items]
  )

  const sortedSources = useMemo(() => {
    return [...sources].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    )
  }, [sources])

  const filteredItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()

    return items.filter(item => {
      if (itemSourceFilter === 'bookmark') return item.origin_type === 'bookmark'
      if (itemSourceFilter === 'starred') return item.origin_type === 'feed' && item.is_starred
      if (itemSourceFilter === 'all') return item.origin_type === 'feed'
      return item.origin_type === 'feed' && item.source_id === itemSourceFilter
    }).filter(item => {
      if (!normalizedQuery) return true

      const sourceName = item.origin_type === 'bookmark'
        ? getHostLabel(item.link)
        : item.expand?.source_id?.name || (item.source_id ? sourceNameByID.get(item.source_id) : '') || ''

      const haystack = [item.title, item.summary, item.link, sourceName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(normalizedQuery)
    })
  }, [items, itemSourceFilter, searchQuery, sourceNameByID])

  const starredCount = useMemo(
    () => feedItems.reduce((count, item) => count + (item.is_starred ? 1 : 0), 0),
    [feedItems]
  )

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleItemCount),
    [filteredItems, visibleItemCount]
  )

  const filteredBookmarkItems = useMemo(() => {
    const normalizedQuery = bookmarkSearchQuery.trim().toLowerCase()
    return bookmarkItems.filter(item => {
      if (!normalizedQuery) return true
      const haystack = [item.title, item.summary, item.link, getHostLabel(item.link)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [bookmarkItems, bookmarkSearchQuery])

  const bookmarkPageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredBookmarkItems.length / BOOKMARKS_PER_PAGE)),
    [filteredBookmarkItems.length]
  )

  const pagedBookmarkItems = useMemo(() => {
    const safePage = Math.min(bookmarkPage, bookmarkPageCount)
    const start = (safePage - 1) * BOOKMARKS_PER_PAGE
    return filteredBookmarkItems.slice(start, start + BOOKMARKS_PER_PAGE)
  }, [bookmarkPage, bookmarkPageCount, filteredBookmarkItems])

  const bookmarkRangeLabel = useMemo(() => {
    if (filteredBookmarkItems.length === 0) return '0-0'
    const safePage = Math.min(bookmarkPage, bookmarkPageCount)
    const start = (safePage - 1) * BOOKMARKS_PER_PAGE + 1
    const end = Math.min(safePage * BOOKMARKS_PER_PAGE, filteredBookmarkItems.length)
    return `${start}-${end}`
  }, [bookmarkPage, bookmarkPageCount, filteredBookmarkItems.length])

  const selectedSource = useMemo(() => {
    if (itemSourceFilter === 'all' || itemSourceFilter === 'bookmark' || itemSourceFilter === 'starred') return null
    return sources.find(source => source.id === itemSourceFilter) ?? null
  }, [itemSourceFilter, sources])

  const selectedSourcePullStatus = useMemo(() => {
    if (!selectedSource) return ''
    if (sourcePollingId === selectedSource.id) return 'Pulling source now...'
    return getSourcePullStatus(selectedSource)
  }, [selectedSource, sourcePollingId])

  function dismissNotice() {
    setNotice('')
    setPendingBookmarkUndo(null)
  }

  function dismissError() {
    setError('')
  }

  const activeSourceName =
    itemSourceFilter === 'all'
      ? 'All'
      : itemSourceFilter === 'bookmark'
        ? 'Bookmark'
      : itemSourceFilter === 'starred'
        ? 'Starred'
        : sourceNameByID.get(itemSourceFilter) || 'Unknown source'

  function openBookmarkCreate() {
    setBookmarkURL('')
    setBookmarkTitle('')
    setBookmarkSummary('')
    setBookmarkError('')
    setBookmarkDialogOpen(true)
  }

  async function handleBookmarkSubmit(event: FormEvent) {
    event.preventDefault()

    const url = bookmarkURL.trim()
    if (!url) {
      setBookmarkError('Bookmark URL is required.')
      return
    }

    setBookmarkSaving(true)
    setBookmarkError('')
    try {
      const created = await pb.send<BookmarkCreateResponse>('/api/feeds/bookmarks', {
        method: 'POST',
        body: {
          url,
          title: bookmarkTitle.trim(),
          summary: bookmarkSummary.trim(),
        },
      })
      setItems(current => [
        {
          id: created.id,
          origin_type: created.origin_type,
          source_id: created.source_id,
          external_id: normalizeBookmarkKey(created.link),
          title: created.title,
          link: created.link,
          summary: created.summary,
          read_state: created.read_state,
          is_starred: created.is_starred,
        },
        ...current.filter(item => item.id !== created.id),
      ])
      setBookmarkDialogOpen(false)
      setItemSourceFilter('bookmark')
      setBookmarkPage(1)
      setExpandedItemId(null)
    } catch (err) {
      setBookmarkError(getBookmarkSaveErrorMessage(err))
    } finally {
      setBookmarkSaving(false)
    }
  }


  useEffect(() => {
    setVisibleItemCount(INITIAL_VISIBLE_ITEMS)
  }, [itemSourceFilter])

  useEffect(() => {
    setBookmarkPage(1)
  }, [bookmarkSearchQuery])

  useEffect(() => {
    if (bookmarkPage > bookmarkPageCount) {
      setBookmarkPage(bookmarkPageCount)
    }
  }, [bookmarkPage, bookmarkPageCount])

  function openCreate() {
    setEditingSource(null)
    setCreateStep('url')
    setAnalyzeURL('')
    setAnalyzedSiteURL('')
    setAnalyzedSiteTitle('')
    setFormName('')
    setFormURL('')
    setFormFormat('rss')
    setFormStatus('active')
    setFormInterval('60')
    setFormError('')
    setAnalysisState('idle')
    setDialogOpen(true)
  }

  function openEdit(source: FeedSourceRecord) {
    setEditingSource(source)
    setCreateStep('details')
    setAnalyzeURL(source.url)
    setAnalyzedSiteURL(getSiteOrigin(source.url))
    setAnalyzedSiteTitle(source.name)
    setFormName(source.name)
    setFormURL(source.url)
    setFormFormat(source.format)
    setFormStatus(source.status)
    setFormInterval(String(source.poll_interval_minutes))
    setFormError('')
    setAnalysisState('idle')
    setDialogOpen(true)
  }

  async function handleAnalyzeSource() {
    const url = analyzeURL.trim()

    if (!url) {
      setFormError('Feed URL is required.')
      return
    }

    setAnalyzing(true)
    setAnalysisState('loading')
    setFormError('')
    try {
      const analysis = await pb.send<FeedSourceAnalysis>('/api/feeds/analyze', {
        method: 'POST',
        body: { url },
      })

      const detectedURL = analysis.feed_url?.trim() || url
      setAnalyzeURL(detectedURL)
      setFormURL(detectedURL)
      setFormName(analysis.name?.trim() || '')
      setFormFormat(analysis.format === 'atom' ? 'atom' : 'rss')
      setFormStatus('active')
      setAnalyzedSiteURL(analysis.site_url?.trim() || '')
      setAnalyzedSiteTitle(
        analysis.site_title?.trim() ||
          analysis.name?.trim() ||
          getHostLabel(analysis.site_url?.trim() || detectedURL)
      )
      setAnalysisState('complete')
      setCreateStep('details')
    } catch (err) {
      setAnalysisState('idle')
      setFormError(getApiErrorMessage(err, 'Failed to analyze feed URL'))
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const name = formName.trim()
    const url = formURL.trim()
    const interval = Number.parseInt(formInterval, 10)

    if (!name || !url) {
      setFormError('Name and feed URL are required.')
      return
    }
    if (!Number.isInteger(interval) || interval <= 0) {
      setFormError('Polling interval must be a positive integer.')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      const body = {
        name,
        url,
        format: formFormat,
        status: formStatus,
        poll_interval_minutes: interval,
      }

      if (editingSource) {
        await pb.send(`/api/collections/feed_sources/records/${editingSource.id}`, {
          method: 'PATCH',
          body,
        })
      } else {
        const createdSource = await pb.send<FeedSourceRecord>('/api/collections/feed_sources/records', {
          method: 'POST',
          body,
        })

        if (isSuperuser && createdSource?.id) {
          try {
            await pb.send(`/api/feeds/sources/${createdSource.id}/poll`, {
              method: 'POST',
            })
          } catch (pollErr) {
            setError(getApiErrorMessage(pollErr, `Source saved, but initial pull failed for ${name}`))
          }

          setItemSourceFilter(createdSource.id)
          setExpandedItemId(null)
        }
      }

      setDialogOpen(false)
      await fetchData()
    } catch (err) {
      setFormError(getFeedSourceSaveErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteSource() {
    if (!deleteSourceTarget) return

    setDeletingSource(true)
    try {
      await pb.send(`/api/collections/feed_sources/records/${deleteSourceTarget.id}`, {
        method: 'DELETE',
      })
      setDeleteSourceTarget(null)
      setDialogOpen(false)
      if (itemSourceFilter === deleteSourceTarget.id) {
        setItemSourceFilter('all')
        setExpandedItemId(null)
      }
      setNotice(`Deleted source ${deleteSourceTarget.name}.`)
      await fetchData()
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Failed to delete feed source'))
    } finally {
      setDeletingSource(false)
    }
  }

  async function handleRefresh() {
    if (!isSuperuser) {
      setRefreshing(true)
      void fetchData()
      return
    }

    setError('')
    setPollingNow(true)
    try {
      await pb.send<{ summary: FeedPollSummary }>('/api/feeds/poll', {
        method: 'POST',
      })
      await fetchData()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to refresh feeds'))
    } finally {
      setPollingNow(false)
    }
  }

  async function handleSourcePoll(source: FeedSourceRecord) {
    setError('')
    setSourcePollingId(source.id)
    try {
      await pb.send<{ summary: FeedPollSummary }>(`/api/feeds/sources/${source.id}/poll`, {
        method: 'POST',
      })
      await fetchData()
    } catch (err) {
      setError(getApiErrorMessage(err, `Failed to pull ${source.name}`))
    } finally {
      setSourcePollingId('')
    }
  }

  function handleSelectSource(sourceId: 'all' | 'bookmark' | 'starred' | string) {
    setItemSourceFilter(sourceId)
    setExpandedItemId(null)
    if (sourceId === 'bookmark') {
      setSearchOpen(false)
      setSearchQuery('')
    }
  }

  async function handleCopyLink(link: string, title: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link)
        setNotice(`Copied URL for ${title}.`)
        return
      }
      setNotice(`Copy is unavailable for ${title}.`)
    } catch {
      setNotice(`Copy is unavailable for ${title}.`)
    }
  }

  function toggleSearch() {
    if (searchOpen) {
      setSearchOpen(false)
      setSearchQuery('')
      return
    }

    setSearchOpen(true)
  }

  async function patchItemPreferences(
    itemId: string,
    patch: Partial<Pick<FeedItemRecord, 'read_state' | 'is_starred'>>,
    failureMessage: string
  ): Promise<Pick<FeedItemRecord, 'id' | 'read_state' | 'is_starred'> | null> {
    setItemUpdatingId(itemId)
    try {
      const updated = await pb.send<Pick<FeedItemRecord, 'id' | 'read_state' | 'is_starred'>>(
        `/api/feeds/items/${itemId}/state`,
        {
          method: 'PATCH',
          body: patch,
        }
      )
      setItems(current =>
        current.map(item =>
          item.id === itemId
            ? {
                ...item,
                read_state: updated.read_state,
                is_starred: updated.is_starred,
              }
            : item
        )
      )
      return updated
    } catch (err) {
      setError(getApiErrorMessage(err, failureMessage))
      return null
    } finally {
      setItemUpdatingId(current => (current === itemId ? '' : current))
    }
  }

  async function handleBookmarkRemove(item: FeedItemRecord) {
    setItemUpdatingId(item.id)
    try {
      await pb.send(`/api/feeds/bookmarks/${item.id}`, {
        method: 'DELETE',
      })
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to remove bookmark'))
      setItemUpdatingId(current => (current === item.id ? '' : current))
      return
    }

    setItems(current => current.filter(candidate => candidate.id !== item.id))
    setItemUpdatingId(current => (current === item.id ? '' : current))
    setPendingBookmarkUndo({
      title: item.title,
      link: item.link,
      summary: item.summary?.trim() || '',
    })
    setNotice(`Removed ${item.title} from bookmarks.`)
  }

  async function handleBookmarkUndo() {
    if (!pendingBookmarkUndo) return

    setBookmarkSaving(true)
    try {
      const restored = await pb.send<BookmarkCreateResponse>('/api/feeds/bookmarks', {
        method: 'POST',
        body: {
          url: pendingBookmarkUndo.link,
          title: pendingBookmarkUndo.title,
          summary: pendingBookmarkUndo.summary,
        },
      })
      setItems(current => [
        {
          id: restored.id,
          origin_type: restored.origin_type,
          source_id: restored.source_id,
          external_id: normalizeBookmarkKey(restored.link),
          title: restored.title,
          link: restored.link,
          summary: restored.summary,
          read_state: restored.read_state,
          is_starred: restored.is_starred,
        },
        ...current.filter(item => item.id !== restored.id),
      ])
      setNotice(`Restored ${pendingBookmarkUndo.title}.`)
      setPendingBookmarkUndo(null)
    } catch (err) {
      setError(getBookmarkSaveErrorMessage(err))
    } finally {
      setBookmarkSaving(false)
    }
  }

  function toggleItemDetails(item: FeedItemRecord) {
    const shouldExpand = expandedItemId !== item.id
    setExpandedItemId(current => (current === item.id ? null : item.id))
    if (shouldExpand && item.read_state === 'unread') {
      void patchItemPreferences(item.id, { read_state: 'read' }, 'Failed to mark feed item as read')
    }
  }

  async function handleShare(item: FeedItemRecord) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.link)
        setNotice(`Copied link for ${item.title}.`)
        return
      }
      window.open(item.link, '_blank', 'noopener,noreferrer')
    } catch {
      window.open(item.link, '_blank', 'noopener,noreferrer')
    }
  }

  function handleItemsScroll(event: React.UIEvent<HTMLDivElement>) {
    const target = event.currentTarget
    const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
    if (remaining > 160) return
    setVisibleItemCount(current => Math.min(current + INITIAL_VISIBLE_ITEMS, filteredItems.length))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Feeds</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track RSS and Atom updates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={itemSourceFilter === 'bookmark' ? 'default' : 'outline'}
            size="icon"
            onClick={() => void handleSelectSource('bookmark')}
            title="Bookmarks"
            aria-label="Open bookmarks"
          >
            <Bookmark className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void handleRefresh()}
            disabled={refreshing || pollingNow}
            title="Refresh"
            aria-label="Refresh"
          >
            {refreshing || pollingNow ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          {isSuperuser ? (
            <Button type="button" onClick={openCreate}>Add Source</Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <Button type="button" variant="ghost" size="icon" aria-label="Dismiss error" onClick={dismissError}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 break-words">{notice}</span>
            <div className="flex items-center gap-2">
              {pendingBookmarkUndo ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void handleBookmarkUndo()}>
                  Undo
                </Button>
              ) : null}
              <Button type="button" variant="ghost" size="icon" aria-label="Dismiss notification" onClick={dismissNotice}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="border-b p-4">
            <h2 className="text-lg font-semibold tracking-tight">Sources</h2>
          </div>

          <div className="max-h-[calc(100vh-18rem)] overflow-y-auto p-2">
            <div className="space-y-1">
              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted/60 ${itemSourceFilter === 'all' ? 'bg-muted font-medium' : ''}`}
                onClick={() => void handleSelectSource('all')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ring-1 ring-border/70">A</div>
                  <span className="truncate">All</span>
                </span>
                <span className="rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-xs font-medium text-foreground/80">
                  {feedItems.length}
                </span>
              </button>

              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted/60 ${itemSourceFilter === 'bookmark' ? 'bg-muted font-medium' : ''}`}
                onClick={() => void handleSelectSource('bookmark')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Bookmark className="h-4 w-4 text-sky-600" />
                  <span className="truncate">Bookmark</span>
                </span>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
                  {bookmarkItems.length}
                </span>
              </button>

              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted/60 ${itemSourceFilter === 'starred' ? 'bg-muted font-medium' : ''}`}
                onClick={() => void handleSelectSource('starred')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Star className="h-4 w-4 text-amber-500" />
                  <span className="truncate">Starred</span>
                </span>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                  {starredCount}
                </span>
              </button>

              {loading ? (
                <div className="flex h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading feed sources...
                </div>
              ) : sources.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted-foreground">No feed sources yet.</div>
              ) : (
                sortedSources.map(source => (
                  <button
                    key={source.id}
                    type="button"
                    className={`flex w-full min-w-0 items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted/60 ${itemSourceFilter === source.id ? 'bg-muted font-medium' : ''}`}
                    onClick={() => void handleSelectSource(source.id)}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <SourceFavicon name={source.name} url={source.url} />
                      <span className="min-w-0 truncate" title={source.name}>{source.name}</span>
                    </span>
                    <span className="ml-3 shrink-0 rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-xs font-medium text-foreground/80">
                      {sourcePollingId === source.id ? <Loader2 className="h-4 w-4 animate-spin" /> : `(${sourceItemCount.get(source.id) ?? 0})`}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="min-w-0 space-y-4 p-0 text-card-foreground shadow-none">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {selectedSource ? <SourceFavicon name={selectedSource.name} url={selectedSource.url} /> : null}
                  <h2 className="text-lg font-semibold tracking-tight">{activeSourceName}</h2>
                  {selectedSource && isSuperuser ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                      size="icon"
                        aria-label="Pull selected source now"
                        title="Pull selected source now"
                        disabled={sourcePollingId === selectedSource.id}
                        onClick={() => void handleSourcePoll(selectedSource)}
                      >
                        {sourcePollingId === selectedSource.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                        <ArrowDownToLine className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Edit selected source"
                        title="Edit selected source"
                        onClick={() => openEdit(selectedSource)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                </div>
                {selectedSource ? (
                  <div className="mt-1 truncate text-xs text-muted-foreground" title={selectedSourcePullStatus}>
                    {selectedSourcePullStatus}
                  </div>
                ) : null}
                {itemSourceFilter === 'bookmark' ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Keep quick-access links here without turning them into polling feed sources.
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-start gap-2">
              {itemSourceFilter === 'bookmark' ? null : searchOpen ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="Search articles"
                    aria-label="Search articles"
                    className="w-64"
                  />
                  <Button type="button" variant="ghost" size="icon" aria-label="Close search" onClick={toggleSearch}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="icon" aria-label="Open article search" onClick={toggleSearch}>
                  <Search className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-[calc(100vh-14rem)] space-y-3 overflow-y-auto pr-1" onScroll={handleItemsScroll}>
            {loading ? (
              <div className="flex h-36 items-center justify-center gap-2 rounded-lg border bg-card text-sm text-muted-foreground shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading feed items...
              </div>
            ) : itemSourceFilter === 'bookmark' ? (
              <>
                <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="icon" aria-label="Add Bookmark" title="Add Bookmark" onClick={openBookmarkCreate}>
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Input
                        value={bookmarkSearchQuery}
                        onChange={event => setBookmarkSearchQuery(event.target.value)}
                        placeholder="Search bookmarks"
                        aria-label="Search bookmarks"
                        className="w-72"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>Bookmarks: {bookmarkItems.length}</span>
                      <span>Showing: {bookmarkRangeLabel}</span>
                      <div className="flex items-center gap-0.5 text-xs">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 min-w-0 px-0.5"
                          aria-label="Previous bookmark page"
                          disabled={bookmarkPage <= 1}
                          onClick={() => setBookmarkPage(current => Math.max(1, current - 1))}
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </Button>
                        <span className="text-center font-medium tabular-nums">
                          {Math.min(bookmarkPage, bookmarkPageCount)}/{bookmarkPageCount}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 min-w-0 px-0.5"
                          aria-label="Next bookmark page"
                          disabled={bookmarkPage >= bookmarkPageCount}
                          onClick={() => setBookmarkPage(current => Math.min(bookmarkPageCount, current + 1))}
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_minmax(0,1.7fr)_auto] gap-3 border-b bg-background px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    <span>Title</span>
                    <span>Description</span>
                    <span>URL</span>
                    <span>Actions</span>
                  </div>

                  <div role="list" aria-label="Bookmarks list" className="divide-y">
                    {pagedBookmarkItems.map(item => {
                      const isUpdating = itemUpdatingId === item.id
                      const description = item.summary?.trim() || ''
                      return (
                        <div
                          key={item.id}
                          role="listitem"
                          aria-label={`Bookmark ${item.title}`}
                          className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_minmax(0,1.7fr)_auto] items-center gap-3 bg-card px-4 py-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <SourceFavicon name={item.title} url={item.link} />
                            <div className="truncate text-sm font-semibold text-foreground">{item.title}</div>
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{description}</div>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <div className="truncate font-mono text-xs text-muted-foreground" title={item.link}>{item.link}</div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Copy bookmark URL ${item.title}`}
                              title={`Copy bookmark URL ${item.title}`}
                              onClick={() => void handleCopyLink(item.link, item.title)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button type="button" variant="ghost" size="icon" asChild>
                              <a href={item.link} target="_blank" rel="noreferrer" aria-label={`Visit bookmark ${item.title}`} title={`Visit bookmark ${item.title}`}>
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove bookmark ${item.title}`}
                              title={`Remove bookmark ${item.title}`}
                              disabled={isUpdating}
                              onClick={() => void handleBookmarkRemove(item)}
                            >
                              {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {filteredBookmarkItems.length === 0 ? (
                  <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground shadow-sm">
                    {bookmarkItems.length === 0 ? 'No bookmarks saved yet.' : 'No bookmarks match this search.'}
                  </div>
                ) : null}
              </>
            ) : filteredItems.length === 0 ? (
              <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground shadow-sm">
                {items.length === 0 ? 'No feed items ingested yet.' : 'No feed items for this source.'}
              </div>
            ) : (
              visibleItems.map(item => {
                const sourceName = item.origin_type === 'bookmark'
                  ? getHostLabel(item.link)
                  : item.expand?.source_id?.name || (item.source_id ? sourceNameByID.get(item.source_id) : '') || 'Unknown source'
                const source = item.origin_type === 'bookmark'
                  ? undefined
                  : item.expand?.source_id || sources.find(candidate => candidate.id === item.source_id)
                const expanded = expandedItemId === item.id
                const isRead = item.read_state === 'read'
                const isStarred = item.is_starred
                const isUpdating = itemUpdatingId === item.id

                return (
                  <div key={item.id} className="rounded-lg border bg-card px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => toggleItemDetails(item)}>
                        <div className={`leading-6 ${isRead ? 'font-normal text-muted-foreground' : 'font-medium'}`}>
                          <span className="inline-flex items-center gap-2">
                            {isStarred ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" /> : null}
                            {item.origin_type === 'bookmark' ? <Bookmark className="h-4 w-4 text-sky-600" /> : null}
                            <span>{item.title}</span>
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{formatRelativeTime(item.published_at)}</span>
                          <span>&middot;</span>
                          <span className="flex min-w-0 items-center gap-2">
                            {source ? <SourceFavicon name={sourceName} url={source.url} /> : <SourceFavicon name={sourceName} url={item.link} />}
                            <span className="truncate">{sourceName}</span>
                          </span>
                        </div>
                      </button>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Open ${item.title}`}
                        title={`Open ${item.title}`}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>

                    {expanded ? (
                      <div className="mt-3 space-y-4 rounded-md border bg-muted/20 p-4">
                        <div className="space-y-2">
                          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Article Details
                          </div>
                          <div className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">
                            {item.summary?.trim() || 'No summary extracted for this article.'}
                          </div>
                        </div>

                        <div className="rounded-md border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                          <div>{item.link}</div>
                        </div>

                        <div className="space-y-1 text-xs text-muted-foreground">
                          <div>Type: {item.origin_type === 'bookmark' ? 'Bookmark' : 'Feed item'}</div>
                          <div>Published: {item.published_at ? new Date(item.published_at).toLocaleString() : 'Unknown'}</div>
                          <div>Source: {sourceName}</div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isUpdating}
                            onClick={() => void patchItemPreferences(item.id, { read_state: 'unread' }, 'Failed to keep feed item unread')}
                          >
                            {isUpdating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Undo2 className="mr-2 h-4 w-4" />}
                            Keep Unread
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isUpdating}
                            onClick={() => void patchItemPreferences(item.id, { is_starred: !isStarred }, 'Failed to update feed item star')}
                          >
                            {isUpdating ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Star className={`mr-2 h-4 w-4 ${isStarred ? 'fill-current' : ''}`} />
                            )}
                            {isStarred ? 'Starred' : 'Star'}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => void handleShare(item)}>
                            <Share2 className="mr-2 h-4 w-4" />
                            Share
                          </Button>
                          <Button type="button" variant="outline" size="sm" asChild>
                            <a href={item.link} target="_blank" rel="noreferrer">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Open Link
                            </a>
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
            {!loading && visibleItems.length < filteredItems.length ? (
              <div className="pb-2 pt-1 text-center text-xs text-muted-foreground">
                Scroll to load more
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-4xl">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editingSource ? 'Edit Feed Source' : 'Add Feed Source'}</DialogTitle>
              <DialogDescription>
                {editingSource
                  ? 'Update one RSS or Atom source for the Feeds ingestion loop.'
                  : createStep === 'url'
                    ? 'Step 1 of 2. Enter an RSS or Atom URL to analyze before subscribing.'
                    : 'Step 2 of 2. Review the detected metadata and finish subscribing.'}
              </DialogDescription>
              {!editingSource ? (
                <div className="mt-4 rounded-2xl bg-muted/35 px-5 py-4">
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <StepBadge
                        index={1}
                        title="Analyze Feed"
                        description="Check the URL and fetch metadata"
                        state={createStep === 'url' ? 'active' : 'complete'}
                      />
                    </div>
                    <div className={`mt-5 hidden h-0.5 flex-1 rounded-full md:block ${createStep === 'details' ? 'bg-primary/50' : 'bg-border/80'}`} />
                    <div className="min-w-0 flex-1">
                      <StepBadge
                        index={2}
                        title="Subscribe"
                        description="Review details and save the source"
                        state={createStep === 'details' ? 'active' : 'upcoming'}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </DialogHeader>

            {!editingSource && createStep === 'url' ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="feed-source-discovery-url">RSS or Atom URL</Label>
                  <p className="text-xs text-muted-foreground">Paste the feed URL and we will auto-fill the next step.</p>
                  <Input
                    id="feed-source-discovery-url"
                    value={analyzeURL}
                    onChange={event => {
                      setAnalyzeURL(event.target.value)
                      setAnalysisState('idle')
                    }}
                    placeholder="https://example.com/feed.xml"
                  />
                </div>
                {analysisState === 'loading' ? (
                  <div className="flex items-start gap-3 rounded-xl bg-primary/8 px-4 py-3 text-sm text-primary">
                    <Loader2 className="mt-0.5 h-4 w-4 animate-spin" />
                    <div>
                      <div className="font-medium">Analyzing feed URL</div>
                      <div className="text-primary/80">Fetching metadata, detecting feed format, and preparing the subscription details.</div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="feed-source-name">Name</Label>
                  <Input
                    id="feed-source-name"
                    value={formName}
                    onChange={event => setFormName(event.target.value)}
                    placeholder="Vendor release feed"
                  />
                </div>

                {!editingSource && analysisState === 'complete' ? (
                  <div className="flex items-start gap-3 rounded-xl bg-primary/8 px-4 py-3 text-sm text-primary">
                    <Check className="mt-0.5 h-4 w-4" />
                    <div>
                      <div className="font-medium">Analysis complete</div>
                      <div className="text-primary/80">The source metadata has been detected and stored for this subscription.</div>
                    </div>
                  </div>
                ) : null}

                {editingSource ? (
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                    <MetaField label="Feed URL" value={formURL || 'Not available'} />
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select
                        value={formStatus}
                        onValueChange={value => setFormStatus(value as FeedSourceRecord['status'])}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="paused">Paused</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <MetaField label="Format" value={formFormat.toUpperCase()} />
                    <MetaField label="Website" value={analyzedSiteURL || 'Not available'} />
                    <MetaField label="Poll Interval" value={`${formInterval} min`} />
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <MetaField label="Feed URL" value={formURL || 'Not available'} />
                    <WebsiteMetaCard title={analyzedSiteTitle} url={analyzedSiteURL} />
                    <MetaField label="Format" value={formFormat.toUpperCase()} />
                    <MetaField label="Status" value={formStatus} />
                    <MetaField label="Poll Interval" value={`${formInterval} min`} />
                  </div>
                )}
              </>
            )}

            {formError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </div>
            ) : null}

            <DialogFooter>
              {editingSource ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mr-auto text-destructive hover:text-destructive"
                  onClick={() => setDeleteSourceTarget(editingSource)}
                  disabled={saving}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Source
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving || analyzing}
              >
                Cancel
              </Button>
              {!editingSource && createStep === 'details' ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateStep('url')}
                  disabled={saving}
                >
                  Back
                </Button>
              ) : null}
              {!editingSource && createStep === 'url' ? (
                <Button type="button" onClick={() => void handleAnalyzeSource()} disabled={analyzing}>
                  {analyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Analyze Feed
                </Button>
              ) : (
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {editingSource ? 'Save Changes' : 'Subscribe'}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={bookmarkDialogOpen} onOpenChange={setBookmarkDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <form className="space-y-4" onSubmit={handleBookmarkSubmit}>
            <DialogHeader>
              <DialogTitle>Add Bookmark</DialogTitle>
              <DialogDescription>
                Save one manual link into the Feeds workspace without turning it into a polling source.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="bookmark-url">Bookmark URL</Label>
              <Input
                id="bookmark-url"
                value={bookmarkURL}
                onChange={event => setBookmarkURL(event.target.value)}
                placeholder="https://example.com/article"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bookmark-title">Title</Label>
              <Input
                id="bookmark-title"
                value={bookmarkTitle}
                onChange={event => setBookmarkTitle(event.target.value)}
                placeholder="Optional title override"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bookmark-summary">Description</Label>
              <Input
                id="bookmark-summary"
                value={bookmarkSummary}
                onChange={event => setBookmarkSummary(event.target.value)}
                placeholder="Optional website description"
              />
            </div>

            {bookmarkError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {bookmarkError}
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBookmarkDialogOpen(false)} disabled={bookmarkSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={bookmarkSaving}>
                {bookmarkSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Save Bookmark
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteSourceTarget} onOpenChange={open => !open && !deletingSource && setDeleteSourceTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Feed Source</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteSourceTarget
                ? `Delete ${deleteSourceTarget.name}? This will also delete ${sourceItemCount.get(deleteSourceTarget.id) ?? 0} article${(sourceItemCount.get(deleteSourceTarget.id) ?? 0) === 1 ? '' : 's'} already pulled from this source.`
                : 'Delete this feed source?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSource}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault()
                void handleDeleteSource()
              }}
              disabled={deletingSource}
            >
              {deletingSource ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete source and articles
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/feeds' as never)({
  component: FeedsPage,
})