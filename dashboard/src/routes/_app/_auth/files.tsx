import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Upload, Trash2, Share2, FileText, Copy, Check, X, Loader2,
  Folder, FolderPlus, FilePlus, RefreshCw, Edit3, Download,
  ChevronRight, Search, ArrowUp, ArrowDown, ChevronsUpDown,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// ─── Types ───────────────────────────────────────────────

interface UserFile {
  id: string
  name: string
  mime_type: string
  share_token: string
  share_expires_at: string
  is_folder: boolean
  parent: string
  created: string
  updated: string
  content: string // stored filename in PocketBase storage
  size: number    // file size in bytes (0 for folders)
}

interface Quota {
  max_size_mb: number
  allowed_upload_formats: string[]
  editable_formats: string[]
  max_per_user: number
  share_max_minutes: number
  share_default_minutes: number
  reserved_folder_names: string[]
}

type SortField = 'name' | 'type' | 'created'
type SortDir = 'asc' | 'desc'

// ─── Constants ───────────────────────────────────────────

const PAGE_SIZE = 20

// ─── Helpers ─────────────────────────────────────────────

function formatBytes(mb: number) { return `${mb} MB` }

function formatFileSize(bytes: number | undefined): string {
  if (!bytes) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} K`
  return `${(bytes / (1024 * 1024)).toFixed(1)} M`
}

function formatDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function isExpired(expiresAt: string) {
  if (!expiresAt) return true
  return new Date(expiresAt) < new Date()
}

/** Build an absolute public share URL from the relative path returned by the server. */
function buildPublicShareUrl(relativeUrl: string) {
  return `${window.location.origin}${relativeUrl}`
}

function buildDownloadUrl(file: UserFile) {
  if (!file.content) return null
  return `/api/files/user_files/${file.id}/${file.content}`
}

/** Compute the full path of an item by traversing its parent chain. */
function buildPath(item: UserFile, all: UserFile[]): string {
  const parts: string[] = []
  let cur: UserFile | undefined = item
  while (cur) {
    parts.unshift(cur.name)
    if (!cur.parent) break
    cur = all.find(f => f.id === cur!.parent)
  }
  return '/' + parts.join('/')
}

/** True if the file extension is in the editable (text/code) list. */
function isEditable(file: UserFile, quota: Quota | null): boolean {
  if (file.is_folder || !file.content) return false
  if (!quota) return false
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return quota.editable_formats.includes(ext)
}

/**
 * Copy text to clipboard.
 * Tries the modern Clipboard API first; falls back to selecting an
 * existing input element (required when inside a Radix Dialog focus trap
 * which blocks focus on elements appended to document.body).
 */
async function copyToClipboard(
  text: string,
  inputRef?: React.RefObject<HTMLInputElement | null>,
): Promise<boolean> {
  // 1. Modern API (requires secure context — HTTPS or localhost).
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch { /* fall through */ }
  // 2. Fallback: select the existing in-dialog input that already shows the URL.
  //    This avoids Radix Dialog's focus-trap stealing focus from a temporary textarea.
  if (inputRef?.current) {
    try {
      const el = inputRef.current
      el.focus()
      el.setSelectionRange(0, el.value.length)
      const ok = document.execCommand('copy')
      return ok
    } catch { /* fall through */ }
  }
  // 3. Last resort: temporary textarea (may fail inside a focus-trapped dialog).
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;'
    document.body.appendChild(el)
    el.focus()
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

// ─── SortIcon helper ──────────────────────────────────────

function SortIcon({
  field, sortBy, sortDir,
}: { field: SortField; sortBy: SortField; sortDir: SortDir }) {
  if (field !== sortBy) return <ChevronsUpDown className="h-3 w-3 ml-1 text-muted-foreground" />
  return sortDir === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1" />
    : <ArrowDown className="h-3 w-3 ml-1" />
}

// ─── Page ────────────────────────────────────────────────

function FilesPage() {
  const [items, setItems] = useState<UserFile[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Folder navigation ──────────────────────────────────
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)

  // ── List controls ──────────────────────────────────────
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(1)

  // ── Upload dialog ──────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploadParent, setUploadParent] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Create folder dialog ────────────────────────────────
  const [folderOpen, setFolderOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [folderParent, setFolderParent] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)

  // ── Create new text file dialog ─────────────────────────
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [newFileContent, setNewFileContent] = useState('')
  const [newFileParent, setNewFileParent] = useState('')
  const [creatingFile, setCreatingFile] = useState(false)
  const [newFileError, setNewFileError] = useState<string | null>(null)

  // ── Editor dialog ──────────────────────────────────────
  const [editFile, setEditFile] = useState<UserFile | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // ── Delete confirm ─────────────────────────────────────
  const [deleteItem, setDeleteItem] = useState<UserFile | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── Share dialog ───────────────────────────────────────
  const [shareFile, setShareFile] = useState<UserFile | null>(null)
  const [shareMinutes, setShareMinutes] = useState(30)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const shareUrlInputRef = useRef<HTMLInputElement | null>(null)
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)

  // ─── Data ──────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [quotaRes, listRes] = await Promise.all([
        fetch('/api/ext/files/quota', {
          headers: { Authorization: pb.authStore.token },
        }).then(r => r.json()),
        pb.collection('user_files').getFullList<UserFile>({
          sort: 'is_folder,name',
          requestKey: 'files-list',
        }),
      ])
      setQuota(quotaRes)
      setItems(listRes)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load files')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ─── Derived ───────────────────────────────────────────

  const allFolders = useMemo(() => items.filter(i => i.is_folder), [items])
  const allFiles   = useMemo(() => items.filter(i => !i.is_folder), [items])

  /** Breadcrumb trail from root → currentFolderId */
  const breadcrumb = useMemo((): UserFile[] => {
    const trail: UserFile[] = []
    let fid: string | null = currentFolderId
    while (fid) {
      const f = items.find(i => i.id === fid)
      if (!f) break
      trail.unshift(f)
      fid = f.parent || null
    }
    return trail
  }, [currentFolderId, items])

  /** Items in the current folder only, after search + sort. */
  const viewItems = useMemo((): UserFile[] => {
    const parentId = currentFolderId ?? ''
    let filtered = items.filter(i => i.parent === parentId)

    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = filtered.filter(i => i.name.toLowerCase().includes(q))
    }

    filtered = [...filtered].sort((a, b) => {
      // Folders always before files.
      if (a.is_folder !== b.is_folder) return a.is_folder ? -1 : 1
      let cmp = 0
      if (sortBy === 'name')    cmp = a.name.localeCompare(b.name)
      else if (sortBy === 'type')    cmp = (a.mime_type ?? '').localeCompare(b.mime_type ?? '')
      else                      cmp = a.created.localeCompare(b.created)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return filtered
  }, [items, currentFolderId, search, sortBy, sortDir])

  const totalPages = Math.max(1, Math.ceil(viewItems.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pagedItems = viewItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Reset to page 1 whenever the view changes.
  useEffect(() => { setPage(1) }, [currentFolderId, search, sortBy, sortDir])

  // ─── Sort ──────────────────────────────────────────────

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }

  // ─── Navigation ────────────────────────────────────────

  function navigateTo(folderId: string | null) {
    setCurrentFolderId(folderId)
    setSearch('')
    setPage(1)
  }

  // ─── Open dialogs (pre-fill parent from current folder) ─

  function openNewFolder() {
    setFolderName('')
    setFolderParent(currentFolderId ?? '')
    setFolderError(null)
    setFolderOpen(true)
  }

  function openNewFile() {
    setNewFileName('')
    setNewFileContent('')
    setNewFileParent(currentFolderId ?? '')
    setNewFileError(null)
    setNewFileOpen(true)
  }

  function openUpload() {
    setUploadFile(null)
    setUploadName('')
    setUploadParent(currentFolderId ?? '')
    setUploadError(null)
    setUploadOpen(true)
  }

  // ─── Upload ────────────────────────────────────────────

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploadFile(f)
    setUploadName(f.name)
    setUploadError(null)
  }

  async function handleUpload() {
    if (!uploadFile || !uploadName.trim()) return
    if (quota) {
      const ext = uploadName.split('.').pop()?.toLowerCase() ?? ''
      if (!quota.allowed_upload_formats.includes(ext)) {
        setUploadError(`Extension ".${ext}" is not allowed.`)
        return
      }
      if (uploadFile.size > quota.max_size_mb * 1024 * 1024) {
        setUploadError(`File too large. Max: ${formatBytes(quota.max_size_mb)}`)
        return
      }
    }
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.append('owner', pb.authStore.record?.id ?? '')
      form.append('name', uploadName.trim())
      form.append('mime_type', uploadFile.type || 'application/octet-stream')
      form.append('content', uploadFile, uploadName.trim())
      form.append('size', String(uploadFile.size))
      if (uploadParent) form.append('parent', uploadParent)
      await pb.collection('user_files').create(form)
      setUploadOpen(false)
      setUploadFile(null)
      setUploadName('')
      setUploadParent('')
      fetchAll()
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // ─── Create Folder ─────────────────────────────────────

  async function handleCreateFolder() {
    if (!folderName.trim()) return
    // Client-side reserved name guard for root-level folders.
    if (!folderParent && quota?.reserved_folder_names?.length) {
      const lower = folderName.trim().toLowerCase()
      if (quota.reserved_folder_names.includes(lower)) {
        setFolderError(`"${folderName.trim()}" is reserved by the system and cannot be used.`)
        return
      }
    }
    setCreatingFolder(true)
    setFolderError(null)
    try {
      await pb.collection('user_files').create({
        owner: pb.authStore.record?.id ?? '',
        name: folderName.trim(),
        is_folder: true,
        parent: folderParent || '',
      })
      setFolderOpen(false)
      setFolderName('')
      setFolderParent('')
      fetchAll()
    } catch (e: unknown) {
      setFolderError(e instanceof Error ? e.message : 'Failed to create folder')
    } finally {
      setCreatingFolder(false)
    }
  }

  // ─── Create New Text File ───────────────────────────────

  async function handleCreateFile() {
    if (!newFileName.trim()) return
    if (quota) {
      const ext = newFileName.split('.').pop()?.toLowerCase() ?? ''
      if (!quota.editable_formats.includes(ext)) {
        setNewFileError(
          `Extension ".${ext}" is not a text/code format. Use Upload for binary files.`,
        )
        return
      }
    }
    setCreatingFile(true)
    setNewFileError(null)
    try {
      const blob = new Blob([newFileContent], { type: 'text/plain' })
      const form = new FormData()
      form.append('owner', pb.authStore.record?.id ?? '')
      form.append('name', newFileName.trim())
      form.append('mime_type', 'text/plain')
      form.append('content', blob, newFileName.trim())
      form.append('size', String(blob.size))
      if (newFileParent) form.append('parent', newFileParent)
      await pb.collection('user_files').create(form)
      setNewFileOpen(false)
      setNewFileName('')
      setNewFileContent('')
      setNewFileParent('')
      fetchAll()
    } catch (e: unknown) {
      setNewFileError(e instanceof Error ? e.message : 'Failed to create file')
    } finally {
      setCreatingFile(false)
    }
  }

  // ─── Edit ──────────────────────────────────────────────

  async function openEditor(file: UserFile) {
    setEditFile(file)
    setEditContent('')
    setEditError(null)
    setEditLoading(true)
    try {
      const url = buildDownloadUrl(file)
      if (!url) throw new Error('No file content')
      const res = await fetch(url, { headers: { Authorization: pb.authStore.token } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setEditContent(await res.text())
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Failed to load content')
    } finally {
      setEditLoading(false)
    }
  }

  async function handleSave() {
    if (!editFile) return
    setSaving(true)
    setEditError(null)
    try {
      const blob = new Blob([editContent], { type: editFile.mime_type || 'text/plain' })
      const form = new FormData()
      form.append('content', blob, editFile.name)
      form.append('size', String(blob.size))
      await pb.collection('user_files').update(editFile.id, form)
      setEditFile(null)
      fetchAll()
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ─── Delete ────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteItem) return
    setDeleting(true)
    try {
      await pb.collection('user_files').delete(deleteItem.id)
      setDeleteItem(null)
      fetchAll()
    } catch { /* ignore */ } finally {
      setDeleting(false)
    }
  }

  // ─── Share ─────────────────────────────────────────────

  function openShare(file: UserFile) {
    setShareFile(file)
    setShareMinutes(quota?.share_default_minutes ?? 30)
    if (file.share_token && !isExpired(file.share_expires_at)) {
      // Reconstruct the public URL from the known token.
      setShareUrl(buildPublicShareUrl(`/api/ext/files/share/${file.share_token}/download`))
    } else {
      setShareUrl(null)
    }
    setCopied(false)
  }

  async function handleShare() {
    if (!shareFile) return
    setSharing(true)
    try {
      const res = await fetch(`/api/ext/files/share/${shareFile.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: pb.authStore.token,
        },
        body: JSON.stringify({ minutes: shareMinutes }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.message ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      // Use share_url from the server (relative path) and prefix the origin.
      // This avoids any risk of reading a stale or wrong field from the response.
      const generatedUrl = buildPublicShareUrl(data.share_url as string)
      setShareUrl(generatedUrl)
      fetchAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Share failed')
    } finally {
      setSharing(false)
    }
  }

  async function handleRevoke() {
    if (!shareFile) return
    await fetch(`/api/ext/files/share/${shareFile.id}`, {
      method: 'DELETE',
      headers: { Authorization: pb.authStore.token },
    })
    setShareUrl(null)
    fetchAll()
  }

  async function doCopy() {
    const url = shareUrlInputRef.current?.value
    if (!url) return
    const ok = await copyToClipboard(url, shareUrlInputRef)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // ─── Render ────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* ── Unified toolbar ─────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-2xl font-bold shrink-0">Files</h2>

        {/* Breadcrumb / path */}
        <div className="flex items-center gap-1 text-sm shrink-0">
          <button
            className={`hover:underline font-mono ${!currentFolderId ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
            onClick={() => navigateTo(null)}
          >
            /
          </button>
          {breadcrumb.map((seg, i) => (
            <span key={seg.id} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <button
                className={`hover:underline ${i === breadcrumb.length - 1 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                onClick={() => navigateTo(seg.id)}
              >
                {seg.name}
              </button>
            </span>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-8 h-8 text-sm w-44"
            placeholder="Search by name…"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          />
        </div>
        {search && (
          <Button variant="ghost" size="sm" onClick={() => setSearch('')}>
            <X className="h-4 w-4" />
          </Button>
        )}
        {!loading && search && (
          <span className="text-xs text-muted-foreground">
            {viewItems.length} item{viewItems.length !== 1 ? 's' : ''}
          </span>
        )}

        <div className="flex-1" />

        {/* Action buttons */}
        <Button
          variant="outline" size="sm"
          onClick={fetchAll} disabled={loading}
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
        <Button variant="outline" size="sm" onClick={openNewFolder}>
          <FolderPlus className="h-4 w-4 mr-1" /> New Folder
        </Button>
        <Button variant="outline" size="sm" onClick={openNewFile}>
          <FilePlus className="h-4 w-4 mr-1" /> New File
        </Button>
        <Button size="sm" onClick={openUpload}>
          <Upload className="h-4 w-4 mr-1" /> Upload
        </Button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}

      {!loading && viewItems.length === 0 && !error && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Folder className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>
              {search
                ? `No items match "${search}".`
                : 'This folder is empty. Create a subfolder or upload your first file.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── File table ─────────────────────────────────── */}
      {!loading && viewItems.length > 0 && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button
                      className="flex items-center font-semibold hover:text-foreground"
                      onClick={() => toggleSort('name')}
                    >
                      Name <SortIcon field="name" sortBy={sortBy} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>
                    <button
                      className="flex items-center font-semibold hover:text-foreground"
                      onClick={() => toggleSort('type')}
                    >
                      Type <SortIcon field="type" sortBy={sortBy} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Shared</TableHead>
                  <TableHead>
                    <button
                      className="flex items-center font-semibold hover:text-foreground"
                      onClick={() => toggleSort('created')}
                    >
                      Created <SortIcon field="created" sortBy={sortBy} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedItems.map(item => {
                  const editable = isEditable(item, quota)
                  const itemPath = buildPath(item, items)
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.is_folder
                          ? (
                            <button
                              className="flex items-center gap-2 whitespace-nowrap hover:underline cursor-pointer"
                              onClick={() => navigateTo(item.id)}
                            >
                              <Folder className="h-4 w-4 text-yellow-500 shrink-0" />
                              {item.name}
                            </button>
                          )
                          : (
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                              {item.name}
                            </div>
                          )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs font-mono whitespace-nowrap">
                        {itemPath}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                        {item.is_folder ? 'Folder' : (item.mime_type || '—')}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                        {item.is_folder ? '—' : formatFileSize(item.size)}
                      </TableCell>
                      <TableCell>
                        {!item.is_folder && item.share_token && !isExpired(item.share_expires_at)
                          ? (
                            <Badge variant="secondary" className="text-xs whitespace-nowrap">
                              Shared · expires {formatDate(item.share_expires_at)}
                            </Badge>
                          )
                          : <span className="text-muted-foreground text-sm">—</span>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDate(item.created)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          {item.is_folder
                            ? (
                              <Button
                                size="sm" variant="ghost"
                                title="Open folder"
                                onClick={() => navigateTo(item.id)}
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            )
                            : (
                              <>
                                <Button
                                  size="sm" variant="ghost"
                                  title={editable ? 'Edit' : 'Online editing not supported for this format'}
                                  disabled={!editable}
                                  onClick={() => editable && openEditor(item)}
                                >
                                  <Edit3 className="h-4 w-4" />
                                </Button>
                                {item.content && (
                                  <a
                                    href={buildDownloadUrl(item) ?? '#'}
                                    download={item.name}
                                    className="inline-flex items-center justify-center h-8 w-8 rounded-md text-foreground hover:bg-muted transition-colors"
                                    title="Download"
                                  >
                                    <Download className="h-4 w-4" />
                                  </a>
                                )}
                                <Button
                                  size="sm" variant="ghost"
                                  title="Share"
                                  onClick={() => openShare(item)}
                                >
                                  <Share2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          <Button
                            size="sm" variant="ghost"
                            className="text-destructive hover:text-destructive"
                            title="Delete"
                            onClick={() => setDeleteItem(item)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Pagination ─────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {viewItems.length} items · page {safePage} of {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline" size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ── Stats ──────────────────────────────────────── */}
      {quota && !loading && (
        <p className="text-xs text-muted-foreground">
          {allFolders.length} folder{allFolders.length !== 1 ? 's' : ''}
          {' · '}{allFiles.length} file{allFiles.length !== 1 ? 's' : ''}
          {' · '}{items.length} / {quota.max_per_user} items used
          {' · '}max file size {formatBytes(quota.max_size_mb)}
        </p>
      )}

      {/* ── New Folder Dialog ──────────────────────────── */}
      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
            <DialogDescription>Create a new folder to organise your files.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Folder name</Label>
              <Input
                className="mt-1" value={folderName} placeholder="e.g. scripts"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFolderName(e.target.value)}
              />
              {quota?.reserved_folder_names?.length && !folderParent && (
                <p className="text-xs text-muted-foreground mt-1">
                  Reserved names (root only): {quota.reserved_folder_names.join(', ')}
                </p>
              )}
            </div>
            {allFolders.length > 0 && (
              <div>
                <Label>Parent folder (optional)</Label>
                <select
                  className="mt-1 w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={folderParent}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFolderParent(e.target.value)}
                >
                  <option value="">/ (root)</option>
                  {allFolders.map(f => (
                    <option key={f.id} value={f.id}>{buildPath(f, items)}</option>
                  ))}
                </select>
              </div>
            )}
            {folderError && <p className="text-destructive text-sm">{folderError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFolder} disabled={!folderName.trim() || creatingFolder}>
              {creatingFolder && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Text File Dialog ───────────────────────── */}
      <Dialog open={newFileOpen} onOpenChange={setNewFileOpen}>
        <DialogContent className="sm:max-w-3xl w-full">
          <DialogHeader>
            <DialogTitle>New Text File</DialogTitle>
            <DialogDescription>Create a new text or code file online.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-40">
                <Label>Filename</Label>
                <Input
                  className="mt-1" value={newFileName} placeholder="e.g. script.py"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewFileName(e.target.value)}
                />
              </div>
              <div className="w-48">
                <Label>Folder</Label>
                <select
                  className="mt-1 w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                  value={newFileParent}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewFileParent(e.target.value)}
                >
                  <option value="">/ (root)</option>
                  {allFolders.map(f => (
                    <option key={f.id} value={f.id}>{buildPath(f, items)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label>Content (optional)</Label>
              <Textarea
                className="mt-1 font-mono text-sm min-h-[200px]"
                value={newFileContent}
                placeholder="# Start writing here…"
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewFileContent(e.target.value)}
              />
            </div>
            {newFileError && <p className="text-destructive text-sm">{newFileError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFileOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFile} disabled={!newFileName.trim() || creatingFile}>
              {creatingFile && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Upload Dialog ──────────────────────────────── */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload File</DialogTitle>
            <DialogDescription>
              Supports text, code, PDF and Office documents.
              {quota && ` Max size: ${formatBytes(quota.max_size_mb)}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>File</Label>
              <input ref={fileInputRef} type="file" className="hidden" onChange={onFileSelected} />
              <Button
                variant="outline" className="w-full mt-1"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadFile ? uploadFile.name : 'Choose file…'}
              </Button>
            </div>
            {uploadFile && (
              <>
                <div>
                  <Label>Display name</Label>
                  <Input
                    className="mt-1" value={uploadName} placeholder="e.g. notes.md"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUploadName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Folder (optional)</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    value={uploadParent}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setUploadParent(e.target.value)}
                  >
                    <option value="">/ (root)</option>
                    {allFolders.map(f => (
                      <option key={f.id} value={f.id}>{buildPath(f, items)}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {uploadError && <p className="text-destructive text-sm">{uploadError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={!uploadFile || uploading}>
              {uploading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Editor Dialog (max width, scrollable) ─────── */}
      <Dialog open={!!editFile} onOpenChange={v => { if (!v) setEditFile(null) }}>
        <DialogContent className="sm:max-w-3xl w-full">
          <DialogHeader>
            <DialogTitle>Edit: {editFile?.name}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto">
            {editLoading
              ? (
                <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading content…
                </div>
              )
              : (
                <Textarea
                  className="font-mono text-sm min-h-[55vh] resize-none"
                  value={editContent}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditContent(e.target.value)}
                />
              )}
          </div>
          {editError && <p className="text-destructive text-sm">{editError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFile(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || editLoading}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ─────────────────────────────── */}
      <AlertDialog open={!!deleteItem} onOpenChange={v => { if (!v) setDeleteItem(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteItem?.is_folder ? 'folder' : 'file'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteItem?.name}" will be permanently deleted.
              {deleteItem?.is_folder &&
                ' Note: files inside this folder are NOT automatically removed.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Share Dialog ───────────────────────────────── */}
      <Dialog
        open={!!shareFile}
        onOpenChange={v => { if (!v) { setShareFile(null); setShareUrl(null) } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share: {shareFile?.name}</DialogTitle>
            <DialogDescription>
              Generate a public download link — no login required.
              Anyone with the link can download the file.
              Max validity: {quota?.share_max_minutes ?? 60} min.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Validity (minutes)</Label>
              <Input
                type="number" className="mt-1"
                min={1} max={quota?.share_max_minutes ?? 60}
                value={shareMinutes}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setShareMinutes(Number(e.target.value))}
              />
            </div>
            {shareUrl && (
              <div className="space-y-2">
                <Label>Public download link</Label>
                <div className="flex gap-2 mt-1">
                  <Input ref={shareUrlInputRef} readOnly value={shareUrl} className="text-xs font-mono" />
                  <Button
                    size="icon" variant="outline"
                    onClick={doCopy} title="Copy link"
                  >
                    {copied
                      ? <Check className="h-4 w-4 text-green-500" />
                      : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="icon" variant="ghost"
                    className="text-destructive"
                    onClick={handleRevoke} title="Revoke link"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {copied && <p className="text-xs text-green-600">Copied to clipboard!</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShareFile(null); setShareUrl(null) }}
            >
              Close
            </Button>
            <Button onClick={handleShare} disabled={sharing}>
              {sharing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {shareUrl ? 'Refresh link' : 'Generate link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}

export const Route = createFileRoute('/_app/_auth/files')({
  component: FilesPage,
})
