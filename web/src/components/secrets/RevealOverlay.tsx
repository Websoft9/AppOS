import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('secrets')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const clearTimerRef = useRef<number | null>(null)
  const contentRef = useRef<HTMLElement | null>(null)
  const content = useMemo(() => {
    if (!payload) return ''
    const entries = Object.entries(payload)
    // Single-field secret → copy just the value, no key wrapping.
    if (entries.length === 1) return String(entries[0][1] ?? '')
    return entries.map(([k, v]) => `${k}: ${String(v ?? '')}`).join('\n')
  }, [payload])

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
    setCopied(false)
    try {
      // 1. Modern API (secure context).
      await navigator.clipboard.writeText(content)
      setCopied(true)
    } catch {
      // 2. Fallback: use a temporary textarea placed inside the dialog so the
      //    Radix focus-trap does not interfere.  Copy plain JSON, not DOM labels.
      const container = contentRef.current
      if (container) {
        try {
          const textarea = document.createElement('textarea')
          textarea.value = content
          textarea.style.cssText = 'position:absolute;top:-9999px;left:0;opacity:0;'
          container.insertAdjacentElement('beforebegin', textarea)
          textarea.focus()
          textarea.select()
          const ok = document.execCommand('copy')
          textarea.remove()
          if (ok) {
            setCopied(true)
          } else {
            setCopyError(true)
            return
          }
        } catch {
          setCopyError(true)
          return
        }
      } else {
        setCopyError(true)
        return
      }
    }
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current)
    }
    if (clearAfterSeconds > 0) {
      clearTimerRef.current = window.setTimeout(() => {
        void navigator.clipboard.writeText('')
        clearTimerRef.current = null
      }, clearAfterSeconds * 1000)
    }
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent className="sm:max-w-xl">
          <DialogHeader>
          <DialogTitle>{t('reveal.title')}</DialogTitle>
          <DialogDescription>
            {t('reveal.description')}
          </DialogDescription>
        </DialogHeader>

        {fieldLabels && payload ? (
          <div
            ref={el => {
              contentRef.current = el
            }}
            className="max-h-80 overflow-auto space-y-3 rounded-md border bg-muted p-3"
          >
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
          <pre
            ref={el => {
              contentRef.current = el
            }}
            className="max-h-80 overflow-auto rounded-md border bg-muted p-3 text-xs"
          >
            {content}
          </pre>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:close')}
          </Button>
          <Button onClick={() => void copyText()}>
            {copyError ? t('reveal.copyFailed') : copied ? t('reveal.copied') : t('reveal.copy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
