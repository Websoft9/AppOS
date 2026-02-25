import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useCallback, useRef, memo } from 'react'
import Editor from '@monaco-editor/react'
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  Save,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { pb } from '@/lib/pb'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { cn } from '@/lib/utils'

// ─── Route config ─────────────────────────────────────────────────────────────

type FilesSearch = { path?: string; root?: string }

export const Route = createFileRoute('/_app/_auth/_superuser/iac')({
  component: FilesPage,
  validateSearch: (search: Record<string, unknown>): FilesSearch => ({
    path: typeof search.path === 'string' ? search.path : undefined,
    root: typeof search.root === 'string' ? search.root : undefined,
  }),
})

// ─── API types ────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string
  type: 'file' | 'dir'
  size: number
  modified_at: string
}

interface ListResponse {
  path: string
  entries: FileEntry[]
}

interface ContentResponse {
  path: string
  content: string
  size: number
  modified_at: string
}

// ─── File extension → Monaco language ─────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  sh: 'shell',
  bash: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  toml: 'ini',
  ini: 'ini',
  env: 'shell',
  md: 'markdown',
  sql: 'sql',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  tf: 'hcl',
  dockerfile: 'dockerfile',
}

function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile'
  if (lower === '.env' || lower.startsWith('.env.')) return 'shell'
  const ext = lower.split('.').pop() ?? ''
  return EXT_LANG[ext] ?? 'plaintext'
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiList(path: string): Promise<ListResponse> {
  return pb.send<ListResponse>(`/api/ext/iac?path=${encodeURIComponent(path)}`, {})
}

async function apiRead(path: string): Promise<ContentResponse> {
  return pb.send<ContentResponse>(`/api/ext/iac/content?path=${encodeURIComponent(path)}`, {})
}

