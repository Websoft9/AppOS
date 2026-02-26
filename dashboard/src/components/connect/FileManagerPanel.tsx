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
import { cn } from '@/lib/utils'
import {
  sftpList,
  sftpSearch,
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

// ─── Component ────────────────────────────────────────────────────────────────

export function FileManagerPanel({ serverId, className }: FileManagerPanelProps) {
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
  const [editFile, setEditFile] = useState<{ path: string; name: string; isNew?: boolean } | null>(null)

  const uploadRef = useRef<HTMLInputElement>(null)

  // ─── Fetch directory listing ──────────────────────────────────────────────

  const fetchEntries = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await sftpList(serverId, path)
      // Sort: dirs first, then alphabetically
      const sorted = [...res.entries].sort((a, b) => {
        if (a.type === 'dir' && b.type !== 'dir') return -1
        if (a.type !== 'dir' && b.type === 'dir') return 1
        return a.name.localeCompare(b.name)
      })
      setEntries(sorted)
      setCurrentPath(res.path || path)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list directory')
    } finally {
      setLoading(false)
    }
  }, [serverId])

  useEffect(() => {
    fetchEntries('/')
  }, [fetchEntries])

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
        setSearchError(err instanceof Error ? err.message : 'Search failed')
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
    setBusy(true)
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

  const segments = breadcrumbSegments(currentPath)

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/30 shrink-0">
        {/* Breadcrumb */}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigateTo('/')}>
          <Home className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => navigateTo(parentPath(currentPath))}
          disabled={currentPath === '/'}
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

      {/* Busy overlay */}
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
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
