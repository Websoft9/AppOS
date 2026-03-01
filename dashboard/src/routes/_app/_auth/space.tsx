import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Upload, Trash2, Share2, FileText, Copy, Check, X, Loader2,
  Folder, FolderPlus, FilePlus, RefreshCw, Download,
  ChevronRight, Search, ArrowUp, ArrowDown, ChevronsUpDown,
  QrCode, Eye, MoreVertical, FolderInput,
  LayoutGrid, List, Pencil, Edit3, Maximize2, Minimize2,
  FileCode2, FileImage, FileVideo, FileType2, File as FileGeneric, Archive, Music2, RotateCcw,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { normalizeExtToken, formatExtListHint } from '@/lib/ext-normalize'
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  is_deleted?: boolean
}

interface Quota {
  max_size_mb: number
  max_upload_files: number
  editable_formats: string[]
  upload_allow_exts: string[]
  upload_deny_exts: string[]
  max_per_user: number
  share_max_minutes: number
  share_default_minutes: number
  reserved_folder_names: string[]
  disallowed_folder_names: string[]
}

type SortField = 'name' | 'type' | 'created' | 'updated'
type SortDir = 'asc' | 'desc'

// ─── Constants ───────────────────────────────────────────

const PAGE_SIZES = [15, 45, 90] as const

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

function resolveMaxUploadFiles(raw: number | undefined) {
  if (!raw || raw < 1) return 50
  if (raw > 200) return 200
  return raw
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

function buildQrFilename(fileName: string) {
  const base = fileName.replace(/\.[^/.]+$/, '') || 'file'
  const safe = base.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/-+/g, '-')
  return `${safe}-share-qr.png`
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

/** Truncate MIME type string for display (full value shown on hover via title). */
function truncateMime(mime: string, max = 20): string {
  return mime.length > max ? mime.slice(0, max) + '\u2026' : mime
}

// ─── File type classification ─────────────────────────────

type FileCategory = 'code' | 'text' | 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'other'

const CODE_EXTS = new Set([
  'js','ts','jsx','tsx','mjs','cjs','vue','svelte','py','rb','go','rs',
  'java','c','cpp','h','hpp','cc','cs','php','swift','kt','scala','groovy',
  'lua','r','m','pl','pm','ex','exs','erl','hrl','clj','cljs','fs','fsx',
  'ml','mli','css','scss','sass','less','html','htm','xml','sql','graphql',
  'sh','bash','zsh','fish','env','dockerfile','makefile','cmake','yaml','yml',
  'json','toml','ini','cfg','conf','properties','editorconfig',
])
const ARCHIVE_EXTS = new Set([
  'zip','tar','gz','tgz','bz2','xz','7z','rar','br','zst',
])

function classifyFile(file: { name: string; mime_type: string; is_folder: boolean }): FileCategory {
  if (file.is_folder) return 'other'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const m = file.mime_type ?? ''
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/pdf') return 'pdf'
  if (ARCHIVE_EXTS.has(ext) || m.includes('zip') || m.includes('tar') || m.includes('archive') || m.includes('compressed')) return 'archive'
  if (CODE_EXTS.has(ext)) return 'code'
  if (m.startsWith('text/')) return 'text'
  return 'other'
}

function FileIcon({ file, className = 'h-4 w-4 shrink-0' }: { file: { name: string; mime_type: string; is_folder: boolean }; className?: string }) {
  if (file.is_folder) return <Folder className={`${className} text-yellow-500`} />
  const cat = classifyFile(file)
  const icons: Record<FileCategory, React.ReactElement> = {
    code:    <FileCode2    className={`${className} text-emerald-500`} />,
    text:    <FileText     className={`${className} text-blue-400`}    />,
    image:   <FileImage    className={`${className} text-purple-500`}  />,
    video:   <FileVideo    className={`${className} text-orange-500`}  />,
    audio:   <Music2       className={`${className} text-pink-500`}    />,
    pdf:     <FileType2    className={`${className} text-red-500`}     />,
    archive: <Archive      className={`${className} text-amber-600`}   />,
    other:   <FileGeneric  className={`${className} text-muted-foreground`} />,
  }
  return icons[cat]
}

// MIME types served by the preview endpoint (image / PDF / audio / video).
// Must mirror spacePreviewMimeTypeList in backend/internal/routes/space.go.
const PREVIEW_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  'image/bmp', 'image/x-icon',
  'application/pdf',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/webm',
  'video/mp4', 'video/webm', 'video/ogg',
])

type PreviewType = 'image' | 'pdf' | 'audio' | 'video' | 'text'

/** Returns the preview category, or null if not previewable. */
function getPreviewType(file: UserFile, quota: Quota | null): PreviewType | null {
  if (file.is_folder || !file.content) return null
  // Any editable (text/code) file can be previewed as raw text.
  if (isEditable(file, quota)) return 'text'
  // Media / PDF: streamed via ?token= URL.
  if (!file.mime_type) return null
  const m = file.mime_type
  if (!PREVIEW_MIME_TYPES.has(m)) return null
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  return null
}