async function apiWrite(path: string, content: string): Promise<void> {
  await pb.send('/api/ext/iac/content', {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── Tree node ────────────────────────────────────────────────────────────────

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
  loaded?: boolean
}

const ROOTS: TreeNode[] = [
  { name: 'apps', path: 'apps', type: 'dir' },
  { name: 'workflows', path: 'workflows', type: 'dir' },
  { name: 'templates', path: 'templates', type: 'dir' },
]

// ─── TreeItem ─────────────────────────────────────────────────────────────────

interface TreeItemProps {
  node: TreeNode
  depth: number
  selectedPath: string | undefined
  onSelect: (node: TreeNode) => void
  onToggleDir: (node: TreeNode) => void
  expandedPaths: Set<string>
  loadingPaths: Set<string>
  errorPaths: Set<string>
}

const TreeItem = memo(function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
  onToggleDir,
  expandedPaths,
  loadingPaths,
  errorPaths,
}: TreeItemProps) {
  const isExpanded = expandedPaths.has(node.path)
  const isLoading = loadingPaths.has(node.path)
  const isSelected = selectedPath === node.path
  const isDir = node.type === 'dir'

  const handleClick = () => {
    if (isDir) {
      onToggleDir(node)
    } else {
      onSelect(node)
    }
  }

  return (
    <div>
      <button
        className={cn(
          'flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-sm text-left hover:bg-accent',
          isSelected && 'bg-accent font-medium',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={handleClick}
      >
        {isDir ? (
          isLoading ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : null}
        {isDir ? (
          isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-yellow-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-yellow-500" />
          )
        ) : (
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isDir && isExpanded && (
        <div>
          {errorPaths.has(node.path) ? (
            <div
              className="py-0.5 text-xs text-destructive italic"
              style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}
            >
              Failed to load
            </div>
          ) : node.children ? (
            node.children.length === 0 ? (
              <div
                className="py-0.5 text-xs text-muted-foreground italic"
                style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}
              >
                Empty
              </div>
            ) : (
              node.children.map((child) => (
                <TreeItem
                  key={child.path}
                  node={child}
                  depth={depth + 1}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  onToggleDir={onToggleDir}
                  expandedPaths={expandedPaths}
                  loadingPaths={loadingPaths}
                  errorPaths={errorPaths}
                />
              ))
            )
          ) : null /* loading in progress */}
        </div>
      )}
    </div>
  )
})

// ─── FilesPage ────────────────────────────────────────────────────────────────

function FilesPage() {
  const { path: initialPath, root: rootParam } = Route.useSearch()
  const navigate = Route.useNavigate()

  // When a root param is provided, scope the tree to that single directory
  const effectiveRoots: TreeNode[] = rootParam
    ? [{ name: rootParam.split('/').pop() ?? rootParam, path: rootParam, type: 'dir' }]
    : ROOTS

  // Tree state
  const [roots, setRoots] = useState<TreeNode[]>(effectiveRoots.map((r) => ({ ...r })))
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [errorPaths, setErrorPaths] = useState<Set<string>>(new Set())

  // Editor state
  const [selectedPath, setSelectedPath] = useState<string | undefined>(initialPath)
  const [editorContent, setEditorContent] = useState<string>('')
  const [savedContent, setSavedContent] = useState<string>('')
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Unsaved warning dialog
  const [pendingNode, setPendingNode] = useState<TreeNode | null>(null)

  const isDirty = editorContent !== savedContent

  // ── Load directory children ────────────────────────────────────────────────

  const loadDir = useCallback(async (node: TreeNode) => {
    setLoadingPaths((prev) => new Set(prev).add(node.path))
    setErrorPaths((prev) => { const next = new Set(prev); next.delete(node.path); return next })
    try {
      const data = await apiList(node.path)
      const children: TreeNode[] = data.entries.map((e) => ({
        name: e.name,
        path: node.path === '' ? e.name : `${node.path}/${e.name}`,
        type: e.type,
        loaded: false,
      }))
      setRoots((prev) => updateNodeChildren(prev, node.path, children))
    } catch (err) {
      console.error('Failed to load directory:', node.path, err)
      setErrorPaths((prev) => new Set(prev).add(node.path))
    } finally {
      setLoadingPaths((prev) => {
        const next = new Set(prev)
        next.delete(node.path)
        return next
      })
    }
  }, [])

  // ── Toggle directory ───────────────────────────────────────────────────────

  const handleToggleDir = useCallback(
    (node: TreeNode) => {
      // Guard: do not react while a directory load is already in flight.
      if (loadingPaths.has(node.path)) return

      const isCurrentlyExpanded = expandedPaths.has(node.path)

      if (isCurrentlyExpanded) {
        setExpandedPaths((prev) => {
          const next = new Set(prev)
          next.delete(node.path)
          return next
        })
      } else {
        setExpandedPaths((prev) => {
          const next = new Set(prev)
          next.add(node.path)
          return next
        })

        const found = findNode(roots, node.path)
        if (!found?.loaded) {
          loadDir(node)
        }
      }
    },
    [roots, expandedPaths, loadDir, loadingPaths],
  )

  // ── Select file ────────────────────────────────────────────────────────────

  // Track the latest file-open request to discard stale responses.
  const openFileIdRef = useRef(0)

  const openFile = useCallback(async (node: TreeNode) => {
    const requestId = ++openFileIdRef.current
    setSelectedPath(node.path)
    navigate({ search: { path: node.path, root: rootParam } })
    setLoadingFile(true)
    setFileError(null)
    setSaveError(null)
    try {
      const data = await apiRead(node.path)
      // Discard if a newer request was issued while we awaited.
      if (requestId !== openFileIdRef.current) return
      setEditorContent(data.content)
      setSavedContent(data.content)
    } catch (err) {
      if (requestId !== openFileIdRef.current) return
      setFileError(err instanceof Error ? err.message : 'Failed to load file')
    } finally {
      if (requestId === openFileIdRef.current) {
        setLoadingFile(false)
      }
    }
  }, [navigate])

  const handleSelectFile = useCallback(
    (node: TreeNode) => {
      if (isDirty) {
        setPendingNode(node)
      } else {
        openFile(node)
      }
    },
    [isDirty, openFile],
  )

  // ── Save file ──────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!selectedPath) return
    setSaving(true)
    setSaveError(null)
    try {
      await apiWrite(selectedPath, editorContent)
      setSavedContent(editorContent)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }, [selectedPath, editorContent])

  // Ctrl+S / Cmd+S keyboard shortcut
  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSaveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Discard + switch file ──────────────────────────────────────────────────

  const handleDiscardAndSwitch = () => {
    if (!pendingNode) return
    setPendingNode(null)
    openFile(pendingNode)
  }

  // ── Auto-open file from ?path= on first mount ──────────────────────────────
  const openFileRef = useRef(openFile)
  openFileRef.current = openFile
  useEffect(() => {
    if (initialPath) {
      openFileRef.current({
        name: initialPath.split('/').pop() ?? initialPath,
        path: initialPath,
        type: 'file',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Warn on browser/tab close if dirty ────────────────────────────────────
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  // ── Monaco theme — tracks app dark/light mode ────────────────────────────
  const [monacoTheme, setMonacoTheme] = useState(() =>
    document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs',
  )
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setMonacoTheme(document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs')
    })
    observer.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const language = selectedPath ? detectLanguage(selectedPath.split('/').pop() ?? '') : 'plaintext'
  const filename = selectedPath ? selectedPath.split('/').pop() : null

  return (
    <div className="flex h-[calc(100vh-var(--header-height))] overflow-hidden">
      {/* ── File Tree Sidebar ──────────────────────────────────────────────── */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-muted/30">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Files</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Reload tree"
            onClick={() => {
              setRoots(effectiveRoots.map((r) => ({ ...r })))
              setExpandedPaths(new Set())
              setLoadingPaths(new Set())
              setErrorPaths(new Set())
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="py-1">
            {roots.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                selectedPath={selectedPath}
                onSelect={handleSelectFile}
                onToggleDir={handleToggleDir}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                errorPaths={errorPaths}
              />
            ))}
          </div>
        </ScrollArea>
      </aside>

      {/* ── Editor Area ───────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Editor toolbar */}
        <div className="flex items-center justify-between border-b bg-background px-4 py-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {filename ? (
              <>
                <span>{selectedPath}</span>
                {isDirty && (
                  <span className="h-2 w-2 rounded-full bg-orange-400" title="Unsaved changes" />
                )}
              </>
            ) : (
              <span>Select a file from the tree</span>
            )}
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!selectedPath || !isDirty || saving || loadingFile}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>

        {/* Error banners */}
        {fileError && (
          <Alert variant="destructive" className="m-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{fileError}</AlertDescription>
          </Alert>
        )}
        {saveError && (
          <Alert variant="destructive" className="m-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}

        {/* Monaco Editor */}
        <div className="flex-1 overflow-hidden">
          {loadingFile ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !selectedPath ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <FileText className="h-12 w-12 opacity-30" />
              <p className="text-sm">Select a file to start editing</p>
            </div>
          ) : (
            <Editor
              height="100%"
              language={language}
              value={editorContent}
              onChange={(val) => setEditorContent(val ?? '')}
              theme={monacoTheme}
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on',
                tabSize: 2,
                automaticLayout: true,
              }}
            />
          )}
        </div>
      </div>

      {/* ── Unsaved Changes Dialog ────────────────────────────────────────── */}
      <AlertDialog open={!!pendingNode} onOpenChange={(open) => { if (!open) setPendingNode(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes in{' '}
              <strong>{selectedPath?.split('/').pop()}</strong>. Discard them and open the new file?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardAndSwitch}>Discard & Open</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

function updateNodeChildren(nodes: TreeNode[], targetPath: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) {
      return { ...n, children, loaded: true }
    }
    if (n.children) {
      return { ...n, children: updateNodeChildren(n.children, targetPath, children) }
    }
    return n
  })
}

function findNode(nodes: TreeNode[], targetPath: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.path === targetPath) return n
    if (n.children) {
      const found = findNode(n.children, targetPath)
      if (found) return found
    }
  }
  return undefined
}
