import { useState } from 'react'
import ReactMarkdown from 'react-markdown'

// ─── Markdown Viewer (lightweight, always loaded) ────────

interface MarkdownViewProps {
  children: string
  className?: string
}

export function MarkdownView({ children, className }: MarkdownViewProps) {
  if (!children) return null
  return (
    <div className={className ?? 'prose prose-sm dark:prose-invert max-w-none'}>
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  )
}

// ─── Markdown Editor (Textarea + Write/Preview tabs) ─────

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Write Markdown...',
  rows = 14,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<'write' | 'preview'>('write')

  return (
    <div className="border rounded-md overflow-hidden">
      <div className="flex border-b bg-muted/30">
        <button
          type="button"
          className={`px-3 py-1.5 text-sm font-medium ${tab === 'write' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setTab('write')}
        >
          Write
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 text-sm font-medium ${tab === 'preview' ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setTab('preview')}
        >
          Preview
        </button>
      </div>
      {tab === 'write' ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="w-full resize-y overflow-y-auto p-3 text-sm bg-background focus:outline-none"
        />
      ) : (
        <div className="p-3 min-h-[200px]">
          {value.trim() ? (
            <MarkdownView>{value}</MarkdownView>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing to preview</p>
          )}
        </div>
      )}
    </div>
  )
}
