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
  const singleOperation = operations.length === 1 ? operations[0] : null
  return (
    <AlertDialog open={operations.length > 0} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {operations.length > 1 ? 'Delete Activity Records' : 'Delete Activity Record'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {operations.length > 1
              ? `Delete ${operations.length} selected activity records? This removes them from history.`
              : singleOperation
                ? `Delete ${singleOperation.compose_project_name || singleOperation.id}? This removes the activity record from history.`
                : 'Delete this activity record?'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (operations.length > 0) onConfirm(operations)
            }}
          >
            {operations.length > 1 ? `Delete ${operations.length}` : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
