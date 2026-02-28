import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Folder,
  File as FileIcon,
  Link2,
  ChevronRight,
  Download,
  Trash2,
  Pencil,
  FolderPlus,
  FilePlus,
  Upload,
  Eye,
  EyeOff,
  MoreHorizontal,
  Home,
  ArrowUp,
  Loader2,
  LayoutList,
  LayoutGrid,
  Search,
  X,
  RefreshCw,
  Share2,
  Copy,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { getApiErrorMessage } from '@/lib/api-error'
import {
  sftpList,
  sftpSearch,
  sftpConstraints,
  sftpStat,
  sftpChmod,
  sftpChown,
  sftpSymlink,
  sftpMove,
  sftpDownloadUrl,
  sftpUpload,
  sftpMkdir,
  sftpRename,
  sftpDelete,
  loadPreferences,
  savePreferences,
  type DirEntry,
  type SearchResult,
} from '@/lib/connect-api'
import { pb } from '@/lib/pb'
import { FileEditorDialog } from './FileEditorDialog'

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024 // 50 MB

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FileManagerPanelProps {
  serverId: string
  initialPath?: string
  lockedRootPath?: string
  className?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function entryIcon(type: string) {
  if (type === 'dir') return <Folder className="h-4 w-4 text-blue-400 shrink-0" />
  if (type === 'symlink') return <Link2 className="h-4 w-4 text-purple-400 shrink-0" />
  return <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function joinPath(base: string, name: string): string {
  if (base === '/') return '/' + name
  return base + '/' + name
}

function parentPath(path: string): string {
  if (path === '/' || path === '') return '/'
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return '/' + parts.join('/')
}

function normalizePath(path: string): string {
  if (!path || path.trim() === '') return '/'
  const withSlash = path.startsWith('/') ? path : `/${path}`
  const compact = withSlash.replace(/\/+/g, '/')
  const parts = compact.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length > 0) stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.length > 0 ? `/${stack.join('/')}` : '/'
}

function isPathWithinRoot(path: string, rootPath: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedRoot = normalizePath(rootPath)
  if (normalizedRoot === '/') return true
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function clampPathToRoot(path: string, rootPath?: string): string {
  const normalizedPath = normalizePath(path)
  if (!rootPath) return normalizedPath
  const normalizedRoot = normalizePath(rootPath)
  return isPathWithinRoot(normalizedPath, normalizedRoot) ? normalizedPath : normalizedRoot
}

function breadcrumbSegments(path: string): { label: string; path: string }[] {
  const parts = path.split('/').filter(Boolean)
  const segments: { label: string; path: string }[] = [{ label: '/', path: '/' }]
  let acc = ''
  for (const part of parts) {
    acc += '/' + part
    segments.push({ label: part, path: acc })
  }
  return segments
}

type PermissionFlags = { read: boolean; write: boolean; execute: boolean }
type PermissionMatrix = { owner: PermissionFlags; group: PermissionFlags; others: PermissionFlags }

function flagsFromDigit(digit: string): PermissionFlags {
  const value = Number.parseInt(digit, 10)
  return {
    read: (value & 4) !== 0,
    write: (value & 2) !== 0,
    execute: (value & 1) !== 0,
  }
}

function digitFromFlags(flags: PermissionFlags): number {
  return (flags.read ? 4 : 0) + (flags.write ? 2 : 0) + (flags.execute ? 1 : 0)
}

function parsePermissionMatrix(mode: string): PermissionMatrix | null {
  const text = mode.trim()
  if (!/^[0-7]{3,4}$/.test(text)) return null
  const digits = text.length === 4 ? text.slice(1) : text
  return {
    owner: flagsFromDigit(digits[0]),
    group: flagsFromDigit(digits[1]),
    others: flagsFromDigit(digits[2]),
  }
}

function modeFromPermissionMatrix(matrix: PermissionMatrix, mode: string): string {
  const prefix = /^[0-7]{4}$/.test(mode.trim()) ? mode.trim()[0] : ''
  const owner = digitFromFlags(matrix.owner)
  const group = digitFromFlags(matrix.group)
  const others = digitFromFlags(matrix.others)
  return `${prefix}${owner}${group}${others}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FileManagerPanel({ serverId, initialPath = '/', lockedRootPath, className }: FileManagerPanelProps) {
  const scopedRootPath = normalizePath(lockedRootPath || '/')
  const scopedInitialPath = clampPathToRoot(initialPath, lockedRootPath)
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(() => loadPreferences().sftp_show_hidden)
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => loadPreferences().sftp_view_mode)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [searchRecursive, setSearchRecursive] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Inline editing states
  const [mkdirMode, setMkdirMode] = useState(false)
  const [mkdirName, setMkdirName] = useState('')
  const [createFileMode, setCreateFileMode] = useState(false)
  const [createFileName, setCreateFileName] = useState('')
  const [renameTarget, setRenameTarget] = useState<DirEntry | null>(null)
  const [renameName, setRenameName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DirEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyMessage, setBusyMessage] = useState('Working...')
  const [maxUploadFiles, setMaxUploadFiles] = useState(10)
  const [editFile, setEditFile] = useState<{ path: string; name: string; isNew?: boolean } | null>(null)

  const [propertiesTarget, setPropertiesTarget] = useState<DirEntry | null>(null)
  const [propertiesPath, setPropertiesPath] = useState('')
  const [propertiesLoading, setPropertiesLoading] = useState(false)
  const [propertiesSaving, setPropertiesSaving] = useState(false)
  const [propertiesMode, setPropertiesMode] = useState('')
  const [propertiesOwner, setPropertiesOwner] = useState('')
  const [propertiesGroup, setPropertiesGroup] = useState('')
  const [propertiesRecursive, setPropertiesRecursive] = useState(false)
  const [propertiesPermissions, setPropertiesPermissions] = useState<PermissionMatrix>({
    owner: { read: false, write: false, execute: false },
    group: { read: false, write: false, execute: false },
    others: { read: false, write: false, execute: false },
  })
  const [propertiesSize, setPropertiesSize] = useState('')
  const [propertiesAccessed, setPropertiesAccessed] = useState('')
  const [propertiesModified, setPropertiesModified] = useState('')
  const [propertiesCreated, setPropertiesCreated] = useState('')

  const [symlinkTargetEntry, setSymlinkTargetEntry] = useState<DirEntry | null>(null)
  const [symlinkTargetPath, setSymlinkTargetPath] = useState('')
  const [symlinkLinkPath, setSymlinkLinkPath] = useState('')
  const [symlinkSaving, setSymlinkSaving] = useState(false)

  const [copyMoveEntry, setCopyMoveEntry] = useState<DirEntry | null>(null)
  const [copyMoveMode, setCopyMoveMode] = useState<'copy' | 'move'>('copy')
  const [copyMoveTo, setCopyMoveTo] = useState('')
  const [copyMoveSaving, setCopyMoveSaving] = useState(false)

  const [shareEntry, setShareEntry] = useState<DirEntry | null>(null)
  const [shareMinutes, setShareMinutes] = useState(30)
  const [shareMaxMinutes, setShareMaxMinutes] = useState(60)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareRecordId, setShareRecordId] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)

  const uploadRef = useRef<HTMLInputElement>(null)

  // ─── Fetch directory listing ──────────────────────────────────────────────

  const fetchEntries = useCallback(async (path: string) => {
    const nextPath = clampPathToRoot(path, lockedRootPath)
    setLoading(true)
    setError(null)
    try {
      const res = await sftpList(serverId, nextPath)
      // Sort: dirs first, then alphabetically
      const sorted = [...res.entries].sort((a, b) => {
        if (a.type === 'dir' && b.type !== 'dir') return -1
        if (a.type !== 'dir' && b.type === 'dir') return 1
        return a.name.localeCompare(b.name)
      })
      setEntries(sorted)
      setCurrentPath(clampPathToRoot(res.path || nextPath, lockedRootPath))
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to list directory'))
    } finally {
      setLoading(false)
    }
  }, [lockedRootPath, serverId])

  useEffect(() => {
    fetchEntries(scopedInitialPath)
  }, [fetchEntries, scopedInitialPath])

  useEffect(() => {
    sftpConstraints(serverId)
      .then((res) => setMaxUploadFiles(Math.max(1, res.max_upload_files || 10)))
      .catch(() => setMaxUploadFiles(10))
  }, [serverId])

  useEffect(() => {
    const matrix = parsePermissionMatrix(propertiesMode)
    if (matrix) {
      setPropertiesPermissions(matrix)
    }
  }, [propertiesMode])

  const navigateTo = useCallback((path: string) => {
    fetchEntries(path)
  }, [fetchEntries])

  const refresh = useCallback(() => {
    fetchEntries(currentPath)
  }, [fetchEntries, currentPath])

  // ─── Filtered entries ─────────────────────────────────────────────────────

  const visibleEntries = (() => {
    let filtered = showHidden
      ? entries
      : entries.filter((e) => !e.name.startsWith('.'))
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      filtered = filtered.filter((e) => e.name.toLowerCase().includes(q))
    }
    return filtered
  })()

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleToggleHidden = () => {
    const next = !showHidden
    setShowHidden(next)
    savePreferences({ sftp_show_hidden: next })
  }

  const handleToggleViewMode = () => {
    const next = viewMode === 'list' ? 'grid' : 'list'
    setViewMode(next)
    savePreferences({ sftp_view_mode: next })
  }

  const handleToggleSearch = () => {
    setShowSearch((v) => !v)
    if (showSearch) {
      setSearchQuery('')
      setSearchResults([])
      setSearchError(null)
    }
  }

  // Recursive search — fires when searchRecursive=true and a query is entered
  useEffect(() => {
    if (!searchRecursive || !searchQuery.trim()) {
      setSearchResults([])
      setSearchError(null)
      return
    }
    const q = searchQuery.trim()
    const timer = setTimeout(async () => {
      setSearchLoading(true)
      setSearchError(null)
      try {
        const res = await sftpSearch(serverId, currentPath, q)
        setSearchResults(res.results)
      } catch (err) {
        setSearchError(getApiErrorMessage(err, 'Search failed'))
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 400) // 400 ms debounce
    return () => clearTimeout(timer)
  }, [searchRecursive, searchQuery, currentPath, serverId])

  const handleConfirmCreateFile = () => {
    const name = createFileName.trim()
    if (!name) return
    setCreateFileMode(false)
    setCreateFileName('')
    setEditFile({ path: joinPath(currentPath, name), name, isNew: true })
  }

  const handleDoubleClick = (entry: DirEntry) => {
    if (entry.type === 'dir') {
      navigateTo(joinPath(currentPath, entry.name))
    } else {
      // Open file in editor
      setEditFile({ path: joinPath(currentPath, entry.name), name: entry.name })
    }
  }

  const handleDownload = (entry: DirEntry) => {
    const url = sftpDownloadUrl(serverId, joinPath(currentPath, entry.name))
    const a = document.createElement('a')
    a.download = entry.name
    // Use fetch with auth token; check HTTP status before creating blob
    fetch(url, { headers: { Authorization: pb.authStore.token } })
      .then((r) => {
        if (!r.ok) throw new Error(`Download failed: ${r.status} ${r.statusText}`)
        return r.blob()
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob)
        a.href = blobUrl
        a.click()
        URL.revokeObjectURL(blobUrl)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Download failed')
      })
  }

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (files.length > maxUploadFiles) {
      setError(`Too many files: ${files.length}. Max allowed is ${maxUploadFiles}`)
      return
    }
    setBusy(true)
    setBusyMessage('Uploading files...')
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD_SIZE) {
          setError(`File "${file.name}" exceeds 50 MB limit`)
          continue
        }
        // Pass the current directory; backend appends the original filename.
        await sftpUpload(serverId, currentPath, file)
      }
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (uploadRef.current) uploadRef.current.value = ''
    }
  }

  const handleProperties = async (entry: DirEntry) => {
    const fullPath = joinPath(currentPath, entry.name)
    setPropertiesTarget(entry)
    setPropertiesPath(fullPath)
    setPropertiesLoading(true)
    try {
      const { attrs } = await sftpStat(serverId, fullPath)
      setPropertiesMode(attrs.mode)
      setPropertiesOwner(attrs.owner_name || String(attrs.owner))
      setPropertiesGroup(attrs.group_name || String(attrs.group))
      setPropertiesRecursive(false)
      setPropertiesSize(formatSize(attrs.size))
      setPropertiesAccessed(formatDate(attrs.accessed_at))
      setPropertiesModified(formatDate(attrs.modified_at))
      setPropertiesCreated(formatDate(attrs.created_at))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load properties')
      setPropertiesTarget(null)
    } finally {
      setPropertiesLoading(false)
    }
  }

  const handleSaveProperties = async () => {
    if (!propertiesTarget || !propertiesPath) return
    setPropertiesSaving(true)
    try {
      const mode = propertiesMode.trim()
      if (/^[0-7]{3,4}$/.test(mode)) {
        await sftpChmod(serverId, propertiesPath, mode, propertiesRecursive)
      }
      const owner = propertiesOwner.trim()
      const group = propertiesGroup.trim()
      if (owner && group) {
        await sftpChown(serverId, propertiesPath, owner, group)
      }
      setPropertiesTarget(null)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save properties')
    } finally {
      setPropertiesSaving(false)
    }
  }

  const handlePermissionToggle = (
    scope: keyof PermissionMatrix,
    flag: keyof PermissionFlags,
    checked: boolean,
  ) => {
    setPropertiesPermissions((previous) => {
      const next: PermissionMatrix = {
        owner: { ...previous.owner },
        group: { ...previous.group },
        others: { ...previous.others },
      }
      next[scope][flag] = checked
      setPropertiesMode(modeFromPermissionMatrix(next, propertiesMode))
      return next
    })
  }

  const runCopyOrMove = async (entry: DirEntry, move: boolean) => {
    const from = joinPath(currentPath, entry.name)
    const suggested = move ? from : `${from}_copy`
    setCopyMoveEntry(entry)
    setCopyMoveMode(move ? 'move' : 'copy')
    setCopyMoveTo(suggested)
  }

  const executeCopyOrMove = async () => {
    if (!copyMoveEntry) return
    const from = joinPath(currentPath, copyMoveEntry.name)
    const to = copyMoveTo.trim()
    if (!to) return

    setCopyMoveSaving(true)
    setBusy(true)
    setBusyMessage(copyMoveMode === 'move' ? 'Moving...' : 'Copying...')
    try {
      if (copyMoveMode === 'move') {
        await sftpMove(serverId, from, to)
      } else {
        const url = `/api/ext/terminal/sftp/${serverId}/copy-stream?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        const res = await fetch(url, {
          headers: { Authorization: pb.authStore.token },
        })
        if (!res.ok || !res.body) {
          throw new Error(`Copy failed: ${res.status}`)
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const chunks = buf.split('\n\n')
          buf = chunks.pop() ?? ''
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            try {
              const data = JSON.parse(line.slice(6)) as { copied?: number; total?: number; message?: string }
              if (data.message) throw new Error(data.message)
              if (typeof data.copied === 'number' && typeof data.total === 'number' && data.total > 0) {
                const pct = Math.floor((data.copied / data.total) * 100)
                setBusyMessage(`Copying... ${pct}%`)
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message) {
                throw parseErr
              }
            }
          }
        }
      }
      setCopyMoveEntry(null)
      refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : (copyMoveMode === 'move' ? 'Move failed' : 'Copy failed')
      setError(message)
    } finally {
      setBusy(false)
      setCopyMoveSaving(false)
    }
  }

  const handleCreateSymlink = async (entry: DirEntry) => {
    const target = joinPath(currentPath, entry.name)
    setSymlinkTargetEntry(entry)
    setSymlinkTargetPath(target)
    setSymlinkLinkPath(joinPath(currentPath, `${entry.name}.lnk`))
  }

  const handleConfirmSymlink = async () => {
    if (!symlinkTargetEntry) return
    const target = symlinkTargetPath.trim()
    const linkPath = symlinkLinkPath.trim()
    if (!target || !linkPath) return

    setSymlinkSaving(true)
    setBusy(true)
    setBusyMessage('Creating symlink...')
    try {
      await sftpSymlink(serverId, target, linkPath)
      setSymlinkTargetEntry(null)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create symlink')
    } finally {
      setBusy(false)
      setSymlinkSaving(false)
    }
  }

  const handleShare = async (entry: DirEntry) => {
    if (entry.type === 'dir') {
      setError('Only files can be shared')
      return
    }
    setShareEntry(entry)
    setShareUrl(null)
    setCopied(false)
    setShareRecordId(null)
    try {
      const quotaRes = await fetch('/api/ext/space/quota', {
        headers: { Authorization: pb.authStore.token },
      })
      if (quotaRes.ok) {
        const quota = await quotaRes.json() as { share_default_minutes?: number; share_max_minutes?: number }
        setShareMinutes(quota.share_default_minutes ?? 30)
        setShareMaxMinutes(quota.share_max_minutes ?? 60)
      } else {
        setShareMinutes(30)
        setShareMaxMinutes(60)
      }
    } catch {
      setShareMinutes(30)
      setShareMaxMinutes(60)
    }
  }

  const handleGenerateShare = async () => {
    if (!shareEntry) return
    const fullPath = joinPath(currentPath, shareEntry.name)
    setSharing(true)
    setBusy(true)
    setBusyMessage('Preparing share link...')
    try {
      const downloadUrl = sftpDownloadUrl(serverId, fullPath)
      const res = await fetch(downloadUrl, { headers: { Authorization: pb.authStore.token } })
      if (!res.ok) throw new Error(`Download failed: ${res.status}`)
      const blob = await res.blob()

      const form = new FormData()
      form.append('owner', pb.authStore.record?.id ?? '')
      form.append('name', shareEntry.name)
      form.append('mime_type', blob.type || 'application/octet-stream')
      form.append('content', blob, shareEntry.name)
      form.append('size', String(blob.size))

      const created = await pb.collection('user_files').create(form) as { id: string }
      setShareRecordId(created.id)
      const shareRes = await fetch(`/api/ext/space/share/${created.id}`, {
        method: 'POST',
        headers: {
          Authorization: pb.authStore.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ minutes: shareMinutes }),
      })
      if (!shareRes.ok) throw new Error(`Share failed: ${shareRes.status}`)
      const data = await shareRes.json() as { share_url?: string }
      if (!data.share_url) throw new Error('Share URL not returned')
      const absolute = `${window.location.origin}${data.share_url}`
      setShareUrl(absolute)
      setCopied(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share failed')
    } finally {
      setBusy(false)
      setSharing(false)
    }
  }

  const handleCopyShareUrl = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
    } catch {
      setError('Copy to clipboard failed')
    }
  }

  const handleRevokeShare = async () => {
    if (!shareRecordId) return
    try {
      await fetch(`/api/ext/space/share/${shareRecordId}`, {
        method: 'DELETE',
        headers: { Authorization: pb.authStore.token },
      })
      setShareUrl(null)
      setCopied(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke share')
    }
  }

  const handleMkdir = async () => {
    if (!mkdirName.trim()) return
    setBusy(true)
    try {
      await sftpMkdir(serverId, joinPath(currentPath, mkdirName.trim()))
      setMkdirMode(false)
      setMkdirName('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder')
    } finally {
      setBusy(false)
    }
  }

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return
    setBusy(true)
    try {
      await sftpRename(
        serverId,
        joinPath(currentPath, renameTarget.name),
        joinPath(currentPath, renameName.trim()),
      )
      setRenameTarget(null)
      setRenameName('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename')
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await sftpDelete(serverId, joinPath(currentPath, deleteTarget.name))
      setDeleteTarget(null)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
    } finally {
      setBusy(false)
    }
  }

  // ─── Drop zone ────────────────────────────────────────────────────────────

  const [dragOver, setDragOver] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => setDragOver(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleUpload(e.dataTransfer.files)
  }

  // ─── Breadcrumb segments ──────────────────────────────────────────────────

  const segments = breadcrumbSegments(currentPath).filter((segment) => isPathWithinRoot(segment.path, scopedRootPath))
  const canGoUp = currentPath !== scopedRootPath

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/30 shrink-0">
        {/* Breadcrumb */}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigateTo(scopedRootPath)}>
          <Home className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => navigateTo(parentPath(currentPath))}
          disabled={!canGoUp}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-0.5 text-sm text-muted-foreground overflow-x-auto flex-1 min-w-0">
          {segments.map((seg, i) => (
            <span key={seg.path} className="flex items-center shrink-0">
              {i > 0 && <ChevronRight className="h-3 w-3 mx-0.5 text-muted-foreground/50" />}
              <button
                className="hover:text-foreground hover:underline truncate max-w-[120px]"
                onClick={() => navigateTo(seg.path)}
              >
                {seg.label}
              </button>
            </span>
          ))}
        </div>

        {/* Actions */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Search files"
          onClick={handleToggleSearch}
        >
          <Search className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={viewMode === 'list' ? 'Grid view' : 'List view'}
          onClick={handleToggleViewMode}
        >
          {viewMode === 'list' ? <LayoutGrid className="h-4 w-4" /> : <LayoutList className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
          onClick={handleToggleHidden}
        >
          {showHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="New folder"
          onClick={() => { setMkdirMode(true); setMkdirName('') }}
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="New file"
          onClick={() => { setCreateFileMode(true); setCreateFileName('') }}
        >
          <FilePlus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Upload file"
          onClick={() => uploadRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Refresh"
          onClick={refresh}
          disabled={loading}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
        <input
          ref={uploadRef}
          type="file"
          multiple
          className="hidden"
          data-testid="upload-input"
          onChange={(e) => handleUpload(e.target.files)}
        />
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="flex flex-col border-b bg-muted/20 shrink-0">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') handleToggleSearch() }}
              placeholder={searchRecursive ? 'Recursive file search...' : 'Filter files by name...'}
              className="h-7 text-sm flex-1"
              autoFocus
            />
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleToggleSearch}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2 px-3 pb-1.5">
            <Checkbox
              id="recursive-search"
              checked={searchRecursive}
              onCheckedChange={(v) => { setSearchRecursive(!!v); setSearchResults([]); setSearchError(null) }}
              className="h-3.5 w-3.5"
            />
            <label htmlFor="recursive-search" className="text-xs text-muted-foreground cursor-pointer select-none">
              Recursive (search subdirectories)
            </label>
            {searchLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
          </div>
          {searchError && (
            <div className="px-3 pb-1.5 text-xs text-destructive">{searchError}</div>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 text-xs text-destructive bg-destructive/10 border-b">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* Mkdir inline input */}
      {mkdirMode && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20">
          <FolderPlus className="h-4 w-4 text-blue-400" />
          <Input
            value={mkdirName}
            onChange={(e) => setMkdirName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleMkdir()
              if (e.key === 'Escape') setMkdirMode(false)
            }}
            placeholder="New folder name"
            className="h-7 text-sm flex-1"
            autoFocus
            disabled={busy}
          />
          <Button size="sm" variant="outline" className="h-7" onClick={handleMkdir} disabled={busy}>
            Create
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setMkdirMode(false)}>
            Cancel
          </Button>
        </div>
      )}

      {/* Create file inline input */}
      {createFileMode && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20">
          <FilePlus className="h-4 w-4 text-green-400" />
          <Input
            value={createFileName}
            onChange={(e) => setCreateFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleConfirmCreateFile()
              if (e.key === 'Escape') setCreateFileMode(false)
            }}
            placeholder="New file name (e.g. notes.txt)"
            className="h-7 text-sm flex-1"
            autoFocus
          />
          <Button size="sm" variant="outline" className="h-7" onClick={handleConfirmCreateFile} disabled={!createFileName.trim()}>
            Open Editor
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setCreateFileMode(false)}>
            Cancel
          </Button>
        </div>
      )}

      {/* Rename inline input */}
      {renameTarget && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/20">
          <Pencil className="h-4 w-4 text-orange-400" />
          <span className="text-xs text-muted-foreground truncate max-w-[100px]">{renameTarget.name}</span>
          <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') setRenameTarget(null)
            }}
            placeholder="New name"
            className="h-7 text-sm flex-1"
            autoFocus
            disabled={busy}
          />
          <Button size="sm" variant="outline" className="h-7" onClick={handleRename} disabled={busy}>
            Rename
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setRenameTarget(null)}>
            Cancel
          </Button>
        </div>
      )}

      {/* File list */}
      <ScrollArea className="flex-1">
        <div
          className={cn('min-h-full', dragOver && 'ring-2 ring-primary/50 ring-inset bg-primary/5')}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {searchRecursive && searchQuery.trim() ? (
            /* ── Recursive search results ──────────────────────────── */
            searchResults.length === 0 && !searchLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                {`No files found for "${searchQuery.trim()}"`}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background border-b">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-1.5 font-medium">Name</th>
                    <th className="px-3 py-1.5 font-medium">Path</th>
                    <th className="px-3 py-1.5 font-medium w-[80px]">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((result) => (
                    <tr
                      key={result.path}
                      className="border-b border-border/50 hover:bg-muted/50 cursor-default"
                      onDoubleClick={() => {
                        if (result.type === 'dir') {
                          navigateTo(result.path)
                          handleToggleSearch()
                        } else {
                          setEditFile({ path: result.path, name: result.name })
                        }
                      }}
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          {entryIcon(result.type)}
                          <span className="truncate">{result.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground text-xs font-mono truncate max-w-[200px]">
                        {result.path.substring(0, result.path.lastIndexOf('/')) || '/'}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {result.type === 'dir' ? '—' : formatSize(result.size)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {searchQuery.trim()
                ? `No files matching "${searchQuery.trim()}"`
                : entries.length > 0 ? 'No visible files (hidden files filtered)' : 'Empty directory'}
            </div>
          ) : viewMode === 'grid' ? (
            /* ── Grid View ────────────────────────────────────────────── */
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1 p-2">
              {visibleEntries.map((entry) => (
                <div
                  key={entry.name}
                  className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-muted/50 cursor-default group relative"
                  onDoubleClick={() => handleDoubleClick(entry)}
                >
                  {/* Grid item icon (larger) */}
                  {entry.type === 'dir'
                    ? <Folder className="h-8 w-8 text-blue-400" />
                    : entry.type === 'symlink'
                      ? <Link2 className="h-8 w-8 text-purple-400" />
                      : <FileIcon className="h-8 w-8 text-muted-foreground" />
                  }
                  <span className="text-xs text-center truncate w-full" title={entry.name}>
                    {entry.name}
                  </span>
                  {entry.type !== 'dir' && (
                    <span className="text-[10px] text-muted-foreground">{formatSize(entry.size)}</span>
                  )}
                  {/* Context menu trigger on hover */}
                  <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-5 w-5">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {entry.type !== 'dir' && (
                          <DropdownMenuItem onClick={() => setEditFile({ path: joinPath(currentPath, entry.name), name: entry.name })}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {entry.type !== 'dir' && (
                          <DropdownMenuItem onClick={() => handleDownload(entry)}>
                            <Download className="h-4 w-4 mr-2" />
                            Download
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem data-testid={`properties-${entry.name}`} onClick={() => handleProperties(entry)}>
                          <Eye className="h-4 w-4 mr-2" />
                          Properties
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCreateSymlink(entry)}>
                          <Link2 className="h-4 w-4 mr-2" />
                          Create Symbolic Link
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => runCopyOrMove(entry, false)}>
                          <FilePlus className="h-4 w-4 mr-2" />
                          Copy
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => runCopyOrMove(entry, true)}>
                          <FolderPlus className="h-4 w-4 mr-2" />
                          Move
                        </DropdownMenuItem>
                        {entry.type !== 'dir' && (
                          <DropdownMenuItem onClick={() => handleShare(entry)}>
                            <Share2 className="h-4 w-4 mr-2" />
                            Share
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => { setRenameTarget(entry); setRenameName(entry.name) }}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(entry)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* ── List View ────────────────────────────────────────────── */
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Name</th>
                  <th className="px-3 py-1.5 font-medium w-[80px]">Size</th>
                  <th className="px-3 py-1.5 font-medium w-[90px] hidden sm:table-cell">Permissions</th>
                  <th className="px-3 py-1.5 font-medium w-[120px] hidden md:table-cell">Modified</th>
                  <th className="px-3 py-1.5 font-medium w-[40px]" />
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => (
                  <tr
                    key={entry.name}
                    className="border-b border-border/50 hover:bg-muted/50 cursor-default group"
                    onDoubleClick={() => handleDoubleClick(entry)}
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        {entryIcon(entry.type)}
                        <span className="truncate">{entry.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {entry.type === 'dir' ? '—' : formatSize(entry.size)}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground font-mono text-xs hidden sm:table-cell">
                      {entry.mode}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground hidden md:table-cell">
                      {formatDate(entry.modified_at)}
                    </td>
                    <td className="px-3 py-1.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            data-testid={`actions-${entry.name}`}
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {entry.type !== 'dir' && (
                            <DropdownMenuItem onClick={() => setEditFile({ path: joinPath(currentPath, entry.name), name: entry.name })}>
                              <Pencil className="h-4 w-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          {entry.type !== 'dir' && (
                            <DropdownMenuItem onClick={() => handleDownload(entry)}>
                              <Download className="h-4 w-4 mr-2" />
                              Download
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem data-testid={`properties-${entry.name}`} onClick={() => handleProperties(entry)}>
                            <Eye className="h-4 w-4 mr-2" />
                            Properties
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleCreateSymlink(entry)}>
                            <Link2 className="h-4 w-4 mr-2" />
                            Create Symbolic Link
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => runCopyOrMove(entry, false)}>
                            <FilePlus className="h-4 w-4 mr-2" />
                            Copy
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => runCopyOrMove(entry, true)}>
                            <FolderPlus className="h-4 w-4 mr-2" />
                            Move
                          </DropdownMenuItem>
                          {entry.type !== 'dir' && (
                            <DropdownMenuItem onClick={() => handleShare(entry)}>
                              <Share2 className="h-4 w-4 mr-2" />
                              Share
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => { setRenameTarget(entry); setRenameName(entry.name) }}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(entry)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Drop zone hint when dragging */}
          {dragOver && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-sm font-medium text-primary">Drop files to upload</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t text-xs text-muted-foreground shrink-0">
        {searchRecursive && searchQuery.trim()
          ? <span>{searchResults.length} results{searchResults.length >= 500 ? ' (limit reached)' : ''}</span>
          : <span>{visibleEntries.length} items{entries.length !== visibleEntries.length && ` (${entries.length - visibleEntries.length} hidden)`}{!searchRecursive && searchQuery.trim() && ` · filtered`}</span>
        }
        <span className="truncate max-w-[200px]">{currentPath}</span>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type === 'dir' ? 'folder' : 'file'}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!propertiesTarget} onOpenChange={(open) => !open && setPropertiesTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Properties: {propertiesTarget?.name}</DialogTitle>
            <DialogDescription>
              View metadata and manage owner, group, and permissions.
            </DialogDescription>
          </DialogHeader>
          {propertiesLoading ? (
            <div className="py-6 flex items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <Label>Size</Label>
                  <Input value={propertiesSize} readOnly className="mt-1" />
                </div>
                <div>
                  <Label>Accessed</Label>
                  <Input value={propertiesAccessed} readOnly className="mt-1" />
                </div>
                <div>
                  <Label>Modified</Label>
                  <Input value={propertiesModified} readOnly className="mt-1" />
                </div>
                <div>
                  <Label>Created</Label>
                  <Input value={propertiesCreated} readOnly className="mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Mode (octal)</Label>
                  <Input data-testid="properties-mode" value={propertiesMode} onChange={(e) => setPropertiesMode(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>Owner</Label>
                  <Input data-testid="properties-owner" value={propertiesOwner} onChange={(e) => setPropertiesOwner(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>Group</Label>
                  <Input data-testid="properties-group" value={propertiesGroup} onChange={(e) => setPropertiesGroup(e.target.value)} className="mt-1" />
                </div>
              </div>
              <div className="rounded-md border border-border p-3 space-y-3">
                <div className="text-sm font-medium">Permissions</div>
                <div className="grid grid-cols-4 gap-2 text-sm items-center">
                  <div className="text-muted-foreground">Scope</div>
                  <div className="text-muted-foreground">Read</div>
                  <div className="text-muted-foreground">Write</div>
                  <div className="text-muted-foreground">Execute</div>

                  <div>Owner</div>
                  <Checkbox
                    data-testid="perm-owner-read"
                    checked={propertiesPermissions.owner.read}
                    onCheckedChange={(value) => handlePermissionToggle('owner', 'read', value === true)}
                  />
                  <Checkbox
                    data-testid="perm-owner-write"
                    checked={propertiesPermissions.owner.write}
                    onCheckedChange={(value) => handlePermissionToggle('owner', 'write', value === true)}
                  />
                  <Checkbox
                    data-testid="perm-owner-execute"
                    checked={propertiesPermissions.owner.execute}
                    onCheckedChange={(value) => handlePermissionToggle('owner', 'execute', value === true)}
                  />

                  <div>Group</div>
                  <Checkbox
                    data-testid="perm-group-read"
                    checked={propertiesPermissions.group.read}
                    onCheckedChange={(value) => handlePermissionToggle('group', 'read', value === true)}
                  />
                  <Checkbox
                    data-testid="perm-group-write"
                    checked={propertiesPermissions.group.write}
                    onCheckedChange={(value) => handlePermissionToggle('group', 'write', value === true)}
                  />
                  <Checkbox
                    data-testid="perm-group-execute"
                    checked={propertiesPermissions.group.execute}
                    onCheckedChange={(value) => handlePermissionToggle('group', 'execute', value === true)}
                  />

                  <div>Public</div>
                  <Checkbox
                    data-testid="perm-others-read"
                    checked={propertiesPermissions.others.read}
                    onCheckedChange={(value) => handlePermissionToggle('others', 'read', value === true)}
                  />
                  <Checkbox
                    data-testid="perm-others-write"
                    checked={propertiesPermissions.others.write}
                    onCheckedChange={(value) => handlePermissionToggle('others', 'write', value === true)}
                  />
                  <Checkbox
                    data-testid="perm-others-execute"
                    checked={propertiesPermissions.others.execute}
                    onCheckedChange={(value) => handlePermissionToggle('others', 'execute', value === true)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="properties-recursive"
                    data-testid="properties-recursive"
                    checked={propertiesRecursive}
                    onCheckedChange={(value) => setPropertiesRecursive(value === true)}
                  />
                  <Label htmlFor="properties-recursive">Apply recursively</Label>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPropertiesTarget(null)}>Close</Button>
            <Button data-testid="properties-save" onClick={handleSaveProperties} disabled={propertiesSaving || propertiesLoading}>
              {propertiesSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!symlinkTargetEntry} onOpenChange={(open) => !open && setSymlinkTargetEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Symbolic Link</DialogTitle>
            <DialogDescription>
              Create a Symbolic Link pointing to an existing target path.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Target path (existing)</Label>
              <Input value={symlinkTargetPath} onChange={(e) => setSymlinkTargetPath(e.target.value)} className="mt-1" placeholder="/path/to/existing/file-or-dir" />
            </div>
            <div>
              <Label>Link path (new symbolic link)</Label>
              <Input value={symlinkLinkPath} onChange={(e) => setSymlinkLinkPath(e.target.value)} className="mt-1" placeholder="/path/to/new-link" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSymlinkTargetEntry(null)}>Cancel</Button>
            <Button onClick={handleConfirmSymlink} disabled={symlinkSaving || !symlinkTargetPath.trim() || !symlinkLinkPath.trim()}>
              {symlinkSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!copyMoveEntry} onOpenChange={(open) => !open && setCopyMoveEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copyMoveMode === 'move' ? 'Move' : 'Copy'}: {copyMoveEntry?.name}</DialogTitle>
            <DialogDescription>
              {copyMoveMode === 'move'
                ? 'Move this file/folder to a destination path. Existing destination path may be overwritten by server policy.'
                : 'Copy this file/folder to a destination path. Progress is shown while the operation is running.'}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Destination path</Label>
            <Input value={copyMoveTo} onChange={(e) => setCopyMoveTo(e.target.value)} className="mt-1" placeholder="/path/to/destination" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyMoveEntry(null)}>Cancel</Button>
            <Button onClick={executeCopyOrMove} disabled={copyMoveSaving || !copyMoveTo.trim()}>
              {copyMoveSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {copyMoveMode === 'move' ? 'Move' : 'Copy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!shareEntry} onOpenChange={(open) => !open && setShareEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share: {shareEntry?.name}</DialogTitle>
            <DialogDescription>
              Generate a public download link — no login required.
              This operation first copies the selected SFTP file into your personal Space,
              then creates a Space share link. Anyone with the link can download the file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Validity (minutes)</Label>
              <Input
                type="number"
                className="mt-1"
                min={1}
                max={shareMaxMinutes}
                value={shareMinutes}
                onChange={(e) => setShareMinutes(Number(e.target.value))}
              />
            </div>
            {shareUrl && (
              <div className="space-y-2">
                <Label>Public download link</Label>
                <div className="flex gap-2 mt-1">
                  <Input readOnly value={shareUrl} className="text-xs font-mono" />
                  <Button size="icon" variant="outline" onClick={handleCopyShareUrl} title="Copy link">
                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={handleRevokeShare} title="Revoke link">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {copied && <p className="text-xs text-green-600">Copied to clipboard!</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareEntry(null)}>Close</Button>
            <Button onClick={handleGenerateShare} disabled={sharing || shareMinutes < 1 || shareMinutes > shareMaxMinutes}>
              {sharing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {shareUrl ? 'Refresh link' : 'Generate link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Busy overlay */}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-20">
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span>{busyMessage}</span>
          </div>
        </div>
      )}

      {/* File editor dialog */}
      {editFile && (
        <FileEditorDialog
          open={!!editFile}
          onOpenChange={(open) => { if (!open) setEditFile(null) }}
          serverId={serverId}
          filePath={editFile.path}
          fileName={editFile.name}
          isNew={editFile.isNew}
        />
      )}
    </div>
  )
}
