import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface RevealOverlayProps {
  open: boolean
  payload: Record<string, unknown> | null
  fieldLabels?: Record<string, string>
  clearAfterSeconds?: number
  onClose: () => void
}

export function RevealOverlay({
  open,
  payload,
  fieldLabels,
  clearAfterSeconds = 0,
  onClose,
}: RevealOverlayProps) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const clearTimerRef = useRef<number | null>(null)
  const content = payload ? JSON.stringify(payload, null, 2) : ''

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (open) return
    setCopied(false)
    setCopyError(false)
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
  }, [open])

  async function copyText() {
    setCopyError(false)
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current)
      }
      if (clearAfterSeconds > 0) {
        clearTimerRef.current = window.setTimeout(() => {
          void navigator.clipboard.writeText('')
          clearTimerRef.current = null
        }, clearAfterSeconds * 1000)
      }
      setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Reveal Secret</DialogTitle>
          <DialogDescription>
            Displayed once in overlay and never persisted locally.
          </DialogDescription>
        </DialogHeader>

        {fieldLabels && payload ? (
          <div className="max-h-80 overflow-auto space-y-3 rounded-md border bg-muted p-3">
            {Object.entries(payload).map(([key, value]) => (
              <div key={key} className="space-y-0.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {fieldLabels[key] ?? key}
                </span>
                <pre className="text-xs whitespace-pre-wrap break-all">{String(value ?? '')}</pre>
              </div>
            ))}
          </div>
        ) : (
          <pre className="max-h-80 overflow-auto rounded-md border bg-muted p-3 text-xs">
            {content}
          </pre>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void copyText()}>
            {copyError ? 'Copy failed' : copied ? 'Copied' : 'Copy'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
