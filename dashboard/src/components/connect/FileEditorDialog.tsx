import { useState, useEffect, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Save } from 'lucide-react'
import { sftpReadFile, sftpWriteFile } from '@/lib/connect-api'

// ─── Language detection ───────────────────────────────────────────────────────

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
  conf: 'ini',
  cfg: 'ini',
  md: 'markdown',
  sql: 'sql',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  tf: 'hcl',
  dockerfile: 'dockerfile',
  php: 'php',
  rb: 'ruby',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  txt: 'plaintext',
  log: 'plaintext',
}

function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'dockerfile'
  if (lower === 'makefile') return 'shell'
  if (lower === '.env' || lower.startsWith('.env.')) return 'shell'
  const ext = lower.split('.').pop() ?? ''
  return EXT_LANG[ext] ?? 'plaintext'
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface FileEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverId: string
  filePath: string
  fileName: string
  /** When true, opens the editor with empty content without loading from server (new file creation). */
  isNew?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FileEditorDialog({
  open,
  onOpenChange,
  serverId,
  filePath,
  fileName,
  isNew = false,
}: FileEditorDialogProps) {
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDirty = isNew ? true : content !== savedContent
  const language = detectLanguage(fileName)

  // Monaco theme
  const [monacoTheme, setMonacoTheme] = useState(() =>
    document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs',
  )
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setMonacoTheme(document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Load file content when dialog opens (skip for new files)
  useEffect(() => {
    if (!open || !filePath) return
    if (isNew) {
      setContent('')
      setSavedContent('')
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    sftpReadFile(serverId, filePath)
      .then((res) => {
        setContent(res.content)
        setSavedContent(res.content)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to read file')
      })
      .finally(() => setLoading(false))
  }, [open, serverId, filePath, isNew])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await sftpWriteFile(serverId, filePath, content)
      setSavedContent(content)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }, [serverId, filePath, content])

  // Ctrl+S keyboard shortcut
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (isDirty && !saving) handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, isDirty, saving, handleSave])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            {isNew ? <span className="text-muted-foreground text-xs">New:</span> : null}{fileName}
            {!isNew && isDirty && <span className="text-xs text-muted-foreground">(unsaved)</span>}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="px-4 py-1.5 text-xs text-destructive bg-destructive/10 border-b">
            {error}
            <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button>
          </div>
        )}

        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Editor
              height="100%"
              language={language}
              theme={monacoTheme}
              value={content}
              onChange={(value) => setContent(value ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          )}
        </div>

        <DialogFooter className="px-4 py-2 border-t shrink-0">
          <div className="flex items-center gap-2 w-full justify-between">
            <span className="text-xs text-muted-foreground">{language}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!isDirty || saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                Save
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
