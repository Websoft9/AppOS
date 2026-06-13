import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Eraser,
  ExternalLink,
  Loader2,
  Minus,
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
  page?: number
  perPage?: number
  totalItems?: number
}

interface FeedListResponse {
  items: FeedItemRecord[]
  page: number
  perPage: number
  totalItems: number
}

interface FeedSummaryResponse {
  totalItems: number
  starredItems: number
  sourceCounts: Array<{
    sourceId: string
    count: number
  }>
}

interface FeedSourceRecord {
  id: string
  name: string
  url: string
  favicon_url?: string
  item_count?: number
  format: 'rss' | 'atom'
  status: 'active' | 'paused' | 'archived'
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
  favicon_url?: string
  published_at?: string
  summary?: string
  content_raw?: string
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

interface FeedSourceDeleteResult {
  source_id: string
  requested_count?: number
  deleted_count: number
  remaining_count?: number
}

interface FeedSourceAnalysis {
  name?: string
  feed_url?: string
  site_url?: string
  site_title?: string
  favicon_url?: string
  format?: FeedSourceRecord['format']
}

interface BookmarkCreateResponse {
  id: string
  origin_type: 'bookmark'
  external_id?: string
  title: string
  link: string
  favicon_url?: string
  summary?: string
  read_state: 'unread' | 'read'
  is_starred: boolean
  source_id?: string
}

interface BookmarkEditTarget {
  id: string
  title: string
  link: string
  summary?: string
  favicon_url?: string
}

interface BookmarkListResponse {
  items: FeedItemRecord[]
  page: number
  perPage: number
  totalItems: number
  totalBookmarks: number
}

interface BookmarkAnalysis {
  title?: string
  description?: string
  favicon_url?: string
  resolved_url?: string
}

interface PendingBookmarkUndo {
  title: string
  link: string
  summary: string
  favicon_url?: string
}

interface ShareTarget {
  title: string
  url: string
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

const BOOKMARKS_PER_PAGE = 10
const FEED_ITEMS_PER_PAGE = 20

function clampDeleteCount(value: number, maxCount: number): number {
  if (!Number.isFinite(value)) {
    return maxCount > 0 ? 1 : 0
  }
  if (maxCount <= 0) {
    return 0
  }
  return Math.max(1, Math.min(maxCount, Math.floor(value)))
}

function buildTrackedShareURL(rawURL: string): string {
  try {
    const parsed = new URL(rawURL)
    parsed.searchParams.set('from', 'appos')
    return parsed.toString()
  } catch {
    const separator = rawURL.includes('?') ? '&' : '?'
    return `${rawURL}${separator}from=appos`
  }
}

const CONTENT_BLOCKED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'video',
  'audio',
  'svg',
])

function stripHTMLToText(value?: string): string {
  const trimmed = value?.trim() || ''
  if (!trimmed) return ''
  if (typeof DOMParser === 'undefined') return trimmed

  const parser = new DOMParser()
  const doc = parser.parseFromString(trimmed, 'text/html')
  return doc.body.textContent?.replace(/\s+/g, ' ').trim() || ''
}

function sanitizeFeedContentHTML(value?: string): string {
  const trimmed = value?.trim() || ''
  if (!trimmed) return ''
  if (typeof DOMParser === 'undefined') return ''

  const parser = new DOMParser()
  const doc = parser.parseFromString(trimmed, 'text/html')

  doc.body.querySelectorAll('*').forEach(element => {
    const tagName = element.tagName.toLowerCase()
    if (CONTENT_BLOCKED_TAGS.has(tagName)) {
      element.remove()
      return
    }

    Array.from(element.attributes).forEach(attribute => {
      const name = attribute.name.toLowerCase()
      const attrValue = attribute.value.trim().toLowerCase()
      if (
        name.startsWith('on') ||
        name === 'style' ||
        ((name === 'href' || name === 'src') && attrValue.startsWith('javascript:'))
      ) {
        element.removeAttribute(attribute.name)
      }
    })
  })

  return doc.body.innerHTML.trim()
}

function getFeedItemDetail(item: Pick<FeedItemRecord, 'content_raw' | 'summary'>): {
  html: string
  text: string
} {
  const html = sanitizeFeedContentHTML(item.content_raw)
  if (html) {
    return {
      html,
      text: stripHTMLToText(item.content_raw),
    }
  }

  return {
    html: '',
    text: stripHTMLToText(item.content_raw) || item.summary?.trim() || '',
  }
}

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

function getSiteOrigin(feedUrl: string): string {
  try {
    const parsed = new URL(feedUrl)
    return parsed.origin
  } catch {
    return ''
  }
}

function getFaviconProxyUrl(faviconUrl: string, authToken?: string): string {
  const trimmed = faviconUrl.trim()
  if (!trimmed) return ''

  const params = new URLSearchParams({ url: trimmed })
  if (authToken) {
    params.set('token', authToken)
  }
  return `/api/feeds/favicon?${params.toString()}`
}

function getHostLabel(rawURL: string): string {
  try {
    return new URL(rawURL).hostname
  } catch {
    return rawURL
  }
}

function getLabelInitials(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.slice(0, 1))
    .join('')
    .toUpperCase()

  return normalized || 'S'
}

function getDisplayItemTitle(item: Pick<FeedItemRecord, 'title' | 'link'>): string {
  const title = item.title?.trim()
  if (title) return title
  return getHostLabel(item.link) || item.link
}

function getDisplayBookmarkHost(rawURL: string): string {
  const trimmed = rawURL.trim()
  if (!trimmed) return ''

  try {
    return new URL(trimmed).hostname
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  }
}

function legacyCopyText(value: string): boolean {
  if (typeof document === 'undefined') return false

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '-9999px'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)

  try {
    textarea.focus()
    textarea.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
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

function SourceFavicon({
  name,
  faviconUrl,
  fallbackLabel,
}: {
  name: string
  url?: string // accepted but not used; kept so callers need no update
  faviconUrl?: string
  fallbackLabel?: string
}) {
  const { user } = useAuth()
  const authToken = user ? pb.authStore.token : ''
  const resolvedFaviconUrl = faviconUrl?.trim() || ''
  const faviconSrc = resolvedFaviconUrl ? getFaviconProxyUrl(resolvedFaviconUrl, authToken) : ''
  const initials = getLabelInitials(fallbackLabel || name)
  const [visible, setVisible] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    // If the image is already loaded from browser cache, onLoad won't fire.
    // Check the complete flag directly so cached images still become visible.
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) {
      setVisible(true)
    } else {
      setVisible(false)
    }
  }, [faviconSrc])

  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md bg-linear-to-br from-sky-500/20 via-teal-500/15 to-emerald-500/20 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-700 ring-1 ring-border/70 dark:text-slate-200">
      <span aria-hidden="true">{initials}</span>
      {faviconSrc ? (
        <img
          ref={imgRef}
          key={faviconSrc}
          src={faviconSrc}
          alt={`${name} favicon`}
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 h-full w-full rounded-md bg-background object-cover transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setVisible(true)}
          onError={() => setVisible(false)}
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
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold shadow-sm ${circleClassName}`}
      >
        {state === 'complete' ? <Check className="h-5 w-5" /> : index}
      </div>
      <div className="min-w-0">
        <div
          className={`text-sm font-semibold ${state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground'}`}
        >
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
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-medium text-foreground/85">{value}</div>
    </div>
  )
}

