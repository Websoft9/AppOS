import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Plus, Pencil, Trash2, Loader2, Search, ArrowUp, ArrowDown, Lock, Unlock, Share2, Copy, Check, ExternalLink, QrCode, Download, Upload } from 'lucide-react'
import { pb } from '@/lib/pb'
import { getApiErrorMessage } from '@/lib/api-error'
import { copyToClipboard } from '@/lib/clipboard'
import { useAuth } from '@/contexts/AuthContext'
import { type PBList, formatDate, formatCreator, pbFilterValue } from '@/lib/groups'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MarkdownEditor } from '@/components/ui/markdown'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
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

interface TopicRow extends TopicRecord {
  commentCount: number
  authorName: string
}

type SortField = 'title' | 'created' | 'updated'
type SortDir = 'asc' | 'desc'

// ─── Page Component ──────────────────────────────────────

function TopicsListPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { returnGroup, returnType } = Route.useSearch()

  const [topics, setTopics] = useState<TopicRecord[]>([])
  const [commentCounts, setCommentCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('updated')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Create/Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTopic, setEditingTopic] = useState<TopicRecord | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<TopicRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Close/reopen
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [closeTarget, setCloseTarget] = useState<TopicRecord | null>(null)

  // Share
  const shareUrlInputRef = useRef<HTMLInputElement>(null)
  const [shareTarget, setShareTarget] = useState<TopicRecord | null>(null)
  const [shareMinutes, setShareMinutes] = useState(30)
  const [sharing, setSharing] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrGenerating, setQrGenerating] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const topicsRes = await pb.send<PBList<TopicRecord>>(
        '/api/collections/topics/records?perPage=500&sort=-updated',
        {},
      )
      const topicItems = topicsRes.items ?? []
      setTopics(topicItems)

      // Batch fetch comment counts for all visible topics
      if (topicItems.length > 0) {
        const filter = topicItems
          .map(t => `topic_id='${pbFilterValue(t.id)}'`)
          .join('||')
        const commentsRes = await pb.send<PBList<{ id: string; topic_id: string }>>(
          `/api/collections/topic_comments/records?perPage=500&fields=id,topic_id&filter=(${filter})`,
          {},
        )
        const counts = new Map<string, number>()
        for (const c of commentsRes.items ?? []) {
          counts.set(c.topic_id, (counts.get(c.topic_id) ?? 0) + 1)
        }
        setCommentCounts(counts)
      } else {
        setCommentCounts(new Map())
      }

      setError('')
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load topics'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Auto-open create dialog when arriving from Group Add Items flow
  useEffect(() => {
    if (returnGroup && !loading) openCreate()
  }, [returnGroup, loading])

  // Build enriched rows
  const rows: TopicRow[] = useMemo(() => {
    return topics.map(t => ({
      ...t,
      commentCount: commentCounts.get(t.id) ?? 0,
      authorName: formatCreator(t.created_by, user?.id, user?.email),
    }))
  }, [topics, commentCounts, user])

  // Filter & sort
  const filteredRows = useMemo(() => {
    let result = rows
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(r => r.title.toLowerCase().includes(q))
    }
    return [...result].sort((a, b) => {
      let cmp = 0
      if (sortField === 'title') cmp = (a.title ?? '').localeCompare(b.title ?? '')
      else if (sortField === 'created') cmp = (a.created ?? '').localeCompare(b.created ?? '')
      else cmp = (a.updated ?? '').localeCompare(b.updated ?? '')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, search, sortField, sortDir])

  // ─── Dialog handlers ────────────────────────────────────

  function openCreate() {
    setEditingTopic(null)
    setFormTitle('')
    setFormDesc('')
    setFormError('')
    setDialogOpen(true)
  }

  function openEdit(t: TopicRecord) {
    setEditingTopic(t)
    setFormTitle(t.title)
    setFormDesc(t.description ?? '')
    setFormError('')
    setDialogOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmedTitle = formTitle.trim()
    if (!trimmedTitle) {
      setFormError('Title is required')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      if (editingTopic) {
        await pb.send(`/api/collections/topics/records/${editingTopic.id}`, {
          method: 'PATCH',
          body: { title: trimmedTitle, description: formDesc },
        })
        setDialogOpen(false)
        await fetchData()
      } else {
        const created = await pb.send<{ id: string }>('/api/collections/topics/records', {
          method: 'POST',
          body: { title: trimmedTitle, description: formDesc, created_by: user?.id ?? '' },
        })
        setDialogOpen(false)
        if (returnGroup) {
          navigate({
            to: '/groups/$id',
            params: { id: returnGroup },
            search: { addOpen: returnType ?? 'topic', newItem: created.id },
          })
        } else {
          navigate({ to: '/topics/$id', params: { id: created.id } })
        }
      }
    } catch (err) {
      setFormError(getApiErrorMessage(err, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await pb.send(`/api/collections/topics/records/${deleteTarget.id}`, { method: 'DELETE' })
      setDeleteTarget(null)
      await fetchData()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Delete failed'))
    } finally {
      setDeleting(false)
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const isOwner = (t: TopicRecord) => user?.id === t.created_by

  // ─── Text file upload ──────────────────────────────────────

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

  // ─── Share ─────────────────────────────────────────────────

  function openShare(t: TopicRecord) {
    setShareTarget(t)
    setShareMinutes(30)
    setShareUrl(null)
    setCopied(false)
    setQrDataUrl(null)
    // Check if there's an active share
    if (t.share_token && t.share_expires_at && new Date(t.share_expires_at) > new Date()) {
      setShareUrl(`${window.location.origin}/share/topic/${t.share_token}`)
    }
  }

  async function handleGenerateShare() {
    if (!shareTarget) return
    setSharing(true)
    try {
      const res = await pb.send<{ share_token: string; expires_at: string }>(
        `/api/ext/topics/share/${shareTarget.id}`,
        { method: 'POST', body: { minutes: shareMinutes } },
      )
      setShareUrl(`${window.location.origin}/share/topic/${res.share_token}`)
      setCopied(false)
      setQrDataUrl(null)
      await fetchData()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to create share link'))
    } finally {
      setSharing(false)
    }
  }

  async function handleRevokeShare() {
    if (!shareTarget) return
    setRevoking(true)
    try {
      await pb.send(`/api/ext/topics/share/${shareTarget.id}`, { method: 'DELETE' })
      setShareUrl(null)
      setQrDataUrl(null)
      await fetchData()
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
    if (!qrDataUrl || !shareTarget) return
    const link = document.createElement('a')
    link.href = qrDataUrl
    link.download = `topic-share-${shareTarget.title.slice(0, 20)}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  async function handleToggleClosed(t: TopicRecord) {
    setTogglingId(t.id)
    try {
      await pb.send(`/api/collections/topics/records/${t.id}`, {
        method: 'PATCH',
        body: { closed: !t.closed },
      })
      await fetchData()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to update topic'))
    } finally {
      setTogglingId(null)
      setCloseTarget(null)
    }
  }

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Topics</h1>
          <p className="text-muted-foreground mt-1">
            Capture shared context, decisions, and discussion threads for your team.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          New Topic
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md text-sm">
          {error}
          <Button variant="ghost" size="sm" className="ml-2" onClick={fetchData}>
            Retry
          </Button>
        </div>
      )}

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table / Empty state */}
      {filteredRows.length === 0 && !search ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border rounded-lg">
          <p className="text-lg font-medium">No topics yet</p>
          <p className="text-sm mt-1">
            Create the first Topic to start capturing shared context for your team.
          </p>
          <Button className="mt-4" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Topic
          </Button>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border rounded-lg">
          <p>No topics match your search</p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort('title')}
                  >
                    Title
                    {sortField === 'title' && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </TableHead>
                <TableHead>Author</TableHead>
                <TableHead>
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort('created')}
                  >
                    Created
                    {sortField === 'created' && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </TableHead>
                <TableHead>
                  <button
                    type="button"
                    className="flex items-center gap-1 hover:text-foreground"
                    onClick={() => toggleSort('updated')}
                  >
                    Updated
                    {sortField === 'updated' && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </TableHead>
                <TableHead>Comments</TableHead>
                <TableHead className="w-[100px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map(row => (
                <TableRow key={row.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        to="/topics/$id"
                        params={{ id: row.id }}
                        className="font-medium hover:underline"
                      >
                        {row.title}
                      </Link>
                      {row.closed && (
                        <Badge variant="secondary" className="text-xs font-normal">
                          <Lock className="h-3 w-3 mr-0.5" /> Closed
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{row.authorName}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.created)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.updated)}</TableCell>
                  <TableCell>{row.commentCount}</TableCell>
                  <TableCell className="text-right">
                    {isOwner(row) && (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Share"
                          onClick={e => { e.stopPropagation(); openShare(row) }}
                        >
                          <Share2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title={row.closed ? 'Reopen' : 'Close'}
                          disabled={togglingId === row.id}
                          onClick={e => {
                            e.stopPropagation()
                            if (row.closed) {
                              void handleToggleClosed(row)
                            } else {
                              setCloseTarget(row)
                            }
                          }}
                        >
                          {togglingId === row.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : row.closed ? (
                            <Unlock className="h-4 w-4" />
                          ) : (
                            <Lock className="h-4 w-4" />
                          )}
                        </Button>
                        {!row.closed && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={e => { e.stopPropagation(); openEdit(row) }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={e => { e.stopPropagation(); setDeleteTarget(row) }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editingTopic ? 'Edit Topic' : 'New Topic'}</DialogTitle>
              <DialogDescription>
                {editingTopic ? 'Update topic details.' : 'Create a new topic for discussion.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="topic-title">Title</Label>
                <Input
                  id="topic-title"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="Topic title"
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
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {editingTopic ? 'Save' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Close Confirmation */}
      <AlertDialog open={!!closeTarget} onOpenChange={open => !open && setCloseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close Topic</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to close &ldquo;{closeTarget?.title}&rdquo;? Closed topics
              cannot receive new comments or be edited until reopened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => closeTarget && handleToggleClosed(closeTarget)}
              disabled={!!togglingId}
            >
              {togglingId ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Close Topic
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Topic</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deleteTarget?.title}&rdquo;? All comments
              will also be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Share Dialog */}
      <Dialog open={!!shareTarget} onOpenChange={open => { if (!open) { setShareTarget(null); setQrDataUrl(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Topic</DialogTitle>
            <DialogDescription>
              Generate a public link — anyone with the link can view this topic and post comments without logging in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="share-mins">Validity (minutes)</Label>
              <Input
                id="share-mins"
                type="number"
                min={1}
                max={60}
                value={shareMinutes}
                onChange={e => setShareMinutes(Number(e.target.value))}
              />
            </div>
            {shareUrl && (
              <div className="space-y-3">
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
    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/topics/')({
  component: TopicsListPage,
  validateSearch: (search: Record<string, unknown>) => ({
    returnGroup: typeof search.returnGroup === 'string' ? search.returnGroup : undefined,
    returnType: typeof search.returnType === 'string' ? search.returnType : undefined,
  }),
})
