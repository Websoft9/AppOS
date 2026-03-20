import { X } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'

type DismissibleAlertVariant = 'default' | 'destructive'

export function DismissibleAlert({
  message,
  variant = 'default',
  onDismiss,
}: {
  message: string
  variant?: DismissibleAlertVariant
  onDismiss: () => void
}) {
  return (
    <Alert
      variant={variant}
      className="grid-cols-[1fr_auto] items-start gap-3 border px-4 py-3 [&>[data-slot=alert-description]]:col-start-1"
    >
      <AlertDescription className={variant === 'destructive' ? 'text-destructive/90' : 'text-foreground/80'}>
        <p>{message}</p>
      </AlertDescription>
      <button
        type="button"
        className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={onDismiss}
        aria-label={variant === 'destructive' ? 'Dismiss error' : 'Dismiss notice'}
      >
        <X className="h-4 w-4" />
      </button>
    </Alert>
  )
}