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
import type { ActionRecord } from '@/pages/deploy/actions/action-types'

type DeleteOperationDialogProps = {
  operations: ActionRecord[]
  onOpenChange: (open: boolean) => void
  onConfirm: (operations: ActionRecord[]) => void
}

export function DeleteActionDialog({
  operations,
  onOpenChange,
  onConfirm,
}: DeleteOperationDialogProps) {
  const { t } = useTranslation('deploy')
  const singleOperation = operations.length === 1 ? operations[0] : null
  return (
    <AlertDialog open={operations.length > 0} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {operations.length > 1
              ? t('dialogs.deleteRecords', { defaultValue: 'Delete Activity Records' })
              : t('dialogs.deleteRecord', { defaultValue: 'Delete Activity Record' })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {operations.length > 1
              ? t('dialogs.deleteSelectedDescription', {
                  defaultValue:
                    'Delete {{count}} selected activity records? This removes them from history.',
                  count: operations.length,
                })
              : singleOperation
                ? t('dialogs.deleteOneDescription', {
                    defaultValue:
                      'Delete {{name}}? This removes the activity record from history.',
                    name: singleOperation.compose_project_name || singleOperation.id,
                  })
                : t('dialogs.deleteFallback', { defaultValue: 'Delete this activity record?' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common:cancel', { defaultValue: 'Cancel' })}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (operations.length > 0) onConfirm(operations)
            }}
          >
            {operations.length > 1
              ? t('dialogs.deleteCount', { defaultValue: 'Delete {{count}}', count: operations.length })
              : t('common:delete', { defaultValue: 'Delete' })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
