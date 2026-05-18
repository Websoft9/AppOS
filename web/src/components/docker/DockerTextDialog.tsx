import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Copy, Download } from 'lucide-react'

type DockerTextDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  content: string
  loading?: boolean
  loadingText?: string
  emptyText?: string
  onRefresh?: () => void
  refreshDisabled?: boolean
  downloadBaseName?: string
  downloadExtension?: string
  copySuccessText?: string
  copyFailureText?: string
  downloadFailureText?: string
}

export function DockerTextDialog({
  open,
  onOpenChange,
  title,
  description,
  content,
  loading = false,
  loadingText = 'Loading...',
  emptyText = '(no output)',
  onRefresh,
  refreshDisabled = false,
  downloadBaseName = 'docker-output',
  downloadExtension = 'txt',
  copySuccessText = 'Copied',
  copyFailureText = 'Failed to copy',
  downloadFailureText = 'Failed to download',
}: DockerTextDialogProps) {
  const [actionTip, setActionTip] = useState('')

  const copyContent = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content || '')
      setActionTip(copySuccessText)
      window.setTimeout(() => setActionTip(''), 1200)
    } catch {
      setActionTip(copyFailureText)
      window.setTimeout(() => setActionTip(''), 1200)
    }
  }, [content, copyFailureText, copySuccessText])

  const downloadContent = useCallback(() => {
    try {
      const safeName = (downloadBaseName || 'docker-output').replace(/[^a-zA-Z0-9._-]/g, '_')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const blob = new Blob([content || ''], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeName}-${timestamp}.${downloadExtension}`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      setActionTip(downloadFailureText)
      window.setTimeout(() => setActionTip(''), 1200)
    }
  }, [content, downloadBaseName, downloadExtension, downloadFailureText])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[70vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-4 pb-2">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="px-5 pb-2 flex items-center gap-2">
          {onRefresh ? (
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading || refreshDisabled}>
              Refresh
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => void copyContent()} disabled={loading}>
            <Copy className="h-4 w-4 mr-1" /> Copy
          </Button>
          <Button variant="outline" size="sm" onClick={downloadContent} disabled={loading}>
            <Download className="h-4 w-4 mr-1" /> Download
          </Button>
          {actionTip ? <span className="text-xs text-muted-foreground">{actionTip}</span> : null}
        </div>
        <ScrollArea className="h-[calc(70vh-8rem)] border-t px-5 py-3">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all">
            {loading ? loadingText : content || emptyText}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}