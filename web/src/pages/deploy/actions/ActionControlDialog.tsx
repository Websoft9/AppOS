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
import { actionControlLabel } from '@/pages/deploy/actions/action-utils'
import type { PendingActionControl } from '@/pages/deploy/actions/action-types'

type ActionControlDialogProps = {
  pending: PendingActionControl | null
  busy?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (pending: PendingActionControl) => void
}

export function ActionControlDialog({
  pending,
  busy = false,
  onOpenChange,
  onConfirm,
}: ActionControlDialogProps) {
  const action = pending?.action ?? null
  const kind = pending?.kind ?? 'cancel'
  const label = actionControlLabel(kind)
  const projectLabel = action?.compose_project_name || action?.id || 'this action'

  return (
    <AlertDialog open={Boolean(pending)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label} Action</AlertDialogTitle>
          <AlertDialogDescription>
            {kind === 'cancel'
              ? `Cancel ${projectLabel}? This immediately marks the queued action as cancelled before execution starts.`
              : `Force fail ${projectLabel}? This immediately marks the running action as failed and releases the active slot without guaranteeing rollback.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep Running</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || !pending}
            onClick={() => {
              if (pending) onConfirm(pending)
            }}
          >
            {busy ? `${label}...` : label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}