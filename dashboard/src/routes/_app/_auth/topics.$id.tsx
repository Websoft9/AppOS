import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Pencil, Trash2, Loader2, ArrowLeft, Lock, Unlock, Share2, Copy, Check, ExternalLink, QrCode, Download, Upload } from 'lucide-react'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { copyToClipboard } from '@/lib/clipboard'
import { useAuth } from '@/contexts/AuthContext'
import { type PBList, formatDate, formatCreator, pbFilterValue } from '@/lib/groups'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownEditor, MarkdownView } from '@/components/ui/markdown'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// ─── Types ───────────────────────────────────────────────

interface TopicRecord {
  id: string
  title: string
  description: string
  created_by: string
  closed: boolean
  share_token: string
  share_expires_at: string
  created: string
  updated: string
}

interface CommentRecord {
  id: string
  topic_id: string
  body: string
  created_by: string
  created: string
  updated: string
}

// ─── Page Component ──────────────────────────────────────

function TopicDetailPage() {
  const { id } = Route.useParams()
  const navigate = Route.useNavigate()
  const { user } = useAuth()

  const [topic, setTopic] = useState<TopicRecord | null>(null)
  const [comments, setComments] = useState<CommentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // New comment
  const [commentBody, setCommentBody] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  // Edit topic dialog
  const [editOpen, setEditOpen] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Delete topic
  const [deleteTopicOpen, setDeleteTopicOpen] = useState(false)
  const [deletingTopic, setDeletingTopic] = useState(false)

  // Edit comment
  const [editingComment, setEditingComment] = useState<CommentRecord | null>(null)
  const [editCommentBody, setEditCommentBody] = useState('')
  const [savingComment, setSavingComment] = useState(false)

  // Delete comment
  const [deleteCommentTarget, setDeleteCommentTarget] = useState<CommentRecord | null>(null)
  const [deletingComment, setDeletingComment] = useState(false)

  // Close/Reopen
  const [togglingClosed, setTogglingClosed] = useState(false)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)

  // Share
  const shareUrlInputRef = useRef<HTMLInputElement>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [shareMinutes, setShareMinutes] = useState(30)
  const [sharing, setSharing] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrGenerating, setQrGenerating] = useState(false)

  const fetchTopic = useCallback(async () => {
    try {
      const [topicRes, commentsRes] = await Promise.all([
        pb.send<TopicRecord>(
          `/api/collections/topics/records/${pbFilterValue(id)}`,
          {},
        ),
        pb.send<PBList<CommentRecord>>(
          `/api/collections/topic_comments/records?perPage=500&filter=(topic_id='${pbFilterValue(id)}')&sort=created`,
          {},
        ),
      ])
      setTopic(topicRes)
      setComments(commentsRes.items ?? [])
      setError('')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load topic'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchTopic()
  }, [fetchTopic])

  function authorName(record: { created_by: string }) {
    return formatCreator(record.created_by, user?.id, user?.email)
  }

  const isTopicOwner = topic ? user?.id === topic.created_by : false

  // ─── Edit topic ─────────────────────────────────────────

  function openEdit() {
    if (!topic) return
    setFormTitle(topic.title)
    setFormDesc(topic.description ?? '')
    setFormError('')
    setEditOpen(true)
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault()
    if (!topic) return
    const trimmedTitle = formTitle.trim()
    if (!trimmedTitle) {
      setFormError('Title is required')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      await pb.send(`/api/collections/topics/records/${topic.id}`, {
        method: 'PATCH',
        body: { title: trimmedTitle, description: formDesc },
      })
      setEditOpen(false)
      await fetchTopic()
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  // ─── Delete topic ───────────────────────────────────────

  async function handleDeleteTopic() {
    if (!topic) return
    setDeletingTopic(true)
    try {
      await pb.send(`/api/collections/topics/records/${topic.id}`, { method: 'DELETE' })
      navigate({ to: '/topics', search: { returnGroup: undefined, returnType: undefined } })
    } catch (err) {
      setError(getApiErrorMessage(err, 'Delete failed'))
    } finally {
      setDeletingTopic(false)
      setDeleteTopicOpen(false)
    }
  }

  // ─── Add comment ────────────────────────────────────────

  async function handlePostComment(e: FormEvent) {
    e.preventDefault()
    const trimmed = commentBody.trim()
    if (!trimmed) return
    setPostingComment(true)
    try {
      await pb.send('/api/collections/topic_comments/records', {
        method: 'POST',
        body: { topic_id: id, body: trimmed, created_by: user?.id ?? '' },
      })
      setCommentBody('')
      await fetchTopic()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to post comment'))
    } finally {
      setPostingComment(false)
    }
  }

  // ─── Edit comment ──────────────────────────────────────

  function openEditComment(c: CommentRecord) {
    setEditingComment(c)
    setEditCommentBody(c.body)
  }

  function cancelEditComment() {
    setEditingComment(null)
    setEditCommentBody('')
  }

  async function handleSaveComment() {
    if (!editingComment) return
    const trimmed = editCommentBody.trim()
    if (!trimmed) return
    setSavingComment(true)
    try {
      await pb.send(`/api/collections/topic_comments/records/${editingComment.id}`, {
        method: 'PATCH',
        body: { body: trimmed },
      })
      setEditingComment(null)
      setEditCommentBody('')
      await fetchTopic()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update comment'))
    } finally {
      setSavingComment(false)
    }
  }

  // ─── Delete comment ─────────────────────────────────────

  async function handleDeleteComment() {
    if (!deleteCommentTarget) return
    setDeletingComment(true)
    try {
      await pb.send(`/api/collections/topic_comments/records/${deleteCommentTarget.id}`, {
        method: 'DELETE',
      })
      setDeleteCommentTarget(null)
      await fetchTopic()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Delete comment failed'))
    } finally {
      setDeletingComment(false)
    }
  }

  // ─── Close / Reopen ─────────────────────────────────────────────────

  async function handleToggleClosed() {
    if (!topic) return
    setTogglingClosed(true)
    try {
      await pb.send(`/api/collections/topics/records/${topic.id}`, {
        method: 'PATCH',
        body: { closed: !topic.closed },
      })
      await fetchTopic()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update topic'))
    } finally {
      setTogglingClosed(false)
      setCloseConfirmOpen(false)
    }
  }

  // ─── Share ──────────────────────────────────────────────────────────

  function openShareDialog() {
    if (topic?.share_token && topic.share_expires_at) {
      const exp = new Date(topic.share_expires_at)
      if (exp > new Date()) {
        setShareUrl(`${window.location.origin}/share/topic/${topic.share_token}`)
      } else {
        setShareUrl(null)
      }
    } else {
      setShareUrl(null)
    }
    setShareMinutes(30)
    setCopied(false)
    setQrDataUrl(null)
    setShareOpen(true)
  }

  async function handleGenerateShare() {
    if (!topic) return
    setSharing(true)
    try {
      const res = await pb.send<{ share_token: string; expires_at: string }>(
        `/api/ext/topics/share/${topic.id}`,
        { method: 'POST', body: { minutes: shareMinutes } },
      )
      setShareUrl(`${window.location.origin}/share/topic/${res.share_token}`)
      setCopied(false)
      setQrDataUrl(null)
      await fetchTopic()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to create share link'))
    } finally {
      setSharing(false)
    }
  }

  async function handleRevokeShare() {
    if (!topic) return
    setRevoking(true)
    try {
      await pb.send(`/api/ext/topics/share/${topic.id}`, { method: 'DELETE' })
      setShareUrl(null)
      setQrDataUrl(null)
      await fetchTopic()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to revoke share'))
    } finally {
      setRevoking(false)
    }
  }

  async function handleCopyShareUrl() {
    if (!shareUrl) return
    const ok = await copyToClipboard(shareUrl, shareUrlInputRef)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function handleGenerateQr() {
    if (!shareUrl) return
    setQrGenerating(true)
    try {
      const { toDataURL } = await import('qrcode')
      const dataUrl = await toDataURL(shareUrl, { errorCorrectionLevel: 'M', margin: 2, width: 256 })
      setQrDataUrl(dataUrl)
    } catch {
      setError('Failed to generate QR code')
    } finally {
      setQrGenerating(false)
    }
  }

  function handleDownloadQr() {
    if (!qrDataUrl || !topic) return
    const link = document.createElement('a')
    link.href = qrDataUrl
    link.download = `topic-share-${topic.title.slice(0, 20)}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.size > 1024 * 1024) {
      setFormError('File too large (max 1 MB)')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      if (reader.result.includes('\0')) {
        setFormError('Binary file detected, please upload a text file')
        return
      }
      setFormDesc(prev => prev ? prev + '\n\n' + reader.result : reader.result as string)
    }
    reader.onerror = () => setFormError('Failed to read file')
    reader.readAsText(file)
  }

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!topic) {
    return (
      <div className="space-y-4">
        <Link to="/topics" search={{ returnGroup: undefined, returnType: undefined }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Topics
        </Link>
        <p className="text-destructive">{error || 'Topic not found'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/topics" search={{ returnGroup: undefined, returnType: undefined }} className="hover:text-foreground">Topics</Link>
          <span>/</span>
          <span className="text-foreground">{topic.title}</span>
        </div>
        {isTopicOwner && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openShareDialog}>
              <Share2 className="h-4 w-4 mr-1" /> Share
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => topic.closed ? handleToggleClosed() : setCloseConfirmOpen(true)}
              disabled={togglingClosed}
            >
              {togglingClosed ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : topic.closed ? (
                <Unlock className="h-4 w-4 mr-1" />
              ) : (
                <Lock className="h-4 w-4 mr-1" />
              )}
              {topic.closed ? 'Reopen' : 'Close'}
            </Button>
            {!topic.closed && (
              <Button variant="outline" size="sm" onClick={openEdit}>
                <Pencil className="h-4 w-4 mr-1" /> Edit
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteTopicOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm">{error}</div>
      )}

      {/* Topic content */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{topic.title}</h1>
        <p className="text-sm text-muted-foreground">
          {authorName(topic)} &middot; Created {formatDate(topic.created)} &middot; Updated {formatDate(topic.updated)}
        </p>
      </div>

      {topic.closed && (
        <div className="bg-muted border rounded-lg px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" />
          This topic is closed.
        </div>
      )}

      {topic.description && (
        <div className="border rounded-lg p-4">
          <MarkdownView>{topic.description}</MarkdownView>
        </div>
      )}

      {/* Comments section */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Comments ({comments.length})</h2>

        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          <div className="space-y-3">
            {comments.map(c => (
              <div key={c.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {authorName(c)} &middot; {formatDate(c.created)}
                    {c.updated !== c.created && <span> &middot; edited</span>}
                  </p>
                  {user?.id === c.created_by && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEditComment(c)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteCommentTarget(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                {editingComment?.id === c.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editCommentBody}
                      onChange={e => setEditCommentBody(e.target.value)}
                      rows={3}
                    />
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={cancelEditComment}>Cancel</Button>
                      <Button size="sm" disabled={savingComment || !editCommentBody.trim()} onClick={handleSaveComment}>
                        {savingComment ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <MarkdownView>{c.body}</MarkdownView>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add comment form */}
        {!topic.closed ? (
          <form onSubmit={handlePostComment} className="space-y-3 border rounded-lg p-4">
            <Label htmlFor="new-comment">Add a comment</Label>
            <MarkdownEditor
              value={commentBody}
              onChange={setCommentBody}
              placeholder="Write a comment… (Markdown supported)"
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={postingComment || !commentBody.trim()}>
                {postingComment ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Post Comment
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">This topic is closed. No new comments can be added.</p>
        )}

        {/* Bottom spacing so the comment form is never hidden behind the fold */}
        <div className="pb-8" />
      </div>

      {/* Edit Topic Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={handleEditSubmit}>
            <DialogHeader>
              <DialogTitle>Edit Topic</DialogTitle>
              <DialogDescription>Update topic details.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Description</Label>
                  <label className="cursor-pointer">
                    <input type="file" className="hidden" accept="text/*,.md,.txt,.log,.json,.yaml,.yml,.xml,.csv,.html,.htm,.css,.js,.ts,.py,.go,.sh,.sql,.toml,.ini,.cfg,.conf,.env" onChange={handleFileUpload} />
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <Upload className="h-3.5 w-3.5" /> Upload text file
                    </span>
                  </label>
                </div>
                <MarkdownEditor
                  value={formDesc}
                  onChange={setFormDesc}
                  placeholder="Markdown supported"
                />
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Close Topic Confirmation */}
      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Topic</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to close &ldquo;{topic.title}&rdquo;? Closed topics
              cannot receive new comments or be edited until reopened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggleClosed} disabled={togglingClosed}>
              {togglingClosed ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Close Topic
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Share Dialog */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Topic</DialogTitle>
            <DialogDescription>
              Generate a public link — anyone with the link can view this topic and post comments without logging in. The link expires after the specified time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="share-minutes">Validity (minutes)</Label>
              <Input
                id="share-minutes"
                type="number"
                min={1}
                max={60}
                value={shareMinutes}
                onChange={e => setShareMinutes(Number(e.target.value))}
              />
            </div>
            {shareUrl && (
              <div className="space-y-2">
                <Label>Public link</Label>
                <div className="flex gap-2">
                  <Input ref={shareUrlInputRef} readOnly value={shareUrl} className="text-xs font-mono" />
                  <Button type="button" variant="outline" size="icon" onClick={handleCopyShareUrl} title="Copy">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={handleGenerateQr} disabled={qrGenerating} title="QR Code">
                    {qrGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                  </Button>
                  <Button type="button" variant="outline" size="icon" asChild title="Open">
                    <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
                {copied && <p className="text-xs text-green-600">Copied to clipboard!</p>}
                {qrDataUrl && (
                  <div className="space-y-2">
                    <div className="w-fit rounded-md border border-border p-2 bg-background">
                      <img src={qrDataUrl} alt="Share QR code" className="h-40 w-40" />
                    </div>
                    <Button variant="outline" size="sm" onClick={handleDownloadQr}>
                      <Download className="h-4 w-4 mr-1" /> Download QR
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="flex items-center gap-2 sm:justify-between">
            {shareUrl ? (
              <Button type="button" variant="outline" onClick={handleRevokeShare} disabled={revoking} className="text-destructive hover:text-destructive">
                {revoking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Revoke
              </Button>
            ) : <div />}
            <Button type="button" onClick={handleGenerateShare} disabled={sharing || shareMinutes < 1 || shareMinutes > 60}>
              {sharing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {shareUrl ? 'Refresh Link' : 'Generate Link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Topic Confirmation */}
      <AlertDialog open={deleteTopicOpen} onOpenChange={setDeleteTopicOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Topic</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{topic.title}&rdquo;? All comments will
              also be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTopic}
              disabled={deletingTopic}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingTopic ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Comment Confirmation */}
      <AlertDialog open={!!deleteCommentTarget} onOpenChange={open => !open && setDeleteCommentTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Comment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this comment? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteComment}
              disabled={deletingComment}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingComment ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/topics/$id')({
  component: TopicDetailPage,
})