/** Build a preview URL with an auth token so browsers can embed it directly. */
function buildPreviewUrl(file: UserFile) {
  return `/api/ext/space/preview/${file.id}?token=${encodeURIComponent(pb.authStore.token)}`
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

// ─── ItemMenu helper ─────────────────────────────────────

interface ItemMenuProps {
  item: UserFile
  editable: boolean
  previewType: PreviewType | null
  inTrash?: boolean
  onOpen: () => void
  onPreview: () => void
  onEdit: () => void
  onDownloadUrl: string | null
  onShare: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void       // soft-delete (normal view)
  onRestore?: () => void     // restore from trash
  onHardDelete?: () => void  // permanent delete from trash
}

function ItemMenu({
  item, editable, previewType, inTrash,
  onOpen, onPreview, onEdit, onDownloadUrl, onShare, onRename, onDuplicate,
  onDelete, onRestore, onHardDelete,
}: ItemMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {inTrash
          ? (
            <>
              <DropdownMenuItem onClick={onRestore}>
                <RotateCcw className="h-4 w-4 mr-2" /> Restore
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onHardDelete}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete Permanently
              </DropdownMenuItem>
            </>
          )
          : item.is_folder
            ? (
              <>
                <DropdownMenuItem onClick={onOpen}>
                  <ChevronRight className="h-4 w-4 mr-2" /> Open
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onRename}>
                  <Pencil className="h-4 w-4 mr-2" /> Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                  <Trash2 className="h-4 w-4 mr-2" /> Move to Trash
                </DropdownMenuItem>
              </>
            )
            : (
              <>
                {previewType && (
                  <DropdownMenuItem onClick={onPreview}>
                    <Eye className="h-4 w-4 mr-2" /> Preview
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={!editable} onClick={() => editable && onEdit()}>
                  <Edit3 className="h-4 w-4 mr-2" /> Edit
                </DropdownMenuItem>
                {onDownloadUrl && (
                  <DropdownMenuItem asChild>
                    <a href={onDownloadUrl} download={item.name}>
                      <Download className="h-4 w-4 mr-2" /> Download
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onShare}>
                  <Share2 className="h-4 w-4 mr-2" /> Share
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onRename}>
                  <Pencil className="h-4 w-4 mr-2" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="h-4 w-4 mr-2" /> Create Copy
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                  <Trash2 className="h-4 w-4 mr-2" /> Move to Trash
                </DropdownMenuItem>
              </>
            )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
  const [pageSize, setPageSize] = useState<typeof PAGE_SIZES[number]>(15)

  // ── Trash view ─────────────────────────────────────────
  const [trashView, setTrashView] = useState(false)

  // ── Row selection (bulk ops) ───────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false)
  const [bulkMoveFolderId, setBulkMoveFolderId] = useState('')
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkMoving, setBulkMoving] = useState(false)

  // ── Inline expand (name click → properties panel) ──────
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Upload dialog ──────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
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

  // ── Preview dialog ─────────────────────────────────────
  const [previewFile, setPreviewFile] = useState<UserFile | null>(null)
  const [previewText, setPreviewText] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewFullscreen, setPreviewFullscreen] = useState(false)

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
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null)
  const [qrGenerating, setQrGenerating] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)

  // ── View mode ──────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')

  // ── Rename dialog ──────────────────────────────────────
  const [renameItem, setRenameItem] = useState<UserFile | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  // ── Empty trash confirm ────────────────────────────────
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [emptyingTrash, setEmptyingTrash] = useState(false)

  // ── Header checkbox ref (for indeterminate state) ──────
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  // ─── Data ──────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [quotaRes, listRes] = await Promise.all([
        fetch('/api/ext/space/quota', {
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

  const allFolders = useMemo(() => items.filter(i => i.is_folder && !i.is_deleted), [items])
  const allFiles   = useMemo(() => items.filter(i => !i.is_folder && !i.is_deleted), [items])
  const trashCount = useMemo(() => items.filter(i => i.is_deleted).length, [items])

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

  /** Items visible in the current view, after search + sort. */
  const viewItems = useMemo((): UserFile[] => {
    // Trash view: flat list of all deleted items regardless of folder.
    if (trashView) {
      let filtered = items.filter(i => i.is_deleted)
      if (search.trim()) {
        const q = search.toLowerCase()
        filtered = filtered.filter(i => i.name.toLowerCase().includes(q))
      }
      return [...filtered].sort((a, b) => {
        let cmp = 0
        if (sortBy === 'name')         cmp = a.name.localeCompare(b.name)
        else if (sortBy === 'type')    cmp = (a.mime_type ?? '').localeCompare(b.mime_type ?? '')
        else if (sortBy === 'updated') cmp = a.updated.localeCompare(b.updated)
        else                           cmp = a.created.localeCompare(b.created)
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    // Normal view: children of currentFolder that are NOT deleted.
    const parentId = currentFolderId ?? ''
    let filtered = items.filter(i => !i.is_deleted && i.parent === parentId)

    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = filtered.filter(i => i.name.toLowerCase().includes(q))
    }

    filtered = [...filtered].sort((a, b) => {
      // Folders always before files.
      if (a.is_folder !== b.is_folder) return a.is_folder ? -1 : 1
      let cmp = 0
      if (sortBy === 'name')         cmp = a.name.localeCompare(b.name)
      else if (sortBy === 'type')    cmp = (a.mime_type ?? '').localeCompare(b.mime_type ?? '')
      else if (sortBy === 'updated') cmp = a.updated.localeCompare(b.updated)
      else                           cmp = a.created.localeCompare(b.created)
      return sortDir === 'asc' ? cmp : -cmp
    })

    return filtered
  }, [items, currentFolderId, search, sortBy, sortDir, trashView])

  const totalPages = Math.max(1, Math.ceil(viewItems.length / pageSize))
  const safePage   = Math.min(page, totalPages)
  const pagedItems = viewItems.slice((safePage - 1) * pageSize, safePage * pageSize)
  const uploadMaxFiles = useMemo(
    () => resolveMaxUploadFiles(quota?.max_upload_files),
    [quota],
  )
  const uploadPolicyHint = useMemo(() => {
    if (!quota) return 'Allowed by extension policy: any file type with an extension.'
    const allow = (quota.upload_allow_exts ?? []).map(normalizeExtToken).filter(Boolean)
    const deny = (quota.upload_deny_exts ?? []).map(normalizeExtToken).filter(Boolean)
    if (allow.length > 0) {
      return `Allowlist mode: ${formatExtListHint(allow)}.`
    }
    if (deny.length > 0) {
      return `Denylist mode: blocks ${formatExtListHint(deny)}.`
    }
    return 'Allowed by extension policy: any file type with an extension.'
  }, [quota])

  // Reset to page 1 whenever the view changes.
  useEffect(() => { setPage(1) }, [currentFolderId, search, sortBy, sortDir, trashView, pageSize])

  // ─── Sort ──────────────────────────────────────────────

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
  }

  // ─── Selection (bulk) ──────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function isAllPageSelected() {
    return pagedItems.length > 0 && pagedItems.every(i => selectedIds.has(i.id))
  }

  function toggleSelectPage() {
    if (isAllPageSelected()) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        pagedItems.forEach(i => next.delete(i.id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        pagedItems.forEach(i => next.add(i.id))
        return next
      })
    }
  }

  // ─── Inline expand ─────────────────────────────────────

  function toggleExpand(item: UserFile) {
    setExpandedId(prev => prev === item.id ? null : item.id)
  }

  // ─── Bulk delete ───────────────────────────────────────

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    try {
      if (trashView) {
        // Already in trash: hard delete permanently
        await Promise.all([...selectedIds].map(id => pb.collection('user_files').delete(id)))
      } else {
        // Normal view: soft-delete (move to trash)
        await Promise.all([...selectedIds].map(id =>
          pb.collection('user_files').update(id, { is_deleted: true })
        ))
      }
      setSelectedIds(new Set())
      fetchAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to delete some items')
    } finally {
      setBulkDeleting(false)
    }
  }

  async function handleBulkRestore() {
    if (selectedIds.size === 0) return
    try {
      await Promise.all([...selectedIds].map(id =>
        pb.collection('user_files').update(id, { is_deleted: false })
      ))
      setSelectedIds(new Set())
      fetchAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to restore some items')
    }
  }

  // ─── Bulk move ─────────────────────────────────────────

  async function handleBulkMove() {
    if (selectedIds.size === 0) return
    setBulkMoving(true)
    try {
      await Promise.all([...selectedIds].map(id =>
        pb.collection('user_files').update(id, { parent: bulkMoveFolderId })
      ))
      setSelectedIds(new Set())
      setBulkMoveOpen(false)
      fetchAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to move some items')
    } finally {
      setBulkMoving(false)
    }
  }

  // ─── Header checkbox indeterminate sync ────────────────

  useEffect(() => {
    const el = headerCheckboxRef.current
    if (!el) return
    const someSelected = selectedIds.size > 0 && !isAllPageSelected()
    el.indeterminate = someSelected
  })

  // ─── Duplicate file ─────────────────────────────────────

  async function handleDuplicate(file: UserFile) {
    if (!file.content) return
    try {
      const downloadUrl = buildDownloadUrl(file)
      if (!downloadUrl) return
      const res = await fetch(downloadUrl, { headers: { Authorization: pb.authStore.token } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : ''
      const base = ext ? file.name.slice(0, file.name.length - ext.length) : file.name
      const copyName = `${base} (copy)${ext}`
      const form = new FormData()
      form.append('name', copyName)
      form.append('owner', pb.authStore.record!.id)
      form.append('mime_type', file.mime_type)
      form.append('parent', file.parent)
      form.append('is_folder', 'false')
      form.append('size', String(blob.size))
      form.append('content', new File([blob], copyName, { type: file.mime_type }), copyName)
      await fetch('/api/collections/user_files/records', {
        method: 'POST',
        headers: {
          Authorization: pb.authStore.token,
          'X-Space-Batch-Size': '1',
        },
        body: form,
      })
      fetchAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to duplicate file')
    }
  }

  // ─── Rename ────────────────────────────────────────────

  function openRename(item: UserFile) {
    setRenameItem(item)
    setRenameName(item.name)
    setRenameError(null)
  }

  async function handleRename() {
    if (!renameItem || !renameName.trim()) return
    setRenaming(true)
    setRenameError(null)
    try {
      await pb.collection('user_files').update(renameItem.id, { name: renameName.trim() })
      setRenameItem(null)
      fetchAll()
    } catch (e: unknown) {
      setRenameError(e instanceof Error ? e.message : 'Failed to rename')
    } finally {
      setRenaming(false)
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
    setUploadFiles([])
    setUploadName('')
    setUploadParent(currentFolderId ?? '')
    setUploadError(null)
    setUploadOpen(true)
  }

  // ─── Upload ────────────────────────────────────────────

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length === 0) return
    if (selected.length > uploadMaxFiles) {
      setUploadFiles([])
      setUploadName('')
      setUploadError(`You can upload up to ${uploadMaxFiles} files at once.`)
      return
    }
    setUploadFiles(selected)
    setUploadName(selected.length === 1 ? selected[0].name : '')
    setUploadError(null)
  }

  async function handleUpload() {
    if (uploadFiles.length === 0) return
    if (uploadFiles.length > uploadMaxFiles) {
      setUploadError(`You can upload up to ${uploadMaxFiles} files at once.`)
      return
    }
    const singleMode = uploadFiles.length === 1
    if (singleMode && !uploadName.trim()) return
    if (quota) {
      const allow = (quota.upload_allow_exts ?? []).map(normalizeExtToken).filter(Boolean)
      const deny = (quota.upload_deny_exts ?? []).map(normalizeExtToken).filter(Boolean)

      for (const file of uploadFiles) {
        const targetName = singleMode ? uploadName.trim() : file.name
        const ext = normalizeExtToken(targetName.split('.').pop()?.toLowerCase() ?? '')

        if (!ext) {
          setUploadError(`File "${targetName}" has no extension.`)
          return
        }
        if (allow.length > 0 && !allow.includes(ext)) {
          setUploadError(`Extension ".${ext}" is not in upload allowlist.`)
          return
        }
        if (allow.length === 0 && deny.includes(ext)) {
          setUploadError(`Extension ".${ext}" is blocked by upload denylist.`)
          return
        }
        if (file.size > quota.max_size_mb * 1024 * 1024) {
          setUploadError(`File "${targetName}" is too large. Max: ${formatBytes(quota.max_size_mb)}`)
          return
        }
      }
    }
    setUploading(true)
    setUploadError(null)
    const createdIds: string[] = []
    try {
      for (const file of uploadFiles) {
        const targetName = singleMode ? uploadName.trim() : file.name
        const form = new FormData()
        form.append('owner', pb.authStore.record?.id ?? '')
        form.append('name', targetName)
        form.append('mime_type', file.type || 'application/octet-stream')
        form.append('content', file, targetName)
        form.append('size', String(file.size))
        if (uploadParent) form.append('parent', uploadParent)
        const created = await pb.collection('user_files').create<UserFile>(form, {
          headers: {
            'X-Space-Batch-Size': String(uploadFiles.length),
          },
        })
        createdIds.push(created.id)
      }
      setUploadOpen(false)
      setUploadFiles([])
      setUploadName('')
      setUploadParent('')
      fetchAll()
    } catch (e: unknown) {
      if (createdIds.length > 0) {
        const results = await Promise.allSettled(
          createdIds.map(id => pb.collection('user_files').delete(id)),
        )
        const rolledBack = results.filter(r => r.status === 'fulfilled').length
        const failed = results.filter(r => r.status === 'rejected').length
        const baseError = e instanceof Error ? e.message : 'Upload failed'
        if (failed > 0) {
          setUploadError(`${baseError} Rolled back ${rolledBack} of ${createdIds.length} file(s); ${failed} may still remain.`)
        } else {
          setUploadError(`${baseError} Rolled back ${rolledBack} created file(s).`)
        }
      } else {
        const baseError = e instanceof Error ? e.message : 'Upload failed'
        setUploadError(baseError)
      }
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
      await pb.collection('user_files').create(form, {
        headers: {
          'X-Space-Batch-Size': '1',
        },
      })
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

  // ─── Preview ───────────────────────────────────────────

  async function openPreview(file: UserFile) {
    const type = getPreviewType(file, quota)
    setPreviewFile(file)
    setPreviewText(null)
    setPreviewError(null)
    setPreviewLoading(type === 'text')
    if (type === 'text') {
      try {
        const url = buildDownloadUrl(file)
        if (!url) throw new Error('No file content')
        const res = await fetch(url, { headers: { Authorization: pb.authStore.token } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setPreviewText(await res.text())
      } catch (e: unknown) {
        setPreviewError(e instanceof Error ? e.message : 'Failed to load preview')
      } finally {
        setPreviewLoading(false)
      }
    }
    // For image/pdf/audio/video: buildPreviewUrl() used inline in JSX.
  }

  function closePreview() {
    setPreviewFile(null)
    setPreviewText(null)
    setPreviewError(null)
    setPreviewFullscreen(false)
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
      if (deleteItem.is_deleted) {
        await pb.collection('user_files').delete(deleteItem.id)
      } else {
        await pb.collection('user_files').update(deleteItem.id, { is_deleted: true })
      }
      setDeleteItem(null)
      fetchAll()
    } catch { /* ignore */ } finally {
      setDeleting(false)
    }
  }

  async function handleRestore(item: UserFile) {
    try {
      await pb.collection('user_files').update(item.id, { is_deleted: false })
      fetchAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to restore')
    }
  }

  function handleEmptyTrash() {
    if (items.filter(i => i.is_deleted).length === 0) return
    setEmptyTrashOpen(true)
  }

  async function doEmptyTrash() {
    const trashItems = items.filter(i => i.is_deleted)
    setEmptyingTrash(true)
    try {
      await Promise.all(trashItems.map(i => pb.collection('user_files').delete(i.id)))
      setEmptyTrashOpen(false)
      fetchAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to empty trash')
    } finally {
      setEmptyingTrash(false)
    }
  }

  // ─── Share ─────────────────────────────────────────────

  function openShare(file: UserFile) {
    setShareFile(file)
    setShareMinutes(quota?.share_default_minutes ?? 30)
    setQrCodeDataUrl(null)
    setQrError(null)
    if (file.share_token && !isExpired(file.share_expires_at)) {
      // Reconstruct the public URL from the known token.
      setShareUrl(buildPublicShareUrl(`/api/ext/space/share/${file.share_token}/download`))
    } else {
      setShareUrl(null)
    }
    setCopied(false)
  }

  async function handleShare() {
    if (!shareFile) return
    setSharing(true)
    try {
      const res = await fetch(`/api/ext/space/share/${shareFile.id}`, {
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
      setQrCodeDataUrl(null)
      setQrError(null)
      fetchAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Share failed')
    } finally {
      setSharing(false)
    }
  }

  async function handleRevoke() {
    if (!shareFile) return
    try {
      const res = await fetch(`/api/ext/space/share/${shareFile.id}`, {
        method: 'DELETE',
        headers: { Authorization: pb.authStore.token },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.message ?? `HTTP ${res.status}`)
      }
      setShareUrl(null)
      setQrCodeDataUrl(null)
      setQrError(null)
      fetchAll()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Revoke failed')
    }
  }

  async function handleGenerateQr() {
    if (!shareUrl) return
    setQrGenerating(true)
    setQrError(null)
    try {
      const { toDataURL } = await import('qrcode')
      const dataUrl = await toDataURL(shareUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 256,
      })
      setQrCodeDataUrl(dataUrl)
    } catch (e: unknown) {
      setQrError(e instanceof Error ? e.message : 'Failed to generate QR code')
    } finally {
      setQrGenerating(false)
    }
  }

  function handleDownloadQr() {
    if (!qrCodeDataUrl || !shareFile) return
    const link = document.createElement('a')
    link.href = qrCodeDataUrl
    link.download = buildQrFilename(shareFile.name)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
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
        <h2 className="text-2xl font-bold shrink-0">Space</h2>

        {/* Trash breadcrumb OR normal folder breadcrumb */}
        {trashView
          ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-muted-foreground text-sm">/</span>
              <span className="text-sm font-semibold text-foreground flex items-center gap-1">
                <Trash2 className="h-3.5 w-3.5" /> Trash
              </span>
              <Button
                variant="ghost" size="sm"
                className="text-xs text-muted-foreground h-7 px-2"
                onClick={() => { setTrashView(false); setSearch('') }}
              >
                ← Back to Files
              </Button>
            </div>
          )
          : (
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
          )}

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

        {/* View toggle — shows icon for the OPPOSITE mode to switch to */}
        <Button
          variant="outline" size="sm"
          title={viewMode === 'list' ? 'Switch to Grid view' : 'Switch to List view'}
          onClick={() => setViewMode(m => m === 'list' ? 'grid' : 'list')}
        >
          {viewMode === 'list' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
        </Button>
        {/* Trash toggle */}
        <Button
          variant={trashView ? 'secondary' : 'outline'} size="sm"
          title="Trash"
          className="relative"
          onClick={() => { setTrashView(v => !v); setCurrentFolderId(null); setSearch('') }}
        >
          <Trash2 className="h-4 w-4" />
          {trashCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-destructive text-[9px] text-white flex items-center justify-center px-0.5">
              {trashCount > 9 ? '9+' : trashCount}
            </span>
          )}
        </Button>
        <Button
          variant="outline" size="sm"
          onClick={fetchAll} disabled={loading}
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
        {!trashView && (
          <>
            <Button variant="outline" size="sm" onClick={openNewFolder}>
              <FolderPlus className="h-4 w-4 mr-1" /> New Folder
            </Button>
            <Button variant="outline" size="sm" onClick={openNewFile}>
              <FilePlus className="h-4 w-4 mr-1" /> New File
            </Button>
            <Button size="sm" onClick={openUpload}>
              <Upload className="h-4 w-4 mr-1" /> Upload
            </Button>
          </>
        )}
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
            {trashView
              ? <Trash2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
              : <Folder className="h-10 w-10 mx-auto mb-3 opacity-30" />}
            <p>
              {trashView
                ? 'Trash is empty.'
                : search
                  ? `No items match "${search}".`
                  : 'This folder is empty. Create a subfolder or upload your first file.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Bulk action bar ────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/50 text-sm">
          <span className="text-muted-foreground">{selectedIds.size} selected</span>
          <div className="flex-1" />
          {trashView
            ? (
              <>
                <Button size="sm" variant="outline" onClick={handleBulkRestore}>
                  <RotateCcw className="h-4 w-4 mr-1" /> Restore
                </Button>
                <Button size="sm" variant="destructive" disabled={bulkDeleting} onClick={handleBulkDelete}>
                  {bulkDeleting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                  <Trash2 className="h-4 w-4 mr-1" /> Delete Permanently
                </Button>
              </>
            )
            : (
              <>
                <Button size="sm" variant="outline" onClick={() => { setBulkMoveFolderId(''); setBulkMoveOpen(true) }}>
                  <FolderInput className="h-4 w-4 mr-1" /> Move to…
                </Button>
                <Button size="sm" variant="destructive" disabled={bulkDeleting} onClick={handleBulkDelete}>
                  {bulkDeleting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                  <Trash2 className="h-4 w-4 mr-1" /> Move to Trash
                </Button>
              </>
            )}
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ── File list (table) ──────────────────────────── */}
      {!loading && viewItems.length > 0 && viewMode === 'list' && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <div className="flex items-center gap-2">
                      <input
                        ref={headerCheckboxRef}
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer"
                        checked={isAllPageSelected()}
                        onChange={toggleSelectPage}
                        title="Select all on this page"
                      />
                      <button
                        className="flex items-center font-semibold hover:text-foreground"
                        onClick={() => toggleSort('name')}
                      >
                        Name <SortIcon field="name" sortBy={sortBy} sortDir={sortDir} />
                      </button>
                    </div>
                  </TableHead>
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
                  <TableHead>
                    <button
                      className="flex items-center font-semibold hover:text-foreground"
                      onClick={() => toggleSort('updated')}
                    >
                      Modified <SortIcon field="updated" sortBy={sortBy} sortDir={sortDir} />
                    </button>
                  </TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedItems.map(item => {
                  const editable = isEditable(item, quota)
                  const itemPath = buildPath(item, items)
                  const previewType = getPreviewType(item, quota)
                  const isExpanded = expandedId === item.id
                  const mime = item.is_folder ? 'Folder' : (item.mime_type || '—')
                  return (
                    <>
                      <TableRow key={item.id} className={isExpanded ? 'bg-muted/30' : ''}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer shrink-0"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleSelect(item.id)}
                            />
                            {item.is_folder
                              ? (
                                <button
                                  className="flex items-center gap-1.5 hover:underline cursor-pointer whitespace-nowrap"
                                  onClick={() => navigateTo(item.id)}
                                >
                                  <FileIcon file={item} />
                                  {item.name}
                                </button>
                              )
                              : (
                                <button
                                  className="flex items-center gap-1.5 hover:underline cursor-pointer text-left whitespace-nowrap"
                                  onClick={() => toggleExpand(item)}
                                >
                                  <FileIcon file={item} />
                                  {item.name}
                                </button>
                              )}
                          </div>
                        </TableCell>
                        <TableCell
                          className="text-muted-foreground text-sm max-w-[120px] truncate"
                          title={mime}
                        >
                          {truncateMime(mime)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                          {item.is_folder ? '—' : formatFileSize(item.size)}
                        </TableCell>
                        <TableCell>
                          {!item.is_folder && item.share_token && !isExpired(item.share_expires_at)
                            ? (
                              <Badge variant="secondary" className="text-xs whitespace-nowrap">
                                Shared
                              </Badge>
                            )
                            : <span className="text-muted-foreground text-sm">—</span>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(item.created)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(item.updated)}
                        </TableCell>
                        <TableCell>
                          <ItemMenu
                            item={item}
                            editable={editable}
                            previewType={previewType}
                            inTrash={trashView}
                            onOpen={() => navigateTo(item.id)}
                            onPreview={() => openPreview(item)}
                            onEdit={() => openEditor(item)}
                            onDownloadUrl={buildDownloadUrl(item)}
                            onShare={() => openShare(item)}
                            onRename={() => openRename(item)}
                            onDuplicate={() => handleDuplicate(item)}
                            onDelete={() => setDeleteItem(item)}
                            onRestore={() => handleRestore(item)}
                            onHardDelete={() => setDeleteItem(item)}
                          />
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${item.id}-expand`} className="bg-muted/20 hover:bg-muted/20">
                          <TableCell colSpan={7} className="py-3 px-6">
                            <div className="flex gap-6 flex-wrap">
                              {previewType === 'image' && (
                                <div className="shrink-0">
                                  <img
                                    src={buildPreviewUrl(item)}
                                    alt={item.name}
                                    className="max-h-48 max-w-xs object-contain rounded border"
                                  />
                                </div>
                              )}
                              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                                <dt className="text-muted-foreground font-medium">Name</dt>
                                <dd className="font-mono break-all">{item.name}</dd>
                                <dt className="text-muted-foreground font-medium">Path</dt>
                                <dd className="font-mono break-all">{itemPath}</dd>
                                <dt className="text-muted-foreground font-medium">Type</dt>
                                <dd>{item.mime_type || '—'}</dd>
                                <dt className="text-muted-foreground font-medium">Size</dt>
                                <dd>{formatFileSize(item.size)}</dd>
                                <dt className="text-muted-foreground font-medium">Created</dt>
                                <dd>{formatDate(item.created)}</dd>
                                <dt className="text-muted-foreground font-medium">Modified</dt>
                                <dd>{formatDate(item.updated)}</dd>
                                {item.share_token && !isExpired(item.share_expires_at) && (
                                  <>
                                    <dt className="text-muted-foreground font-medium">Shared until</dt>
                                    <dd>{formatDate(item.share_expires_at)}</dd>
                                  </>
                                )}
                              </dl>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── File list (grid) ───────────────────────────── */}
      {!loading && viewItems.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {pagedItems.map(item => {
            const editable = isEditable(item, quota)
            const previewType = getPreviewType(item, quota)
            const isSelected = selectedIds.has(item.id)
            return (
              <div
                key={item.id}
                className={`group relative flex flex-col items-center gap-1.5 rounded-lg border p-3 cursor-pointer select-none transition-colors
                  ${isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
              >
                {/* Selection checkbox */}
                <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer"
                    checked={isSelected}
                    onChange={() => toggleSelect(item.id)}
                    onClick={e => e.stopPropagation()}
                  />
                </div>
                {/* Icon */}
                <div
                  className="flex items-center justify-center h-12 w-12 mt-1"
                  onClick={() => item.is_folder ? navigateTo(item.id) : toggleExpand(item)}
                >
                  <FileIcon
                    file={item}
                    className="h-10 w-10 shrink-0"
                  />
                </div>
                {/* Name */}
                <span
                  className="text-xs text-center leading-tight max-w-full break-words line-clamp-2"
                  title={item.name}
                  onClick={() => item.is_folder ? navigateTo(item.id) : toggleExpand(item)}
                >
                  {item.name}
                </span>
                {/* More menu */}
                <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ItemMenu
                    item={item}
                    editable={editable}
                    previewType={previewType}
                    inTrash={trashView}
                    onOpen={() => navigateTo(item.id)}
                    onPreview={() => openPreview(item)}
                    onEdit={() => openEditor(item)}
                    onDownloadUrl={buildDownloadUrl(item)}
                    onShare={() => openShare(item)}
                    onRename={() => openRename(item)}
                    onDuplicate={() => handleDuplicate(item)}
                    onDelete={() => setDeleteItem(item)}
                    onRestore={() => handleRestore(item)}
                    onHardDelete={() => setDeleteItem(item)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Pagination ─────────────────────────────────── */}
      {viewItems.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-2">
          <span>{viewItems.length} items · page {safePage} of {totalPages}</span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              Per page
              <select
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value) as typeof PAGE_SIZES[number]); setPage(1) }}
              >
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</Button>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>›</Button>
          </div>
        </div>
      )}

      {/* ── Stats ──────────────────────────────────────── */}
      {quota && !loading && !trashView && (
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            {allFolders.length} folder{allFolders.length !== 1 ? 's' : ''}
            {' · '}{allFiles.length} file{allFiles.length !== 1 ? 's' : ''}
            {' · '}{items.filter(i => !i.is_deleted).length} / {quota.max_per_user} items used
            {' · '}max file size {formatBytes(quota.max_size_mb)}
            {trashCount > 0 && <span className="text-destructive/70"> · {trashCount} in trash</span>}
          </p>
        </div>
      )}
      {trashView && trashCount > 0 && (
        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" onClick={handleEmptyTrash}>
            <Trash2 className="h-4 w-4 mr-1" /> Empty Trash ({trashCount})
          </Button>
        </div>
      )}

      {/* ── Bulk Move Dialog ───────────────────────────── */}
      <Dialog open={bulkMoveOpen} onOpenChange={v => { if (!v) setBulkMoveOpen(false) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} to…</DialogTitle>
            <DialogDescription>Select the target folder. Choose root (/) to move to the top level.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Target folder</Label>
            <select
              className="mt-1 w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              value={bulkMoveFolderId}
              onChange={e => setBulkMoveFolderId(e.target.value)}
            >
              <option value="">/ (root)</option>
              {allFolders
                .filter(f => !selectedIds.has(f.id))
                .map(f => (
                  <option key={f.id} value={f.id}>{buildPath(f, items)}</option>
                ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkMoveOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkMove} disabled={bulkMoving}>
              {bulkMoving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename Dialog ──────────────────────────────── */}
      <Dialog open={!!renameItem} onOpenChange={v => { if (!v) setRenameItem(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename "{renameItem?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New name</Label>
            <Input
              autoFocus
              value={renameName}
              onChange={e => setRenameName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleRename() }}
            />
            {renameError && <p className="text-destructive text-sm">{renameError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameItem(null)}>Cancel</Button>
            <Button onClick={handleRename} disabled={!renameName.trim() || renaming}>
              {renaming && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {`Max size: ${formatBytes(quota?.max_size_mb ?? 10)}. `}
              {`Max files per upload: ${uploadMaxFiles}. `}
              {uploadPolicyHint}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>File</Label>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFileSelected} />
              <Button
                variant="outline" className="w-full mt-1"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadFiles.length === 0
                  ? 'Choose file(s)…'
                  : uploadFiles.length === 1
                    ? uploadFiles[0].name
                    : `${uploadFiles.length} files selected`}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">Batch upload supports up to {uploadMaxFiles} files.</p>
            </div>
            {uploadFiles.length > 0 && (
              <>
                {uploadFiles.length === 1 && (
                  <div>
                    <Label>Display name</Label>
                    <Input
                      className="mt-1" value={uploadName} placeholder="e.g. notes.md"
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUploadName(e.target.value)}
                    />
                  </div>
                )}
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
            <Button onClick={handleUpload} disabled={uploadFiles.length === 0 || uploading}>
              {uploading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Preview Dialog ─────────────────────────────── */}
      <Dialog open={!!previewFile} onOpenChange={v => { if (!v) closePreview() }}>
        <DialogContent
          className={previewFullscreen
            ? '!w-screen !h-screen !max-w-none !translate-x-0 !translate-y-0 !left-0 !top-0 !rounded-none flex flex-col overflow-hidden'
            : 'sm:max-w-4xl w-full'}
          aria-describedby={undefined}
        >
          <DialogHeader className="pr-10">
            <div className="flex items-center gap-2">
              <DialogTitle className="truncate">{previewFile?.name}</DialogTitle>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7 shrink-0"
                onClick={() => setPreviewFullscreen(f => !f)}
                title={previewFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {previewFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            </div>
          </DialogHeader>
          <div className={`flex items-center justify-center overflow-auto ${previewFullscreen ? 'flex-1' : 'min-h-[40vh] max-h-[70vh]'}`}>
            {previewLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading preview…
              </div>
            )}
            {previewError && (
              <p className="text-destructive text-sm">{previewError}</p>
            )}
            {!previewLoading && !previewError && previewFile && (() => {
              const type = getPreviewType(previewFile, quota)
              const directUrl = buildPreviewUrl(previewFile)
              if (type === 'text') {
                return (
                  <pre className="w-full text-sm font-mono whitespace-pre-wrap break-all text-left">
                    {previewText ?? ''}
                  </pre>
                )
              }
              if (type === 'image') {
                return (
                  <img
                    src={directUrl}
                    alt={previewFile.name}
                    className={`max-w-full object-contain rounded ${previewFullscreen ? 'max-h-full' : 'max-h-[65vh]'}`}
                  />
                )
              }
              if (type === 'pdf') {
                return (
                  <iframe
                    src={directUrl}
                    title={previewFile.name}
                    className={`w-full rounded border ${previewFullscreen ? 'h-full' : 'h-[65vh]'}`}
                  />
                )
              }
              if (type === 'audio') {
                return (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <audio controls src={directUrl} className="w-full" />
                )
              }
              if (type === 'video') {
                return (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    controls
                    src={directUrl}
                    className={`max-w-full rounded ${previewFullscreen ? 'max-h-full' : 'max-h-[65vh]'}`}
                  />
                )
              }
              return null
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePreview}>Close</Button>
            {previewFile && getPreviewType(previewFile, quota) === 'text' && isEditable(previewFile, quota) && (
              <Button
                variant="outline"
                onClick={() => { if (previewFile) { const f = previewFile; closePreview(); openEditor(f) } }}
              >
                <Edit3 className="h-4 w-4 mr-1" /> Edit
              </Button>
            )}
            {previewFile?.content && (
              <a
                href={buildDownloadUrl(previewFile) ?? '#'}
                download={previewFile.name}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium border border-input bg-background hover:bg-muted transition-colors"
              >
                <Download className="h-4 w-4" /> Download
              </a>
            )}
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
              {deleteItem?.is_deleted ? 'Delete Permanently?' : `Move ${deleteItem?.is_folder ? 'folder' : 'file'} to Trash?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteItem?.is_deleted
                ? `"${deleteItem?.name}" will be permanently deleted and cannot be recovered.`
                : `"${deleteItem?.name}" will be moved to Trash.${deleteItem?.is_folder ? ' Note: files inside this folder are NOT automatically moved.' : ''}`}
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
              {deleteItem?.is_deleted ? 'Delete Permanently' : 'Move to Trash'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Empty Trash Confirm ─────────────────────────── */}
      <AlertDialog open={emptyTrashOpen} onOpenChange={setEmptyTrashOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              All {trashCount} item{trashCount !== 1 ? 's' : ''} in Trash will be permanently deleted.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={emptyingTrash}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={doEmptyTrash}
              disabled={emptyingTrash}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {emptyingTrash && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Empty Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Share Dialog ───────────────────────────────── */}
      <Dialog
        open={!!shareFile}
        onOpenChange={v => {
          if (!v) {
            setShareFile(null)
            setShareUrl(null)
            setQrCodeDataUrl(null)
            setQrError(null)
          }
        }}
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
                  <Button
                    size="icon" variant="outline"
                    onClick={handleGenerateQr}
                    title="Generate QR code"
                    disabled={qrGenerating}
                  >
                    {qrGenerating
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <QrCode className="h-4 w-4" />}
                  </Button>
                </div>
                {copied && <p className="text-xs text-green-600">Copied to clipboard!</p>}
                {qrError && <p className="text-xs text-destructive">{qrError}</p>}
                {qrCodeDataUrl && (
                  <div className="space-y-2">
                    <div className="w-fit rounded-md border border-border p-2 bg-background">
                      <img src={qrCodeDataUrl} alt="Share QR code" className="h-40 w-40" />
                    </div>
                    <Button variant="outline" size="sm" onClick={handleDownloadQr}>
                      <Download className="h-4 w-4 mr-1" /> Download QR
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setShareFile(null); setShareUrl(null); setQrCodeDataUrl(null); setQrError(null) }}
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

export const Route = createFileRoute('/_app/_auth/space')({
  component: FilesPage,
})