function WebsiteMetaCard({
  title,
  url,
  faviconUrl,
}: {
  title: string
  url: string
  faviconUrl?: string
}) {
  return (
    <div className="rounded-xl bg-muted/35 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Website
      </div>
      <div className="mt-2 flex items-start gap-3">
        <div className="pt-0.5">
          <SourceFavicon name={title || url || 'W'} url={url} faviconUrl={faviconUrl} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground/90">
            {title || 'Unknown site'}
          </div>
          <div className="truncate text-xs text-muted-foreground">{url || 'Not available'}</div>
        </div>
      </div>
    </div>
  )
}

function FaviconMetaCard({
  title,
  url,
  faviconUrl,
}: {
  title: string
  url: string
  faviconUrl?: string
}) {
  const trimmedFaviconUrl = faviconUrl?.trim() || ''
  if (!trimmedFaviconUrl) return null

  return (
    <div className="flex items-start gap-3 rounded-xl border bg-muted/20 px-4 py-3">
      <SourceFavicon
        name={title || url || 'F'}
        url={url || trimmedFaviconUrl}
        faviconUrl={trimmedFaviconUrl}
      />
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">Detected favicon</div>
        <div className="truncate text-xs text-muted-foreground" title={trimmedFaviconUrl}>
          {trimmedFaviconUrl}
        </div>
      </div>
    </div>
  )
}

function SourceInlineLabel({
  name,
  url,
  faviconUrl,
  fallbackLabel,
  title,
  textClassName = 'min-w-0 truncate',
}: {
  name: string
  url: string
  faviconUrl?: string
  fallbackLabel?: string
  title?: string
  textClassName?: string
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SourceFavicon name={name} url={url} faviconUrl={faviconUrl} fallbackLabel={fallbackLabel} />
      <span className={textClassName} title={title || name}>
        {name}
      </span>
    </span>
  )
}

