import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Loader2, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { getLocale } from '@/lib/i18n'
import { TOPIC_GUEST_AUTHOR_PREFIX } from '../_app/_auth/-topics-shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MarkdownView } from '@/components/ui/markdown'
import { ModeToggle } from '@/components/mode-toggle'

// ─── Types ───────────────────────────────────────────────

interface SharedTopic {
  id: string
  title: string
  description: string
  closed: boolean
  created: string
  updated: string
  expires_at: string
  comments: SharedComment[]
}

interface SharedComment {
  id: string
  body: string
  created_by: string
  created: string
  updated: string
}

// ─── Helpers ─────────────────────────────────────────────

function formatDate(iso: string, locale: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatAuthor(createdBy: string) {
  if (createdBy.startsWith(TOPIC_GUEST_AUTHOR_PREFIX)) {
    return createdBy.slice(TOPIC_GUEST_AUTHOR_PREFIX.length)
  }
  return createdBy.slice(0, 8) + '…'
}

function timeRemaining(expiresAt: string, t: (key: string, values?: Record<string, unknown>) => string) {
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return t('shared.expires.expired')
  const mins = Math.ceil(diff / 60000)
  if (mins >= 60) {
    const h = Math.floor(mins / 60)
    return t('shared.expires.hoursMinutes', { hours: h, minutes: mins % 60 })
  }
  return t('shared.expires.minutes', { minutes: mins })
}

// ─── Page Component ──────────────────────────────────────

function SharedTopicPage() {
  const { t } = useTranslation('topics')
  const { token } = Route.useParams()
  const locale = getLocale()

  const [topic, setTopic] = useState<SharedTopic | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Comment form
  const [commentBody, setCommentBody] = useState('')
  const [guestName, setGuestName] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')

  const fetchTopic = useCallback(async () => {
    try {
      const res = await pb.send<SharedTopic>(`/api/topics/share/${encodeURIComponent(token)}`, {})
      setTopic(res)
      setError('')
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.data?.message ||
        t('shared.invalidLink')
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchTopic()
  }, [fetchTopic])

  async function handlePostComment(e: FormEvent) {
    e.preventDefault()
    const trimmed = commentBody.trim()
    if (!trimmed) return
    setPosting(true)
    setPostError('')
    try {
      await pb.send(`/api/topics/share/${encodeURIComponent(token)}/comments`, {
        method: 'POST',
        body: { body: trimmed, guest_name: guestName.trim() || t('shared.guestNameDefault') },
      })
      setCommentBody('')
      await fetchTopic()
    } catch (err) {
      setPostError(getApiErrorMessage(err, t('shared.postCommentFallback')))
    } finally {
      setPosting(false)
    }
  }

  // ─── Render ────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{t('shared.pageLabel')}</span>
        <ModeToggle />
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {loading && (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center h-64 space-y-3">
            <Lock className="h-10 w-10 text-muted-foreground" />
            <p className="text-lg font-medium text-muted-foreground">{error}</p>
          </div>
        )}

        {!loading && topic && (
          <>
            {/* Expiry banner */}
            <div className="bg-muted border rounded-lg px-4 py-2 text-sm text-muted-foreground flex items-center justify-between">
              <span>{t('shared.banner')}</span>
              <span className="font-medium">{timeRemaining(topic.expires_at, t)}</span>
            </div>

            {/* Topic header */}
            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight">{topic.title}</h1>
              <p className="text-sm text-muted-foreground">
                {t('shared.created', { time: formatDate(topic.created, locale) })} ·{' '}
                {t('shared.updated', { time: formatDate(topic.updated, locale) })}
              </p>
            </div>

            {topic.closed && (
              <div className="bg-muted border rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Lock className="h-4 w-4" />
                {t('shared.closed')}
              </div>
            )}

            {/* Topic description */}
            {topic.description && (
              <div className="border rounded-lg p-4">
                <MarkdownView>{topic.description}</MarkdownView>
              </div>
            )}

            {/* Comments */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">
                {t('shared.commentsTitle', { count: topic.comments.length })}
              </h2>

              {topic.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('shared.noComments')}</p>
              ) : (
                <div className="space-y-3">
                  {topic.comments.map(c => (
                    <div key={c.id} className="border rounded-lg p-4 space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {formatAuthor(c.created_by)} · {formatDate(c.created, locale)}
                        {c.updated !== c.created && <span> · {t('shared.edited')}</span>}
                      </p>
                      <MarkdownView>{c.body}</MarkdownView>
                    </div>
                  ))}
                </div>
              )}

              {/* Post comment form */}
              {!topic.closed ? (
                <form onSubmit={handlePostComment} className="space-y-3 border rounded-lg p-4">
                  <Label>{t('shared.addComment')}</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-1 space-y-1">
                      <Label htmlFor="guest-name" className="text-xs text-muted-foreground">
                        {t('shared.guestName')}
                      </Label>
                      <Input
                        id="guest-name"
                        value={guestName}
                        onChange={e => setGuestName(e.target.value)}
                        placeholder={t('shared.guestNameDefault')}
                        maxLength={100}
                      />
                    </div>
                    <div className="sm:col-span-2" />
                  </div>
                  <textarea
                    value={commentBody}
                    onChange={e => setCommentBody(e.target.value)}
                    placeholder={t('shared.commentPlaceholder')}
                    rows={4}
                    className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    maxLength={10000}
                  />
                  {postError && <p className="text-sm text-destructive">{postError}</p>}
                  <div className="flex justify-end">
                    <Button type="submit" disabled={posting || !commentBody.trim()}>
                      {posting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      {t('shared.postComment')}
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('shared.closedNoComments')}
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export const Route = createFileRoute('/share/topic/$token')({
  component: SharedTopicPage,
})
