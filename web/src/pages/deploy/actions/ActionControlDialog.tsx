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
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('deploy')
  const action = pending?.action ?? null
  const kind = pending?.kind ?? 'cancel'
  const label = actionControlLabel(kind)
  const projectLabel = action?.compose_project_name || action?.id || 'this action'

  return (
    <AlertDialog open={Boolean(pending)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('dialogs.actionControlTitle', { defaultValue: '{{label}} Action', label })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {kind === 'cancel'
              ? t('dialogs.cancelDescription', {
                  defaultValue:
                    'Cancel {{name}}? This immediately marks the queued action as cancelled before execution starts.',
                  name: projectLabel,
                })
              : kind === 'resume'
                ? t('dialogs.resumeDescription', {
                    defaultValue: 'Resume {{name}}? This continues the paused action.',
                    name: projectLabel,
                  })
                : t('dialogs.forceFailDescription', {
                    defaultValue:
                      'Force fail {{name}}? This immediately marks the running action as failed and releases the active slot without guaranteeing rollback.',
                    name: projectLabel,
                  })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t('dialogs.keepRunning', { defaultValue: 'Keep Running' })}
          </AlertDialogCancel>
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