function getFeedSourceSaveErrorMessage(error: unknown): string {
  const maybe = error as { response?: { data?: { code?: string; message?: string } } }
  if (maybe?.response?.data?.code === 'feed_source_exists') {
    return 'This RSS or Atom URL has already been added.'
  }
  if (maybe?.response?.data?.code === 'feed_source_identity_locked') {
    return 'Feed URL and format cannot be changed. Create a new source instead.'
  }

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

function getBookmarkAnalyzeErrorMessage(error: unknown): string {
  const message = getApiErrorMessage(error, 'Unable to fetch bookmark details.')
  const normalized = message.toLowerCase()
  const httpStatusMatch = normalized.match(/http\s+(\d{3})/)

  if (normalized.includes('bookmark url is required')) {
    return 'Enter a bookmark URL first.'
  }

  if (normalized.includes('only http and https urls are supported')) {
    return 'Enter a valid http:// or https:// URL.'
  }

  if (normalized.includes('private/loopback')) {
    return 'Private or local URLs cannot be analyzed.'
  }

  if (normalized.includes('too many redirects')) {
    return 'This website redirected too many times. Try the final page URL instead.'
  }

  if (httpStatusMatch) {
    return `This website could not be fetched right now (HTTP ${httpStatusMatch[1]}).`
  }

  if (
    normalized.includes('timeout') ||
    normalized.includes('failed to connect') ||
    normalized.includes('no such host') ||
    normalized.includes('network is unreachable') ||
    normalized.includes('temporary failure in name resolution') ||
    normalized.includes('connection refused')
  ) {
    return 'Unable to reach this website right now. Try again in a moment.'
  }

  if (normalized.includes('exceeded') && normalized.includes('byte limit')) {
    return 'This page is too large to analyze automatically.'
  }

  if (normalized.includes('failed to analyze bookmark url')) {
    return 'Unable to fetch bookmark details from this URL.'
  }

  return message
}

function FeedsPage() {
  const { user } = useAuth()
  const isSuperuser = user?.collectionName === '_superusers'

  const [sources, setSources] = useState<FeedSourceRecord[]>([])
  const [items, setItems] = useState<FeedItemRecord[]>([])
  const [feedTotalItems, setFeedTotalItems] = useState(0)
  const [feedStarredItems, setFeedStarredItems] = useState(0)
  const [sourceItemCounts, setSourceItemCounts] = useState<Record<string, number>>({})
  const [bookmarkItems, setBookmarkItems] = useState<FeedItemRecord[]>([])
  const [bookmarkTotalItems, setBookmarkTotalItems] = useState(0)
  const [bookmarkTotalBookmarks, setBookmarkTotalBookmarks] = useState(0)
  const [bookmarkDataLoaded, setBookmarkDataLoaded] = useState(false)
  const [bookmarkLoading, setBookmarkLoading] = useState(false)
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [itemSourceFilter, setItemSourceFilter] = useState<'all' | 'bookmark' | 'starred' | string>(
    'all'
  )
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [sourcePollingId, setSourcePollingId] = useState<'all' | string>('')
  const [itemUpdatingId, setItemUpdatingId] = useState('')
  const [feedPage, setFeedPage] = useState(1)
  const [feedLoadingMore, setFeedLoadingMore] = useState(false)
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
  const [formFaviconURL, setFormFaviconURL] = useState('')
  const [formFormat, setFormFormat] = useState<FeedSourceRecord['format']>('rss')
  const [formStatus, setFormStatus] = useState<FeedSourceRecord['status']>('active')
  const [formError, setFormError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'complete'>('idle')
  const [saving, setSaving] = useState(false)
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false)
  const [bookmarkEditTarget, setBookmarkEditTarget] = useState<BookmarkEditTarget | null>(null)
  const [bookmarkURL, setBookmarkURL] = useState('')
  const [bookmarkTitle, setBookmarkTitle] = useState('')
  const [bookmarkSummary, setBookmarkSummary] = useState('')
  const [bookmarkFaviconURL, setBookmarkFaviconURL] = useState('')
  const [bookmarkSaving, setBookmarkSaving] = useState(false)
  const [bookmarkAnalyzing, setBookmarkAnalyzing] = useState(false)
  const [bookmarkError, setBookmarkError] = useState('')
  const [copiedBookmarkId, setCopiedBookmarkId] = useState('')
  const [pendingBookmarkUndo, setPendingBookmarkUndo] = useState<PendingBookmarkUndo | null>(null)
  const [deleteSourceTarget, setDeleteSourceTarget] = useState<FeedSourceRecord | null>(null)
  const [deletingSource, setDeletingSource] = useState(false)
  const [clearSourceTarget, setClearSourceTarget] = useState<FeedSourceRecord | null>(null)
  const [clearSourceCount, setClearSourceCount] = useState(0)
  const [clearingSource, setClearingSource] = useState(false)
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null)
  const [shareQRCodeURL, setShareQRCodeURL] = useState('')
  const [shareQRCodeLoading, setShareQRCodeLoading] = useState(false)
  const [shareLinkCopied, setShareLinkCopied] = useState(false)
  const bookmarkCopyResetTimer = useRef<number | null>(null)
  const shareCopyResetTimer = useRef<number | null>(null)
  const skipFirstFeedQueryEffect = useRef(true)

  const shareURL = useMemo(
    () => (shareTarget ? buildTrackedShareURL(shareTarget.url) : ''),
    [shareTarget]
  )

  useEffect(() => {
    if (!shareTarget) {
      setShareQRCodeURL('')
      setShareQRCodeLoading(false)
      setShareLinkCopied(false)
      if (shareCopyResetTimer.current) {
        window.clearTimeout(shareCopyResetTimer.current)
        shareCopyResetTimer.current = null
      }
      return
    }

    let cancelled = false
    setShareQRCodeLoading(true)
    setShareQRCodeURL('')

    void import('qrcode')
      .then(module => {
        const toDataURL = module.toDataURL ?? module.default?.toDataURL
        if (!toDataURL) {
          throw new Error('QRCode renderer unavailable')
        }
        return toDataURL(shareURL, { margin: 1, width: 240 })
      })
      .then(dataURL => {
        if (!cancelled) {
          setShareQRCodeURL(dataURL)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setShareQRCodeURL('')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setShareQRCodeLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [shareTarget, shareURL])

  const fetchSources = useCallback(async (options?: { background?: boolean }) => {
    if (!options?.background) {
      setSourcesLoading(true)
    }
    try {
      const sourcesResponse = await pb.send<PBList<FeedSourceRecord>>('/api/feeds/sources', {})
      const nextSources = sourcesResponse.items ?? []

      setSources(nextSources)
      setSourceItemCounts(
        Object.fromEntries(nextSources.map(source => [source.id, source.item_count ?? 0]))
      )
      setError('')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load feed sources'))
      throw err
    } finally {
      if (!options?.background) {
        setSourcesLoading(false)
      }
    }
  }, [])

  const fetchFeedSummary = useCallback(async () => {
    try {
      const summaryResponse = await pb.send<FeedSummaryResponse>('/api/feeds/summary', {})
      setFeedStarredItems(summaryResponse.starredItems ?? 0)
      setSourceItemCounts(
        Object.fromEntries(
          (summaryResponse.sourceCounts ?? []).map(entry => [entry.sourceId, entry.count])
        )
      )
    } catch {
      // Keep the last known counts instead of blocking the page on non-critical summary data.
    }
  }, [])

  const fetchFeedItems = useCallback(
    async ({
      filter,
      query,
      page,
      append = false,
    }: {
      filter: 'all' | 'bookmark' | 'starred' | string
      query: string
      page: number
      append?: boolean
    }) => {
      if (filter === 'bookmark') return

      const params = new URLSearchParams({
        page: String(page),
        perPage: String(FEED_ITEMS_PER_PAGE),
      })
      const trimmedQuery = query.trim()
      if (trimmedQuery) {
        params.set('q', trimmedQuery)
      }
      if (filter === 'starred') {
        params.set('starred', 'true')
      } else if (filter !== 'all') {
        params.set('sourceId', filter)
      }

      if (append) {
        setFeedLoadingMore(true)
      }

      try {
        const response = await pb.send<FeedListResponse>(
          `/api/feeds/items?${params.toString()}`,
          {}
        )
        const nextItems = response.items ?? []
        setItems(current => {
          if (!append) return nextItems

          const seen = new Set(current.map(item => item.id))
          return [...current, ...nextItems.filter(item => !seen.has(item.id))]
        })
        setFeedPage(response.page ?? page)
        setFeedTotalItems(response.totalItems ?? 0)
        setError('')
      } catch (err) {
        setError(getApiErrorMessage(err, 'Failed to load feed items'))
      } finally {
        if (append) {
          setFeedLoadingMore(false)
        }
      }
    },
    []
  )

  const fetchBookmarks = useCallback(async (page: number, query: string) => {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(BOOKMARKS_PER_PAGE),
    })
    const trimmedQuery = query.trim()
    if (trimmedQuery) {
      params.set('q', trimmedQuery)
    }

    setBookmarkLoading(true)
    try {
      const response = await pb.send<BookmarkListResponse>(
        `/api/feeds/bookmarks?${params.toString()}`,
        {}
      )
      setBookmarkItems(response.items ?? [])
      setBookmarkTotalItems(response.totalItems ?? 0)
      setBookmarkTotalBookmarks(response.totalBookmarks ?? 0)
      setBookmarkDataLoaded(true)
      if (response.page && response.page !== page) {
        setBookmarkPage(response.page)
      }
      setError('')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load bookmarks'))
    } finally {
      setBookmarkLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setLoading(true)
      try {
        await Promise.all([fetchSources(), fetchFeedItems({ filter: 'all', query: '', page: 1 })])
        void fetchFeedSummary()
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fetchFeedItems, fetchFeedSummary, fetchSources])

  useEffect(() => {
    if (skipFirstFeedQueryEffect.current) {
      skipFirstFeedQueryEffect.current = false
      return
    }
    if (itemSourceFilter === 'bookmark') return

    void (async () => {
      setLoading(true)
      try {
        setExpandedItemId(null)
        await fetchFeedItems({
          filter: itemSourceFilter,
          query: searchQuery,
          page: 1,
        })
      } finally {
        setLoading(false)
      }
    })()
  }, [fetchFeedItems, itemSourceFilter, searchQuery])

  useEffect(() => {
    if (itemSourceFilter !== 'bookmark') return
    void fetchBookmarks(bookmarkPage, bookmarkSearchQuery)
  }, [bookmarkPage, bookmarkSearchQuery, fetchBookmarks, itemSourceFilter])

  const sourceNameByID = useMemo(() => {
    return new Map(sources.map(source => [source.id, source.name]))
  }, [sources])

  const feedItems = items

  const sortedSources = useMemo(() => {
    return [...sources].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
    )
  }, [sources])

  const starredCount = feedStarredItems

  const visibleItems = feedItems

  const bookmarkPageCount = useMemo(
    () => Math.max(1, Math.ceil(bookmarkTotalItems / BOOKMARKS_PER_PAGE)),
    [bookmarkTotalItems]
  )

  const bookmarkRangeLabel = useMemo(() => {
    if (bookmarkTotalItems === 0 || bookmarkItems.length === 0) return '0-0'
    const safePage = Math.min(bookmarkPage, bookmarkPageCount)
    const start = (safePage - 1) * BOOKMARKS_PER_PAGE + 1
    const end = start + bookmarkItems.length - 1
    return `${start}-${end}`
  }, [bookmarkItems.length, bookmarkPage, bookmarkPageCount, bookmarkTotalItems])

  const selectedSource = useMemo(() => {
    if (
      itemSourceFilter === 'all' ||
      itemSourceFilter === 'bookmark' ||
      itemSourceFilter === 'starred'
    )
      return null
    return sources.find(source => source.id === itemSourceFilter) ?? null
  }, [itemSourceFilter, sources])

  const selectedSourcePullStatus = useMemo(() => {
    if (!selectedSource) return ''
    if (sourcePollingId === selectedSource.id) return 'Pulling source now...'
    return getSourcePullStatus(selectedSource)
  }, [selectedSource, sourcePollingId])

  const clearSourceMaxCount = clearSourceTarget ? (sourceItemCounts[clearSourceTarget.id] ?? 0) : 0

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
    setBookmarkEditTarget(null)
    setBookmarkURL('')
    setBookmarkTitle('')
    setBookmarkSummary('')
    setBookmarkFaviconURL('')
    setBookmarkError('')
    setBookmarkDialogOpen(true)
  }

  function openBookmarkEdit(item: FeedItemRecord) {
    setBookmarkEditTarget({
      id: item.id,
      title: item.title,
      link: item.link,
      summary: item.summary,
      favicon_url: item.favicon_url,
    })
    setBookmarkURL(item.link)
    setBookmarkTitle(item.title)
    setBookmarkSummary(item.summary?.trim() || '')
    setBookmarkFaviconURL(item.favicon_url?.trim() || '')
    setBookmarkError('')
    setBookmarkDialogOpen(true)
  }

  async function handleAnalyzeBookmark() {
    const url = normalizeURL(bookmarkURL)
    if (!url) {
      setBookmarkError('Bookmark URL is required.')
      return
    }

    setBookmarkAnalyzing(true)
    setBookmarkError('')
    try {
      const analysis = await pb.send<BookmarkAnalysis>('/api/feeds/bookmarks/analyze', {
        method: 'POST',
        body: { url },
      })
      setBookmarkURL(analysis.resolved_url?.trim() || url)
      setBookmarkTitle(analysis.title?.trim() || '')
      setBookmarkSummary(analysis.description?.trim() || '')
      setBookmarkFaviconURL(analysis.favicon_url?.trim() || '')
    } catch (err) {
      setBookmarkError(getBookmarkAnalyzeErrorMessage(err))
    } finally {
      setBookmarkAnalyzing(false)
    }
  }

  async function handleBookmarkSubmit(event: FormEvent) {
    event.preventDefault()

    const url = normalizeURL(bookmarkURL)
    if (!url) {
      setBookmarkError('Bookmark URL is required.')
      return
    }

    setBookmarkSaving(true)
    setBookmarkError('')
    try {
      await pb.send<BookmarkCreateResponse>(
        bookmarkEditTarget
          ? `/api/feeds/bookmarks/${bookmarkEditTarget.id}`
          : '/api/feeds/bookmarks',
        {
          method: bookmarkEditTarget ? 'PATCH' : 'POST',
          body: {
            url,
            title: bookmarkTitle.trim(),
            summary: bookmarkSummary.trim(),
            favicon_url: bookmarkFaviconURL.trim(),
          },
        }
      )
      setBookmarkDialogOpen(false)
      setBookmarkEditTarget(null)
      setItemSourceFilter('bookmark')
      setExpandedItemId(null)
      if (bookmarkEditTarget) {
        await fetchBookmarks(bookmarkPage, bookmarkSearchQuery)
      } else {
        setBookmarkPage(1)
        await fetchBookmarks(1, bookmarkSearchQuery)
      }
    } catch (err) {
      setBookmarkError(getBookmarkSaveErrorMessage(err))
    } finally {
      setBookmarkSaving(false)
    }
  }
  useEffect(() => {
    setBookmarkPage(1)
  }, [bookmarkSearchQuery])

  function openCreate() {
    setEditingSource(null)
    setCreateStep('url')
    setAnalyzeURL('')
    setAnalyzedSiteURL('')
    setAnalyzedSiteTitle('')
    setFormName('')
    setFormURL('')
    setFormFaviconURL('')
    setFormFormat('rss')
    setFormStatus('active')
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
    setFormFaviconURL(source.favicon_url?.trim() || '')
    setFormFormat(source.format)
    setFormStatus(source.status)
    setFormError('')
    setAnalysisState('idle')
    setDialogOpen(true)
  }

  /** Ensure the URL has an http(s) protocol; if missing, default to https:// */
  function normalizeURL(raw: string): string {
    const trimmed = raw.trim()
    if (!trimmed) return ''
    // If it already has a scheme (contains :// anywhere), leave it as-is
    if (/:\/\//.test(trimmed)) return trimmed
    // Otherwise prepend https://
    return `https://${trimmed}`
  }

  async function handleAnalyzeSource() {
    const url = normalizeURL(analyzeURL)

    if (!url) {
      setFormError('Feed URL is required.')
      return
    }

    // Immediately reflect the corrected URL in the input field
    if (url !== analyzeURL) {
      setAnalyzeURL(url)
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
      setFormFaviconURL(analysis.favicon_url?.trim() || '')
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

    if (!name || !url) {
      setFormError('Name and feed URL are required.')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      if (editingSource) {
        await pb.send(`/api/feeds/sources/${editingSource.id}`, {
          method: 'PATCH',
          body: {
            name,
            url,
              format: formFormat,
            favicon_url: formFaviconURL.trim(),
            status: formStatus,
          },
        })
      } else {
        const createdSource = await pb.send<FeedSourceRecord>('/api/feeds/sources', {
          method: 'POST',
          body: {
            name,
            url,
            favicon_url: formFaviconURL.trim(),
            format: formFormat,
            status: formStatus,
          },
        })

        if (isSuperuser && createdSource?.id) {
          try {
            await pb.send(`/api/feeds/sources/${createdSource.id}/poll`, {
              method: 'POST',
            })
          } catch (pollErr) {
            setError(
              getApiErrorMessage(pollErr, `Source saved, but initial pull failed for ${name}`)
            )
          }

          setItemSourceFilter(createdSource.id)
          setExpandedItemId(null)
        }
      }

      setDialogOpen(false)
      await fetchSources()
      void fetchFeedSummary()
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
      await pb.send(`/api/feeds/sources/${deleteSourceTarget.id}`, {
        method: 'DELETE',
      })
      setDeleteSourceTarget(null)
      setDialogOpen(false)
      if (itemSourceFilter === deleteSourceTarget.id) {
        setItemSourceFilter('all')
        setExpandedItemId(null)
      }
      setNotice(`Deleted source ${deleteSourceTarget.name}.`)
      await Promise.all([
        fetchSources(),
        fetchFeedItems({
          filter: itemSourceFilter === deleteSourceTarget.id ? 'all' : itemSourceFilter,
          query: searchQuery,
          page: 1,
        }),
      ])
      void fetchFeedSummary()
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Failed to delete feed source'))
    } finally {
      setDeletingSource(false)
    }
  }

  async function handleRefresh() {
    setError('')
    setRefreshing(true)
    try {
      if (itemSourceFilter === 'bookmark') {
        await fetchBookmarks(bookmarkPage, bookmarkSearchQuery)
        void fetchSources({ background: true })
        void fetchFeedSummary()
      } else {
        setLoading(true)
        try {
          await fetchFeedItems({ filter: itemSourceFilter, query: searchQuery, page: 1 })
          void fetchSources({ background: true })
          void fetchFeedSummary()
        } finally {
          setLoading(false)
        }
      }
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to reload feeds'))
    } finally {
      setRefreshing(false)
    }
  }

  async function handleSourcePoll(source: FeedSourceRecord) {
    setError('')
    setSourcePollingId(source.id)
    try {
      await pb.send<{ summary: FeedPollSummary }>(`/api/feeds/sources/${source.id}/poll`, {
        method: 'POST',
      })
      await Promise.all([
        fetchSources(),
        fetchFeedItems({ filter: itemSourceFilter, query: searchQuery, page: 1 }),
      ])
      void fetchFeedSummary()
    } catch (err) {
      setError(getApiErrorMessage(err, `Failed to pull ${source.name}`))
    } finally {
      setSourcePollingId('')
    }
  }

  async function handleClearSourceArticles() {
    if (!clearSourceTarget) return

    const requestedCount = clampDeleteCount(clearSourceCount, clearSourceMaxCount)
    if (requestedCount <= 0) {
      setError(`No articles available for ${clearSourceTarget.name}.`)
      return
    }

    setClearingSource(true)
    setError('')
    try {
      const result = await pb.send<FeedSourceDeleteResult>(
        `/api/feeds/sources/${clearSourceTarget.id}/delete`,
        {
          method: 'POST',
          body: { count: requestedCount },
        }
      )

      await fetchSources()
      await fetchFeedItems({ filter: itemSourceFilter, query: searchQuery, page: 1 })
      void fetchFeedSummary()
      setClearSourceTarget(null)
      setClearSourceCount(0)
      setNotice(
        result.deleted_count > 0
          ? `Deleted ${result.deleted_count} oldest article${result.deleted_count === 1 ? '' : 's'} from ${clearSourceTarget.name}.`
          : `No articles deleted from ${clearSourceTarget.name}.`
      )
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to delete source articles'))
    } finally {
      setClearingSource(false)
    }
  }

  function openSourceDeleteDialog(source: FeedSourceRecord) {
    const maxCount = sourceItemCounts[source.id] ?? 0
    setClearSourceTarget(source)
    setClearSourceCount(maxCount)
  }

  function handleSelectSource(sourceId: 'all' | 'bookmark' | 'starred' | string) {
    setItemSourceFilter(sourceId)
    setExpandedItemId(null)
    if (sourceId === 'bookmark') {
      setSearchOpen(false)
      setSearchQuery('')
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
      const currentItem = items.find(item => item.id === itemId) ?? null
      const updated = await pb.send<Pick<FeedItemRecord, 'id' | 'read_state' | 'is_starred'>>(
        `/api/feeds/items/${itemId}/state`,
        {
          method: 'PATCH',
          body: patch,
        }
      )
      setItems(current => {
        if (itemSourceFilter === 'starred' && !updated.is_starred) {
          return current.filter(item => item.id !== itemId)
        }

        return current.map(item =>
          item.id === itemId
            ? {
                ...item,
                read_state: updated.read_state,
                is_starred: updated.is_starred,
              }
            : item
        )
      })
      if (currentItem && currentItem.is_starred !== updated.is_starred) {
        setFeedStarredItems(current => Math.max(0, current + (updated.is_starred ? 1 : -1)))
        if (itemSourceFilter === 'starred' && !updated.is_starred) {
          setFeedTotalItems(current => Math.max(0, current - 1))
        }
      }
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

    setBookmarkItems(current => current.filter(candidate => candidate.id !== item.id))
    setItemUpdatingId(current => (current === item.id ? '' : current))
    setPendingBookmarkUndo({
      title: item.title,
      link: item.link,
      summary: item.summary?.trim() || '',
      favicon_url: item.favicon_url,
    })
    setNotice(`Removed ${item.title} from bookmarks.`)
    await fetchBookmarks(bookmarkPage, bookmarkSearchQuery)
  }

  async function handleBookmarkUndo() {
    if (!pendingBookmarkUndo) return

    setBookmarkSaving(true)
    try {
      await pb.send<BookmarkCreateResponse>('/api/feeds/bookmarks', {
        method: 'POST',
        body: {
          url: pendingBookmarkUndo.link,
          title: pendingBookmarkUndo.title,
          summary: pendingBookmarkUndo.summary,
          favicon_url: pendingBookmarkUndo.favicon_url || '',
        },
      })
      setNotice(`Restored ${pendingBookmarkUndo.title}.`)
      setPendingBookmarkUndo(null)
      await fetchBookmarks(bookmarkPage, bookmarkSearchQuery)
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

  function handleShare(item: FeedItemRecord) {
    setShareTarget({
      title: item.title,
      url: item.link,
    })
  }

  async function handleCopyShareURL() {
    if (!shareURL) return

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareURL)
        setShareLinkCopied(true)
        if (shareCopyResetTimer.current) {
          window.clearTimeout(shareCopyResetTimer.current)
        }
        shareCopyResetTimer.current = window.setTimeout(() => {
          setShareLinkCopied(false)
          shareCopyResetTimer.current = null
        }, 2000)
        return
      }

      if (legacyCopyText(shareURL)) {
        setShareLinkCopied(true)
      }
    } catch {
      if (legacyCopyText(shareURL)) {
        setShareLinkCopied(true)
      }
    }
  }

  async function handleCopyBookmarkURL(item: FeedItemRecord) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.link)
        setCopiedBookmarkId(item.id)
        if (bookmarkCopyResetTimer.current) {
          window.clearTimeout(bookmarkCopyResetTimer.current)
        }
        bookmarkCopyResetTimer.current = window.setTimeout(() => {
          setCopiedBookmarkId(current => (current === item.id ? '' : current))
          bookmarkCopyResetTimer.current = null
        }, 2000)
        return
      }

      if (legacyCopyText(item.link)) {
        setCopiedBookmarkId(item.id)
        if (bookmarkCopyResetTimer.current) {
          window.clearTimeout(bookmarkCopyResetTimer.current)
        }
        bookmarkCopyResetTimer.current = window.setTimeout(() => {
          setCopiedBookmarkId(current => (current === item.id ? '' : current))
          bookmarkCopyResetTimer.current = null
        }, 2000)
        return
      }

      setError('Failed to copy bookmark URL')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to copy bookmark URL'))
    }
  }

  useEffect(() => {
    return () => {
      if (bookmarkCopyResetTimer.current) {
        window.clearTimeout(bookmarkCopyResetTimer.current)
      }
      if (shareCopyResetTimer.current) {
        window.clearTimeout(shareCopyResetTimer.current)
      }
    }
  }, [])

  async function handleConvertItemToBookmark(item: FeedItemRecord) {
    setItemUpdatingId(item.id)
    setError('')
    try {
      const bookmark = await pb.send<BookmarkCreateResponse>(
        `/api/feeds/items/${item.id}/bookmark`,
        {
          method: 'POST',
        }
      )
      setItems(current => current.filter(candidate => candidate.id !== item.id))
      setBookmarkItems(current => [
        bookmark as FeedItemRecord,
        ...current.filter(candidate => candidate.id !== bookmark.id),
      ])
      setFeedTotalItems(current => Math.max(0, current - 1))
      if (item.is_starred) {
        setFeedStarredItems(current => Math.max(0, current - 1))
      }
      if (item.source_id) {
        setSourceItemCounts(current => ({
          ...current,
          [item.source_id as string]: Math.max(0, (current[item.source_id as string] ?? 0) - 1),
        }))
      }
      setBookmarkTotalBookmarks(current => current + 1)
      setBookmarkTotalItems(current => current + 1)
      setExpandedItemId(null)
      setItemSourceFilter('bookmark')
      setBookmarkPage(1)
      setNotice(`Moved ${bookmark.title || item.title} to bookmarks.`)
      await fetchBookmarks(1, bookmarkSearchQuery)
    } catch (err) {
      setError(getBookmarkSaveErrorMessage(err))
    } finally {
      setItemUpdatingId(current => (current === item.id ? '' : current))
    }
  }

  useEffect(() => {
    if (
      loading ||
      feedLoadingMore ||
      itemSourceFilter === 'bookmark' ||
      items.length >= feedTotalItems
    )
      return

    const maybeLoadMore = () => {
      const doc = document.documentElement
      const remaining = doc.scrollHeight - (window.scrollY + window.innerHeight)
      if (remaining > 160) return
      void fetchFeedItems({
        filter: itemSourceFilter,
        query: searchQuery,
        page: feedPage + 1,
        append: true,
      })
    }

    window.addEventListener('scroll', maybeLoadMore, { passive: true })
    window.addEventListener('resize', maybeLoadMore)
    return () => {
      window.removeEventListener('scroll', maybeLoadMore)
      window.removeEventListener('resize', maybeLoadMore)
    }
  }, [
    feedLoadingMore,
    feedPage,
    feedTotalItems,
    fetchFeedItems,
    itemSourceFilter,
    items.length,
    loading,
    searchQuery,
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Feeds</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Unified hub for RSS feeds, web content and bookmarks.
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
            disabled={refreshing}
            title="Reload"
            aria-label="Refresh"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          {isSuperuser ? (
            <Button type="button" onClick={openCreate}>
              Add Source
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Dismiss error"
              onClick={dismissError}
            >
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleBookmarkUndo()}
                >
                  Undo
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Dismiss notification"
                onClick={dismissNotice}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="rounded-lg border bg-card text-card-foreground shadow-sm xl:sticky xl:top-6 xl:self-start">
          <div className="border-b p-4">
            <h2 className="text-lg font-semibold tracking-tight">Sources</h2>
          </div>

          <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-2">
            <div className="space-y-1">
              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] hover:bg-muted/60 ${itemSourceFilter === 'all' ? 'bg-muted font-medium' : ''}`}
                onClick={() => void handleSelectSource('all')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ring-1 ring-border/70">
                    A
                  </div>
                  <span className="truncate">All</span>
                </span>
                <span className="rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-xs font-medium text-foreground/80">
                  {Object.values(sourceItemCounts).reduce((sum, count) => sum + count, 0)}
                </span>
              </button>

              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] hover:bg-muted/60 ${itemSourceFilter === 'bookmark' ? 'bg-muted font-medium' : ''}`}
                onClick={() => void handleSelectSource('bookmark')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Bookmark className="h-4 w-4 text-sky-600" />
                  <span className="truncate">Bookmark</span>
                </span>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">
                  {bookmarkLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : bookmarkDataLoaded ? (
                    bookmarkTotalBookmarks
                  ) : (
                    '...'
                  )}
                </span>
              </button>

              <button
                type="button"
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[13px] hover:bg-muted/60 ${itemSourceFilter === 'starred' ? 'bg-muted font-medium' : ''}`}
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

              {sourcesLoading ? (
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
                    className={`flex w-full min-w-0 items-center justify-between rounded-md px-3 py-2 text-left text-[13px] hover:bg-muted/60 ${itemSourceFilter === source.id ? 'bg-muted font-medium' : ''}`}
                    onClick={() => void handleSelectSource(source.id)}
                  >
                    <SourceInlineLabel
                      name={source.name}
                      url={source.url}
                      faviconUrl={source.favicon_url}
                      textClassName="min-w-0 truncate"
                    />
                    <span className="ml-3 shrink-0 rounded-full border border-border/70 bg-background px-2.5 py-0.5 text-xs font-medium text-foreground/80">
                      {sourcePollingId === source.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        `(${sourceItemCounts[source.id] ?? 0})`
                      )}
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
                <div className="flex items-center gap-2.5">
                  {selectedSource ? (
                    <SourceFavicon
                      name={selectedSource.name}
                      url={selectedSource.url}
                      faviconUrl={selectedSource.favicon_url}
                    />
                  ) : null}
                  <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">
                    {activeSourceName}
                  </h2>
                  {selectedSource && isSuperuser ? (
                    <div className="ml-5 flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Delete selected source articles"
                        title="Delete selected source articles"
                        onClick={() => openSourceDeleteDialog(selectedSource)}
                      >
                        <Eraser className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
                {selectedSource ? (
                  <div
                    className="mt-1 truncate text-xs text-muted-foreground"
                    title={selectedSourcePullStatus}
                  >
                    {selectedSourcePullStatus}
                  </div>
                ) : null}
                {itemSourceFilter === 'bookmark' ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Centralize AppOS-related resources and personal favorite links here.
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Close search"
                    onClick={toggleSearch}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Open article search"
                  onClick={toggleSearch}
                >
                  <Search className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-3">
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
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Add Bookmark"
                        title="Add Bookmark"
                        onClick={openBookmarkCreate}
                      >
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
                      <span>Total: {bookmarkTotalBookmarks}</span>
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
                          onClick={() =>
                            setBookmarkPage(current => Math.min(bookmarkPageCount, current + 1))
                          }
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-[minmax(0,2.8fr)_minmax(0,1.1fr)_7rem] gap-3 border-b bg-background px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                    <span>Title</span>
                    <span className="text-left">Domain</span>
                    <span className="text-left">Actions</span>
                  </div>

                  <div role="list" aria-label="Bookmarks list" className="divide-y">
                    {bookmarkItems.map(item => {
                      const isUpdating = itemUpdatingId === item.id
                      const copied = copiedBookmarkId === item.id
                      const description = item.summary?.trim() || ''
                      const displayTitle = getDisplayItemTitle(item)
                      const displayHost = getDisplayBookmarkHost(item.link)
                      return (
                        <div
                          key={item.id}
                          role="listitem"
                          aria-label={`Bookmark ${displayTitle}`}
                          className="grid grid-cols-[minmax(0,2.8fr)_minmax(0,1.1fr)_7rem] items-center gap-3 bg-card px-4 py-3 text-left"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <SourceFavicon
                              name={displayTitle}
                              url={item.link}
                              faviconUrl={item.favicon_url}
                              fallbackLabel={getHostLabel(item.link)}
                            />
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noreferrer"
                              className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-foreground hover:text-primary"
                              title={description || displayTitle}
                            >
                              <span className="truncate">{displayTitle}</span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            </a>
                          </div>
                          <div
                            className="flex min-w-0 items-center justify-start gap-1 text-left font-mono text-xs text-muted-foreground"
                            title={item.link}
                          >
                            <span className="min-w-0 truncate">{displayHost}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              aria-label={`Copy bookmark URL ${displayTitle}`}
                              title={`Copy bookmark URL ${displayTitle}`}
                              onClick={() => void handleCopyBookmarkURL(item)}
                            >
                              {copied ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            {copied ? (
                              <span className="shrink-0 text-[11px] text-emerald-600">Copied</span>
                            ) : null}
                          </div>
                          <div className="flex w-28 shrink-0 items-center justify-start gap-1 text-left">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit bookmark ${displayTitle}`}
                              title={`Edit bookmark ${displayTitle}`}
                              disabled={isUpdating}
                              onClick={() => openBookmarkEdit(item)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove bookmark ${displayTitle}`}
                              title={`Remove bookmark ${displayTitle}`}
                              disabled={isUpdating}
                              onClick={() => void handleBookmarkRemove(item)}
                            >
                              {isUpdating ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                {bookmarkLoading && bookmarkItems.length === 0 ? (
                  <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground shadow-sm">
                    Loading bookmarks...
                  </div>
                ) : null}
                {!bookmarkLoading && bookmarkTotalItems === 0 ? (
                  <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground shadow-sm">
                    {bookmarkTotalBookmarks === 0
                      ? 'No bookmarks saved yet.'
                      : 'No bookmarks match this search.'}
                  </div>
                ) : null}
              </>
            ) : items.length === 0 ? (
              <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground shadow-sm">
                {feedTotalItems === 0 && itemSourceFilter === 'all' && !searchQuery.trim()
                  ? 'No feed items ingested yet.'
                  : 'No feed items for this source.'}
              </div>
            ) : (
              visibleItems.map(item => {
                const displayTitle = getDisplayItemTitle(item)
                const sourceName =
                  item.origin_type === 'bookmark'
                    ? getHostLabel(item.link)
                    : item.expand?.source_id?.name ||
                      (item.source_id ? sourceNameByID.get(item.source_id) : '') ||
                      'Unknown source'
                const source =
                  item.origin_type === 'bookmark'
                    ? undefined
                    : item.expand?.source_id ||
                      sources.find(candidate => candidate.id === item.source_id)
                const expanded = expandedItemId === item.id
                const isRead = item.read_state === 'read'
                const isStarred = item.is_starred
                const isUpdating = itemUpdatingId === item.id
                const detail = getFeedItemDetail(item)

                return (
                  <div key={item.id} className="rounded-lg border bg-card px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => toggleItemDetails(item)}
                      >
                        <div
                          className={`leading-6 text-[13px] ${isRead ? 'font-normal text-muted-foreground' : 'font-medium'}`}
                        >
                          <span className="inline-flex items-center gap-2">
                            {isStarred ? (
                              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                            ) : null}
                            {item.origin_type === 'bookmark' ? (
                              <Bookmark className="h-4 w-4 text-sky-600" />
                            ) : null}
                            <span>{displayTitle}</span>
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{formatRelativeTime(item.published_at)}</span>
                          <span>&middot;</span>
                          <SourceInlineLabel
                            name={sourceName}
                            url={source?.url || item.link}
                            faviconUrl={
                              item.origin_type === 'bookmark'
                                ? item.favicon_url
                                : source?.favicon_url
                            }
                            fallbackLabel={
                              item.origin_type === 'bookmark' ? getHostLabel(item.link) : sourceName
                            }
                            textClassName="truncate"
                          />
                        </div>
                      </button>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={`Open ${displayTitle}`}
                        title={`Open ${displayTitle}`}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>

                    {expanded ? (
                      <div className="mt-4 space-y-5">
                        <div className="min-w-0 space-y-3">
                          {detail.html ? (
                            <div
                              className="prose prose-sm max-w-none break-words text-foreground/90 prose-headings:mb-3 prose-headings:mt-0 prose-p:my-3 prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-blockquote:border-l-border prose-blockquote:text-muted-foreground prose-pre:whitespace-pre-wrap prose-code:break-words prose-img:my-4 prose-img:max-w-full prose-img:rounded-md"
                              dangerouslySetInnerHTML={{ __html: detail.html }}
                            />
                          ) : (
                            <div className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground/90">
                              {detail.text || 'No summary extracted for this article.'}
                            </div>
                          )}
                        </div>

                        <div className="space-y-2 text-xs leading-5 text-muted-foreground">
                          <div>
                            Type: {item.origin_type === 'bookmark' ? 'Bookmark' : 'Feed item'}
                          </div>
                          <div>
                            Published:{' '}
                            {item.published_at
                              ? new Date(item.published_at).toLocaleString()
                              : 'Unknown'}
                          </div>
                          <div>Source: {sourceName}</div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isUpdating}
                            onClick={() =>
                              void patchItemPreferences(
                                item.id,
                                { read_state: 'unread' },
                                'Failed to keep feed item unread'
                              )
                            }
                          >
                            {isUpdating ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Undo2 className="mr-2 h-4 w-4" />
                            )}
                            Keep Unread
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isUpdating}
                            onClick={() =>
                              void patchItemPreferences(
                                item.id,
                                { is_starred: !isStarred },
                                'Failed to update feed item star'
                              )
                            }
                          >
                            {isUpdating ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Star className={`mr-2 h-4 w-4 ${isStarred ? 'fill-current' : ''}`} />
                            )}
                            {isStarred ? 'Starred' : 'Star'}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleShare(item)}
                          >
                            <Share2 className="mr-2 h-4 w-4" />
                            Share
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isUpdating}
                            onClick={() => void handleConvertItemToBookmark(item)}
                          >
                            {isUpdating ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Bookmark className="mr-2 h-4 w-4" />
                            )}
                            Bookmark
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
            {!loading && items.length < feedTotalItems ? (
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
                    <div
                      className={`mt-5 hidden h-0.5 flex-1 rounded-full md:block ${createStep === 'details' ? 'bg-primary/50' : 'bg-border/80'}`}
                    />
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
                  <p className="text-xs text-muted-foreground">
                    Paste the feed URL and we will auto-fill the next step.
                  </p>
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
                      <div className="text-primary/80">
                        Fetching metadata, detecting feed format, and preparing the subscription
                        details.
                      </div>
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
                      <div className="text-primary/80">
                        The source metadata has been detected and stored for this subscription.
                      </div>
                    </div>
                  </div>
                ) : null}

                {editingSource ? (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                      <MetaField label="Feed URL" value={formURL || 'Not available'} />
                      <div className="space-y-2">
                        <Label>Status</Label>
                        <Select
                          value={formStatus}
                          onValueChange={value =>
                            setFormStatus(value as FeedSourceRecord['status'])
                          }
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
                    </div>
                    <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                      Feed URL and format are immutable identity fields. Create a new source if the
                      upstream feed changes.
                    </div>
                    <FaviconMetaCard
                      title={analyzedSiteTitle || formName}
                      url={analyzedSiteURL || formURL}
                      faviconUrl={formFaviconURL}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <MetaField label="Feed URL" value={formURL || 'Not available'} />
                      <WebsiteMetaCard
                        title={analyzedSiteTitle}
                        url={analyzedSiteURL}
                        faviconUrl={formFaviconURL}
                      />
                      <MetaField label="Format" value={formFormat.toUpperCase()} />
                      <MetaField label="Status" value={formStatus} />
                    </div>
                    <FaviconMetaCard
                      title={analyzedSiteTitle || formName}
                      url={analyzedSiteURL || formURL}
                      faviconUrl={formFaviconURL}
                    />
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
                <Button
                  type="button"
                  onClick={() => void handleAnalyzeSource()}
                  disabled={analyzing}
                >
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
              <DialogTitle>{bookmarkEditTarget ? 'Edit Bookmark' : 'Add Bookmark'}</DialogTitle>
              <DialogDescription>
                {bookmarkEditTarget
                  ? 'Update one saved link without turning it into a polling source.'
                  : 'Save one manual link into the Feeds workspace without turning it into a polling source.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="bookmark-url">Bookmark URL</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="bookmark-url"
                  value={bookmarkURL}
                  onChange={event => setBookmarkURL(event.target.value)}
                  placeholder="https://example.com/article"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleAnalyzeBookmark()}
                  disabled={bookmarkAnalyzing}
                >
                  {bookmarkAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Fetch Details
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Fetch the page metadata to auto-fill title, description, and favicon.
              </p>
            </div>

            {bookmarkFaviconURL ? (
              <div className="flex items-start gap-3 rounded-xl border bg-muted/20 px-4 py-3">
                <SourceFavicon
                  name={bookmarkTitle || bookmarkURL || 'B'}
                  url={bookmarkURL || bookmarkFaviconURL}
                  faviconUrl={bookmarkFaviconURL}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">Detected favicon</div>
                  <div
                    className="truncate text-xs text-muted-foreground"
                    title={bookmarkFaviconURL}
                  >
                    {bookmarkFaviconURL}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="bookmark-title">Title</Label>
              <Input
                id="bookmark-title"
                value={bookmarkTitle}
                onChange={event => setBookmarkTitle(event.target.value)}
                placeholder="Page title"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bookmark-summary">Description</Label>
              <Input
                id="bookmark-summary"
                value={bookmarkSummary}
                onChange={event => setBookmarkSummary(event.target.value)}
                placeholder="Page description"
              />
            </div>

            {bookmarkError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {bookmarkError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setBookmarkDialogOpen(false)
                  setBookmarkEditTarget(null)
                }}
                disabled={bookmarkSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={bookmarkSaving || bookmarkAnalyzing}>
                {bookmarkSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : bookmarkEditTarget ? (
                  <Pencil className="mr-2 h-4 w-4" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {bookmarkEditTarget ? 'Save Changes' : 'Save Bookmark'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={shareTarget !== null}
        onOpenChange={open => {
          if (!open) {
            setShareTarget(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          {shareTarget ? (
            <>
              <DialogHeader>
                <DialogTitle>Share</DialogTitle>
                <DialogDescription>
                  Share {shareTarget.title} with a tracked URL or QR code.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="share-url">Share URL</Label>
                  <Input id="share-url" value={shareURL} readOnly aria-label="Share URL" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCopyShareURL()}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      {shareLinkCopied ? 'Copied' : 'Copy URL'}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-medium text-foreground">QR Code</div>
                  <div className="flex min-h-64 items-center justify-center rounded-lg border bg-muted/20 p-4">
                    {shareQRCodeLoading ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating QR code...
                      </div>
                    ) : shareQRCodeURL ? (
                      <img
                        src={shareQRCodeURL}
                        alt={`QR code for ${shareTarget.title}`}
                        className="h-60 w-60 rounded-md bg-white p-3"
                      />
                    ) : (
                      <div className="text-sm text-muted-foreground">QR code unavailable.</div>
                    )}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShareTarget(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteSourceTarget}
        onOpenChange={open => !open && !deletingSource && setDeleteSourceTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Feed Source</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteSourceTarget
                ? `Delete ${deleteSourceTarget.name}? This will also delete ${sourceItemCounts[deleteSourceTarget.id] ?? 0} article${(sourceItemCounts[deleteSourceTarget.id] ?? 0) === 1 ? '' : 's'} already pulled from this source.`
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

      <AlertDialog
        open={!!clearSourceTarget}
        onOpenChange={open => {
          if (!open && !clearingSource) {
            setClearSourceTarget(null)
            setClearSourceCount(0)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Feed Articles</AlertDialogTitle>
            <AlertDialogDescription>
              {clearSourceTarget
                ? clearSourceMaxCount > 0
                  ? `Delete up to ${clearSourceMaxCount} pulled article${clearSourceMaxCount === 1 ? '' : 's'} from ${clearSourceTarget.name}. If you choose fewer than the total, the oldest articles will be deleted first.`
                  : `${clearSourceTarget.name} has no pulled articles to delete.`
                : 'Delete pulled articles for this source? The source will remain.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {clearSourceTarget && clearSourceMaxCount > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="source-delete-count">Article count</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() =>
                    setClearSourceCount(current =>
                      clampDeleteCount(current - 1, clearSourceMaxCount)
                    )
                  }
                  disabled={clearingSource || clearSourceCount <= 1}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  id="source-delete-count"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={clearSourceCount > 0 ? clearSourceCount : ''}
                  onChange={event =>
                    setClearSourceCount(
                      clampDeleteCount(Number(event.target.value), clearSourceMaxCount)
                    )
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() =>
                    setClearSourceCount(current =>
                      clampDeleteCount(current + 1, clearSourceMaxCount)
                    )
                  }
                  disabled={clearingSource || clearSourceCount >= clearSourceMaxCount}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">1 - {clearSourceMaxCount} articles</p>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearingSource}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault()
                void handleClearSourceArticles()
              }}
              disabled={clearingSource || clearSourceMaxCount === 0 || clearSourceCount <= 0}
            >
              {clearingSource ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete oldest articles
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
